import { describe, expect, test } from "bun:test";
import { fftInPlace } from "./fft.ts";
import {
  melody,
  synthVoice,
  vowels,
  type VoiceSignal,
} from "../fixtures/voice.ts";
import { centsOfHz, curveAt, curveToSamples, trackPitch } from "./pitch.ts";
import { constantShift, pitchMarks, psola, psolaStereo } from "./psola.ts";

/** Test 4 runs at both rates the brief names; mark sizes depend on the rate. */
const RATES = [22_050, 48_000] as const;

/** Long-term cepstrally smoothed envelope over voiced frames, dB. */
function envelopeDb(
  x: Float64Array,
  f0: Float64Array,
  SR: number,
): Float64Array {
  const N = SR > 30_000 ? 2048 : 1024;
  const acc = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= x.length; s += N / 4) {
    if (!(f0[s + N / 2]! > 0)) continue;
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k]! += re[k]! ** 2 + im[k]! ** 2;
    frames++;
  }
  for (let k = 0; k < N; k++) {
    const kk = k <= N / 2 ? k : N - k;
    re[k] = 0.5 * Math.log(Math.max(1e-20, acc[kk]! / Math.max(1, frames)));
    im[k] = 0;
  }
  fftInPlace(re, im, true);
  const L = Math.round(0.0015 * SR);
  for (let q = 0; q < N; q++) {
    const qq = q <= N / 2 ? q : N - q;
    const w = qq < L ? 1 : qq === L ? 0.5 : 0;
    re[q] = (re[q]! / N) * w;
    im[q] = (im[q]! / N) * w;
  }
  fftInPlace(re, im);
  const out = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) out[k] = (20 / Math.LN10) * re[k]!;
  return out;
}

function envelopeDistance(
  a: Float64Array,
  b: Float64Array,
  SR: number,
): number {
  const N = (a.length - 1) * 2;
  const k0 = Math.ceil((200 * N) / SR);
  const k1 = Math.floor((4000 * N) / SR);
  let mean = 0;
  for (let k = k0; k <= k1; k++) mean += a[k]! - b[k]!;
  mean /= k1 - k0 + 1;
  let s = 0;
  for (let k = k0; k <= k1; k++) s += (a[k]! - b[k]! - mean) ** 2;
  return Math.sqrt(s / (k1 - k0 + 1));
}

function resample(x: Float64Array, f0: Float64Array, r: number) {
  const n = Math.floor(x.length / r);
  const z = new Float64Array(n);
  const zf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r;
    const j = Math.floor(p);
    const u = p - j;
    z[i] = (x[j] ?? 0) * (1 - u) + (x[j + 1] ?? 0) * u;
    zf[i] = f0[j] ?? 0;
  }
  return { z, zf };
}

function shift(v: VoiceSignal, cents: number): Float64Array {
  const c = trackPitch(v.x, v.sr);
  return psola(
    v.x,
    v.sr,
    constantShift(curveToSamples(c, v.x.length, v.sr), cents),
  );
}

/** Median |cents| of the re-tracked output against the shifted truth. */
function retrackError(v: VoiceSignal, y: Float64Array, cents: number): number {
  const c = trackPitch(y, v.sr);
  const guard = Math.round(0.005 * v.sr);
  const errs: number[] = [];
  for (let f = 0; f < c.f0.length; f++) {
    const t = c.t0 + f * c.hop;
    const i = Math.round(t * v.sr);
    const truth = v.f0[i]! * 2 ** (cents / 1200);
    if (
      c.f0[f]! > 0 &&
      v.f0[i]! > 0 &&
      v.f0[i - guard]! > 0 &&
      v.f0[i + guard]! > 0
    )
      errs.push(Math.abs(centsOfHz(c.f0[f]!) - centsOfHz(truth)));
  }
  errs.sort((a, b) => a - b);
  return errs[errs.length >> 1]!;
}

for (const SR of RATES)
  describe(`psola at ${SR} Hz`, () => {
    const v = synthVoice(vowels(52), { sr: SR, seed: 41 });
    const envIn = envelopeDb(v.x, v.f0, SR);
    for (const st of [-7, -5, -2, 2, 5, 7, 12]) {
      test(`${st > 0 ? "+" : ""}${st} st keeps the envelope and lands on pitch`, () => {
        const y = shift(v, st * 100);
        expect(y.length).toBe(v.x.length);
        const env = envelopeDistance(envIn, envelopeDb(y, v.f0, SR), SR);
        const { z, zf } = resample(v.x, v.f0, 2 ** (st / 12));
        const naive = envelopeDistance(envIn, envelopeDb(z, zf, SR), SR);
        expect(env).toBeLessThanOrEqual(2);
        expect(env).toBeLessThanOrEqual(0.5 * naive);
        expect(retrackError(v, y, st * 100)).toBeLessThanOrEqual(8);
      });
    }

    test("is deterministic", () => {
      const a = shift(v, 300);
      const b = shift(v, 300);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    });

    test("inverted and all-pass voices shift as well as the clean one", () => {
      const song = melody(57);
      const clean = synthVoice(song, { sr: SR, seed: 9 });
      const base = retrackError(clean, shift(clean, 500), 500);
      for (const opts of [{ invert: true }, { allpass: true }]) {
        const w = synthVoice(song, { sr: SR, seed: 9, ...opts });
        expect(
          Math.abs(retrackError(w, shift(w, 500), 500) - base),
        ).toBeLessThanOrEqual(1);
      }
    });

    test("marks follow the run's polarity", () => {
      const clean = synthVoice(melody(57).slice(0, 2), { sr: SR, seed: 9 });
      const inv = synthVoice(melody(57).slice(0, 2), {
        sr: SR,
        seed: 9,
        invert: true,
      });
      const f0 = curveToSamples(trackPitch(clean.x, SR), clean.x.length, SR);
      const a = pitchMarks(clean.x, SR, f0);
      const b = pitchMarks(inv.x, SR, f0);
      // inverted input: marks land on the same (now negative) peaks
      expect([...b]).toEqual([...a]);
    });

    test("unity shift leaves breath and fry tails without added buzz", () => {
      const w = synthVoice(melody(57).slice(0, 3), {
        sr: SR,
        seed: 4,
        breath: 0.03,
        fry: 0.6,
      });
      const c = trackPitch(w.x, SR);
      const y = psola(
        w.x,
        SR,
        constantShift(curveToSamples(c, w.x.length, SR), 0),
      );
      let num = 0;
      let den = 0;
      for (let i = 0; i < w.x.length; i++) {
        num += (y[i]! - w.x[i]!) ** 2;
        den += w.x[i]! ** 2;
      }
      // ratio 1 rebuilds the input: residual under -40 dB
      expect(10 * Math.log10(num / den)).toBeLessThanOrEqual(-40);
    });

    test("stereo shares one set of marks and keeps L/R apart", () => {
      const w = synthVoice(melody(57).slice(0, 2), {
        sr: SR,
        seed: 2,
        stereo: true,
      });
      const left = w.x;
      const right = w.right!;
      const f0 = curveToSamples(trackPitch(left, SR), left.length, SR);
      const curve = constantShift(f0, 400);
      const [l, r] = psolaStereo(left, right, SR, curve);
      const mid = left.map((x, i) => 0.5 * (x + right[i]!));
      const marks = pitchMarks(mid, SR, f0);
      expect([...l]).toEqual([...psola(left, SR, curve, { marks })]);
      expect([...r]).toEqual([...psola(right, SR, curve, { marks })]);
      expect([...l]).not.toEqual([...r]);
    });

    test("formant factor moves the envelope; offset and length window the output", () => {
      const c = trackPitch(v.x, SR);
      const curve = constantShift(curveToSamples(c, v.x.length, SR), 0);
      const up = psola(v.x, SR, curve, { formant: 1.25 });
      const kept = envelopeDistance(
        envIn,
        envelopeDb(psola(v.x, SR, curve), v.f0, SR),
        SR,
      );
      expect(
        envelopeDistance(envIn, envelopeDb(up, v.f0, SR), SR),
      ).toBeGreaterThan(kept + 1);
      const whole = psola(v.x, SR, constantShift(curve.f0, 300));
      const part = psola(v.x, SR, constantShift(curve.f0, 300), {
        offset: SR,
        length: SR / 2,
      });
      expect(part.length).toBe(SR / 2);
      let d = 0;
      for (let i = SR / 10; i < (SR * 2) / 5; i++)
        d = Math.max(d, Math.abs(part[i]! - whole[SR + i]!));
      expect(d).toBeLessThan(1e-9);
      expect(curveAt(c, -1)).toBe(0);
    });
  });
