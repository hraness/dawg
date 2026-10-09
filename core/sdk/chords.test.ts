import { describe, expect, test } from "bun:test";
import { parseKey, parseRoman, renderProgression } from "../chords.ts";
import { chord, DawgSdkError, progression, song, strum, track } from "./v1.ts";

describe("sdk chord helpers", () => {
  test("chord() spells a symbol in root position from C4", () => {
    expect(chord("Cm7", 0, 4).map((n) => n.pitch)).toEqual([60, 63, 67, 70]);
    expect(
      chord("G7sus4", 2, 2).every((n) => n.start === 2 && n.length === 2),
    ).toBe(true);
    expect(() => chord("H7")).toThrow(DawgSdkError);
  });

  test("progression() matches the engine dawg's tools use", () => {
    const key = parseKey("C major")!;
    const numerals = ["ii7", "V7", "Imaj7", "vi7"];
    const sdk = progression(numerals.join(" "), {
      key: "C major",
      perform: "arp-updown",
      rate: 0.5,
      part: "both",
    });
    const core = renderProgression({
      key,
      chords: numerals.map((n) => parseRoman(key, n)!),
      perform: { mode: "arp-updown", rate: 0.5 },
      bass: true,
    });
    expect(sdk.map((n) => [n.pitch, n.start, n.length])).toEqual(
      [...core.notes, ...core.bass].map((n) => [n.pitch, n.start, n.length]),
    );
  });

  test("progression() voice-leads and supports bass-only parts", () => {
    const notes = progression(["I", "IV"], { key: "C major" });
    // C E G then F A C: the inversion nearest C major is C F A.
    expect(notes.slice(3).map((n) => n.pitch)).toEqual([60, 65, 69]);
    const bass = progression("i VI III VII", { key: "a minor", part: "bass" });
    expect(bass.map((n) => n.pitch)).toEqual([45, 41, 36, 43]);
    expect(bass.map((n) => n.start)).toEqual([0, 4, 8, 12]);
    expect(() => progression("I", { key: "Q major" })).toThrow(/key/);
    expect(() => progression("I zz")).toThrow(/zz/);
  });

  test("progression() takes a rhythm pattern and an Orchid bass mode", () => {
    const off = progression("I", { perform: "pattern", pattern: "offbeat" });
    expect([...new Set(off.map((n) => n.start))]).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(progression("I", { perform: "pattern", pattern: 3 })).toEqual(off);
    const solo = progression("I IV", { bass: "solo" });
    expect(solo.map((n) => n.pitch)).toEqual([36, 41]);
    const unison = progression(["C/G"], { bass: "unison" });
    expect(unison.some((n) => n.pitch === 36)).toBe(true);
    expect(
      progression(["C/G"], { bass: "chords" }).some((n) => n.pitch === 43),
    ).toBe(true);
    expect(() =>
      progression("I", { perform: "pattern", pattern: "waltz" }),
    ).toThrow(/pattern/);
    expect(() =>
      progression("I", { bass: "loud" as unknown as "solo" }),
    ).toThrow(/bass/);
  });

  test("a song built from progression() evaluates to a valid score", () => {
    const keys = track({
      name: "keys",
      instrument: "piano",
      notes: progression("I V vi IV", { key: "G major", perform: "strum-up" }),
    });
    const s = song({ tempo: 100, bars: 4, tracks: [keys] });
    expect(s.notes.length).toBe(12);
    expect(new Set(s.notes.map((n) => n.id)).size).toBe(12);
  });
});

describe("strum (SDK 1.27.0)", () => {
  test("strums fretted shapes with the stroke grid and speed in ms", () => {
    const notes = strum("E", { strokes: "D", step: 4, speed: 30, tempo: 120 });
    expect(notes.map((n) => n.pitch)).toEqual([40, 47, 52, 56, 59, 64]);
    const spread = notes.at(-1)!.start - notes[0]!.start;
    expect(Math.abs((spread * 60_000) / 120 - 30)).toBeLessThanOrEqual(1);
    expect(strum("G D Em C", { strokes: "folk" })).toEqual(
      strum("G D Em C", { strokes: "folk" }),
    );
  });

  test("capo and bad strokes", () => {
    const capo = strum("E", { strokes: "D", step: 4, guitar: { capo: 2 } });
    const low = Math.min(...capo.map((n) => n.pitch));
    expect(low % 12).toBe(4);
    expect(low).toBeGreaterThanOrEqual(42);
    expect(() => strum("E", { strokes: "DZ" })).toThrow(/strokes/);
    expect(() => strum("E", { guitar: { capo: 20 } })).toThrow(/capo/);
  });
});
