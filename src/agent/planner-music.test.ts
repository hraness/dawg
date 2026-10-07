import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { parseCompositionPlan } from "./planner.ts";
import { chatTools } from "./tools.ts";

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

  test("accepts reverb and the delay and resonance automation lanes", () => {
    const result = plan([
      {
        type: "updateTrack",
        trackId: "keys",
        patch: { reverb: { mix: 0.3, size: 0.7 } },
      },
      { type: "updateTrack", trackId: "pad", patch: { reverb: null } },
      ...(["resonance", "delay-feedback", "delay-mix"] as const).map(
        (parameter) => ({
          type: "setAutomation",
          trackId: "keys",
          parameter,
          points: [
            { tick: 0, value: 0.1 },
            { tick: 480, value: 0.8 },
          ],
        }),
      ),
    ]);
    expect(result.operations[0]).toEqual({
      type: "updateTrack",
      trackId: "keys",
      patch: { reverb: { mix: 0.3, size: 0.7 } },
    });
    expect(result.operations[1]).toMatchObject({ patch: { reverb: null } });
    expect(
      result.operations.slice(2).map((operation) => {
        if (operation.type !== "setAutomation") throw new Error("wrong op");
        return operation.parameter;
      }),
    ).toEqual(["resonance", "delay-feedback", "delay-mix"]);
    for (const [parameter, value] of [
      ["delay-feedback", 0.95],
      ["delay-mix", 1.5],
      ["resonance", 2],
    ] as const)
      expect(() =>
        plan([
          {
            type: "setAutomation",
            trackId: "keys",
            parameter,
            points: [{ tick: 0, value }],
          },
        ]),
      ).toThrow();
    for (const reverb of [{ mix: 2 }, { mix: 0.5, size: -1 }, { size: 1 }])
      expect(() =>
        plan([{ type: "updateTrack", trackId: "keys", patch: { reverb } }]),
      ).toThrow();
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
    const tools = JSON.stringify(chatTools());
    expect(tools).toContain("kick");
    expect(tools).toContain("kit");
    expect(tools).toContain('"filter"');
    expect(tools).toContain("delay");
    expect(tools).toContain("solo");
    expect(tools).toContain("reverb");
    expect(tools).toContain("delay-mix");
    expect(tools).toContain("delay-feedback");
    expect(tools).toContain("resonance");
    expect(tools).toContain("set_fx");
  });
});
