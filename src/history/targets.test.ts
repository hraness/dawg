import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDb } from "./db.ts";
import { parseHistoryFilterWords } from "./filter.ts";
import { deriveTargets } from "./targets.ts";

/** Four 4/4 bars at 480 ticks per beat: a bar is 1920 ticks. */
function song(lyric?: (index: number) => string | undefined): unknown {
  return {
    ticksPerBeat: 480,
    beatsPerBar: 4,
    tracks: [
      { id: "lead", instrument: "sing" },
      { id: "bass", instrument: "bass" },
    ],
    notes: [0, 1, 2, 3].map((index) => ({
      id: `n${index}`,
      trackId: "lead",
      startTick: index * 1920,
      durationTicks: 960,
      pitch: 60,
      velocity: 0.8,
      ...(lyric?.(index) !== undefined ? { lyric: lyric(index) } : {}),
    })),
  };
}

describe("history targets for lyrics and vox", () => {
  test("a lyric edit gives one lyrics target on its track over the touched bars", () => {
    const ops = [
      { type: "updateNote", noteId: "n1", patch: { lyric: "hel-" } },
      { type: "updateNote", noteId: "n2", patch: { lyric: "lo" } },
    ];
    const targets = deriveTargets(ops, song());
    const lyrics = targets.filter((t) => t.type === "lyrics");
    expect(lyrics).toEqual([
      { type: "lyrics", key: "lead", trackId: "lead", barFrom: 2, barTo: 3 },
    ]);
    // The ordinary track and bars targets are still there.
    expect(targets.some((t) => t.type === "track" && t.key === "lead")).toBe(
      true,
    );
    expect(targets.some((t) => t.type === "bars")).toBe(true);
  });

  test("a per-note vox patch and a lyric clear are lyric edits; a pitch edit is not", () => {
    const vox = deriveTargets(
      [{ type: "updateNote", noteId: "n0", patch: { vox: { ph: ["hh"] } } }],
      song(),
    );
    expect(vox.find((t) => t.type === "lyrics")).toMatchObject({
      key: "lead",
      barFrom: 1,
      barTo: 1,
    });
    const clear = deriveTargets(
      [{ type: "updateNote", noteId: "n3", patch: { lyric: null } }],
      song((i) => (i === 3 ? "la" : undefined)),
    );
    expect(clear.find((t) => t.type === "lyrics")).toMatchObject({
      barFrom: 4,
      barTo: 4,
    });
    const pitch = deriveTargets(
      [{ type: "updateNote", noteId: "n0", patch: { pitch: 62 } }],
      song(),
    );
    expect(pitch.some((t) => t.type === "lyrics")).toBe(false);
  });

  test("lyric edits are found by diffing when the event carries no ops", () => {
    const before = song();
    const after = song((i) => (i < 2 ? ["twin-", "kle"][i] : undefined));
    const lyrics = deriveTargets(undefined, before, after).filter(
      (t) => t.type === "lyrics",
    );
    expect(lyrics).toEqual([
      { type: "lyrics", key: "lead", trackId: "lead", barFrom: 1, barTo: 2 },
    ]);
  });

  test("removing or adding a sung note touches lyrics; a plain note does not", () => {
    const sung = song((i) => (i === 0 ? "la" : undefined));
    expect(
      deriveTargets([{ type: "removeNote", noteId: "n0" }], sung).some(
        (t) => t.type === "lyrics",
      ),
    ).toBe(true);
    expect(
      deriveTargets([{ type: "removeNote", noteId: "n1" }], sung).some(
        (t) => t.type === "lyrics",
      ),
    ).toBe(false);
    const added = deriveTargets(
      [
        {
          type: "addNote",
          note: {
            id: "x",
            trackId: "lead",
            startTick: 1920 * 2,
            durationTicks: 480,
            pitch: 60,
            velocity: 0.8,
            lyric: "oh",
          },
        },
      ],
      song(),
    );
    expect(added.find((t) => t.type === "lyrics")).toMatchObject({
      barFrom: 3,
      barTo: 3,
    });
  });

  test("a Track.vox change gives a vox target keyed by the track", () => {
    const targets = deriveTargets(
      [
        {
          type: "updateTrack",
          trackId: "lead",
          patch: { vox: { engine: "formant", voice: "formant:robot" } },
        },
      ],
      song(),
    );
    expect(targets).toContainEqual({
      type: "vox",
      key: "lead",
      trackId: "lead",
    });
    expect(targets.some((t) => t.type === "lyrics")).toBe(false);
  });

  test("`target lyrics` filters history rows by target type", async () => {
    const parsed = parseHistoryFilterWords(["target", "lyrics"], undefined);
    expect(parsed).toEqual({ filter: { target: "lyrics" } });
    expect(parseHistoryFilterWords(["--target", "nope"], undefined)).toEqual({
      error: expect.stringContaining("unknown target nope"),
    });
    const workspace = await mkdtemp(join(tmpdir(), "dawg-history-targets-"));
    const db = HistoryDb.open(workspace);
    try {
      const base = {
        sessionId: "s",
        kind: "edit" as const,
        actor: { kind: "human" as const },
      };
      db.append({
        ...base,
        rev: 1,
        atRev: 0,
        summary: "lyrics",
        ops: [{ type: "updateNote", noteId: "n0", patch: { lyric: "la" } }],
        targets: deriveTargets(
          [{ type: "updateNote", noteId: "n0", patch: { lyric: "la" } }],
          song(),
        ),
      });
      db.append({
        ...base,
        rev: 2,
        atRev: 1,
        summary: "voice",
        targets: deriveTargets(
          [{ type: "updateTrack", trackId: "lead", patch: { vox: {} } }],
          song(),
        ),
      });
      db.append({
        ...base,
        rev: 3,
        atRev: 2,
        summary: "pitch",
        targets: deriveTargets(
          [{ type: "updateNote", noteId: "n0", patch: { pitch: 61 } }],
          song(),
        ),
      });
      const summaries = (target: "lyrics" | "vox") =>
        db.query({ sessionId: "s", target }).rows.map((row) => row.summary);
      expect(summaries("lyrics")).toEqual(["lyrics"]);
      expect(summaries("vox")).toEqual(["voice"]);
    } finally {
      db.close();
    }
  });
});
