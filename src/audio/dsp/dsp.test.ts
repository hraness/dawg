import { describe, expect, test } from "bun:test";
import { fftInPlace } from "./fft.ts";
import { Biquad, DcBlock, OnePole } from "./filters.ts";
import { FracDelay, allpassDelay, hermiteAt, thiranFor } from "./interp.ts";
import {
  Decimate2,
  Oversample2x,
  Oversample4x,
  halfbandTaps,
} from "./oversample.ts";
import { seedHash, seededRandom, unit } from "./rng.ts";
import { adaaAsym, adaaHardclip, adaaTanh, asym, hardclip } from "./shape.ts";
import { seededRandom as legacyRandom } from "../random.ts";

/** |H(f)| of an FIR at f cycles per sample. */
function response(taps: Float64Array, f: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < taps.length; n += 1) {
    re += taps[n]! * Math.cos(2 * Math.PI * f * n);
    im -= taps[n]! * Math.sin(2 * Math.PI * f * n);
  }
  return Math.hypot(re, im);
}

function worstDb(taps: Float64Array, from: number, to: number): number {
  let worst = -Infinity;
  for (let f = from; f <= to; f += 0.0002)
    worst = Math.max(worst, 20 * Math.log10(response(taps, f)));
  return worst;
}

/** Largest non-harmonic bin relative to the 5 kHz fundamental, in dB. */
function aliasDb(process: (x: number) => number, sampleRate: number): number {
  const size = 16384;
  const skip = 2000;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let n = 0; n < size + skip; n += 1) {
    const y = process(0.9 * Math.sin((2 * Math.PI * 5000 * n) / sampleRate));
    if (n < skip) continue;
    const i = n - skip;
    // 4-term Blackman-Harris: sidelobes below -92 dB.
    const w =
      0.35875 -
      0.48829 * Math.cos((2 * Math.PI * i) / size) +
      0.14128 * Math.cos((4 * Math.PI * i) / size) -
      0.01168 * Math.cos((6 * Math.PI * i) / size);
    re[i] = y * w;
  }
  fftInPlace(re, im);
  const mag = (k: number): number => Math.hypot(re[k]!, im[k]!);
  const f0 = Math.round((5000 * size) / sampleRate);
  let peak = 0;
  for (let k = f0 - 6; k <= f0 + 6; k += 1) peak = Math.max(peak, mag(k));
  let worst = 0;
  for (let k = 10; k < size / 2; k += 1) {
    // Odd harmonics of 5 kHz above 11.025 kHz can only arrive as aliases.
    if (Math.abs(k - f0) <= 12) continue;
    worst = Math.max(worst, mag(k));
  }
  return 20 * Math.log10(worst / peak);
}

const drive = (x: number): number => Math.tanh(4 * x);

describe("half-band oversampling", () => {
  test("127-tap Kaiser b10 stopband is at or below -90 dB", () => {
    const taps = halfbandTaps(127, 10);
    expect(worstDb(taps, 0.275, 0.5)).toBeLessThanOrEqual(-90);
    expect(response(taps, 0)).toBeCloseTo(1, 5);
    expect(response(taps, 0.25)).toBeCloseTo(0.5, 5);
  });

  test("47-tap Kaiser b8 reaches -80 dB well above the band edge", () => {
    const taps = halfbandTaps();
    expect(taps.length).toBe(47);
    expect(worstDb(taps, 0.33, 0.5)).toBeLessThanOrEqual(-80);
    expect(Math.abs(20 * Math.log10(response(taps, 0.1)))).toBeLessThan(0.01);
    // Even offsets from the centre are exact zeros.
    expect(taps[23 + 2]).toBe(0);
    expect(taps[23 - 4]).toBe(0);
  });

  test("Oversample4x keeps a 5 kHz tanh drive's aliases at or below -60 dB at 22.05 kHz", () => {
    const naive = aliasDb(drive, 22050);
    const two = new Oversample2x();
    const four = new Oversample4x();
    const twice = aliasDb((x) => two.process(x, drive), 22050);
    const quad = aliasDb((x) => four.process(x, drive), 22050);
    expect(naive).toBeGreaterThan(-20);
    expect(twice).toBeLessThan(naive);
    expect(quad).toBeLessThanOrEqual(-60);
  });

  test("identity through the oversampler is a pure delay at unity gain", () => {
    const os = new Oversample2x();
    const out: number[] = [];
    for (let n = 0; n < 400; n += 1)
      out.push(
        os.process(Math.sin((2 * Math.PI * 1000 * n) / 44100), (x) => x),
      );
    const lag = Oversample2x.latency();
    for (let n = 200; n < 400; n += 1)
      expect(out[n]!).toBeCloseTo(
        Math.sin((2 * Math.PI * 1000 * (n - lag)) / 44100),
        3,
      );
  });

  test("Decimate2 keeps a low tone and rejects one above the new Nyquist", () => {
    const level = (hz: number): number => {
      const dec = new Decimate2();
      let peak = 0;
      for (let n = 0; n < 4000; n += 1) {
        const a = Math.sin((2 * Math.PI * hz * 2 * n) / 44100);
        const b = Math.sin((2 * Math.PI * hz * (2 * n + 1)) / 44100);
        const y = dec.process(a, b);
        if (n > 200) peak = Math.max(peak, Math.abs(y));
      }
      return peak;
    };
    expect(level(1000)).toBeCloseTo(1, 2);
    expect(20 * Math.log10(level(16000))).toBeLessThan(-70);
  });
});

describe("ADAA shapers", () => {
  test("continuous across the small-step fallback and close to the static curve", () => {
    for (const make of [adaaTanh, adaaHardclip, () => adaaAsym(0.3)]) {
      // A step just above and just below the 1e-5 threshold agrees.
      const above = make();
      above.process(0.5);
      const a = above.process(0.5 + 1.0001e-5);
      const below = make();
      below.process(0.5);
      const b = below.process(0.5 + 0.9999e-5);
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
    const shaper = adaaTanh();
    let previous = shaper.process(0);
    let jump = 0;
    for (let n = 1; n < 2000; n += 1) {
      const x = 3 * Math.sin((2 * Math.PI * n) / 2000);
      const y = shaper.process(x);
      jump = Math.max(jump, Math.abs(y - previous));
      previous = y;
      // A slow input tracks the static curve at the half-sample midpoint.
      const mid = 3 * Math.sin((2 * Math.PI * (n - 0.5)) / 2000);
      expect(Math.abs(y - Math.tanh(mid))).toBeLessThan(1e-3);
    }
    expect(jump).toBeLessThan(0.02);
  });

  test("silence stays silent and the static curves are right", () => {
    expect(adaaTanh().process(0)).toBe(0);
    expect(adaaHardclip().process(0)).toBe(0);
    expect(Math.abs(adaaAsym().process(0))).toBeLessThan(1e-12);
    expect(hardclip(2)).toBe(1);
    expect(hardclip(-2)).toBe(-1);
    expect(asym(0)).toBe(0);
    expect(asym(5)).toBeLessThan(1 - Math.tanh(0.3) + 1e-9);
  });
});

describe("fractional delay", () => {
  test("Thiran FracDelay group delay is within 0.01 sample", () => {
    for (const delay of [0.6, 1.25, 3.5, 10.3, 57.77]) {
      const line = new FracDelay(128, delay);
      const impulse = new Float64Array(4096);
      for (let n = 0; n < impulse.length; n += 1)
        impulse[n] = line.process(n === 0 ? 1 : 0);
      const phase = (w: number): number => {
        let re = 0;
        let im = 0;
        for (let n = 0; n < impulse.length; n += 1) {
          re += impulse[n]! * Math.cos(w * n);
          im -= impulse[n]! * Math.sin(w * n);
        }
        return Math.atan2(im, re);
      };
      const w = 0.01;
      const dw = 1e-4;
      const group = -(phase(w + dw) - phase(w - dw)) / (2 * dw);
      expect(Math.abs(group - delay)).toBeLessThan(0.01);
    }
  });

  test("thiranFor is exact in phase delay at the tuning frequency", () => {
    const w = (2 * Math.PI * 1000) / 22050;
    for (const d of [0.5, 0.8, 1.2, 1.49]) {
      expect(Math.abs(allpassDelay(thiranFor(d, w), w) - d)).toBeLessThan(1e-8);
    }
    expect(thiranFor(1)).toBe(0);
  });

  test("hermiteAt passes through samples and is zero outside", () => {
    const x = Float64Array.from([0, 1, 4, 9, 16]);
    expect(hermiteAt(x, 2)).toBe(4);
    expect(hermiteAt(x, 2.5)).toBeCloseTo(6.25, 1);
    expect(hermiteAt(x, -5)).toBe(0);
    expect(hermiteAt(x, 10)).toBe(0);
  });
});

describe("filters", () => {
  test("DcBlock removes DC and OnePole passes it", () => {
    const dc = new DcBlock(22050);
    const lp = new OnePole(1000, 22050);
    let y = 0;
    let z = 0;
    for (let n = 0; n < 22050; n += 1) {
      y = dc.process(1);
      z = lp.process(1);
    }
    expect(Math.abs(y)).toBeLessThan(1e-3);
    expect(z).toBeCloseTo(1, 6);
    expect(new Biquad()).toBeInstanceOf(Biquad);
  });
});

describe("counter rng", () => {
  test("unit() and seedHash() are stable vectors", () => {
    expect(seedHash("")).toBe(0x811c9dc5);
    expect(seedHash("dawg")).toBe(4067375612);
    const seed = seedHash("dawg");
    expect([0, 1, 2].map((index) => unit(seed, index, 0))).toEqual([
      0.5511724066454917, 0.22151059727184474, 0.22960225422866642,
    ]);
    expect(unit(1, 2, 3)).toBe(0.8045120516326278);
  });

  test("draws are independent of order and spread over [0, 1)", () => {
    const seed = seedHash("cloud:7");
    const forward = Array.from({ length: 1000 }, (_, i) => unit(seed, i, 1));
    const backward = Array.from({ length: 1000 }, (_, i) =>
      unit(seed, 999 - i, 1),
    ).reverse();
    expect(backward).toEqual(forward);
    const mean = forward.reduce((sum, v) => sum + v, 0) / forward.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
    expect(Math.min(...forward)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...forward)).toBeLessThan(1);
    expect(seededRandom).toBe(legacyRandom);
  });
});
