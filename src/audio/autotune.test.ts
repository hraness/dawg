import { afterEach, describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import type { AutotuneCurve } from "../../core/autotune.ts";
import {
  autotuneCacheStatus,
  autotuneEngineNote,
  clearAutotuneCache,
  autotuneSpan,
  autotuneStemDigests,
  guideNotes,
  setPitchEngine,
  type PitchEngine,
} from "./autotune.ts";

const SR = 16000;
const HOP = 0.005;

/** A steady 30-cents-sharp C4 (261.63 Hz) curve over `seconds`. */
function sharpCurve(seconds: number, cents = 30): AutotuneCurve {
  const frames = Math.floor(seconds / HOP);
  const hz = 440 * 2 ** ((-900 + cents) / 1200);
  return {
    t0: 0,
    hop: HOP,
    f0: new Float32Array(frames).fill(hz),
    prob: new Uint8Array(frames).fill(255),
    aperiodic: new Uint8Array(frames),
  };
}

function fakeEngine(seconds: number) {
  const shifts: number[] = [];
  const engine: PitchEngine = {
    version: "fake1",
    curve: () => sharpCurve(seconds),
    psola: (x, _sr, curve) => {
      let sum = 0;
      for (const c of curve.cents) sum += c;
      shifts.push(sum / curve.cents.length);
      return x.map((v) => v * 0.5);
    },
  };
  return { engine, shifts };
}

function scoreWith(autotune: object, key: string | null = "C major") {
  return createScore({
    bars: 2,
    tempoBpm: 120,
    key,
    tracks: [
      {
        id: "vox",
        name: "vox",
        instrument: "saw",
        autotune,
      },
      { id: "melody", name: "melody", instrument: "saw" },
    ],
    notes: [
      {
        id: "m1",
        trackId: "melody",
        pitch: 62,
        startTick: 0,
        durationTicks: 960,
        velocity: 0.8,
      },
    ],
  } as never);
}

afterEach(() => {
  setPitchEngine(undefined);
  clearAutotuneCache();
});

describe("autotune render hooks", () => {
  const seconds = 1;
  const mono = new Float32Array(seconds * SR).fill(0.25);
  const buffer = { sha256: "a".repeat(64), sampleRate: SR, mono };
  const place = { start: 0, offset: 0, rate: 1 };

  test("without a pitch engine the buffer plays untuned", () => {
    const score = scoreWith({ preset: "hard" });
    const track = score.tracks.find((t) => t.id === "vox")!;
    expect(autotuneSpan(score, track, buffer, place).mono).toBe(mono);
  });

  test("hard pulls a 30-cent-sharp voice down toward C, then hits the cache", () => {
    const { engine, shifts } = fakeEngine(seconds);
    setPitchEngine(engine);
    const score = scoreWith({ preset: "hard" });
    const track = score.tracks.find((t) => t.id === "vox")!;
    const out = autotuneSpan(score, track, buffer, place);
    expect(out.mono).not.toBe(mono);
    expect(out.mono.length).toBe(mono.length);
    expect(out.from).toBe(0);
    expect(shifts.length).toBe(1);
    expect(shifts[0]!).toBeLessThan(-25);
    expect(shifts[0]!).toBeGreaterThan(-31);
    const again = autotuneSpan(score, track, buffer, place);
    expect(again).toBe(out);
    expect(shifts.length).toBe(1);
    expect(autotuneCacheStatus().hits).toBe(1);
  });

  test("a playback rate retunes at the pitch the buffer sounds", () => {
    const { engine, shifts } = fakeEngine(seconds);
    setPitchEngine(engine);
    const score = scoreWith({ preset: "hard" });
    const track = score.tracks.find((t) => t.id === "vox")!;
    // 30 c sharp C4 played a whole tone up sounds 30 c sharp D4: same shift.
    autotuneSpan(score, track, buffer, { ...place, rate: 2 ** (2 / 12) });
    expect(shifts[0]!).toBeLessThan(-25);
  });

  test("notes targets come from the from track in buffer time", () => {
    const { engine, shifts } = fakeEngine(seconds);
    setPitchEngine(engine);
    const score = scoreWith({ preset: "locked", from: "melody" });
    const track = score.tracks.find((t) => t.id === "vox")!;
    const notes = guideNotes(score, score.tracks[1]!);
    expect(notes.length).toBe(1);
    expect(notes[0]!.cents).toBeCloseTo(-700, 6);
    autotuneSpan(score, track, buffer, place);
    // C4+30 to D4 is +170 cents (averaged over the held note).
    expect(shifts[0]!).toBeGreaterThan(120);
  });

  test("stem digests carry the engine version and the targets", () => {
    const score = scoreWith({ preset: "guided", from: "melody" });
    const track = score.tracks.find((t) => t.id === "vox")!;
    const [version, guide] = autotuneStemDigests(track, score);
    expect(version).toBe("autotune:none");
    expect(guide).toStartWith("guide:");
    const plain = score.tracks[1]!;
    expect(autotuneStemDigests(plain, score)).toEqual([]);
  });
});
