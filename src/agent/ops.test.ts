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

  test("parses composition controls", () => {
    expect(parsePrompt("tempo 132")).toEqual({
      type: "set-tempo",
      tempoBpm: 132,
    });
    expect(parsePrompt("instrument piano")).toEqual({
      type: "track",
      patch: { instrument: "piano" },
    });
    expect(parsePrompt("volume 0.6")).toEqual({
      type: "track",
      patch: { volume: 0.6 },
    });
    expect(parsePrompt("clear")).toEqual({ type: "clear-track" });
    expect(parsePrompt("remove note lead-1")).toEqual({
      type: "remove-note",
      noteId: "lead-1",
    });
  });
});
