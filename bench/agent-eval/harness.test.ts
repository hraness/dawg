import { describe, expect, test } from "bun:test";

import type { ChatStreamEvent } from "../../src/agent/gateway.ts";
import {
  recordingClient,
  replayClient,
  ReplayExhaustedError,
} from "./client.ts";
import { costOf, parsePricing } from "./pricing.ts";
import { markdownTable, merge } from "./report.ts";
import { percentile, summarize, type RunRecord } from "./summary.ts";

function record(
  model: string,
  id: string,
  tier: string,
  pass: boolean,
  wallMs: number,
  rep = 1,
): RunRecord {
  return {
    model,
    rep,
    run: {
      id,
      tier,
      pass,
      checks: [],
      turns: 2,
      toolCalls: 1,
      rejected: 0,
      calls: [],
      end: "stop",
      text: "",
      wallMs,
    },
    stats: {
      requests: 2,
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 50,
      reportedCostUsd: 0,
      firstTokenMs: wallMs / 4,
    },
    modelMs: wallMs,
    costUsd: 0.01,
  };
}

describe("eval harness", () => {
  test("percentile is nearest rank", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  });

  test("summarize counts tiers, always/never-pass tasks and latency", () => {
    const s = summarize("m", [
      record("m", "a", "single", true, 1000, 1),
      record("m", "a", "single", true, 2000, 2),
      record("m", "b", "compose", false, 3000, 1),
      record("m", "b", "compose", true, 4000, 2),
      record("m", "c", "compose", false, 5000, 1),
    ]);
    expect(s.passRate).toBe(0.6);
    // Task-weighted: a 1, b 0.5, c 0; reps do not outweigh other tasks.
    expect(s.taskPassRate).toBe(0.5);
    expect(s.tiers).toEqual({ single: 1, compose: 0.25 });
    expect(s.alwaysPass).toBe(1);
    expect(s.neverPass).toBe(1);
    expect(s.p50TurnMs).toBe(3000);
    expect(s.p50FirstTokenMs).toBe(750);
    expect(s.costUsd).toBeCloseTo(0.05);
  });

  test("pricing parses gateway and OpenRouter rows; a reported charge wins", () => {
    const gw = parsePricing({
      input: "0.000001",
      output: "0.000004",
      input_cache_read: "0.0000001",
    });
    expect(gw).toEqual({ input: 1e-6, output: 4e-6, cacheRead: 1e-7 });
    expect(
      parsePricing({ prompt: "0.000002", completion: "0.000008" })?.cacheRead,
    ).toBe(2e-6);
    expect(parsePricing({ input: "x" })).toBeUndefined();
    const stats = {
      requests: 1,
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 100,
      reportedCostUsd: 0,
      firstTokenMs: null,
    };
    expect(costOf(gw!, stats)).toBeCloseTo(600e-6 + 400e-7 + 400e-6, 12);
    expect(costOf(gw!, { ...stats, reportedCostUsd: 0.5 })).toBe(0.5);
  });

  test("recording keeps the stream, drops retry chatter and times first token", async () => {
    const events: ChatStreamEvent[] = [
      { type: "activity", message: "retrying" },
      { type: "text", delta: "hi" },
      { type: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 },
      { type: "finish", reason: "stop" },
    ];
    const inner = replayClient([{ events, firstTokenMs: 0, totalMs: 0 }]);
    const client = recordingClient(inner, "vendor/model");
    expect(client.modelId("opus-5.5")).toBe("vendor/model");
    for await (const _ of client.stream({
      model: "opus-5.5",
      messages: [],
      maxResponseBytes: 1000,
    }));
    expect(client.recorded[0]!.events.map((e) => e.type)).toEqual([
      "text",
      "usage",
      "finish",
    ]);
    expect(client.stats).toMatchObject({
      requests: 1,
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 4,
    });
    expect(client.stats.firstTokenMs).not.toBeNull();
  });

  test("a replay that runs out throws ReplayExhaustedError", async () => {
    const client = replayClient([]);
    const drain = async () => {
      for await (const _ of client.stream({
        model: "opus-5.5",
        messages: [],
        maxResponseBytes: 1,
      }));
    };
    await expect(drain()).rejects.toBeInstanceOf(ReplayExhaustedError);
  });

  test("merge combines files and the table ranks by pass rate", () => {
    const { summaries } = merge([
      { records: [record("slow", "a", "single", true, 9000)] },
      {
        records: [
          record("fast", "a", "single", true, 1000),
          record("bad", "a", "single", false, 500),
        ],
      },
    ]);
    const table = markdownTable(summaries).split("\n");
    expect(table).toHaveLength(5);
    expect(table[2]).toStartWith("| fast | 100% | 100% | – |");
    expect(table[3]).toStartWith("| slow |");
    expect(table[4]).toStartWith("| bad | 0% |");
  });
});
