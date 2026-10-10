/**
 * The per-pane range clipboard on disk (op1-ux §6.3): it lives in `.dawg`
 * next to the session, one file per session and pane letter, so it survives
 * a restart of that pane and is never in the score file.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RangeClipboard } from "../commands/range.ts";
import { stateDir } from "./store.ts";

const SAFE = /^[A-Za-z0-9-]{1,64}$/;

/** `.dawg/clipboard/<session>-<pane>.json`; `solo` without a pane letter. */
export function clipboardPath(
  workspace: string,
  sessionId: string,
  pane: string | undefined,
): string | undefined {
  const who = pane ?? "solo";
  if (!SAFE.test(sessionId) || !SAFE.test(who)) return undefined;
  return join(stateDir(workspace), "clipboard", `${sessionId}-${who}.json`);
}

function isBarRange(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  return (
    Number.isInteger(range.startBar) &&
    Number.isInteger(range.bars) &&
    (range.startBar as number) >= 0 &&
    (range.bars as number) >= 1
  );
}

/** A clipboard read back from disk, or undefined when absent or malformed. */
export function parseClipboard(text: string): RangeClipboard | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const clip = value.clip as Record<string, unknown> | undefined;
    if (
      typeof value.source !== "string" ||
      !isBarRange(value.range) ||
      !clip ||
      typeof clip.all !== "boolean" ||
      !Number.isInteger(clip.bars) ||
      !Array.isArray(clip.tracks) ||
      !Array.isArray(clip.barTicks)
    )
      return undefined;
    return value as unknown as RangeClipboard;
  } catch {
    return undefined;
  }
}

export async function loadClipboard(
  path: string | undefined,
): Promise<RangeClipboard | undefined> {
  if (!path) return undefined;
  try {
    return parseClipboard(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Writes (or, for undefined, removes) the pane's clipboard. */
export async function saveClipboard(
  path: string | undefined,
  board: RangeClipboard | undefined,
): Promise<void> {
  if (!path) return;
  if (!board) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(board)}\n`);
}
