import { describe, expect, test } from "bun:test";
import { createScore, type ScoreOperation } from "../../core/score.ts";
import { diffRewind } from "./delta.ts";
import { compositionAt, rebaseOperations } from "./rebase.ts";

const base = createScore({
  tracks: [
    { id: "a", name: "a", instrument: "sine" },
    { id: "b", name: "b", instrument: "sine" },
  ],
  notes: [
    {
      id: "n1",
      trackId: "a",
      startTick: 0,
      durationTicks: 120,
      pitch: 60,
      velocity: 0.8,
    },
  ],
});
const note = (id: string, trackId = "a"): ScoreOperation => ({
  type: "addNote",
  note: {
    id,
    trackId,
    startTick: 240,
    durationTicks: 120,
    pitch: 62,
    velocity: 0.8,
  },
});

describe("rebaseOperations", () => {
  test("replays independent edits on the newer score", () => {
    const current = base.withTempo(140);
    const result = rebaseOperations(base, current, [
      note("n2"),
      note("n3", "b"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.tempoBpm).toBe(140);
      expect(result.next.notes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    }
  });

  test("refuses edits to anything that changed since the base", () => {
    const tempo = base.withTempo(140);
    expect(
      rebaseOperations(base, tempo, [{ type: "setTempo", tempoBpm: 100 }]),
    ).toMatchObject({ ok: false, reason: "tempo changed" });
    const withNote = rebaseOperations(base, base, [note("n2")]);
    if (!withNote.ok) throw new Error("expected ok");
    expect(
      rebaseOperations(base, withNote.next, [
        { type: "clearTrack", trackId: "a" },
      ]),
    ).toMatchObject({ ok: false, reason: "track a changed" });
    expect(rebaseOperations(base, withNote.next, [note("n2")])).toMatchObject({
      ok: false,
      reason: "note n2 was added concurrently",
    });
    // Operations on things the intent itself created are not conflicts.
    expect(
      rebaseOperations(base, withNote.next, [
        note("n4", "b"),
        { type: "updateNote", noteId: "n4", patch: { pitch: 64 } },
      ]).ok,
    ).toBe(true);
  });

  test("compositionAt rewinds through well-formed log entries only", () => {
    const record = {
      composition: { v: 3 },
      events: [
        { revision: 1, rewind: diffRewind({ v: 0 }, { v: 1 }) },
        { revision: 2, rewind: diffRewind({ v: 1 }, { v: 2 }) },
        { revision: 3, rewind: diffRewind({ v: 2 }, { v: 3 }) },
      ],
    };
    expect(compositionAt(record, 0)).toEqual({ v: 0 });
    expect(compositionAt(record, 2)).toEqual({ v: 2 });
    expect(compositionAt(record, 3)).toBeUndefined();
    expect(compositionAt(record, 5)).toBeUndefined();
    // A compacted (rewind-less) event blocks everything older than it.
    const compacted = {
      ...record,
      events: [{ revision: 1 }, ...record.events.slice(1)],
    };
    expect(compositionAt(compacted, 1)).toEqual({ v: 1 });
    expect(compositionAt(compacted, 0)).toBeUndefined();
    expect(
      compositionAt(
        { composition: 1, events: [{ revision: 7, rewind: { set: 0 } }] },
        0,
      ),
    ).toBeUndefined();
  });
});

describe("rebaseOperations: project-file operations", () => {
  test("setKey, setMeter, removeTrack and moveTrack replay or conflict", () => {
    const ops: ScoreOperation[] = [
      { type: "setKey", key: "A minor" },
      { type: "setMeter", beatsPerBar: 3 },
      { type: "moveTrack", trackId: "b", index: 0 },
      { type: "removeTrack", trackId: "a" },
    ];
    const replayed = rebaseOperations(base, base.withTempo(90), ops);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.next.key).toBe("A minor");
      expect(replayed.next.beatsPerBar).toBe(3);
      expect(replayed.next.tracks.map((t) => t.id)).toEqual(["b"]);
      expect(replayed.next.notes).toEqual([]);
    }
    expect(
      rebaseOperations(base, base.withKey("C"), [
        { type: "setKey", key: null },
      ]),
    ).toMatchObject({ ok: false, reason: "key changed" });
    expect(
      rebaseOperations(base, base.withMeter(5), [
        { type: "setMeter", beatsPerBar: 3 },
      ]),
    ).toMatchObject({ ok: false, reason: "meter changed" });
    const added = rebaseOperations(base, base, [note("n9")]);
    if (!added.ok) throw new Error("expected ok");
    expect(
      rebaseOperations(base, added.next, [
        { type: "removeTrack", trackId: "a" },
      ]),
    ).toMatchObject({ ok: false, reason: "track a changed" });
    const moved = rebaseOperations(base, base, [
      { type: "moveTrack", trackId: "b", index: 0 },
    ]);
    if (!moved.ok) throw new Error("expected ok");
    expect(
      rebaseOperations(base, moved.next, [
        { type: "moveTrack", trackId: "a", index: 1 },
      ]),
    ).toMatchObject({ ok: false, reason: "track order changed" });
  });
});

describe("rebaseOperations: per (track, property) conflicts", () => {
  const patch = (
    trackId: string,
    value: Record<string, unknown>,
  ): ScoreOperation =>
    ({ type: "updateTrack", trackId, patch: value }) as ScoreOperation;
  const after = (ops: ScoreOperation[]) => {
    const result = rebaseOperations(base, base, ops);
    if (!result.ok) throw new Error(result.reason);
    return result.next;
  };

  test("different properties of one track both land", () => {
    const theirs = after([patch("a", { volume: 0.3 })]);
    const result = rebaseOperations(base, theirs, [patch("a", { pan: -0.5 })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const track = result.next.tracks.find((t) => t.id === "a")!;
      expect(track.volume).toBe(0.3);
      expect(track.pan).toBe(-0.5);
    }
  });

  test("the same property conflicts and names it", () => {
    const theirs = after([patch("a", { volume: 0.3 })]);
    expect(
      rebaseOperations(base, theirs, [patch("a", { volume: 0.5 })]),
    ).toMatchObject({ ok: false, reason: "a volume changed" });
  });

  test("automation conflicts per lane; a removed track always conflicts", () => {
    const lane = (parameter: string, value: number): ScoreOperation =>
      ({
        type: "setAutomation",
        trackId: "a",
        parameter,
        points: [{ tick: 0, value }],
      }) as ScoreOperation;
    const theirs = after([lane("volume", 0.2)]);
    expect(rebaseOperations(base, theirs, [lane("pan", 0.1)]).ok).toBe(true);
    expect(rebaseOperations(base, theirs, [lane("volume", 0.9)])).toMatchObject(
      { ok: false, reason: "a volume automation changed" },
    );
    const removed = after([{ type: "removeTrack", trackId: "b" }]);
    expect(
      rebaseOperations(base, removed, [patch("b", { pan: 0.2 })]),
    ).toMatchObject({ ok: false, reason: "track b was removed" });
  });
});
