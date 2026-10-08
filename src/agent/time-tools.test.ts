import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const tool = AGENT_TOOLS.find((t) => t.name === "set_time")!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "a",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const base = createScore({
  bars: 8,
  tracks: [
    { id: "a", instrument: "piano" },
    { id: "b", instrument: "piano" },
  ],
});

function apply(score: TrackScore, args: Record<string, unknown>) {
  const plan = tool.plan(args, context(score));
  if (plan.kind !== "score") throw new Error("expected a score plan");
  return {
    plan,
    next: plan.operations.reduce(applyScoreOperation, score),
  };
}

describe("set_time", () => {
  test("is registered", () => {
    expect(tool).toBeDefined();
  });

  test("tempo, rit and meter land as one setTime operation each", () => {
    const tempo = apply(base, { action: "tempo", bpm: 140, bar: 3 });
    expect(tempo.plan.operations.map((op) => op.type)).toEqual(["setTime"]);
    expect(tempo.next.time?.tempo?.length).toBeGreaterThan(0);

    const rit = apply(tempo.next, { action: "rit", bars: 2, bpm: 80 });
    expect(rit.next.time?.tempo?.length).toBeGreaterThan(
      tempo.next.time!.tempo!.length,
    );

    const meter = apply(rit.next, { action: "meter", meter: "7/8", bar: 5 });
    expect(meter.next.time?.meter?.length).toBe(1);

    const cleared = apply(meter.next, { action: "clear" });
    expect(cleared.next.time).toBeUndefined();
  });

  test("fermata defaults to two extra beats", () => {
    const { next } = apply(base, { action: "fermata", bar: 4 });
    expect(next.time?.fermatas?.[0]?.beats).toBe(2);
  });

  test("track rate and phasing set the track's time", () => {
    const rate = apply(base, { action: "track", trackId: "b", rate: 1.5 });
    expect(rate.plan.trackId).toBe("b");
    expect(rate.next.tracks.find((t) => t.id === "b")?.time?.rate).toBe(1.5);

    const phasing = apply(base, {
      action: "phasing",
      trackId: "b",
      cycle: 12,
      over: 48,
    });
    const time = phasing.next.tracks.find((t) => t.id === "b")?.time;
    expect(time?.cycle).toBe(12 * base.ticksPerBeat);
    expect(time?.rate).toBeCloseTo(48 / 47, 6);
  });

  test("bad arguments are tool errors", () => {
    expect(() => tool.plan({ action: "tempo" }, context(base))).toThrow(
      "tempo needs bpm",
    );
    expect(() =>
      tool.plan({ action: "meter", meter: "7" }, context(base)),
    ).toThrow("meter must look like 7/8");
    expect(() =>
      tool.plan({ action: "track", trackId: "zz", rate: 2 }, context(base)),
    ).toThrow("no track zz");
  });
});
