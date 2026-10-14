import { describe, expect, test } from "bun:test";
import { applyScoreOperations as fromDiff } from "./diff.ts";
import {
  applyScoreOperation,
  applyScoreOperations,
  createScore,
  SCORE_LIMITS,
  withNoteCap,
  type NoteInput,
  type ScoreOperation,
  type TrackScore,
} from "./score.ts";

const note = (id: string, trackId = "a", pitch = 60): NoteInput => ({
  id,
  trackId,
  pitch,
  startTick: 0,
  durationTicks: 120,
  velocity: 0.8,
});
const add = (id: string, trackId = "a"): ScoreOperation => ({
  type: "addNote",
  note: note(id, trackId),
});
const initial = () =>
  createScore({ tracks: [{ id: "a", name: "a", instrument: "sine" }] });
const outcome = (run: () => TrackScore) => {
  try {
    return { score: run().toJSON() };
  } catch (error) {
    const e = error as Error & { code?: string };
    return { error: { name: e.name, message: e.message, code: e.code } };
  }
};
function equivalent(score: TrackScore, operations: ScoreOperation[]) {
  const before = JSON.stringify(score.toJSON());
  expect(outcome(() => applyScoreOperations(score, operations))).toEqual(
    outcome(() => operations.reduce(applyScoreOperation, score)),
  );
  expect(JSON.stringify(score.toJSON())).toBe(before);
}

describe("transactional score operations", () => {
  test("keeps the diff API and immutable canonical order", () => {
    expect(fromDiff).toBe(applyScoreOperations);
    const score = initial();
    const operations: ScoreOperation[] = [
      add("Z"),
      add("é"),
      add("é"),
      add("b"),
      {
        type: "updateNote",
        noteId: "Z",
        patch: { startTick: 20, lyric: "hi" },
      },
      { type: "updateNote", noteId: "Z", patch: { lyric: null } },
      { type: "removeNote", noteId: "b" },
      add("b"),
    ];
    equivalent(score, operations);
    const next = applyScoreOperations(score, operations);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.notes)).toBe(true);
    expect(next.notes.every(Object.isFrozen)).toBe(true);
    expect(score.notes).toHaveLength(0);
    expect(applyScoreOperations(score, [])).toBe(score);
    expect(
      applyScoreOperations(score, [
        { type: "removeNote", noteId: "missing" },
        { type: "clearTrack", trackId: "missing" },
      ]),
    ).toBe(score);
  });

  test("flushes at track and song edits without reordering", () => {
    equivalent(initial(), [
      add("é"),
      add("é"),
      { type: "updateNote", noteId: "é", patch: { startTick: 120 } },
      { type: "updateNote", noteId: "é", patch: { startTick: 0 } },
    ]);
    equivalent(initial(), [
      add("before"),
      { type: "addTrack", track: { id: "b", name: "b", instrument: "saw" } },
      add("b1", "b"),
      { type: "setBars", bars: 8 },
      { type: "updateNote", noteId: "b1", patch: { startTick: 1440 } },
      { type: "removeTrack", trackId: "a" },
      { type: "addTrack", track: { id: "a", name: "new", instrument: "sine" } },
      add("before"),
      { type: "clearTrack", trackId: "b" },
      add("b1", "b"),
      { type: "setTempo", tempoBpm: 133 },
    ]);
    // A later track addition/removal cannot repair an earlier invalid edit.
    for (const ops of [
      [
        add("orphan", "b"),
        { type: "addTrack", track: { id: "b", name: "b", instrument: "sine" } },
      ],
      [
        add("duplicate"),
        add("duplicate"),
        { type: "removeNote", noteId: "duplicate" },
      ],
      [
        add("ok"),
        { type: "updateNote", noteId: "ok", patch: { pitch: 999 } },
        { type: "updateNote", noteId: "ok", patch: { pitch: 60 } },
      ],
      [add("ok"), { type: "removeTrack", trackId: "a" }, add("orphan")],
      [
        add("ok"),
        { type: "updateNote", noteId: "missing", patch: { pitch: 60 } },
      ],
      [add("ok"), { type: "removeNote", noteId: "" }],
    ] as ScoreOperation[][])
      equivalent(initial(), ops);
  });

  test("checks intermediate caps before a later removal and preserves raised-cap behavior", () => {
    const score = createScore({
      ...initial().toJSON(),
      notes: Array.from({ length: SCORE_LIMITS.maxNotes }, (_, i) =>
        note(`n${i}`),
      ),
    });
    equivalent(score, [add("overflow"), { type: "removeNote", noteId: "n0" }]);
    equivalent(score, [
      { type: "removeNote", noteId: "n0" },
      add("replacement"),
    ]);
    const raised = withNoteCap(SCORE_LIMITS.maxNotes + 2, () =>
      createScore({
        ...score.toJSON(),
        notes: [...score.notes, note("extra1"), note("extra2")],
      }),
    );
    equivalent(raised, [
      { type: "removeNote", noteId: "extra1" },
      { type: "removeNote", noteId: "extra2" },
    ]);
    withNoteCap(SCORE_LIMITS.maxNotes + 2, () => {
      equivalent(raised, [
        { type: "removeNote", noteId: "extra1" },
        { type: "removeNote", noteId: "extra2" },
      ]);
      equivalent(raised, [add("overflow")]);
    });
  });

  test("preserves boundary behavior for foreign patches and validation order", () => {
    const score = applyScoreOperations(initial(), [add("n1"), add("n2")]);
    for (const patch of [
      { id: "renamed" },
      { id: "n2" },
      { trackId: "missing" },
      { pitch: 999 },
      { durationTicks: 0 },
      null,
    ])
      equivalent(score, [
        {
          type: "updateNote",
          noteId: "n1",
          patch,
        } as unknown as ScoreOperation,
      ]);
    const seen: string[] = [];
    function* operations(): Generator<ScoreOperation> {
      seen.push("first");
      yield { type: "addNote", note: note("bad", "missing") };
      seen.push("second");
      throw new Error("must not reach a later validation");
    }
    expect(() => applyScoreOperations(score, operations())).toThrow(
      /does not exist/,
    );
    expect(seen).toEqual(["first"]);
  });

  test("matches sequential reduction for seeded mixed edits, including failures", () => {
    let seed = 431;
    const rand = (n: number) =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
    for (let trial = 0; trial < 100; trial += 1) {
      const operations: ScoreOperation[] = [];
      for (let i = 0; i < 32; i += 1) {
        const id = `n${rand(8)}`;
        switch (rand(6)) {
          case 0:
            operations.push(add(id));
            break;
          case 1:
            operations.push({ type: "removeNote", noteId: id });
            break;
          case 2:
            operations.push({
              type: "updateNote",
              noteId: id,
              patch: { pitch: rand(140) },
            });
            break;
          case 3:
            operations.push({ type: "clearTrack", trackId: "a" });
            break;
          case 4:
            operations.push({ type: "setTempo", tempoBpm: 80 + rand(80) });
            break;
          default:
            operations.push({ type: "setBars", bars: 1 + rand(16) });
        }
      }
      equivalent(initial(), operations);
    }
  });
});
