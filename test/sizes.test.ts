/**
 * The terminal-size matrix, sampled: a handful of screens walked through a
 * few sizes (tiny, odd, design target, huge) in a real PTY. Every size must
 * draw without a throw, a wrap or a scroll; usable sizes keep the screen,
 * its header and bottom row. `bun run sizes` runs the full matrix.
 */
import { afterAll, expect, test } from "bun:test";
import { supported } from "./pty-harness.ts";
import {
  CHECK_SCENARIOS,
  CHECK_SIZES,
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
    for (const results of runs) expect(results.length).toBe(CHECK_SIZES.length);
  },
  90_000,
);
