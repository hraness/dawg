import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { commandParses } from "../commands/parses.ts";
import { rangeToolCommand } from "./range-tools.ts";
import { AGENT_TOOLS, ToolArgumentError, type ToolContext } from "./tools.ts";

const tool = AGENT_TOOLS.find((t) => t.name === "edit_range")!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function run(score: TrackScore, args: Record<string, unknown>) {
  const plan = tool.plan(args, context(score));
  if (plan.kind !== "score") throw new Error(`planned ${plan.kind}`);
  let next = score;
  for (const operation of plan.operations)
    next = applyScoreOperation(next, operation);
  return { next, summary: plan.summary, operations: plan.operations };
}

const base = createScore({
  bars: 8,
  tracks: [
    { id: "lead", name: "lead", instrument: "saw" },
    { id: "bass", name: "bass", instrument: "saw" },
  ],
  sections: [{ name: "chorus", startBar: 4, bars: 4 }],
  notes: Array.from({ length: 8 }, (_, bar) => ({
    id: `n${bar}`,
    trackId: "lead",
    pitch: 60 + bar,
    startTick: bar * 1920,
    durationTicks: 480,
    velocity: 0.8,
  })),
});

const startsOf = (score: TrackScore, trackId = "lead") =>
  score.notes
    .filter((note) => note.trackId === trackId)
    .map((note) => [note.startTick / 1920, note.pitch])
    .sort((a, b) => a[0]! - b[0]!);

describe("edit_range", () => {
  test("is registered and every call types a command the prompt runs", () => {
    expect(tool).toBeDefined();
    const ctx = context(base);
    for (const args of [
      { action: "loop", fromBar: 5, toBar: 6 },
      { action: "loop", section: "chorus" },
      { action: "unloop" },
      { action: "copy", fromBar: 1, toBar: 2, atBar: 3, times: 2 },
      { action: "copy", trackId: "bass", fromBar: 1, atBar: 3, merge: true },
      { action: "move", allTracks: true, section: "chorus", atBar: 1 },
      { action: "clear", fromBar: 2 },
      { action: "reverse", fromBar: 1, toBar: 2 },
      { action: "insert_bars", bars: 2, atBar: 3 },
      { action: "remove_bars", fromBar: 3, toBar: 4 },
      { action: "split", section: "chorus", atBar: 7 },
      { action: "join", section: "chorus" },
    ]) {
      const line = rangeToolCommand(args, ctx);
      expect(commandParses(line, base), line).toBe(true);
    }
  });

  test("loop sets the loop range as a diff op, unloop clears it", () => {
    const looped = run(base, { action: "loop", fromBar: 5, toBar: 6 });
    expect(looped.next.loop).toEqual({ startBar: 4, bars: 2 });
    expect(looped.next.sections).toEqual(base.sections);
    expect(looped.operations.length).toBeGreaterThan(0);
    const off = run(looped.next, { action: "unloop" });
    expect(off.next.loop ?? null).toBeNull();
  });

  test("copy tiles bars, move clears the source", () => {
    const copied = run(base, {
      action: "copy",
      fromBar: 1,
      toBar: 2,
      atBar: 5,
      times: 2,
    });
    expect(startsOf(copied.next).map(([bar]) => bar)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(
      startsOf(copied.next)
        .slice(4)
        .map(([, pitch]) => pitch),
    ).toEqual([60, 61, 60, 61]);
    const moved = run(base, { action: "move", fromBar: 1, atBar: 8 });
    const lead = startsOf(moved.next);
    expect(lead.find(([bar]) => bar === 0)).toBeUndefined();
    expect(lead.find(([bar]) => bar === 7)?.[1]).toBe(60);
  });

  test("insert_bars shifts sections and notes", () => {
    const grown = run(base, { action: "insert_bars", bars: 2, atBar: 3 });
    expect(grown.next.bars).toBe(10);
    expect(grown.next.sections[0]).toMatchObject({ startBar: 6, bars: 4 });
    expect(startsOf(grown.next).map(([bar]) => bar)).toEqual([
      0, 1, 4, 5, 6, 7, 8, 9,
    ]);
  });

  test("rejects bad arguments", () => {
    expect(() => run(base, { action: "copy", fromBar: 1 })).toThrow(
      ToolArgumentError,
    );
    expect(() => run(base, { action: "loop", fromBar: 3, toBar: 2 })).toThrow(
      ToolArgumentError,
    );
    expect(() =>
      run(base, { action: "clear", trackId: "nope", fromBar: 1 }),
    ).toThrow(ToolArgumentError);
    expect(() => run(base, { action: "spin" })).toThrow(ToolArgumentError);
  });
});
