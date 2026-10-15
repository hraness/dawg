import { describe, expect, test } from "bun:test";
import { expandRow, normalizeRhythmRow } from "../../core/euclid.ts";
import { findPattern } from "./drums.ts";

const hits = (name: string, voice: string) => {
  const entry = findPattern(name)!;
  const spec = entry.rows.find((row) => row.voice === voice)!;
  const { kind: _kind, ...fields } = spec;
  return expandRow(normalizeRhythmRow(fields, name), {
    ticksPerBeat: 480,
    loopTicks: 1920,
  });
};

const onsets = (name: string, voice: string) =>
  hits(name, voice).map((hit) => hit.startTick);

// Ghost notes sit around a quarter of the row velocity; the backbeat that
// defines the feel is the loud stroke.
const accented = (name: string, voice: string) =>
  hits(name, voice)
    .filter((hit) => hit.velocity >= 0.5)
    .map((hit) => hit.startTick);

describe("the half-time shuffle feel", () => {
  test("half-time-shuffle keeps swung 16ths with the backbeat on 3", () => {
    expect(onsets("half-time-shuffle", "hat")).toHaveLength(16);
    expect(accented("half-time-shuffle", "snare")).toEqual([960]);
  });

  test("ghost snares sit on the skip partials, never on the backbeat", () => {
    // Half-time shuffle ghosts fall on the middle partial of each 8th.
    const halfTimeGhosts = hits("half-time-shuffle", "snare")
      .filter((hit) => hit.velocity < 0.5)
      .map((hit) => hit.startTick);
    for (const tick of halfTimeGhosts) expect(tick % 240).toBe(80);
  });
});
