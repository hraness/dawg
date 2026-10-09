import { describe, expect, test } from "bun:test";
import { replayClient, scripted } from "./client.ts";
import { runTask } from "./run.ts";
import { TASKS } from "./tasks.ts";

describe("agent eval tasks", () => {
  test("has at least 60 tasks with unique ids", () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(TASKS.length);
  });

  for (const task of TASKS) {
    test(`${task.id}: the reference solution passes`, async () => {
      const run = await runTask(task, {
        client: replayClient(scripted(task.reference, "Done.")),
        model: "replay",
        typecheck: false,
      });
      const failed = run.checks.filter((c) => !c.ok);
      expect(failed).toEqual([]);
      expect(run.pass).toBe(true);
    }, 30_000);

    test(`${task.id}: doing nothing fails`, async () => {
      const run = await runTask(task, {
        client: replayClient(scripted([], "Done.")),
        model: "replay",
        typecheck: false,
      });
      expect(run.pass).toBe(false);
    }, 30_000);
  }
});
