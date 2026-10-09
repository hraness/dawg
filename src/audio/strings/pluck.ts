/**
 * A plucked or struck string: a single-delay-loop waveguide (Karplus-Strong
 * as extended by Jaffe and Smith 1983), ported from the 0.6 strings
 * prototype. The loop holds an integer delay, an exact first-order Thiran
 * fraction, a two-decay loss filter, an optional dispersion cascade
 * (stiffness) and an optional jawari bridge (sitar, tanpura buzz).
 *
 * Jawari (strings review, dsp blocker #2): the bridge is a lattice
 * first-order allpass whose delay shortens with the string's one-sided
 * displacement max(0, y - profile). An allpass has magnitude exactly 1 at
 * every coefficient, so the buzz moves energy upward without adding DC; an
 * in-loop DC blocker removes what the time-varying delay leaves. The pitch
 * lock retunes the main fraction for the mean shortening, so a buzzing note
 * stays on its target Hz.
 */
import { allpassDelay, thiranFor } from "../dsp/interp.ts";
import { unit } from "../dsp/rng.ts";
import {
  clamp,
  designDispersion,
  designLoss,
  onePoleDelay,
  stiffnessB,
} from "./loop.ts";

export const C4 = 261.6255653005986;
/** Control-rate step for pitch moves, the same as dawg's lanes. */
const CONTROL = 32;
/** Jawari bridge segment: rest length in samples and the shortest. */
const JAW_BASE = 1.5;
const JAW_SHORTEST = 0.5;

/** Phase delay (samples) at w of the DC blocker (1 - z^-1)/(1 - R z^-1). */
function dcBlockDelay(R: number, w: number): number {
  if (w < 1e-9) return 0;
  const zero = Math.atan2(Math.sin(w), 1 - Math.cos(w));
  const pole = Math.atan2(R * Math.sin(w), 1 - R * Math.cos(w));
  return -(zero - pole) / w;
}

export type Exciter = "pick" | "finger" | "hammer" | "noise";

/** Resolved plucked-string parameters for one note. */
export type PluckSpec = Readonly<{
  /** T60 (s) of the fundamental at C4. */
  decay: number;
  /** Decay key tracking: T60 x (f/C4)^-track. */
  track: number;
  /** 0..1 high-frequency loss. */
  damp: number;
  /** Stiffness knob; inharmonicity B = 1e-6 x 400^stiff. */
  stiff: number;
  /** Pluck position, fraction of the string from the bridge. */
  pos: number;
  exciter: Exciter;
  /** 0..1 excitation brightness at full velocity. */
  bright: number;
  /** 0..1 noise share of the excitation. */
  noise: number;
  /** T60 (s) after note-off. */
  release: number;
  /** 0..1 bridge buzz. */
  jawari: number;
  /** 0 = bridge force; else magnetic pickup position (fraction). */
  pickup: number;
}>;

export type PluckNote = Readonly<{
  /** noteHz(pitch, cents, table) from the 0.5 tunings. */
  hz: number;
  /** 0..1 after the velocity curve and the preset's sensitivity. */
  velocity: number;
  /** Seconds to note-off (after articulation and pedal). */
  hold: number;
  /** Seed for the excitation noise (counter-based, src/audio/dsp/rng.ts). */
  seed: number;
  /** Pitch offset in cents at `t` seconds (bend, glide, vibrato). */
  cents?: (t: number) => number;
}>;

function minHz(note: PluckNote, seconds: number): number {
  let lo = note.hz;
  if (note.cents)
    for (let t = 0; t <= seconds; t += 0.01)
      lo = Math.min(lo, note.hz * 2 ** (note.cents(t) / 1200));
  return lo;
}

/** One plucked or struck string, streamed in blocks. */
export class PluckString {
  private readonly buf: Float64Array;
  private readonly mask: number;
  private w = 0;
  private N = 1;
  private a = 0;
  private tx1 = 0;
  private ty1 = 0;
  private readonly lg: number;
  private readonly lp: number;
  private ly = 0;
  private readonly da: number;
  private readonly dn: number;
  private readonly dx: Float64Array;
  private readonly dy: Float64Array;
  private readonly jaw: number;
  private jv = 0;
  private jsum = 0;
  private jcount = 0;
  private jmean = 0;
  private hz: number;
  private readonly dcR: number;
  private dcx = 0;
  private dcy = 0;
  private readonly exc: Float64Array;
  private n = 0;
  /** Sample index of note-off; a restrike or steal moves it earlier. */
  offAt: number;
  private readonly rel: number;
  private readonly pickupTap: number;
  private readonly base: number;
  private quiet = 0;
  done = false;

  constructor(
    readonly spec: PluckSpec,
    readonly note: PluckNote,
    readonly sr: number,
    readonly maxSeconds = 12,
  ) {
    const f0 = note.hz;
    const t0 = spec.decay * (f0 / C4) ** -spec.track;
    const th = t0 / (1 + 99 * spec.damp * spec.damp);
    // The high decay point sits at least 3 f0 up, so a high note's loss
    // filter is not fitted between its own first partials (T60 accuracy).
    const loss = designLoss(f0, t0, Math.max(3000, 3 * f0), th, sr);
    this.lg = loss.g;
    this.lp = loss.p;
    const P = sr / f0;
    this.jaw = spec.jawari;
    this.base = spec.jawari > 0 ? JAW_BASE : 0;
    this.dcR = spec.jawari > 0 ? Math.exp((-2 * Math.PI * 10) / sr) : 0;
    const B = stiffnessB(spec.stiff);
    const sections = B > 0 ? 4 : 0;
    const w0 = (2 * Math.PI * f0) / sr;
    this.dn = sections;
    this.da = designDispersion(
      f0,
      B,
      sections,
      sr,
      Math.max(0, P - 2.5 - onePoleDelay(this.lp, w0) - this.base),
    );
    this.dx = new Float64Array(sections);
    this.dy = new Float64Array(sections);
    const lowest = minHz(note, note.hold + spec.release);
    let size = 16;
    while (size < sr / lowest + 16) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
    this.hz = f0;
    this.retune(f0, true);
    this.exc = excitation(spec, note, sr, P);
    this.offAt = Math.round(note.hold * sr);
    this.rel = 0.001 ** (1 / (Math.max(0.005, spec.release) * sr));
    this.pickupTap =
      spec.pickup > 0 ? Math.max(1, Math.round(spec.pickup * P)) : 0;
  }

  /** Loop delay for `hz`: integer N plus an exact Thiran fraction. */
  private retune(hz: number, first = false): void {
    const sr = this.sr;
    this.hz = hz;
    const w0 = (2 * Math.PI * hz) / sr;
    let rest = sr / hz - onePoleDelay(this.lp, w0);
    if (this.jaw > 0) {
      // Pitch lock: the bridge allpass at its mean shortening and the
      // in-loop DC blocker are both counted in the loop length.
      const frac = this.base - this.jmean;
      rest -= allpassDelay((1 - frac) / (1 + frac), w0);
      rest -= dcBlockDelay(this.dcR, w0);
    }
    if (this.dn > 0) rest -= this.dn * allpassDelay(this.da, w0);
    const N = Math.max(1, Math.floor(rest - 0.5));
    const D = clamp(rest - N, 0.5, 1.5);
    const a = thiranFor(D, w0);
    if (!first && N !== this.N) {
      // Restate the allpass memory for the new read position.
      const m = this.mask;
      this.tx1 = this.buf[(this.w - 1 - N) & m]!;
      const pos = this.w - 1 - N - D;
      const i0 = Math.floor(pos);
      const fr = pos - i0;
      this.ty1 = this.buf[i0 & m]! * (1 - fr) + this.buf[(i0 + 1) & m]! * fr;
    }
    this.N = N;
    this.a = a;
  }

  /** Moves note-off to `at` samples from the string's start (restrike, steal). */
  releaseAt(at: number): void {
    if (at < this.offAt) this.offAt = Math.max(this.n, at);
  }

  /**
   * Adds `count` samples x `gain` into out[offset..] (and x `gainR` into
   * `right` when given); returns false once silent.
   */
  process(
    out: Float64Array,
    offset: number,
    count: number,
    gain = 1,
    right?: Float64Array,
    gainR = 0,
  ): boolean {
    if (this.done) return false;
    const { buf, mask, lp, exc, dx, dy, da, dn, jaw } = this;
    const lgain = this.lg * (1 - lp);
    const cents = this.note.cents;
    const sr = this.sr;
    let peak = 0;
    for (let i = 0; i < count; i += 1) {
      const n = this.n;
      if (n % CONTROL === 0 && (cents || jaw > 0)) {
        if (jaw > 0 && this.jcount > 0) {
          // Mean bridge shortening over the last control block (pitch lock).
          this.jmean += 0.25 * (this.jsum / this.jcount - this.jmean);
          this.jsum = 0;
          this.jcount = 0;
        }
        this.retune(
          cents ? this.note.hz * 2 ** (cents(n / sr) / 1200) : this.hz,
        );
      }
      const d = buf[(this.w - this.N) & mask]!;
      const t = this.a * d + this.tx1 - this.a * this.ty1;
      this.tx1 = d;
      this.ty1 = t;
      this.ly = lgain * t + lp * this.ly;
      let s = this.ly;
      for (let k = 0; k < dn; k += 1) {
        const y = da * s + dx[k]! - da * dy[k]!;
        dx[k] = s;
        dy[k] = y;
        s = y;
      }
      if (jaw > 0) {
        // Bridge: a lattice allpass whose delay shortens with the
        // one-sided displacement (bridge profile at rest = 0).
        const short = Math.min(
          JAW_BASE - JAW_SHORTEST,
          jaw * 40 * Math.max(0, s),
        );
        this.jsum += short;
        this.jcount += 1;
        const frac = JAW_BASE - short;
        const k = (1 - frac) / (1 + frac);
        // Lattice form of (k + z^-1)/(1 + k z^-1): |H| = 1 for any k(n).
        const y = k * s + this.jv;
        this.jv = s - k * y;
        // In-loop DC blocker (10 Hz).
        const blocked = y - this.dcx + this.dcR * this.dcy;
        this.dcx = y;
        this.dcy = blocked;
        s = blocked;
      }
      if (n >= this.offAt) {
        const ramp = Math.min(1, (n - this.offAt) / (0.005 * sr));
        s *= 1 - (1 - this.rel) * ramp;
      }
      const x = n < exc.length ? exc[n]! : 0;
      const y = x + s;
      buf[this.w & mask] = y;
      const o = this.pickupTap ? y - buf[(this.w - this.pickupTap) & mask]! : y;
      this.w += 1;
      this.n += 1;
      out[offset + i] = out[offset + i]! + gain * o;
      if (right) right[offset + i] = right[offset + i]! + gainR * o;
      const ay = Math.abs(y);
      if (ay > peak) peak = ay;
    }
    // Tail limit: after note-off, stop once 2048 samples stay below -100 dBFS.
    if (this.n > this.offAt && peak < 1e-5) {
      this.quiet += count;
      if (this.quiet >= 2048) this.done = true;
    } else this.quiet = 0;
    if (this.n >= this.maxSeconds * sr) this.done = true;
    return !this.done;
  }
}

/**
 * Excitation: a raised-cosine pulse (pick, finger, hammer) or noise,
 * shaped by the pluck-position comb (Jaffe and Smith 1983) and a velocity
 * brightness low-pass, normalised to a loop RMS of 0.25 x velocity gain.
 */
function excitation(
  spec: PluckSpec,
  note: PluckNote,
  sr: number,
  P: number,
): Float64Array {
  const vel = clamp(note.velocity, 0, 1);
  const b = clamp(spec.bright * (0.3 + 0.7 * vel), 0, 1);
  const lerp = (x: number, y: number) => x + (y - x) * b;
  const width =
    spec.exciter === "pick"
      ? lerp(1.2e-3, 0.1e-3)
      : spec.exciter === "finger"
        ? lerp(5e-3, 0.9e-3)
        : spec.exciter === "hammer"
          ? lerp(4e-3, 0.3e-3)
          : P / sr;
  const L = Math.max(
    2,
    Math.min(
      Math.round(width * sr),
      Math.round(spec.exciter === "noise" ? P : 0.6 * P),
    ),
  );
  const M = Math.max(1, Math.round(spec.pos * P));
  const len = L + M + 1;
  const raw = new Float64Array(len);
  const noisy = spec.exciter === "noise";
  for (let i = 0; i < L; i += 1) {
    const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L);
    const pulse = noisy ? 0 : env;
    const r = 2 * unit(note.seed, i, 0) - 1;
    raw[i] = pulse * (1 - spec.noise) + (noisy ? 1 : spec.noise) * env * r;
  }
  const e = new Float64Array(len);
  for (let i = 0; i < len; i += 1) e[i] = raw[i]! - (i >= M ? raw[i - M]! : 0);
  // Velocity brightness: one-pole low-pass 300 Hz .. 13.6 kHz.
  const fc = Math.min(0.45 * sr, 300 * 2 ** (5.5 * b));
  const al = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  let energy = 0;
  for (let i = 0; i < len; i += 1) {
    y += al * (e[i]! - y);
    e[i] = y;
    energy += y * y;
  }
  const gain = (0.25 * (0.15 + 0.85 * vel)) / Math.sqrt(energy / P + 1e-30);
  for (let i = 0; i < len; i += 1) e[i] = e[i]! * gain;
  return e;
}
