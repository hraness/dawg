/**
 * Score integrity: canonical id order, orphan notes, strict edits on
 * missing ids and track indexes, and the tick bound of the longest song.
 */
import { describe, expect, test } from "bun:test";
import { encodeLoop } from "./loop.ts";
import {
  applyScoreOperation,
  compareIds,
  createScore,
  moveTrack,
  removeNote,
  SCORE_LIMITS,
  ScoreValidationError,
  updateNote,
} from "./score.ts";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
const track = (id: string) => ({ id, name: id, instrument: "sine" });
const note = (id: string, trackId: string, extra = {}) => ({
  id,
  trackId,
  startTick: 0,
  durationTicks: 480,
  pitch: 60,
  velocity: 0.8,
  ...extra,
});

describe("compareIds", () => {
  test("printable ASCII keeps the pre-0.7 localeCompare order", () => {
    const random = rng(7);
    const alphabet =
      " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const word = () =>
      Array.from(
        { length: 1 + Math.floor(random() * 5) },
        () =>
          alphabet[Math.floor(random() * 12) * 8 + Math.floor(random() * 8)] ??
          "a",
      ).join("");
    for (let i = 0; i < 20_000; i += 1) {
      const a = word();
      const b = word();
      expect([a, b, sign(compareIds(a, b))]).toEqual([
        a,
        b,
        sign(a.localeCompare(b, "en-US")),
      ]);
    }
  });

  test("is a total order that keeps canonically equivalent ids apart", () => {
    const nfc = "é";
    const nfd = "é";
    expect(compareIds(nfc, nfd)).not.toBe(0);
    expect(sign(compareIds(nfc, nfd))).toBe(-sign(compareIds(nfd, nfc)));
    const ids = ["B", "a", "Cé", nfc, nfd, "z", "Z", "_x", "x-1", "x1"];
    for (const a of ids)
      for (const b of ids)
        for (const c of ids)
          if (compareIds(a, b) < 0 && compareIds(b, c) < 0)
            expect(compareIds(a, c)).toBeLessThan(0);
  });

  test("note order and the printed loop do not depend on input order", () => {
    const tracks = [track("t")];
    const notes = [note("é", "t"), note("é", "t"), note("B", "t")];
    const forward = createScore({ tracks, notes });
    const backward = createScore({ tracks, notes: [...notes].reverse() });
    expect(encodeLoop(backward)).toBe(encodeLoop(forward));
  });
});

describe("orphan notes and strict edits", () => {
  test("a note on a missing track is rejected", () => {
    expect(() =>
      createScore({ tracks: [track("t")], notes: [note("n", "zz")] }),
    ).toThrow(ScoreValidationError);
    expect(() =>
      createScore({ tracks: [track("t")] }).addNote(note("n", "zz")),
    ).toThrow(/does not exist/);
  });

  test("updateNote on an unknown id throws; removeNote stays idempotent", () => {
    const score = createScore({
      tracks: [track("t")],
      notes: [note("n", "t")],
    });
    expect(() => updateNote(score, "zz", { pitch: 61 })).toThrow(
      /unknown note/,
    );
    expect(() =>
      applyScoreOperation(score, {
        type: "updateNote",
        noteId: "zz",
        patch: { pitch: 61 },
      }),
    ).toThrow(ScoreValidationError);
    expect(removeNote(score, "zz")).toBe(score);
  });

  test("moveTrack rejects an index outside the track list", () => {
    const score = createScore({ tracks: [track("a"), track("b")] });
    expect(moveTrack(score, "a", 1).tracks.map((t) => t.id)).toEqual([
      "b",
      "a",
    ]);
    for (const index of [-1, 2, 9, 0.5])
      expect(() => moveTrack(score, "a", index)).toThrow(ScoreValidationError);
  });
});

describe("tick bound", () => {
  test("the last beat of the longest valid song holds a note", () => {
    const cases = [
      { beatsPerBar: 16, bars: 256 },
      { ticksPerBeat: 4096, bars: 256, beatsPerBar: 16 },
      {
        ticksPerBeat: 4096,
        bars: 256,
        beatsPerBar: 16,
        time: { meter: [{ bar: 0, beatsPerBar: 16, beatUnit: 1 }] },
      },
    ];
    for (const data of cases) {
      const score = createScore({ ...data, tracks: [track("t")] });
      const tpb = score.ticksPerBeat;
      const unit = data.time ? 1 : 4;
      const loopTicks = (score.bars * score.beatsPerBar * tpb * 4) / unit;
      const last = loopTicks - (tpb * 4) / unit;
      const next = score.addNote(
        note("end", "t", { startTick: last, durationTicks: (tpb * 4) / unit }),
      );
      expect(next.notes[0]!.startTick).toBe(last);
    }
    expect(Number(SCORE_LIMITS.maxTick)).toBe(256 * 16 * 4096 * 4);
  });

  test("a note may not end past the tick bound", () => {
    const score = createScore({ tracks: [track("t")] });
    expect(() =>
      score.addNote(
        note("n", "t", {
          startTick: SCORE_LIMITS.maxTick - 10,
          durationTicks: 11,
        }),
      ),
    ).toThrow(ScoreValidationError);
    expect(
      score.addNote(
        note("n", "t", {
          startTick: SCORE_LIMITS.maxTick - 10,
          durationTicks: 10,
        }),
      ).notes,
    ).toHaveLength(1);
  });
});

describe("patches", () => {
  const PATCH = {
    kind: "patch",
    role: "effect",
    name: "lp",
    nodes: [{ id: "lp", type: "onepole" }],
    cables: [
      { id: "a", from: "in.audio", to: "lp.in" },
      { id: "b", from: "lp.out", to: "out.audio" },
    ],
  };

  test("a score with patches round-trips through normalize", () => {
    const score = createScore({
      patches: {
        lp: PATCH,
        tone: {
          kind: "patch",
          name: "tone",
          nodes: [{ id: "osc", type: "osc" }],
          cables: [
            { id: "p", from: "voice.pitch", to: "osc.pitch" },
            { id: "o", from: "osc.out", to: "out.audio" },
          ],
        },
      },
      tracks: [
        { id: "kick", name: "kick", instrument: "drums" },
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: { kind: "patch", ref: "tone" },
          fxPatch: [{ ...PATCH, side: "kick" }],
        },
      ],
    } as never);
    const again = createScore(JSON.parse(JSON.stringify(score.toJSON())));
    expect(again.toJSON()).toEqual(score.toJSON());
  });

  test("removeTrack drops a dangling side", () => {
    const score = createScore({
      tracks: [
        { id: "kick", name: "kick", instrument: "drums" },
        {
          id: "pad",
          name: "pad",
          instrument: "sine",
          fxPatch: [{ ...PATCH, side: "kick" }],
        },
      ],
    } as never);
    const next = applyScoreOperation(score, {
      type: "removeTrack",
      trackId: "kick",
    });
    expect(next.tracks[0]!.fxPatch![0]).not.toHaveProperty("side");
  });

  test("library and node limits come from SCORE_LIMITS", () => {
    expect(SCORE_LIMITS.maxPatchNodes).toBe(64);
    expect(SCORE_LIMITS.maxPatches).toBe(32);
    const patches = Object.fromEntries(
      Array.from({ length: SCORE_LIMITS.maxPatches + 1 }, (_, i) => [
        `p${i}`,
        { ...PATCH, name: `p${i}` },
      ]),
    );
    expect(() => createScore({ patches } as never)).toThrow(
      ScoreValidationError,
    );
  });
});
