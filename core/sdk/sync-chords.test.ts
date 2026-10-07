import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CHORDS_PATH, SDK_PATH, syncedSdk } from "./sync-chords.ts";

describe("sdk chord engine copy", () => {
  test("v1.ts carries the current core/chords.ts (run bun core/sdk/sync-chords.ts)", async () => {
    const [sdk, chords] = await Promise.all([
      readFile(SDK_PATH, "utf8"),
      readFile(CHORDS_PATH, "utf8"),
    ]);
    expect(await syncedSdk(sdk, chords)).toBe(sdk);
  });

  test("v1.ts stays import-free so it can be vendored alone", async () => {
    const sdk = await readFile(SDK_PATH, "utf8");
    expect(sdk).not.toMatch(/^import /m);
  });
});
