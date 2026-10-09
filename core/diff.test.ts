import { describe, expect, test } from "bun:test";
import {
  adoptNoteIds,
  applyScoreOperations,
  deepEqual,
  DiffError,
  diffScores,
} from "./diff.ts";
import {
  createScore,
  TrackScore,
  updateTrack,
  type NoteInput,
  type TrackInput,
} from "./score.ts";

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const TRACK_IDS = ["a", "b", "c", "d", "e"];
const NOTE_IDS = Array.from({ length: 12 }, (_, i) => `n${i}`);

function randomScore(random: () => number): TrackScore {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const chance = (p: number) => random() < p;
  const ids = TRACK_IDS.filter(() => chance(0.6)).sort(() => random() - 0.5);
  const tracks: TrackInput[] = ids.map((id) => {
    const sampler = chance(0.2);
    return {
      id,
      name: chance(0.3) ? `${id} renamed` : id,
      instrument: sampler ? "sampler" : pick(["sine", "bass", "kit", "piano"]),
      muted: chance(0.2),
      solo: chance(0.1),
      volume: pick([1, 0.5, 0.8]),
      pan: pick([0, -0.5, 0.25]),
      filter: chance(0.3)
        ? { cutoff: pick([800, 2000]), resonance: 0.2 }
        : null,
      delay: chance(0.2)
        ? { beats: 0.5, feedback: 0.3, mix: pick([0.2, 0.4]) }
        : null,
      reverb: chance(0.2) ? { mix: 0.2, size: 0.5 } : null,
      volumeAutomation: chance(0.3)
        ? [
            { tick: 0, value: 1 },
            { tick: 960, value: pick([0.5, 0.25]) },
          ]
        : [],
      panAutomation: chance(0.2) ? [{ tick: 480, value: 0.5 }] : [],
      filterAutomation: chance(0.2)
        ? [{ tick: 0, value: pick([500, 1000]) }]
        : [],
      ...(chance(0.3)
        ? {
            fx: {
              ...(chance(0.6) ? { distort: { drive: pick([2, 4]) } } : {}),
              ...(chance(0.6) ? { chorus: {} } : {}),
              tremolo: { depth: pick([0.3, 0.6]) },
            },
          }
        : {}),
      ...(chance(0.2)
        ? {
            fxAutomation: {
              "tremolo-depth": [{ tick: 0, value: pick([0.2, 0.8]) }],
            },
          }
        : {}),
      ...(sampler
        ? {
            sampler: {
              mode: pick(["oneshot", "keyed"] as const),
              voices: {
                kick: {
                  src: `tracks/${id}/samples/kick.wav`,
                  gain: pick([1, 0.5]),
                },
                ...(chance(0.5)
                  ? { snare: { src: `tracks/${id}/samples/sd.wav` } }
                  : {}),
              },
            },
          }
        : {}),
    };
  });
  const notes: NoteInput[] = ids.length
    ? NOTE_IDS.filter(() => chance(0.5)).map((id) => ({
        id,
        trackId: pick(ids),
        startTick: pick([0, 240, 480, 960]),
        durationTicks: pick([120, 240, 480]),
        pitch: pick([36, 38, 60, 64]),
        velocity: pick([0.8, 0.6]),
      }))
    : [];
  return createScore({
    tempoBpm: pick([120, 128]),
    beatsPerBar: pick([4, 3]),
    bars: pick([4, 8]),
    key: pick([null, "A minor", "C major"]),
    tracks,
    notes,
  });
}

describe("diffScores", () => {
  test("apply(diff(a, b), a) deep-equals b for random score pairs", () => {
    const random = rng(7);
    let total = 0;
    for (let round = 0; round < 300; round += 1) {
      const a = randomScore(random);
      const b = randomScore(random);
      const ops = diffScores(a, b);
      total += ops.length;
      const result = applyScoreOperations(a, ops);
      expect(result.toJSON()).toEqual(b.toJSON());
      // Minimal: no operation is a no-op and each note/track is touched once per kind.
      const keys = ops.map((op) =>
        "noteId" in op
          ? `${op.type}:${op.noteId}`
          : "note" in op
            ? `${op.type}:${op.note.id}`
            : "trackId" in op
              ? `${op.type}:${op.trackId}`
              : "track" in op
                ? `${op.type}:${op.track.id}`
                : op.type,
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(total).toBeGreaterThan(300);
  });

  test("equal scores diff to nothing and ticksPerBeat mismatches are errors", () => {
    const a = randomScore(rng(3));
    expect(diffScores(a, a)).toEqual([]);
    expect(diffScores(a, createScore(a.toJSON()))).toEqual([]);
    expect(() => diffScores(a, createScore({ ticksPerBeat: 96 }))).toThrow(
      DiffError,
    );
  });

  test("a note moved to another track is removed and re-added", () => {
    const a = createScore({
      tracks: [{ id: "a" }, { id: "b" }],
      notes: [
        {
          id: "n",
          trackId: "a",
          startTick: 0,
          durationTicks: 120,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    const b = createScore({
      tracks: [{ id: "a" }, { id: "b" }],
      notes: [
        {
          id: "n",
          trackId: "b",
          startTick: 0,
          durationTicks: 120,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    expect(diffScores(a, b).map((op) => op.type)).toEqual([
      "removeNote",
      "addNote",
    ]);
  });

  test("ordering: settings, removals, additions, moves, patches, note edits", () => {
    const a = createScore({
      tracks: [{ id: "a" }, { id: "b" }, { id: "c" }],
      notes: [
        {
          id: "n1",
          trackId: "a",
          startTick: 0,
          durationTicks: 120,
          pitch: 60,
          velocity: 0.8,
        },
        {
          id: "n2",
          trackId: "c",
          startTick: 0,
          durationTicks: 120,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    const b = createScore({
      tempoBpm: 100,
      tracks: [{ id: "d" }, { id: "b", volume: 0.5 }, { id: "a" }],
      notes: [
        {
          id: "n1",
          trackId: "a",
          startTick: 0,
          durationTicks: 240,
          pitch: 60,
          velocity: 0.8,
        },
        {
          id: "n3",
          trackId: "d",
          startTick: 0,
          durationTicks: 120,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    expect(diffScores(a, b).map((op) => op.type)).toEqual([
      "setTempo",
      "removeTrack",
      "addTrack",
      "moveTrack",
      "moveTrack",
      "updateTrack",
      "updateNote",
      "addNote",
    ]);
  });
});

describe("adoptNoteIds", () => {
  const current = createScore({
    tracks: [{ id: "a" }],
    notes: [
      {
        id: "tui-1",
        trackId: "a",
        startTick: 0,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
      },
      {
        id: "tui-2",
        trackId: "a",
        startTick: 480,
        durationTicks: 480,
        pitch: 62,
        velocity: 0.8,
      },
    ],
  });

  test("keeps session ids for notes with the same content, updates same-position notes", () => {
    const evaluated = createScore({
      tracks: [{ id: "a" }],
      notes: [
        {
          id: "n-aaaa",
          trackId: "a",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
        },
        {
          id: "n-bbbb",
          trackId: "a",
          startTick: 480,
          durationTicks: 240,
          pitch: 62,
          velocity: 0.5,
        },
        {
          id: "n-cccc",
          trackId: "a",
          startTick: 960,
          durationTicks: 480,
          pitch: 64,
          velocity: 0.8,
        },
      ],
    });
    const adopted = adoptNoteIds(current, evaluated);
    expect(adopted.notes.map((n) => n.id)).toEqual([
      "tui-1",
      "tui-2",
      "n-cccc",
    ]);
    expect(diffScores(current, adopted).map((op) => op.type)).toEqual([
      "updateNote",
      "addNote",
    ]);
  });

  test("never produces duplicate ids", () => {
    const evaluated = createScore({
      tracks: [{ id: "a" }],
      notes: [
        {
          id: "x",
          trackId: "a",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
        },
        {
          id: "tui-1",
          trackId: "a",
          startTick: 960,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    const adopted = adoptNoteIds(current, evaluated);
    expect(new Set(adopted.notes.map((n) => n.id)).size).toBe(2);
  });

  test("deepEqual ignores undefined-valued keys", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

test("a modal change diffs to one updateTrack carrying the modal field", () => {
  const a = createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "m", name: "m", instrument: "modal", modal: {} }],
    notes: [],
  } as never);
  const b = updateTrack(a, "m", { modal: { preset: "vibes", ring: 2 } });
  const ops = diffScores(a, b);
  expect(ops).toEqual([
    {
      type: "updateTrack",
      trackId: "m",
      patch: { modal: { preset: "vibes", ring: 2 } },
    },
  ]);
  expect(applyScoreOperations(a, ops).tracks[0]!.modal).toEqual(
    b.tracks[0]!.modal,
  );
});

test("a vocoder change and its removal survive a diff round trip", () => {
  const a = createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      { id: "v", name: "v", instrument: "sine" },
      { id: "c", name: "c", instrument: "saw" },
    ],
    notes: [],
  } as never);
  const b = updateTrack(a, "c", { vocoder: { src: "v", preset: "robot" } });
  const ops = diffScores(a, b);
  expect(applyScoreOperations(a, ops).tracks[1]!.vocoder).toEqual(
    b.tracks[1]!.vocoder,
  );
  const back = applyScoreOperations(b, diffScores(b, a));
  expect(back.tracks[1]!.vocoder).toBeUndefined();
});

test("autotune, vocoder and note drift round-trip through diff and apply", () => {
  const a = createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      { id: "v", name: "v", instrument: "vocal" },
      { id: "c", name: "c", instrument: "vocoder" },
    ],
    notes: [
      {
        id: "n0",
        trackId: "v",
        startTick: 0,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
      },
    ],
  } as never);
  let b = updateTrack(a, "v", { autotune: { preset: "hard" } } as never);
  b = updateTrack(b, "c", { vocoder: { src: "v" } } as never);
  const json = structuredClone(b.toJSON()) as unknown as {
    notes: Array<Record<string, unknown>>;
  };
  json.notes[0] = { ...json.notes[0], drift: 0.5 };
  const c = createScore(json as never);
  expect(c.notes[0]!.drift).toBe(0.5);
  const ops = diffScores(a, c);
  expect(applyScoreOperations(a, ops).toJSON()).toEqual(c.toJSON());
  const back = diffScores(c, a);
  expect(applyScoreOperations(c, back).toJSON()).toEqual(a.toJSON());
});
