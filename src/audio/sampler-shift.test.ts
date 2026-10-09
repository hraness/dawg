import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createScore,
  normalizeSampleRef,
  type SampleRef,
} from "../../core/score.ts";
import { clearFitCache, onFitReady, withLiveFit } from "./fit.ts";
import { planSamplerVoices, renderSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { budget } from "../../test/perf.ts";

const RATE = 16_000;

function decoded(mono: Float32Array): DecodedSample {
  return {
    sha256: "a".repeat(64),
    sampleRate: RATE,
    channels: 1,
    frames: mono.length,
    mono,
  };
}

function sine(hz: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i += 1)
    x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
}

function render(
  ref: SampleRef,
  sample: DecodedSample,
  beats = 4,
): Float64Array {
  const score = createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      {
        id: "s",
        name: "s",
        instrument: "sampler",
        sampler: { mode: "oneshot", voices: { a: ref } },
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "s",
        pitch: 36,
        velocity: 1,
        startTick: 0,
        durationTicks: 480 * beats,
      },
    ],
  });
  const timing = { score, sampleRate: RATE };
  const bank: SampleBank = {
    voices: new Map([[sampleKey("s", "a"), sample]]),
    problems: [],
  };
  const out = new Float64Array(RATE * 3);
  renderSamplerVoices(
    out,
    planSamplerVoices(score.tracks[0]!, score.notes, bank, timing),
    timing,
    () => 1,
  );
  return out;
}

/** Frequency by zero-crossing interpolation over a steady region. */
function f0(x: Float64Array, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from; i < to; i += 1)
    if (x[i - 1]! < 0 && x[i]! >= 0) {
      const t = i - 1 + -x[i - 1]! / (x[i]! - x[i - 1]!);
      if (first < 0) first = t;
      else count += 1;
      last = t;
    }
  return (count * RATE) / (last - first);
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const sha = (x: Float64Array) =>
  createHash("sha256").update(new Uint8Array(x.buffer)).digest("hex");

beforeEach(() => clearFitCache());

describe("sampler shift, formant and fades (0.6.1)", () => {
  test("shift +7 keeps the length and lands within 1 cent", () => {
    const src = decoded(sine(220, 1));
    const plain = render({ src: "a.wav" }, src);
    const up = render({ src: "a.wav", shift: 7 }, src);
    const want = 220 * 2 ** (7 / 12);
    expect(Math.abs(cents(f0(up, 3000, 12000), want))).toBeLessThan(1);
    // Same voice length: the last sounding frame matches the plain render.
    const lastNonZero = (x: Float64Array) => {
      for (let i = x.length - 1; i >= 0; i -= 1) if (x[i] !== 0) return i;
      return -1;
    };
    expect(Math.abs(lastNonZero(up) - lastNonZero(plain))).toBeLessThan(2);
  });

  test("absent fields render exactly as before; shift 0 is a no-op", () => {
    const src = decoded(sine(220, 1));
    const plain = sha(render({ src: "a.wav" }, src));
    expect(sha(render({ src: "a.wav", shift: 0 }, src))).toBe(plain);
  });

  test("fadeInTime and fadeTime shape the voice", () => {
    const src = decoded(sine(220, 1));
    const out = render({ src: "a.wav", fadeInTime: 0.1, fadeTime: 0.2 }, src);
    const peak = (from: number, to: number) => {
      let m = 0;
      for (let i = from; i < to; i += 1) m = Math.max(m, Math.abs(out[i]!));
      return m;
    };
    const full = peak(4000, 8000);
    // 25 ms into a 100 ms fade-in: about a quarter level.
    expect(peak(300, 420) / full).toBeLessThan(0.35);
    expect(peak(300, 420) / full).toBeGreaterThan(0.15);
    // The 1 s file ends with a 200 ms fade: 100 ms before the end, half.
    expect(
      peak(RATE - 0.1 * RATE - 60, RATE - 0.1 * RATE + 60) / full,
    ).toBeLessThan(0.6);
  });

  test("validation bounds and provenance", () => {
    expect(() => normalizeSampleRef({ src: "a.wav", shift: 25 }, "a")).toThrow(
      /shift/,
    );
    expect(() =>
      normalizeSampleRef({ src: "a.wav", fadeTime: 3 }, "a"),
    ).toThrow(/fadeTime/);
    const ref = normalizeSampleRef(
      {
        src: "a.wav",
        from: { score: "b".repeat(64), bars: [1, 4], source: "track:pad" },
      },
      "a",
    );
    expect(Object.keys(ref.from!)).toEqual(["source", "bars", "score"]);
    expect(() =>
      normalizeSampleRef({ src: "a.wav", from: { source: "x" } }, "a"),
    ).toThrow(/from/);
  });
});

describe("sampler shift live (0.6.1)", () => {
  test("live: a long shift plays a repitch at once, then the exact shift", async () => {
    const src = decoded(sine(220, 2));
    const ref: SampleRef = { src: "a.wav", shift: 7 };
    const want = 220 * 2 ** (7 / 12);
    const ready = new Promise<void>((resolve) => {
      const stop = onFitReady(() => {
        stop();
        resolve();
      });
    });
    const started = performance.now();
    const first = withLiveFit(() => render(ref, src));
    // The note-on does no phase-vocoder work: well inside the 10 ms budget
    // plus the plain sampler render of three seconds.
    expect(performance.now() - started).toBeLessThan(budget(50));
    expect(Math.abs(cents(f0(first, 3000, 12000), want))).toBeLessThan(1);
    await ready;
    const exact = withLiveFit(() => render(ref, src));
    expect(sha(exact)).toBe(sha(render(ref, src)));
  });
});
