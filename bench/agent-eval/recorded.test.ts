import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { replayClient, type RecordedRequest } from "./client.ts";
import { runTask } from "./run.ts";
import { TASKS } from "./tasks.ts";

/**
 * Real model transcripts from the live run, replayed offline. The same
 * agent loop, host and grader must reach the verdict the live run recorded,
 * so a grader or tool change that silently flips results fails CI.
 */
type Fixture = Readonly<{
  model: string;
  task: string;
  pass: boolean;
  requests: readonly RecordedRequest[];
}>;

const DIR = join(import.meta.dir, "fixtures");
const fixtures: Fixture[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(DIR, name), "utf8")) as Fixture);

describe("recorded live transcripts", () => {
  test("cover passes and failures in every tier", () => {
    const tiers = new Set(
      fixtures.map((f) => TASKS.find((t) => t.id === f.task)?.tier),
    );
    expect(tiers.size).toBeGreaterThanOrEqual(5);
    expect(fixtures.some((f) => f.pass)).toBe(true);
    expect(fixtures.some((f) => !f.pass)).toBe(true);
  });

  for (const fixture of fixtures) {
    test(`${fixture.model} ${fixture.task} replays to ${fixture.pass ? "pass" : "fail"}`, async () => {
      const task = TASKS.find((t) => t.id === fixture.task);
      expect(task).toBeDefined();
      const client = replayClient(fixture.requests);
      const run = await runTask(task!, {
        client,
        model: fixture.model,
        // The live run typechecked file edits; replay must see the same
        // diagnostics the model saw.
        typecheck: task!.tier === "files" || task!.id.includes("file"),
      });
      expect(run.pass).toBe(fixture.pass);
    }, 30_000);
  }
});
