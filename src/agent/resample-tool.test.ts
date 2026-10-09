import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";
import { resampleToolCommand } from "./resample-tool.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const score = createScore({
  tempoBpm: 120,
  bars: 2,
  tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
  notes: [
    {
      id: "a",
      trackId: "lead",
      pitch: 60,
      velocity: 0.8,
      startTick: 0,
      durationTicks: 960,
    },
  ],
});

function context(value: TrackScore): ToolContext {
  return {
    score: value,
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

describe("resample tool", () => {
  test("arguments become the prompt command", () => {
    expect(resampleToolCommand({ bars: [1, 2], grain: true }, "lead")).toEqual({
      source: { kind: "track", trackId: "lead" },
      range: { kind: "bars", from: 1, to: 2 },
      grain: true,
    });
    expect(resampleToolCommand({ source: "master" }, "lead").source).toEqual({
      kind: "master",
    });
    expect(() => resampleToolCommand({ source: "bus" }, "lead")).toThrow();
    expect(() => resampleToolCommand({ bars: [1] }, "lead")).toThrow();
  });

  test("writes the file and plans addTrack and addNote", async () => {
    const root = await mkdtemp(join(tmpdir(), "dawg-resample-tool-"));
    dirs.push(root);
    const tool = AGENT_TOOLS.find((t) => t.name === "resample")!;
    const plan = tool.plan({ grain: true }, context(score));
    if (plan.kind !== "prepare") throw new Error(plan.kind);
    const scorePlan = await plan.run({ workspace: { root } });
    expect(scorePlan.trackId).toBe("lead-grain");
    expect(scorePlan.operations.map((op) => op.type)).toEqual([
      "addTrack",
      "addNote",
    ]);
    await stat(join(root, "tracks/lead-grain/samples/lead.wav"));
    const next = scorePlan.operations.reduce(
      (value, op) => applyScoreOperation(value, op),
      score,
    );
    expect(next.tracks.find((t) => t.id === "lead-grain")?.instrument).toBe(
      "granular",
    );
  });
});
