import { describe, expect, test } from "bun:test";
import { GOLD } from "./gold/index.ts";
import { performChart } from "./perform.ts";
import {
  chartSystemPrompt,
  costOf,
  readChartAnswer,
  reviewChart,
  writeChart,
  type ChatTurn,
} from "./write.ts";

const fence = (value: unknown) =>
  `Here it is.\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

describe("chart writer", () => {
  test("cost uses the provider's charge, then Opus list prices", () => {
    expect(costOf({ inputTokens: 10, outputTokens: 10, costUsd: 0.5 })).toBe(
      0.5,
    );
    expect(
      costOf({
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(2 + 0.1 + 2);
  });

  test("the prompt carries the format, the names and every gold chart", () => {
    const prompt = chartSystemPrompt();
    expect(prompt).toContain("export type Chart");
    expect(prompt).toContain("supersaw");
    for (const chart of GOLD) expect(prompt).toContain(chart.title);
    expect(prompt).toContain("no key changes");
  });

  test("reads a fenced chart and names what's wrong with a bad one", () => {
    expect("chart" in readChartAnswer(fence(GOLD[0]))).toBe(true);
    expect(readChartAnswer("no json here")).toHaveProperty("error");
    const bad = readChartAnswer(
      fence({ ...GOLD[0], sounds: { ...GOLD[0]!.sounds, pad: "theremin" } }),
    );
    expect("error" in bad && bad.error).toContain("sounds.pad theremin");
  });

  test("a chart that copies a gold form section for section is sent back", () => {
    const { problems } = reviewChart(GOLD[1]!);
    expect(problems.some((p) => p.includes("the form copies"))).toBe(true);
  });

  test("the gold charts fit the note budget within their designed losses", () => {
    for (const chart of GOLD) {
      const { thinned } = performChart(chart);
      expect(thinned.arp2 ?? 0).toBeLessThanOrEqual(0.5);
      for (const [id, share] of Object.entries(thinned))
        if (id !== "arp2") expect(share).toBeLessThanOrEqual(0.3);
    }
  });

  test("a drift in the first section starts at tick 0", () => {
    const chart = GOLD[0]!;
    const [intro, ...rest] = chart.sections;
    const drifted = {
      ...chart,
      sections: [
        {
          ...intro!,
          moves: [
            ...(intro!.moves ?? []),
            { move: "drift", layer: "pad" } as const,
          ],
        },
        ...rest,
      ],
    };
    expect(() => performChart(drifted)).not.toThrow();
  });

  test("each round's problems go back to the model and the best draft wins", async () => {
    const seen: (readonly ChatTurn[])[] = [];
    const answers = ["```json\n{not json\n```", fence(GOLD[2])];
    const song = await writeChart(
      "a test song",
      async (turns) => {
        seen.push(turns);
        return {
          text: answers[seen.length - 1]!,
          usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.25 },
        };
      },
      { rounds: 2 },
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]!.at(-1)!.content).toContain("not JSON");
    expect(song.chart.title).toBe(GOLD[2]!.title);
    expect(song.drafts).toHaveLength(2);
    expect(song.costUsd).toBeCloseTo(0.5);
    expect(song.outputTokens).toBe(100);
  });

  test("a dropped stream asks again once, and a later failure keeps the best draft", async () => {
    // A gold chart sent back plays but copies its own form, so a round follows.
    const drop = new Error("AI Gateway stream failed: socket closed");
    const replies = [drop, fence(GOLD[2]), drop, drop];
    let calls = 0;
    const song = await writeChart(
      "a test song",
      async () => {
        const next = replies[calls++]!;
        if (next instanceof Error) throw next;
        return { text: next };
      },
      { rounds: 3 },
    );
    expect(calls).toBe(4);
    expect(song.chart.title).toBe(GOLD[2]!.title);
    expect(song.problems[0]).toContain("copies");
    expect(song.drafts).toHaveLength(1);
    expect(song.stopped).toContain("round 2 failed");
  });

  test("any other failure before a draft plays still throws", async () => {
    let calls = 0;
    const failed = await writeChart("a test song", async () => {
      calls++;
      throw new Error("AI Gateway returned 401");
    }).catch((e: Error) => e.message);
    expect(calls).toBe(1);
    expect(failed).toContain("401");
  });
});
