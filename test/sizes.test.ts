/**
 * The terminal-size matrix, sampled: a handful of screens walked through a
 * few sizes (tiny, odd, design target, huge) in a real PTY. Every size must
 * draw without a throw, a wrap or a scroll; usable sizes keep the screen,
 * its header and bottom row. `bun run sizes` runs the full matrix.
 */
import { budget } from "./perf.ts";
import { afterAll, expect, test } from "bun:test";
import { supported } from "./pty-harness.ts";
import {
  CHECK_SCENARIOS,
  CHECK_SIZES,
  FRAME_BUDGET_MS,
  SCENARIOS,
  runScenario,
  stopGateway,
} from "./sizes-lib.ts";

afterAll(stopGateway);

// The scenarios run side by side: each is its own editor in its own PTY.
test.skipIf(!supported)(
  "size matrix: sampled screens draw cleanly at every sampled size",
  async () => {
    const runs = await Promise.all(
      CHECK_SCENARIOS.map((name) =>
        runScenario(
          SCENARIOS.find((s) => s.name === name)!,
          CHECK_SIZES,
        ),
      ),
    );
    const problems = runs
      .flat()
      .flatMap((r) =>
        r.problems.map((p) => `${r.scenario} ${r.size[0]}x${r.size[1]}: ${p}`),
      );
    expect(problems).toEqual([]);
    // The steady frame at 500x150 stays within the frame interval even on a
    // loaded check machine: test/perf.ts scales the budget by host speed.
    const slow = runs
      .flat()
      .filter((r) => r.size[0] === 500 && r.frameMs.length)
      .map((r) => ({
        scenario: r.scenario,
        ms: r.frameMs.slice().sort((a, b) => a - b)[r.frameMs.length >> 1]!,
      }))
      .filter((r) => r.ms > budget(FRAME_BUDGET_MS));
    expect(slow).toEqual([]);
    for (const results of runs) expect(results.length).toBe(CHECK_SIZES.length);
  },
  90_000,
);
