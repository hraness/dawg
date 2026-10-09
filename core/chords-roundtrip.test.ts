/**
 * Chord symbols and roman numerals are lossless: every chord a symbol can
 * name prints and reads back as itself, in every key.
 */
import { describe, expect, test } from "bun:test";
import {
  chordIntervals,
  chordName,
  MODE_NAMES,
  parseChord,
  parseRoman,
  romanOf,
  type Chord,
} from "./chords.ts";

const SUFFIXES = [
  "",
  "m",
  "dim",
  "aug",
  "+",
  "sus",
  "sus4",
  "sus2",
  "5",
  "6",
  "m6",
  "69",
  "6/9",
  "m69",
  "7",
  "dom7",
  "maj7",
  "M7",
  "Δ7",
  "m7",
  "-7",
  "m(maj7)",
  "mM7",
  "m7b5",
  "ø",
  "dim7",
  "aug7",
  "+7",
  "9",
  "maj9",
  "m9",
  "add9",
  "madd9",
  "7sus4",
  "9sus4",
  "7sus2",
  "maj7sus4",
  "m(add4)",
  "m(b6)",
  "(b6)",
  "7#9",
  "11",
  "m11",
  "maj11",
  "add11",
  "13",
  "m13",
  "maj13",
  "7b9",
  "7#11",
  "maj7#11",
  "7b13",
  "13b9",
  // 0.7 spellings and stacked alterations
  "7#5",
  "7+5",
  "maj7+5",
  "maj7#5",
  "9#11",
  "13#11",
  "7alt",
  "7b9b13",
  "9b5",
  "7b5",
  "-maj7",
  "mmaj7",
  "add2",
  "2",
  "6add9",
  "7b9#9",
  "7(b9,#9)",
  "m7b9",
  "9#5",
  "(b5)",
  "m9b5",
];

const strip = (chord: Chord): string =>
  // `letter` is spelling, not identity: bVII in C is Bb either way.
  JSON.stringify({ ...chord, bass: undefined, letter: undefined });

function chords(): Chord[] {
  const out: Chord[] = [];
  for (const root of [
    "C",
    "C#",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "F#",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ])
    for (const suffix of SUFFIXES) {
      const chord = parseChord(`${root}${suffix}`);
      if (!chord) throw new Error(`does not parse: ${root}${suffix}`);
      out.push(chord);
    }
  return out;
}

describe("chord symbols", () => {
  test("standard altered and extended symbols parse to their notes", () => {
    const steps = (symbol: string) => chordIntervals(parseChord(symbol)!);
    expect(steps("C7#5")).toEqual([0, 4, 8, 10]);
    expect(steps("C7+5")).toEqual([0, 4, 8, 10]);
    expect(steps("Cmaj7+5")).toEqual([0, 4, 8, 11]);
    expect(steps("C9#11")).toEqual([0, 4, 7, 10, 14, 18]);
    expect(steps("C13#11")).toEqual([0, 4, 7, 10, 14, 18, 21]);
    expect(steps("C7alt")).toEqual([0, 4, 7, 10, 13, 15, 18, 20]);
    expect(steps("C7b9b13")).toEqual([0, 4, 7, 10, 13, 20]);
    expect(steps("C9b5")).toEqual([0, 4, 6, 10, 14]);
    expect(steps("C7b5")).toEqual([0, 4, 6, 10]);
    expect(steps("C-maj7")).toEqual([0, 3, 7, 11]);
    expect(steps("Cmmaj7")).toEqual([0, 3, 7, 11]);
    expect(steps("Cadd2")).toEqual([0, 4, 7, 14]);
    expect(steps("C2")).toEqual([0, 4, 7, 14]);
    expect(steps("C6add9")).toEqual([0, 4, 7, 9, 14]);
    expect(steps("Cm9b5")).toEqual([0, 3, 6, 10, 14]);
  });

  test("nonsense suffixes still fail", () => {
    for (const bad of [
      "Cx",
      "C7#5#",
      "Csus4#5",
      "C5b5",
      "C7q",
      "C(b9",
      "Cm7alt",
    ])
      expect(parseChord(bad)).toBeUndefined();
  });

  test("every chord prints as a symbol that reads back as itself", () => {
    for (const chord of chords())
      for (const flats of [false, true])
        expect(
          strip(parseChord(chordName({ ...chord, bass: undefined }, flats))!),
        ).toBe(strip(chord));
  });
});

describe("roman numerals", () => {
  test("every chord in every key reads back from its numeral", () => {
    const failures: string[] = [];
    const all = chords();
    for (const mode of MODE_NAMES)
      for (let tonic = 0; tonic < 12; tonic += 1) {
        const key = { tonic, mode };
        for (const chord of all) {
          const bare = { ...chord, bass: undefined };
          const numeral = romanOf(key, bare);
          const back = parseRoman(key, numeral);
          if (!back || strip(back) !== strip(bare))
            failures.push(`${mode} ${tonic} ${chordName(bare)} -> ${numeral}`);
        }
      }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  test("the plain numerals stay plain", () => {
    const c = { tonic: 0, mode: "major" as const };
    expect(romanOf(c, parseChord("Dm")!)).toBe("ii");
    expect(romanOf(c, parseChord("G7")!)).toBe("V7");
    expect(romanOf(c, parseChord("Bm7b5")!)).toBe("viiø7");
    expect(romanOf(c, parseChord("Bb")!)).toBe("bVII");
    expect(romanOf(c, parseChord("Fmaj7")!)).toBe("IVmaj7");
    const phrygian = { tonic: 0, mode: "phrygian" as const };
    expect(romanOf(phrygian, parseChord("D")!)).toBe("♮II");
    expect(strip(parseRoman(phrygian, "♮II")!)).toBe(strip(parseChord("D")!));
    expect(strip(parseRoman(phrygian, "II")!)).toBe(strip(parseChord("Db")!));
    expect(chordName(parseRoman(phrygian, "II")!)).toBe("Db");
    expect(romanOf(c, parseChord("C7")!)).toBe("Idom7");
    expect(romanOf(c, parseChord("C5")!)).toBe("I[5]");
    expect(romanOf(c, parseChord("C7#9")!)).toBe("I[7#9]");
    expect(romanOf(c, parseChord("C6/9")!)).toBe("I[6/9]");
    expect(strip(parseRoman(c, "I[6/9]")!)).toBe(strip(parseChord("C6/9")!));
    expect(chordName(parseRoman(c, "bVII[7]")!)).toBe("Bb7");
  });
});
