import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  applyFormantCommand,
  parseFormantCommand,
  parseVowelCommand,
} from "./formant.ts";
import { applyFxCommand, parseFxCommand, unknownFxMessage } from "./fx.ts";
import { parseVocalCommand, runVocalCommand } from "./vocal.ts";

const base = () =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "v", name: "v", instrument: "saw" }],
  });

function run(text: string, score = base()) {
  const parsed = parseFormantCommand(text) ?? parseVowelCommand(text);
  expect(parsed).toBeDefined();
  return applyFormantCommand(score, "v", parsed!);
}

describe("/formant", () => {
  test("a number shifts, a second number is the mix", () => {
    const one = run("/formant -4");
    expect(one.ok).toBe(true);
    expect(one.next!.tracks[0]!.fx!.formant).toEqual({ shift: -4, mix: 1 });
    const two = run("/formant +3 0.5");
    expect(two.next!.tracks[0]!.fx!.formant).toEqual({ shift: 3, mix: 0.5 });
    expect(run("/formant 2.5st").next!.tracks[0]!.fx!.formant!.shift).toBe(2.5);
  });

  test("presets, off, show and range errors", () => {
    expect(run("/formant giant").next!.tracks[0]!.fx!.formant!.shift).toBe(-8);
    const on = run("/formant -4").next!;
    expect(run("/formant off", on).next!.tracks[0]!.fx).toBeUndefined();
    expect(run("/formant", on).message).toBe("formant · shift -4 st · mix 1");
    expect(run("/formant").message).toContain("off");
    expect(run("/formant 20").ok).toBe(false);
    expect(
      run("/formant shift -2 mix 0.3").next!.tracks[0]!.fx!.formant,
    ).toEqual({ shift: -2, mix: 0.3 });
  });

  test("a vowel word hints at the vowel filter", () => {
    const result = run("/formant o");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("the vowel filter is `vowel`");
  });

  test("on is the toggle, not the nasal vowel", () => {
    const on = run("/formant on");
    expect(on.ok).toBe(true);
    expect(on.next!.tracks[0]!.fx!.formant).toEqual({ shift: 0, mix: 1 });
    expect(run("/formant on").message).not.toContain("/vowel");
  });

  test("a positional shift takes a keyword mix", () => {
    expect(run("/formant -4 mix 0.5").next!.tracks[0]!.fx!.formant).toEqual({
      shift: -4,
      mix: 0.5,
    });
    expect(run("/formant -4 mix").ok).toBe(false);
  });

  test("fx formant with bad values names the ranges and presets", () => {
    for (const text of [
      "fx formant 30",
      "fx formant mix 2",
      "fx formant giantt",
      "fx formant shift -12.5",
    ]) {
      expect(parseFxCommand(text)).toBeUndefined();
      expect(unknownFxMessage(text)).toContain("shift -12..12 st, mix 0..1");
      expect(unknownFxMessage(text)).toContain("deep giant bright tiny");
    }
    expect(unknownFxMessage("fx formant -4")).toBeUndefined();
  });

  test("/vocal formant is the same command", async () => {
    const parsed = parseVocalCommand("/vocal formant -3");
    expect(parsed).toBeDefined();
    const result = await runVocalCommand(parsed!, {
      score: base(),
      trackId: "v",
      cwd: "/tmp",
    });
    expect(result.ok).toBe(true);
    expect(result.next!.tracks[0]!.fx!.formant).toEqual({ shift: -3, mix: 1 });
  });
});

describe("/vowel", () => {
  test("one vowel stores 0.6 data (no morph fields)", () => {
    expect(run("/vowel o").next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "o",
      mix: 1,
    });
  });

  test("two vowels morph halfway; a third word sets the morph", () => {
    expect(run("/vowel a o").next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "a",
      mix: 1,
      to: "o",
      morph: 0.5,
    });
    const set = run("/vowel a i 0.25").next!;
    expect(set.tracks[0]!.fx!.vowel!.morph).toBe(0.25);
    expect(run("/vowel morph 0.8", set).next!.tracks[0]!.fx!.vowel!.morph).toBe(
      0.8,
    );
    // Back to a plain vowel drops the morph.
    expect(run("/vowel e", set).next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "e",
      mix: 1,
    });
  });

  test("changing the vowel keeps the mix; to off drops only the morph", () => {
    const half = run("/vowel mix 0.5", run("/vowel a i 0.25").next!).next!;
    expect(run("/vowel e", half).next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "e",
      mix: 0.5,
    });
    expect(run("/vowel o u", half).next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "o",
      mix: 0.5,
      to: "u",
      morph: 0.5,
    });
    expect(run("/vowel to off", half).next!.tracks[0]!.fx!.vowel).toEqual({
      vowel: "a",
      mix: 0.5,
    });
  });

  test("vowel presets work as one word", () => {
    expect(run("/vowel ee").next!.tracks[0]!.fx!.vowel!.vowel).toBe("i");
  });

  test("fx vowel morph without a target is refused like /vowel morph", () => {
    const result = applyFxCommand(
      base(),
      "v",
      parseFxCommand("fx vowel morph 0.5")!,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("set a target first");
    const withTo = run("/vowel a o").next!;
    expect(
      applyFxCommand(withTo, "v", parseFxCommand("fx vowel morph 0.2")!).next!
        .tracks[0]!.fx!.vowel!.morph,
    ).toBe(0.2);
  });

  test("morph without a target is refused; to alone starts halfway", () => {
    expect(run("/vowel morph 0.5").ok).toBe(false);
    expect(run("/vowel to u").next!.tracks[0]!.fx!.vowel).toMatchObject({
      to: "u",
      morph: 0.5,
    });
    expect(
      run("/vowel off", run("/vowel a").next!).next!.tracks[0]!.fx,
    ).toBeUndefined();
  });
});
