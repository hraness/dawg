import { describe, expect, test } from "bun:test";
import { fftInPlace } from "./fft.ts";
import { cepstralEnvelope } from "./envelope.ts";
import { pitchShift } from "./shift.ts";

const SR = 22050;

/**
 * A vowel-like tone (F1 700, F2 1800, F3 2800 Hz) with formants wide enough
 * that harmonic sampling can locate their peaks (after the prototype's
 * `vowel`).
 */
function vowel(f0: number, seconds: number): Float64Array {
  const formants = [
    [700, 200, 1],
    [1800, 250, 0.5],
    [2800, 300, 0.25],
  ] as const;
  const x = new Float64Array(Math.round(seconds * SR));
  for (let h = 1; h * f0 < 0.45 * SR; h += 1) {
    const f = h * f0;
    let a = 0;
    for (const [fc, bw, g] of formants) a += g / (1 + ((f - fc) / bw) ** 2);
    a = (0.05 * (a + 0.01)) / Math.sqrt(h);
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < x.length; i += 1) x[i] = x[i]! + a * Math.sin(w * i);
  }
  return x;
}

function spectrum(x: ArrayLike<number>, from: number, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1)
    re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fftInPlace(re, im);
  const m = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k += 1) m[k] = Math.hypot(re[k]!, im[k]!);
  return m;
}

/** FFT peak near `expected` with parabolic interpolation on log magnitude. */
function measureF0(x: ArrayLike<number>, expected: number): number {
  const n = 16384;
  const m = spectrum(x, Math.round(0.3 * SR), n);
  const lo = Math.floor((expected * 2 ** (-1 / 12) * n) / SR);
  const hi = Math.ceil((expected * 2 ** (1 / 12) * n) / SR);
  let k = lo;
  for (let i = lo; i <= hi; i += 1) if (m[i]! > m[k]!) k = i;
  const a = Math.log(m[k - 1]! + 1e-12);
  const b = Math.log(m[k]! + 1e-12);
  const c = Math.log(m[k + 1]! + 1e-12);
  return ((k + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / n;
}

/**
 * First-formant position from the harmonic amplitudes: the power-weighted
 * mean frequency of the harmonics between `lo` and `hi` (robust where a
 * peak pick over three harmonics is not).
 */
function formantPeak(
  x: ArrayLike<number>,
  f0: number,
  lo: number,
  hi: number,
): number {
  const n = 16384;
  const m = spectrum(x, Math.round(0.3 * SR), n);
  let num = 0;
  let den = 0;
  for (let h = Math.ceil(lo / f0); h * f0 <= hi; h += 1) {
    const k = Math.round((h * f0 * n) / SR);
    let v = 0;
    for (let j = k - 3; j <= k + 3; j += 1) v = Math.max(v, m[j] ?? 0);
    num += h * f0 * v * v;
    den += v * v;
  }
  return num / den;
}

const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);

describe("pitchShift", () => {
  test("+7 st lands within 1 cent and keeps the length", () => {
    const x = vowel(220, 1.5);
    const y = pitchShift(x, SR, 7);
    expect(y.length).toBe(x.length);
    const want = 220 * 2 ** (7 / 12);
    expect(Math.abs(cents(measureF0(y, want), want))).toBeLessThan(1);
  });

  test("-5 st lands within 1 cent", () => {
    const x = vowel(330, 1.5);
    const want = 330 * 2 ** (-5 / 12);
    const y = pitchShift(x, SR, -5);
    expect(Math.abs(cents(measureF0(y, want), want))).toBeLessThan(1);
  });

  test("formant 0 keeps the first formant within 3%; absent moves it", () => {
    // Low and high voices (the harmonic spacing at 330 Hz is half F1).
    const cases = [
      [110, 7],
      [110, -7],
      [110, 12],
      [165, 7],
      [165, -7],
      [165, 12],
      [220, 7],
      [220, -7],
      [220, 12],
      [330, 7],
      [330, -7],
    ] as const;
    for (const [f0, st] of cases) {
      const x = vowel(f0, 2);
      const want = f0 * 2 ** (st / 12);
      // The reference: the same vowel sung at the new pitch.
      const ideal = formantPeak(vowel(want, 2), want, 400, 1200);
      const kept = pitchShift(x, SR, st, { formant: 0 });
      expect(Math.abs(cents(measureF0(kept, want), want))).toBeLessThan(1);
      expect(
        Math.abs(formantPeak(kept, want, 400, 1200) / ideal - 1),
      ).toBeLessThan(0.03);
      if (f0 === 110 && st === 7) {
        const moved = pitchShift(x, SR, st);
        expect(formantPeak(moved, want, 400, 1600) / ideal).toBeGreaterThan(
          1.2,
        );
      }
    }
  });

  test("0 st and no formant is a copy; output is deterministic", () => {
    const x = vowel(220, 0.5);
    const copy = pitchShift(x, SR, 0);
    expect(Array.from(copy.slice(0, 10))).toEqual(
      Array.from(Float32Array.from(x.slice(0, 10))),
    );
    const a = pitchShift(x, SR, 3, { formant: 0 });
    const b = pitchShift(x, SR, 3, { formant: 0 });
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });
});

describe("cepstralEnvelope", () => {
  test("is smooth over harmonics and peaks at the formant", () => {
    const n = 2048;
    const x = vowel(110, 0.5);
    const m = spectrum(x, 2000, n);
    const env = new Float64Array(n / 2 + 1);
    cepstralEnvelope(m, n, Math.round(0.002 * SR), env);
    let k = 1;
    const lo = Math.round((300 * n) / SR);
    const hi = Math.round((1000 * n) / SR);
    for (let i = lo; i <= hi; i += 1) if (env[i]! > env[k]! || k < lo) k = i;
    expect(Math.abs((k * SR) / n - 700)).toBeLessThan(150);
  });
});
