import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printSong, printTrack } from "./print.ts";
import { DawgSdkError, note, pitchCents, song, track } from "./v1.ts";

const tuned = createScore({
  tempoBpm: 90,
  bars: 1,
  key: "D dorian",
  tuning: {
    name: "shruti",
    cents: [
      90.2, 111.7, 182.4, 203.9, 294.1, 315.6, 386.3, 407.8, 498, 519.6, 590.2,
      611.7, 702, 792.2, 813.7, 884.4, 905.9, 996.1, 1017.6, 1088.3, 1109.8,
      1200,
    ],
    ref: 432,
    root: 62,
  },
  tracks: [
    { id: "lead", name: "lead", instrument: "sine", tuning: "pelog" },
    {
      id: "pad",
      name: "pad",
      instrument: "saw",
      tuning: { ratios: ["9/8", "5/4", "3/2", "2/1"], map: "nearest" },
    },
    { id: "kit", name: "kit", instrument: "kit" },
  ],
  notes: [
    {
      id: "n1",
      trackId: "lead",
      startTick: 0,
      durationTicks: 480,
      pitch: 64,
      velocity: 0.8,
      cents: -13.7,
    },
    {
      id: "n2",
      trackId: "pad",
      startTick: 480,
      durationTicks: 480,
      pitch: 57,
      velocity: 0.8,
      cents: 50,
    },
    {
      id: "n3",
      trackId: "kit",
      startTick: 0,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
      cents: 25,
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("tuning in the SDK", () => {
  test("pitch names take a cents suffix", () => {
    expect(pitchCents("E4-14c")).toEqual({ pitch: 64, cents: -14 });
    expect(pitchCents("A3+50c")).toEqual({ pitch: 57, cents: 50 });
    expect(pitchCents("C4")).toEqual({ pitch: 60, cents: 0 });
    expect(pitchCents(61)).toEqual({ pitch: 61, cents: 0 });
    expect(note("E4-13.7c", 0).cents).toBe(-13.7);
    expect(note("E4", 0).cents).toBeUndefined();
    expect(() => pitchCents("C4+1300c")).toThrow(DawgSdkError);
  });

  test("song and track tunings pass through song()", () => {
    const lead = track({
      id: "lead",
      name: "lead",
      instrument: "sine",
      tuning: { name: "slendro", ref: 432, root: "D4" },
      notes: [note("D4+20c", 0)],
    });
    const result = song({
      tempo: 100,
      bars: 1,
      tuning: "19-edo",
      tracks: [lead],
    });
    expect(result.tuning).toEqual({ name: "19-edo" });
    expect(result.tracks[0]!.tuning).toEqual({
      name: "slendro",
      ref: 432,
      root: 62,
    });
    expect(result.notes[0]!.cents).toBe(20);
    expect(song({ tempo: 100, bars: 1, tracks: [] })).not.toHaveProperty(
      "tuning",
    );
  });

  test("bad tuning shapes fail in the SDK", () => {
    expect(() =>
      song({
        tempo: 100,
        bars: 1,
        tuning: { edo: 19, cents: [100] } as never,
        tracks: [],
      }),
    ).toThrow(/give one table/);
    expect(() =>
      song({ tempo: 100, bars: 1, tuning: { steps: 5 } as never, tracks: [] }),
    ).toThrow(/unknown field "steps"/);
  });
});

describe("tuning in the printer", () => {
  test("prints names, tables and detuned notes", () => {
    const text = printSong(tuned);
    expect(text).toContain('tuning: {\n    name: "shruti",\n    cents: [\n');
    expect(text).toContain('    ref: 432,\n    root: "D4",\n  },');
    expect(printTrack(tuned, tuned.tracks[0]!)).toContain('tuning: "pelog"');
    expect(printTrack(tuned, tuned.tracks[0]!)).toContain(
      'note("E4-13.7c", 0)',
    );
    expect(printTrack(tuned, tuned.tracks[1]!)).toContain(
      'tuning: { ratios: ["9/8", "5/4", "3/2", "2/1"], map: "nearest" },',
    );
    expect(printTrack(tuned, tuned.tracks[2]!)).toContain(
      'note("C2+25c", 0, 0.25)',
    );
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(tuned).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-tuning-"));
    try {
      await initProject(dir);
      await writeProject(dir, tuned);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(tuned, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tuning).toEqual(tuned.tuning);
      const cents = evaluated.score.notes.map((n) => n.cents ?? 0);
      expect(cents.sort((a, b) => a - b)).toEqual([-13.7, 25, 50]);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(tuned).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Scala .scl and .kbm files load at evaluation and print by path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-scala-"));
    try {
      await initProject(dir);
      await writeAtomic(
        join(dir, "tunings/slendro.scl"),
        "! slendro.scl\n!\nApproximate Javanese slendro\n 5\n!\n 231.0\n 474.0\n 717.0\n 955.0\n 2/1\n",
      );
      await writeAtomic(
        join(dir, "tunings/white.kbm"),
        "! white keys\n7\n0\n127\n60\n69\n440.0\n5\n0\n1\n2\nx\n3\n4\nx\n",
      );
      await writeAtomic(
        join(dir, "song.ts"),
        [
          'import { song, track, note } from "dawg";',
          "",
          "export default song({",
          "  tempo: 100,",
          "  bars: 1,",
          '  tuning: { scl: "tunings/slendro.scl", kbm: "tunings/white.kbm" },',
          "  tracks: [",
          '    track({ id: "a", name: "a", instrument: "sine", notes: [note("C4", 0)] }),',
          "  ],",
          "});",
          "",
        ].join("\n"),
      );
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const tuning = evaluated.score.tuning!;
      expect(tuning.scl).toBe("tunings/slendro.scl");
      expect(tuning.cents).toEqual([231, 474, 717, 955, 1200]);
      expect(tuning.keymap?.size).toBe(7);
      expect(tuning.keymap?.map).toEqual([0, 1, 2, null, 3, 4, null]);
      const text = printSong(evaluated.score);
      expect(text).toContain(
        'tuning: { scl: "tunings/slendro.scl", kbm: "tunings/white.kbm" },',
      );
      expect(text).not.toContain("231");

      await writeAtomic(join(dir, "tunings/slendro.scl"), "broken\nfive\n");
      const broken = await evaluateProject(dir);
      expect(broken.ok).toBe(false);
      if (!broken.ok)
        expect(broken.diagnostics[0]!.message).toContain(
          "tunings/slendro.scl: the line after the description must be the note count",
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
