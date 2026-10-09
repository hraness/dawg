import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  engineFor,
  engineTailSeconds,
  registerEngine,
  registeredEngines,
  unregisterEngine,
  type InstrumentEngine,
} from "./instruments.ts";
import { LiveSynth } from "./live.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";

const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

const calls: { notes: number; stereo: boolean }[] = [];
let digest = "asset-1";

/** A stub engine: a constant 0.25 DC level for each note's length. */
const stub: InstrumentEngine = {
  id: "stubtone",
  field: "filter",
  render(dry, dryR, notes, _track, context) {
    calls.push({ notes: notes.length, stereo: dryR !== undefined });
    for (const note of notes) {
      const start = Math.round(note.startTick * context.samplesPerTick);
      const end = Math.min(
        dry.length,
        Math.round(
          (note.startTick + note.durationTicks) * context.samplesPerTick,
        ),
      );
      for (let i = start; i < end; i += 1) {
        dry[i]! += 0.25;
        if (dryR) dryR[i]! -= 0.25;
      }
    }
  },
  tailSeconds: () => 3,
  stereo: () => true,
  assetDigests: () => [digest],
};

function song(instrument: string, filter: boolean): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "a",
        name: "a",
        instrument,
        ...(filter ? { filter: { cutoff: 18000, resonance: 0 } } : {}),
      },
    ],
    notes: [
      {
        id: "n1",
        trackId: "a",
        pitch: 60,
        startTick: 0,
        durationTicks: 96,
        velocity: 0.8,
      },
    ],
  });
}

afterEach(() => {
  unregisterEngine("stubtone");
  calls.length = 0;
  digest = "asset-1";
});

describe("instrument engine registry", () => {
  test("dispatches only on instrument id AND its Track field", () => {
    const withField = song("stubtone", true).tracks[0]!;
    const bare = song("stubtone", false).tracks[0]!;
    expect(engineFor(withField)).toBeUndefined();
    registerEngine(stub);
    expect(registeredEngines()).toContain("stubtone");
    expect(engineFor(withField)).toBe(stub);
    expect(engineFor(bare)).toBeUndefined();
    expect(engineFor(song("pluck", true).tracks[0]!)).toBeUndefined();
    expect(engineTailSeconds(withField)).toBe(3);
    expect(engineTailSeconds(bare)).toBe(0);
    expect(() => registerEngine(stub)).toThrow();
  });

  test("an unregistered engine leaves renders byte-identical", () => {
    const score = song("stubtone", true);
    const before = renderScorePcm(score, { sampleRate: 22050 });
    registerEngine(stub);
    unregisterEngine("stubtone");
    const after = renderScorePcm(score, { sampleRate: 22050 });
    expect(sha(after.pcm)).toBe(sha(before.pcm));
    expect(calls).toHaveLength(0);
  });

  test("render dispatches to the engine, stereo, with its tail", () => {
    const score = song("stubtone", true);
    const plain = renderScorePcm(score, { sampleRate: 22050 });
    registerEngine(stub);
    const one = renderScorePcm(score, { sampleRate: 22050 });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ notes: 1, stereo: true });
    // The 3 s engine tail lengthens a one-shot render.
    expect(one.pcm.length).toBeGreaterThan(plain.pcm.length);
    // Left positive, right negative: the engine wrote a stereo dry pair.
    const mid = 2 * 2000;
    expect(one.pcm[mid]!).toBeGreaterThan(0);
    expect(one.pcm[mid + 1]!).toBeLessThan(0);
    // Deterministic.
    expect(sha(renderScorePcm(score, { sampleRate: 22050 }).pcm)).toBe(
      sha(one.pcm),
    );
    // A bare legacy track keeps today's voice even with the engine registered.
    const bare = song("stubtone", false);
    unregisterEngine("stubtone");
    const bareBefore = sha(renderScorePcm(bare, { sampleRate: 22050 }).pcm);
    registerEngine(stub);
    expect(sha(renderScorePcm(bare, { sampleRate: 22050 }).pcm)).toBe(
      bareBefore,
    );
  });

  test("asset digests join the stem cache key", () => {
    registerEngine(stub);
    const score = song("stubtone", true);
    const stems = new StemRenderer();
    stems.render(score, { sampleRate: 22050 });
    const first = calls.length;
    stems.render(score, { sampleRate: 22050 });
    expect(calls.length).toBe(first);
    digest = "asset-2";
    stems.render(score, { sampleRate: 22050 });
    expect(calls.length).toBeGreaterThan(first);
  });

  test("live notes carry the engine tail as their release", () => {
    registerEngine(stub);
    const score = song("stubtone", true);
    const live = new LiveSynth(22050);
    const note = live.render({
      score,
      trackId: "a",
      pitch: 60,
      velocity: 0.8,
      seconds: 0.2,
    });
    expect(note?.releaseSeconds).toBe(3);
    unregisterEngine("stubtone");
    const plain = new LiveSynth(22050).render({
      score,
      trackId: "a",
      pitch: 60,
      velocity: 0.8,
      seconds: 0.2,
    });
    expect(plain).toBeDefined();
    expect(plain?.releaseSeconds).toBeUndefined();
  });
});
