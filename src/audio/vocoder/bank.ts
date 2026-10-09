/**
 * The channel vocoder (0.7): a bank of cascaded RBJ band-passes analyses
 * the modulator, each band's follower shapes the same band of the carrier.
 * Ported from the reviewed prototype (proto/vocoder, DSP v2):
 * - layout from bands/lo/hi/width only (sample-rate independent);
 * - band k reads the modulator advanced by its group delay plus the attack;
 * - formant: synthesis band k takes the envelope at fractional analysis
 *   index k - formant / 12 / log2(ratio);
 * - enhance whitens the carrier per band (each band normalised by its own
 *   follower), so a dull carrier still speaks in every band;
 * - fixed makeup gain from the layout only, never from the rendered span.
 * A stereo carrier runs one analysis and one synthesis bank per channel.
 */
import {
  bandpass,
  bankDesign,
  runBiquad,
  type Biquad,
} from "../dsp/bandbank.ts";
import { follow, followCoef, gateCurve, holdCurve } from "../dsp/follow.ts";
import { unit } from "../dsp/rng.ts";
import { at, VOCODER_BLOCK, type VocoderControl } from "./control.ts";
import { hissPath, unvoicedCurve } from "./detect.ts";

/** Fixed channel makeup from the layout only (fitted once on the voice fixture). */
export function channelMakeup(bands: number, width: number): number {
  return (
    (1.4 * (bands / 16) ** 0.29) / (width <= 1 ? width ** 0.35 : width ** 1.1)
  );
}

/** Reference band level for depth < 1: envelope^depth * REF^(1 - depth). */
const REF = 0.02;

/** A noise sample in -1..1 at an absolute song sample. */
export function noiseSample(seed: number, songSample: number): number {
  return unit(seed, songSample, 11) * 2 - 1;
}

/** Follower with an optional per-sample release curve and hold. */
function followVarying(
  x: Float64Array,
  attack: number,
  release: number,
  releaseCurve: Float64Array | undefined,
  sampleRate: number,
  hold?: Uint8Array,
): Float64Array {
  if (!releaseCurve) return follow(x, attack, release, sampleRate, hold);
  const a = followCoef(attack, sampleRate);
  const out = new Float64Array(x.length);
  let e = 0;
  let lastRelease = Number.NaN;
  let r = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (releaseCurve[i] !== lastRelease) {
      lastRelease = releaseCurve[i]!;
      r = followCoef(lastRelease, sampleRate);
    }
    if (!hold || hold[i] === 0) {
      const v = Math.abs(x[i]!);
      const c = v > e ? a : r;
      e = c * e + (1 - c) * v;
    }
    out[i] = e;
  }
  return out;
}

/** Runs a biquad whose coefficients may change at 32-sample blocks. */
function runBand(
  x: Float64Array,
  filter: Biquad,
  filterAt: ((i: number) => Biquad) | undefined,
): void {
  if (!filterAt) {
    runBiquad(filter, x);
    return;
  }
  let z1 = 0;
  let z2 = 0;
  let f = filterAt(0);
  for (let i = 0; i < x.length; i += 1) {
    if (i % VOCODER_BLOCK === 0) f = filterAt(i);
    const v = x[i]!;
    const y = f.b0 * v + z1;
    z1 = f.b1 * v - f.a1 * y + z2;
    z2 = f.b2 * v - f.a2 * y;
    x[i] = y;
  }
}

/**
 * Vocodes each carrier channel with `mod`. The modulator is read up to the
 * largest band advance past each output sample (zero past its end).
 * Returns the wet signal per channel, after `gain` and before the peak guard
 * and `mix` (`applyVocoderStage` adds those).
 */
export function channelVocode(
  mod: Float64Array,
  cars: readonly Float64Array[],
  control: VocoderControl,
): Float64Array[] {
  const { settings: p, sampleRate: sr, origin, seed } = control;
  const n = Math.min(mod.length, ...cars.map((c) => c.length));
  const { bands, ratio } = bankDesign(p, sr);
  const nb = bands.length;
  const widthCurve = control.curves.width;
  // Width automation re-designs the band filters per block.
  const designs = new Map<number, Biquad[]>();
  const filtersFor = (width: number): Biquad[] => {
    let known = designs.get(width);
    if (!known) {
      const octaves = Math.log2(ratio) * width * 1.55;
      known = bands.map((b) =>
        bandpass(Math.min(b.hz, 0.45 * sr), octaves, sr),
      );
      designs.set(width, known);
    }
    return known;
  };
  const filterAt = (k: number, offset: number) =>
    widthCurve
      ? (i: number): Biquad =>
          filtersFor(widthCurve[Math.min(n - 1, i + offset)]!)[k]!
      : undefined;
  const gate = gateCurve(mod.subarray(0, n), sr, control.gateDb);
  if (gate && control.hold) holdCurve(gate, control.hold);
  const unvoicedOn = p.unvoiced > 0 || control.curves.unvoiced !== undefined;
  const u = unvoicedOn
    ? unvoicedCurve(mod.subarray(0, n), sr, p.sens, origin, gate)
    : undefined;
  // Analysis: one envelope per band.
  const env: Float64Array[] = [];
  const band = new Float64Array(n);
  for (let k = 0; k < nb; k += 1) {
    const b = bands[k]!;
    if (!b.live) {
      env.push(new Float64Array(n));
      continue;
    }
    for (let i = 0; i < n; i += 1) {
      const j = i + b.advance;
      band[i] = j < mod.length ? mod[j]! : 0;
    }
    const f = filterAt(k, b.advance);
    runBand(band, b.filter, f);
    runBand(band, b.filter, f);
    const e = followVarying(
      band,
      p.attack,
      p.release,
      control.curves.release,
      sr,
      control.hold,
    );
    if (gate) for (let i = 0; i < n; i += 1) e[i] = e[i]! * gate[i]!;
    env.push(e);
  }
  const shiftOf = (i: number): number =>
    at(control, "formant", i) / 12 / Math.log2(ratio);
  const staticShift = control.curves.formant ? undefined : shiftOf(0);
  const synthEnv = (k: number, i: number): number => {
    const pos = k - (staticShift ?? shiftOf(i));
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    const a = i0 >= 0 && i0 < nb ? env[i0]![i]! : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < nb ? env[i0 + 1]![i]! : 0;
    return a * (1 - fr) + b * fr;
  };
  const scale = channelMakeup(p.bands, p.width);
  const depthCurve = control.curves.depth;
  const shape = (e: number, i: number): number => {
    const depth = depthCurve ? depthCurve[i]! : p.depth;
    return depth === 1 ? e : e ** depth * REF ** (1 - depth);
  };
  const hiss =
    p.hiss > 0 || control.curves.hiss ? hissPath(mod, n, sr) : undefined;
  const outs: Float64Array[] = [];
  for (const car of cars) {
    const carrier = car.slice(0, n);
    if (u) {
      const level = follow(carrier, 0.01, 0.1, sr);
      for (let i = 0; i < n; i += 1) {
        const w = u[i]! * at(control, "unvoiced", i);
        if (w <= 0) continue;
        const noise = noiseSample(seed, origin + i);
        carrier[i] =
          carrier[i]! * (1 - w) + noise * 1.7 * Math.max(level[i]!, 0.05) * w;
      }
    }
    const out = new Float64Array(n);
    const syn = new Float64Array(n);
    for (let k = 0; k < nb; k += 1) {
      const b = bands[k]!;
      if (!b.live) continue;
      syn.set(carrier);
      const f = filterAt(k, 0);
      runBand(syn, b.filter, f);
      runBand(syn, b.filter, f);
      if (p.enhance) {
        const ec = followVarying(
          syn,
          p.attack,
          p.release,
          control.curves.release,
          sr,
        );
        for (let i = 0; i < n; i += 1) {
          const g = shape(synthEnv(k, i), i) / (ec[i]! + 1e-5);
          out[i]! += syn[i]! * Math.min(g, 1e3) * scale;
        }
      } else
        for (let i = 0; i < n; i += 1)
          out[i]! += syn[i]! * shape(synthEnv(k, i), i) * 8 * scale;
    }
    if (hiss)
      for (let i = 0; i < n; i += 1)
        out[i]! += at(control, "hiss", i) * hiss[i]! * (gate ? gate[i]! : 1);
    outs.push(out);
  }
  return outs;
}
