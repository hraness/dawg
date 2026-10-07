import { describe, expect, test } from "bun:test";
import { envValue } from "./env.ts";

describe("envValue", () => {
  test("reads DAWG_* first", () => {
    expect(envValue("AUDIO", { DAWG_AUDIO: "0", TRACK_AUDIO: "1" })).toBe("0");
  });

  test("falls back to the legacy TRACK_* name when DAWG_* is unset", () => {
    expect(envValue("PROVIDER", { TRACK_PROVIDER: "xcb" })).toBe("xcb");
    expect(envValue("PROVIDER", {})).toBeUndefined();
  });

  test("an empty DAWG_* value is set and wins over the legacy name", () => {
    expect(envValue("THEME", { DAWG_THEME: "", TRACK_THEME: "mono" })).toBe("");
  });
});
