import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { FORMANT_VOWEL_HINT } from "../commands/fx.ts";
import { PREVIEWABLE_TOOLS } from "./preview-tool.ts";
import { AGENT_TOOLS, ToolArgumentError, type ToolContext } from "./tools.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

const score = createScore({
  tracks: [{ id: "vox", instrument: "pad" }],
  notes: [],
} as never);

function context(value: TrackScore): ToolContext {
  return {
    score: value,
    focusedTrackId: "vox",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function run(args: Record<string, unknown>, from = score): TrackScore {
  const plan = tool("set_formant").plan(args, context(from));
  if (plan.kind !== "score") throw new Error("not a score plan");
  return plan.operations.reduce(applyScoreOperation, from);
}

describe("set_formant (formant lane)", () => {
  test("is registered and previewable", () => {
    expect(tool("set_formant")).toBeDefined();
    expect(PREVIEWABLE_TOOLS).toContain("set_formant");
  });

  test("shift and mix land on fx.formant; off removes it", () => {
    const on = run({ shift: -4, mix: 0.5 });
    expect(on.tracks[0]!.fx?.formant).toEqual({ shift: -4, mix: 0.5 });
    const shifted = run({ shift: 3 }, on);
    expect(shifted.tracks[0]!.fx?.formant).toEqual({ shift: 3, mix: 0.5 });
    const off = run({ off: true }, shifted);
    expect(off.tracks[0]!.fx?.formant).toBeUndefined();
  });

  test("an empty call turns it on neutral; presets apply", () => {
    expect(run({}).tracks[0]!.fx?.formant).toEqual({ shift: 0, mix: 1 });
    const deep = run({ preset: "deep" }).tracks[0]!.fx?.formant;
    expect(deep?.shift).toBeLessThan(0);
  });

  test("out of range and the old vowel meaning are refused", () => {
    expect(() => run({ shift: 20 })).toThrow(ToolArgumentError);
    expect(() => run({ vowel: "o" })).toThrow(FORMANT_VOWEL_HINT);
    expect(() => run({ preset: "nope" })).toThrow(ToolArgumentError);
  });

  test("conflicting arguments are refused or reported", () => {
    expect(() => run({ off: true, shift: -4 })).toThrow(ToolArgumentError);
    const plan = tool("set_formant").plan(
      { preset: "deep", shift: 2 },
      context(score),
    );
    expect(plan.kind === "score" && plan.summary).toContain(
      "overrides preset deep",
    );
  });
});
