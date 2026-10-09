import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { note, song, stringed, track } from "./v1.ts";

const strung = createScore({
  tempoBpm: 96,
  bars: 1,
  key: "D minor",
  tracks: [
    {
      id: "gtr",
      name: "gtr",
      instrument: "string",
      string: { preset: "nylon" },
    },
    {
      id: "sitar",
      name: "sitar",
      instrument: "string",
      string: { preset: "sitar", buzz: 0.8, sym: 0.5 },
      fxAutomation: {
        "string-bright": [
          { tick: 0, value: 0.3 },
          { tick: 960, value: 0.9 },
        ],
      },
    },
    { id: "old", name: "old", instrument: "sitar" },
  ],
  notes: [
    {
      id: "n1",
      trackId: "gtr",
      startTick: 0,
      durationTicks: 480,
      pitch: 62,
      velocity: 0.8,
    },
    {
      id: "n2",
      trackId: "sitar",
      startTick: 480,
      durationTicks: 960,
      pitch: 50,
      velocity: 0.7,
    },
    {
      id: "n3",
      trackId: "old",
      startTick: 0,
      durationTicks: 480,
      pitch: 62,
      velocity: 0.8,
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("strings in the SDK", () => {
  test("stringed(), the string field and preset words store Track.string", () => {
    const tracks = [
      track({
        name: "a",
        instrument: stringed("sitar", { buzz: 0.8 }),
        notes: [note("D3", 0)],
      }),
      track({
        name: "b",
        instrument: "string",
        string: { preset: "koto" },
        notes: [],
      }),
      track({ name: "c", instrument: "nylon", notes: [] }),
      track({ name: "d", instrument: "classical", notes: [] }),
      track({ name: "e", instrument: "sitar", notes: [] }),
    ];
    const result = song({ tempo: 100, bars: 1, tracks });
    const stored = result.tracks.map((t) => [t.instrument, t.string]);
    expect(stored).toEqual([
      ["string", { preset: "sitar", buzz: 0.8 }],
      ["string", { preset: "koto" }],
      ["string", { preset: "nylon" }],
      ["string", { preset: "nylon" }],
      // A legacy word keeps today's voice.
      ["sitar", undefined],
    ]);
    // dawg validates what the SDK stored.
    expect(() => createScore(result as never)).not.toThrow();
  });

  test("dawg rejects unknown presets and out-of-range values", () => {
    const bad = (string: unknown) =>
      createScore({
        tracks: [{ id: "a", name: "a", instrument: "string", string }],
      } as never);
    expect(() => bad({ preset: "theremin" })).toThrow(/preset/);
    expect(() => bad({ ring: 1e9 })).toThrow(/ring/);
    expect(() => bad({ wobble: 1 })).toThrow(/wobble/);
    expect(bad({ decay: 4 }).tracks[0]!.string).toEqual({ ring: 4 });
  });
});

describe("strings in the printer", () => {
  test("prints stringed() with its overrides; legacy words stay plain", () => {
    expect(printTrack(strung, strung.tracks[0]!)).toContain(
      'instrument: stringed("nylon"),',
    );
    const sitar = printTrack(strung, strung.tracks[1]!);
    expect(sitar).toContain(
      'instrument: stringed("sitar", { buzz: 0.8, sym: 0.5 }),',
    );
    expect(sitar).toContain('"string-bright"');
    expect(sitar).toContain("import { track, note, stringed }");
    expect(printTrack(strung, strung.tracks[2]!)).toContain(
      'instrument: "sitar",',
    );
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(strung).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-strings-"));
    try {
      await initProject(dir);
      await writeProject(dir, strung);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(strung, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tracks.map((t) => t.string)).toEqual(
        strung.tracks.map((t) => t.string),
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(strung).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
