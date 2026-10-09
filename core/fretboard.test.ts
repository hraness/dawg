import { describe, expect, test } from "bun:test";
import {
  GUITAR_TUNINGS,
  chordPitchClasses,
  guitarFingers,
  guitarTab,
  chordName,
  makeChord,
  parseChord,
  perform,
  strokeGrid,
  strokeVoicing,
  voiceGuitar,
  type Chord,
  type Quality,
  type Extension,
} from "./chords.ts";

const voice = (chord: Chord, setup = {}) =>
  voiceGuitar(
    chordPitchClasses(chord),
    chord.bass ?? chord.root,
    chord.root,
    setup,
  );

describe("guitar voicer", () => {
  test("open and barre classics", () => {
    expect(guitarTab(voice(makeChord(4, "maj"))!.frets)).toBe("0 2 2 1 0 0");
    expect(guitarTab(voice(makeChord(9, "min"))!.frets)).toBe("x 0 2 2 1 0");
    expect(guitarTab(voice(makeChord(5, "maj"))!.frets)).toBe("1 3 3 2 1 1");
    expect(guitarTab(voice(makeChord(6, "min"))!.frets)).toBe("2 4 4 2 2 2");
  });

  test("no barre lies over an open string", () => {
    expect(guitarFingers([1, 3, 3, 2, 1, 1])).toBe(4);
    // Index on fret 1 of strings 1 and 6 with an open string between: no barre.
    expect(guitarFingers([1, 0, 3, 2, 1, 1])).toBe(5);
  });

  test("96 shapes over 4 frets: every one playable", () => {
    const shapes: [Quality, Extension[]][] = [
      ["maj", []],
      ["min", []],
      ["maj", ["m7"]],
      ["maj", ["M7"]],
      ["min", ["m7"]],
      ["sus4", []],
      ["dim", []],
      ["maj", ["m7", "9"]],
    ];
    let bad = 0;
    for (let root = 0; root < 12; root += 1)
      for (const [quality, ext] of shapes) {
        const chord = makeChord(root, quality, ext);
        const v = voice(chord);
        if (!v) {
          bad += 1;
          continue;
        }
        const fretted = v.frets.filter((f) => f > 0);
        const span = fretted.length
          ? Math.max(...fretted) - Math.min(...fretted)
          : 0;
        if (span > 3 || guitarFingers(v.frets) > 4) bad += 1;
        // The bass is the lowest sounding note, the 3rd and 7th are kept.
        if (Math.min(...v.pitches) % 12 !== root) bad += 1;
        const pcs = new Set(v.pitches.map((p) => p % 12));
        if (!pcs.has(chordPitchClasses(chord)[1]!)) bad += 1;
      }
    expect(bad).toBe(0);
  });

  test("ring 0 gives closed shapes; capo and tuning move the pitches", () => {
    const e9 = makeChord(4, "maj", ["m7", "9"]);
    expect(voice(e9, { ring: 0 })!.frets.includes(0)).toBe(false);
    const g = voice(makeChord(7, "maj"), { capo: 2 })!;
    expect(Math.min(...g.pitches) % 12).toBe(7);
    const d = voice(makeChord(2, "maj"), { tune: "dropd" })!;
    expect(Math.min(...d.pitches)).toBe(GUITAR_TUNINGS.dropd[0]);
  });
});

describe("strokes", () => {
  const e = voice(makeChord(4, "maj"))!;

  test("a down stroke spreads over the speed at 120 BPM (±1 ms)", () => {
    for (const ms of [10, 22, 40]) {
      const notes = strokeVoicing(e, 0, 1, {
        strokes: "D",
        speed: ms / 1000,
        tempo: 120,
        step: 1,
      });
      const spreadSec = ((notes.at(-1)!.start - notes[0]!.start) * 60) / 120;
      expect(Math.abs(spreadSec * 1000 - ms)).toBeLessThanOrEqual(1);
      expect(notes[0]!.pitch).toBe(40);
    }
  });

  test("up strokes go high to low; chucks are short; rests ring", () => {
    const notes = strokeVoicing(e, 0, 1, { strokes: "-U", step: 0.5 });
    expect(notes[0]!.start).toBeCloseTo(0.5, 6);
    expect(notes[0]!.pitch).toBe(64);
    const chuck = strokeVoicing(e, 0, 1, { strokes: "x", step: 1 });
    expect(chuck.every((n) => n.length < 0.1)).toBe(true);
    const held = strokeVoicing(e, 0, 2, { strokes: "D-", step: 1 });
    expect(held.every((n) => n.length > 1.9)).toBe(true);
  });

  test("a restrike cuts the ringing string", () => {
    const notes = strokeVoicing(e, 0, 2, { strokes: "D", step: 1 });
    const low = notes.filter((n) => n.pitch === 40);
    expect(low).toHaveLength(2);
    expect(low[0]!.length).toBeCloseTo(1, 6);
  });

  test("grids parse by name or literal; bad ones are refused", () => {
    expect(strokeGrid("folk")).toBe("D-DU-UDU");
    expect(strokeGrid("D U x .")).toBe("DUx.");
    expect(strokeGrid("DZ")).toBeUndefined();
  });

  test("perform guitar is deterministic and fretboard-voiced", () => {
    const a = perform([52, 55, 59, 64], 0, 4, {
      mode: "guitar",
      strokes: "folk",
    });
    const b = perform([52, 55, 59, 64], 0, 4, {
      mode: "guitar",
      strokes: "folk",
    });
    expect(a).toEqual(b);
    expect(Math.min(...a.map((n) => n.pitch))).toBe(40);
  });
});

describe("typed upper tensions (0.6.1)", () => {
  const rel = (chord: Chord, pitches: readonly number[]) =>
    [...new Set(pitches.map((p) => (((p - chord.root) % 12) + 12) % 12))].sort(
      (a, b) => a - b,
    );

  test("11th, 13th and altered symbols parse and name back", () => {
    for (const symbol of [
      "C11",
      "Cm11",
      "Dm11",
      "Cadd11",
      "G13",
      "A7b9",
      "Fmaj7#11",
      "E7#11",
    ]) {
      const chord = parseChord(symbol);
      expect(chord).toBeDefined();
      expect(chordName(chord!)).toBe(symbol);
    }
    expect(chordPitchClasses(parseChord("C11")!)).toEqual([0, 4, 7, 10, 2, 5]);
    expect(chordPitchClasses(parseChord("A7b9")!)).toContain(10);
  });

  test("C11 drops the 5th first, then the 11th, never the 3rd or 7th", () => {
    const c11 = parseChord("C11")!;
    // Six strings fit all six tones.
    expect(rel(c11, voice(c11)!.pitches)).toEqual([0, 2, 4, 5, 7, 10]);
    // Four ukulele strings: the 5th and then the 11th go.
    const uke = voice(c11, { tune: "ukulele" })!;
    expect(rel(c11, uke.pitches)).toEqual([0, 2, 4, 10]);
  });

  test("a repeated voicing comes from the cache, identical", () => {
    const chord = parseChord("Cm11")!;
    const a = voice(chord, { hand: 6 });
    const t0 = performance.now();
    const b = voice(chord, { hand: 6 });
    expect(performance.now() - t0).toBeLessThan(1);
    expect(b).toBe(a);
  });
});
