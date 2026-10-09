/**
 * Ripple edits (insert, delete, duplicate, move bars and sections) carry
 * the tempo map, fermatas, pedals and held notes with the music.
 */
import { describe, expect, test } from "bun:test";
import { createScore, ScoreValidationError, type TrackScore } from "./score.ts";
import {
  deleteBars,
  deleteSection,
  duplicateSection,
  insertBars,
  moveSection,
} from "./sections.ts";

const BAR = 1920; // 4/4 at 480 ticks per beat

function song(): TrackScore {
  return createScore({
    bars: 4,
    tempoBpm: 120,
    time: {
      tempo: [{ tick: 2 * BAR, bpm: 90 }],
      fermatas: [{ tick: 3 * BAR, beats: 2 }],
    },
    tracks: [
      {
        id: "p",
        name: "piano",
        instrument: "sine",
        pedal: [
          { tick: 2 * BAR, state: "down" },
          { tick: 3 * BAR, state: "up" },
        ],
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "p",
        startTick: 2 * BAR,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
      },
    ],
  });
}

const tempoTicks = (score: TrackScore) =>
  (score.time?.tempo ?? []).map((event) => [event.tick, event.bpm]);
const fermataTicks = (score: TrackScore) =>
  (score.time?.fermatas ?? []).map((fermata) => fermata.tick);
const pedal = (score: TrackScore) =>
  (score.tracks[0]!.pedal ?? []).map((event) => [event.tick, event.state]);

describe("ripple edits move time and pedals with the music", () => {
  test("insertBars shifts tempo, fermatas and pedal after the cut", () => {
    const next = insertBars(song(), 1, 1);
    expect(next.notes[0]!.startTick).toBe(3 * BAR);
    expect(tempoTicks(next)).toEqual([[3 * BAR, 90]]);
    expect(fermataTicks(next)).toEqual([4 * BAR]);
    expect(pedal(next)).toEqual([
      [3 * BAR, "down"],
      [4 * BAR, "up"],
    ]);
  });

  test("deleteBars before the music pulls it all back", () => {
    const next = deleteBars(song(), 0, 1);
    expect(next.notes[0]!.startTick).toBe(BAR);
    expect(tempoTicks(next)).toEqual([[BAR, 90]]);
    expect(fermataTicks(next)).toEqual([2 * BAR]);
    expect(pedal(next)).toEqual([
      [BAR, "down"],
      [2 * BAR, "up"],
    ]);
  });

  test("deleting the bars holding a tempo change keeps the tempo at the cut", () => {
    const next = deleteBars(song(), 1, 2);
    // Bar 3 (90 bpm, the fermata) now starts at bar 1.
    expect(next.bars).toBe(2);
    expect(tempoTicks(next)).toEqual([[BAR, 90]]);
    expect(fermataTicks(next)).toEqual([BAR]);
    expect(pedal(next)).toEqual([]);
    expect(next.notes).toEqual([]);
  });

  test("deleting 3 of 4 bars leaves no tempo event past the song", () => {
    const next = deleteBars(song(), 0, 3);
    expect(next.bars).toBe(1);
    expect(next.tempoBpm).toBe(90);
    for (const [tick] of tempoTicks(next)) expect(tick!).toBeLessThan(BAR);
  });

  test("move and duplicate carry the section's tempo and pedal", () => {
    const base = song().withSections([
      { name: "A", startBar: 0, bars: 2 },
      { name: "B", startBar: 2, bars: 2 },
    ]);
    const moved = moveSection(base, "B", 0);
    expect(moved.notes[0]!.startTick).toBe(0);
    expect(moved.tempoBpm).toBe(90);
    expect(fermataTicks(moved)).toEqual([BAR]);
    expect(pedal(moved)[0]).toEqual([0, "down"]);
    expect(pedal(moved)).toContainEqual([BAR, "up"]);
    const removed = deleteSection(base, "A");
    expect(removed.tempoBpm).toBe(90);
    expect(pedal(removed)).toEqual([
      [0, "down"],
      [BAR, "up"],
    ]);
  });
});

describe("bar bounds", () => {
  test("deleting a section past the song end removes only its marker", () => {
    const score = createScore({
      bars: 4,
      sections: [{ name: "Z", startBar: 6, bars: 2 }],
    });
    const next = deleteSection(score, "Z");
    expect(next.bars).toBe(4);
    expect(next.sections).toEqual([]);
  });

  test("deleteBars clamps to the song and rejects a bad start", () => {
    const score = createScore({ bars: 2 });
    expect(deleteBars(score, 5, 1)).toBe(score);
    expect(deleteBars(createScore({ bars: 4 }), 3, 5).bars).toBe(3);
    expect(() => deleteBars(score, -1, 1)).toThrow(ScoreValidationError);
    expect(() => deleteBars(score, 0.5, 1)).toThrow(ScoreValidationError);
  });

  test("duplicateSection rejects a destination inside or outside the song", () => {
    const base = createScore({
      bars: 4,
      sections: [
        { name: "A", startBar: 0, bars: 2 },
        { name: "B", startBar: 2, bars: 2 },
      ],
    });
    for (const toBar of [1, -2, 10, 0.5])
      expect(() => duplicateSection(base, "A", { toBar })).toThrow(
        ScoreValidationError,
      );
    const copied = duplicateSection(base, "A", { toBar: 4 });
    expect(copied.bars).toBe(6);
    expect(copied.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["A", 0, 2],
      ["B", 2, 2],
      ["A 2", 4, 2],
    ]);
  });
});

describe("notes across a ripple edit keep the parts outside it", () => {
  const held = (startTick: number, durationTicks: number) =>
    createScore({
      bars: 3,
      tracks: [{ id: "t", name: "t", instrument: "sine" }],
      notes: [
        {
          id: "n",
          trackId: "t",
          startTick,
          durationTicks,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
  const span = (score: TrackScore) =>
    score.notes.map((note) => [note.startTick, note.durationTicks]);

  test("a note starting in deleted bars keeps its tail", () => {
    expect(span(deleteBars(held(1000, 3000), 0, 1))).toEqual([[0, 2080]]);
  });
  test("a note ending in deleted bars is cut where they start", () => {
    expect(span(deleteBars(held(1000, 2000), 1, 1))).toEqual([[1000, 920]]);
  });
  test("a note spanning deleted bars loses only their length", () => {
    expect(span(deleteBars(held(1000, 4000), 1, 1))).toEqual([[1000, 2080]]);
  });
  test("a note wholly inside deleted bars goes", () => {
    expect(span(deleteBars(held(2000, 100), 1, 1))).toEqual([]);
  });
  test("a note held across an insertion point sounds on through it", () => {
    expect(span(insertBars(held(1000, 3000), 1, 1))).toEqual([[1000, 4920]]);
    expect(span(insertBars(held(1000, 920), 1, 1))).toEqual([[1000, 920]]);
  });
  test("insert then delete of the same bars is the identity", () => {
    for (const [start, length] of [
      [0, 100],
      [1000, 3000],
      [1919, 1],
      [1920, 1920],
      [3000, 2760],
    ] as const) {
      const base = held(start, length);
      for (let bar = 0; bar <= 3; bar += 1)
        expect(span(deleteBars(insertBars(base, bar, 2), bar, 2))).toEqual(
          span(base),
        );
    }
  });
});
