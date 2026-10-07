import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scriptedRunner } from "../auth/runner.ts";
import {
  DRUM_FIXTURE_DIR,
  ffprobeJson,
  runContext,
  syntheticWav,
  tempProject,
} from "./media-fixtures.ts";
import {
  inferKind,
  noteName,
  quantizeNotes,
  snippetLines,
  transcribeNotes,
} from "./notes.ts";
import { readJson } from "./paths.ts";
import type { TimedNote } from "./types.ts";
import { DRUM_CLASS_PITCHES, classifyDrumWav } from "./vendor/drums.ts";
import { parseBeatGrid } from "./vendor/grid.ts";

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

async function fixture(name: string) {
  return new Uint8Array(
    await Bun.file(join(DRUM_FIXTURE_DIR, name)).arrayBuffer(),
  );
}

describe("drum classifier (vendored from soundfish)", () => {
  test("hears kicks, snares and hats where the CC BY excerpt has them", async () => {
    const [wav, gridBytes] = await Promise.all([
      fixture("drums.wav"),
      fixture("excerpt.json"),
    ]);
    const grid = parseBeatGrid(gridBytes);
    const notes = classifyDrumWav(wav);
    expect(notes.length).toBeGreaterThan(20);
    const within = (seconds: number, from: number, to: number) =>
      seconds >= from - 0.08 && seconds < to - 0.08;
    const bars = 4;
    for (let bar = 0; bar < bars; bar += 1) {
      const start = grid.beats[bar * 4]!;
      const end = grid.beats[bar * 4 + 4]!;
      const inBar = notes.filter((note) =>
        within(note.startSeconds, start, end),
      );
      const kicks = inBar.filter(
        (note) => note.pitch === DRUM_CLASS_PITCHES.kick,
      );
      const snares = inBar.filter(
        (note) => note.pitch === DRUM_CLASS_PITCHES.snare,
      );
      expect(kicks.length).toBeGreaterThanOrEqual(2);
      expect(kicks.length).toBeLessThanOrEqual(4);
      expect(snares.length).toBeGreaterThanOrEqual(1);
      // Hats on at least six of the eight eighths.
      const step = (end - start) / 8;
      let eighthsWithHat = 0;
      for (let eighth = 0; eighth < 8; eighth += 1) {
        const at = start + eighth * step;
        if (
          inBar.some(
            (note) =>
              (note.pitch === DRUM_CLASS_PITCHES["closed-hat"] ||
                note.pitch === DRUM_CLASS_PITCHES["open-hat"]) &&
              Math.abs(note.startSeconds - at) < step * 0.45,
          )
        )
          eighthsWithHat += 1;
      }
      expect(eighthsWithHat).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("quantize + snippet", () => {
  const grid = parseBeatGrid(
    new TextEncoder().encode(
      JSON.stringify({
        beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
        bars: [
          { beat: 0, beatsPerBar: 4 },
          { beat: 4, beatsPerBar: 4 },
        ],
        bpm: 120,
        duration: 5,
      }),
    ),
  );

  test("snaps to sixteenths from the first downbeat and names pitches", () => {
    const notes: TimedNote[] = [
      { pitch: 33, startSeconds: 0.51, endSeconds: 1.02, velocity: 0.8 },
      { pitch: 45, startSeconds: 1.74, endSeconds: 1.8, velocity: 0.5 },
    ];
    const { quantized, originBeat } = quantizeNotes(notes, grid);
    expect(originBeat).toBe(0);
    expect(quantized[0]).toMatchObject({
      name: "A1",
      startBeat: 0,
      lengthBeats: 1,
      velocity: 0.8,
    });
    expect(quantized[1]).toMatchObject({ name: "A2", startBeat: 2.5 });
    expect(quantized[1]!.lengthBeats).toBe(0.25);
    expect(snippetLines(quantized, "bass")).toEqual([
      'note("A1", 0, 1, 0.8)',
      'note("A2", 2.5, 0.25, 0.5)',
    ]);
    expect(noteName(60)).toBe("C4");
  });

  test("drum snippets map classifier pitches to dawg voices and dedupe", () => {
    const notes: TimedNote[] = [
      { pitch: 36, startSeconds: 0.5, endSeconds: 0.6, velocity: 1 },
      { pitch: 42, startSeconds: 0.5, endSeconds: 0.55, velocity: 0.6 },
      { pitch: 42, startSeconds: 0.52, endSeconds: 0.57, velocity: 0.6 },
      { pitch: 38, startSeconds: 1.5, endSeconds: 1.6, velocity: 0.9 },
      { pitch: 51, startSeconds: 2.5, endSeconds: 2.6, velocity: 0.9 },
    ];
    const { quantized } = quantizeNotes(notes, grid);
    expect(snippetLines(quantized, "drums")).toEqual([
      'hit("kick", 0)',
      'hit("hat", 0)',
      'hit("snare", 2)',
      'hit("rim", 4)',
    ]);
  });

  test("infers the kind from the stem file name", () => {
    expect(inferKind("tracks/main/downloads/song.stems/drums.wav")).toBe(
      "drums",
    );
    expect(inferKind("bass-2.wav")).toBe("bass");
    expect(inferKind("vocals_dry.wav")).toBe("vocals");
    expect(inferKind("song.wav")).toBe("other");
  });
});

describe("transcribeNotes", () => {
  test("drums: analyzes first, classifies, writes <base>.drums.notes.json", async () => {
    const project = await tempProject();
    cleanups.push(project.cleanup);
    const wavPath = join(project.downloads, "song.stems", "drums.wav");
    await Bun.write(wavPath, await fixture("drums.wav"));
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffprobe",
          result: { stdout: ffprobeJson(9.9) },
        },
      ],
      ["ffprobe"],
    );
    const context = runContext(
      { projectRoot: project.root, trackSlug: "main" },
      runner,
    );
    const result = await transcribeNotes(
      { file: "song.stems/drums.wav" },
      context,
    );
    expect(result.content.kind).toBe("drums");
    expect(result.content.notes as number).toBeGreaterThan(20);
    expect(result.outputs[0]).toBe(
      "tracks/main/downloads/song.stems/drums.drums.notes.json",
    );
    expect(result.outputs[1]).toBe(
      "tracks/main/downloads/song.stems/drums.analysis.json",
    );
    const snippet = result.content.snippet as string[];
    expect(snippet.some((line) => line.startsWith('hit("kick"'))).toBe(true);
    expect(context.lines).toContain("analyzing beat grid first");
    const written = (await readJson(
      join(project.downloads, "song.stems", "drums.drums.notes.json"),
    )) as { bpm: number; notes: unknown[] };
    expect(written.bpm).toBeGreaterThan(95);
    expect(written.bpm).toBeLessThan(110);
    expect(written.notes.length).toBe(result.content.notes as number);
  });

  test("pitched: runs basic-pitch through uv, trims with ffmpeg, parses the CSV", async () => {
    const project = await tempProject();
    cleanups.push(project.cleanup);
    const wavPath = join(project.downloads, "bass.wav");
    await Bun.write(
      wavPath,
      syntheticWav(4, (t) => 0.5 * Math.sin(2 * Math.PI * 110 * t)),
    );
    let basicPitchArgs: readonly string[] = [];
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffprobe",
          result: { stdout: ffprobeJson(4) },
        },
        {
          match: (command, args) =>
            command === "uv" && args[0] === "tool" && args[1] === "list",
          result: { stdout: "basic-pitch v0.4.0\n- basic-pitch\n" },
        },
        {
          match: (command) => command === "ffmpeg",
          respond: async (_command, args) => {
            await Bun.write(
              args.at(-1)!,
              syntheticWav(2, (t) => 0.5 * Math.sin(2 * Math.PI * 110 * t)),
            );
            return {};
          },
        },
        {
          match: (command, args) =>
            command === "uv" && args[2] === "basic-pitch",
          respond: async (_command, args, options) => {
            basicPitchArgs = args;
            options.onOutput?.("stderr", "Predicting MIDI for bass.wav...\n");
            const outDir = args.at(-3)!;
            const wav = args.at(-2)!;
            const base = wav
              .split("/")
              .at(-1)!
              .replace(/\.wav$/, "");
            await Bun.write(
              join(outDir, `${base}_basic_pitch.csv`),
              [
                "start_time_s,end_time_s,pitch_midi,velocity",
                "0.0,0.5,45,100",
                "0.5,1.0,47,90",
                "1.0,1.5,45,80",
              ].join("\n"),
            );
            return {};
          },
        },
      ],
      ["ffprobe", "ffmpeg", "uv"],
    );
    const context = runContext(
      { projectRoot: project.root, trackSlug: "main" },
      runner,
    );
    const result = await transcribeNotes(
      { file: "bass.wav", from: 1, to: 3 },
      context,
    );
    expect(result.content.kind).toBe("bass");
    expect(result.content.notes).toBe(3);
    expect(basicPitchArgs.slice(0, 3)).toEqual(["tool", "run", "basic-pitch"]);
    expect(basicPitchArgs).toContain("--save-note-events");
    expect(basicPitchArgs).toContain("--minimum-frequency");
    const written = (await readJson(
      join(project.downloads, "bass.bass.notes.json"),
    )) as { notes: TimedNote[]; window: { from: number; to: number } };
    // Times are shifted back into the source file's clock.
    expect(written.notes[0]!.startSeconds).toBe(1);
    expect(written.window).toEqual({ from: 1, to: 3 });
    expect(context.lines).toContain("ffmpeg trimming");
    expect(context.lines).toContain("basic-pitch running");
  });

  test("pitched without basic-pitch installed is a clear error, never an install", async () => {
    const project = await tempProject();
    cleanups.push(project.cleanup);
    await Bun.write(
      join(project.downloads, "piano.wav"),
      syntheticWav(1, () => 0),
    );
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffprobe",
          result: { stdout: ffprobeJson(1) },
        },
        {
          match: (command, args) => command === "uv" && args[1] === "list",
          result: { stdout: "harbor v0.1.0\n- harbor\n" },
        },
      ],
      ["ffprobe", "uv"],
    );
    const context = runContext(
      { projectRoot: project.root, trackSlug: "main" },
      runner,
    );
    await expect(
      transcribeNotes({ file: "piano.wav" }, context),
    ).rejects.toThrow(/uv tool install basic-pitch/);
    expect(
      runner.calls.some(
        (call) => call.command === "uv" && call.args.includes("install"),
      ),
    ).toBe(false);
  });
});
