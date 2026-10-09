/**
 * Per-token prices from the provider's own `/models` listing, so the eval
 * can estimate spend and enforce its cap even when the stream reports no
 * charge. A provider-reported charge always wins over the estimate.
 */
import type { ApiSelection } from "../../src/agent/provider.ts";
import type { ClientStats } from "./client.ts";

export type Pricing = Readonly<{
  /** USD per input token. */
  input: number;
  output: number;
  /** USD per cached input token (defaults to `input`). */
  cacheRead: number;
}>;

const num = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Parses one `/models` row's `pricing` (gateway or OpenRouter shape). */
export function parsePricing(raw: unknown): Pricing | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  const input = num(p.input) ?? num(p.prompt);
  const output = num(p.output) ?? num(p.completion);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead =
    num(p.input_cache_read) ?? num(p.input_cache_reads) ?? input;
  return { input, output, cacheRead };
}

/** USD for a run's token usage; uses the provider-reported charge when set. */
export function costOf(pricing: Pricing, stats: ClientStats): number {
  if (stats.reportedCostUsd > 0) return stats.reportedCostUsd;
  const cached = Math.min(stats.cachedInputTokens, stats.inputTokens);
  return (
    (stats.inputTokens - cached) * pricing.input +
    cached * pricing.cacheRead +
    stats.outputTokens * pricing.output
  );
}

export async function fetchPricing(
  selection: ApiSelection,
): Promise<Map<string, Pricing>> {
  const base =
    selection.kind === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : "https://ai-gateway.vercel.sh/v1";
  const response = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${selection.apiKey}` },
  });
  if (!response.ok)
    throw new Error(`model listing failed: HTTP ${response.status}`);
  const json = (await response.json()) as { data?: unknown[] };
  const out = new Map<string, Pricing>();
  for (const row of json.data ?? []) {
    if (typeof row !== "object" || row === null) continue;
    const { id, pricing } = row as { id?: unknown; pricing?: unknown };
    const parsed = parsePricing(pricing);
    if (typeof id === "string" && parsed) out.set(id, parsed);
  }
  return out;
}
