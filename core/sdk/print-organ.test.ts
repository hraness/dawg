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
import { SDK_VERSION, note, song, track } from "./v1.ts";

const organs = createScore({
  tempoBpm: 100,
  bars: 1,
  tracks: [
    {
      id: "b3",
      name: "b3",
      instrument: "tonewheel",
      keys: {
        preset: "gospel",
        drawbars: "888800008",
        perc: "3rd",
        rotary: "fast",
      },
      fxAutomation: {
        "keys-rotary": [
          { tick: 0, value: 1 },
          { tick: 960, value: 2 },
        ],
      },
    },
    {
      id: "vox",
      name: "vox",
      instrument: "combo",
      keys: { registers: "08080" },
    },
    {
      id: "church",
      name: "church",
      instrument: "pipe",
      keys: { stops: "principal8 octave4 mixture", trem: 0.3 },
    },
    { id: "old", name: "old", instrument: "organ" },
  ],
  notes: [
    {
      id: "n1",
      trackId: "b3",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("organs in the SDK (f061-organ)", () => {
  test("keys({drawbars, stops, registers}) store Track.keys; organ stays legacy", () => {
    expect(Number(SDK_VERSION.split(".")[1])).toBeGreaterThanOrEqual(26);
    const result = song({
      tempo: 100,
      bars: 1,
      tracks: [
        track({
          name: "a",
          instrument: "tonewheel",
          keys: { drawbars: "888000000", rotary: "slow" },
          notes: [note("C4", 0)],
        }),
        track({
          name: "b",
          instrument: "pipe",
          keys: { stops: ["flute8", "flute4"] },
          notes: [],
        }),
        track({ name: "c", instrument: "hammond", notes: [] }),
        track({ name: "d", instrument: "organ", notes: [] }),
      ],
    });
    expect(result.tracks.map((t) => [t.instrument, t.keys])).toEqual([
      ["tonewheel", { drawbars: "888000000", rotary: "slow" }],
      ["pipe", { stops: "flute8 flute4" }],
      ["tonewheel", { preset: "tonewheel" }],
      ["organ", undefined],
    ]);
    expect(() => createScore(result as never)).not.toThrow();
    expect(() =>
      createScore({
        tracks: [
          {
            id: "a",
            name: "a",
            instrument: "tonewheel",
            keys: { drawbars: "8880" },
          },
        ],
      } as never),
    ).toThrow(/drawbars/);
  });

  test("the printer keeps the drawbars and stops shorthand", async () => {
    const b3 = printTrack(organs, organs.tracks[0]!);
    expect(b3).toContain('drawbars: "888800008"');
    expect(b3).toContain('"keys-rotary"');
    expect(printTrack(organs, organs.tracks[2]!)).toContain(
      'stops: "principal8 octave4 mixture"',
    );
    expect(printTrack(organs, organs.tracks[3]!)).toContain(
      'instrument: "organ",',
    );
    for (const file of printProject(organs).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-organ-"));
    try {
      await initProject(dir);
      await writeProject(dir, organs);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(organs, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tracks.map((t) => t.keys)).toEqual(
        organs.tracks.map((t) => t.keys),
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(organs).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
