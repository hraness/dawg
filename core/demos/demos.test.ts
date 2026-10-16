import { describe, expect, test } from "bun:test";
import { scoreFromJSON, SCORE_LIMITS } from "../score.ts";
import { arrangedBars, barsToSeconds } from "../sections.ts";
import { DEMOS, createDemo } from "./index.ts";

// Longest run of consecutive bars after the intro where no kick lands; every
// demo keeps a real break so the drop has somewhere to return from.
const longestKickRest = (score: ReturnType<typeof createDemo>) => {
  const kicks = score.notes.filter(
    (note) => note.trackId === "kick" || note.trackId.startsWith("kick-"),
  );
  if (kicks.length === 0) return 0;
  const bars = new Set(kicks.map((note) => Math.floor(note.startTick / 1920)));
  let best = 0,
    run = 0;
  for (let bar = Math.min(...bars); bar <= Math.max(...bars); bar += 1) {
    run = bars.has(bar) ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
};

describe("complete demo songs", () => {
  test("three hyperpop entries expose truthful form and duration metadata", () => {
    expect(DEMOS.map((demo) => demo.id)).toEqual([
      "soft-reboot",
      "low-battery",
      "glass-garden",
    ]);
    expect(new Set(DEMOS.map((demo) => demo.title)).size).toBe(3);
    expect(new Set(DEMOS.map((demo) => demo.tempoBpm)).size).toBe(3);
    for (const demo of DEMOS) {
      expect(demo.style).toBe("Hyperpop");
      expect(demo.title.length).toBeLessThanOrEqual(16);
      const score = createDemo(demo.id);
      expect(score.tempoBpm).toBe(demo.tempoBpm);
      expect(score.key).toBe(demo.key);
      expect(score.bars).toBe(demo.bars);
      expect(score.ticksPerBeat).toBe(480);
      expect(score.tracks.some((track) => track.id === demo.trackId)).toBe(
        true,
      );
      expect(demo.highlightBar).toBeLessThan(score.bars);
      expect(barsToSeconds(score, arrangedBars(score))).toBeCloseTo(
        demo.durationSeconds,
        6,
      );
      expect(demo.durationSeconds).toBeGreaterThan(120);
      expect(demo.durationSeconds).toBeLessThan(210);
      expect(demo.arrangement).toHaveLength(score.sections.length);
      expect(demo.features.length).toBeGreaterThanOrEqual(4);
      expect(demo.mixNotes.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("complete, non-silent scenes stay within native editing limits and round trip", () => {
    const engines = new Set<string>();
    for (const demo of DEMOS) {
      const score = createDemo(demo.id);
      expect(score.notes.length, demo.id).toBeLessThanOrEqual(
        SCORE_LIMITS.maxNotes,
      );
      expect(score.tracks.length).toBeGreaterThanOrEqual(5);
      expect(score.sections.length).toBeGreaterThanOrEqual(6);
      expect(score.form).toHaveLength(score.sections.length);
      expect(scoreFromJSON(JSON.parse(JSON.stringify(score)))).toEqual(score);
      let boundary = 0;
      const textures = new Set<string>();
      for (const section of score.sections) {
        expect(section.startBar, demo.id).toBe(boundary);
        boundary += section.bars;
        const notes = score.notes.filter(
          (note) =>
            note.startTick >= section.startBar * 1920 &&
            note.startTick < boundary * 1920,
        );
        expect(notes.length, `${demo.id}: ${section.name}`).toBeGreaterThan(0);
        textures.add(
          [...new Set(notes.map((note) => note.trackId))].sort().join(","),
        );
      }
      expect(boundary).toBe(score.bars);
      expect(textures.size, demo.id).toBeGreaterThanOrEqual(3);
      for (const track of score.tracks) {
        engines.add(track.instrument);
        expect(
          score.notes.some((note) => note.trackId === track.id),
          `${demo.id}: ${track.id}`,
        ).toBe(true);
        for (const ref of Object.values(track.sampler?.voices ?? {})) {
          expect(ref.src).toStartWith("pack:studio/");
          expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(ref.license).toBe("CC0-1.0");
        }
      }
      expect(
        score.notes.every(
          (note) => note.startTick + note.durationTicks <= score.bars * 1920,
        ),
      ).toBe(true);
      expect(score.master?.limiter?.ceiling).toBe(-1);
    }
    expect(engines.size).toBeGreaterThanOrEqual(9);
  });

  test("factories are deterministic and isolated, and reject unknown titles", () => {
    for (const demo of DEMOS) {
      const first = createDemo(demo.id),
        second = createDemo(demo.id);
      expect(second).not.toBe(first);
      expect(second).toEqual(first);
      expect(second.tracks).not.toBe(first.tracks);
    }
    expect(() => createDemo("missing")).toThrow("Unknown demo");
  });

  test("each song keeps the hyperpop production moves", () => {
    for (const demo of DEMOS) {
      const score = createDemo(demo.id);
      const track = (id: string) =>
        score.tracks.find((candidate) => candidate.id === id);
      const kicks = score.notes
        .filter((note) => note.trackId === "kick")
        .map((note) => note.startTick / 1920);
      // A drumless opening, a real break, and an ending left to the tails.
      expect(Math.min(...kicks), demo.id).toBeGreaterThanOrEqual(4);
      expect(longestKickRest(score), demo.id).toBeGreaterThanOrEqual(4);
      expect(score.bars - Math.max(...kicks), demo.id).toBeGreaterThan(4);
      // Pads, stabs and the upper layers pump on the kick's orbit.
      expect(track("kick")?.fx?.duck?.orbit).toBe(2);
      for (const id of ["pad", "stabs", "chops"])
        expect(track(id)?.fx?.orbit?.orbit, `${demo.id}: ${id}`).toBe(2);
      // A soft sub that glides between roots.
      expect(track("sub")?.glide?.time).toBeGreaterThan(0);
      expect(
        score.notes.some(
          (note) => note.trackId === "sub" && note.glide !== undefined,
        ),
        demo.id,
      ).toBe(true);
      // Sung lines with delay throws, chops cut from the same hook.
      const vox = track("vox");
      expect(vox?.sampler?.voices.lineA?.src).toStartWith("pack:studio/");
      expect(
        vox?.delayMixAutomation?.some((point) => point.value >= 0.2),
        demo.id,
      ).toBe(true);
      expect(track("chops")?.sampler?.voices).toBeDefined();
      expect(
        score.notes.filter((note) => note.trackId === "chops").length,
        demo.id,
      ).toBeGreaterThan(40);
      // The chops play alone over the drums for a bar before the bed.
      const melodic = new Set(["pad", "stabs", "pluck", "bells", "lead"]);
      const firstKickBar = Math.floor(Math.min(...kicks));
      const bare = score.notes.filter(
        (note) =>
          melodic.has(note.trackId) &&
          Math.floor(note.startTick / 1920) === firstKickBar,
      );
      expect(bare, demo.id).toEqual([]);
    }
  });
});
