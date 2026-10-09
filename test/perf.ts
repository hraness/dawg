/**
 * Wall-clock budgets for performance tests. A test file that times work with
 * `performance.now()` goes through here (test/perf-gate.test.ts enforces it),
 * so a loaded shared host cannot fail the suite while a real regression
 * still does:
 *
 * - `best` takes the fastest of several runs after a warm-up;
 * - `budget(ms)` scales an absolute budget, set on the reference Mac, by
 *   this host's speed (a fixed workload timed in-process) and a slack
 *   factor; `DAWG_PERF=1` asserts the budget as written;
 * - `ratio(cost, reference)` times two workloads back to back in pairs and
 *   keeps the best pair, and `ratioBudget(r)` adds slack unless
 *   `DAWG_PERF=1`.
 */

/** Strict budgets: `DAWG_PERF=1` on a quiet reference host. */
export const PERF_STRICT = process.env.DAWG_PERF === "1";
/** Headroom outside strict mode; `DAWG_PERF_SLACK` overrides. */
export const PERF_SLACK = Number(process.env.DAWG_PERF_SLACK) || 3;

/** Fastest of `runs` timings of `fn`, in ms, after `warm` untimed runs. */
export function best(fn: () => void, runs = 5, warm = 1): number {
  for (let i = 0; i < warm; i += 1) fn();
  let fastest = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

/** The reference workload's best time on the reference Mac, in ms. */
const REFERENCE_MS = 1.2;
let sink = 0;
function referenceWork(): void {
  // A one-pole filter over a saw: scalar float work like the engines'.
  let phase = 0;
  let y = 0;
  for (let i = 0; i < 1_000_000; i += 1) {
    phase += 0.0123;
    if (phase >= 1) phase -= 1;
    y += (2 * phase - 1 - y) * 0.05;
  }
  sink += y;
}

let scale: number | undefined;
/** How much slower than the reference Mac this host runs, at least 1. */
export function hostScale(): number {
  scale ??= Math.max(1, best(referenceWork, 5, 2) / REFERENCE_MS);
  return scale;
}

/** An absolute ms budget for this host: as written under `DAWG_PERF=1`. */
export function budget(ms: number): number {
  return PERF_STRICT ? ms : ms * hostScale() * PERF_SLACK;
}

/** A cost-ratio budget: as written under `DAWG_PERF=1`. */
export function ratioBudget(times: number): number {
  return PERF_STRICT ? times : times * PERF_SLACK;
}

/**
 * The cost of `fn` as a multiple of `reference`, each the best of `runs`,
 * timed back to back in `pairs` pairs; the lowest pair ratio wins, so a load
 * spike lands on one pair and not on the result.
 */
export function ratio(
  fn: () => void,
  reference: () => void,
  pairs = 3,
  runs = 5,
): number {
  let lowest = Infinity;
  for (let pair = 0; pair < pairs; pair += 1)
    lowest = Math.min(lowest, best(fn, runs) / best(reference, runs));
  return lowest;
}

/** Keeps the reference loop from being optimised away. */
export const perfSink = (): number => sink;
