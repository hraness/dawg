/**
 * Property (f): an operation from a real diff with one field replaced by a
 * hostile value either applies or throws `ScoreValidationError`, never a
 * TypeError or RangeError from deeper code. Operations come from agents and
 * the TUI as JSON, so a bad field must be reported, not crash.
 */

import { describe, expect, test } from "bun:test";
import { applyScoreOperations, diffScores } from "../../core/diff.ts";
import { ScoreValidationError } from "../../core/score.ts";
import { caseCount, forAllSeeds, type Rng } from "./prng.ts";
import { nearbyScore, randomScore } from "./random.ts";

const HOSTILE: readonly unknown[] = [
  null,
  undefined,
  -1,
  -0,
  1e308,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  0.5,
  "",
  "x".repeat(300),
  true,
  [],
  [null],
  {},
  { tick: "a" },
];

/** Paths to every leaf and container under `value`, `[]` excluded. */
function paths(
  value: unknown,
  at: (string | number)[] = [],
): (string | number)[][] {
  const out: (string | number)[][] = at.length > 0 ? [at] : [];
  if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      out.push(
        ...paths(child, [...at, Array.isArray(value) ? Number(key) : key]),
      );
  return out;
}

function mutate(rng: Rng, op: object): object {
  const copy = structuredClone(op) as Record<string, unknown>;
  const targets = paths(copy).filter((p) => p[0] !== "type");
  if (targets.length === 0) return copy;
  const path = rng.pick(targets);
  let holder = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1))
    holder = holder[key] as Record<string | number, unknown>;
  holder[path[path.length - 1]!] = rng.pick(HOSTILE);
  return copy;
}

describe("mutated operations", () => {
  const cases = caseCount(200);
  test("apply or throw ScoreValidationError, never anything else", () => {
    forAllSeeds(4_000, cases, (rng, seed) => {
      const a = randomScore(rng);
      const b = rng.chance(0.5) ? randomScore(rng) : nearbyScore(rng, a);
      const ops = diffScores(a, b);
      if (ops.length === 0) return;
      const index = rng.int(0, ops.length - 1);
      const bad = mutate(rng, ops[index]!);
      const mutated = ops.map((op, i) => (i === index ? bad : op));
      try {
        applyScoreOperations(a, mutated as typeof ops);
      } catch (error) {
        if (!(error instanceof ScoreValidationError))
          throw new Error(
            `seed ${seed}: ${String(error)} for ${JSON.stringify(bad).slice(0, 300)}`,
          );
      }
    });
  });
});
