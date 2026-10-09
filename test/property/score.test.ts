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
import { caseCount, forAllSeeds } from "./prng.ts";
import { nearbyScore, randomScore, tryScore } from "./random.ts";
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
