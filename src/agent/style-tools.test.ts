import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "../../core/diff.ts";
import { encodeLoop } from "../../core/loop.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { generateStyle, styleScore } from "../../core/styles/generate.ts";
import { validateAgentOperation } from "./planner.ts";
import { STYLE_TOOLS } from "./style-tools.ts";
import { AGENT_TOOLS, type ActionContext, type ToolContext } from "./tools.ts";

const tool = (name: string) =>
  STYLE_TOOLS.find((entry) => entry.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: undefined,
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  } as ToolContext;
}

async function read(name: string, args: Record<string, unknown>) {
  const plan = tool(name).plan(args, context(createScore()));
  if (plan.kind !== "action") throw new Error("expected an action plan");
  const result = await plan.run({} as ActionContext);
  return JSON.parse(result.content);
}

describe("style tools", () => {
  test("are registered", () => {
    const names = AGENT_TOOLS.map((entry) => entry.name);
    for (const name of ["list_styles", "style_info", "apply_style"])
      expect(names).toContain(name);
  });

  test("list_styles: families, children and search", async () => {
    const families = await read("list_styles", {});
    expect(families.families.length).toBe(8);
    const jazz = await read("list_styles", { parent: "jazz" });
    expect(jazz.children.length).toBeGreaterThan(0);
    const found = await read("list_styles", { query: "house" });
    expect(found.matches.map((m: { id: string }) => m.id)).toContain(
      "deep-house",
    );
    expect(() =>
      tool("list_styles").plan({ nope: 1 }, context(createScore())),
    ).toThrow();
  });

  test("style_info describes a style and suggests near names", async () => {
    const info = await read("style_info", { id: "bebop" });
    expect(info.id).toBe("bebop");
    expect(info.lines.join("\n")).toContain("meter");
    expect(() =>
      tool("style_info").plan({ id: "bebopp" }, context(createScore())),
    ).toThrow(/did you mean|list_styles/);
  });

  test("apply_style replaces the song with the generated one, through the planner", () => {
    const start = createScore({
      tracks: [{ id: "old", name: "old", instrument: "saw" }],
      notes: [
        {
          id: "x",
          trackId: "old",
          pitch: 60,
          startTick: 0,
          durationTicks: 240,
          velocity: 0.8,
        },
      ],
    });
    const plan = tool("apply_style").plan(
      { id: "deep-house", bars: 4, seed: 3 },
      context(start),
    );
    if (plan.kind !== "score") throw new Error("expected a score plan");
    const operations = plan.operations.map(validateAgentOperation);
    const next = applyScoreOperations(start, operations);
    const expected = styleScore(
      generateStyle("deep-house", { bars: 4, seed: 3 }),
    );
    expect(encodeLoop(next)).toBe(encodeLoop(expected));
    expect(next.style).toEqual({ id: "deep-house", seed: 3, bars: 4 });
  });

  test("apply_style blends and checks arguments", () => {
    const plan = tool("apply_style").plan(
      { id: "bebop", blend: "deep-house", weight: 0.4, bars: 2 },
      context(createScore()),
    );
    if (plan.kind !== "score") throw new Error("expected a score plan");
    const next = applyScoreOperations(createScore(), plan.operations);
    expect(next.style?.blend).toEqual({ id: "deep-house", weight: 0.4 });
    for (const bad of [
      { id: "nope-nope" },
      { id: "bebop", bars: 0 },
      { id: "bebop", seed: -1 },
      { id: "bebop", weight: 0.3 },
      { id: "bebop", blend: "deep-house", weight: 2 },
      { id: "bebop", extra: true },
    ])
      expect(() =>
        tool("apply_style").plan(bad, context(createScore())),
      ).toThrow();
  });
});
