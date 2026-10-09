import { describe, expect, test } from "bun:test";
// Registers vocoder.src as an audio edge (cycle checks, removeTrack drops).
import "./routing.ts";
import {
  createScore,
  removeTrack,
  SCORE_LIMITS,
  updateTrack,
  type TrackInput,
} from "./score.ts";
import { normalizeVocoder, resolveVocoder } from "./vocoder.ts";

const synth = (id: string, extra: Partial<TrackInput> = {}): TrackInput => ({
  id,
  name: id,
  instrument: "supersaw",
  ...extra,
});

const song = (tracks: TrackInput[]) =>
  createScore({ tempoBpm: 120, bars: 1, tracks, notes: [] });

describe("vocoder field (spec tests 4 and 5)", () => {
  test("4: out-of-range values, unknown keys and bad src are rejected", () => {
    for (const bad of [
      { bands: 3 },
      { bands: 41 },
      { formant: 25 },
      { formant: -25 },
      { nope: 1 },
      { src: "" },
      { preset: "nope" },
      { tap: "wet" },
    ])
      expect(() => normalizeVocoder(bad), JSON.stringify(bad)).toThrow();
    expect(() => normalizeVocoder(7)).toThrow(/object/);
  });

  test("4: bands round to a whole count; talkbox formant clamps on resolve", () => {
    expect(normalizeVocoder({ bands: 16.4 })).toEqual({ bands: 16 });
    expect(resolveVocoder({ preset: "talkbox", formant: 13 }).formant).toBe(12);
    expect(resolveVocoder({ formant: 13 }).formant).toBe(13);
  });

  test("4: self src, cycles and too many vocoder tracks fail the score", () => {
    expect(() => song([synth("a", { vocoder: { src: "a" } })])).toThrow();
    expect(() =>
      song([
        synth("a", { vocoder: { src: "b", tap: "chain" } }),
        synth("b", { vocoder: { src: "a", tap: "chain" } }),
      ]),
    ).toThrow(/cycle/);
    const many = Array.from(
      { length: SCORE_LIMITS.maxVocoderTracks + 1 },
      (_, i) => synth(`t${i}`, { vocoder: {} }),
    );
    expect(() => song(many)).toThrow(/vocoder/);
    expect(() => song(many.slice(1))).not.toThrow();
  });

  test("5: null removes; removeTrack drops a dangling src in one op", () => {
    const before = song([
      synth("vox", { instrument: "sine" }),
      synth("lead", { vocoder: { src: "vox", mix: 0.8 } }),
    ]);
    const json = JSON.stringify(before.toJSON());
    const off = updateTrack(before, "lead", { vocoder: null });
    expect(off.tracks[1]!.vocoder).toBeUndefined();
    const removed = removeTrack(before, "vox");
    expect(removed.tracks.map((t) => [t.id, t.vocoder])).toEqual([
      ["lead", { mix: 0.8 }],
    ]);
    // Undo restores the previous score snapshot: both edits left it intact.
    expect(JSON.stringify(before.toJSON())).toBe(json);
    expect(before.tracks[1]!.vocoder).toEqual({ src: "vox", mix: 0.8 });
  });
});
