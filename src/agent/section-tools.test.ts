import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, ToolArgumentError, type ToolContext } from "./tools.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function run(score: TrackScore, name: string, args: Record<string, unknown>) {
  const plan = tool(name).plan(args, context(score));
  if (plan.kind !== "score") throw new Error(`${name} planned ${plan.kind}`);
  let next = score;
  for (const operation of plan.operations)
    next = applyScoreOperation(next, operation);
  return { next, summary: plan.summary };
}

const base = createScore({
  bars: 16,
  tracks: [
    { id: "lead", name: "lead", instrument: "saw" },
    { id: "drums", name: "drums", instrument: "kit" },
  ],
  notes: Array.from({ length: 16 }, (_, bar) => ({
    id: `n${bar}`,
    trackId: "lead",
    pitch: 60,
    startTick: bar * 1920,
    durationTicks: 480,
    velocity: 0.8,
  })),
});

describe("section tools", () => {
  test("are registered", () => {
    for (const name of [
      "list_sections",
      "edit_section",
      "set_form",
      "add_transition",
    ])
      expect(tool(name)).toBeDefined();
  });

  test("edit_section marks 1-based bars, varies, loops and renames", () => {
    let score = run(base, "edit_section", {
      action: "mark",
      name: "verse",
      fromBar: 1,
      bars: 8,
    }).next;
    score = run(score, "edit_section", {
      action: "mark",
      name: "chorus",
      fromBar: 9,
      bars: 8,
    }).next;
    expect(score.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["verse", 0, 8],
      ["chorus", 8, 8],
    ]);
    score = run(score, "edit_section", {
      action: "vary",
      name: "chorus",
      trackId: "lead",
      transpose: 12,
    }).next;
    expect(score.sections[1]!.vary).toEqual({ lead: { transpose: 12 } });
    score = run(score, "edit_section", {
      action: "mute",
      name: "verse",
      tracks: ["drums"],
    }).next;
    expect(score.sections[0]!.mute).toEqual(["drums"]);
    score = run(score, "edit_section", { action: "loop", name: "chorus" }).next;
    expect(score.loopSection).toBe("chorus");
    score = run(score, "edit_section", {
      action: "rename",
      name: "chorus",
      to: "hook",
    }).next;
    expect(score.loopSection).toBe("hook");
    score = run(score, "edit_section", { action: "unloop" }).next;
    expect(score.loopSection).toBeUndefined();
  });

  test("set_form orders sections and bakes; list_sections reports them", async () => {
    let score = base.withSections(
      [
        { name: "A", startBar: 0, bars: 8 },
        { name: "B", startBar: 8, bars: 8 },
      ],
      [],
    );
    score = run(score, "set_form", { form: "A*2 B A" }).next;
    expect(score.form).toEqual([
      { section: "A", repeat: 2 },
      { section: "B" },
      { section: "A" },
    ]);
    const listed = tool("list_sections").plan({}, context(score));
    if (listed.kind !== "action") throw new Error("expected an action");
    const body = JSON.parse((await listed.run({})).content);
    expect(body.form).toBe("A×2 B A");
    expect(body.arrangedBars).toBe(32);
    expect(body.sections[1]).toEqual({ name: "B", fromBar: 9, bars: 8 });
    const baked = run(score, "set_form", { bake: true }).next;
    expect(baked.form).toEqual([]);
    expect(baked.bars).toBe(32);
    expect(run(score, "set_form", { form: "" }).next.form).toEqual([]);
  });

  test("add_transition builds, drops and fills", () => {
    const score = base.withSections(
      [
        { name: "verse", startBar: 0, bars: 8 },
        { name: "drop", startBar: 8, bars: 8 },
      ],
      [],
    );
    const built = run(score, "add_transition", {
      type: "build",
      section: "verse",
      bars: 2,
    }).next;
    expect(built.notes.length).toBeGreaterThan(score.notes.length);
    const dropped = run(built, "add_transition", {
      type: "drop",
      section: "drop",
    }).next;
    const dropAt = 8 * base.beatsPerBar * base.ticksPerBeat;
    expect(
      dropped.notes.some(
        (note) => note.trackId !== "drums" && note.startTick === dropAt,
      ),
    ).toBe(true);
    expect(
      dropped.notes.some(
        (note) =>
          note.startTick >= dropAt - base.ticksPerBeat &&
          note.startTick < dropAt,
      ),
    ).toBe(false);
    const filled = run(score, "add_transition", {
      type: "fill",
      section: "drop",
      style: "toms",
    }).next;
    expect(
      filled.notes.filter((note) => note.trackId === "drums").length,
    ).toBeGreaterThan(0);
  });

  test("add_transition builds into a section with bars", () => {
    const score = base.withSections(
      [
        { name: "verse", startBar: 0, bars: 8 },
        { name: "drop", startBar: 8, bars: 8 },
      ],
      [],
    );
    const result = run(score, "add_transition", {
      type: "build",
      into: "drop",
      bars: 2,
    });
    const dropAt = 8 * base.beatsPerBar * base.ticksPerBeat;
    const added = result.next.notes.filter(
      (note) => !score.notes.some((old) => old.id === note.id),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const note of added) {
      expect(note.startTick).toBeGreaterThanOrEqual(
        dropAt - 2 * base.beatsPerBar * base.ticksPerBeat,
      );
      expect(note.startTick).toBeLessThan(dropAt);
    }
  });

  test("bad arguments are refused without touching the score", () => {
    expect(() =>
      tool("edit_section").plan(
        { action: "mark", name: "x", fromBar: 1 },
        context(base),
      ),
    ).toThrow(ToolArgumentError);
    expect(() =>
      tool("edit_section").plan(
        { action: "loop", name: "nowhere" },
        context(base),
      ),
    ).toThrow(ToolArgumentError);
    expect(() =>
      tool("add_transition").plan(
        { type: "fill", style: "cowbell" },
        context(base),
      ),
    ).toThrow(ToolArgumentError);
  });
});
