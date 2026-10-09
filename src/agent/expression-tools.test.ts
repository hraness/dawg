import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const tpb = 480;
const score = createScore({
  ticksPerBeat: tpb,
  tracks: [
    { id: "lead", instrument: "synth" },
    { id: "keys", instrument: "piano" },
  ],
  notes: [0, 1, 2, 3, 4, 5].map((beat) => ({
    id: `n${beat}`,
    trackId: "lead",
    startTick: beat * tpb,
    durationTicks: tpb,
    pitch: 60 + beat,
    velocity: 0.8,
  })),
});

function apply(plan: ReturnType<(typeof AGENT_TOOLS)[number]["plan"]>) {
  expect(plan.kind).toBe("score");
  if (plan.kind !== "score") throw new Error("not a score plan");
  return plan.operations.reduce(applyScoreOperation, score);
}

describe("expression tools", () => {
  test("set_expression sets articulation and glide over a beat range", () => {
    const next = apply(
      tool("set_expression").plan(
        { fromBeat: 2, toBeat: 4, articulation: "staccato", glide: 0.05 },
        context(score),
      ),
    );
    const by = (id: string) => next.notes.find((note) => note.id === id)!;
    expect(by("n2").articulation).toBe("staccato");
    expect(by("n3").glide).toBe(0.05);
    expect(by("n1").articulation).toBeUndefined();
    expect(by("n4").articulation).toBeUndefined();
  });

  test("set_expression takes bend shapes and clears with null", () => {
    const bent = apply(
      tool("set_expression").plan(
        { noteIds: ["n0"], bend: "scoop", vibrato: { rate: 5, depth: 30 } },
        context(score),
      ),
    );
    const note = bent.notes.find((item) => item.id === "n0")!;
    expect(note.bend?.length).toBeGreaterThan(1);
    expect(note.vibrato?.rate).toBe(5);
    const cleared = tool("set_expression").plan(
      { noteIds: ["n0"], bend: null, vibrato: null },
      context(bent),
    );
    if (cleared.kind !== "score") throw new Error("not a score plan");
    const back = cleared.operations.reduce(applyScoreOperation, bent);
    expect(back.notes.find((item) => item.id === "n0")!.bend).toBeUndefined();
    expect(back.toJSON()).toEqual(score.toJSON());
  });

  test("set_expression refuses bad values and empty ranges", () => {
    expect(() =>
      tool("set_expression").plan({ articulation: "wobbly" }, context(score)),
    ).toThrow();
    expect(() =>
      tool("set_expression").plan(
        { trackId: "keys", articulation: "accent" },
        context(score),
      ),
    ).toThrow(/no notes/);
    expect(() => tool("set_expression").plan({}, context(score))).toThrow(
      /at least one/,
    );
  });

  test("set_performance sets glide, pedal, velocity curve and humanize", () => {
    const next = apply(
      tool("set_performance").plan(
        {
          glide: { time: 0.06, mode: "legato" },
          pedal: [
            { beat: 0, state: "down" },
            { beat: 2, state: "up" },
          ],
          velocityCurve: { curve: "soft" },
          humanize: { timing: 10, velocity: 5, seed: 7 },
        },
        context(score),
      ),
    );
    const lead = next.tracks.find((track) => track.id === "lead")!;
    expect(lead.glide?.mode).toBe("legato");
    expect(lead.pedal?.map((event) => event.tick)).toEqual([0, 2 * tpb]);
    expect(lead.velocityCurve?.curve).toBe("soft");
    expect(lead.humanize?.seed).toBe(7);
    const off = tool("set_performance").plan(
      { glide: null, pedal: null, velocityCurve: null, humanize: null },
      context(next),
    );
    if (off.kind !== "score") throw new Error("not a score plan");
    expect(off.operations.reduce(applyScoreOperation, next).toJSON()).toEqual(
      score.toJSON(),
    );
  });

  test("set_expression humanizes a range and set_performance merges humanize", () => {
    const next = apply(
      tool("set_expression").plan(
        { fromBeat: 4, toBeat: 6, humanize: { timing: 10, velocity: 5 } },
        context(score),
      ),
    );
    const by = (id: string) => next.notes.find((note) => note.id === id)!;
    expect(by("n4").humanize).toEqual({ timing: 10, velocity: 5 });
    expect(by("n3").humanize).toBeUndefined();
    const once = tool("set_performance").plan(
      { humanize: { timing: 8, velocity: 6, seed: 3 } },
      context(score),
    );
    if (once.kind !== "score") throw new Error("not a score plan");
    const first = once.operations.reduce(applyScoreOperation, score);
    const twice = tool("set_performance").plan(
      { humanize: { timing: 12 } },
      context(first),
    );
    if (twice.kind !== "score") throw new Error("not a score plan");
    const lead = twice.operations
      .reduce(applyScoreOperation, first)
      .tracks.find((track) => track.id === "lead")!;
    expect(lead.humanize).toEqual({ timing: 12, velocity: 6, seed: 3 });
  });

  test("set_performance re-pedals each bar", () => {
    const next = apply(
      tool("set_performance").plan({ pedal: "bars" }, context(score)),
    );
    const pedal = next.tracks.find((track) => track.id === "lead")!.pedal!;
    expect(pedal.length).toBeGreaterThan(1);
    expect(pedal[0]?.state).toBe("down");
  });
});

describe("set_piano_pedals (0.6.1)", () => {
  test("sets and clears the soft and sostenuto lanes", () => {
    const next = apply(
      tool("set_piano_pedals").plan(
        {
          trackId: "keys",
          soft: [
            { beat: 0, state: "down" },
            { beat: 2, state: "up" },
          ],
          sostenuto: "bars",
        },
        context(score),
      ),
    );
    const keys = next.tracks.find((track) => track.id === "keys")!;
    expect(keys.softPedal).toEqual([
      { tick: 0, state: "down" },
      { tick: 2 * tpb, state: "up" },
    ]);
    expect(keys.sostenuto?.[0]).toEqual({ tick: 0, state: "down" });
    expect(keys.pedal).toBeUndefined();
    const off = tool("set_piano_pedals").plan(
      { trackId: "keys", soft: null, sostenuto: null },
      context(next),
    );
    if (off.kind !== "score") throw new Error("not a score plan");
    expect(off.operations.reduce(applyScoreOperation, next).toJSON()).toEqual(
      score.toJSON(),
    );
  });

  test("rejects sostenuto half and an empty call", () => {
    expect(() =>
      tool("set_piano_pedals").plan(
        { trackId: "keys", sostenuto: [{ beat: 0, state: "half" }] },
        context(score),
      ),
    ).toThrow(/sostenuto/);
    expect(() =>
      tool("set_piano_pedals").plan({ trackId: "keys" }, context(score)),
    ).toThrow(/soft, sostenuto/);
  });
});
