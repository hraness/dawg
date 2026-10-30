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

/** The three songs built on the shared hyperpop kit. */
const HYPER = ["redline", "glass-garden"];

describe("complete demo songs", () => {
  test("hyperpop entries expose truthful form and duration metadata", () => {
    expect(DEMOS).toHaveLength(6);
    expect(new Set(DEMOS.map((demo) => demo.id)).size).toBe(DEMOS.length);
    expect(new Set(DEMOS.map((demo) => demo.title)).size).toBe(DEMOS.length);
    expect(DEMOS.filter((demo) => HYPER.includes(demo.id))).toHaveLength(2);
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
      expect(demo.durationSeconds).toBeGreaterThan(60);
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
      expect(score.master?.limiter?.ceiling).toBe(-1.1);
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

  test("each hyperpop kit song keeps the production moves", () => {
    for (const demo of DEMOS.filter((entry) => HYPER.includes(entry.id))) {
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
      // Distinct sung lines with delay throws on their last words.
      const notesOf = (id: string) =>
        score.notes.filter((note) => note.trackId === id);
      const vox = track("vox");
      for (const part of ["v1", "v8", "pre1", "ch1", "ch3"])
        expect(
          vox?.sampler?.voices[part]?.src,
          `${demo.id}: ${part}`,
        ).toStartWith("pack:studio/");
      expect(
        new Set(notesOf("vox").map((note) => note.pitch)).size,
        demo.id,
      ).toBeGreaterThanOrEqual(11);
      // The synth singer sings every line with its words, the recorded
      // book under it (Glass Garden) or leading it (Redline); the backing
      // singer harmonises.
      const sung = notesOf("sing");
      expect(sung.length, demo.id).toBeGreaterThan(150);
      expect(
        sung.filter((note) => note.lyric !== undefined).length,
        demo.id,
      ).toBe(sung.length);
      expect(notesOf("harm").length, demo.id).toBeGreaterThan(20);
      expect(
        Math.max(...notesOf("vox").map((note) => note.velocity)),
        demo.id,
      ).toBeLessThanOrEqual(0.95);
      expect(
        vox?.delayMixAutomation?.some((point) => point.value > 0.025),
        demo.id,
      ).toBe(true);
      // The syllables as an instrument: a round-robin keyed riff, glitch
      // stutters pitched through the chords, reversals, and a grain cloud.
      const chops = track("chops")?.sampler;
      expect(chops?.mode).toBe("keyed");
      expect(Object.values(chops?.voices ?? {}).every((v) => v.rr)).toBe(true);
      expect(notesOf("chops").length, demo.id).toBeGreaterThan(250);
      const stut = notesOf("stut");
      expect(stut.length, demo.id).toBeGreaterThan(120);
      expect(
        new Set(stut.map((note) => note.cents ?? 0)).size,
        demo.id,
      ).toBeGreaterThanOrEqual(8);
      expect(
        Object.values(track("stut")?.sampler?.voices ?? {}).some(
          (v) => v.speed === -1,
        ),
      ).toBe(true);
      expect(track("vgrain")?.granular?.quant).toBe("chord");
      expect(notesOf("vlead").length, demo.id).toBeGreaterThan(20);
      expect(
        track("chops")?.fxAutomation?.["formant-shift"]?.length,
        demo.id,
      ).toBeGreaterThan(4);
      // Hyperactive stabs, and the kick pattern keeps changing.
      expect(notesOf("stabs").length, demo.id).toBeGreaterThan(300);
      const kickBars = new Map<number, string[]>();
      for (const note of notesOf("kick")) {
        const bar = Math.floor(note.startTick / 1920);
        kickBars.set(bar, [
          ...(kickBars.get(bar) ?? []),
          String(note.startTick % 1920),
        ]);
      }
      expect(
        new Set([...kickBars.values()].map((ticks) => ticks.join())).size,
        demo.id,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  test("each hyperpop kit song stays clean inside its limits", () => {
    for (const demo of DEMOS.filter((entry) => HYPER.includes(entry.id))) {
      const score = createDemo(demo.id);
      // Headroom under the 4096-note limit for later edits.
      expect(score.notes.length, demo.id).toBeLessThan(4000);
      // No note double-triggers on one track, and every note starts inside the song.
      const seen = new Set<string>();
      for (const note of score.notes) {
        const key = `${note.trackId} ${note.startTick} ${note.pitch} ${note.cents ?? 0}`;
        expect(seen.has(key), `${demo.id}: ${key}`).toBe(false);
        seen.add(key);
        expect(note.startTick, demo.id).toBeGreaterThanOrEqual(0);
        expect(note.startTick, demo.id).toBeLessThan(score.bars * 1920);
      }
      // Every automation lane moves forward in time.
      for (const track of score.tracks) {
        const lanes = [
          ...Object.entries(track)
            .filter(
              ([key, value]) =>
                key.endsWith("Automation") && Array.isArray(value),
            )
            .map(([key, value]) => [key, value] as const),
          ...Object.entries(track.fxAutomation ?? {}),
        ] as (readonly [string, readonly { tick: number }[]])[];
        for (const [lane, points] of lanes)
          points.forEach((point, i) => {
            if (i > 0)
              expect(
                point.tick,
                `${demo.id}: ${track.id} ${lane}`,
              ).toBeGreaterThanOrEqual(points[i - 1]!.tick);
          });
      }
    }
  });

  test("hyperpop keeps its production moves and breathes with a kick-less break", () => {
    expect(
      DEMOS.filter((demo) => !HYPER.includes(demo.id))
        .map((demo) => demo.style)
        .sort(),
    ).toEqual(["Hyperpop", "Hyperpop", "Hyperpop", "Hyperpop"]);
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

  test("featured production moves survive score normalization", () => {
    const red = createDemo("redline");
    expect(red.tracks.find((track) => track.id === "voc")?.vocoder?.src).toBe(
      "vox",
    );
    expect(red.notes.some((note) => note.glide !== undefined)).toBe(true);
    const glass = createDemo("glass-garden");
    expect(
      glass.notes.filter((note) => note.trackId === "harm" && note.lyric)
        .length,
    ).toBeGreaterThan(20);
    expect(
      glass.tracks
        .find((track) => track.id === "sing")
        ?.delayMixAutomation?.some((point) => point.value > 0.3),
    ).toBe(true);
  });
});
