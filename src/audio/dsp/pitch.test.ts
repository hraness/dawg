import { describe, expect, test } from "bun:test";
import {
  build,
  melody,
  synthVoice,
  vowelPhrase,
  type VoiceSignal,
} from "../fixtures/voice.ts";
import {
  centsOfHz,
  curveAt,
  frameTime,
  pitchNotes,
  trackPitch,
  trackPitchAsync,
  type PitchCurve,
  type TrackOptions,
} from "./pitch.ts";

type Stats = {
  median: number;
  p95: number;
  octave: number;
  recall: number;
  /** Frames on fast glides (true f0 moves > 40 c over +-12 ms), scored apart. */
  glideMedian: number;
  glideP95: number;
};

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

/** True f0 slope over +-12 ms above which a frame is a fast glide. */
const GLIDE_CENTS = 40;

/**
 * Scores voiced frames more than 12 ms from a voicing boundary. Frames on
 * fast scoops, falls and legato joins (the true f0 moves more than 40 c over
 * +-12 ms) are scored separately, like the voicing-boundary exclusion: a
 * 32 ms analysis window cannot resolve them and pitch.md 3.1 reports them on
 * their own row.
 */
function score(v: VoiceSignal, curve: PitchCurve): Stats {
  const errors: number[] = [];
  const glide: number[] = [];
  let voiced = 0;
  let octave = 0;
  for (let f = 0; f < curve.f0.length; f += 1) {
    const t = frameTime(curve, f);
    const a = Math.round((t - 0.012) * v.sr);
    const b = Math.round((t + 0.012) * v.sr);
    if (a < 0 || b >= v.f0.length || !(v.f0[a]! > 0 && v.f0[b]! > 0)) continue;
    voiced += 1;
    const hz = curve.f0[f]!;
    if (!(hz > 0)) continue;
    const e = Math.abs(centsOfHz(hz) - centsOfHz(v.f0[Math.round(t * v.sr)]!));
    if (e >= 600) octave += 1;
    const slope = Math.abs(centsOfHz(v.f0[b]!) - centsOfHz(v.f0[a]!));
    if (slope > GLIDE_CENTS) glide.push(e);
    else errors.push(e);
  }
  return {
    median: quantile(errors, 0.5),
    p95: quantile(errors, 0.95),
    octave: (100 * octave) / Math.max(1, voiced),
    recall: (100 * (errors.length + glide.length)) / Math.max(1, voiced),
    glideMedian: glide.length ? quantile(glide, 0.5) : 0,
    glideP95: glide.length ? quantile(glide, 0.95) : 0,
  };
}

function octaveRate(vowel: "i" | "u", opts?: TrackOptions): number {
  const v = synthVoice(vowelPhrase(vowel, 72, 76), {
    sr: 48_000,
    seed: 7,
    breath: 0.05,
  });
  return score(v, trackPitch(v.x, v.sr, opts)).octave;
}

describe("trackPitch", () => {
  for (const sr of [22_050, 48_000])
    for (const root of [45, 60, 72])
      test(`clean melody on ${root} at ${sr} Hz`, () => {
        const v = synthVoice(melody(root), { sr, seed: 7 });
        const s = score(v, trackPitch(v.x, sr));
        expect(s.median).toBeLessThanOrEqual(2.5);
        expect(s.p95).toBeLessThanOrEqual(12);
        expect(s.octave).toBe(0);
        expect(s.recall).toBeGreaterThanOrEqual(98);
        // Glide lag guard: measured median 11-29 c, p95 50-108 c.
        expect(s.glideMedian).toBeLessThanOrEqual(40);
        expect(s.glideP95).toBeLessThanOrEqual(140);
      });

  test("matrix i and u at -26 dB breath: octave errors at most 3 %", () => {
    expect(octaveRate("i")).toBeLessThanOrEqual(3);
    expect(octaveRate("u")).toBeLessThanOrEqual(3);
  });

  test("octave control: the comb check lowers the octave rate", () => {
    const on = octaveRate("i") + octaveRate("u");
    const off =
      octaveRate("i", { comb: false }) + octaveRate("u", { comb: false });
    expect(off).toBeGreaterThan(on);
  });

  test("60 Hz hum at -40 dB under auto: few false voiced frames", () => {
    for (const hz of [50, 60]) {
      const v = synthVoice(melody(60), {
        sr: 48_000,
        seed: 7,
        hum: { hz, db: -40 },
      });
      const c = trackPitch(v.x, v.sr);
      let unvoiced = 0;
      let wrong = 0;
      for (let f = 0; f < c.f0.length; f += 1) {
        const t = frameTime(c, f);
        const a = Math.max(0, Math.round((t - 0.03) * v.sr));
        const b = Math.min(v.f0.length - 1, Math.round((t + 0.03) * v.sr));
        let any = false;
        for (let i = a; i <= b; i += 64) any ||= v.f0[i]! > 0;
        if (any) continue;
        unvoiced += 1;
        if (c.f0[f]! > 0) wrong += 1;
      }
      expect(unvoiced).toBeGreaterThan(50);
      expect((100 * wrong) / unvoiced).toBeLessThanOrEqual(5);
    }
  });

  test("a 440 Hz sine lands within 1 cent at both rates", () => {
    for (const sr of [22_050, 48_000]) {
      const x = new Float64Array(sr);
      for (let i = 0; i < x.length; i += 1)
        x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
      const c = trackPitch(x, sr);
      const mid = c.f0.slice(20, c.f0.length - 20);
      for (const hz of mid) expect(Math.abs(centsOfHz(hz))).toBeLessThan(1);
    }
  });

  test("silence is unvoiced; an empty buffer gives no frames", () => {
    const c = trackPitch(new Float64Array(48_000), 48_000);
    expect(c.f0.length).toBeGreaterThan(150);
    expect(c.f0.every((hz) => hz === 0)).toBe(true);
    expect(trackPitch(new Float64Array(0), 48_000).f0.length).toBe(0);
  });

  test("frames sit on an exact grid and a step is located within one hop", () => {
    const song = build([
      [69, 0.6, "a", { off: 30 }, 0],
      [72, 0.6, "a", { off: 30 }, 0.1],
    ]);
    const v = synthVoice(song, { sr: 48_000, seed: 3, drift: 0 });
    const c = trackPitch(v.x, v.sr);
    expect(c.hop).toBe(0.005);
    expect(frameTime(c, 37)).toBe(c.t0 + 37 * c.hop);
    const boundary = song[1]!.start;
    let tracked = NaN;
    for (let f = 0; f < c.f0.length; f += 1)
      if (
        c.f0[f]! > 0 &&
        frameTime(c, f) > boundary - 0.1 &&
        centsOfHz(c.f0[f]!) > 150
      ) {
        tracked = frameTime(c, f);
        break;
      }
    expect(Math.abs(tracked - boundary)).toBeLessThanOrEqual(c.hop);
  });

  test("the curve is canonical: Float32 f0, 1/255 prob and aperiodic", () => {
    const v = synthVoice(melody(60), { sr: 48_000, seed: 3 });
    const c = trackPitch(v.x, v.sr);
    expect(c.f0).toBeInstanceOf(Float32Array);
    expect(c.prob).toBeInstanceOf(Uint8Array);
    expect(c.aperiodic).toBeInstanceOf(Uint8Array);
    const again = trackPitch(v.x, v.sr);
    expect(Buffer.from(again.f0.buffer)).toEqual(Buffer.from(c.f0.buffer));
  });

  test("the resumable tracker yields every 0.5 s and matches byte for byte", async () => {
    const v = synthVoice(melody(60), { sr: 48_000, seed: 3, room: -30 });
    const once = trackPitch(v.x, v.sr);
    const seen: number[] = [];
    let turns = 0;
    const timer = setInterval(() => (turns += 1), 0);
    const steps = await trackPitchAsync(v.x, v.sr, {}, (d) => seen.push(d));
    clearInterval(timer);
    expect(seen.length).toBe(Math.ceil(once.f0.length / 100) - 1);
    expect(
      seen.every((d, i) => d > 0 && d < 1 && (i === 0 || d > seen[i - 1]!)),
    ).toBe(true);
    expect(turns).toBeGreaterThan(0);
    expect(steps.t0).toBe(once.t0);
    expect(Buffer.from(steps.f0.buffer)).toEqual(Buffer.from(once.f0.buffer));
    expect(Buffer.from(steps.prob)).toEqual(Buffer.from(once.prob));
    expect(Buffer.from(steps.aperiodic)).toEqual(Buffer.from(once.aperiodic));
  });

  test("curveAt interpolates in log frequency", () => {
    const c: PitchCurve = {
      t0: 0,
      hop: 0.01,
      f0: Float32Array.from([200, 400, 0]),
      prob: new Uint8Array(3),
      aperiodic: new Uint8Array(3),
    };
    expect(curveAt(c, 0.005)).toBeCloseTo(200 * Math.SQRT2, 6);
    expect(curveAt(c, 0.014)).toBe(400);
    expect(curveAt(c, 0.016)).toBe(0);
    expect(curveAt(c, -1)).toBe(0);
  });

  /** Median of five timed runs, in ms per audio second. */
  function cost(x: Float64Array, sr: number): number {
    trackPitch(x, sr);
    const times: number[] = [];
    for (let k = 0; k < 5; k += 1) {
      const start = performance.now();
      trackPitch(x, sr);
      times.push(performance.now() - start);
    }
    return quantile(times, 0.5) / (x.length / sr);
  }

  // The budget is 30 ms per audio second at hop 5 ms (measured 19-27 on a
  // quiet Apple-silicon host for clean, low and room-bed voices). The full
  // suite runs files in parallel, so the gate is 1.5x the budget; set
  // DAWG_STRICT_BUDGET=1 on a quiet host to assert the budget itself. Shared
  // CI runners run the suite about 2x slower than that host, so CI checks
  // twice the gate: it still catches an algorithmic regression, not runner
  // noise.
  const BUDGET = process.env.DAWG_STRICT_BUDGET ? 30 : process.env.CI ? 90 : 45;

  test("cost stays within budget at hop 5 ms: clean, low and room bed", () => {
    for (const [root, room] of [
      [57, undefined],
      [40, undefined],
      [57, -30],
    ] as const) {
      const v = synthVoice(melody(root), { sr: 48_000, seed: 7, room });
      const ms = cost(v.x, v.sr);
      if (ms >= BUDGET)
        console.error(`trackPitch cost ${ms.toFixed(1)} ms/s (root ${root})`);
      expect(ms).toBeLessThan(BUDGET);
    }
  }, 60_000);
});

describe("pitchNotes", () => {
  for (const root of [45, 57, 72])
    test(`finds all 12 onsets of the melody on ${root}`, () => {
      const v = synthVoice(melody(root), { sr: 48_000, seed: 7 });
      const notes = pitchNotes(trackPitch(v.x, v.sr));
      const errors: number[] = [];
      for (const onset of v.onsets) {
        let best = Infinity;
        for (const n of notes) best = Math.min(best, Math.abs(n.start - onset));
        if (best < 0.05) errors.push(best * 1000);
      }
      expect(errors.length).toBe(12);
      expect(quantile(errors, 0.5)).toBeLessThanOrEqual(12);
    });

  for (const depth of [60, 100, 150])
    test(`a held note with +-${depth} c vibrato at 5.5 Hz is one note`, () => {
      const hop = 0.005;
      const n = 400;
      const f0 = new Float32Array(n);
      for (let f = 0; f < n; f += 1)
        f0[f] =
          220 * 2 ** ((depth * Math.sin(2 * Math.PI * 5.5 * f * hop)) / 1200);
      const notes = pitchNotes({
        t0: 0,
        hop,
        f0,
        prob: new Uint8Array(n).fill(255),
        aperiodic: new Uint8Array(n),
      });
      expect(notes.length).toBe(1);
      expect(notes[0]!.midi).toBe(57);
    });

  test("a sung note with +-120 c vibrato tracks to one note", () => {
    const v = synthVoice(build([[57, 2, "a", { vib: 120, rate: 5.5 }, 0]]), {
      sr: 48_000,
      seed: 7,
    });
    const notes = pitchNotes(trackPitch(v.x, v.sr));
    expect(notes.length).toBe(1);
    expect(notes[0]!.midi).toBe(57);
  });

  test("note pitches are the sung notes", () => {
    const v = synthVoice(melody(60), { sr: 48_000, seed: 7 });
    const notes = pitchNotes(trackPitch(v.x, v.sr));
    const sung = melody(60).map((n) => n.midi);
    const found = notes.filter((n) => n.end - n.start > 0.2).map((n) => n.midi);
    for (const midi of found) expect(sung).toContain(midi);
    expect(notes.every((n) => Math.abs(n.cents) <= 50)).toBe(true);
  });
});
