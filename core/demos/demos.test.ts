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
  test("seven distinct compact entries expose truthful form and duration metadata", () => {
    expect(DEMOS).toHaveLength(7);
    expect(new Set(DEMOS.map((demo) => demo.id)).size).toBe(7);
    expect(new Set(DEMOS.map((demo) => demo.style)).size).toBe(7);
    for (const demo of DEMOS) {
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
      expect(demo.durationSeconds).toBeGreaterThan(60);
      expect(demo.durationSeconds).toBeLessThan(180);
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

  test("hyperpop keeps its production moves and breathes with a kick-less break", () => {
    expect(DEMOS.map((demo) => demo.style).sort()).toEqual([
      "Acid techno",
      "Hyperpop",
      "Jungle",
      "Neo soul",
      "Synth pop",
      "Trip hop",
      "UK garage",
    ]);
    const hyper = createDemo("candy-fault");
    expect(
      hyper.tracks.find((track) => track.id === "hook")?.fx?.distort,
    ).toBeDefined();
    expect(
      hyper.notes.some(
        (note) =>
          note.trackId === "chops" &&
          note.pitch >= 80 &&
          note.durationTicks <= 120,
      ),
    ).toBe(true);
    expect(
      hyper.notes.some(
        (note) => note.trackId === "sub" && note.glide !== undefined,
      ),
    ).toBe(true);
    expect(hyper.notes.filter((note) => note.lyric).length).toBeGreaterThan(20);
    expect(longestKickRest(hyper)).toBeGreaterThanOrEqual(4);
  });

  test("featured arrangement and synthesis moves survive score normalization", () => {
    const acid = createDemo("coil-driver");
    expect(
      acid.tracks.find((track) => track.id === "acid")?.fxAutomation?.[
        "synth-lpf"
      ]?.length,
    ).toBeGreaterThan(8);
    expect(acid.notes.some((note) => note.glide !== undefined)).toBe(true);
    expect(longestKickRest(acid)).toBeGreaterThanOrEqual(4);
    const pop = createDemo("signal-bloom");
    expect(pop.tracks.length).toBeGreaterThanOrEqual(10);
    expect(pop.sections.length).toBeGreaterThanOrEqual(8);
    expect(
      pop.tracks.filter((track) => track.instrument === "kit").length,
    ).toBeGreaterThanOrEqual(2);
    expect(pop.tracks.some((track) => track.sampler)).toBe(true);
    expect(pop.tracks.some((track) => track.wavetable)).toBe(true);
    expect(pop.notes.filter((note) => note.lyric).length).toBeGreaterThan(20);
    // The vocal double is a late-song lift, never there from the first verse.
    const firstLyric = Math.min(
      ...pop.notes.filter((note) => note.lyric).map((note) => note.startTick),
    );
    expect(
      pop.notes
        .filter((note) => note.trackId === "double")
        .every((note) => note.startTick >= firstLyric + 16 * 1920),
    ).toBe(true);
    const garage = createDemo("velvet-circuit");
    expect(
      garage.tracks.find((track) => track.id === "hold")?.sampler?.voices.hold
        ?.begin,
    ).toBe(0);
    expect(
      garage.tracks.find((track) => track.id === "on")?.sampler?.voices.on
        ?.begin,
    ).toBe(0.25);
    expect(garage.notes.some((note) => note.startTick % 120 !== 0)).toBe(true);
    const dub = createDemo("low-tide").tracks.find(
      (track) => track.id === "vocal",
    );
    expect(dub?.delayMixAutomation?.some((point) => point.value > 0.3)).toBe(
      true,
    );
  });
});
