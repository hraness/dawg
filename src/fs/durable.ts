/**
 * Crash-safe file replacement: write a uniquely named temp file, fsync it,
 * rename it over the target and fsync the parent directory so the rename
 * itself survives a power loss. A reader never sees a partial file.
 */

import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

let counter = 0;

export async function durableWrite(
  path: string,
  contents: string,
  options: Readonly<{ mode?: number; mkdir?: boolean }> = {},
): Promise<void> {
  const dir = dirname(path);
  if (options.mkdir !== false) await mkdir(dir, { recursive: true });
  const temporary = `${path}.${process.pid}.${++counter}.tmp`;
  const handle = await open(temporary, "w", options.mode ?? 0o644);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dir);
}

/** Best effort: some platforms refuse fsync on a directory handle. */
export async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(dir, "r");
    await handle.sync();
  } catch {
    // EISDIR/EPERM/EINVAL on platforms without directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
