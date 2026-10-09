import { beforeEach, describe, expect, test } from "bun:test";
import {
  createScore,
  type NoteInput,
  type SampleRef,
} from "../../core/score.ts";
import { detectOnsets, suggestFitMode } from "./dsp/onset.ts";
import { seededRandom } from "./dsp/rng.ts";
import {
  clearFitCache,
  fitCacheBytes,
  fitting,
  onFitReady,
  withLiveFit,
} from "./fit.ts";
import { planSamplerVoices, renderSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { sampleWarpFor } from "./warp.ts";

const RATE = 16_000;

function decoded(mono: Float32Array, sha = "f"): DecodedSample {
  return {
    sha256: sha.repeat(64).slice(0, 64),
    sampleRate: RATE,
    channels: 1,
    frames: mono.length,
    mono,
  };
}

function bankOf(sample: DecodedSample): SampleBank {
  return { voices: new Map([[sampleKey("s", "loop"), sample]]), problems: [] };
}

function scoreWith(
  ref: SampleRef,
  bpm: number,
  bars: number,
  note: Omit<NoteInput, "trackId" | "id" | "pitch" | "velocity">,
) {
  return createScore({
    tempoBpm: bpm,
    bars,
    tracks: [
      {
        id: "s",
        name: "s",
        instrument: "sampler",
        sampler: { mode: "oneshot", voices: { loop: ref } },
      },
    ],
    notes: [{ id: "n", trackId: "s", pitch: 36, velocity: 1, ...note }],
  });
}

function render(
  score: ReturnType<typeof scoreWith>,
  sample: DecodedSample,
  frames: number,
): Float64Array {
  const warp = sampleWarpFor(score, RATE);
  const timing = { score, sampleRate: RATE, ...(warp ? { warp } : {}) };
  const out = new Float64Array(frames);
  renderSamplerVoices(
    out,
    planSamplerVoices(score.tracks[0]!, score.notes, bankOf(sample), timing),
    timing,
    () => 1,
  );
  return out;
}

/** Seeded drum hits (decaying noise) at the given frames. */
function hits(
  frames: number,
  at: readonly number[],
  seed = "brk",
): Float32Array {
  const rnd = seededRandom(seed);
  const x = new Float32Array(frames);
  const len = Math.round(0.06 * RATE);
  for (const start of at)
    for (let i = 0; i < len && start + i < frames; i += 1)
      x[start + i] = (rnd() * 2 - 1) * 0.8 * Math.exp(-i / (0.012 * RATE));
  return x;
}

function sine(hz: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i += 1)
    x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
}

/** Frequency from interpolated rising zero crossings over [from, to). */
function pitchHz(x: Float64Array, from: number, to: number): number {
  const crossings: number[] = [];
  for (let i = from; i < to - 1; i += 1)
    if (x[i]! <= 0 && x[i + 1]! > 0)
      crossings.push(i + x[i]! / (x[i]! - x[i + 1]!));
  const cycles = crossings.length - 1;
  return (cycles * RATE) / (crossings[cycles]! - crossings[0]!);
}

function rms(x: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / (to - from));
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

beforeEach(() => clearFitCache());

describe("onset detection", () => {
  test("finds every hit of a break within 2 ms, including t = 0", () => {
    const beat = (60 / 174) * RATE;
    const at = Array.from({ length: 16 }, (_, i) => Math.round((i * beat) / 2));
    const found = detectOnsets(hits(Math.round(8 * beat) + RATE, at), RATE);
    expect(found.length).toBe(at.length);
    for (let i = 0; i < at.length; i += 1)
      expect(Math.abs(found[i]! - at[i]!)).toBeLessThanOrEqual(0.002 * RATE);
  });

  test("hits closer than 30 ms merge (flam)", () => {
    const found = detectOnsets(hits(RATE, [1000, 1000 + 0.015 * RATE]), RATE);
    expect(found.length).toBe(1);
  });

  test("suggests beats for drums and tones for a held note", () => {
    const beat = (60 / 120) * RATE;
    const at = Array.from({ length: 16 }, (_, i) => Math.round((i * beat) / 2));
    expect(suggestFitMode(hits(Math.round(4 * RATE), at), RATE)).toBe("beats");
    expect(suggestFitMode(sine(220, 4), RATE)).toBe("tones");
  });
});

describe("fitmode beats", () => {
  test("a 174 BPM break fitted to 128 BPM keeps every hit within 2 ms", () => {
    const beat = (60 / 174) * RATE;
    const at = Array.from({ length: 16 }, (_, i) => Math.round((i * beat) / 2));
    const src = decoded(hits(Math.round(8 * beat), at));
    const score = scoreWith(
      { src: "b.wav", bpm: 174, fitmode: "beats" },
      128,
      2,
      {
        startTick: 0,
        durationTicks: 8 * 480,
      },
    );
    const out = render(score, src, Math.round(4.2 * RATE));
    const found = detectOnsets(out, RATE);
    const want = at.map((v) => (v * 174) / 128);
    expect(found.length).toBe(want.length);
    for (let i = 0; i < want.length; i += 1)
      expect(Math.abs(found[i]! - want[i]!)).toBeLessThanOrEqual(0.002 * RATE);
    // Transients are copied verbatim: the first hit matches the unfitted voice.
    const plain = render(
      scoreWith({ src: "b.wav" }, 128, 2, {
        startTick: 0,
        durationTicks: 8 * 480,
      }),
      src,
      400,
    );
    for (let i = 0; i < 200; i += 1) expect(out[i]).toBeCloseTo(plain[i]!, 6);
  });

  test("stays in sync within 1 ms over 64 bars of a tempo ramp", () => {
    const srcBpm = 120;
    const beats = 64 * 4;
    const beat = (60 / srcBpm) * RATE;
    const at = Array.from({ length: beats }, (_, i) => Math.round(i * beat));
    const src = decoded(hits(Math.round(beats * beat), at, "click"));
    const base = scoreWith(
      { src: "c.wav", bpm: srcBpm, fitmode: "beats" },
      120,
      64,
      {
        startTick: 0,
        durationTicks: beats * 480,
      },
    );
    const score = base.withTime({
      tempo: [{ tick: beats * 480, bpm: 150, ramp: "linear" }],
    });
    const warp = sampleWarpFor(score, RATE)!;
    const out = render(score, src, Math.ceil(warp.sample(beats * 480)) + RATE);
    // Hits are separated by silence: each one starts at its first non-zero frame.
    const found: number[] = [];
    for (let i = 0; i < out.length; i += 1)
      if (out[i] !== 0 && (i === 0 || out[i - 1] === 0)) {
        if (found.length === 0 || i - found[found.length - 1]! > 0.1 * RATE)
          found.push(i);
      }
    expect(found.length).toBe(beats);
    let worst = 0;
    for (let i = 0; i < beats; i += 1)
      worst = Math.max(worst, Math.abs(found[i]! - warp.sample(i * 480)));
    expect(worst).toBeLessThanOrEqual(0.001 * RATE);
  });
});

describe("fitmode tones", () => {
  for (const ratio of [0.5, 2]) {
    test(`keeps pitch within 1 cent and level within 2.5 dB at time ratio ${ratio}`, () => {
      const seconds = 2;
      const src = decoded(sine(440, seconds));
      // 120 BPM: 4 beats of source; len 4 / ratio stretches it to `ratio`× time.
      const score = scoreWith(
        { src: "t.wav", len: 4 * ratio, fitmode: "tones" },
        120,
        4,
        {
          startTick: 0,
          durationTicks: 16 * 480,
        },
      );
      const length = Math.round(seconds * ratio * RATE);
      const out = render(score, src, length + RATE);
      const plain = render(
        scoreWith({ src: "t.wav" }, 120, 4, {
          startTick: 0,
          durationTicks: 16 * 480,
        }),
        src,
        src.frames,
      );
      const from = Math.round(0.15 * RATE);
      const to = length - Math.round(0.15 * RATE);
      expect(Math.abs(cents(pitchHz(out, from, to), 440))).toBeLessThan(1);
      const db =
        20 *
        Math.log10(rms(out, from, to) / rms(plain, from, src.frames - from));
      expect(Math.abs(db)).toBeLessThan(2.5);
    });
  }

  test("repitch moves pitch with speed (tape)", () => {
    const src = decoded(sine(440, 2));
    const score = scoreWith({ src: "t.wav", bpm: 120 }, 60, 4, {
      startTick: 0,
      durationTicks: 8 * 480,
    });
    const out = render(score, src, 5 * RATE);
    expect(Math.abs(cents(pitchHz(out, RATE, 3 * RATE), 220))).toBeLessThan(1);
  });
});

describe("fit cache and live", () => {
  test("renders are deterministic and cached", () => {
    const src = decoded(sine(330, 1));
    const score = scoreWith(
      { src: "t.wav", len: 4, fitmode: "tones" },
      100,
      2,
      {
        startTick: 0,
        durationTicks: 4 * 480,
      },
    );
    const a = render(score, src, 3 * RATE);
    expect(fitCacheBytes()).toBeGreaterThan(0);
    const b = render(score, src, 3 * RATE);
    clearFitCache();
    const c = render(score, src, 3 * RATE);
    expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
    expect(Buffer.from(c.buffer).equals(Buffer.from(a.buffer))).toBe(true);
  });

  test("short live windows fit synchronously within 160 ms", () => {
    const src = decoded(sine(330, 8));
    const score = scoreWith(
      { src: "t.wav", bpm: 100, fitmode: "tones" },
      120,
      8,
      {
        startTick: 0,
        durationTicks: 16 * 480,
      },
    );
    const t0 = performance.now();
    const out = withLiveFit(() => render(score, src, RATE));
    expect(performance.now() - t0).toBeLessThan(160 * (48_000 / RATE));
    expect(rms(out, 0, RATE)).toBeGreaterThan(0.1);
    expect(fitting()).toBe(false);
  });

  test("long live windows stay silent while fitting, then play", async () => {
    const src = decoded(sine(330, 10));
    const score = scoreWith(
      { src: "t.wav", bpm: 100, fitmode: "tones" },
      120,
      8,
      {
        startTick: 0,
        durationTicks: 16 * 480,
      },
    );
    const ready = new Promise<void>((resolve) => {
      const stop = onFitReady(() => {
        stop();
        resolve();
      });
    });
    const silent = withLiveFit(() => render(score, src, RATE));
    expect(rms(silent, 0, RATE)).toBe(0);
    expect(fitting()).toBe(true);
    await ready;
    expect(fitting()).toBe(false);
    const playing = withLiveFit(() => render(score, src, RATE));
    expect(
      Buffer.from(playing.buffer).equals(
        Buffer.from(render(score, src, RATE).buffer),
      ),
    ).toBe(true);
    expect(rms(playing, 0, RATE)).toBeGreaterThan(0.1);
  });
});
