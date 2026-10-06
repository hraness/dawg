import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { parseCompositionPlan, planComposition } from "./planner.ts";

const plan = (operations: unknown[]) =>
  parseCompositionPlan(JSON.stringify({ operations }));

describe("planner music operations", () => {
  test("accepts bounded effects, solo, and filter automation", () => {
    const result = plan([
      {
        type: "updateTrack",
        trackId: "drums",
        patch: {
          solo: true,
          filter: { cutoff: 900, resonance: 0.3 },
          delay: { beats: 0.5, feedback: 0.4, mix: 0.2 },
          evil: "ignored",
        },
      },
      { type: "updateTrack", trackId: "keys", patch: { filter: null } },
      {
        type: "setAutomation",
        trackId: "drums",
        parameter: "filter",
        points: [
          { tick: 0, value: 300 },
          { tick: 960, value: 6_000 },
        ],
      },
    ]);
    expect(result.operations[0]).toEqual({
      type: "updateTrack",
      trackId: "drums",
      patch: {
        solo: true,
        filter: { cutoff: 900, resonance: 0.3 },
        delay: { beats: 0.5, feedback: 0.4, mix: 0.2 },
      },
    });
    expect(result.operations[1]).toEqual({
      type: "updateTrack",
      trackId: "keys",
      patch: { filter: null },
    });
    expect(result.operations[2]).toMatchObject({ parameter: "filter" });
  });

  test("rejects out-of-range effects and filter automation", () => {
    for (const patch of [
      { filter: { cutoff: 1e9 } },
      { filter: { cutoff: 500, resonance: -1 } },
      { delay: { beats: 99 } },
      { delay: { beats: 1, feedback: 1 } },
      { delay: "long" },
    ])
      expect(() =>
        plan([{ type: "updateTrack", trackId: "drums", patch }]),
      ).toThrow();
    expect(() =>
      plan([
        {
          type: "setAutomation",
          trackId: "drums",
          parameter: "filter",
          points: [{ tick: 0, value: 1 }],
        },
      ]),
    ).toThrow();
    expect(() =>
      plan([
        {
          type: "setAutomation",
          trackId: "drums",
          parameter: "reverb",
          points: [],
        },
      ]),
    ).toThrow();
  });

  test("accepts kit tracks and tells the model about drums and effects", async () => {
    const result = plan([
      {
        type: "addTrack",
        track: { id: "drums", name: "drums", instrument: "kit" },
      },
    ]);
    expect(result.operations[0]).toMatchObject({
      type: "addTrack",
      track: { instrument: "kit" },
    });
    let system = "";
    await planComposition({
      prompt: "add a beat",
      score: createScore({ tracks: [{ id: "main" }] }),
      trackId: "main",
      gateway: {
        complete: (request) => {
          system = request.messages[0]!.content;
          return Promise.resolve('{"operations":[]}');
        },
      },
    });
    expect(system).toContain("kick=36");
    expect(system).toContain("kit");
    expect(system).toContain('"filter"');
    expect(system).toContain("delay");
    expect(system).toContain("solo");
  });
});
