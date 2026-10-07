import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { applyRhythmCommand, parseRhythmCommand } from "./rhythm.ts";

const kit = () =>
  createScore({
    bars: 1,
    tracks: [
      { id: "drums", instrument: "kit" },
      { id: "keys", instrument: "piano" },
    ],
  });

describe("rhythm grammar", () => {
  test("parses pulses, steps and named fields", () => {
    expect(parseRhythmCommand("euclid kick 4 16")).toEqual({
      type: "rhythm-set",
      voice: "kick",
      fields: { pulses: 4, steps: 16 },
    });
    expect(parseRhythmCommand("Euclid HAT 7 16 rotate 2 div 1/8T")).toEqual({
      type: "rhythm-set",
      voice: "hat",
      fields: { pulses: 7, steps: 16, rotate: 2, division: "1/8t" },
    });
    expect(parseRhythmCommand("euclid hat rot -1 prob 0.5 legato on")).toEqual({
      type: "rhythm-set",
      voice: "hat",
      fields: { rotate: -1, probability: 0.5, legato: true },
    });
    expect(parseRhythmCommand("euclid hat swing default")).toEqual({
      type: "rhythm-set",
      voice: "hat",
      fields: { swing: null },
    });
    expect(parseRhythmCommand("euclid C2 3 8")?.type).toBe("rhythm-set");
    expect(parseRhythmCommand("grid snare ....x.......x...")).toEqual({
      type: "rhythm-set",
      voice: "snare",
      fields: { grid: "....x.......x..." },
    });
    expect(parseRhythmCommand("euclid kick off")).toEqual({
      type: "rhythm-remove",
      voice: "kick",
      keepNotes: false,
    });
    expect(parseRhythmCommand("euclid kick freeze")?.type).toBe(
      "rhythm-remove",
    );
    expect(parseRhythmCommand("euclid kick bogus 1")).toBeUndefined();
    expect(parseRhythmCommand("euclid kick div 1/7x")).toBeUndefined();
    expect(parseRhythmCommand("make a beat")).toBeUndefined();
  });

  test("applies as one next score and merges fields", () => {
    let score = kit();
    const first = applyRhythmCommand(
      score,
      "drums",
      parseRhythmCommand("euclid hat 7 16")!,
    );
    expect(first).toMatchObject({ ok: true, message: "euclid · hat E(7,16)" });
    score = first.next!;
    const rotated = applyRhythmCommand(
      score,
      "drums",
      parseRhythmCommand("euclid hat rotate 2")!,
    );
    expect(rotated.next!.tracks[0]!.rhythm).toEqual([
      { voice: "hat", pulses: 7, rotate: 2 },
    ]);
    const shorter = applyRhythmCommand(
      rotated.next!,
      "drums",
      parseRhythmCommand("euclid hat steps 4")!,
    );
    expect(shorter.next!.tracks[0]!.rhythm).toEqual([
      { voice: "hat", steps: 4, rotate: 2 },
    ]);
    const grid = applyRhythmCommand(
      shorter.next!,
      "drums",
      parseRhythmCommand("grid hat x.X.")!,
    );
    expect(grid.next!.tracks[0]!.rhythm).toEqual([
      { voice: "hat", grid: "x.X." },
    ]);
    const off = applyRhythmCommand(
      grid.next!,
      "drums",
      parseRhythmCommand("euclid hat off")!,
    );
    expect(off.next!.notes).toHaveLength(0);
  });

  test("reports bad voices and ranges", () => {
    const score = kit();
    expect(
      applyRhythmCommand(score, "keys", parseRhythmCommand("euclid kick 4")!),
    ).toMatchObject({ ok: false });
    expect(
      applyRhythmCommand(
        score,
        "drums",
        parseRhythmCommand("euclid kick 20 16")!,
      ).message,
    ).toContain("pulses");
    expect(
      applyRhythmCommand(score, "drums", parseRhythmCommand("euclid kick off")!)
        .ok,
    ).toBe(false);
    const melodic = applyRhythmCommand(
      score,
      "keys",
      parseRhythmCommand("euclid C3 3 8")!,
    );
    expect(melodic.ok).toBe(true);
    expect(melodic.next!.notes.every((note) => note.pitch === 48)).toBe(true);
  });
});
