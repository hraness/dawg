/**
 * Lyrics meet the singing voice (0.7 clips x sing): a `_` lyric holds the
 * vowel of the syllable before it instead of falling back to the track's.
 */
import { describe, expect, test } from "bun:test";
import type { PerformedNote } from "../../../core/expression.ts";
import { heldVowels, noteVowel } from "./engine.ts";

const note = (
  id: string,
  startTick: number,
  lyric?: string,
  vowel?: string,
): PerformedNote =>
  ({
    id,
    pitch: 60,
    startTick,
    durationTicks: 96,
    velocity: 0.8,
    ...(lyric !== undefined ? { lyric } : {}),
    ...(vowel !== undefined ? { vowel } : {}),
  }) as PerformedNote;

describe("melisma vowels", () => {
  test("a held syllable keeps the previous note's vowel", () => {
    const you = note("n1", 0, "you");
    const hold = note("n2", 96, "_");
    const hold2 = note("n3", 192, "_");
    const la = note("n4", 288, "la");
    // Out of order on purpose: time order decides.
    const held = heldVowels([la, hold2, hold, you], "e");
    expect(noteVowel(you, "e")).toBe("u");
    expect(held.get(hold)).toBe("u");
    expect(held.get(hold2)).toBe("u");
    expect(held.has(la)).toBe(false);
    expect(held.has(you)).toBe(false);
  });

  test("a hold before any syllable sings the track vowel; own vowel wins", () => {
    const first = note("n1", 0, "_");
    const own = note("n2", 96, "_", "o");
    const held = heldVowels([first, own], "e");
    expect(held.get(first)).toBe("e");
    expect(held.has(own)).toBe(false);
  });

  test("no holds, no map: other projects render as before", () => {
    expect(heldVowels([note("n1", 0, "la")], "a").size).toBe(0);
  });
});
