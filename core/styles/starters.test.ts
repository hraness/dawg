import { describe, expect, test } from "bun:test";
import { encodeLoop } from "../loop.ts";
import { renderScorePcm } from "../../src/audio/wav.ts";
import { excerptScore } from "./excerpt.ts";
import { generateStyle, styleScore } from "./generate.ts";
import { resolveStyle } from "./index.ts";
import { GROOVE_GROUPS, GROOVE_STARTERS } from "./starters.ts";
import { validateGenerated } from "./validate.ts";

describe("curated groove shelf", () => {
  test("sixteen compact choices, four distinct roles for each group", () => {
    expect(GROOVE_STARTERS).toHaveLength(16);
    for (const group of GROOVE_GROUPS)
      expect(
        GROOVE_STARTERS.filter((entry) => entry.group === group.id),
      ).toHaveLength(4);
    const patterns = new Set<string>();
    for (const entry of GROOVE_STARTERS) {
      expect(entry.title.length).toBeLessThanOrEqual(16);
      const style = resolveStyle(entry.id);
      patterns.add(JSON.stringify(style.rhythm.onsets));
      expect(style.texture.roles.lead).toBeUndefined();
      expect(style.texture.roles.counter).toBeUndefined();
      expect(style.texture.roles.arp).toBeUndefined();
    }
    expect(patterns.size).toBe(GROOVE_STARTERS.length);
  });

  test("reusable loops keep their parts throughout and pass musical checks", () => {
    const instruments = new Set<string>();
    const failures: string[] = [];
    for (const entry of GROOVE_STARTERS) {
      for (const seed of [1, 2, 7]) {
        const generated = generateStyle(entry.id, { seed, bars: 4 });
        const score = styleScore(generated);
        expect(generated.plan.sections).toHaveLength(1);
        expect(score.tracks.length).toBeLessThanOrEqual(3);
        expect(score.notes.length).toBeGreaterThan(0);
        for (const track of score.tracks) {
          instruments.add(track.instrument!);
          expect(score.notes.some((note) => note.trackId === track.id)).toBe(
            true,
          );
        }
        for (const check of validateGenerated(generated).checks)
          if (!check.ok)
            failures.push(`${entry.id}#${seed} ${check.name}: ${check.detail}`);
      }
    }
    expect(failures).toEqual([]);
    expect(instruments.size).toBeGreaterThanOrEqual(7);
  });

  test("seeded starters reproduce exactly and their excerpts are audible without clipping", () => {
    for (const entry of GROOVE_STARTERS) {
      const generated = generateStyle(entry.id, { seed: 7, bars: 4 });
      const again = generateStyle(entry.id, { seed: 7, bars: 4 });
      expect(encodeLoop(styleScore(generated))).toBe(
        encodeLoop(styleScore(again)),
      );
      const { pcm } = renderScorePcm(excerptScore(generated), {
        sampleRate: 8_000,
      });
      let peak = 0;
      for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
      expect(peak, entry.id).toBeGreaterThan(300);
      expect(peak, entry.id).toBeLessThan(32_767);
    }
  }, 30_000);
});
