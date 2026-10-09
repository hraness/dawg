import { describe, expect, test } from "bun:test";
import {
  fallbackModelId,
  FAST_MODEL_ALIAS,
  MODEL_CATALOG,
  modelAlias,
  resolveModelChoice,
} from "./models.ts";

describe("/model fast and fallbacks", () => {
  test("fast resolves to the measured fast model on both providers", () => {
    expect(FAST_MODEL_ALIAS).toBe("haiku-5.5");
    expect(resolveModelChoice("gateway", "fast")).toBe(
      "anthropic/claude-haiku-5.5",
    );
    expect(resolveModelChoice("openrouter", " FAST ")).toBe(
      "anthropic/claude-haiku-5.5",
    );
    expect(modelAlias("gateway", "anthropic/claude-haiku-5.5")).toBe(
      "haiku-5.5",
    );
  });

  test("haiku-5.5 falls back to glm-5.3-flash on the matching provider", () => {
    expect(fallbackModelId("gateway", "anthropic/claude-haiku-5.5")).toBe(
      "zai/glm-5.3-flash",
    );
    expect(fallbackModelId("openrouter", "anthropic/claude-haiku-5.5")).toBe(
      "z-ai/glm-5.3-flash",
    );
    expect(fallbackModelId("gateway", "anthropic/claude-opus-5.5")).toBe(
      undefined,
    );
    expect(fallbackModelId("gateway", "vendor/unknown")).toBe(undefined);
  });

  test("every fallback names a catalog alias on another vendor", () => {
    const aliases = new Set(MODEL_CATALOG.map((row) => row.alias));
    expect(aliases.has("fast")).toBe(false);
    for (const row of MODEL_CATALOG) {
      if (!row.fallback) continue;
      expect(aliases.has(row.fallback)).toBe(true);
      const target = MODEL_CATALOG.find((r) => r.alias === row.fallback)!;
      expect(target.gateway!.split("/")[0]).not.toBe(
        row.gateway!.split("/")[0],
      );
    }
  });
});
