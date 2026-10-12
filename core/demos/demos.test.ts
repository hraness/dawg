import { describe, expect, test } from "bun:test";
import { scoreFromJSON, SCORE_LIMITS } from "../score.ts";
import { arrangedBars, barsToSeconds } from "../sections.ts";
import { DEMOS, createDemo } from "./index.ts";

describe("complete demo songs", () => {
  test("eleven distinct compact entries expose truthful form and duration metadata", () => {
    expect(DEMOS).toHaveLength(11);
    expect(new Set(DEMOS.map((demo) => demo.id)).size).toBe(11);
    expect(new Set(DEMOS.map((demo) => demo.style)).size).toBe(11);
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

  test("hyperpop, house and EDM retain their distinct production and arrangement moves", () => {
    expect(DEMOS.map((demo) => demo.style)).toEqual(
      expect.arrayContaining([
        "Hyperpop",
        "Deep house",
        "Melodic EDM",
        "Acid techno",
      ]),
    );
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
    expect(
      hyper.notes.filter(
        (note) =>
          ["kick", "hook", "chords"].includes(note.trackId) &&
          note.startTick >= 24 * 1920 &&
          note.startTick < 32 * 1920,
      ),
    ).toHaveLength(0);
    const house = createDemo("after-hours");
    expect(
      house.notes
        .filter(
          (note) =>
            note.trackId === "kick" &&
            note.startTick >= 16 * 1920 &&
            note.startTick < 17 * 1920,
        )
        .map((note) => note.startTick % 1920),
    ).toEqual([0, 480, 960, 1440]);
    expect(house.tracks.find((track) => track.id === "keys")?.instrument).toBe(
      "epiano",
    );
    expect(
      house.notes.some(
        (note) => note.trackId === "percussion" && note.startTick % 120 !== 0,
      ),
    ).toBe(true);
    expect(
      house.notes.some(
        (note) =>
          note.trackId === "kick" &&
          note.startTick >= 32 * 1920 &&
          note.startTick < 40 * 1920,
      ),
    ).toBe(false);
    const edm = createDemo("skyline-current");
    expect(
      edm.tracks.find((track) => track.id === "kick")?.fx?.duck?.depth,
    ).toBeGreaterThan(0.6);
    expect(
      edm.tracks.find((track) => track.id === "chords")?.synth?.unison,
    ).toBe(5);
    const snareCount = (bar: number) =>
      edm.notes.filter(
        (note) =>
          note.trackId === "build" &&
          note.startTick >= bar * 1920 &&
          note.startTick < (bar + 1) * 1920,
      ).length;
    expect(snareCount(46)).toBeGreaterThan(snareCount(40));
    expect(
      edm.notes.filter(
        (note) =>
          note.startTick >= 47 * 1920 + 960 && note.startTick < 48 * 1920,
      ),
    ).toHaveLength(0);
    const first = edm.notes
      .filter(
        (note) =>
          note.trackId === "lead" &&
          note.startTick >= 20 * 1920 &&
          note.startTick < 22 * 1920,
      )
      .map((note) => note.pitch);
    const last = edm.notes
      .filter(
        (note) =>
          note.trackId === "lead" &&
          note.startTick >= 52 * 1920 &&
          note.startTick < 54 * 1920,
      )
      .map((note) => note.pitch);
    expect(last).not.toEqual(first);
  });

  test("featured arrangement and synthesis moves survive score normalization", () => {
    const acid = createDemo("coil-driver");
    expect(
      acid.tracks.find((track) => track.id === "acid")?.fxAutomation?.[
        "synth-lpf"
      ]?.length,
    ).toBeGreaterThan(8);
    expect(acid.notes.some((note) => note.glide !== undefined)).toBe(true);
    expect(
      acid.notes.some(
        (note) =>
          note.trackId === "kick" &&
          note.startTick >= 32 * 1920 &&
          note.startTick < 40 * 1920,
      ),
    ).toBe(false);
    const pop = createDemo("signal-bloom");
    expect(pop.tracks.length).toBeGreaterThanOrEqual(12);
    expect(pop.sections.length).toBeGreaterThanOrEqual(10);
    expect(
      pop.tracks.filter((track) => track.instrument === "kit"),
    ).toHaveLength(4);
    expect(pop.tracks.filter((track) => track.sampler)).toHaveLength(2);
    expect(pop.tracks.some((track) => track.wavetable)).toBe(true);
    expect(pop.notes.filter((note) => note.lyric).length).toBeGreaterThan(25);
    expect(
      pop.notes
        .filter((note) => note.trackId === "double")
        .every((note) => note.startTick >= 48 * 1920),
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
    const cloud = createDemo("glass-arc").tracks.find(
      (track) => track.id === "grains",
    );
    expect(typeof cloud?.granular?.src).toBe("object");
    const dub = createDemo("low-tide").tracks.find(
      (track) => track.id === "vocal",
    );
    expect(dub?.delayMixAutomation?.some((point) => point.value > 0.3)).toBe(
      true,
    );
  });
});
