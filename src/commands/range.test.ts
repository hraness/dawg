import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { commandParses } from "./parses.ts";
import {
  applyRangeCommand,
  parseRangeCommand,
  type RangeClipboard,
} from "./range.ts";

const BAR = 4 * 480;

function song(): TrackScore {
  return createScore({
    bars: 8,
    tracks: [
      {
        id: "bass",
        name: "bass",
        instrument: "saw",
        panAutomation: [
          { tick: 0, value: 0 },
          { tick: 4 * BAR, value: 1 },
        ],
      },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
    notes: Array.from({ length: 8 }, (_, bar) => ({
      id: `b${bar + 1}`,
      trackId: "bass",
      pitch: 40 + bar,
      startTick: bar * BAR,
      durationTicks: 480,
      velocity: 0.8,
    })),
    sections: [
      { name: "verse", startBar: 0, bars: 4 },
      { name: "chorus", startBar: 4, bars: 4 },
    ],
    time: { tempo: [{ tick: 4 * BAR, bpm: 140 }] },
  } as never);
}

function run(score: TrackScore, line: string, clipboard?: RangeClipboard) {
  const command = parseRangeCommand(line, score);
  if (!command) throw new Error(`did not parse: ${line}`);
  return applyRangeCommand(
    score,
    { trackId: "bass", playheadBar: 0, ...(clipboard ? { clipboard } : {}) },
    command,
  );
}

const bassBars = (score: TrackScore) =>
  score.notes
    .filter((note) => note.trackId === "bass")
    .map((note) => [note.startTick / BAR, note.pitch])
    .sort((a, b) => a[0]! - b[0]!);

describe("range grammar", () => {
  test("parses the typed forms", () => {
    const score = song();
    for (const line of [
      "copy bass 5-6 to 7 x2",
      "copy all chorus to 1 insert",
      "copy 1-2 to 3 merge",
      "copy bass 1-2",
      "/copy bass 1-2 to 3",
      "move bass 5-6 to 1",
      "move all verse to 5 insert",
      "clear bass 5-6",
      "clear all chorus",
      "reverse bass 1-2",
      "reverse",
      "paste at 3",
      "paste at 3 x2 merge",
      "bars insert 2 at 3",
      "bars remove 3-4",
      "loop next",
      "loop prev",
      "jump 5",
      "jump 5.3",
      "jump chorus",
    ])
      expect(parseRangeCommand(line, score)?.type, line).not.toBe(
        "range-usage",
      );
  });

  test("leaves other commands alone", () => {
    const score = song();
    for (const line of [
      "clear",
      "clear hat",
      "clear volume automation",
      "move n1 to 2",
      "bars 8",
      "loop 5-6",
      "loop off",
      "copy that riff please",
    ])
      expect(parseRangeCommand(line, score), line).toBeUndefined();
  });

  test("a known verb with bad words answers with its usage card", () => {
    const score = song();
    for (const line of [
      "copy bass 5-6 to",
      "move bass 5-6",
      "move bass 5-6 to 9 x2",
      "bars insert two at 3",
      "bars insert 2",
      "jump nowhere",
    ]) {
      const command = parseRangeCommand(line, score);
      expect(command?.type, line).toBe("range-usage");
      expect(commandParses(line, score), line).toBe(true);
    }
  });
});

describe("range commands", () => {
  test("copy x2 tiles and grows the song", () => {
    const result = run(song(), "copy bass 7-8 to 9 x2");
    expect(result.ok).toBe(true);
    expect(result.next!.bars).toBe(12);
    expect(
      bassBars(result.next!)
        .slice(8)
        .map(([, p]) => p),
    ).toEqual([46, 47, 46, 47]);
    expect(result.message).toContain("bass");
  });

  test("move empties the source; clear keeps the bars", () => {
    const moved = run(song(), "move bass 1 to 8").next!;
    expect(bassBars(moved).find(([bar]) => bar === 0)).toBeUndefined();
    expect(bassBars(moved).find(([bar]) => bar === 7)?.[1]).toBe(40);
    const cleared = run(song(), "clear bass chorus").next!;
    expect(cleared.bars).toBe(8);
    expect(bassBars(cleared).map(([bar]) => bar)).toEqual([0, 1, 2, 3]);
  });

  test("copy without to fills the clipboard; paste lays it down", () => {
    const score = song();
    const copied = run(score, "copy bass 1-2");
    expect(copied.ok).toBe(true);
    expect(copied.next).toBeUndefined();
    const clipboard = copied.clipboard!;
    expect(clipboard).toBeDefined();
    const pasted = run(score, "paste at 7", clipboard).next!;
    expect(
      bassBars(pasted)
        .slice(6)
        .map(([, p]) => p),
    ).toEqual([40, 41]);
    expect(run(score, "paste at 7").ok).toBe(false);
  });

  test("bars insert shifts sections, notes, automation and tempo points", () => {
    const next = run(song(), "bars insert 2 at 3").next!;
    expect(next.bars).toBe(10);
    expect(next.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["verse", 0, 6],
      ["chorus", 6, 4],
    ]);
    expect(bassBars(next).map(([bar]) => bar)).toEqual([
      0, 1, 4, 5, 6, 7, 8, 9,
    ]);
    const bass = next.tracks.find((track) => track.id === "bass")!;
    // The curve's later point moves with its bar; the gap holds the value.
    expect(bass.panAutomation?.at(-1)).toEqual({ tick: 6 * BAR, value: 1 });
    expect(next.time?.tempo?.map((point) => point.tick / BAR)).toEqual([6]);
    const back = run(next, "bars remove 3-4").next!;
    expect(bassBars(back)).toEqual(bassBars(song()));
  });

  test("loop next steps the loop range; jump answers a position", () => {
    const looped = song().withLoop({ startBar: 0, bars: 2 });
    const stepped = run(looped, "loop next").next!;
    expect(stepped.loop).toEqual({ startBar: 2, bars: 2 });
    expect(run(song(), "loop next").ok).toBe(false);
    const jump = run(song(), "jump chorus");
    expect(jump.ok).toBe(true);
  });

  test("a range past the song is refused, not thrown", () => {
    const result = run(song(), "copy bass 9-12 to 1");
    expect(result.ok).toBe(false);
  });
});
