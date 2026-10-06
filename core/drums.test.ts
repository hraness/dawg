import { describe, expect, test } from "bun:test";
import {
  DRUM_VOICES,
  drumLane,
  drumVoiceForPitch,
  drumVoicePitch,
  isDrumInstrument,
  parseDrumVoice,
} from "./drums.ts";
import { createScore, scoreFromJSON, SCORE_LIMITS } from "./score.ts";
import { decodeLoop, encodeLoop } from "./loop.ts";

describe("drum vocabulary", () => {
  test("maps voices, aliases, and pitches to stable lanes", () => {
    expect(parseDrumVoice("BD")).toBe("kick");
    expect(parseDrumVoice("hh")).toBe("hat");
    expect(parseDrumVoice("oh")).toBe("openhat");
    expect(parseDrumVoice("cowbell")).toBeUndefined();
    for (const [lane, info] of DRUM_VOICES.entries()) {
      expect(drumVoiceForPitch(drumVoicePitch(info.voice))).toBe(info.voice);
      expect(drumLane(info.pitch)).toBe(lane);
    }
    expect(drumVoiceForPitch(99)).toBe("rim");
    expect(isDrumInstrument("Kit")).toBe(true);
    expect(isDrumInstrument("piano")).toBe(false);
    expect(isDrumInstrument(undefined)).toBe(false);
  });
});

describe("track effects codec", () => {
  test("round-trips solo, filter, delay, and filter automation", () => {
    const score = createScore({
      tracks: [
        {
          id: "drums",
          instrument: "kit",
          solo: true,
          filter: { cutoff: 1_200, resonance: 0.4 },
          delay: { beats: 0.75, feedback: 0.3, mix: 0.25 },
          filterAutomation: [
            { tick: 0, value: 400 },
            { tick: 960, value: 8_000 },
          ],
        },
      ],
    });
    const decoded = decodeLoop(encodeLoop(score));
    expect(decoded.tracks[0]).toEqual(score.tracks[0]!);
    expect(decoded.tracks[0]?.filter).toEqual({
      cutoff: 1_200,
      resonance: 0.4,
    });
  });

  test("older documents without effect fields still parse unchanged", () => {
    const legacy = scoreFromJSON({
      version: 1,
      tracks: [{ id: "main", name: "main", instrument: "sine" }],
    });
    const track = legacy.tracks[0]!;
    expect(track.solo).toBeUndefined();
    expect(track.filter).toBeUndefined();
    expect(track.delay).toBeUndefined();
    expect(track.filterAutomation).toBeUndefined();
    expect(JSON.stringify(legacy.toJSON())).not.toContain("filter");
  });

  test("rejects non-finite and out-of-range effect values", () => {
    const bad: unknown[] = [
      { filter: { cutoff: Number.NaN } },
      { filter: { cutoff: 10 } },
      { filter: { cutoff: 1_000, resonance: 2 } },
      { filter: "warm" },
      { delay: { beats: 0 } },
      { delay: { beats: 1, feedback: 0.95 } },
      { delay: { beats: 1, mix: Number.POSITIVE_INFINITY } },
      { solo: "yes" },
      { filterAutomation: [{ tick: 0, value: 50_000 }] },
    ];
    for (const fields of bad)
      expect(() =>
        scoreFromJSON({ tracks: [{ id: "main", ...(fields as object) }] }),
      ).toThrow();
    expect(SCORE_LIMITS.maxDelayFeedback).toBeLessThan(1);
  });

  test("null effects normalize away", () => {
    const score = scoreFromJSON({
      tracks: [{ id: "main", filter: null, delay: null }],
    });
    expect(score.tracks[0]?.filter).toBeUndefined();
    expect(score.tracks[0]?.delay).toBeUndefined();
  });
});
