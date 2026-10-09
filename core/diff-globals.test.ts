/**
 * Diff round trips for song-level fields, note fields added after the
 * first diff (vowel), orphan notes and negative zero. Seeded, bounded.
 */
import { describe, expect, test } from "bun:test";
import { applyScoreOperations, deepEqual, diffScores } from "./diff.ts";
import { createScore, TrackScore, type TrackScoreData } from "./score.ts";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function roundTrip(a: TrackScore, b: TrackScore): void {
  const ops = diffScores(a, b);
  const result = applyScoreOperations(a, ops);
  expect(JSON.stringify(result.toJSON())).toBe(JSON.stringify(b.toJSON()));
  expect(diffScores(result, b)).toEqual([]);
}

const track = { id: "t", name: "t", instrument: "sine" };
const note = (extra: Record<string, unknown> = {}) => ({
  id: "n",
  trackId: "t",
  startTick: 0,
  durationTicks: 480,
  pitch: 60,
  velocity: 0.8,
  ...extra,
});

describe("diff note fields", () => {
  test("vowel changes and clears round-trip", () => {
    const a = createScore({ tracks: [track], notes: [note({ vowel: "a" })] });
    const b = createScore({ tracks: [track], notes: [note({ vowel: "o" })] });
    const c = createScore({ tracks: [track], notes: [note()] });
    expect(diffScores(a, b)).toEqual([
      { type: "updateNote", noteId: "n", patch: { vowel: "o" } },
    ]);
    roundTrip(a, b);
    roundTrip(a, c);
    roundTrip(c, a);
  });

  test("0 and -0 are the same JSON value", () => {
    expect(deepEqual(0, -0)).toBe(true);
    expect(deepEqual([{ tick: -0, value: 1 }], [{ tick: 0, value: 1 }])).toBe(
      true,
    );
    const a = createScore({
      tracks: [{ ...track, volumeAutomation: [{ tick: -0, value: 0.5 }] }],
    });
    const reloaded = new TrackScore(JSON.parse(JSON.stringify(a.toJSON())));
    expect(diffScores(a, reloaded)).toEqual([]);
  });
});

describe("diff song-level order", () => {
  test("sections that forbid a meter change are cleared first", () => {
    const a = createScore({ sections: [{ name: "A", startBar: 0, bars: 2 }] });
    const b = createScore({
      time: { meter: [{ bar: 2, beatsPerBar: 3 }] },
    });
    roundTrip(a, b);
    roundTrip(b, a);
  });

  test("a long fermata is cleared before the tempo slows", () => {
    const a = createScore({
      tempoBpm: 100,
      time: { fermatas: [{ tick: 0, beats: 20 }] },
    });
    const b = createScore({ tempoBpm: 20 });
    roundTrip(a, b);
    roundTrip(b, a);
  });

  test("a bar-0 meter change survives a song meter edit", () => {
    const time = { meter: [{ bar: 0, beatsPerBar: 7, beatUnit: 8 }] };
    const a = createScore({ beatsPerBar: 4, time });
    const b = createScore({ beatsPerBar: 3, time });
    roundTrip(a, b);
    roundTrip(b, a);
  });

  test("random valid pairs of song settings round-trip", () => {
    const random = rng(0x5eed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!;
    const make = (): TrackScore | undefined => {
      const bars = pick([1, 2, 4, 8]);
      const data: Record<string, unknown> = {
        tempoBpm: pick([20, 40, 90, 120, 240]),
        beatsPerBar: pick([3, 4, 7]),
        bars,
        key: pick([null, "C major", "A minor"]),
        tracks: [track],
        notes: [note({ pitch: pick([48, 60, 72]) })],
      };
      const time: Record<string, unknown> = {};
      if (random() < 0.5)
        time.tempo = [{ tick: 480 * pick([1, 2, 4]), bpm: pick([30, 140]) }];
      if (random() < 0.4)
        time.meter = [
          { bar: pick([0, 1, 2]), beatsPerBar: pick([3, 5]), beatUnit: 8 },
        ];
      if (random() < 0.4)
        time.fermatas = [{ tick: 480 * pick([0, 1, 3]), beats: pick([1, 8]) }];
      if (Object.keys(time).length > 0) data.time = time;
      if (random() < 0.5) {
        const first = Math.min(pick([1, 2]), bars);
        data.sections =
          first < bars
            ? [
                { name: "A", startBar: 0, bars: first },
                { name: "B", startBar: first, bars: bars - first },
              ]
            : [{ name: "A", startBar: 0, bars: first }];
        if (random() < 0.5) data.form = [{ section: "A", repeat: 2 }];
        if (random() < 0.3) data.loopSection = "A";
      }
      try {
        return createScore(data as TrackScoreData);
      } catch {
        return undefined;
      }
    };
    let pairs = 0;
    for (let i = 0; i < 4000 && pairs < 600; i += 1) {
      const a = make();
      const b = make();
      if (!a || !b) continue;
      pairs += 1;
      roundTrip(a, b);
    }
    expect(pairs).toBe(600);
  });
});
