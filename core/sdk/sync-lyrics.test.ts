import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { LYRICS_PATH, SDK_PATH, syncedSdk } from "./sync-lyrics.ts";

describe("sdk lyric copy", () => {
  test("v1.ts carries the current core/lyrics.ts (run bun core/sdk/sync-lyrics.ts)", async () => {
    const [sdk, lyrics] = await Promise.all([
      readFile(SDK_PATH, "utf8"),
      readFile(LYRICS_PATH, "utf8"),
    ]);
    expect(await syncedSdk(sdk, lyrics)).toBe(sdk);
  });
});
