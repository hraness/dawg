/** `bun bench/perf/automation.ts`: sparse and dense automation lookup. */
import type { AutomationPoint } from "../../core/score.ts";
import { interpolateAutomation } from "../../src/audio/effects/common.ts";
import { metric, table, type Metric } from "./stats.ts";

/** Retain the original search as an independent exact-output baseline. */
function linear(
  points: readonly AutomationPoint[],
  tick: number,
  fallback: number,
): number {
  if (points.length === 0 || !Number.isFinite(tick)) return fallback;
  if (tick < points[0]!.tick) return fallback;
  const last = points[points.length - 1]!;
  if (tick >= last.tick) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (tick > right.tick) continue;
    const left = points[index - 1]!;
    const span = right.tick - left.tick;
    const ratio = span <= 0 ? 1 : (tick - left.tick) / span;
    return left.value + (right.value - left.value) * ratio;
  }
  return last.value;
}

export function automationLookup(repeats = 6): Metric[] {
  const out: Metric[] = [];
  for (const count of [7, 1000, 16_000]) {
    const points = Array.from({ length: count }, (_, index) => ({
      tick: index * 64,
      value: Math.sin(index * 0.43),
    }));
    const reads = count === 7 ? 1_000_000 : 10_000;
    const ticks = Array.from(
      { length: reads },
      (_, index) => ((index * 0.754877666) % 1) * (count - 1) * 64,
    );
    const before: number[] = [];
    const after: number[] = [];
    let reference: number | undefined;
    // One warmup pair, then alternate order to expose host-load/JIT bias.
    for (let run = 0; run <= repeats; run += 1) {
      for (const fast of run % 2 ? [true, false] : [false, true]) {
        const lookup = fast ? interpolateAutomation : linear;
        let sum = 0;
        const started = performance.now();
        for (const tick of ticks) sum += lookup(points, tick, 0.4);
        const elapsed = performance.now() - started;
        reference ??= sum;
        if (!Object.is(sum, reference))
          throw new Error("automation samples changed");
        if (run > 0) (fast ? after : before).push(elapsed);
      }
    }
    out.push(
      metric(
        `automation.${count}.linear`,
        `${reads} reads, ${count} points, original scan`,
        before,
      ),
      metric(
        `automation.${count}.lookup`,
        `${reads} reads, ${count} points, bounded lookup`,
        after,
      ),
    );
  }
  return out;
}

if (import.meta.main) console.log(table(automationLookup()));
