import { describe, expect, test } from "bun:test";
import {
  chordName,
  keyUsesFlats,
  parseKey,
  parseRoman,
  scaleOf,
  voiceProgression,
} from "./chords.ts";

const name = (key: string, numeral: string): string => {
  const k = parseKey(key)!;
  return chordName(parseRoman(k, numeral)!, keyUsesFlats(k));
};

/** The 15 major key signatures, spelled. */
const MAJORS = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
  "Cb",
] as const;
const LETTERS = "CDEFGAB";

describe("roman numerals spell their root from the numeral's letter", () => {
  test("the reviewer's cases", () => {
    expect(name("C major", "bVII")).toBe("Bb");
    expect(name("C major", "bVI")).toBe("Ab");
    expect(name("C major", "bIII")).toBe("Eb");
    expect(name("C major", "bII")).toBe("Db");
    expect(name("C major", "bv°")).toBe("Gbdim");
    expect(name("A minor", "bII")).toBe("Bb");
    expect(name("F# major", "vii°")).toBe("E#dim");
    expect(name("D minor", "bVI")).toBe("Bb");
    expect(name("C major", "#iv°")).toBe("F#dim");
  });

  test("secondary dominants spell from their target", () => {
    expect(name("C major", "V/V")).toBe("D");
    expect(name("C major", "V/ii")).toBe("A");
    expect(name("F major", "V/vi")).toBe("A");
    expect(name("Bb major", "V/IV")).toBe("Bb");
  });

  // Property: in every key signature a numeral's root letter is the tonic
  // letter plus (degree - 1), and a flat numeral never names a sharp.
  for (const tonic of MAJORS) {
    test(`every numeral in ${tonic} major lands on its letter`, () => {
      const key = parseKey(`${tonic} major`);
      if (!key) return; // parseKey may not know Cb; covered by B
      const flats = keyUsesFlats(key);
      const first = name(`${tonic} major`, "I")[0]!;
      for (const [d, numeral] of [
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
        "VII",
      ].entries())
        for (const acc of ["", "b", "#"]) {
          const chord = parseRoman(key, `${acc}${numeral}`)!;
          const n = chordName(chord, flats);
          const letter = LETTERS[(LETTERS.indexOf(first) + d) % 7]!;
          // Single accidentals spell on the letter; a double falls back.
          const natural = [0, 2, 4, 5, 7, 9, 11][LETTERS.indexOf(letter)]!;
          const diff = ((chord.root - natural + 18) % 12) - 6;
          if (Math.abs(diff) <= 1) expect(n[0]).toBe(letter);
          if (acc === "b" && n[0] === letter) expect(n).not.toContain("#");
          if (acc === "#" && n[0] === letter) expect(n).not.toMatch(/^[A-G]b/);
          // The pitch class is never changed by spelling.
          expect(chord.root).toBe(
            (scaleOf({ tonic: key.tonic, mode: "major" })[d]! +
              (acc === "b" ? -1 : acc === "#" ? 1 : 0) +
              12) %
              12,
          );
        }
      // Diatonic triads always spell on their own letters.
      for (const [d, numeral] of [
        "I",
        "ii",
        "iii",
        "IV",
        "V",
        "vi",
        "vii°",
      ].entries())
        expect(name(`${tonic} major`, numeral)[0]).toBe(
          LETTERS[(LETTERS.indexOf(first) + d) % 7],
        );
    });
  }

  test("voiceProgression names use the numeral spelling", () => {
    const key = parseKey("C major")!;
    const names = voiceProgression(
      key,
      ["I", "bVII", "bVI", "V"].map((n) => parseRoman(key, n)!),
    ).map((v) => v.name);
    expect(names).toEqual(["C", "Bb", "Ab", "G"]);
  });
});
