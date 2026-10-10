import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorPath, ephemeralActor, isActorId, loadActor } from "./actor.ts";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-actor-"));
  try {
    await run(join(dir, "config"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the actor file is created once and stays stable", async () => {
  await withDir(async (dir) => {
    const first = await loadActor({ dir, env: { USER: "ada" } });
    expect(isActorId(first.id)).toBe(true);
    expect(first.name).toBe("ada");
    const again = await loadActor({ dir, env: { USER: "someone-else" } });
    expect(again).toEqual(first);
    const disk = JSON.parse(await readFile(actorPath(dir), "utf8"));
    expect(disk).toEqual({ id: first.id, name: "ada" });
  });
});

test("concurrent first runs agree on one actor", async () => {
  await withDir(async (dir) => {
    const actors = await Promise.all(
      Array.from({ length: 8 }, () => loadActor({ dir, env: { USER: "x" } })),
    );
    expect(new Set(actors.map((actor) => actor.id)).size).toBe(1);
  });
});

test("a corrupt actor file is replaced", async () => {
  await withDir(async (dir) => {
    await loadActor({ dir, env: {} });
    await writeFile(actorPath(dir), "{nope");
    const fresh = await loadActor({ dir, env: { USER: "b" } });
    expect(isActorId(fresh.id)).toBe(true);
    expect(await loadActor({ dir, env: {} })).toEqual(fresh);
  });
});

test("an unwritable config dir yields an ephemeral actor", async () => {
  const actor = await loadActor({ dir: "/dev/null/nope", env: { USER: "c" } });
  expect(isActorId(actor.id)).toBe(true);
  expect(isActorId(ephemeralActor().id)).toBe(true);
});
