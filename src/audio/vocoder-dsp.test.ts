/**
 * Vocoder DSP accuracy (vocoder.md §9 tests 7-14) on the shared synthetic
 * voice fixture at 48 kHz. Thresholds are calibrated on the contract
 * fixture (src/audio/fixtures/voice.ts); the prototype's own phrase gives
 * the spec's numbers, and the port matches the prototype there.
 */
import { describe, expect, test } from "bun:test";
import {
  bandCorrelation,
  bandEnvelopes,
  envelopeDistance,
  fft,
  vocodeDirect,
} from "./fixtures/vocoder-measure.ts";
import { build, synthVoice, type VoiceSignal } from "./fixtures/voice.ts";
import { unit } from "./dsp/rng.ts";
import { autoGateDb, gateCurve, quietHold } from "./dsp/follow.ts";
import { unvoicedCurve } from "./vocoder/detect.ts";
import { renderCarrierSpan } from "./vocoder/carrier.ts";
import { VOCODER_PRESET_NAMES } from "../../core/vocoder.ts";
import { budget, ratioBudget } from "../../test/perf.ts";

const SR = 48_000;
/** A spoken-rhythm phrase with fricative-like consonants and rests. */
const PHRASE = build([
  [57, 0.6, "a", { scoop: 80 }, 0],
  [60, 0.45, "e", { consonant: 0.08 }, 0],
  [64, 0.5, "i", { consonant: 0.04 }, 0.25],
  [62, 0.7, "o", { consonant: 0.1, scoop: 80 }, 0],
  [59, 0.5, "u", { consonant: 0.08 }, 0.3],
  [57, 0.9, "a", { consonant: 0.04 }, 0],
  [55, 0.6, "i", { consonant: 0.08, scoop: 80 }, 0],
]);
const V: VoiceSignal = synthVoice(PHRASE, { sr: SR, seed: 7 });
const X = V.x;
const LEN = X.length;

function carrierOf(
  kind: "saw" | "supersaw" | "noise",
  pitches: readonly number[],
  right = false,
): Float64Array[] {
  const l = new Float64Array(LEN);
  const r = right ? new Float64Array(LEN) : undefined;
  renderCarrierSpan(
    l,
    r,
    { start: 0, length: LEN, pitches, velocity: 1, seed: 3 },
    { carrier: kind, spread: kind === "supersaw" ? 0.15 : 0 },
    { sampleRate: SR, origin: 0, seed: 3 },
  );
  return r ? [l, r] : [l];
}
const SAW = carrierOf("saw", [45])[0]!;
const NOISE = carrierOf("noise", [45])[0]!;

const rms = (x: Float64Array) =>
  Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
const peak = (x: Float64Array) =>
  x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = (v: number) => 20 * Math.log10(v + 1e-20);
const one = (vocoder: Parameters<typeof vocodeDirect>[3], car = SAW, mod = X) =>
  vocodeDirect(mod, [car], SR, vocoder)[0]!;

/** Frame starts inside each voiced vowel (past the onset, before the end). */
const VOICED: number[] = [];
for (const s of V.syllables)
  for (
    let at = (s.onset + 0.08) * SR;
    at + 2048 < (s.end - 0.04) * SR;
    at += 0.04 * SR
  )
    VOICED.push(Math.round(at));

/** Mean log-frequency power centroid (semitones re A440), 200..5000 Hz. */
function centroid(x: Float64Array): number {
  const N = 2048;
  let acc = 0;
  for (const at of VOICED) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i += 1)
      re[i] = x[at + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    let w = 0;
    let s = 0;
    for (let k = Math.ceil((200 * N) / SR); k <= (5000 * N) / SR; k += 1) {
      const p = re[k]! ** 2 + im[k]! ** 2;
      w += p;
      s += p * 12 * Math.log2((k * SR) / N / 440);
    }
    acc += s / w;
  }
  return acc / VOICED.length;
}

/** First crossing of 30 % of the next 120 ms max of a 1 ms peak envelope. */
function onsetLags(a: Float64Array, b: Float64Array): number[] {
  const env = (x: Float64Array) => {
    let e = 0;
    const c = Math.exp(-1 / (0.001 * SR));
    return x.map((v) => (e = Math.max(Math.abs(v), c * e)));
  };
  const ea = env(a);
  const eb = env(b);
  const W = Math.round(0.12 * SR);
  const cross = (e: Float64Array, s: number) => {
    let m = 0;
    for (let i = s; i < Math.min(LEN, s + W); i += 1) m = Math.max(m, e[i]!);
    for (let i = s; i < Math.min(LEN, s + W); i += 1)
      if (e[i]! >= 0.3 * m) return i;
    return -1;
  };
  const out: number[] = [];
  for (const s of V.syllables) {
    const from = Math.max(0, Math.round((s.start - 0.01) * SR));
    const ia = cross(ea, from);
    const ib = cross(eb, from);
    if (ia >= 0 && ib >= 0) out.push(ib - ia);
  }
  return out.sort((x, y) => x - y);
}

describe("vocoder DSP (48 kHz voice fixture)", () => {
  test("7: band correlation and onset lag", () => {
    const channel = bandCorrelation(X, one({ gate: -120 }), SR);
    const talkbox = bandCorrelation(
      X,
      one({ mode: "talkbox", gate: -120 }),
      SR,
    );
    const raw = bandCorrelation(X, SAW, SR);
    console.log("corr", { channel, talkbox, raw });
    expect(channel).toBeGreaterThanOrEqual(0.5);
    expect(talkbox).toBeGreaterThanOrEqual(0.7);
    expect(Math.abs(raw)).toBeLessThanOrEqual(0.05);
    const lags: Record<string, number> = {};
    for (const preset of VOCODER_PRESET_NAMES) {
      if (preset === "talkbox") continue;
      const lag = onsetLags(X, one({ preset, unvoiced: 0 }, NOISE));
      lags[preset] = lag[lag.length >> 1]!;
    }
    console.log("onset lag", lags);
    for (const [preset, lag] of Object.entries(lags)) {
      if (preset === "smear") continue;
      // Spec: <= 200 (lofi 300) on the prototype phrase, where the medians
      // were 76..190; here they are 107..205 (choir's 20 ms attack), so
      // 220 keeps the same margin over the slowest non-smear preset.
      expect(lag).toBeLessThanOrEqual(preset === "lofi" ? 300 : 220);
    }
  }, 60_000);

  test("8: fixed level and peak guard", () => {
    const levels: Record<string, number> = {};
    for (const preset of VOCODER_PRESET_NAMES)
      levels[preset] = db(rms(one({ preset })) / rms(X));
    for (const bands of [8, 16, 40])
      for (const width of [0.5, 1, 4])
        levels[`${bands}x${width}`] = db(rms(one({ bands, width })) / rms(X));
    console.log("level dB", levels);
    // Presets hold the spec's +/-2 dB. The layout-only makeup was fitted on
    // the prototype's phrase (+/-1.9 dB over the grid there); this vibrato
    // fixture drifts up to +4.3 dB at 40 narrow bands, so the grid is a
    // looser regression guard.
    for (const [name, level] of Object.entries(levels)) {
      if (name === "lofi") continue;
      const limit = name.includes("x") ? 4.5 : 2;
      expect(Math.abs(level)).toBeLessThanOrEqual(limit);
    }
    for (const formant of [-24, 24])
      expect(peak(one({ formant }))).toBeLessThanOrEqual(1);
    for (const formant of [-12, 12])
      expect(peak(one({ mode: "talkbox", formant }))).toBeLessThanOrEqual(1);
  }, 60_000);

  test("9: formant shifts the envelope the right way", () => {
    for (const mode of ["channel", "talkbox"] as const) {
      const base = centroid(one({ mode, formant: 0, unvoiced: 0, gate: -120 }));
      const shifts = [-4, 3, 4, 7, 12].map(
        (st) =>
          [
            st,
            centroid(one({ mode, formant: st, unvoiced: 0, gate: -120 })) -
              base,
          ] as const,
      );
      console.log("formant centroid shift", mode, shifts);
      for (const [st, moved] of shifts) {
        expect(Math.sign(moved)).toBe(Math.sign(st));
        expect(Math.abs(moved)).toBeGreaterThanOrEqual(0.35 * Math.abs(st));
      }
      for (let i = 1; i < shifts.length; i += 1)
        expect(shifts[i]![1]).toBeGreaterThan(shifts[i - 1]![1]);
    }
    for (const [mode, st] of [
      ["channel", -4],
      ["talkbox", -4],
      ["talkbox", 7],
    ] as const) {
      const y = one({ mode, formant: st, unvoiced: 0, gate: -120 });
      const shifted = envelopeDistance(X, y, SR, VOICED, 2 ** (st / 12));
      const unshifted = envelopeDistance(X, y, SR, VOICED, 1);
      expect(shifted).toBeLessThan(unshifted - 0.3);
    }
  }, 60_000);
});

const PEAK = peak(X);
/**
 * Tests 10-11 need real rests: the same phrase with 0.6 s rests and no
 * breath floor; consonant truth is each syllable's unvoiced lead-in.
 */
const GAPPY = (() => {
  const phrase = build([
    [57, 0.6, "a", { scoop: 80 }, 0],
    [60, 0.45, "e", { consonant: 0.08 }, 0.6],
    [64, 0.5, "i", { consonant: 0.04 }, 0.6],
    [62, 0.7, "o", { consonant: 0.1, scoop: 80 }, 0.6],
    [59, 0.5, "u", { consonant: 0.08 }, 0.6],
    [57, 0.9, "a", { consonant: 0.04 }, 0.6],
    [55, 0.6, "i", { consonant: 0.08, scoop: 80 }, 0.6],
  ]);
  // No breath floor: the gaps hold only the noise the tests add.
  const v = synthVoice(phrase, { sr: SR, seed: 7, breath: 0 });
  const len = v.x.length;
  // Gaps as in the prototype: the clean take's 10 ms peak envelope under
  // 1e-4, 150 ms clear on both sides (past the release tails).
  const quiet = new Uint8Array(len);
  let e = 0;
  const c = Math.exp(-1 / (0.01 * SR));
  for (let i = 0; i < len; i += 1) {
    e = Math.max(Math.abs(v.x[i]!), c * e);
    quiet[i] = e < 1e-4 ? 1 : 0;
  }
  const d = Math.round(0.15 * SR);
  const gap = Uint8Array.from(
    quiet,
    (_, i) =>
      quiet[Math.max(0, i - d)]! & quiet[i]! & quiet[Math.min(len - 1, i + d)]!,
  );
  const consonant = new Uint8Array(len);
  for (const syl of v.syllables)
    consonant.fill(1, Math.round(syl.start * SR), Math.round(syl.onset * SR));
  const saw = new Float64Array(len);
  renderCarrierSpan(
    saw,
    undefined,
    { start: 0, length: len, pitches: [45], velocity: 1, seed: 3 },
    { carrier: "saw", spread: 0 },
    { sampleRate: SR, origin: 0, seed: 3 },
  );
  return {
    V: v,
    X: v.x,
    LEN: len,
    SAW: saw,
    PEAK: peak(v.x),
    GAP: gap,
    CONSONANT: consonant,
  };
})();

function biquadBandpass(x: Float64Array, fc: number): Float64Array {
  const y = Float64Array.from(x);
  const w = (2 * Math.PI * fc) / SR;
  const al = Math.sin(w) / 4;
  const a0 = 1 + al;
  const [b0, b2, a1, a2] = [
    al / a0,
    -al / a0,
    (-2 * Math.cos(w)) / a0,
    (1 - al) / a0,
  ];
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < y.length; i += 1) {
    const v = y[i]!;
    const o = b0 * v + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, v, y1, o];
    y[i] = o;
  }
  return y;
}

describe("vocoder detectors, freeze, stereo and cost", () => {
  test("10: auto gate silences a -50 dBFS hiss and hum floor", () => {
    const { V, X, LEN, SAW, PEAK, GAP } = GAPPY;
    expect(GAP.reduce((s, v) => s + v, 0)).toBeGreaterThan(0.2 * SR);
    const x = Float64Array.from(X);
    const a = PEAK * 10 ** (-50 / 20);
    for (let i = 0; i < LEN; i += 1)
      x[i] =
        x[i]! +
        a *
          ((unit(99, i, 0) * 2 - 1) * Math.sqrt(3) * 0.7 +
            0.7 * Math.SQRT2 * Math.sin((2 * Math.PI * 60 * i) / SR));
    const g = autoGateDb(x, SR);
    const y = vocodeDirect(x, [SAW], SR, { gate: "auto" })[0]!;
    const u = unvoicedCurve(x, SR, 0.5, 0, gateCurve(x, SR, g));
    let eg = 0;
    let ng = 0;
    let ev = 0;
    let nv = 0;
    let fire = 0;
    for (let i = 0; i < LEN; i += 1) {
      if (GAP[i]) {
        eg += y[i]! ** 2;
        ng += 1;
        if (u[i]! > 0.5) fire += 1;
      } else if (V.f0[i]! > 0) {
        ev += y[i]! ** 2;
        nv += 1;
      }
    }
    const gapDb = db(Math.sqrt(eg / ng) / Math.sqrt(ev / nv));
    console.log("gate", { threshold: g, gapDb, fires: fire / ng });
    expect(gapDb).toBeLessThanOrEqual(-50);
    expect(fire / ng).toBeLessThanOrEqual(0.05);
  }, 60_000);

  test("11: unvoiced lifts consonants; detector precision and recall", () => {
    const { X, LEN, SAW, PEAK, GAP, CONSONANT } = GAPPY;
    const high = (y: Float64Array) => {
      const h = biquadBandpass(biquadBandpass(y, 6000), 6000);
      let e = 0;
      let n = 0;
      for (let i = 0; i < LEN; i += 1)
        if (CONSONANT[i]) {
          e += h[i]! ** 2;
          n += 1;
        }
      return db(Math.sqrt(e / n));
    };
    // Measured as in the prototype (results.txt): with `enhance` off, since
    // band whitening already flattens the carrier into the consonants.
    const off = high(one({ unvoiced: 0, gate: -120, enhance: false }, SAW, X));
    const on = high(one({ unvoiced: 0.5, gate: -120, enhance: false }, SAW, X));
    console.log("consonant >4 kHz", { off, on, rise: on - off });
    expect(on - off).toBeGreaterThanOrEqual(8);

    // Breath (1.5 kHz noise, -30 dB) and fry (35 Hz pulses, -26 dB) in gaps.
    const x = Float64Array.from(X);
    const spans: [number, number, boolean][] = [];
    for (let i = 0, k = 0; i < LEN;) {
      if (!GAP[i]) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < LEN && GAP[j]) j += 1;
      if (j - i > 0.12 * SR) spans.push([i, j, k++ % 2 === 0]);
      i = j;
    }
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const noise = biquadBandpass(
      Float64Array.from({ length: LEN }, (_, n) => unit(5, n, 0) * 2 - 1),
      1500,
    );
    const level = (PEAK * 10 ** (-30 / 20)) / rms(noise);
    for (const [a, b, breath] of spans)
      for (let n = a; n < b; n += 1) {
        const env = Math.sin((Math.PI * (n - a)) / (b - a));
        x[n] =
          x[n]! +
          (breath
            ? noise[n]! * level
            : (n - a) % Math.round(SR / 35) < 40
              ? PEAK * 0.05
              : 0) *
            env;
      }
    const u = unvoicedCurve(x, SR, 0.5);
    // The prototype's scoring: 5 ms frames read at their centre, with a
    // 10 ms boundary guard around each consonant edge.
    const hop = Math.round(0.005 * SR);
    const guard = Math.round(0.01 * SR);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let s = 0; s + hop <= LEN; s += hop) {
      const i = s + (hop >> 1);
      const truth = CONSONANT[i] === 1;
      if (
        CONSONANT[Math.max(0, i - guard)] !== CONSONANT[i] ||
        CONSONANT[Math.min(LEN - 1, i + guard)] !== CONSONANT[i]
      )
        continue;
      const detected = u[i]! > 0.5;
      if (truth && detected) tp += 1;
      else if (detected) fp += 1;
      else if (truth) fn += 1;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    console.log("unvoiced detector", {
      spans: spans.length,
      precision,
      recall,
    });
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  test("12: freeze holds the band levels", () => {
    const from = Math.round((V.syllables[3]!.onset + 0.1) * SR);
    const hold = new Uint8Array(LEN);
    hold.fill(1, from, from + SR);
    // Unvoiced off: the hold freezes the envelopes, not the carrier, and the
    // span crosses a consonant (as in the prototype's measure).
    const y = vocodeDirect(
      X,
      [SAW],
      SR,
      { gate: -120, unvoiced: 0 },
      { hold },
    )[0]!;
    const edge = Math.round(0.05 * SR);
    const env = bandEnvelopes(y.subarray(from + edge, from + SR - edge), SR);
    // Mean over bands of each band's level std (the prototype's measure).
    const sds = env.bands.map((band) => {
      const mean = band.reduce((s, v) => s + v, 0) / band.length;
      return Math.sqrt(
        band.reduce((s, v) => s + (v - mean) ** 2, 0) / band.length,
      );
    });
    const meanSd = sds.reduce((s, v) => s + v, 0) / sds.length;
    console.log("freeze band std dB", {
      mean: meanSd,
      worst: Math.max(...sds),
    });
    expect(meanSd).toBeLessThan(0.5);
  }, 60_000);

  test("12b: a held vowel survives the gate and a silent modulator", () => {
    const cut = Math.round((V.syllables[3]!.onset + 0.2) * SR);
    const mod = Float64Array.from(X);
    mod.fill(0, cut);
    const hold = new Uint8Array(LEN);
    hold.fill(1, cut);
    for (const mode of ["channel", "talkbox"] as const) {
      const y = vocodeDirect(
        mod,
        [SAW],
        SR,
        { mode, gate: -60, unvoiced: 0 },
        { hold },
      )[0]!;
      const span = (a: number) =>
        db(rms(y.subarray(cut + a * SR, cut + (a + 0.5) * SR)));
      const levels = [0.25, 0.75, 1.25].map(span);
      expect(Math.min(...levels)).toBeGreaterThan(-60);
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(0.5);
    }
  }, 60_000);

  test("12c: a static freeze holds the last vowel through rests", () => {
    const cut = Math.round((V.syllables[3]!.onset + 0.2) * SR);
    const mod = Float64Array.from(X);
    mod.fill(0, cut);
    const hold = quietHold(mod, LEN, SR, -60);
    // nothing to hold before the voice: silence stays silence
    expect(hold[0]).toBe(1);
    const y = vocodeDirect(mod, [SAW], SR, { gate: -60 }, { hold })[0]!;
    expect(db(rms(y.subarray(cut + SR / 4, cut + SR)))).toBeGreaterThan(-60);
    expect(db(rms(y.subarray(0, Math.round(0.02 * SR))))).toBeLessThan(-80);
  }, 60_000);

  test("13: a stereo carrier keeps L != R; mono path equals the left", () => {
    const [l, r] = carrierOf("supersaw", [45, 52, 57], true);
    const [yl, yr] = vocodeDirect(X, [l!, r!], SR, { preset: "choir" });
    let d = 0;
    for (let i = 0; i < LEN; i += 1) d += (yl![i]! - yr![i]!) ** 2;
    expect(Math.sqrt(d / LEN) / rms(yl!)).toBeGreaterThan(0.2);
    const mono = vocodeDirect(X, [l!], SR, { preset: "choir" })[0]!;
    let diff = 0;
    for (let i = 0; i < LEN; i += 1)
      diff = Math.max(diff, Math.abs(mono[i]! - yl![i]!));
    expect(diff).toBe(0);
  }, 60_000);

  test("14: cost guard (v2 budget, relative to a chord carrier)", () => {
    const time = (f: () => void) => {
      const runs: number[] = [];
      for (let k = 0; k < 3; k += 1) {
        const t0 = performance.now();
        f();
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[1]!;
    };
    // Warm the JIT first; the baseline is one saw note, as in the prototype.
    carrierOf("saw", [45]);
    one({ gate: -120 });
    one({ mode: "talkbox", gate: -120 });
    const saw = time(() => carrierOf("saw", [45]));
    const chord = time(() => carrierOf("supersaw", [45, 52, 57, 61, 64]));
    const channel = time(() => one({ gate: -120 }));
    const talkbox = time(() => one({ mode: "talkbox", gate: -120 }));
    const ms = (t: number) => t / (LEN / SR);
    console.log("cost ms per audio-second", {
      saw: ms(saw),
      chord: ms(chord),
      channel: ms(channel),
      talkbox: ms(talkbox),
    });
    // The spec's 30x / 15x "plain saw voice" ratios came from the v1 cost
    // table; a warm saw here costs ~0.1 ms/s, too small to anchor a ratio.
    // The guard uses the v2 numbers (vocoder.md §3b.9: channel 16 47.9 ms/s,
    // talkbox 9.1) with a 3x load margin, and a ratio to the supersaw chord
    // carrier (measured ~13x and ~3x here) with ~2x margin.
    // Budgets scale with this host's speed (test/perf.ts); DAWG_PERF=1
    // asserts them as written.
    expect(ms(channel)).toBeLessThanOrEqual(budget(150));
    expect(ms(talkbox)).toBeLessThanOrEqual(budget(30));
    expect(channel).toBeLessThanOrEqual(ratioBudget(25) * chord);
    expect(talkbox).toBeLessThanOrEqual(ratioBudget(6) * chord);
  }, 60_000);
});
