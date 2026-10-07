import { describe, expect, test } from "bun:test";

import {
  bassNote,
  chordName,
  chordPitchClasses,
  diatonicChords,
  generateProgression,
  keyModeChord,
  keyName,
  makeChord,
  manualChord,
  MODE_NAMES,
  movement,
  parseChord,
  parseKey,
  parseRoman,
  perform,
  presetChords,
  PROGRESSION_PRESETS,
  qualityOf,
  romanOf,
  rootPosition,
  rotate,
  suggestNext,
  voiceChord,
  voiceProgression,
  type Key,
} from "./chords.ts";

const C: Key = { tonic: 0, mode: "major" };
const A_MINOR: Key = { tonic: 9, mode: "minor" };

const names = (key: Key, sevenths = false) =>
  diatonicChords(key, sevenths).map((chord) => chordName(chord));

describe("vocabulary", () => {
  test("spells chord types and extensions", () => {
    expect(chordPitchClasses(makeChord(0, "maj"))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(makeChord(0, "min", ["m7"]))).toEqual([
      0, 3, 7, 10,
    ]);
    expect(chordPitchClasses(makeChord(0, "maj", ["M7", "9"]))).toEqual([
      0, 4, 7, 11, 2,
    ]);
    expect(chordPitchClasses(makeChord(11, "dim", ["6"]))).toEqual([
      11, 2, 5, 8,
    ]);
    expect(chordPitchClasses(makeChord(7, "sus4", ["m7"]))).toEqual([
      7, 0, 2, 5,
    ]);
  });

  test("names chords", () => {
    const cases: [ReturnType<typeof makeChord>, string][] = [
      [makeChord(0, "maj"), "C"],
      [makeChord(0, "min", ["m7"]), "Cm7"],
      [makeChord(6, "dim"), "F#dim"],
      [makeChord(10, "maj", ["M7", "9"]), "A#maj9"],
      [makeChord(7, "sus4", ["m7"]), "G7sus4"],
      [makeChord(11, "dim", ["m7"]), "Bm7b5"],
      [makeChord(11, "dim", ["6"]), "Bdim7"],
      [makeChord(0, "maj", ["6", "9"]), "C6/9"],
      [makeChord(0, "maj", ["9"]), "Cadd9"],
      [makeChord(0, "maj", ["m7", "9"]), "C9"],
      [makeChord(0, "min", ["m7", "9"]), "Cm9"],
      [makeChord(0, "aug"), "Caug"],
      [makeChord(0, "maj", [], 4), "C/E"],
    ];
    for (const [chord, name] of cases) expect(chordName(chord)).toBe(name);
    expect(chordName(makeChord(10, "maj", ["M7"]), true)).toBe("Bbmaj7");
  });

  test("parses what it names", () => {
    for (const symbol of [
      "C",
      "Cm7",
      "F#dim",
      "Bbmaj9",
      "G7sus4",
      "Bm7b5",
      "Bdim7",
      "C6/9",
      "Cadd9",
      "C9",
      "Cm9",
      "Caug",
      "C/E",
      "Dsus2",
      "E5",
    ]) {
      const chord = parseChord(symbol);
      expect(chord).toBeDefined();
      expect(parseChord(chordName(chord!, symbol.includes("b")))).toEqual(
        chord!,
      );
    }
    expect(parseChord("H7")).toBeUndefined();
    expect(parseChord("Cxyz")).toBeUndefined();
  });

  test("resolves Orchid buttons and combinations", () => {
    expect(qualityOf([])).toBeUndefined();
    expect(qualityOf(["sus"])).toBe("sus4");
    expect(qualityOf(["maj", "dim"])).toBe("aug");
    expect(qualityOf(["maj", "sus"])).toBe("sus2");
    expect(manualChord(62, ["min"], ["m7"])).toEqual(
      makeChord(2, "min", ["m7"]),
    );
    expect(manualChord(62, [])).toBeUndefined();
  });
});

describe("keys", () => {
  test("parses keys in core/key.ts form and shorthand", () => {
    expect(parseKey("C major")).toEqual(C);
    expect(parseKey("a minor")).toEqual(A_MINOR);
    expect(parseKey("Am")).toEqual(A_MINOR);
    expect(parseKey("F# dorian")).toEqual({ tonic: 6, mode: "dorian" });
    expect(parseKey("Bb mixo")).toEqual({ tonic: 10, mode: "mixolydian" });
    expect(parseKey("H major")).toBeUndefined();
    expect(keyName({ tonic: 10, mode: "major" })).toBe("Bb major");
    expect(keyName({ tonic: 2, mode: "minor" })).toBe("D minor");
    expect(keyName({ tonic: 6, mode: "major" })).toBe("F# major");
  });

  test("diatonic tables per mode", () => {
    expect(names(C)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(names(C, true)).toEqual([
      "Cmaj7",
      "Dm7",
      "Em7",
      "Fmaj7",
      "G7",
      "Am7",
      "Bm7b5",
    ]);
    expect(names(A_MINOR)).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
    expect(names({ tonic: 2, mode: "dorian" })).toEqual([
      "Dm",
      "Em",
      "F",
      "G",
      "Am",
      "Bdim",
      "C",
    ]);
    expect(names({ tonic: 4, mode: "phrygian" })[1]).toBe("F");
    expect(names({ tonic: 5, mode: "lydian" })[1]).toBe("G");
    expect(names({ tonic: 7, mode: "mixolydian" })[6]).toBe("F");
    expect(names({ tonic: 11, mode: "locrian" })[0]).toBe("Bdim");
    expect(names({ tonic: 9, mode: "harmonic-minor" })).toEqual([
      "Am",
      "Bdim",
      "Caug",
      "Dm",
      "E",
      "F",
      "G#dim",
    ]);
    for (const mode of MODE_NAMES)
      expect(diatonicChords({ tonic: 0, mode })).toHaveLength(7);
  });

  test("key mode plays the diatonic chord, borrows, and takes overrides", () => {
    expect(chordName(keyModeChord(C, 62))).toBe("Dm");
    expect(chordName(keyModeChord(C, 71))).toBe("Bdim");
    expect(chordName(keyModeChord(C, 63), true)).toBe("Eb");
    expect(chordName(keyModeChord(C, 70), true)).toBe("Bb");
    expect(chordName(keyModeChord(C, 61))).toBe("C#dim7");
    expect(chordName(keyModeChord(A_MINOR, 68))).toBe("G#dim");
    expect(chordName(keyModeChord(C, 62, { types: ["maj"] }))).toBe("D");
    expect(chordName(keyModeChord(C, 67, { extensions: ["m7"] }))).toBe("G7");
    expect(chordName(keyModeChord(C, 62, { sevenths: true }))).toBe("Dm7");
  });

  test("roman numerals", () => {
    const roman = (key: Key, text: string) =>
      chordName(parseRoman(key, text)!, true);
    expect(roman(C, "ii")).toBe("Dm");
    expect(roman(C, "V7")).toBe("G7");
    expect(roman(C, "ii7")).toBe("Dm7");
    expect(roman(C, "Imaj7")).toBe("Cmaj7");
    expect(roman(C, "vii")).toBe("Bdim");
    expect(roman(C, "viiø")).toBe("Bm7b5");
    expect(roman(C, "iv")).toBe("Fm");
    expect(roman(C, "bVII")).toBe("Bb");
    expect(roman(C, "V/V")).toBe("D");
    expect(roman(A_MINOR, "V")).toBe("E");
    expect(roman(A_MINOR, "VII")).toBe("G");
    expect(roman(A_MINOR, "iiø")).toBe("Bm7b5");
    expect(parseRoman(C, "VIII")).toBeUndefined();
    expect(romanOf(C, makeChord(7, "maj", ["m7"]))).toBe("V7");
    expect(romanOf(C, makeChord(10, "maj"))).toBe("bVII");
    expect(romanOf(C, makeChord(11, "dim"))).toBe("vii°");
  });
});

describe("voicing", () => {
  test("rotation follows the Orchid dial", () => {
    expect(rotate([60, 64, 67], 1)).toEqual([64, 67, 72]);
    expect(rotate([60, 64, 67], 2)).toEqual([67, 72, 76]);
    expect(rotate([60, 64, 67], -1)).toEqual([55, 60, 64]);
    expect(rootPosition(makeChord(7, "maj"), 60)).toEqual([67, 71, 74]);
  });

  test("spread opens the voicing", () => {
    const chord = makeChord(0, "maj", ["M7"]);
    expect(voiceChord(chord, { spread: "open" })).toEqual([55, 60, 64, 71]);
  });

  test("voice leading never moves more than any rotation would", () => {
    const random = (() => {
      let s = 7;
      return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    })();
    for (let trial = 0; trial < 200; trial += 1) {
      const a = makeChord(Math.floor(random() * 12), "maj", ["m7"]);
      const b = makeChord(
        Math.floor(random() * 12),
        random() < 0.5 ? "min" : "maj",
      );
      const previous = voiceChord(a);
      const led = voiceChord(b, { previous });
      const base = rootPosition(b, 60);
      for (let steps = -3; steps <= 3; steps += 1) {
        const other = rotate(base, steps);
        if (other.some((pitch) => pitch < 48 || pitch > 79)) continue;
        expect(movement(previous, led)).toBeLessThanOrEqual(
          movement(previous, other),
        );
      }
    }
  });

  test("ii-V-I voice-leads smoothly", () => {
    const voiced = voiceProgression(
      C,
      generateProgression({ key: C, length: 4, style: "ii-v-i" }),
    );
    expect(voiced.map((chord) => chord.name)).toEqual([
      "Dm7",
      "G7",
      "Cmaj7",
      "Cmaj7",
    ]);
    for (let i = 1; i < voiced.length; i += 1)
      expect(
        movement(voiced[i - 1]!.pitches, voiced[i]!.pitches),
      ).toBeLessThanOrEqual(8);
  });

  test("bass sits in the second octave", () => {
    expect(bassNote(makeChord(7, "maj"))).toBe(43);
    expect(bassNote(makeChord(0, "maj", [], 4))).toBe(40);
  });
});

describe("perform", () => {
  const chord = [60, 64, 67];
  test("block holds every voice", () => {
    expect(perform(chord, 4, 2)).toEqual(
      chord.map((pitch) => ({ pitch, start: 4, length: 2, velocity: 0.8 })),
    );
  });

  test("strums offset voices and hold to the end", () => {
    const up = perform(chord, 0, 1, { mode: "strum-up", strum: 0.125 });
    expect(up.map((n) => [n.pitch, n.start])).toEqual([
      [60, 0],
      [64, 0.125],
      [67, 0.25],
    ]);
    expect(up.every((n) => n.start + n.length === 1)).toBe(true);
    const down = perform(chord, 0, 1, { mode: "strum-down", strum: 0.125 });
    expect(down[0]!.pitch).toBe(67);
  });

  test("arpeggios land on the grid", () => {
    const notes = perform(chord, 2, 2, {
      mode: "arp-updown",
      rate: 0.25,
      octaves: 2,
    });
    expect(notes).toHaveLength(8);
    for (const [index, note] of notes.entries()) {
      expect(note.start).toBe(2 + index * 0.25);
      expect(note.length).toBe(0.25);
    }
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67, 72, 76, 79, 76, 72]);
    expect(
      perform(chord, 0, 1, { mode: "arp-down", rate: 0.25 }).map(
        (n) => n.pitch,
      ),
    ).toEqual([67, 64, 60, 67]);
  });

  test("random arpeggio is seeded", () => {
    const a = perform(chord, 0, 4, { mode: "arp-random", rate: 0.25, seed: 9 });
    const b = perform(chord, 0, 4, { mode: "arp-random", rate: 0.25, seed: 9 });
    const c = perform(chord, 0, 4, {
      mode: "arp-random",
      rate: 0.25,
      seed: 10,
    });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("harp rings across octaves", () => {
    const notes = perform(chord, 0, 2, { mode: "harp", octaves: 2 });
    expect(notes).toHaveLength(6);
    expect(notes.every((n) => n.start + n.length === 2)).toBe(true);
  });
});

describe("progressions", () => {
  test("presets read in the key", () => {
    const byName = (name: string, key: Key) =>
      presetChords(
        key,
        PROGRESSION_PRESETS.find((p) => p.name === name)!,
      ).map((chord) => chordName(chord, true));
    expect(byName("axis", C)).toEqual(["C", "G", "Am", "F"]);
    expect(byName("sad-pop", C)).toEqual(["Am", "F", "C", "G"]);
    expect(byName("aeolian", A_MINOR)).toEqual(["Am", "F", "C", "G"]);
    expect(byName("andalusian", A_MINOR)).toEqual(["Am", "G", "F", "E"]);
    expect(byName("mixolydian-rock", { tonic: 7, mode: "mixolydian" })).toEqual(
      ["G", "F", "C", "G"],
    );
    for (const preset of PROGRESSION_PRESETS)
      expect(presetChords(C, preset)).toHaveLength(preset.numerals.length);
  });

  test("the walk is deterministic by seed and cadences", () => {
    for (const style of ["pop", "jazz", "modal", "classical"]) {
      const a = generateProgression({ key: C, length: 8, style, seed: 3 });
      const b = generateProgression({ key: C, length: 8, style, seed: 3 });
      expect(a).toEqual(b);
      expect(a[0]!.root).toBe(0);
      const last = a.at(-1)!.root;
      expect(style === "modal" ? [5, 11] : [7, 11]).toContain(last);
    }
    const seeds = new Set(
      Array.from({ length: 10 }, (_, seed) =>
        generateProgression({ key: C, length: 8, seed })
          .map((chord) => chordName(chord))
          .join(" "),
      ),
    );
    expect(seeds.size).toBeGreaterThan(3);
  });

  test("suggests the next chord", () => {
    expect(chordName(suggestNext(C, undefined))).toBe("C");
    expect(
      chordName(suggestNext(C, makeChord(2, "min"), { style: "jazz" })),
    ).toBe("G");
    expect(
      chordName(suggestNext(C, makeChord(9, "min"), { preset: "axis" })),
    ).toBe("F");
  });
});
