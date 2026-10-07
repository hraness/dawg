import { describe, expect, test } from "bun:test";
import {
  applyRewind,
  diffRewind,
  IDENTITY_REWIND,
  isIdentityRewind,
  parseRewind,
  rewindComposition,
} from "./delta.ts";

const roundTrip = (before: unknown, after: unknown) => {
  const rewind = diffRewind(before, after);
  expect(parseRewind(JSON.parse(JSON.stringify(rewind)))).toEqual(rewind);
  expect(applyRewind(after, rewind)).toEqual(before);
  return rewind;
};

describe("session rewinds", () => {
  test("equal values rewind to identity", () => {
    expect(isIdentityRewind(diffRewind({ a: 1 }, { a: 1 }))).toBe(true);
    expect(isIdentityRewind(diffRewind("x", "x"))).toBe(true);
    expect(isIdentityRewind(diffRewind({ a: 1 }, { a: 2 }))).toBe(false);
    expect(applyRewind({ a: 1 }, IDENTITY_REWIND)).toEqual({ a: 1 });
    expect(applyRewind("x", IDENTITY_REWIND)).toBe("x");
    expect(applyRewind([1], diffRewind([1], [1]))).toEqual([1]);
  });

  test("objects rewind per key, including added and removed keys", () => {
    const rewind = roundTrip(
      { tempo: 120, name: "a", gone: 1 },
      { tempo: 90, name: "a", added: true },
    );
    expect(rewind).toEqual({
      obj: { tempo: { set: 120 }, gone: { set: 1 }, added: { del: true } },
    });
  });

  test("id-keyed arrays rewind by id with a small delta", () => {
    const notes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      pitch: 60 + (i % 12),
    }));
    const edited = [...notes.slice(0, 50), ...notes.slice(51)];
    edited[10] = { id: "n10", pitch: 1 };
    edited.push({ id: "new", pitch: 2 });
    const rewind = roundTrip(notes, edited);
    expect(JSON.stringify(rewind).length).toBeLessThan(200);
    // Reorders, duplicates and non-keyed arrays still round-trip.
    roundTrip(notes, [...notes].reverse());
    roundTrip([{ id: "a" }, { id: "a" }], [{ id: "a" }]);
    roundTrip([1, 2, 3], [3, 2]);
    roundTrip({ notes }, { notes: [] });
    roundTrip({ notes: [] }, { notes });
  });

  test("nested compositions rewind across several events", () => {
    const states = [
      { tempoBpm: 120, tracks: [{ id: "t1", volume: 1 }], notes: [] },
      {
        tempoBpm: 120,
        tracks: [{ id: "t1", volume: 1 }],
        notes: [{ id: "a", trackId: "t1", pitch: 60 }],
      },
      {
        tempoBpm: 100,
        tracks: [
          { id: "t1", volume: 0.5 },
          { id: "t2", volume: 1 },
        ],
        notes: [{ id: "a", trackId: "t1", pitch: 60 }],
      },
      { tempoBpm: 100, tracks: [{ id: "t2", volume: 1 }], notes: [] },
    ];
    const events = states.slice(1).map((state, index) => ({
      rewind: diffRewind(states[index], state),
    }));
    const last = states[states.length - 1];
    for (let index = 0; index < events.length; index += 1)
      expect(rewindComposition(last, events, index)).toEqual(states[index]);
    expect(rewindComposition(last, events, events.length)).toBeUndefined();
    expect(
      rewindComposition(last, [{}, ...events.slice(1)], 0),
    ).toBeUndefined();
    expect(rewindComposition(last, [{}, ...events.slice(1)], 1)).toEqual(
      states[1],
    );
  });

  test("rejects malformed rewinds instead of trusting them", () => {
    for (const bad of [
      null,
      1,
      {},
      { set: 1, del: true },
      { del: false },
      { obj: [] },
      { obj: { a: 1 } },
      { arr: { drop: [-1], put: [] } },
      { arr: { drop: [], put: [[0]] } },
      { arr: { drop: [], put: [["x", 1]] } },
      { nope: 1 },
    ])
      expect(() => parseRewind(bad)).toThrow("rewind is invalid");
    expect(parseRewind(undefined)).toBeUndefined();
    // A rewind that does not fit the current value fails closed.
    expect(
      rewindComposition(1, [{ rewind: { obj: { a: { set: 1 } } } }], 0),
    ).toBeUndefined();
    expect(
      rewindComposition(
        [1],
        [{ rewind: { arr: { drop: [], put: [[5, 0]] } } }],
        0,
      ),
    ).toBeUndefined();
  });
});
