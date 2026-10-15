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
  FLAM_GRACE_VELOCITY,
  flamTicks,
  GHOST_VELOCITY,
  normalizeRhythmRow,
  patternText,
  rowPattern,
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

  test("ghost steps play at GHOST_VELOCITY and are never accented", () => {
    // Drum and sampler gain is linear in velocity: 12..18 dB below a hit.
    const db = 20 * Math.log10(GHOST_VELOCITY);
    expect(db).toBeLessThanOrEqual(-12);
    expect(db).toBeGreaterThanOrEqual(-18);
    const context = { ticksPerBeat: 480, loopTicks: 480 };
    const row = normalizeRhythmRow({
      voice: "snare",
      grid: "Xgxg",
      velocity: 0.8,
      accent: 1,
    });
    expect(rowPattern(row)).toEqual([1, 1, 1, 1]);
    expect(
      expandRow(row, context).map((hit) => [hit.startTick, hit.velocity]),
    ).toEqual([
      [0, 1],
      [120, 0.2],
      [240, 0.8],
      [360, 0.2],
    ]);
    // Repeats ramp from the ghost's velocity like any pulse.
    const repeated = expandRow(
      normalizeRhythmRow({ voice: "sd", grid: "g...", repeats: 1, ramp: -0.5 }),
      context,
    );
    expect(repeated.map((hit) => [hit.startTick, hit.velocity])).toEqual([
      [0, 0.2],
      [120, 0.1],
    ]);
  });

  test("flams add a half-velocity grace hit a 1/96 note early", () => {
    expect(FLAM_GRACE_VELOCITY).toBe(0.5);
    expect(flamTicks(480)).toBe(20);
    expect(flamTicks(96)).toBe(4);
    // Flams are never accented; the grace at tick 0 would land before 0.
    const row = normalizeRhythmRow({
      voice: "snare",
      grid: "f...f...",
      accent: 1,
    });
    expect(rowPattern(row)).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
    const hits = expandRow(row, { ticksPerBeat: 480, loopTicks: 960 });
    expect(
      hits.map((hit) => [hit.startTick, hit.velocity, hit.grace ?? false]),
    ).toEqual([
      [0, 0.8, false],
      [460, 0.4, true],
      [480, 0.8, false],
    ]);
    expect(hits[1]).toMatchObject({ pass: 0, step: 4, repeat: 0 });
    expect(hits[1]!.durationTicks).toBe(120);
    // Nudged later, the first flam's grace fits after tick 0.
    const nudged = expandRow(normalizeRhythmRow({ ...row, nudge: 0.25 }), {
      ticksPerBeat: 480,
      loopTicks: 480,
    });
    expect(nudged.map((hit) => [hit.startTick, hit.velocity])).toEqual([
      [10, 0.4],
      [30, 0.8],
    ]);
    // Legato: the grace lasts until its main hit.
    const legato = expandRow(normalizeRhythmRow({ ...row, legato: true }), {
      ticksPerBeat: 480,
      loopTicks: 960,
    });
    expect(legato.map((hit) => hit.durationTicks)).toEqual([480, 20, 480]);
  });

  test("a flam's grace is dropped on or before the previous hit; it never repeats", () => {
    const grace = (grid: string, division: string) =>
      expandRow(normalizeRhythmRow({ voice: "sd", grid, division }), {
        ticksPerBeat: 480,
        loopTicks: 480,
      }).map((hit) => [hit.startTick, hit.grace ?? false]);
    // 1/64 steps are 30 ticks apart: the grace (10) follows the hit at 0.
    expect(grace("xf", "1/64").slice(0, 3)).toEqual([
      [0, false],
      [10, true],
      [30, false],
    ]);
    // 1/96 steps are 20 ticks apart: the grace would collide with tick 0.
    expect(grace("xf", "1/96").slice(0, 2)).toEqual([
      [0, false],
      [20, false],
    ]);
    // Repeats every 1/32t (40 ticks) reach 520, where the grace would land.
    const swung = expandRow(
      normalizeRhythmRow({
        voice: "sd",
        grid: "x....f..",
        swing: -0.5,
        repeats: 16,
        time: "1/32t",
      }),
      { ticksPerBeat: 480, loopTicks: 960 },
    );
    expect(swung.filter((hit) => hit.grace)).toHaveLength(0);
    expect(swung.find((hit) => hit.step === 5)!.startTick).toBe(540);
    // Kept graces add one hit each and no repeats.
    const repeated = expandRow(
      normalizeRhythmRow({ voice: "sd", grid: "x...f...", repeats: 16 }),
      { ticksPerBeat: 480, loopTicks: 960 },
    );
    expect(
      repeated.map((hit) => [hit.startTick, hit.repeat, hit.grace ?? false]),
    ).toEqual([
      [0, 0, false],
      [120, 1, false],
      [240, 2, false],
      [360, 3, false],
      [460, 0, true],
      [480, 0, false],
      [600, 1, false],
      [720, 2, false],
      [840, 3, false],
    ]);
  });

  test("ghosts and flams obey swing and probability", () => {
    const base = { voice: "sd", grid: "gfgf", seed: 7 };
    // Odd steps (the flams) swing half a step (60 ticks) late; graces follow.
    const swung = expandRow(normalizeRhythmRow({ ...base, swing: 0.5 }), {
      ticksPerBeat: 480,
      loopTicks: 480,
    });
    expect(
      swung.map((hit) => [hit.startTick, hit.velocity, hit.grace ?? false]),
    ).toEqual([
      [0, 0.2, false],
      [160, 0.4, true],
      [180, 0.8, false],
      [240, 0.2, false],
      [400, 0.4, true],
      [420, 0.8, false],
    ]);
    // The same seeded draw keeps or drops a flam together with its grace.
    const hits = expandRow(normalizeRhythmRow({ ...base, probability: 0.5 }), {
      ticksPerBeat: 480,
      loopTicks: 1920,
    });
    const kept: number[][] = [];
    for (let pass = 0; pass < 4; pass += 1)
      for (let step = 0; step < 4; step += 1)
        if (chance(7, "sd", pass, step) < 0.5) kept.push([pass, step]);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(16);
    const at = (grace: boolean) =>
      hits
        .filter((hit) => (hit.grace ?? false) === grace)
        .map((hit) => [hit.pass, hit.step]);
    expect(at(false)).toEqual(kept);
    expect(at(true)).toEqual(kept.filter(([, step]) => step! % 2 === 1));
  });

  test("grids accept x X g f . - and nothing else", () => {
    expect(normalizeRhythmRow({ voice: "sd", grid: "x-gf" })).toEqual({
      voice: "sd",
      grid: "x.gf",
    });
    for (const grid of ["xG..", "xF..", "xo..", "x a.", "", "g".repeat(65)])
      expect(() => normalizeRhythmRow({ voice: "sd", grid })).toThrow(
        "grid must be 1..64 of x X g f . -",
      );
  });

  test("plain grids expand as before", () => {
    const hits = expandRow(
      normalizeRhythmRow({ voice: "sd", grid: "x.X.-x..", swing: 0.2 }),
      { ticksPerBeat: 480, loopTicks: 960 },
    );
    expect(hits).toEqual([
      {
        startTick: 0,
        durationTicks: 120,
        velocity: 0.8,
        pass: 0,
        step: 0,
        repeat: 0,
      },
      {
        startTick: 240,
        durationTicks: 120,
        velocity: 0.85,
        pass: 0,
        step: 2,
        repeat: 0,
      },
      {
        startTick: 624,
        durationTicks: 120,
        velocity: 0.8,
        pass: 0,
        step: 5,
        repeat: 0,
      },
    ]);
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
