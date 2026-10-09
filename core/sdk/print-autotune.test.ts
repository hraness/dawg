import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { autotune, song, track } from "./v1.ts";

const tuned = createScore({
  tempoBpm: 96,
  bars: 2,
  key: "D minor",
  tracks: [
    { id: "lead", name: "lead", instrument: "saw" },
    {
      id: "vox",
      name: "vox",
      instrument: "piano",
      autotune: { preset: "hard" },
    },
    {
      id: "vox2",
      name: "vox2",
      instrument: "piano",
      autotune: { preset: "guided", from: "lead", drift: 0.25 },
    },
    {
      id: "vox3",
      name: "vox3",
      instrument: "piano",
      autotune: { speed: 40, key: "D bayati", flex: 30 },
    },
  ],
  notes: [
    {
      id: "a",
      trackId: "lead",
      startTick: 0,
      durationTicks: 480,
      pitch: 62,
      velocity: 0.8,
      drift: 0.75,
    },
  ],
});

describe("autotune in the SDK", () => {
  test("shortest printer form: the preset word, else autotune()", () => {
    expect(printTrack(tuned, tuned.tracks[0]!)).not.toContain("autotune");
    const hard = printTrack(tuned, tuned.tracks[1]!);
    expect(hard).toContain('autotune: "hard",');
    expect(hard).toContain('import { track } from "dawg";');
    const guided = printTrack(tuned, tuned.tracks[2]!);
    expect(guided).toContain(
      'autotune: autotune("guided", { from: "lead", drift: 0.25 }),',
    );
    expect(guided).toContain('import { track, autotune } from "dawg";');
    expect(printTrack(tuned, tuned.tracks[3]!)).toContain(
      'autotune: autotune({ key: "D bayati", speed: 40, flex: 30 }),',
    );
    expect(printTrack(tuned, tuned.tracks[0]!)).toContain("drift: 0.75");
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(tuned).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval keeps autotune and reprints identically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-autotune-"));
    try {
      await initProject(dir);
      for (const file of printProject(tuned).files)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(tuned, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tracks).toEqual(tuned.tracks);
      const strip = (score: TrackScore) =>
        score.notes.map(({ id: _id, ...rest }) => JSON.stringify(rest));
      expect(strip(evaluated.score)).toEqual(strip(tuned));
      expect(printProject(evaluated.score).files).toEqual(
        printProject(tuned).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("autotune() and preset words build the track field", () => {
    expect(autotune("hard")).toEqual({ kind: "autotune", preset: "hard" });
    expect(autotune({ speed: 40 })).toEqual({ kind: "autotune", speed: 40 });
    const s = song({
      tracks: [
        track({ name: "a", instrument: "piano", autotune: "trap" }),
        track({
          name: "b",
          instrument: "piano",
          autotune: autotune("pop", { speed: 40 }),
        }),
      ],
    });
    expect(s.tracks[0]!.autotune).toEqual({ preset: "trap" });
    expect(s.tracks[1]!.autotune).toEqual({ preset: "pop", speed: 40 });
    expect(() => autotune("loud" as "hard")).toThrow(/not one of/);
    expect(() => track({ name: "c", autotune: { bogus: 1 } as never })).toThrow(
      /no field "bogus"/,
    );
  });
});
