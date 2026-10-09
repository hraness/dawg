import { describe, expect, test } from "bun:test";
import { isProviderModelId, parseConfig } from "../auth/credentials.ts";
import {
  createOpenRouterClient,
  createGatewayClient,
  resolveModelId,
} from "./gateway.ts";
import { resolveModelChoice } from "./models.ts";
import { apiModelId } from "./provider.ts";
import { finishChunk, scriptedFetch, textChunk } from "./sse-fixtures.ts";

const VARIANTS = [
  "google/gemini-2.5-flash:nitro",
  "openai/gpt-oss-20b:nitro",
  "meta-llama/llama-3.1-8b-instruct:free",
  "qwen/qwen3-8b:floor",
];

describe("OpenRouter routing variants", () => {
  test("OpenRouter accepts :nitro, :free and :floor; the Gateway does not", () => {
    for (const id of VARIANTS) {
      expect(resolveModelChoice("openrouter", id)).toBe(id);
      expect(resolveModelChoice("gateway", id)).toBeUndefined();
      expect(resolveModelId(id, {}, "openrouter")).toBe(id);
      expect(() => resolveModelId(id)).toThrow("unknown model");
      expect(apiModelId("openrouter", { DAWG_MODEL: id }, {})).toBe(id);
      expect(() => apiModelId("gateway", { DAWG_MODEL: id }, {})).toThrow(
        "unknown DAWG_MODEL",
      );
    }
    expect(resolveModelChoice("openrouter", "qwen/qwen3-8b")).toBe(
      "qwen/qwen3-8b",
    );
    for (const bad of [
      "qwen/qwen3-8b:",
      "qwen/qwen3-8b:a:b",
      "qwen/qwen3-8b:no way",
      `qwen/q:${"x".repeat(33)}`,
    ])
      expect(isProviderModelId(bad, "openrouter")).toBe(false);
  });

  test("a saved OpenRouter variant survives the config round trip", () => {
    expect(
      parseConfig({
        openrouterModel: "openai/gpt-oss-20b:nitro",
        gatewayModel: "openai/gpt-oss-20b:nitro",
      }),
    ).toEqual({ openrouterModel: "openai/gpt-oss-20b:nitro" });
  });

  test("the OpenRouter client sends the variant as the model", async () => {
    const { fetcher, requests } = scriptedFetch([
      [textChunk("ok"), finishChunk("stop")],
    ]);
    const client = createOpenRouterClient({
      apiKey: "sk-or-test-0123456789",
      fetcher,
    });
    for await (const event of client.stream({
      model: "x",
      modelId: "google/gemini-2.5-flash:nitro",
      messages: [],
      maxResponseBytes: 1e4,
    }))
      void event;
    expect((requests[0]?.body as { model?: string }).model).toBe(
      "google/gemini-2.5-flash:nitro",
    );
    const gateway = createGatewayClient({
      apiKey: "k-0123456789abcdef",
      fetcher,
    });
    expect(() => gateway.modelId("google/gemini-2.5-flash:nitro")).toThrow();
  });
});
