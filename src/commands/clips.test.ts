import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import { encodeWav } from "../audio/wav.ts";
import {
  applyLyrics,
  applyVocalSetup,
  parseClipCommand,
  parseLyricsCommand,
  runClipCommand,
  setClipImportDeps,
  userBarLabel,
  userBarTick,
} from "./clips.ts";
import { parseVocalCommand, runVocalCommand } from "./vocal.ts";

const SHA = "a".repeat(64);
const base = (clips?: unknown[]) =>
  createScore({
    tempoBpm: 120,
    ticksPerBeat: 960,
    bars: 16,
    tracks: [
      {
        id: "vox",
        name: "vox",
        instrument: "vocal",
        ...(clips ? { clips } : {}),
      },
    ],
    notes: [0, 1, 2, 3, 4].map((i) => ({
      id: `n${i}`,
      trackId: "vox",
      startTick: i * 960,
      durationTicks: 960,
      pitch: 60 + i,
      velocity: 0.8,
    })),
  } as never);

/** A 1 s mono 48 kHz sine peaking at `peak`. */
function sineWav(peak: number): Uint8Array {
  const pcm = new Int16Array(48_000);
  for (let i = 0; i < pcm.length; i += 1)
    pcm[i] = Math.round(
      Math.sin((2 * Math.PI * 220 * i) / 48_000) * peak * 32767,
    );
  return encodeWav(pcm, 48_000);
}

describe("bars", () => {
  test("1-based bars and beats become ticks and back", () => {
    const score = base();
    expect(userBarTick(score, "1")).toBe(0);
    expect(userBarTick(score, "9")).toBe(8 * 4 * 960);
    expect(userBarTick(score, "5.3")).toBe(4 * 4 * 960 + 2 * 960);
    expect(userBarLabel(score, 4 * 4 * 960 + 2 * 960)).toBe("5.3");
    expect(() => userBarTick(score, "0")).toThrow();
    expect(() => userBarTick(score, "2.5")).toThrow();
  });
});

describe("/vocal import", () => {
  test("copies, pins, places at the bar and sets a -6 dBFS gain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-vocal-import-"));
    try {
      const bytes = sineWav(0.25);
      setClipImportDeps({
        importFile: async (_file, name, _context, slug) => {
          const src = `tracks/${slug}/samples/${name}.wav`;
          await mkdir(join(dir, `tracks/${slug}/samples`), { recursive: true });
          await writeFile(join(dir, src), bytes);
          return {
            src,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        },
      });
      const command = parseVocalCommand(
        "/vocal import ~/Music/My Take.wav at 9",
      )!;
      const result = await runVocalCommand(command, {
        score: base(),
        trackId: "vox",
        cwd: dir,
      });
      expect(result.ok).toBe(true);
      const clip = result.next!.tracks[0]!.clips![0]!;
      expect(clip.id).toBe("my-take");
      expect(clip.src).toBe("tracks/vox/samples/my-take.wav");
      expect(clip.startTick).toBe(8 * 4 * 960);
      // 0.25 peak → 0.5012 / 0.25 ≈ 2.005 (+6 dB)
      expect(20 * Math.log10(0.25 * clip.gain!)).toBeCloseTo(-6, 1);
      expect(result.message).toContain("bar 9");
    } finally {
      setClipImportDeps({});
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stem without a split says what to do", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-vocal-stem-"));
    try {
      const result = await runVocalCommand(
        parseVocalCommand("/vocal stem 1")!,
        {
          score: base(),
          trackId: "vox",
          cwd: dir,
        },
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("split_stems");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("setups apply the chain and name the lanes this build lacks", () => {
    const plain = createScore({
      tracks: [{ id: "a", name: "a", instrument: "pad" }],
    } as never);
    const result = applyVocalSetup(plain, "a", "hyper", () => false);
    expect(result.ok).toBe(true);
    const track = result.next!.tracks[0]!;
    expect(track.instrument).toBe("vocal");
    expect(track.filter).toMatchObject({ type: "hpf", cutoff: 90 });
    expect(track.fx?.compressor).toMatchObject({ ratio: 3 });
    expect(track.delay?.beats).toBe(0.125);
    expect(result.message).toContain("not in this build yet: autotune");
    expect(applyVocalSetup(plain, "a", "auto").ok).toBe(true);
    expect(applyVocalSetup(plain, "a", "nope").ok).toBe(false);
  });
});

describe("/clip", () => {
  const one = () =>
    base([
      {
        id: "hook",
        src: "tracks/vox/samples/hook.wav",
        sha256: SHA,
        startTick: 0,
        dur: 4,
      },
    ]);
  const run = async (score: TrackScore, text: string) => {
    const parsed = parseClipCommand(text);
    if (!parsed || "error" in parsed) throw new Error(`bad ${text}`);
    return runClipCommand(parsed, { score, trackId: "vox", cwd: tmpdir() });
  };

  test("gain is dB in and linear stored; 0 dB drops the field", async () => {
    const r = await run(one(), "/clip gain -6");
    expect(20 * Math.log10(r.next!.tracks[0]!.clips![0]!.gain!)).toBeCloseTo(
      -6,
      3,
    );
    const back = await run(r.next!, "/clip hook gain 0");
    expect(back.next!.tracks[0]!.clips![0]!.gain).toBeUndefined();
  });

  test("move, fade, rev, mute, rm", async () => {
    let s = (await run(one(), "/clip move 3")).next!;
    expect(s.tracks[0]!.clips![0]!.startTick).toBe(2 * 4 * 960);
    s = (await run(s, "/clip fade .01 .2")).next!;
    expect(s.tracks[0]!.clips![0]).toMatchObject({
      fadeInTime: 0.01,
      fadeTime: 0.2,
    });
    s = (await run(s, "/clip rev")).next!;
    expect(s.tracks[0]!.clips![0]!.rev).toBe(true);
    s = (await run(s, "/clip mute")).next!;
    expect(s.tracks[0]!.clips![0]!.mute).toBe(true);
    s = (await run(s, "/clip rm")).next!;
    expect(s.tracks[0]!.clips).toBeUndefined();
  });

  test("split at a bar cuts the clip in two with 5 ms fades", async () => {
    // 120 bpm, 4/4: bar 2 starts at 2 s; the clip plays 0..4 s.
    const r = await run(one(), "/clip split 2");
    expect(r.ok).toBe(true);
    const [head, tail] = r.next!.tracks[0]!.clips!;
    expect(head).toMatchObject({ id: "hook", dur: 2, fadeTime: 0.005 });
    expect(tail).toMatchObject({
      id: "hook2",
      offset: 2,
      dur: 2,
      startTick: 3840,
      fadeInTime: 0.005,
    });
  });

  test("gain by nudges; fade in/out edit one side; default drops it", async () => {
    let s = (await run(one(), "/clip gain -6")).next!;
    s = (await run(s, "/clip gain by -3")).next!;
    expect(20 * Math.log10(s.tracks[0]!.clips![0]!.gain!)).toBeCloseTo(-9, 1);
    s = (await run(s, "/clip fade in .02")).next!;
    expect(s.tracks[0]!.clips![0]!.fadeInTime).toBe(0.02);
    expect(s.tracks[0]!.clips![0]).not.toHaveProperty("fadeTime");
    s = (await run(s, "/clip fade out .3")).next!;
    s = (await run(s, "/clip fade in default")).next!;
    expect(s.tracks[0]!.clips![0]).not.toHaveProperty("fadeInTime");
    expect(s.tracks[0]!.clips![0]!.fadeTime).toBe(0.3);
    s = (await run(s, "/clip trim dur end")).next!;
    expect(s.tracks[0]!.clips![0]).not.toHaveProperty("dur");
  });

  test("split cuts a reversed clip without dur against its file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-clip-split-"));
    try {
      await mkdir(join(dir, "tracks/vox/samples"), { recursive: true });
      await writeFile(
        join(dir, "tracks/vox/samples/hook.wav"),
        encodeWav(new Int16Array(4 * 48_000), 48_000),
      );
      const rev = base([
        {
          id: "hook",
          src: "tracks/vox/samples/hook.wav",
          sha256: SHA,
          startTick: 0,
          rev: true,
        },
      ]);
      const parsed = parseClipCommand("/clip split 2");
      if (!parsed || "error" in parsed) throw new Error("parse");
      const r = await runClipCommand(parsed, {
        score: rev,
        trackId: "vox",
        cwd: dir,
      });
      expect(r.ok).toBe(true);
      // Reversed: the head plays file 4..2 s, the tail file 2..0 s.
      const [head, tail] = r.next!.tracks[0]!.clips!;
      expect(head).toMatchObject({ offset: 2, dur: 2 });
      expect(head!.offset).toBe(2);
      expect(tail).toMatchObject({ dur: 2, startTick: 3840 });
      expect(tail!.offset ?? 0).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("repeat every 2 bars to bar 9 writes copies", async () => {
    const r = await run(one(), "/clip repeat every 2 to 9");
    expect(r.next!.tracks[0]!.clips!.map((c) => c.startTick)).toEqual([
      0, 7680, 15360, 23040,
    ]);
  });

  test("an unknown verb prints usage", () => {
    expect(parseClipCommand("/clip hook wobble")).toHaveProperty("error");
    expect(parseClipCommand("/clips")).toBeUndefined();
  });
});

describe("/lyrics", () => {
  test("auto-splits words onto notes, holds and skips", () => {
    const r = applyLyrics(
      base(),
      "vox",
      parseLyricsCommand("/lyrics never gon _ ~")!,
    );
    expect(r.ok).toBe(true);
    expect(r.next!.notes.map((n) => n.lyric)).toEqual([
      "nev",
      "er",
      "gon",
      "_",
      undefined,
    ]);
    expect(r.message).toContain("split never");
    const shown = applyLyrics(r.next!, "vox", { kind: "show" });
    expect(shown.message).toContain("nev er gon _");
    const cleared = applyLyrics(
      r.next!,
      "vox",
      parseLyricsCommand("/lyrics clear")!,
    );
    expect(cleared.next!.notes.every((n) => n.lyric === undefined)).toBe(true);
  });

  test("from a bar, leftovers are reported", () => {
    const r = applyLyrics(
      base(),
      "vox",
      parseLyricsCommand("/lyrics 2 la la la")!,
    );
    // Bar 2 starts at tick 3840: only n4 is from there.
    expect(r.next!.notes.map((n) => n.lyric)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "la",
    ]);
    expect(r.message).toContain("2 syllables left over");
  });
});
