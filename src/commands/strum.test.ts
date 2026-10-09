import { describe, expect, test } from "bun:test";
import { addTrack, createScore } from "../../core/score.ts";
import { makeChord } from "../../core/chords.ts";
import {
  applyGuitarCommand,
  applyStrumCommand,
  detectChord,
  parseGuitarCommand,
  parseOpenStrings,
  parseStrumCommand,
} from "./strum.ts";

const base = () =>
  addTrack(createScore({ tempoBpm: 120, key: "G major" }), {
    id: "gtr",
    name: "gtr",
    instrument: "jangle",
  });
const ids = (index: number) => `n${index}`;

describe("guitar command", () => {
  test("parses names, notes and fields", () => {
    expect(parseGuitarCommand("guitar tune dadgad")).toEqual({
      type: "guitar-set",
      patch: { tune: "dadgad" },
    });
    expect(parseOpenStrings("D A D G A D".split(" "))).toEqual([
      38, 45, 50, 55, 57, 62,
    ]);
    expect(parseOpenStrings("E2 A2 D3 G3 B3 E4".split(" "))).toEqual([
      40, 45, 50, 55, 59, 64,
    ]);
    expect(parseGuitarCommand("guitar capo 2")).toEqual({
      type: "guitar-set",
      patch: { capo: 2 },
    });
    expect(parseGuitarCommand("guitarist")).toBeUndefined();
    expect(parseGuitarCommand("guitar banjo")?.type).toBe("guitar-hint");
  });

  test("sets, shows and resets Track.guitar", () => {
    let score = base();
    const set = applyGuitarCommand(
      score,
      "gtr",
      parseGuitarCommand("guitar capo 3")!,
    );
    expect(set.ok).toBe(true);
    score = set.next!;
    expect(score.tracks[0]!.guitar).toEqual({ capo: 3 });
    expect(
      applyGuitarCommand(score, "gtr", parseGuitarCommand("guitar capo 40")!)
        .ok,
    ).toBe(false);
    const reset = applyGuitarCommand(score, "gtr", { type: "guitar-reset" });
    expect(reset.next!.tracks[0]!.guitar).toBeUndefined();
  });
});

describe("strum command", () => {
  test("parses chords, pattern and speed", () => {
    expect(parseStrumCommand("strum G D Em C folk speed 30ms")).toEqual({
      type: "strum",
      options: { chords: ["G", "D", "Em", "C"], strokes: "folk", speedMs: 30 },
    });
    expect(parseStrumCommand("strumming")).toBeUndefined();
    expect(parseStrumCommand("strum G strokes Q")?.type).toBe("strum-hint");
  });

  test("writes one bar per chord with spread equal to speed", () => {
    const result = applyStrumCommand(
      base(),
      "gtr",
      parseStrumCommand("strum I V vi IV strokes D speed 24")!,
      ids,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("G D Em C");
    const notes = result.next!.notes;
    const tpb = result.next!.ticksPerBeat;
    const first = notes.filter((n) => n.startTick < tpb / 8);
    // 24 ms at 120 BPM is 0.048 beats across the strings.
    const spreadMs =
      ((Math.max(...first.map((n) => n.startTick)) -
        Math.min(...first.map((n) => n.startTick))) /
        tpb) *
      500;
    expect(Math.abs(spreadMs - 24)).toBeLessThanOrEqual(1 + 500 / tpb);
    expect(
      new Set(notes.map((n) => Math.floor(n.startTick / (4 * tpb)))),
    ).toEqual(new Set([0, 1, 2, 3]));
  });

  test("chords past the song's end grow it", () => {
    const short = applyStrumCommand(
      base(),
      "gtr",
      parseStrumCommand("strum Am7 D7 Am7 D7 each 8")!,
      ids,
    );
    expect(short.ok).toBe(true);
    const next = short.next!;
    const end = Math.max(
      ...next.notes.map((n) => n.startTick + n.durationTicks),
    );
    expect(next.bars * 4 * next.ticksPerBeat).toBeGreaterThanOrEqual(end);
    expect(short.message).toContain("song now");
  });

  test("strum alone strums the track's block chords", () => {
    let score = base();
    const block = applyStrumCommand(
      score,
      "gtr",
      parseStrumCommand("strum Am F strokes D speed 0")!,
      ids,
    );
    score = block.next!;
    const again = applyStrumCommand(
      score,
      "gtr",
      parseStrumCommand("strum folk")!,
      (i) => `s${i}`,
    );
    expect(again.ok).toBe(true);
    expect(again.message).toContain("Am F");
    expect(again.next!.notes.every((n) => n.id.startsWith("s"))).toBe(true);
  });

  test("detects chords from pitches", () => {
    expect(detectChord([57, 60, 64])).toEqual(makeChord(9, "min"));
    expect(detectChord([52, 55, 60])).toEqual(makeChord(0, "maj", [], 4));
    expect(detectChord([60])).toBeUndefined();
  });
});
