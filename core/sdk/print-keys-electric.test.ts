/**
 * Electric keys and the piano's soft and sostenuto pedals through the SDK
 * (0.6.1): `track({ instrument: "suitcase" })` is the suitcase preset,
 * and printed projects evaluate back to the same score.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { adoptNoteIds, diffScores } from "../diff.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { SDK_VERSION, track } from "./v1.ts";

const electric = createScore({
  tempoBpm: 100,
  bars: 2,
  tracks: [
    {
      id: "ep",
      name: "ep",
      instrument: "epiano",
      keys: { preset: "suitcase", vibe: 0.5 },
    },
    {
      id: "clav",
      name: "clav",
      instrument: "clav",
      keys: { pickup: "bridge", mute: 0.4 },
    },
    {
      id: "wurli",
      name: "wurli",
      instrument: "wurli",
      keys: { trem: 0.6 },
    },
    {
      id: "grand",
      name: "grand",
      instrument: "grand",
      keys: { preset: "grand", sym: 0.5 },
      pedal: [{ tick: 0, state: "down" }],
      softPedal: [{ tick: 0, state: "down" }],
      sostenuto: [
        { tick: 480, state: "down" },
        { tick: 1920, state: "up" },
      ],
    },
  ],
  notes: ["ep", "clav", "wurli", "grand"].map((trackId, index) => ({
    id: `n${index}`,
    trackId,
    startTick: 0,
    durationTicks: 960,
    pitch: 60,
    velocity: 0.8,
  })),
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("electric keys in the SDK", () => {
  test("SDK minor is at least 1.26 (softPedal, sostenuto)", () => {
    expect(Number(SDK_VERSION.split(".")[1])).toBeGreaterThanOrEqual(26);
  });

  test("preset words select the electric keys", () => {
    expect(track({ name: "a", instrument: "suitcase" }).keys).toEqual({
      preset: "suitcase",
    });
    expect(track({ name: "b", instrument: "funkclav" }).keys).toEqual({
      preset: "funkclav",
    });
    expect(
      track({ name: "c", instrument: "wurli", keys: { trem: 0.5 } }).keys,
    ).toEqual({ trem: 0.5 });
  });

  test("print is prettier-stable and names the fields", async () => {
    const ep = printTrack(electric, electric.tracks[0]!);
    expect(ep).toContain('instrument: "epiano"');
    expect(ep).toContain("vibe: 0.5");
    const grand = printTrack(electric, electric.tracks[3]!);
    expect(grand).toContain('softPedal: [[0, "down"]],');
    expect(grand).toContain("sostenuto: [\n");
    for (const file of printProject(electric).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval round trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-electric-"));
    try {
      await initProject(dir);
      await writeProject(dir, electric);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(electric, adoptNoteIds(electric, evaluated.score));
      expect(ops).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
