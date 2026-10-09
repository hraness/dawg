import { describe, expect, test } from "bun:test";

import { applyScoreOperation, createScore } from "../../core/score.ts";
import { AGENT_TOOLS, type ScorePlan, type ToolContext } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

const updateNotes = AGENT_TOOLS.find((t) => t.name === "update_notes")!;

const score = createScore({
  tracks: [{ id: "bass", instrument: "bass" }],
  notes: [
    {
      id: "b1",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 36,
      velocity: 0.8,
    },
    {
      id: "b2",
      trackId: "bass",
      startTick: 480,
      durationTicks: 480,
      pitch: 125,
      velocity: 0.8,
    },
  ],
});

const context: ToolContext = {
  score,
  focusedTrackId: "bass",
  revision: 1,
  newNoteId: (trackId, index) => `${trackId}-${index}`,
};

describe("update_notes", () => {
  test("transpose shifts relative to the current pitch and reports before→after", () => {
    const plan = updateNotes.plan(
      {
        updates: [
          { noteId: "b1", transpose: 2 },
          { noteId: "b2", transpose: -12 },
        ],
      },
      context,
    ) as ScorePlan;
    let next = score;
    for (const op of plan.operations) next = applyScoreOperation(next, op);
    expect(next.notes.map((n) => n.pitch)).toEqual([38, 113]);
    expect(plan.summary).toBe("~2 notes · pitch b1 C2→D2, b2 F9→F8");
  });

  test("an absolute pitch also reports the move; unchanged pitches do not", () => {
    const plan = updateNotes.plan(
      {
        updates: [
          { noteId: "b1", pitch: "C2" },
          { noteId: "b2", pitch: 113 },
        ],
      },
      context,
    ) as ScorePlan;
    expect(plan.summary).toBe("~2 notes · pitch b2 F9→F8");
  });

  test("accepts a pitch beside transpose 0 or the matching transpose", () => {
    for (const update of [
      { noteId: "b1", pitch: "E2", transpose: 0 },
      { noteId: "b1", pitch: "E2", transpose: 4 },
    ]) {
      const plan = updateNotes.plan(
        { updates: [update] },
        context,
      ) as ScorePlan;
      let next = score;
      for (const op of plan.operations) next = applyScoreOperation(next, op);
      expect(next.notes[0]!.pitch).toBe(40);
    }
  });

  test("rejects pitch with transpose, fractional shifts and out-of-range results", () => {
    const bad = [
      { noteId: "b1", pitch: 40, transpose: 2 },
      { noteId: "b1", pitch: 38, transpose: 4 },
      { noteId: "b1", transpose: 1.5 },
      { noteId: "b2", transpose: 3 },
      { noteId: "b1", transpose: -37 },
    ];
    for (const update of bad)
      expect(() => updateNotes.plan({ updates: [update] }, context)).toThrow(
        ToolArgumentError,
      );
  });

  test("long pitch summaries are capped", () => {
    const many = createScore({
      tracks: [{ id: "bass" }],
      notes: Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        trackId: "bass",
        startTick: i * 120,
        durationTicks: 120,
        pitch: 48,
        velocity: 0.8,
      })),
    });
    const plan = updateNotes.plan(
      { updates: many.notes.map((n) => ({ noteId: n.id, transpose: 1 })) },
      { ...context, score: many },
    ) as ScorePlan;
    expect(plan.summary).toEndWith("n7 C3→C#3 +2 more");
  });
});
