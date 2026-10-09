import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "../../core/diff.ts";
import { addNote, createScore, type TrackScore } from "../../core/score.ts";
import { PREVIEWABLE_TOOLS } from "./preview-tool.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

const song = (instrument = "sine") => {
  let score = createScore({ tracks: [{ id: "a", name: "a", instrument }] });
  for (const [index, pitch] of [57, 60, 64].entries())
    score = addNote(score, {
      id: `n${index}`,
      trackId: "a",
      pitch,
      startTick: index * 480,
      durationTicks: 480,
      velocity: 0.8,
    });
  return score;
};

const tool = (name: string) =>
  AGENT_TOOLS.find((entry) => entry.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "a",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function apply(
  score: TrackScore,
  name: string,
  args: Record<string, unknown>,
): TrackScore {
  const plan = tool(name).plan(args, context(score));
  if (plan.kind !== "score") throw new Error("expected a score plan");
  return applyScoreOperations(score, plan.operations);
}

describe("sing agent tools", () => {
  test("set_sing with no args makes an aah voice; preset and params stack", () => {
    const plain = apply(song(), "set_sing", {});
    expect(plain.tracks[0]!.instrument).toBe("sing");
    expect(plain.tracks[0]!.sing).toEqual({ preset: "aah" });
    const choir = apply(plain, "set_sing", {
      preset: "choir",
      params: { voices: 4, vowel: "o" },
    });
    expect(choir.tracks[0]!.sing).toMatchObject({
      preset: "choir",
      voices: 4,
      vowel: "o",
    });
    const back = apply(choir, "set_sing", { params: { voices: null } });
    expect(back.tracks[0]!.sing!.voices).toBeUndefined();
    const off = apply(back, "set_sing", { off: true });
    expect(off.tracks[0]!.sing).toBeUndefined();
  });

  test("set_sing takes a drone as a note name for throat presets", () => {
    const throat = apply(song(), "set_sing", {
      preset: "khoomei",
      params: { drone: "D3" },
    });
    expect(throat.tracks[0]!.sing).toMatchObject({
      preset: "khoomei",
      drone: 50,
    });
  });

  test("set_sing refuses unknown presets and params", () => {
    expect(() =>
      tool("set_sing").plan({ preset: "opera" }, context(song())),
    ).toThrow(ToolArgumentError);
    expect(() =>
      tool("set_sing").plan({ params: { loudness: 1 } }, context(song())),
    ).toThrow(/no parameter loudness/);
  });

  test("set_vowels cycles vowels over notes in time order and clears", () => {
    const sung = apply(song(), "set_vowels", { vowels: ["a", "oo"] });
    expect(sung.notes.map((note) => note.vowel)).toEqual(["a", "u", "a"]);
    const one = apply(sung, "set_vowels", {
      vowels: ["a>o"],
      noteIds: ["n1"],
    });
    expect(one.notes.find((note) => note.id === "n1")!.vowel).toBe("a>o");
    const cleared = apply(one, "set_vowels", { vowels: null });
    expect(cleared.notes.every((note) => note.vowel === undefined)).toBe(true);
    expect(() =>
      tool("set_vowels").plan({ vowels: ["x"] }, context(song())),
    ).toThrow(ToolArgumentError);
  });

  test("both tools are preview candidates", () => {
    expect(PREVIEWABLE_TOOLS).toContain("set_sing");
    expect(PREVIEWABLE_TOOLS).toContain("set_vowels");
  });
});
