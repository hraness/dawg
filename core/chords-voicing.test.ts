import { describe, expect, test } from "bun:test";
import { SPREADS, parseChord, voiceChord } from "./chords.ts";

const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SUFFIXES = [
  "",
  "m",
  "7",
  "m7",
  "maj7",
  "9",
  "m9",
  "maj9",
  "11",
  "m11",
  "maj11",
  "13",
  "m13",
  "maj13",
  "7#11",
  "maj7#11",
  "7b13",
  "6",
  "m6",
  "sus4",
  "7sus4",
];

/** Lower pitch class at a minor 9th (13 semitones) under another voice. */
function minorNinths(pitches: readonly number[]): number[] {
  const lows: number[] = [];
  for (const a of pitches)
    for (const b of pitches) if (b - a === 13) lows.push(((a % 12) + 12) % 12);
  return lows;
}

describe("default voicings avoid the minor-9th clash", () => {
  test("C11 drops the 3rd (the reviewer's case)", () => {
    expect(voiceChord(parseChord("C11")!)).toEqual([60, 67, 70, 74, 77]);
    expect(voiceChord(parseChord("C13")!)).toEqual([60, 64, 67, 70, 74, 81]);
  });

  // Property over every root, suffix, inversion and spread: no voice sits
  // a minor 9th above the root or the major 3rd (b9 chords are excluded
  // from the suffix list on purpose).
  test("no voicing puts a minor 9th above the root or 3rd", () => {
    let checked = 0;
    for (const root of ROOTS)
      for (const suffix of SUFFIXES) {
        const chord = parseChord(`${root}${suffix}`);
        expect(chord).toBeDefined();
        const third = (chord!.root + 4) % 12;
        for (let inversion = -4; inversion <= 4; inversion += 1)
          for (const spread of SPREADS) {
            const lows = minorNinths(voiceChord(chord!, { inversion, spread }));
            expect(lows).not.toContain(chord!.root);
            if (chord!.quality === "maj") expect(lows).not.toContain(third);
            checked += 1;
          }
      }
    expect(checked).toBe(ROOTS.length * SUFFIXES.length * 9 * SPREADS.length);
  });
});
