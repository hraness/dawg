import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  GRANULAR_PRESET_NAMES,
  granularTailSeconds,
  resolveGranular,
  type TrackGranular,
} from "../../core/granular.ts";
import { TrackScore } from "../../core/score.ts";
import {
  BANK_CHUNK_FRAMES,
  bankBytes,
  bankChunks,
  bankLevel,
  bankRead,
  resetBank,
  type BankSource,
} from "./dsp/bank.ts";
import { fftInPlace } from "./dsp/fft.ts";
import { WINDOW_SHAPES, windowTable } from "./dsp/window.ts";
import { SYNTH_PRESETS } from "../../core/synth.ts";
import type { Track } from "../../core/score.ts";
import {
  granularSeeds,
  granularVoice,
  renderGranularTrack,
  synthSource,
} from "./granular.ts";
import { renderScorePcm } from "./wav.ts";

const SR = 48_000;

function harmonicTone(hz: number, seconds: number, harmonics = 12) {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let h = 1; h <= harmonics && h * hz < 0.45 * SR; h += 1) {
    const a = 0.3 / h;
    const w = (2 * Math.PI * h * hz) / SR;
    for (let i = 0; i < x.length; i += 1) x[i] = x[i]! + a * Math.sin(w * i);
  }
  return x;
}

function sine(hz: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  const w = (2 * Math.PI * hz) / SR;
  for (let i = 0; i < x.length; i += 1) x[i] = 0.5 * Math.sin(w * i);
  return x;
}

function spectrum(x: Float64Array, from: number, n: number): Float64Array {
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
function measureF0(x: Float64Array, expected: number, n = 32768): number {
  const from = Math.round(0.3 * SR);
  const len = Math.min(
    n,
    1 << Math.floor(Math.log2(Math.max(1024, x.length - from))),
  );
  const m = spectrum(x, from, len);
  const lo = Math.max(1, Math.floor((expected * 2 ** (-1 / 12) * len) / SR));
  const hi = Math.min(
    len / 2 - 1,
    Math.ceil((expected * 2 ** (1 / 12) * len) / SR),
  );
  let k = lo;
  for (let i = lo; i <= hi; i += 1) if (m[i]! > m[k]!) k = i;
  const a = Math.log(m[k - 1]! + 1e-12);
  const b = Math.log(m[k]! + 1e-12);
  const c = Math.log(m[k + 1]! + 1e-12);
  const d = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((k + d) * SR) / len;
}

const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);
const c4 = 440 * 2 ** (-9 / 12);

function stream(
  source: BankSource,
  baseRate: number,
  extra: TrackGranular = {},
  seconds = 1.2,
  centsAt?: (t: number) => number,
): Float64Array {
  // Overlap-1 Tukey stream whose head scans at the read speed, so every
  // grain continues the previous one's phase (a dense cloud has no single
  // stable spectral peak; spec 9 test 5 measures this configuration).
  const settings = resolveGranular({
    grain: 0.1,
    overlap: 1,
    jitter: 0,
    spray: 0,
    scan: baseRate * 2 ** ((centsAt?.(0) ?? 0) / 1200),
    window: "tukey",
    spread: 0,
    veltone: 0,
    ...extra,
  });
  const frames = Math.round(seconds * SR);
  const voice = granularVoice({
    source,
    sr: SR,
    settings,
    baseRate,
    velocity: 1,
    gateFrames: frames,
    ...(centsAt ? { cents: centsAt } : {}),
    seed: 1,
  });
  const l = new Float64Array(voice.totalFrames);
  const r = new Float64Array(voice.totalFrames);
  voice.process(l, r, 0, voice.totalFrames);
  return l;
}

describe("grain windows", () => {
  test("every shape is bounded 0..1 and the symmetric ones start at 0", () => {
    for (const shape of WINDOW_SHAPES) {
      const t = windowTable(shape);
      expect(t.length).toBe(2049);
      for (const v of t) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
    for (const shape of ["hann", "tukey", "gauss", "tri"] as const) {
      const t = windowTable(shape);
      expect(t[0]!).toBeLessThan(1e-6);
      expect(Math.abs(t[512]! - t[1536]!)).toBeLessThan(1e-9);
    }
  });
});

describe("grain bank", () => {
  test("level is the semitone count above step 1, never below 0", () => {
    expect(bankLevel(1)).toBe(0);
    expect(bankLevel(0.5)).toBe(0);
    expect(bankLevel(-1)).toBe(0);
    expect(bankLevel(2 ** (1 / 12))).toBe(1);
    expect(bankLevel(2)).toBe(12);
    expect(bankLevel(-2.01)).toBe(13);
  });

  test("memory stays within the byte cap (LRU)", () => {
    const source: BankSource = {
      id: "cap-test",
      rate: SR,
      data: harmonicTone(220, 6),
    };
    const chunkBytes = (BANK_CHUNK_FRAMES + 3) * 4;
    resetBank(chunkBytes * 8);
    for (let level = 0; level < 24; level += 1)
      for (let pos = 0; pos < source.data.length; pos += BANK_CHUNK_FRAMES)
        bankRead(source, level, pos + 10.5);
    expect(bankBytes()).toBeLessThanOrEqual(chunkBytes * 8);
    expect(bankChunks()).toBeLessThanOrEqual(8);
    // Re-reading after eviction refills the same values.
    const a = bankRead(source, 3, 1234.25);
    resetBank(chunkBytes * 2);
    expect(bankRead(source, 3, 1234.25)).toBe(a);
    resetBank();
  });

  // 7g: in-band level of an upward read (shimmer interval, bend) stays
  // within 1.5 dB below 0.33 of the output rate and 2.5 dB up to 0.39.
  test("7g: upward reads keep the passband", () => {
    for (const semis of [7, 12, 19, 24]) {
      const r = 2 ** (semis / 12);
      for (const outFrac of [0.1, 0.25, 0.33, 0.39]) {
        const limit = outFrac <= 0.33 ? 1.5 : 2.5;
        const f = (outFrac * SR) / r;
        const source: BankSource = {
          id: `pass-${semis}-${outFrac}`,
          rate: SR,
          data: sine(f, 1.5),
        };
        const level = bankLevel(r);
        const n = 8192;
        let ss = 0;
        for (let i = 0; i < n; i += 1) {
          const v = bankRead(source, level, 4000 + i * r);
          ss += v * v;
        }
        const db = 10 * Math.log10(ss / n / 0.125);
        expect(db).toBeGreaterThan(-limit);
        expect(db).toBeLessThan(0.5);
      }
    }
    resetBank();
  });

  // 7b: a source partial that lands above the output Nyquist after the
  // read step (shimmer +12, a +2 semitone bend on top) is suppressed.
  test("7b: upward reads do not alias", () => {
    for (const semis of [12, 14, 19]) {
      const r = 2 ** (semis / 12);
      const f = (0.6 * SR) / r; // would fold to 0.4 of the output rate
      const source: BankSource = {
        id: `alias-${semis}`,
        rate: SR,
        data: sine(f, 1.5),
      };
      const level = bankLevel(r);
      const n = 8192;
      let ss = 0;
      for (let i = 0; i < n; i += 1) {
        const v = bankRead(source, level, 4000 + i * r);
        ss += v * v;
      }
      const db = 10 * Math.log10(ss / n / 0.125 + 1e-30);
      expect(db).toBeLessThan(-60);
    }
    resetBank();
  });
});

describe("granular voice", () => {
  const tone: BankSource = {
    id: "c4-harmonic",
    rate: SR,
    data: harmonicTone(c4, 22),
  };

  test("pitch: overlap-1 Tukey stream within 1 cent, C1..C8", () => {
    for (let note = 24; note <= 108; note += 12) {
      const hz = 440 * 2 ** ((note - 69) / 12);
      const out = stream(tone, hz / c4);
      expect(Math.abs(cents(measureF0(out, hz), hz))).toBeLessThan(1);
    }
  });

  test("pitch: 19-EDO step 3 and a +50 cent bend within 1 cent", () => {
    const target = 440 * 2 ** (3 / 19);
    const a4 = stream(tone, target / c4);
    expect(Math.abs(cents(measureF0(a4, target), target))).toBeLessThan(1);
    const bent = stream(tone, 440 / c4, {}, 1.2, () => 50);
    expect(Math.abs(cents(measureF0(bent, 452.89), 452.89))).toBeLessThan(1);
  });

  test("streaming in 128-frame blocks equals one call", () => {
    const settings = resolveGranular({ preset: "swarm" });
    const init = {
      source: tone,
      sr: SR,
      settings,
      baseRate: 1.5,
      velocity: 0.7,
      gateFrames: SR,
      seed: 9,
    };
    const a = granularVoice(init);
    const whole = new Float64Array(a.totalFrames);
    const wholeR = new Float64Array(a.totalFrames);
    a.process(whole, wholeR, 0, a.totalFrames);
    const b = granularVoice(init);
    const parts = new Float64Array(b.totalFrames);
    const partsR = new Float64Array(b.totalFrames);
    for (let at = 0; at < b.totalFrames; at += 128)
      b.process(parts, partsR, at, Math.min(128, b.totalFrames - at));
    expect(parts).toEqual(whole);
    expect(partsR).toEqual(wholeR);
  });

  test("tail: silent after release + 1.5 * grain; tail capped at 10 s", () => {
    const out = stream(tone, 1, { grain: 0.1, release: 0.3 }, 0.5);
    const after = Math.round((0.5 + 0.3 + 1.5 * 0.1) * SR);
    for (let i = after; i < out.length; i += 1) expect(out[i]).toBe(0);
    expect(granularTailSeconds({ release: 1, grain: 0.2 })).toBeCloseTo(1.3);
    expect(granularTailSeconds({ release: 10, grain: 2 })).toBe(10);
  });

  test("release: the cloud keeps sounding through the release, then 0", () => {
    const SRR = 22_050;
    const source = synthSource("pad", 60, SRR);
    for (const preset of ["hold", "cloud"] as const) {
      const settings = resolveGranular({ preset });
      const gate = 2 * SRR;
      const voice = granularVoice({
        source,
        sr: SRR,
        settings,
        baseRate: 1,
        velocity: 1,
        gateFrames: gate,
        seed: 2,
      });
      const l = new Float64Array(voice.totalFrames);
      const r = new Float64Array(voice.totalFrames);
      voice.process(l, r, 0, voice.totalFrames);
      const rms = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i < to; i += 1) sum += l[i]! * l[i]!;
        return Math.sqrt(sum / Math.max(1, to - from));
      };
      const held = rms(Math.round(1.2 * SRR), gate);
      const rel = settings.release * SRR;
      const ringing = rms(
        gate + Math.round(0.5 * rel),
        gate + Math.round(0.75 * rel),
      );
      expect(20 * Math.log10(ringing / held)).toBeGreaterThan(-40);
      const after = gate + Math.ceil(rel + 1.5 * settings.grain * SRR);
      for (let i = after; i < l.length; i += 1) expect(l[i]).toBe(0);
    }
  });

  test("held loop: no 250 ms hole in a 20 s cloud on any synth preset", () => {
    const SRR = 22_050;
    const settings = resolveGranular({ preset: "cloud" });
    for (const name of Object.keys(SYNTH_PRESETS)) {
      const source = synthSource(name, 60, SRR);
      const gate = 20 * SRR;
      const voice = granularVoice({
        source,
        sr: SRR,
        settings,
        baseRate: 1,
        velocity: 1,
        gateFrames: gate,
        seed: 5,
      });
      const l = new Float64Array(voice.totalFrames);
      const r = new Float64Array(voice.totalFrames);
      voice.process(l, r, 0, voice.totalFrames);
      const w = Math.round(0.25 * SRR);
      const levels: number[] = [];
      for (let at = SRR; at + w <= gate; at += w) {
        let sum = 0;
        for (let i = at; i < at + w; i += 1) sum += l[i]! * l[i]!;
        levels.push(Math.sqrt(sum / w));
      }
      const sorted = [...levels].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1]!;
      expect(20 * Math.log10(sorted[0]! / median)).toBeGreaterThan(-12);
    }
  });

  test("a sound source plays the track's own synth params", () => {
    const plain = synthSource("supersaw", 60, 22_050);
    const tuned = synthSource("supersaw", 60, 22_050, SYNTH_PRESETS.pad!.synth);
    const pad = synthSource("pad", 60, 22_050);
    expect(tuned.data).toEqual(pad.data);
    expect(plain.data).not.toEqual(pad.data);
  });

  test("seeds key on (seed, track, pitch, startTick, occurrence)", () => {
    const note = (id: string, startTick: number, pitch = 60) => ({
      id,
      trackId: "t",
      startTick,
      durationTicks: 480,
      pitch,
      velocity: 1,
    });
    const a = granularSeeds([note("a", 0), note("b", 0)], 1, "t");
    const b = granularSeeds([note("x", 0), note("y", 0)], 1, "t");
    expect(a).toEqual(b); // note ids do not matter
    expect(a[0]).not.toBe(a[1]); // occurrence does
    expect(granularSeeds([note("a", 0)], 2, "t")[0]).not.toBe(a[0]);
    expect(granularSeeds([note("a", 0)], 1, "u")[0]).not.toBe(a[0]);
    // The performed start: humanize timing changes the draws too.
    expect(granularSeeds([note("a", 1)], 1, "t")[0]).not.toBe(a[0]);
  });

  test("stealing: the oldest released voice goes before a held one", () => {
    const sr = 22_050;
    const track = {
      id: "g",
      name: "g",
      instrument: "granular",
      muted: false,
      volume: 1,
      pan: 0,
      volumeAutomation: [],
      panAutomation: [],
      granular: { preset: "hold", release: 4 },
    } as unknown as Track;
    const tpb = 480;
    const context = {
      sampleRate: sr,
      samples: 6 * sr,
      samplesPerTick: (sr * 0.5) / tpb,
      tempoBpm: 120,
      ticksPerBeat: tpb,
    } as never;
    const bank = { voices: new Map(), problems: [] };
    const note = (id: string, pitch: number, start: number, beats: number) => ({
      id,
      trackId: "g",
      startTick: start * tpb,
      durationTicks: beats * tpb,
      pitch,
      velocity: 0.8,
    });
    const held = Array.from({ length: 15 }, (_, i) =>
      note(`h${i}`, 48 + i, 0, 10),
    );
    const short = note("s", 70, 1, 1);
    const late = note("l", 72, 4, 2);
    const render = (notes: ReturnType<typeof note>[]) => {
      const l = new Float64Array(6 * sr);
      const r = new Float64Array(6 * sr);
      renderGranularTrack(l, r, notes, track, context, bank);
      return l;
    };
    const all = render([...held, short, late]);
    const without = render([...held, late]);
    const from = 2 * sr + Math.ceil(0.005 * sr) + 1;
    expect(Array.from(all.subarray(from))).toEqual(
      Array.from(without.subarray(from)),
    );
  });
});

function granularScore(granular: TrackGranular, notes = [60, 64, 67]) {
  return new TrackScore({
    version: 2,
    tempoBpm: 120,
    bars: 2,
    beatsPerBar: 4,
    ticksPerBeat: 480,
    tracks: [
      {
        id: "g",
        name: "g",
        instrument: "granular",
        muted: false,
        volume: 0.8,
        pan: 0,
        granular,
      },
    ],
    notes: notes.map((pitch, i) => ({
      id: `n${i}`,
      trackId: "g",
      startTick: 0,
      durationTicks: 1920,
      pitch,
      velocity: 0.8,
    })),
  } as never);
}

const digest = (pcm: Int16Array) =>
  createHash("sha256").update(new Uint8Array(pcm.buffer)).digest("hex");

describe("granular render", () => {
  test("every preset is deterministic, audible and seed-sensitive", () => {
    for (const preset of GRANULAR_PRESET_NAMES) {
      const a = renderScorePcm(granularScore({ preset }), {
        sampleRate: 22_050,
      });
      const b = renderScorePcm(granularScore({ preset }), {
        sampleRate: 22_050,
      });
      expect(digest(a.pcm)).toBe(digest(b.pcm));
      let peak = 0;
      for (const v of a.pcm) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(1000);
      const c = renderScorePcm(granularScore({ preset, seed: 7 }), {
        sampleRate: 22_050,
      });
      expect(digest(c.pcm)).not.toBe(digest(a.pcm));
    }
  });

  test("a bare granular track plays the built-in synth source", () => {
    const pcm = renderScorePcm(granularScore({}), { sampleRate: 22_050 }).pcm;
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(1000);
  });

  test("cold note-on: first 128-frame block under 10 ms", () => {
    resetBank();
    const source = synthSource("pad", 60, SR);
    const settings = resolveGranular({ preset: "cloud" });
    const started = performance.now();
    const voice = granularVoice({
      source,
      sr: SR,
      settings,
      baseRate: 4,
      velocity: 1,
      gateFrames: SR,
      seed: 3,
    });
    const l = new Float64Array(128);
    const r = new Float64Array(128);
    voice.process(l, r, 0, 128);
    expect(performance.now() - started).toBeLessThan(10);
  });

  /**
   * Perf guard (spec test 15): steady-state swarm at 48 kHz within 7 ms per
   * voice-second (prototype 0.6-3.2 ms, about 5.3 ms on the reference Mac),
   * after a JIT warm-up. DAWG_PERF=1 asserts the spec's 7 ms on reference
   * hardware; a default run (shared x86 CI hosts measure about 10 ms) keeps
   * a 3x ceiling that still catches a hot-loop regression, as
   * live-rig.test.ts does.
   */
  test("perf guard: swarm <= 7 ms per voice-second at 48 kHz", () => {
    const source = synthSource("pad", 60, SR);
    const settings = resolveGranular({ preset: "swarm" });
    const run = (seed: number): number => {
      const voice = granularVoice({
        source,
        sr: SR,
        settings,
        baseRate: 1.26,
        velocity: 1,
        gateFrames: 2 * SR,
        seed,
      });
      const l = new Float64Array(128);
      const r = new Float64Array(128);
      const started = performance.now();
      for (let at = 0; at < 2 * SR; at += 128) voice.process(l, r, 0, 128);
      return (performance.now() - started) / 2;
    };
    for (let i = 0; i < 3; i += 1) run(i);
    let best = Infinity;
    for (let i = 0; i < 3; i += 1) best = Math.min(best, run(10 + i));
    if (process.env.DAWG_PERF_LOG) console.log({ best });
    expect(best).toBeLessThan(process.env.DAWG_PERF === "1" ? 7 : 21);
  });
});
