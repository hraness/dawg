import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  ChordPad,
  applyChordsCommand,
  chordCapable,
  chordPhrase,
  defaultChordSettings,
} from "./play-chords.ts";

function pad(key = "C major", mode: "auto" | "manual" = "auto") {
  return new ChordPad({ ...defaultChordSettings(), mode }, () => key);
}

describe("ChordPad", () => {
  test("auto plays the key's chord; latches recolour it", () => {
    const p = pad();
    expect(p.voice(p.chordFor(50)!, 50).name).toBe("Dm");
    p.press("3"); // maj
    expect(p.voice(p.chordFor(50)!, 50).name).toBe("D");
    p.press("3");
    p.press("6"); // m7 extension on the key's quality
    expect(p.voice(p.chordFor(50)!, 50).name).toBe("Dm7");
    expect(p.press("0")).toEqual({
      type: "status",
      status: "chord latches clear",
    });
    expect(p.latchText()).toBe("");
  });

  test("manual is single notes until a type or extension is latched", () => {
    const p = pad("C major", "manual");
    expect(p.chordFor(48)).toBeUndefined();
    p.press("2");
    expect(p.voice(p.chordFor(48)!, 48).name).toBe("Cm");
  });

  test("q toggles auto and manual; off frees every chord key", () => {
    const p = pad();
    expect(p.press("q")).toEqual({ type: "status", status: "chords manual" });
    expect(p.settings.explicit).toBe(true);
    p.settings.mode = "off";
    for (const key of ["1", "5", "9", "0", "-", "=", "b", "q"])
      expect(p.press(key)).toEqual({ type: "pass" });
    expect(p.chordFor(48)).toBeUndefined();
  });

  test("voicing dial, perform cycle and bass", () => {
    const p = pad();
    p.press("=");
    expect(p.settings.inversion).toBe(1);
    p.press("9");
    expect(p.settings.perform).toBe("strum-up");
    p.press("b");
    const played = p.voice(p.chordFor(48)!, 48);
    expect(played.bass).toBe(24);
    expect(p.headerText(true)).toContain("strum-up");
    expect(p.headerText(true)).toContain("bass chords");
  });

  test("b cycles the Orchid bass modes and each routes as documented", () => {
    const p = pad("C major", "manual");
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = p.press("b");
      if (result.type === "status") seen.push(result.status);
    }
    expect(seen).toEqual([
      "bass chords",
      "bass unison",
      "bass single",
      "bass solo",
      "bass off",
    ]);
    const route = (mode: typeof p.settings.bass) => {
      p.settings.bass = mode;
      p.types.clear();
      const single = p.single(52);
      p.press("3"); // maj latch: E major chord
      const chord = p.voice(p.chordFor(52)!, 52);
      return {
        single: single && { pitches: single.pitches, bass: single.bass },
        chord: { treble: chord.pitches.length > 0, bass: chord.bass },
      };
    };
    // E4 = 52 pressed in octave C4 (48): bass octave C2 (24), E2 = 28.
    expect(route("off")).toEqual({
      single: undefined,
      chord: { treble: true, bass: undefined },
    });
    expect(route("chords")).toEqual({
      single: undefined,
      chord: { treble: true, bass: 28 },
    });
    expect(route("unison")).toEqual({
      single: { pitches: [52], bass: 28 },
      chord: { treble: true, bass: 28 },
    });
    expect(route("single")).toEqual({
      single: { pitches: [], bass: 28 },
      chord: { treble: true, bass: 28 },
    });
    expect(route("solo")).toEqual({
      single: { pitches: [], bass: 28 },
      chord: { treble: false, bass: 28 },
    });
  });

  test("9 reaches pattern mode and the header names the pattern", () => {
    const p = pad();
    for (let i = 0; i < 9; i += 1) p.press("9");
    expect(p.settings.perform).toBe("pattern");
    expect(p.headerText(true)).toContain("pattern 1 eighths");
    p.press("9");
    expect(p.settings.perform).toBe("block");
  });

  test("the header names the key, the chord and the suggestion", () => {
    const p = pad("A minor");
    p.voice(p.chordFor(57)!, 57);
    expect(p.headerText(true)).toMatch(/^AUTO A minor · Am \(i\) · next \S+/);
    expect(pad("nonsense").headerText(false)).toStartWith(
      "AUTO C major (assumed)",
    );
  });
});

describe("chord settings", () => {
  test("/chords parses every setting and rejects bad values", () => {
    const s = defaultChordSettings();
    expect(applyChordsCommand(s, "auto").ok).toBe(true);
    expect(s).toMatchObject({ mode: "auto", explicit: true });
    expect(applyChordsCommand(s, "voicing -2").ok).toBe(true);
    expect(applyChordsCommand(s, "spread wide").ok).toBe(true);
    expect(applyChordsCommand(s, "bass on").ok).toBe(true);
    expect(applyChordsCommand(s, "perform arp-updown").ok).toBe(true);
    expect(applyChordsCommand(s, "rate 1/8").ok).toBe(true);
    expect(applyChordsCommand(s, "octaves 2").ok).toBe(true);
    expect(applyChordsCommand(s, "preset axis").ok).toBe(true);
    expect(s).toMatchObject({
      inversion: -2,
      spread: "wide",
      bass: "chords",
      perform: "arp-updown",
      rate: "1/8",
      octaves: 2,
      preset: "axis",
    });
    expect(applyChordsCommand(s, "voicing 99").ok).toBe(false);
    expect(applyChordsCommand(s, "perform waltz").ok).toBe(false);
    expect(applyChordsCommand(s, "bass unison").ok).toBe(true);
    expect(s.bass).toBe("unison");
    expect(applyChordsCommand(s, "bass loud").ok).toBe(false);
    expect(applyChordsCommand(s, "pattern 3")).toEqual({
      ok: true,
      message: "chords pattern 3 offbeat",
    });
    expect(s).toMatchObject({ perform: "pattern", pattern: "offbeat" });
    expect(applyChordsCommand(s, "pattern tresillo").ok).toBe(true);
    expect(s.pattern).toBe("tresillo");
    expect(applyChordsCommand(s, "pattern 14").ok).toBe(false);
    expect(applyChordsCommand(s, "pattern waltz").ok).toBe(false);
    expect(applyChordsCommand(s, "").message).toContain("chords auto");
  });

  test("chord-capable tracks: pitched yes, bass and kits no", () => {
    const track = (instrument: string, name = instrument) =>
      ({ id: name, name, instrument }) as never;
    expect(chordCapable(track("piano"))).toBe(true);
    expect(chordCapable(track("bass"))).toBe(false);
    expect(chordCapable(track("drums", "kit"))).toBe(false);
  });
});

describe("chordPhrase", () => {
  const score = createScore({
    bars: 2,
    key: "A minor",
    tracks: [{ id: "keys", instrument: "saw" }],
  } as never);
  const track = score.tracks[0]!;

  test("is deterministic and follows the voicing, perform mode and key", () => {
    const settings = defaultChordSettings();
    const a = chordPhrase(settings, score, track, 2);
    expect(chordPhrase(settings, score, track, 2)).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((note) => note.trackId === "keys")).toBe(true);
    // Every note ends inside the two bars.
    const end = 2 * score.beatsPerBar * score.ticksPerBeat;
    for (const note of a)
      expect(note.startTick! + note.durationTicks!).toBeLessThanOrEqual(end);
    const up = chordPhrase({ ...settings, inversion: 2 }, score, track, 2);
    expect(up.map((n) => n.pitch)).not.toEqual(a.map((n) => n.pitch));
    const arp = chordPhrase(
      { ...settings, perform: "arp-up" },
      score,
      track,
      2,
    );
    expect(arp.length).toBeGreaterThan(a.length);
    const other = chordPhrase(settings, score.withKey("D major"), track, 2);
    expect(other.map((n) => n.pitch)).not.toEqual(a.map((n) => n.pitch));
  });

  test("chords off plays one root per chord", () => {
    const off = chordPhrase(
      { ...defaultChordSettings(), mode: "off" },
      score,
      track,
      2,
    );
    const starts = new Set(off.map((note) => note.startTick));
    expect(off.length).toBe(starts.size);
  });
});
