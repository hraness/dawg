import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { parseCompositionPlan, planComposition } from "./planner.ts";

describe("composition planner", () => {
  test("accepts bounded fenced JSON and rejects prose", () => {
    const plan = parseCompositionPlan(
      '```json\n{"operations":[{"type":"addNote","note":{"id":"x","trackId":"main","start":0,"duration":1,"pitch":60,"velocity":0.8}}]}\n```',
    );
    expect(plan.operations).toHaveLength(1);
    expect(() => parseCompositionPlan("make it funky")).toThrow("valid JSON");
  });

  test("sends score context through the gateway and parses its response", async () => {
    const calls: unknown[] = [];
    const plan = await planComposition({
      prompt: "add a kick",
      score: createScore({ tracks: [{ id: "main" }] }),
      trackId: "main",
      gateway: {
        complete: (request) => {
          calls.push(request);
          return Promise.resolve(JSON.stringify({ operations: [] }));
        },
      },
    });
    expect(plan.operations).toEqual([]);
    expect(calls).toHaveLength(1);
    const request = calls[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]?.content).toContain("Available instruments:");
    expect(request.messages[1]?.content).toContain('"tracks"');
  });

  test("accepts bounded score control operations", () => {
    const plan = parseCompositionPlan(
      JSON.stringify({
        operations: [
          { type: "setTempo", tempoBpm: 128 },
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
        ],
      }),
    );
    expect(plan.operations).toHaveLength(4);
    expect(plan.operations[0]).toEqual({ type: "setTempo", tempoBpm: 128 });
    expect(plan.operations[3]).toEqual({
      type: "setAutomation",
      trackId: "main",
      parameter: "volume",
      points: [{ tick: 0, value: 0.25 }],
    });
  });
});
