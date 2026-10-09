import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../src/project/init.ts";
import { adoptNoteIds, diffScores } from "./diff.ts";
import {
  bjorklund,
  chance,
  divisionBeats,
  euclidRot,
  expandRow,
  normalizeRhythmRow,
  patternText,
  rowSummary,
} from "./euclid.ts";
import {
  reconcileRhythm,
  refreshRhythm,
  removeRhythmRow,
  rhythmInSync,
  setRhythmRow,
  withTrackRhythm,
} from "./rhythm.ts";
import { addNote, createScore, TrackScore, updateNote } from "./score.ts";
import { evaluateProject } from "./sdk/eval.ts";
import { printProject, printTrack } from "./sdk/print.ts";

/**
 * Reference outputs of Strudel's `_euclidRot(pulses, steps, rotation)`
 * (packages/core/euclid.mjs, run against Strudel's own util.mjs). The
 * implementation was also compared exhaustively against that code for
 * steps 1..64, pulses -steps..steps, rotation -steps..steps (366,144
 * cases, no mismatch) while it was written.
 */
const STRUDEL: readonly (readonly [number, number, number, string])[] = [
  [3, 8, 0, "x..x..x."],
  [5, 8, 0, "x.xx.xx."],
  [7, 16, 0, "x..x.x.x..x.x.x."],
  [4, 16, 0, "x...x...x...x..."],
  [5, 16, 0, "x..x..x..x..x..."],
  [9, 16, 0, "x.xx.x.x.xx.x.x."],
  [3, 8, 2, "x.x..x.."],
  [5, 12, 0, "x..x.x..x.x."],
  [7, 12, 0, "x.xx.x.xx.x."],
  [2, 5, 0, "x.x.."],
  [3, 4, 0, "xxx."],
  [5, 9, 0, "x.x.x.x.x"],
  [11, 24, 0, "x..x.x.x.x.x..x.x.x.x.x."],
  [13, 24, 0, "x.xx.x.x.x.x.xx.x.x.x.x."],
  [3, 16, 3, "...x....x....x.."],
  [7, 16, -2, ".x.x.x..x.x.x.x."],
];

const text = (pattern: readonly number[]) =>
  pattern.map((on) => (on ? "x" : ".")).join("");

describe("bjorklund", () => {
  test("matches Strudel for the reference table", () => {
    for (const [pulses, steps, rotate, expected] of STRUDEL)
      expect(text(euclidRot(pulses, steps, rotate))).toBe(expected);
  });

  test("edge cases: zero, full and inverted pulses", () => {
    expect(text(bjorklund(0, 8))).toBe("........");
    expect(text(bjorklund(8, 8))).toBe("xxxxxxxx");
    expect(text(bjorklund(-3, 8))).toBe(".xx.xx.x");
    expect(bjorklund(4, 16).reduce((a, b) => a + b, 0)).toBe(4);
    expect(patternText([1, 0, 1])).toBe("x.x");
  });

  test("rotation moves the pattern later, like Strudel", () => {
    expect(text(euclidRot(1, 4, 1))).toBe(".x..");
    expect(text(euclidRot(1, 4, -1))).toBe("...x");
    expect(text(euclidRot(3, 8, 8))).toBe(text(euclidRot(3, 8, 0)));
  });
});

describe("rhythm rows", () => {
  const context = { ticksPerBeat: 480, loopTicks: 4 * 4 * 480 };

  test("normalize drops defaults and validates ranges", () => {
    expect(
      normalizeRhythmRow({ voice: "kick", pulses: 4, steps: 16, rotate: 0 }),
    ).toEqual({ voice: "kick" });
    expect(normalizeRhythmRow({ voice: "hat", pulses: 7, rotate: 2 })).toEqual({
      voice: "hat",
      pulses: 7,
      rotate: 2,
    });
    expect(() => normalizeRhythmRow({ voice: "kick", pulses: 17 })).toThrow(
      /pulses/,
    );
    expect(() => normalizeRhythmRow({ voice: "kick", bogus: 1 })).toThrow(
      /unknown field bogus/,
    );
    expect(() =>
      normalizeRhythmRow({ voice: "kick", division: "1/7x" }),
    ).toThrow(/division/);
    expect(normalizeRhythmRow({ voice: "sd", grid: "..x-" })).toEqual({
      voice: "sd",
      grid: "..x.",
    });
  });

  test("divisions are note values", () => {
    expect(divisionBeats("1/16")).toBe(0.25);
    expect(divisionBeats("1/8t")).toBeCloseTo(1 / 3);
    expect(divisionBeats("1/4")).toBe(1);
    expect(divisionBeats("nope")).toBeUndefined();
  });

  test("E(4,16) is four on the floor over four bars", () => {
    const hits = expandRow(normalizeRhythmRow({ voice: "kick" }), context);
    expect(hits.map((hit) => hit.startTick)).toEqual(
      Array.from({ length: 16 }, (_, i) => i * 480),
    );
    expect(hits.every((hit) => hit.durationTicks === 120)).toBe(true);
  });

  test("repeats fill toward the next pulse and pace bends them", () => {
    const even = expandRow(
      normalizeRhythmRow({ voice: "hat", pulses: 1, steps: 4, repeats: 3 }),
      { ticksPerBeat: 480, loopTicks: 480 },
    );
    expect(even.map((hit) => hit.startTick)).toEqual([0, 120, 240, 360]);
    const cut = expandRow(
      normalizeRhythmRow({ voice: "hat", pulses: 2, steps: 4, repeats: 3 }),
      { ticksPerBeat: 480, loopTicks: 480 },
    );
    // The second pulse at 240 cuts off the first pulse's third repeat.
    expect(cut.map((hit) => hit.startTick)).toEqual([0, 120, 240, 360]);
    const accel = expandRow(
      normalizeRhythmRow({
        voice: "hat",
        pulses: 1,
        steps: 16,
        repeats: 4,
        pace: -1,
      }),
      { ticksPerBeat: 480, loopTicks: 4 * 480 },
    );
    const gaps = accel
      .slice(1)
      .map((hit, i) => hit.startTick - accel[i]!.startTick);
    for (let i = 1; i < gaps.length; i += 1)
      expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]!);
    const ramp = expandRow(
      normalizeRhythmRow({
        voice: "hat",
        pulses: 1,
        steps: 4,
        repeats: 2,
        ramp: -1,
      }),
      { ticksPerBeat: 480, loopTicks: 480 },
    );
    expect(ramp.map((hit) => hit.velocity)).toEqual([0.8, 0.4]);
  });

  test("accents, swing and probability are deterministic", () => {
    const row = normalizeRhythmRow({
      voice: "hat",
      pulses: 8,
      steps: 16,
      accent: 1,
      accents: 2,
      swing: 0.25,
      probability: 0.5,
      seed: 7,
    });
    const first = expandRow(row, context);
    expect(expandRow(row, context)).toEqual(first);
    expect(first.length).toBeGreaterThan(8);
    expect(first.length).toBeLessThan(56);
    expect(first.some((hit) => hit.velocity === 1)).toBe(true);
    const other = expandRow({ ...row, seed: 8 }, context);
    expect(other).not.toEqual(first);
    const swung = expandRow(
      normalizeRhythmRow({ voice: "hat", pulses: 16, swing: 0.5 }),
      { ticksPerBeat: 480, loopTicks: 480 },
    );
    expect(swung.map((hit) => hit.startTick)).toEqual([0, 180, 240, 420]);
    expect(chance(1, "hat", 0, 0)).toBe(chance(1, "hat", 0, 0));
  });

  test("cycles vary successive passes", () => {
    const hits = expandRow(
      normalizeRhythmRow({
        voice: "kick",
        pulses: 4,
        cycles: [{}, { pulses: 5 }],
      }),
      { ticksPerBeat: 480, loopTicks: 8 * 480 },
    );
    expect(hits.filter((hit) => hit.pass === 0)).toHaveLength(4);
    expect(hits.filter((hit) => hit.pass === 1)).toHaveLength(5);
  });

  test("legato pulses last until the next one", () => {
    const hits = expandRow(
      normalizeRhythmRow({ voice: "kick", pulses: 3, steps: 8, legato: true }),
      { ticksPerBeat: 480, loopTicks: 960 },
    );
    expect(hits.map((hit) => hit.durationTicks)).toEqual([360, 360, 240]);
  });

  test("summary", () => {
    expect(rowSummary({ voice: "hat", pulses: 7, rotate: 2 })).toBe(
      "E(7,16,r2)",
    );
    expect(rowSummary({ voice: "sd", grid: "....x..." })).toBe("grid 8");
  });
});

function drumScore(): TrackScore {
  return createScore({
    bars: 2,
    tracks: [
      { id: "drums", name: "drums", instrument: "kit" },
      { id: "keys", name: "keys", instrument: "piano" },
    ],
    notes: [
      {
        id: "keep",
        trackId: "drums",
        startTick: 0,
        durationTicks: 120,
        pitch: 38,
        velocity: 0.8,
      },
    ],
  });
}

describe("rhythm on a score", () => {
  test("a row owns its lane and nothing else", () => {
    const score = setRhythmRow(
      drumScore(),
      "drums",
      normalizeRhythmRow({ voice: "kick", pulses: 4 }),
    );
    const kicks = score.notes.filter((note) => note.pitch === 36);
    expect(kicks).toHaveLength(8);
    expect(score.notes.find((note) => note.id === "keep")).toBeDefined();
    expect(score.tracks[0]!.rhythm).toEqual([{ voice: "kick" }]);
    expect(rhythmInSync(score, "drums")).toBe(true);
    const fewer = setRhythmRow(
      score,
      "drums",
      normalizeRhythmRow({ voice: "kick", pulses: 2 }),
    );
    expect(fewer.notes.filter((note) => note.pitch === 36)).toHaveLength(4);
    const gone = removeRhythmRow(fewer, "drums", "kick");
    expect(gone.notes.filter((note) => note.pitch === 36)).toHaveLength(0);
    expect(gone.tracks[0]!.rhythm).toBeUndefined();
    const frozen = removeRhythmRow(fewer, "drums", "kick", true);
    expect(frozen.notes.filter((note) => note.pitch === 36)).toHaveLength(4);
    expect(() =>
      setRhythmRow(score, "drums", normalizeRhythmRow({ voice: "cowbell" })),
    ).toThrow(/no voice/);
  });

  test("generation is deterministic, ids included", () => {
    const row = normalizeRhythmRow({ voice: "hat", pulses: 7, rotate: 2 });
    const a = setRhythmRow(drumScore(), "drums", row);
    const b = setRhythmRow(drumScore(), "drums", row);
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(diffScores(a, b)).toEqual([]);
  });

  test("bars changes regenerate; hand edits freeze the row", () => {
    const score = setRhythmRow(
      drumScore(),
      "drums",
      normalizeRhythmRow({ voice: "kick" }),
    );
    const longer = reconcileRhythm(score, score.withBars(4));
    expect(longer.notes.filter((note) => note.pitch === 36)).toHaveLength(16);
    const edited = addNote(score, {
      id: "extra",
      trackId: "drums",
      startTick: 240,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
    });
    const frozen = reconcileRhythm(score, edited);
    expect(frozen.tracks[0]!.rhythm).toBeUndefined();
    expect(frozen.notes.filter((note) => note.pitch === 36)).toHaveLength(9);
    expect(reconcileRhythm(score, score)).toBe(score);
    expect(refreshRhythm(score)).toBe(score);
  });

  test("expression on a generated hit is a hand edit and freezes the row", () => {
    const score = setRhythmRow(
      drumScore(),
      "drums",
      normalizeRhythmRow({ voice: "kick" }),
    );
    const kick = score.notes.find((note) => note.pitch === 36)!;
    const accented = updateNote(score, kick.id, { articulation: "accent" });
    const frozen = reconcileRhythm(score, accented);
    expect(frozen.tracks[0]!.rhythm).toBeUndefined();
    expect(frozen.notes.find((note) => note.id === kick.id)!.articulation).toBe(
      "accent",
    );
  });

  test("humanize on a generated hit is a hand edit and survives printing", () => {
    const score = setRhythmRow(
      drumScore(),
      "drums",
      normalizeRhythmRow({ voice: "kick" }),
    );
    const kick = score.notes.find((note) => note.pitch === 36)!;
    const humanized = updateNote(score, kick.id, { humanize: { timing: 20 } });
    const frozen = reconcileRhythm(score, humanized);
    expect(frozen.tracks[0]!.rhythm).toBeUndefined();
    const file = printTrack(frozen, frozen.tracks[0]!);
    expect(file).toContain("humanize");
    expect(file).not.toContain('euclid("kick", 4, 16)');
  });

  test("rows print as euclid()/grid() and round-trip through song.ts", async () => {
    let score = withTrackRhythm(drumScore(), "drums", [
      normalizeRhythmRow({ voice: "kick" }),
      normalizeRhythmRow({
        voice: "hat",
        pulses: 7,
        rotate: 2,
        velocity: 0.5,
        accent: 0.6,
        accents: 3,
        repeats: 1,
        time: "1/32",
        probability: 0.9,
        seed: 3,
        cycles: [{}, { pulses: 9, rotate: 1 }],
      }),
      normalizeRhythmRow({ voice: "openhat", grid: "..X...x." }),
    ]);
    score = refreshRhythm(score);
    const file = printTrack(score, score.tracks[0]!);
    expect(file).toContain('euclid("kick", 4, 16)');
    expect(file).toContain('grid("openhat", "..X...x.")');
    expect(file).toContain('hit("snare", 0)');
    expect(file).not.toContain('hit("kick"');
    for (const printed of printProject(score).files)
      expect(
        await prettier.format(printed.text, { parser: "typescript" }),
      ).toBe(printed.text);
    const dir = await mkdtemp(join(tmpdir(), "dawg-rhythm-"));
    try {
      await initProject(dir);
      for (const printed of printProject(score).files)
        await writeAtomic(join(dir, printed.path), printed.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.tracks[0]!.rhythm).toEqual(
        score.tracks[0]!.rhythm,
      );
      const ops = diffScores(score, adoptNoteIds(score, evaluated.score));
      expect(ops).toEqual([]);
      expect(evaluated.score.notes.length).toBe(score.notes.length);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(score).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
