/** Aggregates eval runs into one row per model. Pure, so it is unit tested. */
import type { ClientStats } from "./client.ts";
import type { TaskRun } from "./run.ts";

export type RunRecord = Readonly<{
  model: string;
  rep: number;
  run: TaskRun;
  stats: ClientStats;
  /** Sum of model request durations (excludes tool execution). */
  modelMs: number;
  costUsd: number;
}>;

export type ModelSummary = Readonly<{
  model: string;
  runs: number;
  passed: number;
  passRate: number;
  /** Pass rate per tier. */
  tiers: Readonly<Record<string, number>>;
  /** Tasks that passed in every rep / in none. */
  alwaysPass: number;
  neverPass: number;
  p50TurnMs: number;
  p95TurnMs: number;
  p50ModelMs: number;
  p50FirstTokenMs: number | null;
  meanSteps: number;
  meanToolCalls: number;
  meanRejected: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  costUsd: number;
  costPerTaskUsd: number;
  errors: number;
}>;

/** Nearest-rank percentile; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

export function summarize(
  model: string,
  records: readonly RunRecord[],
): ModelSummary {
  const passed = records.filter((r) => r.run.pass).length;
  const byTier = new Map<string, { n: number; ok: number }>();
  const byTask = new Map<string, boolean[]>();
  for (const r of records) {
    const tier = byTier.get(r.run.tier) ?? { n: 0, ok: 0 };
    tier.n += 1;
    if (r.run.pass) tier.ok += 1;
    byTier.set(r.run.tier, tier);
    byTask.set(r.run.id, [...(byTask.get(r.run.id) ?? []), r.run.pass]);
  }
  const firsts = records
    .map((r) => r.stats.firstTokenMs)
    .filter((v): v is number => v !== null);
  const cost = records.reduce((sum, r) => sum + r.costUsd, 0);
  const completed = records.filter((r) => r.run.end !== "harness-error");
  return {
    model,
    runs: records.length,
    passed,
    passRate: records.length === 0 ? 0 : passed / records.length,
    tiers: Object.fromEntries(
      [...byTier].map(([tier, { n, ok }]) => [tier, ok / n]),
    ),
    alwaysPass: [...byTask.values()].filter((v) => v.every(Boolean)).length,
    neverPass: [...byTask.values()].filter((v) => !v.some(Boolean)).length,
    p50TurnMs: percentile(
      completed.map((r) => r.run.wallMs),
      50,
    ),
    p95TurnMs: percentile(
      completed.map((r) => r.run.wallMs),
      95,
    ),
    p50ModelMs: percentile(
      completed.map((r) => r.modelMs),
      50,
    ),
    p50FirstTokenMs: firsts.length === 0 ? null : percentile(firsts, 50),
    meanSteps: mean(records.map((r) => r.run.turns)),
    meanToolCalls: mean(records.map((r) => r.run.toolCalls)),
    meanRejected: mean(records.map((r) => r.run.rejected)),
    meanInputTokens: mean(records.map((r) => r.stats.inputTokens)),
    meanOutputTokens: mean(records.map((r) => r.stats.outputTokens)),
    costUsd: cost,
    costPerTaskUsd: records.length === 0 ? 0 : cost / records.length,
    errors: records.length - completed.length,
  };
}
