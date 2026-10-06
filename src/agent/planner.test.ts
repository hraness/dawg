import { describe, expect, test } from "bun:test";
import { parseCompositionPlan, validateAgentOperation } from "./planner.ts";

describe("composition planner", () => {
  test("accepts bounded fenced JSON and rejects prose", () => {
    const plan = parseCompositionPlan(
      '```json\n{"operations":[{"type":"addNote","note":{"id":"x","trackId":"main","start":0,"duration":1,"pitch":60,"velocity":0.8}}]}\n```',
    );
    expect(plan.operations).toHaveLength(1);
    expect(() => parseCompositionPlan("make it funky")).toThrow("valid JSON");
  });

  test("accepts bounded score control operations", () => {
    const plan = parseCompositionPlan(
      JSON.stringify({
        operations: [
          { type: "setTempo", tempoBpm: 128 },
          { type: "setBars", bars: 8 },
          { type: "addTrack", track: { id: "bass", instrument: "bass" } },
          {
            type: "updateTrack",
            trackId: "main",
            patch: { instrument: "piano", volume: 0.8 },
          },
          { type: "clearTrack", trackId: "main" },
          {
            type: "setAutomation",
            trackId: "main",
            parameter: "volume",
            points: [{ tick: 0, value: 0.25 }],
          },
          {
            type: "setAutomation",
            trackId: "main",
            parameter: "pan",
            points: [{ tick: 480, value: -0.5 }],
          },
        ],
      }),
    );
    expect(plan.operations).toHaveLength(7);
    expect(plan.operations[0]).toEqual({ type: "setTempo", tempoBpm: 128 });
    expect(plan.operations[5]).toEqual({
      type: "setAutomation",
      trackId: "main",
      parameter: "volume",
      points: [{ tick: 0, value: 0.25 }],
    });
    expect(plan.operations[6]).toEqual({
      type: "setAutomation",
      trackId: "main",
      parameter: "pan",
      points: [{ tick: 480, value: -0.5 }],
    });
  });

  test("rejects out-of-range pan automation and malformed tracks", () => {
    expect(() =>
      parseCompositionPlan(
        JSON.stringify({
          operations: [
            {
              type: "setAutomation",
              trackId: "main",
              parameter: "pan",
              points: [{ tick: 0, value: -1.1 }],
            },
          ],
        }),
      ),
    ).toThrow("agent automation point is invalid");
    expect(() =>
      parseCompositionPlan(
        JSON.stringify({
          operations: [{ type: "addTrack", track: { id: "bad" } }],
        }),
      ),
    ).not.toThrow();
  });
});

describe("agent operation validator", () => {
  test("rejects unsupported and malformed operations", () => {
    expect(() => validateAgentOperation({ type: "dropTable" })).toThrow(
      "unsupported",
    );
    expect(() => validateAgentOperation(null)).toThrow("malformed");
    expect(validateAgentOperation({ type: "setBars", bars: 4 })).toEqual({
      type: "setBars",
      bars: 4,
    });
  });
});
