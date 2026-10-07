import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type LockOwner = { pid: number; token: string };

/** Never expire an active writer's lock merely because a write takes time. */
export async function acquireSessionLock(
  path: string,
  timeoutMs = 3_000,
): Promise<() => Promise<void>> {
  const owner: LockOwner = { pid: process.pid, token: randomUUID() };
  const started = Date.now();
  while (true) {
    try {
      await mkdir(path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      await reclaimDeadOwner(path);
      if (Date.now() - started >= timeoutMs)
        throw new Error("timed out waiting for the dawg session lock");
      await new Promise((resolve) => setTimeout(resolve, 8));
      continue;
    }
    try {
      await writeFile(join(path, "owner"), JSON.stringify(owner), {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      await rm(path, { recursive: true, force: true });
      throw error;
    }
    return async () => {
      const current = await readOwner(path);
      if (current?.pid === owner.pid && current.token === owner.token)
        await rm(path, { recursive: true, force: true });
    };
  }
}

async function reclaimDeadOwner(path: string): Promise<void> {
  // Serialize reclaimers separately. Otherwise two readers of a dead PID can
  // remove a new writer's lock after the first reclaimer removes the old one.
  const reclaimPath = `${path}.reclaim`;
  try {
    await mkdir(reclaimPath);
  } catch (error) {
    if (hasCode(error, "EEXIST")) return;
    throw error;
  }
  try {
    const owner = await readOwner(path);
    if (!owner) return; // A writer may still be publishing its owner record.
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (hasCode(error, "ESRCH"))
        await rm(path, { recursive: true, force: true });
    }
  } finally {
    await rm(reclaimPath, { recursive: true, force: true });
  }
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const text = await readFile(join(path, "owner"), "utf8");
    if (text.length > 256) return undefined;
    const value: unknown = JSON.parse(text);
    // Read locks left by earlier versions (Track 0.1), which stored only a PID.
    if (Number.isSafeInteger(value) && (value as number) > 0)
      return { pid: value as number, token: "legacy" };
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      Number.isSafeInteger(value.pid) &&
      (value.pid as number) > 0 &&
      "token" in value &&
      typeof value.token === "string"
    )
      return { pid: value.pid as number, token: value.token };
  } catch {
    // Missing, unreadable, or incomplete owner records cannot prove death.
  }
  return undefined;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
