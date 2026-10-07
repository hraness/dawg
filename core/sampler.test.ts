import { describe, expect, test } from "bun:test";
import { decodeLoop, encodeLoop } from "./loop.ts";
import {
  applyScoreOperation,
  createScore,
  normalizeSampleRef,
  normalizeSampler,
  samplerVoiceSlots,
  SCORE_LIMITS,
  ScoreValidationError,
  type Sampler,
} from "./score.ts";

const voices = {
  kick: { src: "tracks/drums/samples/kick.wav" },
  snare: { src: "tracks/drums/samples/snare.wav", gain: 0.5, choke: "sn" },
};

describe("score v2 sampler", () => {
  test("a sampler track validates, encodes and decodes unchanged", () => {
    const score = createScore({
      tracks: [
        {
          id: "d",
          name: "d",
          instrument: "sampler",
          sampler: { voices, mode: "oneshot" },
        },
      ],
    });
    const sampler = score.tracks[0]!.sampler!;
    expect(Object.keys(sampler.voices)).toEqual(["kick", "snare"]);
    expect(Object.isFrozen(sampler)).toBe(true);
    const decoded = decodeLoop(encodeLoop(score));
    expect(decoded.toJSON()).toEqual(score.toJSON());
    expect(JSON.parse(encodeLoop(score)).format).toBe("track.loop/v1");
  });

  test("documents without a sampler decode exactly as before", () => {
    const score = createScore({
      tracks: [{ id: "a", name: "a", instrument: "sine" }],
    });
    expect("sampler" in score.tracks[0]!).toBe(false);
    expect(encodeLoop(decodeLoop(encodeLoop(score)))).toBe(encodeLoop(score));
  });

  test("instrument sampler requires a sampler and vice versa", () => {
    expect(() =>
      createScore({ tracks: [{ id: "a", name: "a", instrument: "sampler" }] }),
    ).toThrow(ScoreValidationError);
    expect(() =>
      createScore({
        tracks: [
          {
            id: "a",
            name: "a",
            instrument: "sine",
            sampler: { voices, mode: "oneshot" },
          },
        ],
      }),
    ).toThrow(ScoreValidationError);
  });

  test("normalizeSampler enforces every limit from unknown input", () => {
    expect(normalizeSampler(undefined)).toBeUndefined();
    expect(normalizeSampler(null)).toBeUndefined();
    expect(() => normalizeSampler({ voices: { a: "nope" } })).toThrow(
      ScoreValidationError,
    );
    expect(() => normalizeSampler({ voices: {} })).toThrow(
      ScoreValidationError,
    );
    expect(() =>
      normalizeSampler({ voices: { "bad name": { src: "x.wav" } } }),
    ).toThrow();
    expect(() =>
      normalizeSampler({ voices: { a: { src: "../x.wav" } } }),
    ).toThrow();
    expect(() =>
      normalizeSampler({ voices: { a: { src: "/abs.wav" } } }),
    ).toThrow();
    expect(() =>
      normalizeSampler({ voices: { a: { src: "x.wav" } }, mode: "granular" }),
    ).toThrow();
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= SCORE_LIMITS.maxSamplerVoices; i += 1)
      many[`v${i}`] = { src: "x.wav" };
    expect(() => normalizeSampler({ voices: many })).toThrow();
    const sorted = normalizeSampler({
      voices: { b: { src: "b.wav" }, a: { src: "a.wav" } },
    })!;
    expect(Object.keys(sorted.voices)).toEqual(["a", "b"]);
    expect(sorted.mode).toBe("oneshot");
  });

  test("normalizeSampleRef bounds every field", () => {
    const ref = normalizeSampleRef(
      {
        src: "s.wav",
        sha256: "a".repeat(64),
        root: 60,
        begin: 0.25,
        end: 0.5,
        gain: 1.5,
        speed: -2,
        loop: true,
        choke: "g",
      },
      "v",
    );
    expect(ref).toEqual({
      src: "s.wav",
      sha256: "a".repeat(64),
      root: 60,
      begin: 0.25,
      end: 0.5,
      gain: 1.5,
      speed: -2,
      loop: true,
      choke: "g",
    });
    const bad = [
      { src: "s.wav", sha256: "zz" },
      { src: "s.wav", root: 128 },
      { src: "s.wav", begin: 0.5, end: 0.5 },
      { src: "s.wav", begin: -0.1 },
      { src: "s.wav", end: 1.1 },
      { src: "s.wav", gain: SCORE_LIMITS.maxSampleGain + 0.1 },
      { src: "s.wav", speed: 0 },
      { src: "s.wav", speed: SCORE_LIMITS.maxSampleSpeed + 1 },
      { src: "s.wav", loop: "yes" },
      { src: "s.wav", choke: "x".repeat(SCORE_LIMITS.maxChokeGroupLength + 1) },
      { src: "x".repeat(SCORE_LIMITS.maxSamplePathLength + 1) },
      {},
    ];
    for (const input of bad)
      expect(() => normalizeSampleRef(input, "v")).toThrow(
        ScoreValidationError,
      );
  });

  test("one-shot voices get pitch slots from 36 in name order; keyed get none", () => {
    const sampler: Sampler = { voices, mode: "oneshot" };
    expect([...samplerVoiceSlots(sampler)]).toEqual([
      ["kick", 36],
      ["snare", 37],
    ]);
    expect(samplerVoiceSlots({ voices, mode: "keyed" }).size).toBe(0);
  });
});

describe("new score operations", () => {
  const base = createScore({
    key: "C major",
    tracks: [
      { id: "a", name: "a", instrument: "sine" },
      { id: "b", name: "b", instrument: "sine" },
      { id: "c", name: "c", instrument: "sine" },
    ],
    notes: [
      {
        id: "n1",
        trackId: "a",
        startTick: 0,
        durationTicks: 120,
        pitch: 60,
        velocity: 0.8,
      },
      {
        id: "n2",
        trackId: "b",
        startTick: 0,
        durationTicks: 120,
        pitch: 60,
        velocity: 0.8,
      },
    ],
  });

  test("removeTrack drops the track and its notes", () => {
    const next = applyScoreOperation(base, {
      type: "removeTrack",
      trackId: "a",
    });
    expect(next.tracks.map((t) => t.id)).toEqual(["b", "c"]);
    expect(next.notes.map((n) => n.id)).toEqual(["n2"]);
    expect(
      applyScoreOperation(base, { type: "removeTrack", trackId: "zz" }),
    ).toBe(base);
  });

  test("moveTrack reorders with a clamped index", () => {
    expect(
      applyScoreOperation(base, {
        type: "moveTrack",
        trackId: "c",
        index: 0,
      }).tracks.map((t) => t.id),
    ).toEqual(["c", "a", "b"]);
    expect(
      applyScoreOperation(base, {
        type: "moveTrack",
        trackId: "a",
        index: 99,
      }).tracks.map((t) => t.id),
    ).toEqual(["b", "c", "a"]);
    expect(() =>
      applyScoreOperation(base, { type: "moveTrack", trackId: "zz", index: 0 }),
    ).toThrow(ScoreValidationError);
  });

  test("setKey and setMeter keep notes in place", () => {
    const keyed = applyScoreOperation(base, { type: "setKey", key: null });
    expect(keyed.key).toBeNull();
    const meter = applyScoreOperation(base, {
      type: "setMeter",
      beatsPerBar: 3,
    });
    expect(meter.beatsPerBar).toBe(3);
    expect(meter.notes).toEqual(base.notes);
    expect(() =>
      applyScoreOperation(base, { type: "setMeter", beatsPerBar: 0 }),
    ).toThrow();
  });
});
