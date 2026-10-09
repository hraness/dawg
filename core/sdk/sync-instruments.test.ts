import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { INSTRUMENTS_PATH, SDK_PATH, syncedSdk } from "./sync-instruments.ts";

describe("sdk instrument word copy", () => {
  test("v1.ts carries the current core/instruments.ts (run bun core/sdk/sync-instruments.ts)", async () => {
    const [sdk, instruments] = await Promise.all([
      readFile(SDK_PATH, "utf8"),
      readFile(INSTRUMENTS_PATH, "utf8"),
    ]);
    expect(await syncedSdk(sdk, instruments)).toBe(sdk);
  });
});
