import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "../../core/diff.ts";
import { createScore } from "../../core/score.ts";
import {
  PATCH_PROMPT,
  PATCH_TOOLS,
  patchToolOperation,
} from "./patch-tools.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const score = createScore({
  bars: 1,
  tracks: [{ id: "lead", instrument: "saw" }],
});
const context: ToolContext = {
  score,
  focusedTrackId: "lead",
  revision: 1,
  newNoteId: (trackId, index) => `${trackId}-${index}`,
};
const tool = PATCH_TOOLS.find((t) => t.name === "patch_edit")!;

const recipe = [
  { op: "new", name: "mine" },
  { op: "add", type: "osc", id: "tone", params: { wave: "saw" } },
  { op: "add", type: "svf", id: "vcf", params: { cutoff: 800 } },
  { op: "wire", from: "voice.pitch", to: "tone.pitch" },
  { op: "wire", from: "tone.out", to: "vcf.in" },
  { op: "wire", from: "vcf.out", to: "out.audio" },
  {
    op: "macro",
    id: "cutoff",
    targets: ["vcf.cutoff:200..6000"],
    label: "Cutoff",
  },
];

describe("patch_edit", () => {
  test("is an advertised agent tool, and the prompt carries built-in recipes", () => {
    expect(AGENT_TOOLS.some((t) => t.name === "patch_edit")).toBe(true);
    expect(PATCH_PROMPT).toContain("patch new acid-bass");
  });

  test("ops become typed lines, in order", () => {
    expect(patchToolOperation({ ops: recipe }, context).lines).toEqual([
      "patch new mine",
      "patch add osc as tone wave=saw",
      "patch add svf as vcf cutoff=800",
      "patch wire voice.pitch tone.pitch",
      "patch wire tone.out vcf.in",
      "patch wire vcf.out out.audio",
      'patch macro cutoff vcf.cutoff:200..6000 label "Cutoff"',
    ]);
  });

  test("a batch is one revision of node, cable and macro ops", () => {
    const plan = tool.plan({ ops: recipe }, context);
    if (plan.kind !== "score") throw new Error("score plan");
    const next = applyScoreOperations(score, plan.operations);
    const patch = next.tracks[0]!.patch as unknown as {
      nodes: unknown[];
      cables: unknown[];
      macros: unknown[];
    };
    expect(patch.nodes).toHaveLength(2);
    expect(patch.cables).toHaveLength(3);
    expect(patch.macros).toHaveLength(1);
    expect(plan.summary).toContain("added vcf (svf)");
  });

  test("one bad cable rejects the whole batch and names it", () => {
    const bad = [
      ...recipe.slice(0, 4),
      { op: "wire", from: "tone.out", to: "vcf.inn" },
      ...recipe.slice(5),
    ];
    expect(() => tool.plan({ ops: bad }, context)).toThrow(
      /line 5 `patch wire tone\.out vcf\.inn`.*no input "inn" on vcf.*did you mean in\?.*nothing applied/,
    );
  });

  test("a malformed op is named by index", () => {
    expect(() =>
      tool.plan({ ops: [{ op: "new", name: "x" }, { op: "frob" }] }, context),
    ).toThrow(/ops\[1\]: op is one of/);
    expect(() => tool.plan({ ops: [], nope: 1 }, context)).toThrow(
      /unknown argument nope/,
    );
  });

  test("show reads the patch as typed lines without editing", async () => {
    const plan = tool.plan({ ops: recipe }, context);
    if (plan.kind !== "score") throw new Error("score plan");
    const next = applyScoreOperations(score, plan.operations);
    const read = tool.plan({ show: true }, { ...context, score: next });
    if (read.kind !== "action") throw new Error("action plan");
    const result = await read.run();
    expect(result.content).toContain("patch wire tone.out vcf.in");
  });

  test("user-library saves stay typed", () => {
    expect(() =>
      tool.plan(
        { ops: [...recipe, { op: "save", name: "x --user" }] },
        context,
      ),
    ).toThrow();
  });
});
