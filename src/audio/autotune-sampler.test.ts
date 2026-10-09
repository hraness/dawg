import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AutotuneCurve } from "../../core/autotune.ts";
import { builtinPitchEngine } from "./autotune-engine.ts";
import { createScore, type SampleRef } from "../../core/score.ts";
import {
  autotuneCacheStatus,
  autotuneSpan,
  clearAutotuneCache,
  setPitchEngine,
  type PitchEngine,
  type TunableBuffer,
} from "./autotune.ts";
import { chordTimeline } from "./granular.ts";
import { clearFitCache, onFitReady, withLiveFit } from "./fit.ts";
import { planSamplerVoices, renderSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";

const RATE = 16_000;
const HOP = 0.005;

function sine(hz: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i += 1)
    x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
}

function decoded(mono: Float32Array, stereo = false): DecodedSample {
  return {
    sha256: "b".repeat(64),
    sampleRate: RATE,
    channels: stereo ? 2 : 1,
    frames: mono.length,
    mono,
    ...(stereo
      ? { left: mono.map((v) => v * 0.9), right: mono.map((v) => v * 0.7) }
      : {}),
  };
}

/** A fake engine: a curve 30 c sharp of C4; psola scales by 1 + mean/1000. */
function fakeEngine() {
  const ids: string[] = [];
  const engine: PitchEngine = {
    version: "fake-s1",
    curve: (buffer: TunableBuffer) => {
      ids.push(buffer.id ?? buffer.sha256 ?? "anon");
      const frames = Math.floor(buffer.mono.length / buffer.sampleRate / HOP);
      return {
        t0: 0,
        hop: HOP,
        f0: new Float32Array(frames).fill(440 * 2 ** (-870 / 1200)),
        prob: new Uint8Array(frames).fill(255),
        aperiodic: new Uint8Array(frames),
      } satisfies AutotuneCurve;
    },
    psola: (x, _sr, curve) => {
      let sum = 0;
      for (const c of curve.cents) sum += c;
      const k = 1 + sum / curve.cents.length / 1000;
      return x.map((v) => v * k);
    },
  };
  return { engine, ids };
}

function scoreOf(
  voices: Record<string, SampleRef>,
  autotune?: object,
  notePitches = [36],
) {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    key: "C major",
    tracks: [
      {
        id: "s",
        name: "s",
        instrument: "sampler",
        sampler: { mode: "oneshot", voices },
        ...(autotune ? { autotune } : {}),
      },
    ],
    notes: notePitches.map((pitch, i) => ({
      id: `n${i}`,
      trackId: "s",
      pitch,
      velocity: 1,
      startTick: i * 960,
      durationTicks: 960,
    })),
  } as never);
}

function render(
  score: ReturnType<typeof scoreOf>,
  bank: SampleBank,
): Float64Array {
  const timing = { score, sampleRate: RATE };
  const out = new Float64Array(RATE * 5);
  renderSamplerVoices(
    out,
    planSamplerVoices(score.tracks[0]!, score.notes, bank, timing),
    timing,
    () => 1,
  );
  return out;
}

const sha = (x: Float64Array) =>
  createHash("sha256").update(Buffer.from(x.buffer)).digest("hex");

// Each test installs the engine it needs; the default comes back after.
beforeEach(() => setPitchEngine(undefined));
afterEach(() => {
  setPitchEngine(builtinPitchEngine);
  clearAutotuneCache();
  clearFitCache();
});

describe("autotune through the sampler", () => {
  const src = decoded(sine(261.63, 1.5));
  const bankOf = (names: string[], sample = src): SampleBank => ({
    voices: new Map(names.map((n) => [sampleKey("s", n), sample])),
    problems: [],
  });

  test("without an engine a track with autotune renders like one without", () => {
    const plain = render(scoreOf({ a: { src: "a.wav" } }), bankOf(["a"]));
    const tuned = render(
      scoreOf({ a: { src: "a.wav" } }, { preset: "hard" }),
      bankOf(["a"]),
    );
    expect(sha(tuned)).toBe(sha(plain));
  });

  test("an engine changes the audio; cold and warm renders match", () => {
    const { engine } = fakeEngine();
    setPitchEngine(engine);
    const score = scoreOf({ a: { src: "a.wav" } }, { preset: "hard" });
    const plain = render(scoreOf({ a: { src: "a.wav" } }), bankOf(["a"]));
    const cold = render(score, bankOf(["a"]));
    expect(sha(cold)).not.toBe(sha(plain));
    const hits = autotuneCacheStatus().hits;
    const warm = render(score, bankOf(["a"]));
    expect(autotuneCacheStatus().hits).toBeGreaterThan(hits);
    expect(sha(warm)).toBe(sha(cold));
  });

  test("shift 0 and shift 3 refs of one sample tune separately", () => {
    const { engine, ids } = fakeEngine();
    setPitchEngine(engine);
    const score = scoreOf(
      { a: { src: "a.wav" }, b: { src: "a.wav", shift: 3 } },
      { preset: "hard" },
      [36, 37],
    );
    render(score, bankOf(["a", "b"]));
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((id) => id.startsWith("b".repeat(64)))).toBe(true);
    expect(ids.some((id) => !id.startsWith("b".repeat(64)))).toBe(true);
  });

  test("a stereo from-ref keeps both tuned channels", () => {
    const { engine } = fakeEngine();
    setPitchEngine(engine);
    const stereo = decoded(sine(261.63, 1.5), true);
    const buffer: TunableBuffer = {
      sha256: stereo.sha256,
      sampleRate: RATE,
      mono: stereo.mono,
      left: stereo.left!,
      right: stereo.right!,
    };
    const score = scoreOf({ a: { src: "a.wav" } }, { preset: "hard" });
    const out = autotuneSpan(score, score.tracks[0]!, buffer, {
      start: 0,
      offset: 0,
      rate: 1,
    });
    expect(out.left).toBeDefined();
    expect(out.right).toBeDefined();
    expect(out.left![100]!).not.toBe(out.right![100]!);
  });

  test("timed targets tune only the span a voice reads", () => {
    const { engine } = fakeEngine();
    setPitchEngine(engine);
    const long = { ...src, mono: sine(261.63, 4) } as DecodedSample;
    const buffer: TunableBuffer = {
      sha256: long.sha256,
      sampleRate: RATE,
      mono: long.mono,
    };
    const score = scoreOf(
      { a: { src: "a.wav" } },
      { preset: "pop", to: "chord" },
    );
    const out = autotuneSpan(
      score,
      score.tracks[0]!,
      buffer,
      { start: 0, offset: 1, rate: 1 },
      "",
      { from: RATE, to: RATE * 1.5 },
    );
    expect(out.mono.length).toBeLessThan(RATE);
    expect(out.from).toBeGreaterThan(RATE * 0.9);
  });

  test("live: a long span plays untuned, then tunes in slices to the cold result", async () => {
    const { engine } = fakeEngine();
    setPitchEngine(engine);
    const long = sine(261.63, 10);
    const buffer: TunableBuffer = {
      id: "live10",
      sampleRate: RATE,
      mono: long,
    };
    const score = scoreOf({ a: { src: "a.wav" } }, { preset: "hard" });
    const place = { start: 0, offset: 0, rate: 1 };
    const t0 = performance.now();
    const first = withLiveFit(() =>
      autotuneSpan(score, score.tracks[0]!, buffer, place),
    );
    expect(performance.now() - t0).toBeLessThan(50);
    expect(first.mono).toBe(long);
    await new Promise<void>((resolve) => {
      const off = onFitReady(() => {
        if (autotuneCacheStatus().entries > 0) {
          off();
          resolve();
        }
      });
    });
    const ready = withLiveFit(() =>
      autotuneSpan(score, score.tracks[0]!, buffer, place),
    );
    clearAutotuneCache();
    const cold = autotuneSpan(score, score.tracks[0]!, buffer, place);
    expect(ready.mono).not.toBe(long);
    expect(
      Buffer.from(ready.mono.buffer).equals(Buffer.from(cold.mono.buffer)),
    ).toBe(true);
  });
});

describe("autotune chord target", () => {
  test("the tuned track's own guide notes never count as chord tones", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      key: "C major",
      tracks: [
        {
          id: "vox",
          name: "vox",
          instrument: "sampler",
          sampler: { mode: "oneshot", voices: { a: { src: "a.wav" } } },
          autotune: { preset: "hard", to: "chord" },
        },
        { id: "keys", name: "keys", instrument: "saw" },
      ],
      notes: [
        ...[60, 64, 67].map((pitch, i) => ({
          id: `c${i}`,
          trackId: "keys",
          pitch,
          velocity: 0.8,
          startTick: 0,
          durationTicks: 1920,
        })),
        {
          id: "f",
          trackId: "vox",
          pitch: 65,
          velocity: 0.8,
          startTick: 0,
          durationTicks: 1920,
        },
      ],
    } as never);
    // the shared timeline sees F; the autotune plan must not
    expect(chordTimeline(score)).toBeDefined();
    const shifts: number[] = [];
    setPitchEngine({
      version: "fake-c1",
      curve: (b) => {
        const frames = Math.floor(b.mono.length / b.sampleRate / HOP);
        return {
          t0: 0,
          hop: HOP,
          // F4 sung 20 c sharp: E is 120 c below, G 180 c above
          f0: new Float32Array(frames).fill(440 * 2 ** (-380 / 1200)),
          prob: new Uint8Array(frames).fill(255),
          aperiodic: new Uint8Array(frames),
        };
      },
      psola: (x, _sr, curve) => {
        let sum = 0;
        for (const c of curve.cents) sum += c;
        shifts.push(sum / curve.cents.length);
        return x;
      },
    });
    autotuneSpan(
      score,
      score.tracks[0]!,
      { id: "f", sampleRate: RATE, mono: sine(349.23, 1) },
      { start: 0, offset: 0, rate: 1 },
      "",
      { from: 0, to: RATE },
    );
    // pulled to E (about -120 c), not left on F (-20 c)
    expect(shifts[0]!).toBeLessThan(-80);
  });
});
