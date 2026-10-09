import { describe, expect, test } from "bun:test";
import { expandRow, normalizeRhythmRow } from "../../core/euclid.ts";
import { findPattern } from "./drums.ts";

const onsets = (name: string, voice: string) => {
  const entry = findPattern(name)!;
  const spec = entry.rows.find((row) => row.voice === voice)!;
  const { kind: _kind, ...fields } = spec;
  return expandRow(normalizeRhythmRow(fields, name), {
    ticksPerBeat: 480,
    loopTicks: 1920,
  }).map((hit) => hit.startTick);
};

describe("shuffle feels", () => {
  test("shuffle is triplet 8ths: long-short on every beat", () => {
    const hats = onsets("shuffle", "hat");
    expect(hats).toEqual([0, 320, 480, 800, 960, 1280, 1440, 1760]);
    expect(onsets("shuffle", "kick")).toEqual([0, 960]);
    expect(onsets("shuffle", "snare")).toEqual([480, 1440]);
  });

  test("half-time-shuffle keeps swung 16ths with the backbeat on 3", () => {
    expect(onsets("half-time-shuffle", "hat")).toHaveLength(16);
    expect(onsets("half-time-shuffle", "snare")).toEqual([960]);
  });
});
