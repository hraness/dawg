import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { applyScoreOperations } from "../../core/diff.ts";
import { AUTOTUNE_TOOLS, VOICE_PREVIEWABLE_TOOLS } from "./voice-tools.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const score = createScore({
  bars: 2,
  tempoBpm: 120,
  tracks: [
    { id: "vox", name: "vox", instrument: "saw" },
    { id: "melody", name: "melody", instrument: "saw" },
  ],
  notes: [],
});
const context: ToolContext = {
  score,
  focusedTrackId: "vox",
  revision: 1,
  newNoteId: (trackId, index) => `${trackId}-${index}`,
};
const tool = AUTOTUNE_TOOLS.find((t) => t.name === "autotune_vocal")!;

function run(args: Record<string, unknown>) {
  const plan = tool.plan(args, context);
  if (plan.kind !== "score") throw new Error("score plan");
  return applyScoreOperations(score, plan.operations).tracks.find(
    (t) => t.id === "vox",
  )!;
}

describe("autotune_vocal", () => {
  test("registered and previewable", () => {
    expect(AGENT_TOOLS.some((t) => t.name === "autotune_vocal")).toBe(true);
    expect(VOICE_PREVIEWABLE_TOOLS).toContain("autotune_vocal");
  });

  test("an empty call is pop; presets and params build the field", () => {
    expect(run({}).autotune).toEqual({ preset: "pop" });
    expect(run({ preset: "hard" }).autotune).toEqual({ preset: "hard" });
    expect(
      run({ preset: "guided", params: { to: "notes", from: "melody" } })
        .autotune,
    ).toEqual({ preset: "guided", to: "notes", from: "melody" });
    expect(run({ params: { flex: 40, key: "D bayati" } }).autotune).toEqual({
      key: "D bayati",
      flex: 40,
    });
  });

  test("off clears; bad args refuse without a change", () => {
    const tuned = {
      ...context,
      score: createScore({
        ...score,
        tracks: [
          { ...score.tracks[0]!, autotune: { preset: "hard" } },
          score.tracks[1]!,
        ],
      }),
    };
    const off = tool.plan({ off: true }, tuned);
    expect(off.kind === "score" ? off.operations : []).toEqual([
      { type: "updateTrack", trackId: "vox", patch: { autotune: null } },
    ]);
    expect(() => tool.plan({ preset: "nope" }, context)).toThrow("preset");
    expect(() => tool.plan({ params: { bogus: 1 } }, context)).toThrow(
      "no field",
    );
    expect(() =>
      tool.plan({ params: { from: "nowhere", to: "notes" } }, context),
    ).toThrow();
    expect(() => tool.plan({ params: { speed: 9999 } }, context)).toThrow();
  });
});
