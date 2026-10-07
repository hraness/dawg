import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsage } from "./gateway.ts";
import {
  addToLedger,
  dayKey,
  LEDGER_DAYS,
  parseLedger,
  priceUsage,
  readLedger,
  recordUsage,
  SpendMeter,
  spendLine,
} from "./usage.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-usage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PRICE = { input: 5e-6, output: 25e-6 };

describe("usage from streamed chunks", () => {
  test("parses OpenAI-compatible usage, cached tokens and provider cost", () => {
    expect(parseUsage({ prompt_tokens: 100, completion_tokens: 20 })).toEqual({
      type: "usage",
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(
      parseUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
        cost: "0.0012",
      }),
    ).toEqual({
      type: "usage",
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 60,
      costUsd: 0.0012,
    });
    expect(parseUsage({ prompt_tokens: "x" })).toBeUndefined();
    expect(
      parseUsage({ prompt_tokens: 1, completion_tokens: 1, cost: -1 }),
    ).toEqual({
      type: "usage",
      inputTokens: 1,
      outputTokens: 1,
    });
  });

  test("provider cost wins; otherwise tokens × price; otherwise unknown", () => {
    expect(
      priceUsage({ inputTokens: 1000, outputTokens: 100, costUsd: 0.5 }, PRICE),
    ).toBe(0.5);
    expect(
      priceUsage({ inputTokens: 1000, outputTokens: 100 }, PRICE),
    ).toBeCloseTo(1000 * 5e-6 + 100 * 25e-6, 12);
    expect(
      priceUsage({ inputTokens: 1, outputTokens: 1 }, undefined),
    ).toBeUndefined();
  });
});

describe("daily ledger", () => {
  test("accumulates per day and prunes to the last days", () => {
    let ledger = parseLedger({});
    for (let i = 0; i < LEDGER_DAYS + 5; i += 1) {
      const day = dayKey(new Date(2026, 0, 1 + i));
      ledger = addToLedger(ledger, day, 0.01, {
        inputTokens: 10,
        outputTokens: 1,
      });
    }
    ledger = addToLedger(
      ledger,
      dayKey(new Date(2026, 0, LEDGER_DAYS + 5)),
      0.02,
      {
        inputTokens: 5,
        outputTokens: 5,
      },
    );
    const keys = Object.keys(ledger.days);
    expect(keys.length).toBe(LEDGER_DAYS);
    expect(keys[0]).toBe(dayKey(new Date(2026, 0, 6)));
    const last = ledger.days[dayKey(new Date(2026, 0, LEDGER_DAYS + 5))]!;
    expect(last.usd).toBeCloseTo(0.03, 10);
    expect(last.requests).toBe(2);
    expect(last.inputTokens).toBe(15);
  });

  test("garbage in the file is ignored", () => {
    expect(
      parseLedger({
        days: {
          "not-a-day": { usd: 1 },
          "2026-10-06": { usd: -5, requests: "x" },
        },
      }),
    ).toEqual({
      version: 1,
      days: {
        "2026-10-06": { usd: 0, requests: 0, inputTokens: 0, outputTokens: 0 },
      },
    });
  });

  test("concurrent writers lose nothing; the file is private", async () => {
    const at = new Date(2026, 9, 6, 12);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        recordUsage(dir, 0.01, { inputTokens: 1, outputTokens: 1 }, at),
      ),
    );
    const ledger = await readLedger(dir);
    expect(ledger.days["2026-10-06"]?.requests).toBe(12);
    expect(ledger.days["2026-10-06"]?.usd).toBeCloseTo(0.12, 10);
    expect((await stat(join(dir, "usage.json"))).mode & 0o777).toBe(0o600);
    await expect(stat(join(dir, "usage.json.lock"))).rejects.toThrow();
  });

  test("a stale lock left by a crashed window is taken over", async () => {
    const lock = join(dir, "usage.json.lock");
    await writeFile(lock, "");
    const old = new Date(Date.now() - 60_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(lock, old, old);
    await recordUsage(dir, 0.05, { inputTokens: 1, outputTokens: 1 });
    expect(Object.values((await readLedger(dir)).days)[0]?.usd).toBeCloseTo(
      0.05,
      10,
    );
  });
});

describe("spend meter and line", () => {
  test("session and today totals carry across windows", async () => {
    const now = () => new Date(2026, 9, 6, 9);
    await recordUsage(dir, 0.3, { inputTokens: 1, outputTokens: 1 }, now());
    const meter = new SpendMeter(dir, now);
    await meter.load();
    expect(meter.todayUsd).toBeCloseTo(0.3, 10);
    meter.add(
      { inputTokens: 2600, outputTokens: 40, costUsd: 0.0141 },
      undefined,
    );
    meter.add({ inputTokens: 1000, outputTokens: 100 }, PRICE);
    meter.add({ inputTokens: 1, outputTokens: 1 }, undefined);
    await meter.flush();
    expect(meter.sessionUsd).toBeCloseTo(0.0141 + 0.0075, 10);
    expect(meter.todayUsd).toBeCloseTo(0.3216, 10);
    expect(meter.unpriced).toBe(true);
    const file = JSON.parse(await readFile(join(dir, "usage.json"), "utf8"));
    expect(file.days["2026-10-06"].requests).toBe(3);
  });

  test("formats, collapses on narrow widths, and handles subscriptions/offline", () => {
    const api = {
      kind: "api" as const,
      model: "opus-5.5",
      provider: "gateway",
      sessionUsd: 0.12,
      todayUsd: 0.48,
    };
    expect(spendLine(api)).toBe(
      "$0.12 session · $0.48 today · opus-5.5 · gateway",
    );
    expect(spendLine(api, 36)).toBe("$0.12 session · opus-5.5 · gateway");
    expect(spendLine(api, 25)).toBe("$0.12 session · opus-5.5");
    expect(spendLine(api, 10)).toBe("opus-5.5");
    expect(
      spendLine({ kind: "subscription", model: "sonnet", provider: "claude" }),
    ).toBe("subscription · sonnet · claude");
    expect(spendLine({ kind: "offline" })).toBe("no model · dawg login");
  });
});
