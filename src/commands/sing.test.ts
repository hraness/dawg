import { describe, expect, test } from "bun:test";
import { addNote, addTrack, createScore } from "../../core/score.ts";
import { renderScorePcm } from "../audio/wav.ts";
import { nearestCommand } from "./help.ts";
import {
  applySingCommand,
  THROAT_DEMO_STEPS,
  assignVowels,
  describeSing,
  parseSingCommand,
} from "./sing.ts";

function score() {
  let s = addTrack(createScore(), {
    id: "lead",
    name: "Lead",
    instrument: "triangle",
  });
  for (const [index, pitch] of [57, 60, 64, 67, 69].entries())
    s = addNote(s, {
      id: `n${index}`,
      trackId: "lead",
      pitch,
      startTick: index * 96,
      durationTicks: 96,
      velocity: 0.8,
    });
  return s;
}

describe("/sing", () => {
  test("parses presets, params, drone names and harmonics", () => {
    expect(parseSingCommand("sing")).toEqual({ type: "sing-show" });
    expect(parseSingCommand("/sing choir")).toEqual({
      type: "sing-set",
      preset: "choir",
      values: {},
    });
    expect(parseSingCommand("sing vowel a>o voices 6")).toEqual({
      type: "sing-set",
      values: { vowel: "a>o", voices: 6 },
    });
    expect(parseSingCommand("sing khoomei drone D3")).toEqual({
      type: "sing-set",
      preset: "khoomei",
      values: { drone: 50 },
    });
    // `drone` alone is the preset; `drone <note>` is the parameter.
    expect(parseSingCommand("sing drone")).toEqual({
      type: "sing-set",
      preset: "drone",
      values: {},
    });
    expect(parseSingCommand("sing drone a2")).toEqual({
      type: "sing-set",
      values: { drone: 45 },
    });
    expect(parseSingCommand("sing harmonics 6-12")).toEqual({
      type: "sing-set",
      values: { harmonics: [6, 12] },
    });
    expect(parseSingCommand("sing harmonics 6 12")).toEqual({
      type: "sing-set",
      values: { harmonics: [6, 12] },
    });
    expect(
      parseSingCommand("sing khoomei drone D3 harmonics 6 12"),
    ).toMatchObject({
      type: "sing-set",
      preset: "khoomei",
      values: { harmonics: [6, 12] },
    });
    expect(parseSingCommand("sing vib off")).toEqual({
      type: "sing-set",
      values: { vib: null },
    });
    expect(parseSingCommand("sing wind")).toBeDefined();
    expect(parseSingCommand("singer")).toBeUndefined();
  });

  test("rejects out-of-range values with the range", () => {
    expect(parseSingCommand("sing voices 99")).toEqual({
      type: "sing-usage",
      message: "voices is 1..8",
    });
    expect(parseSingCommand("sing drone Z9")).toMatchObject({
      type: "sing-usage",
    });
    const typo = parseSingCommand("sing vowell o");
    expect(typo?.type).toBe("sing-usage");
    expect(JSON.stringify(typo)).toContain("did you mean vowel");
    expect(parseSingCommand("sing choi")).toEqual({
      type: "sing-usage",
      message: "sing · did you mean choir?",
    });
  });

  test("applies: the track becomes a sing track, one revision", () => {
    const result = applySingCommand(
      score(),
      "lead",
      parseSingCommand("sing khoomei drone D3")!,
    );
    expect(result.ok).toBe(true);
    const track = result.next!.tracks.find((t) => t.id === "lead")!;
    expect(track.instrument).toBe("sing");
    expect(track.sing).toEqual({ preset: "khoomei", drone: 50 });
    expect(result.message).toContain("drone D3");
    expect(describeSing(track.sing)).toBe("preset khoomei · drone D3");
    // A preset switch keeps the overrides; reset keeps the preset.
    const next = applySingCommand(
      result.next!,
      "lead",
      parseSingCommand("sing sygyt")!,
    );
    expect(next.next!.tracks[0]!.sing).toEqual({ preset: "sygyt", drone: 50 });
    const reset = applySingCommand(
      next.next!,
      "lead",
      parseSingCommand("sing reset")!,
    );
    expect(reset.next!.tracks[0]!.sing).toEqual({ preset: "sygyt" });
    const off = applySingCommand(
      reset.next!,
      "lead",
      parseSingCommand("sing off")!,
    );
    expect(off.next!.tracks[0]!.sing).toBeUndefined();
    expect(off.next!.tracks[0]!.instrument).toBe("sine");
  });

  test("sing vowels cycles over the notes in time order", () => {
    const { next, count } = assignVowels(score(), "lead", ["a", "o>u"]);
    expect(count).toBe(5);
    expect(next.notes.map((note) => note.vowel)).toEqual([
      "a",
      "o>u",
      "a",
      "o>u",
      "a",
    ]);
    const result = applySingCommand(
      score(),
      "lead",
      parseSingCommand("sing vowels e i")!,
    );
    expect(result.ok).toBe(true);
    expect(result.next!.notes[1]!.vowel).toBe("i");
    expect(parseSingCommand("sing vowels x")?.type).toBe("sing-usage");
  });

  test("note vowel sets and clears a target's vowel", () => {
    const command = parseSingCommand("note vowel A>U n1 n2");
    expect(command).toEqual({
      type: "note-vowel",
      vowel: "a>u",
      target: { type: "ids", ids: ["n1", "n2"] },
    });
    const result = applySingCommand(score(), "lead", command!);
    expect(result.next!.notes.map((note) => note.vowel)).toEqual([
      undefined,
      "a>u",
      "a>u",
      undefined,
      undefined,
    ]);
    const cleared = applySingCommand(
      result.next!,
      "lead",
      parseSingCommand("/note vowel off")!,
    );
    expect(cleared.next!.notes.every((note) => note.vowel === undefined)).toBe(
      true,
    );
  });

  test("/help knows sing for typo suggestions", () => {
    expect(nearestCommand("sng")).toBe("sing");
  });

  test("a throat preset on an empty track writes a demo line that sounds", () => {
    const empty = addTrack(createScore({ bars: 4 }), {
      id: "t",
      name: "T",
      instrument: "sine",
    });
    const result = applySingCommand(
      empty,
      "t",
      parseSingCommand("sing khoomei")!,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("8 demo notes");
    const notes = result.next!.notes.filter((n) => n.trackId === "t");
    expect(notes.map((n) => n.pitch)).toEqual(
      THROAT_DEMO_STEPS.map((step) => 50 + step),
    );
    // A track with notes keeps them; a non-throat preset writes nothing.
    const again = applySingCommand(
      result.next!,
      "t",
      parseSingCommand("sing sygyt")!,
    );
    expect(again.next!.notes.length).toBe(8);
    const aah = applySingCommand(empty, "t", parseSingCommand("sing aah")!);
    expect(aah.next!.notes.length).toBe(0);
    const pcm = renderScorePcm(result.next!, { sampleRate: 22_050 }).pcm;
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
  });
});
