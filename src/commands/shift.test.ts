import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { applyShiftCommand, parseShiftCommand } from "./shift.ts";

const score = createScore({
  tempoBpm: 120,
  bars: 1,
  tracks: [
    {
      id: "vox",
      name: "vox",
      instrument: "sampler",
      sampler: {
        mode: "keyed",
        voices: { vox: { src: "tracks/vox/samples/vox.wav" } },
      },
    },
  ],
  notes: [],
});

describe("shift and fade commands", () => {
  test("parse", () => {
    expect(parseShiftCommand("shift 7 formant keep")).toEqual({
      kind: "shift",
      semitones: 7,
      formant: 0,
    });
    expect(parseShiftCommand("/shift -12 vox")).toEqual({
      kind: "shift",
      semitones: -12,
      voice: "vox",
    });
    expect(parseShiftCommand("shift 5 formant follow")).toMatchObject({
      formant: null,
    });
    expect(parseShiftCommand("fade out 0.5")).toEqual({
      kind: "fade",
      edge: "out",
      seconds: 0.5,
    });
    expect(parseShiftCommand("fade off")).toEqual({
      kind: "fade",
      edge: "both",
      seconds: null,
    });
    expect(parseShiftCommand("shift")).toBeUndefined();
    expect(parseShiftCommand("shifty 3")).toBeUndefined();
  });

  test("apply sets and clears the voice's fields", () => {
    const up = applyShiftCommand(score, "vox", {
      kind: "shift",
      semitones: 7,
      formant: 0,
    });
    if (!up.ok) throw new Error(up.message);
    const ref = up.next.tracks[0]!.sampler!.voices.vox!;
    expect(ref.shift).toBe(7);
    expect(ref.formant).toBe(0);
    const cleared = applyShiftCommand(up.next, "vox", {
      kind: "shift",
      semitones: 0,
    });
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.next.tracks[0]!.sampler!.voices.vox).toEqual({
      src: "tracks/vox/samples/vox.wav",
    });
    const faded = applyShiftCommand(score, "vox", {
      kind: "fade",
      edge: "in",
      seconds: 0.05,
    });
    if (!faded.ok) throw new Error(faded.message);
    expect(faded.next.tracks[0]!.sampler!.voices.vox!.fadeInTime).toBe(0.05);
    const bad = applyShiftCommand(score, "vox", {
      kind: "shift",
      semitones: 30,
    });
    expect(bad.ok).toBe(false);
  });
});

describe("shift 0", () => {
  const apply = (from: typeof score, text: string) => {
    const result = applyShiftCommand(from, "vox", parseShiftCommand(text)!);
    if (!result.ok) throw new Error(result.message);
    return result.next;
  };
  const ref = (s: typeof score) => s.tracks[0]!.sampler!.voices.vox!;

  test("keeps a formant move; shift off clears both", () => {
    const moved = apply(score, "shift 0 formant 3");
    expect(ref(moved).shift).toBeUndefined();
    expect(ref(moved).formant).toBe(3);
    const stepped = apply(apply(score, "shift 5 formant 2"), "shift 0");
    expect(ref(stepped).shift).toBeUndefined();
    expect(ref(stepped).formant).toBe(2);
    const off = apply(stepped, "shift off");
    expect(off.toJSON()).toEqual(score.toJSON());
  });
});
