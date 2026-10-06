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
    expect(parsePrompt("add C4 at 0 for 1 with extra text")).toBeUndefined();
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
    expect(parsePrompt("move note lead-1 to 2.5")).toEqual({
      type: "update-note",
      noteId: "lead-1",
      patch: { start: 2.5 },
    });
    expect(parsePrompt("duration note lead-1 0.25")).toEqual({
      type: "update-note",
      noteId: "lead-1",
      patch: { duration: 0.25 },
    });
    expect(parsePrompt("automate volume at 2 0.4")).toEqual({
      type: "automation",
      parameter: "volume",
      points: [{ beat: 2, value: 0.4 }],
    });
    expect(parsePrompt("clear automation")).toEqual({
      type: "automation",
      parameter: "volume",
      points: [],
    });
    expect(parsePrompt("automate pan at 0 -1")).toEqual({
      type: "automation",
      parameter: "pan",
      points: [{ beat: 0, value: -1 }],
    });
    expect(parsePrompt("clear pan automation")).toEqual({
      type: "automation",
      parameter: "pan",
      points: [],
    });
    expect(parsePrompt("automate volume at 1 -0.2")).toBeUndefined();
  });

  test("parses track creation and bounded loop sizing requests", () => {
    expect(parsePrompt("track bass")).toEqual({
      type: "add-track",
      trackId: "bass",
    });
    expect(parsePrompt("add track pads")).toEqual({
      type: "add-track",
      trackId: "pads",
    });
    expect(parsePrompt("bars 8")).toEqual({ type: "set-bars", bars: 8 });
    expect(parsePrompt("extend 4 bars")).toEqual({
      type: "extend-bars",
      bars: 4,
    });
    expect(parsePrompt("bars 0")).toBeUndefined();
    expect(parsePrompt("extend 257 bars")).toBeUndefined();
  });
});
