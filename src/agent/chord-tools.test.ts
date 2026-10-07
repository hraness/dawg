import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "keys",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const score = createScore({
  key: "A minor",
  tracks: [
    { id: "keys", instrument: "piano" },
    { id: "bass", instrument: "bass" },
  ],
});

describe("chord tools", () => {
  test("suggest_progression voices a preset in the song key", async () => {
    const plan = tool("suggest_progression").plan(
      { style: "aeolian" },
      context(score),
    );
    expect(plan.kind).toBe("action");
    if (plan.kind !== "action") return;
    const result = JSON.parse((await plan.run({})).content);
    expect(result.key).toBe("A minor");
    expect(result.chords.map((c: { name: string }) => c.name)).toEqual([
      "Am",
      "F",
      "C",
      "G",
    ]);
    expect(result.chords[0].roman).toBe("i");
    expect(result.chords[1].bass).toBe("F2");
  });

  test("suggest_progression is deterministic by seed", async () => {
    const run = async (seed: number) => {
      const plan = tool("suggest_progression").plan(
        { key: "C major", length: 8, style: "jazz", seed },
        context(score),
      );
      return plan.kind === "action" ? (await plan.run({})).content : "";
    };
    expect(await run(4)).toBe(await run(4));
  });

  test("write_chords writes voice-led chords and bass", () => {
    const plan = tool("write_chords").plan(
      {
        key: "C major",
        chords: ["ii7", "V7", "Imaj7"],
        bassTrackId: "bass",
      },
      context(score),
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    let next = score;
    for (const operation of plan.operations)
      next = applyScoreOperation(next, operation);
    const keys = next.notes.filter((n) => n.trackId === "keys");
    const bass = next.notes.filter((n) => n.trackId === "bass");
    expect(keys).toHaveLength(12);
    expect(bass.map((n) => n.pitch)).toEqual([38, 43, 36]);
    // One bar per chord by default.
    expect([...new Set(keys.map((n) => n.startTick))]).toEqual([
      0,
      4 * 480,
      8 * 480,
    ]);
    expect(plan.summary).toContain("Dm7 G7 Cmaj7");
  });

  test("write_chords arpeggiates on the grid", () => {
    const plan = tool("write_chords").plan(
      { chords: ["Am"], perform: "arp-up", rate: 0.5, beatsPerChord: 2 },
      context(score),
    );
    if (plan.kind !== "score") throw new Error("expected score");
    const starts = plan.operations.map((op) =>
      op.type === "addNote" ? op.note.startTick : -1,
    );
    expect(starts).toEqual([0, 240, 480, 720]);
  });

  test("write_chords plays a rhythm pattern and an Orchid bass mode", () => {
    const plan = tool("write_chords").plan(
      {
        chords: ["C"],
        perform: "pattern",
        pattern: "offbeat",
        bassMode: "solo",
        bassTrackId: "bass",
      },
      context(score),
    );
    if (plan.kind !== "score") throw new Error("expected score");
    const notes = plan.operations.flatMap((op) =>
      op.type === "addNote" ? [op.note] : [],
    );
    // Solo: bass only, no treble pattern.
    expect(notes.map((n) => [n.trackId, n.pitch])).toEqual([["bass", 36]]);
    const pattern = tool("write_chords").plan(
      { chords: ["C"], perform: "pattern", pattern: "offbeat" },
      context(score),
    );
    if (pattern.kind !== "score") throw new Error("expected score");
    const starts = [
      ...new Set(
        pattern.operations.map((op) =>
          op.type === "addNote" ? op.note.startTick : -1,
        ),
      ),
    ];
    expect(starts).toEqual([240, 720, 1200, 1680]);
    expect(() =>
      tool("write_chords").plan(
        { chords: ["C"], perform: "pattern", pattern: "waltz" },
        context(score),
      ),
    ).toThrow(/pattern/);
    expect(() =>
      tool("write_chords").plan(
        { chords: ["C"], bassMode: "loud" },
        context(score),
      ),
    ).toThrow(/bassMode/);
  });

  test("rejects bad arguments", () => {
    expect(() =>
      tool("write_chords").plan({ chords: ["Q7"] }, context(score)),
    ).toThrow(/chords\[0\]/);
    expect(() =>
      tool("write_chords").plan(
        { trackId: "nope", chords: ["I"] },
        context(score),
      ),
    ).toThrow(/unknown track/);
    expect(() =>
      tool("suggest_progression").plan({ key: "H major" }, context(score)),
    ).toThrow(/key/);
    expect(() =>
      tool("write_chords").plan(
        {
          chords: Array<string>(32).fill("I"),
          perform: "arp-up",
          rate: 0.0625,
          octaves: 4,
          beatsPerChord: 8,
        },
        context(score),
      ),
    ).toThrow(/exceed/);
  });
});
