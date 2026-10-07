import { describe, expect, test } from "bun:test";
import { isPitch, midiToPitch, pitchToMidi } from "./pitch.ts";

describe("pitch names", () => {
  test("parses scientific pitch notation case-insensitively", () => {
    expect(pitchToMidi("C4")).toBe(60);
    expect(pitchToMidi("a4")).toBe(69);
    expect(pitchToMidi("F#2")).toBe(42);
    expect(pitchToMidi("Bb3")).toBe(58);
    expect(pitchToMidi("C-1")).toBe(0);
    expect(pitchToMidi("G9")).toBe(127);
  });

  test("rejects malformed and out-of-range names with NaN", () => {
    for (const bad of ["H2", "C", "C#", "4", "", "C10", "G#9", "c4 x"])
      expect(Number.isNaN(pitchToMidi(bad))).toBe(true);
  });

  test("prints sharps and round-trips every MIDI number", () => {
    expect(midiToPitch(60)).toBe("C4");
    expect(midiToPitch(61)).toBe("C#4");
    expect(midiToPitch(0)).toBe("C-1");
    for (let midi = 0; midi <= 127; midi += 1)
      expect(pitchToMidi(midiToPitch(midi))).toBe(midi);
    expect(() => midiToPitch(128)).toThrow(RangeError);
    expect(() => midiToPitch(1.5)).toThrow(RangeError);
  });

  test("isPitch accepts names and MIDI integers only", () => {
    expect(isPitch("E2")).toBe(true);
    expect(isPitch(64)).toBe(true);
    expect(isPitch(64.5)).toBe(false);
    expect(isPitch("nope")).toBe(false);
    expect(isPitch(null)).toBe(false);
  });
});
