import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printSong } from "./print.ts";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import {
  bars,
  DawgSdkError,
  insertBars,
  note,
  place,
  reversed,
  SDK_VERSION,
  song,
  track,
} from "./v1.ts";

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("song loop (SDK 1.34.0)", () => {
  const lead = track({ name: "lead", notes: [note("C4", 0)] });

  test("bars and a section name", () => {
    expect(SDK_VERSION).toBe("1.34.0");
    expect(song({ bars: 8, tracks: [lead], loop: "5-6" }).loop).toEqual({
      startBar: 4,
      bars: 2,
    });
    expect(song({ bars: 8, tracks: [lead], loop: "3" }).loop).toEqual({
      startBar: 2,
      bars: 1,
    });
    const named = song({
      bars: 8,
      tracks: [lead],
      sections: [{ name: "chorus", startBar: 4, bars: 4 }],
      loop: "chorus",
    });
    expect(named.loopSection).toBe("chorus");
    expect(named.loop).toBeUndefined();
  });

  test("refuses bad loops", () => {
    expect(() => song({ bars: 4, tracks: [lead], loop: "3-6" })).toThrow(
      DawgSdkError,
    );
    expect(() => song({ bars: 4, tracks: [lead], loop: "3-2" })).toThrow(
      DawgSdkError,
    );
    expect(() =>
      song({ bars: 4, tracks: [lead], loop: "1-2", loopSection: "x" }),
    ).toThrow(/not both/);
  });

  test("prints and round-trips both forms", async () => {
    const ranged = createScore({ bars: 8 } as never).withLoop({
      startBar: 4,
      bars: 2,
    });
    expect(printSong(ranged)).toContain('loop: "5-6",');
    const single = ranged.withLoop({ startBar: 2, bars: 1 });
    expect(printSong(single)).toContain('loop: "3",');
    const dir = await mkdtemp(join(tmpdir(), "dawg-sdk-loop-"));
    try {
      await initProject(dir);
      await writeProject(dir, ranged);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.loop).toEqual({ startBar: 4, bars: 2 });
      expect(evaluated.score.sections).toEqual([]);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(ranged).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("range helpers (SDK 1.34.0)", () => {
  const riff = [
    note("C2", 0, 1),
    note("E2", 16, 2),
    note("G2", 20, 6),
    note("C3", 24, 1),
  ];

  test("bars re-bases the notes in bars 5-6 and cuts at the end", () => {
    const got = bars(riff, 5, 6);
    expect(got.map((item) => [item.pitch, item.start, item.length])).toEqual([
      [40, 0, 2],
      [43, 4, 4],
    ]);
    expect(bars(riff, 1).map((item) => item.start)).toEqual([0]);
    expect(bars(riff, 1, 1, { beatsPerBar: 3 }).length).toBe(1);
    expect(() => bars(riff, 3, 2)).toThrow(DawgSdkError);
  });

  test("place repeats at a bar", () => {
    const got = place(bars(riff, 5, 6), { at: 7, times: 2 });
    expect(got.map((item) => item.start)).toEqual([24, 28, 32, 36]);
    const spaced = place([note("C2", 0)], { at: 2, times: 3, bars: 2 });
    expect(spaced.map((item) => item.start)).toEqual([4, 12, 20]);
    expect(() => place(riff, { at: 0 })).toThrow(DawgSdkError);
  });

  test("reversed mirrors over the bars", () => {
    const got = reversed([note("C2", 0, 1), note("D2", 6, 2)], { bars: 2 });
    expect(got.map((item) => [item.pitch, item.start])).toEqual([
      [38, 0],
      [36, 7],
    ]);
  });

  test("insertBars shifts notes, sections and the loop", () => {
    const lead = track({
      name: "lead",
      notes: [note("C4", 0, 1), note("D4", 8, 1)],
    });
    const base = song({
      bars: 4,
      tracks: [lead],
      sections: [
        { name: "a", startBar: 0, bars: 2 },
        { name: "b", startBar: 2, bars: 2 },
      ],
      loop: "3-4",
    });
    const next = insertBars(base, { at: 3, bars: 2 });
    expect(next.bars).toBe(6);
    const tpb = base.ticksPerBeat;
    expect(next.notes.map((item) => item.startTick)).toEqual([0, 16 * tpb]);
    expect(
      next.sections?.map((section) => [section.startBar, section.bars]),
    ).toEqual([
      [0, 2],
      [4, 2],
    ]);
    expect(next.loop).toEqual({ startBar: 4, bars: 2 });
    expect(() => insertBars(base, { at: 9, bars: 1 })).toThrow(DawgSdkError);
  });
});
