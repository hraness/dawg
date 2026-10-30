import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowStore } from "./store.ts";
import { WorkflowConflictError, WORKFLOW_LIMITS } from "./state.ts";
import { jobFixture } from "./state.test.ts";

const directories: string[] = [];
async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dawg-workflow-store-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("durable workflow store", () => {
  test("serializes conditional concurrent writes and reloads the winner", async () => {
    const root = await temporary();
    const one = new WorkflowStore(root);
    const two = new WorkflowStore(root);
    const initial = await one.create(jobFixture());
    const results = await Promise.allSettled([
      one.update(initial.id, 0, (job) => ({ ...job, brief: "one" })),
      two.update(initial.id, 0, (job) => ({ ...job, brief: "two" })),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(WorkflowConflictError);
    const saved = await two.load(initial.id);
    expect(saved?.revision).toBe(1);
    expect(["one", "two"]).toContain(saved!.brief);
    expect(await one.list()).toEqual([saved!]);
    await expect(one.create(jobFixture())).rejects.toThrow("already exists");
  });

  test("preserves corrupt and oversized records instead of resetting them", async () => {
    const root = await temporary();
    const store = new WorkflowStore(root);
    await store.create(jobFixture());
    const path = join(root, ".dawg/workflows/jobs/example.json");
    await writeFile(path, "{broken");
    await expect(store.create(jobFixture())).rejects.toThrow("invalid JSON");
    expect(await readFile(path, "utf8")).toBe("{broken");
    await writeFile(path, " ".repeat(WORKFLOW_LIMITS.recordBytes + 1));
    await expect(store.load("example")).rejects.toThrow("byte limit");
    await expect(store.load("../other")).rejects.toThrow("safe identifier");
  });

  test("rejects state directories redirected outside the project", async () => {
    const root = await temporary();
    const elsewhere = await temporary();
    await symlink(elsewhere, join(root, ".dawg"));
    await expect(new WorkflowStore(root).create(jobFixture())).rejects.toThrow(
      "escapes",
    );
    expect(
      await Bun.file(join(elsewhere, "workflows/jobs/example.json")).exists(),
    ).toBe(false);
  });
});
