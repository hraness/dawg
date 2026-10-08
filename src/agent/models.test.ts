import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import { AGENT_SYSTEM_PROMPT } from "./agent.ts";
import { compositionBrief } from "./brief.ts";
import {
  estimatePromptCost,
  estimateRequestCost,
  formatPromptCost,
  loadPrices,
  modelAlias,
  modelRows,
  parseLiveCatalog,
  parseModelsDev,
  PRICE_TTL_MS,
  priceFor,
  resolveModelChoice,
  TYPICAL_PROMPT,
} from "./models.ts";
import { chatTools } from "./tools.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-models-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A trimmed models.dev payload (USD per million tokens). */
const MODELS_DEV = {
  vercel: {
    models: {
      "anthropic/claude-opus-5.5": {
        cost: { input: 5, output: 25, cache_read: 0.5 },
      },
      "unpriced/model": { cost: { input: 0, output: 0 } },
    },
  },
  openrouter: {
    models: { "qwen/qwen3.8-27b": { cost: { input: 0.2, output: 0.8 } } },
  },
  zai: { models: { "glm-5.3": { cost: { input: 0.6, output: 2.2 } } } },
  "not-a-tracked-provider": {
    models: { x: { cost: { input: 1, output: 1 } } },
  },
};

function jsonFetcher(payload: unknown, calls: { n: number }) {
  return async () => {
    calls.n += 1;
    return Response.json(payload);
  };
}

describe("models.dev pricing", () => {
  test("parses per-million prices into per-token, drops 0/0 and untracked providers", () => {
    const table = parseModelsDev(MODELS_DEV, 1);
    expect(table.providers.vercel?.["anthropic/claude-opus-5.5"]).toEqual({
      input: 5e-6,
      output: 25e-6,
      cacheRead: 0.5e-6,
    });
    expect(table.providers.vercel?.["unpriced/model"]).toBeUndefined();
    expect(table.providers["not-a-tracked-provider"]).toBeUndefined();
  });

  test("maps gateway and OpenRouter IDs, falling back to the vendor listing", () => {
    const table = parseModelsDev(MODELS_DEV);
    expect(priceFor(table, "gateway", "anthropic/claude-opus-5.5")?.input).toBe(
      5e-6,
    );
    expect(
      priceFor(table, "openrouter", "qwen/qwen3.8-27b")?.output,
    ).toBeCloseTo(0.8e-6, 12);
    // OpenRouter's `z-ai/` maps to models.dev's `zai` provider.
    expect(priceFor(table, "openrouter", "z-ai/glm-5.3")?.input).toBeCloseTo(
      0.6e-6,
      12,
    );
    expect(priceFor(table, "gateway", "nobody/nothing")).toBeUndefined();
  });

  test("caches for ~24 h, then a stale cache wins when offline", async () => {
    const calls = { n: 0 };
    let now = 1_000_000;
    const first = await loadPrices({
      configDir: dir,
      fetcher: jsonFetcher(MODELS_DEV, calls),
      now: () => now,
    });
    expect(calls.n).toBe(1);
    expect(first.providers.vercel).toBeDefined();
    const info = await stat(join(dir, "cache", "models-dev.json"));
    expect(info.mode & 0o777).toBe(0o600);

    // Fresh cache: no fetch.
    now += PRICE_TTL_MS - 1;
    await loadPrices({
      configDir: dir,
      fetcher: jsonFetcher({}, calls),
      now: () => now,
    });
    expect(calls.n).toBe(1);

    // Stale and offline: the old table still answers.
    now += 2;
    const offline = await loadPrices({
      configDir: dir,
      fetcher: async () => {
        calls.n += 1;
        throw new Error("offline");
      },
      now: () => now,
    });
    expect(calls.n).toBe(2);
    expect(
      offline.providers.vercel?.["anthropic/claude-opus-5.5"],
    ).toBeDefined();
  });

  test("no cache and offline yields an empty table", async () => {
    const table = await loadPrices({
      configDir: dir,
      fetcher: async () => new Response("nope", { status: 503 }),
    });
    expect(table.providers).toEqual({});
  });

  test("an oversized response is refused", async () => {
    const table = await loadPrices({
      configDir: dir,
      fetcher: async () =>
        new Response("{}", { headers: { "content-length": String(1 << 30) } }),
    });
    expect(table.providers).toEqual({});
  });
});

describe("cost per prompt", () => {
  test("the typical prompt matches the real system prompt, tools and brief", () => {
    const score = createScore({
      tracks: [
        { id: "drums", instrument: "drums" },
        { id: "bass", instrument: "bass" },
        { id: "keys", instrument: "piano" },
      ],
      notes: Array.from({ length: 48 }, (_, i) => ({
        id: `n${i}`,
        trackId: ["drums", "bass", "keys"][i % 3]!,
        startTick: i * 120,
        durationTicks: 120,
        pitch: 36 + (i % 24),
        velocity: 0.8,
      })),
    });
    const bytes =
      AGENT_SYSTEM_PROMPT.length +
      JSON.stringify(chatTools()).length +
      compositionBrief({ score, revision: 1, focusedTrackId: "keys" }).length +
      100;
    // ~4 bytes per token, ~2 requests per prompt plus the first step's results.
    const estimated = Math.round((bytes / 4) * 2 + 150);
    expect(Math.abs(estimated - TYPICAL_PROMPT.inputTokens)).toBeLessThan(
      TYPICAL_PROMPT.inputTokens * 0.35,
    );
  });

  test("estimate = typical input × input price + typical output × output price", () => {
    const price = { input: 5e-6, output: 25e-6 };
    expect(estimatePromptCost(price)).toBeCloseTo(
      18_500 * 5e-6 + 600 * 25e-6,
      10,
    );
    expect(formatPromptCost(estimatePromptCost(price))).toBe("~$0.11/prompt");
    expect(
      formatPromptCost(estimatePromptCost({ input: 0.2e-6, output: 0.8e-6 })),
    ).toBe("~$0.0042/prompt");
    expect(formatPromptCost(undefined)).toBe("—");
    expect(formatPromptCost(0)).toBe("free");
  });

  test("a request with cached input bills the cache rate", () => {
    const price = { input: 10e-6, output: 20e-6, cacheRead: 1e-6 };
    expect(
      estimateRequestCost(price, {
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 800,
      }),
    ).toBeCloseTo(200 * 10e-6 + 800 * 1e-6 + 100 * 20e-6, 12);
  });
});

describe("model picker rows", () => {
  const catalog = parseLiveCatalog("openrouter", {
    data: [
      {
        id: "anthropic/claude-opus-5.5",
        name: "Claude Opus 5.5",
        supported_parameters: ["tools"],
        pricing: { prompt: "0.000004", completion: "0.00002" },
      },
      { id: "qwen/qwen3.8-27b", supported_parameters: ["tools"], pricing: {} },
      { id: "moonshotai/kimi-k3", supported_parameters: [], pricing: {} },
      { id: "anthropic/claude-haiku-4.5", supported_parameters: ["tools"] },
    ],
  });

  test("lists only tool-capable served models, grouped, current marked", () => {
    const rows = modelRows("openrouter", {
      current: "anthropic/claude-haiku-4.5",
      catalog,
      prices: parseModelsDev(MODELS_DEV),
    });
    expect(rows.map((row) => row.alias)).toEqual([
      "opus-5.5",
      "haiku-4.5",
      "qwen3.8-27b",
    ]);
    expect(rows.map((row) => row.class)).toEqual(["frontier", "fast", "open"]);
    expect(rows.find((row) => row.current)?.alias).toBe("haiku-4.5");
    // OpenRouter's own price wins over models.dev.
    expect(rows[0]?.costUsd).toBeCloseTo(18_500 * 4e-6 + 600 * 2e-5, 10);
    // Priced from models.dev when the live catalog has none.
    expect(rows[2]?.costUsd).toBeCloseTo(18_500 * 0.2e-6 + 600 * 0.8e-6, 10);
    // Unknown price stays undefined (shown as —).
    expect(rows[1]?.costUsd).toBeUndefined();
  });

  test("without a live catalog every curated entry is listed", () => {
    const rows = modelRows("gateway", {});
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.some((row) => row.class === "open")).toBe(true);
  });

  test("aliases and labels resolve per provider", () => {
    expect(resolveModelChoice("openrouter", "glm-5.3")).toBe("z-ai/glm-5.3");
    expect(resolveModelChoice("gateway", "glm-5.3")).toBe("zai/glm-5.3");
    expect(resolveModelChoice("gateway", "OPUS-5.5")).toBe(
      "anthropic/claude-opus-5.5",
    );
    expect(resolveModelChoice("gateway", "sol-6.1")).toBe("openai/gpt-6.1-sol");
    expect(resolveModelChoice("gateway", "not a model")).toBeUndefined();
    expect(modelAlias("openrouter", "meta-llama/llama-4-maverick")).toBe(
      "llama-4-maverick",
    );
  });

  test("the live catalog cache holds tool-capable rows only", async () => {
    // Written via loadLiveCatalog in openrouter.test.ts; here just the parse.
    expect(catalog.models.filter((m) => m.tools).length).toBe(3);
    await expect(readFile(join(dir, "none"), "utf8")).rejects.toThrow();
  });
});
