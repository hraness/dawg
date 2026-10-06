import { describe, expect, test } from "bun:test";
import { parsePrompt } from "./ops.ts";

describe("parsePrompt", () => {
  test("parses note requests", () => {
    expect(parsePrompt("add C#4 at 2 for 0.5")).toEqual({
      type: "add-note",
      pitch: 61,
      start: 2,
      duration: 0.5,
      velocity: 0.8,
    });
  });

  test("parses transport requests", () => {
    expect(parsePrompt("play")).toEqual({ type: "transport", action: "play" });
    expect(parsePrompt("stop")).toEqual({ type: "transport", action: "pause" });
  });
});
