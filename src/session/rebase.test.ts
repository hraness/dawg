import { describe, expect, test } from "bun:test";
import { createScore, type ScoreOperation } from "../../core/score.ts";
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

  test("compositionAt trusts only well-formed log entries", () => {
    const events = [
      { revision: 1, payload: { before: "r0" } },
      { revision: 2, payload: {} },
    ];
    expect(compositionAt(events, 0)).toBe("r0");
    expect(compositionAt(events, 1)).toBeUndefined();
    expect(compositionAt(events, 5)).toBeUndefined();
    expect(
      compositionAt([{ revision: 7, payload: { before: 1 } }], 0),
    ).toBeUndefined();
  });
});
