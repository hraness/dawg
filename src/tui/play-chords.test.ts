import { describe, expect, test } from "bun:test";
import {
  ChordPad,
  applyChordsCommand,
  chordCapable,
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
  });

  test("the header names the key, the chord and the suggestion", () => {
    const p = pad("A minor");
    p.voice(p.chordFor(57)!, 57);
    expect(p.headerText(true)).toMatch(/^AUTO A minor · Am \(i\) · → \S+/);
    expect(pad("nonsense").headerText(false)).toStartWith("AUTO C major?");
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
      bass: true,
      perform: "arp-updown",
      rate: "1/8",
      octaves: 2,
      preset: "axis",
    });
    expect(applyChordsCommand(s, "voicing 99").ok).toBe(false);
    expect(applyChordsCommand(s, "perform waltz").ok).toBe(false);
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
