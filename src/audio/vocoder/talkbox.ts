/**
 * The LPC talkbox (0.7, after mda Talkbox): per 20 ms sqrt-Hann frame at
 * 50 % overlap, the modulator's spectral envelope (Levinson-Durbin, order
 * round(sr / 2000), pre-emphasised) filters the pre-whitened carrier. Frames
 * sit on the absolute song grid. Formant shift resamples the analysis frame
 * (±12 st) and a per-frame energy normaliser, measured after de-emphasis,
 * keeps the frame at the unshifted modulator frame's energy.
 */
import { gateCurve, holdCurve } from "../dsp/follow.ts";
import { autocorrelate, levinson } from "../dsp/lpc.ts";
import { TALKBOX_FORMANT_MAX } from "../../../core/vocoder.ts";
import { noiseSample } from "./bank.ts";
import type { VocoderControl } from "./control.ts";
import { at } from "./control.ts";
import { hissPath, unvoicedCurve } from "./detect.ts";

/** Fixed talkbox makeup (measured once on the voice fixture). */
export const TALKBOX_MAKEUP = 0.97;

const posMod = (a: number, m: number): number => ((a % m) + m) % m;

export function talkboxVocode(
  mod: Float64Array,
  cars: readonly Float64Array[],
  control: VocoderControl,
): Float64Array[] {
  const { settings: p, sampleRate: sr, origin, seed } = control;
  const n = Math.min(mod.length, ...cars.map((c) => c.length));
  const N = 2 * Math.round(0.01 * sr);
  const hop = N / 2;
  const order = Math.max(8, Math.round(sr / 2000));
  const corder = 12;
  const win = new Float64Array(N);
  const sq = new Float64Array(N);
  for (let i = 0; i < N; i += 1) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    sq[i] = Math.sqrt(win[i]!);
  }
  const acc = cars.map(() => new Float64Array(n + N));
  const pre = new Float64Array(n);
  for (let i = 0; i < n; i += 1)
    pre[i] = mod[i]! - 0.97 * (i > 0 ? mod[i - 1]! : 0);
  const mf = new Float64Array(N);
  const cf = new Float64Array(N);
  const y = new Float64Array(N);
  const r = new Float64Array(order + 1);
  const a = new Float64Array(order + 1);
  const rc = new Float64Array(corder + 1);
  const ac = new Float64Array(corder + 1);
  const gate = gateCurve(mod.subarray(0, n), sr, control.gateDb);
  if (gate && control.hold) holdCurve(gate, control.hold);
  const unvoicedOn = p.unvoiced > 0 || control.curves.unvoiced !== undefined;
  const u = unvoicedOn
    ? unvoicedCurve(mod.subarray(0, n), sr, p.sens, origin, gate)
    : undefined;
  let heldMe0 = 0;
  for (let start = -posMod(origin, hop) - hop; start < n; start += hop) {
    const centre = Math.min(n - 1, Math.max(0, start + hop));
    const st = Math.max(
      -TALKBOX_FORMANT_MAX,
      Math.min(TALKBOX_FORMANT_MAX, at(control, "formant", centre)),
    );
    const shift = 2 ** (st / 12);
    // freeze: a held frame reuses the last analysed filter and level
    const held = heldMe0 > 0 && control.hold?.[centre] === 1;
    let me = held ? 1 : 0;
    let me0 = held ? heldMe0 : 0;
    for (let i = 0; !held && i < N; i += 1) {
      const j = start + i;
      const jj = start + hop + (i - hop) * shift;
      const k0 = Math.floor(jj);
      const fr = jj - k0;
      const m =
        k0 >= 0 && k0 + 1 < n ? pre[k0]! * (1 - fr) + pre[k0 + 1]! * fr : 0;
      const g = gate && j >= 0 && j < n ? gate[j]! : 1;
      mf[i] = m * win[i]! * g;
      me += mf[i]! * mf[i]!;
      const raw = (j >= 0 && j < n ? mod[j]! : 0) * win[i]! * g;
      me0 += raw * raw;
    }
    if (me < 1e-10 || me0 < 1e-10) continue;
    if (!held) {
      levinson(autocorrelate(mf, order, r, sr), order, a);
      heldMe0 = me0;
    }
    for (let c = 0; c < cars.length; c += 1) {
      const car = cars[c]!;
      for (let i = 0; i < N; i += 1) {
        const j = start + i;
        let v = j >= 0 && j < n ? car[j]! : 0;
        if (u && j >= 0 && j < n) {
          const w = u[j]! * at(control, "unvoiced", j);
          v = v * (1 - w) + noiseSample(seed, origin + j) * 0.5 * w;
        }
        cf[i] = v * sq[i]!;
      }
      if (p.enhance) {
        levinson(autocorrelate(cf, corder, rc, sr), corder, ac);
        for (let i = N - 1; i >= 0; i -= 1) {
          let s = cf[i]!;
          for (let j = 1; j <= corder && j <= i; j += 1)
            s += ac[j]! * cf[i - j]!;
          cf[i] = s;
        }
      }
      let ce = 0;
      for (let i = 0; i < N; i += 1) ce += cf[i]! * cf[i]!;
      if (ce <= 1e-12) continue;
      for (let i = 0; i < N; i += 1) {
        let s = cf[i]!;
        for (let j = 1; j <= order && j <= i; j += 1) s -= a[j]! * y[i - j]!;
        y[i] = s;
      }
      let ye = 0;
      let de = 0;
      for (let i = 0; i < N; i += 1) {
        de = y[i]! * sq[i]! + 0.97 * de;
        const v = de * sq[i]!;
        ye += v * v;
      }
      const g = ye > 1e-20 ? Math.sqrt(me0 / ye) * TALKBOX_MAKEUP : 0;
      const o = acc[c]!;
      for (let i = 0; i < N; i += 1) {
        const j = start + i;
        if (j >= 0) o[j]! += y[i]! * sq[i]! * g;
      }
    }
  }
  const hiss =
    p.hiss > 0 || control.curves.hiss ? hissPath(mod, n, sr) : undefined;
  return acc.map((o) => {
    const res = new Float64Array(n);
    let dd = 0;
    for (let i = 0; i < n; i += 1) {
      dd = o[i]! + 0.97 * dd;
      res[i] = dd;
    }
    if (hiss)
      for (let i = 0; i < n; i += 1)
        res[i]! += at(control, "hiss", i) * hiss[i]! * (gate ? gate[i]! : 1);
    return res;
  });
}
