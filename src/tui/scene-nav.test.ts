import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { loopSection, parseForm, withForm } from "../../core/sections.ts";
import { nextScene, sceneBarAt } from "./scene-nav.ts";

const sections = [
  { name: "Outro", startBar: 6, bars: 2 },
  { name: "Intro", startBar: 0, bars: 2 },
  { name: "Verse", startBar: 2, bars: 4 },
];
const song = () => createScore({ bars: 8 }).withSections(sections, []);

describe("scene navigation", () => {
  test("uses score order and wraps in both directions", () => {
    const score = song();
    expect(nextScene(score, 0, 1)?.name).toBe("Verse");
    expect(nextScene(score, 0, -1)?.name).toBe("Outro");
    expect(nextScene(score, 24, 1)?.name).toBe("Intro");
  });

  test("the second and later loop passes navigate from the visible scene", () => {
    const score = song();
    for (const beat of [9, 41, 73, 105]) {
      expect(nextScene(score, beat, 1)?.name).toBe("Outro");
      expect(nextScene(score, beat, -1)?.name).toBe("Intro");
      expect(sceneBarAt(score, beat)).toBeCloseTo(2.25);
    }
  });

  test("before the first marker, next selects first and previous selects last", () => {
    const score = createScore({ bars: 8 }).withSections(
      sections.filter((s) => s.startBar > 0),
      [],
    );
    expect(nextScene(score, 0, 1)?.name).toBe("Verse");
    expect(nextScene(score, 0, -1)?.name).toBe("Outro");
    expect(nextScene(createScore(), 0, 1)).toBeUndefined();
  });

  test("variable meter uses actual bar boundaries", () => {
    const score = createScore({
      bars: 8,
      time: { meter: [{ bar: 2, beatsPerBar: 3, beatUnit: 4 }] },
    });
    // First two 4/4 bars, then four 3/4 bars put Outro at beat 20.
    expect(sceneBarAt(score, 20)).toBe(6);
    // Scores with meter changes intentionally cannot contain sections.
    expect(nextScene(score, 20, 1)).toBeUndefined();
    expect(sceneBarAt(score, 27.5)).toBeCloseTo(0.375);
    expect(nextScene(score, 27.5, 1)).toBeUndefined();
  });

  test("a section loop identifies its own scene on every pass", () => {
    const score = loopSection(song(), "Verse");
    expect(nextScene(score, 0, 1)?.name).toBe("Outro");
    expect(nextScene(score, 300, -1)?.name).toBe("Intro");
  });

  test("an arranged form maps transport time into the current score scene", () => {
    const original = song();
    const score = withForm(original, parseForm(original, "Outro Intro Verse"));
    expect(nextScene(score, 0, 1)?.name).toBe("Intro");
    expect(nextScene(score, 8, 1)?.name).toBe("Verse");
  });
});
