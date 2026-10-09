import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import {
  audio,
  lyrics,
  note,
  repeatAudio,
  seq,
  song,
  take,
  track,
} from "./v1.ts";

const SHA = "a".repeat(64);
const SHB = "b".repeat(64);

const voiced = createScore({
  tempoBpm: 96,
  bars: 8,
  tracks: [
    {
      id: "vox",
      name: "vox",
      instrument: "vocal",
      takes: [
        {
          name: "take-1",
          src: "tracks/vox/takes/take-1.wav",
          sha256: SHB,
          startTick: 3840,
          offset: 0.25,
          latency: 0.0123456,
          ppm: 12.3456,
          inTick: 3840,
          outTick: 7680,
        },
      ],
      clips: [
        {
          id: "clip",
          src: "tracks/vox/samples/verse.wav",
          sha256: SHA,
          startTick: 0,
        },
        {
          id: "hook",
          src: "tracks/vox/takes/take-1.wav",
          sha256: SHB,
          startTick: 7680,
          offset: 1.23456789,
          dur: 2,
          gain: 0.5,
          fadeInTime: 0.01,
          fadeTime: 0.2,
          rev: true,
          take: "take-1",
          mute: true,
          text: "oh yeah",
        },
      ],
    },
  ],
  notes: [
    {
      id: "n1",
      trackId: "vox",
      startTick: 0,
      durationTicks: 960,
      pitch: 60,
      velocity: 0.8,
      lyric: "nev",
    },
    {
      id: "n2",
      trackId: "vox",
      startTick: 960,
      durationTicks: 960,
      pitch: 62,
      velocity: 0.8,
      lyric: "er",
    },
  ],
} as never);

describe("audio clips in the SDK", () => {
  test("audio(), take() and repeatAudio() store Track.clips and takes", () => {
    const hook = audio("samples/hook.wav", { id: "hook", at: 4, gain: 0.5 });
    const t = track({
      name: "vox",
      instrument: "vocal",
      takes: [take("take-1", "takes/take-1.wav", { at: 8, in: 8, out: 16 })],
      clips: [
        audio("samples/verse.wav"),
        repeatAudio(hook, { every: 8, until: 24 }),
      ],
      notes: [],
    });
    const s = song({ tempo: 120, bars: 8, tracks: [t] });
    const stored = s.tracks[0] as unknown as {
      clips: { id: string; src: string; startTick: number }[];
      takes: { name: string; inTick: number; outTick: number }[];
    };
    expect(stored.clips.map((c) => [c.id, c.src, c.startTick])).toEqual([
      ["clip", "tracks/vox/samples/verse.wav", 0],
      ["hook", "tracks/vox/samples/hook.wav", 1920],
      ["hook-r2", "tracks/vox/samples/hook.wav", 5760],
      ["hook-r3", "tracks/vox/samples/hook.wav", 9600],
    ]);
    expect(stored.takes[0]).toMatchObject({
      name: "take-1",
      src: "tracks/vox/takes/take-1.wav",
      inTick: 3840,
      outTick: 7680,
    });
  });

  test("audio() and take() reject unknown options and bad values", () => {
    expect(() => audio("a.wav", { wobble: 1 } as never)).toThrow(/wobble/);
    expect(() => audio("a.wav", { gain: -1 })).toThrow(/gain/);
    expect(() => audio("a.wav", { sha256: "xyz" })).toThrow(/sha256/);
    expect(() => take("t", "t.wav", { in: 4, out: 2 })).toThrow(/out/);
    expect(() => repeatAudio({} as never, { every: 1, until: 2 })).toThrow(
      /audio\(\)/,
    );
  });

  test("lyrics() splits syllables, holds melismas and skips with ~", () => {
    const sung = lyrics("nev-er gon _ ~ na", seq("C4 D4 E4 F4 G4 A4"));
    expect(sung.map((n) => (n as { lyric?: string }).lyric)).toEqual([
      "nev",
      "er",
      "gon",
      "_",
      undefined,
      "na",
    ]);
    // Whole words split by vowel groups when there are notes to spare.
    const auto = lyrics("hello", [note("C4", 0), note("D4", 1)]);
    expect(auto.map((n) => (n as { lyric?: string }).lyric)).toEqual([
      "hel",
      "lo",
    ]);
  });
});

describe("audio clips in the printer", () => {
  test("prints audio() and take() in the contract key order", () => {
    const text = printTrack(voiced, voiced.tracks[0]!);
    expect(text).toContain("import { track, note, audio, take }");
    expect(text).toContain('audio("tracks/vox/samples/verse.wav", {');
    const hook = text.slice(text.indexOf('audio("tracks/vox/takes'));
    const keys = [
      "id",
      "at",
      "offset",
      "dur",
      "gain",
      "fadeInTime",
      "fadeTime",
      "rev",
      "take",
      "mute",
      "text",
      "sha256",
    ].map((key) => hook.indexOf(`${key}:`));
    expect(keys.every((at) => at > 0)).toBe(true);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(hook).toContain("offset: 1.2346,");
    // Linear gain with the dB the commands speak beside it.
    expect(hook).toContain("gain: 0.5 /* -6.0 dB */,");
    expect(text).toContain("latency: 0.0123,");
    expect(text).toContain("ppm: 12.35,");
    expect(text).toContain('lyric: "nev"');
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(voiced).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const rounded = createScore({
      ...voiced.toJSON(),
      tracks: voiced.tracks.map((t) => ({
        ...t,
        takes: t.takes!.map((k) => ({ ...k, latency: 0.0123, ppm: 12.35 })),
        clips: t.clips!.map((c) => (c.offset ? { ...c, offset: 1.2346 } : c)),
      })),
    } as never);
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-clips-"));
    try {
      await initProject(dir);
      for (const file of printProject(rounded).files)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(
        diffScores(rounded, evaluated.score).filter(
          (op) => op.type !== "addNote" && op.type !== "removeNote",
        ),
      ).toEqual([]);
      expect(evaluated.score.notes.map((n) => n.lyric)).toEqual(["nev", "er"]);
      expect(evaluated.score.tracks[0]!.clips).toEqual(
        rounded.tracks[0]!.clips,
      );
      expect(evaluated.score.tracks[0]!.takes).toEqual(
        rounded.tracks[0]!.takes,
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(rounded).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a score without clips prints as before", () => {
    const plain = createScore({
      tracks: [{ id: "a", name: "a", instrument: "pad" }],
    } as never);
    const text = printTrack(plain, plain.tracks[0]!);
    expect(text).not.toContain("clips");
    expect(text).not.toContain("audio");
  });
});

void TrackScore;
