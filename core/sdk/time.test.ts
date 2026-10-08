import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, scoreFromJSON, TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject } from "./print.ts";
import {
  accel,
  DawgSdkError,
  fermata,
  meter,
  note,
  phasing,
  ramp,
  rit,
  song,
  tempo,
  track,
} from "./v1.ts";

const piano = (time?: Parameters<typeof track>[0]["time"]) =>
  track({
    name: "piano",
    instrument: "piano",
    notes: [note("C4", 0), note("E4", 1)],
    ...(time ? { time } : {}),
  });

describe("sdk time", () => {
  test("song({ time }) stores ticks, bar indexes and resolved pins", () => {
    const built = song({
      tempo: 120,
      bars: 8,
      time: [
        tempo(4, 140),
        rit(16, 8, 80),
        fermata(31),
        meter(24, [7, 8]),
        meter(27.5, 4),
      ],
      tracks: [piano()],
    });
    expect(built.time).toEqual({
      tempo: [
        { tick: 1920, bpm: 140 },
        { tick: 7680, bpm: 140 },
        { tick: 11520, bpm: 80, ramp: "linear" },
      ],
      meter: [
        { bar: 6, beatsPerBar: 7, beatUnit: 8 },
        { bar: 7, beatsPerBar: 4 },
      ],
      fermatas: [{ tick: 14880, beats: 2 }],
    });
    // dawg accepts it as is.
    const score = scoreFromJSON(built);
    expect(score.time).toEqual(built.time!);
  });

  test("a pin holds the tempo until the next ramp starts", () => {
    const built = song({
      tempo: 100,
      time: [ramp(8, 200, "exp"), tempo(4), tempo(12), tempo(14, 90)],
      tracks: [piano()],
    });
    // The pin at beat 12 has no ramp after it, so it is dropped.
    expect(built.time?.tempo).toEqual([
      { tick: 1920, bpm: 100 },
      { tick: 3840, bpm: 200, ramp: "exp" },
      { tick: 6720, bpm: 90 },
    ]);
    expect(
      song({ tempo: 100, time: accel(0, 4, 160), tracks: [piano()] }).time,
    ).toEqual({ tempo: [{ tick: 1920, bpm: 160, ramp: "linear" }] });
  });

  test("helpers reject bad input", () => {
    expect(() => tempo(0, 90)).toThrow(DawgSdkError);
    expect(() => tempo(4, 400)).toThrow(DawgSdkError);
    expect(() => meter(4, [5, 3])).toThrow(DawgSdkError);
    expect(() => fermata(2, 0)).toThrow(DawgSdkError);
    expect(() =>
      song({ tempo: 120, time: [meter(6, 3)], tracks: [piano()] }),
    ).toThrow(/bar line/);
    expect(() =>
      song({
        tempo: 120,
        time: [tempo(4, 90), tempo(4, 100)],
        tracks: [piano()],
      }),
    ).toThrow(/two tempo changes/);
  });

  test("track({ time }) converts beats to ticks; phasing() finds the rate", () => {
    expect(phasing(3, 48)).toEqual({ cycle: 3, rate: 17 / 16 });
    const built = song({
      tempo: 120,
      tracks: [piano({ cycle: 3, rate: 1.5, phase: 0.5 })],
    });
    expect(built.tracks[0]!.time).toEqual({
      rate: 1.5,
      phase: 240,
      cycle: 1440,
    });
    expect(() => piano({ rate: 20 })).toThrow(DawgSdkError);
  });
});

const timedScore = createScore({
  tempoBpm: 96,
  bars: 6,
  time: {
    tempo: [
      { tick: 1920, bpm: 132 },
      { tick: 5760, bpm: 70, ramp: "exp" },
      { tick: 7680, bpm: 96, ramp: "linear" },
    ],
    meter: [
      { bar: 2, beatsPerBar: 7, beatUnit: 8 },
      { bar: 4, beatsPerBar: 3 },
    ],
    fermatas: [{ tick: 9600, beats: 3 }],
  },
  tracks: [
    {
      id: "left",
      name: "left",
      instrument: "piano",
    },
    {
      id: "right",
      name: "tempo",
      instrument: "piano",
      time: { rate: 13 / 12, phase: -120, cycle: 2880 },
    },
  ],
  notes: [
    {
      id: "n1",
      trackId: "left",
      startTick: 0,
      durationTicks: 240,
      pitch: 64,
      velocity: 0.8,
    },
    {
      id: "n2",
      trackId: "right",
      startTick: 0,
      durationTicks: 240,
      pitch: 64,
      velocity: 0.8,
    },
  ],
});

async function roundTrip(score: TrackScore): Promise<TrackScore> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-time-"));
  try {
    await initProject(dir);
    for (const file of printProject(score).files)
      await writeAtomic(join(dir, file.path), file.text);
    const evaluated = await evaluateProject(dir);
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
    return evaluated.score;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("printing time", () => {
  test("song.ts and track.ts print time marks prettier-stably", async () => {
    const files = printProject(timedScore).files;
    const songFile = files[0]!.text;
    expect(songFile).toContain(
      'import { song, tempo, ramp, meter, fermata } from "dawg";',
    );
    expect(songFile).toContain('    ramp(12, 70, "exp"),');
    expect(songFile).toContain("    meter(8, [7, 8]),");
    expect(songFile).toContain("    meter(15, 3),");
    expect(songFile).toContain("    fermata(20, 3),");
    // A track named like a helper gets another identifier.
    expect(songFile).toContain("import track_tempo from");
    const right = files.find((file) => file.path.includes("tempo"))!.text;
    expect(right).toContain(
      "  time: { rate: 1.0833333333333333, phase: -0.25, cycle: 6 },",
    );
    for (const file of files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print(eval(print(x))) keeps the time fields", async () => {
    const back = await roundTrip(timedScore);
    const ops = diffScores(timedScore, back).filter(
      (op) => op.type !== "addNote" && op.type !== "removeNote",
    );
    expect(ops).toEqual([]);
    expect(printProject(back).files).toEqual(printProject(timedScore).files);
  });

  test("a score without time prints the 0.4 song.ts", () => {
    const plain = createScore({
      tracks: [{ id: "tempo", name: "tempo", instrument: "piano" }],
    });
    const text = printProject(plain).files[0]!.text;
    expect(text).toContain('import { song } from "dawg";');
    expect(text).toContain("import tempo from");
    expect(text).not.toContain("time:");
  });
});
