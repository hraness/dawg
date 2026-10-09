/**
 * Property tests for score data, diff and apply: every field of `Note`,
 * `Track` and the song survives a single-field change, and for seeded
 * random pairs of valid scores `applyScoreOperations(a, diffScores(a, b))`
 * never throws and equals `b`.
 */

import { describe, expect, test } from "bun:test";
import {
  applyScoreOperations,
  diffScores,
  NOTE_FIELD_NAMES,
  TRACK_FIELD_NAMES,
} from "../../core/diff.ts";
import {
  createScore,
  ScoreValidationError,
  type Note,
  type Track,
  type TrackScore,
  type TrackScoreData,
} from "../../core/score.ts";
import { caseCount, forAllSeeds, type Rng } from "./prng.ts";
import {
  ALL_NOTES,
  ALL_TRACKS,
  EXTRA_LANES,
  NOTE_SAMPLES,
  SONG_VALUES,
  TRACK_SAMPLES,
} from "./fixtures.ts";

const BASE: TrackScoreData = { bars: 64, tempoBpm: 120 };
const HOST: Partial<Track> = { id: "t", name: "t", instrument: "sine" };

function tryScore(data: TrackScoreData): TrackScore | undefined {
  try {
    return createScore(data);
  } catch (error) {
    if (error instanceof ScoreValidationError) return undefined;
    // Some validators throw their own Error subclasses; a TypeError or
    // RangeError is a bug, never a validation answer.
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    return undefined;
  }
}

/** a → b through diff and apply equals b, and diffs back to nothing. */
function expectInverse(a: TrackScore, b: TrackScore): number {
  const ops = diffScores(a, b);
  const applied = applyScoreOperations(a, ops);
  expect(applied.toJSON()).toEqual(b.toJSON());
  expect(diffScores(applied, b)).toEqual([]);
  return ops.length;
}

/** A copy with its last numeric leaf nudged: a small, often valid, edit. */
function tweak(value: unknown): unknown {
  const copy = structuredClone(value);
  let last: { holder: Record<string, unknown>; key: string } | undefined;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node))
      if (typeof child === "number")
        last = { holder: node as Record<string, unknown>, key };
      else walk(child);
  };
  walk(copy);
  if (!last) return copy;
  const n = last.holder[last.key] as number;
  last.holder[last.key] = Number.isInteger(n) ? n + 1 : n / 2;
  return copy;
}

function without<T extends object>(value: T, key: string): T {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

describe("field completeness", () => {
  test("every Track and Note field has fixture values", () => {
    const trackKeys = TRACK_FIELD_NAMES.filter((key) => key !== "id");
    for (const key of trackKeys)
      expect(
        key in TRACK_SAMPLES ||
          (EXTRA_LANES as readonly string[]).includes(key),
      ).toBe(true);
    const noteKeys = NOTE_FIELD_NAMES.filter(
      (key) => key !== "id" && key !== "trackId",
    );
    for (const key of noteKeys) expect(key in NOTE_SAMPLES).toBe(true);
  });

  test("changing any one Track field diffs and applies back exactly", () => {
    const keys = TRACK_FIELD_NAMES.filter((key) => key !== "id");
    for (const key of keys) {
      const samples: Track[] = (EXTRA_LANES as readonly string[]).includes(key)
        ? [{ ...(HOST as Track), [key]: [{ tick: 0, value: 0.25 }] }]
        : [...(TRACK_SAMPLES[key] ?? [])];
      let checked = 0;
      for (const sample of samples) {
        const values = [
          ...(TRACK_SAMPLES[key] ?? []).map((other) => other[key]),
          [{ tick: 480, value: 0.75 }],
          tweak(sample[key]),
          undefined,
        ];
        const a = tryScore({ ...BASE, tracks: [{ ...sample, id: "t" }] });
        if (!a) continue;
        for (const value of values) {
          const changed =
            value === undefined
              ? without(sample, key)
              : { ...sample, [key]: value };
          const b = tryScore({ ...BASE, tracks: [{ ...changed, id: "t" }] });
          if (!b || JSON.stringify(a) === JSON.stringify(b)) continue;
          expect(expectInverse(a, b)).toBeGreaterThan(0);
          expect(expectInverse(b, a)).toBeGreaterThan(0);
          checked += 1;
        }
      }
      if (checked === 0) throw new Error(`no valid change for track.${key}`);
    }
  });

  test("changing any one Note field diffs and applies back exactly", () => {
    const keys = NOTE_FIELD_NAMES.filter(
      (key) => key !== "id" && key !== "trackId",
    );
    for (const key of keys) {
      let checked = 0;
      for (const sample of NOTE_SAMPLES[key] ?? []) {
        const note = { ...sample, id: "n", trackId: "t" };
        const a = tryScore({ ...BASE, tracks: [HOST as Track], notes: [note] });
        if (!a) continue;
        const values = [
          ...(NOTE_SAMPLES[key] ?? []).map((other) => other[key]),
          tweak(note[key]),
          undefined,
        ];
        for (const value of values) {
          const changed =
            value === undefined
              ? without(note, key)
              : { ...note, [key]: value };
          const b = tryScore({
            ...BASE,
            tracks: [HOST as Track],
            notes: [changed],
          });
          if (!b || JSON.stringify(a) === JSON.stringify(b)) continue;
          expect(expectInverse(a, b)).toBeGreaterThan(0);
          expect(expectInverse(b, a)).toBeGreaterThan(0);
          checked += 1;
        }
      }
      if (checked === 0) throw new Error(`no valid change for note.${key}`);
    }
  });

  test("a vowel edit is one updateNote", () => {
    const track = HOST as Track;
    const at = (vowel: string) =>
      createScore({
        ...BASE,
        tracks: [track],
        notes: [
          {
            id: "n",
            trackId: "t",
            startTick: 0,
            durationTicks: 480,
            pitch: 60,
            velocity: 0.8,
            vowel,
          },
        ],
      });
    expect(diffScores(at("a"), at("o"))).toEqual([
      { type: "updateNote", noteId: "n", patch: { vowel: "o" } },
    ]);
  });

  test("changing any one song field diffs and applies back exactly", () => {
    for (const [key, values] of Object.entries(SONG_VALUES)) {
      if (key === "ticksPerBeat") continue; // fixed per session
      // A form or loop section names sections, so it needs them.
      const base: TrackScoreData =
        key === "form" || key === "loopSection"
          ? { ...BASE, sections: SONG_VALUES.sections!.at(-1) as never }
          : BASE;
      let checked = 0;
      for (const first of [...values, undefined])
        for (const second of [...values, undefined]) {
          const a = tryScore({ ...base, [key]: first });
          const b = tryScore({ ...base, [key]: second });
          if (!a || !b || JSON.stringify(a) === JSON.stringify(b)) continue;
          expect(expectInverse(a, b)).toBeGreaterThan(0);
          checked += 1;
        }
      if (checked === 0) throw new Error(`no valid change for song ${key}`);
    }
  });
});

describe("song settings apply in a valid order", () => {
  test("dropping sections comes before adding meter changes", () => {
    const a = createScore({
      bars: 8,
      sections: [{ name: "intro", startBar: 0, bars: 2 }],
    });
    const b = createScore({
      bars: 8,
      time: { meter: [{ bar: 2, beatsPerBar: 3 }] },
    });
    expectInverse(a, b);
    expectInverse(b, a);
  });

  test("a fermata is dropped before a slower tempo times it", () => {
    const a = createScore({
      tempoBpm: 120,
      time: { fermatas: [{ tick: 0, beats: 8 }] },
    });
    const b = createScore({ tempoBpm: 30 });
    expectInverse(a, b);
    expectInverse(b, a);
    // Same fermata on both sides, but the slower tempo needs a shorter one.
    const c = createScore({
      tempoBpm: 30,
      time: { fermatas: [{ tick: 0, beats: 4 }] },
    });
    expectInverse(a, c);
    expectInverse(c, a);
  });

  test("a meter change at bar 0 survives setMeter", () => {
    const time = {
      meter: [
        { bar: 0, beatsPerBar: 3 },
        { bar: 2, beatsPerBar: 5 },
      ],
    };
    const a = createScore({ beatsPerBar: 4, time });
    const b = createScore({ beatsPerBar: 3, time });
    expect(b.time?.meter).toHaveLength(2);
    expectInverse(a, b);
    expectInverse(b, a);
  });

  test("-0 and 0 are the same value, so a printed -0 settles", () => {
    const at = (value: number) =>
      createScore({
        tracks: [{ ...(HOST as Track), panAutomation: [{ tick: 0, value }] }],
      });
    expect(diffScores(at(-0), at(0))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Random scores

function randomTime(rng: Rng, bars: number, beatsPerBar: number): unknown {
  if (rng.chance(0.4)) return undefined;
  const maxTick = bars * beatsPerBar * 480;
  const time: Record<string, unknown> = {};
  if (rng.chance(0.6))
    time.tempo = Array.from({ length: rng.int(1, 3) }, (_, i) => ({
      tick: Math.min(maxTick, 480 * (1 + i * rng.int(1, 8))),
      bpm: rng.pick([30, 60, 90, 132, 200]),
      ...(rng.chance(0.3) ? { ramp: rng.pick(["linear", "exp"]) } : {}),
    }));
  if (rng.chance(0.5))
    time.meter = Array.from({ length: rng.int(1, 2) }, (_, i) => ({
      bar: i === 0 ? rng.pick([0, 1, 2]) : 3 + i,
      beatsPerBar: rng.int(2, 7),
      ...(rng.chance(0.3) ? { beatUnit: rng.pick([4, 8]) } : {}),
    }));
  if (rng.chance(0.5))
    time.fermatas = [{ tick: 480 * rng.int(0, 7), beats: rng.int(1, 8) }];
  return time;
}

function randomSections(rng: Rng): Partial<TrackScoreData> {
  if (rng.chance(0.5)) return {};
  const index = rng.int(0, (SONG_VALUES.sections ?? []).length - 1);
  const sections = SONG_VALUES.sections![index] as TrackScoreData["sections"];
  const form = SONG_VALUES.form?.[index] as TrackScoreData["form"];
  return {
    sections,
    ...(rng.chance(0.5) && form ? { form } : {}),
    ...(rng.chance(0.3) && sections?.some((s) => s.name === "chorus")
      ? { loopSection: "chorus" }
      : {}),
  };
}

function randomTrack(rng: Rng, id: string): Track {
  const base = rng.pick(ALL_TRACKS);
  const track: Record<string, unknown> = { ...base, id };
  if (rng.chance(0.5)) {
    const key = rng.pick(Object.keys(TRACK_SAMPLES));
    const value = rng.pick(TRACK_SAMPLES[key]!)[key as keyof Track];
    track[key] = value;
  }
  if (rng.chance(0.3)) track.volume = rng.pick([0, 0.5, 0.8, 1]);
  if (rng.chance(0.3)) track.pan = rng.pick([-1, -0.25, 0, 0.5]);
  if (rng.chance(0.2)) track.muted = !track.muted;
  if (rng.chance(0.2)) track.solo = true;
  if (rng.chance(0.2))
    track[rng.pick(EXTRA_LANES)] = [{ tick: rng.int(0, 960), value: 0.5 }];
  return track as Track;
}

function randomNote(rng: Rng, trackIds: readonly string[]): Note {
  const base = rng.pick(ALL_NOTES);
  const note: Record<string, unknown> = {
    ...base,
    id: `n${rng.int(0, 15)}`,
    trackId: rng.pick(trackIds),
    startTick: 120 * rng.int(0, 63),
    pitch: rng.int(36, 84),
  };
  for (let i = rng.int(0, 3); i > 0; i -= 1) {
    const key = rng.pick(Object.keys(NOTE_SAMPLES));
    note[key] = rng.pick(NOTE_SAMPLES[key]!)[key as keyof Note];
  }
  if (rng.chance(0.2)) delete note[rng.pick(Object.keys(note))];
  return note as Note;
}

function randomScore(rng: Rng): TrackScore {
  for (;;) {
    const bars = rng.int(1, 32);
    const beatsPerBar = rng.int(2, 7);
    const trackIds = Array.from(
      { length: rng.int(0, 4) },
      (_, i) => `t${rng.int(0, 5)}${i}`,
    );
    const ids = [...new Set(trackIds)];
    const notes = ids.length
      ? Array.from({ length: rng.int(0, 10) }, () => randomNote(rng, ids))
      : [];
    const unique = [...new Map(notes.map((n) => [n.id, n])).values()];
    const score = tryScore({
      tempoBpm: rng.pick([30, 72, 120, 174]),
      beatsPerBar,
      bars,
      key: rng.pick([null, "C major", "A minor"]),
      time: randomTime(rng, bars, beatsPerBar) as TrackScoreData["time"],
      ...(rng.chance(0.3)
        ? { tuning: rng.pick(SONG_VALUES.tuning!) as TrackScoreData["tuning"] }
        : {}),
      ...(rng.chance(0.3)
        ? { master: rng.pick(SONG_VALUES.master!) as TrackScoreData["master"] }
        : {}),
      ...randomSections(rng),
      tracks: ids.map((id) => randomTrack(rng, id)),
      notes: unique,
    });
    if (score) return score;
  }
}

/** b as a small edit of a: a few song, track or note changes. */
function nearbyScore(rng: Rng, a: TrackScore): TrackScore {
  for (;;) {
    const data: Record<string, unknown> = { ...a.toJSON() };
    const fresh = randomScore(rng).toJSON() as Record<string, unknown>;
    for (let i = rng.int(1, 4); i > 0; i -= 1) {
      const key = rng.pick([
        "tempoBpm",
        "beatsPerBar",
        "bars",
        "key",
        "time",
        "tuning",
        "master",
        "sections",
        "tracks",
        "notes",
      ]);
      data[key] = fresh[key];
      if (key === "sections") {
        data.form = fresh.form;
        data.loopSection = fresh.loopSection;
      }
    }
    const score = tryScore(data as TrackScoreData);
    if (score) return score;
  }
}

describe("random scores", () => {
  const cases = caseCount(200);

  test("createScore(score.toJSON()) equals the score", () => {
    forAllSeeds(1_000, cases, (rng) => {
      const score = randomScore(rng);
      expect(createScore(score.toJSON()).toJSON()).toEqual(score.toJSON());
      expect(diffScores(score, score)).toEqual([]);
    });
  });

  test("diff then apply turns a into b, for random and nearby pairs", () => {
    forAllSeeds(2_000, cases, (rng) => {
      const a = randomScore(rng);
      const b = rng.chance(0.5) ? randomScore(rng) : nearbyScore(rng, a);
      expectInverse(a, b);
      expectInverse(b, a);
    });
  });
});
