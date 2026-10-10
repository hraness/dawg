/**
 * The per-pane clipboard file (op1-ux §6.3): a safe path per session and
 * pane, a round trip through disk, and malformed files read as empty.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RangeClipboard } from "../commands/range.ts";
import {
  clipboardPath,
  loadClipboard,
  parseClipboard,
  saveClipboard,
} from "./clipboard.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const board = {
  source: "bass",
  range: { startBar: 4, bars: 2 },
  clip: { all: false, bars: 2, tracks: [], barTicks: [1920, 1920] },
} as unknown as RangeClipboard;

describe("pane clipboard", () => {
  test("one file per session and pane; unsafe ids get none", () => {
    expect(clipboardPath("/w", "s1", "C")).toMatch(/clipboard\/s1-C\.json$/);
    expect(clipboardPath("/w", "s1", undefined)).toMatch(/s1-solo\.json$/);
    expect(clipboardPath("/w", "../x", "C")).toBeUndefined();
    expect(clipboardPath("/w", "s1", "a/b")).toBeUndefined();
  });

  test("round trip, removal and malformed files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-clip-"));
    dirs.push(dir);
    const path = clipboardPath(dir, "s1", "B")!;
    await saveClipboard(path, board);
    expect(await loadClipboard(path)).toEqual(board);
    expect(JSON.parse(await readFile(path, "utf8")).source).toBe("bass");
    await saveClipboard(path, undefined);
    expect(await loadClipboard(path)).toBeUndefined();
    await writeFile(path, "{not json");
    expect(await loadClipboard(path)).toBeUndefined();
    expect(
      parseClipboard('{"source":"bass","range":{"startBar":-1,"bars":1}}'),
    ).toBeUndefined();
    expect(await loadClipboard(undefined)).toBeUndefined();
  });
});
