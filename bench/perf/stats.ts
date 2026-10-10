/** Shared helpers for bench/perf: percentiles, timing and result rows. */

export const epoch = (): number => performance.timeOrigin + performance.now();

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, rank)]!;
}

export type Metric = Readonly<{
  /** Stable id, e.g. `key.cold.sing-choir`. */
  id: string;
  /** What a person feels, in words. */
  label: string;
  unit: "ms" | "ms/bar" | "ns" | "KiB";
  median: number;
  p95: number;
  n: number;
}>;

export function metric(
  id: string,
  label: string,
  samples: readonly number[],
  unit: Metric["unit"] = "ms",
): Metric {
  const finite = samples.filter((value) => Number.isFinite(value));
  return {
    id,
    label,
    unit,
    median: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    n: finite.length,
  };
}

export function table(metrics: readonly Metric[]): string {
  const fmt = (value: number) =>
    !Number.isFinite(value)
      ? "-"
      : value >= 100
        ? value.toFixed(0)
        : value >= 10
          ? value.toFixed(1)
          : value.toFixed(2);
  return [
    "| metric | median | p95 | n | id |",
    "| --- | ---: | ---: | ---: | --- |",
    ...metrics.map(
      (m) =>
        `| ${m.label} | ${fmt(m.median)} ${m.unit} | ${fmt(m.p95)} ${m.unit} | ${m.n} | \`${m.id}\` |`,
    ),
  ].join("\n");
}

/**
 * The calibration loop: a fixed scalar workload (a one-pole filter over a
 * saw, like the engines' inner loops), best of several, in ms. CI gates
 * divide by it so a slow shared runner scales its own budget.
 */
let sink = 0;
export function calibrate(): number {
  let fastest = Infinity;
  for (let run = 0; run < 9; run += 1) {
    const started = performance.now();
    let phase = 0;
    let y = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      phase += 0.0123;
      if (phase >= 1) phase -= 1;
      y += (2 * phase - 1 - y) * 0.05;
    }
    sink += y;
    if (run >= 2) fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}
export const calibrationSink = (): number => sink;
