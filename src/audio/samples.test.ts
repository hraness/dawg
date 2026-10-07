import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type SampleRef } from "../../core/score.ts";
import { aiffBytes, dc, ramp, wavBytes } from "./sample-fixtures.ts";
import {
  SampleLibrary,
  decodeAiff,
  decodeCachedPcm,
  decodeWav,
  encodeCachedPcm,
  nativeFormat,
  pruneAssetCache,
  resampleLinear,
  sampleKey,
} from "./samples.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dawg-samples-"));
  roots.push(root);
  await mkdir(join(root, "tracks", "drums", "samples"), { recursive: true });
  return root;
}

const scoreWith = (voices: Record<string, SampleRef>) =>
  createScore({
    tracks: [
      {
        id: "drums",
        name: "drums",
        instrument: "sampler",
        sampler: { mode: "oneshot", voices },
      },
    ],
  });

describe("sample decoding", () => {
  test("WAV PCM 16/24/32-bit int and float32, mono and stereo", () => {
    const data = [0, 0.5, -0.5, 0.25, -1, 0.999];
    for (const encoding of ["pcm16", "pcm24", "pcm32", "float32"] as const) {
      const pcm = decodeWav(wavBytes(data, { encoding, sampleRate: 22_050 }));
      expect(pcm).toMatchObject({ sampleRate: 22_050, channels: 1, frames: 6 });
      const tolerance = encoding === "pcm16" ? 1e-4 : 1e-6;
      data.forEach((value, i) =>
        expect(Math.abs(pcm.data[i]! - value)).toBeLessThan(tolerance),
      );
    }
    const stereo = decodeWav(
      wavBytes([0.5, -0.5, 0.25, 0.25], { channels: 2, encoding: "pcm24" }),
    );
    expect(stereo).toMatchObject({ channels: 2, frames: 2 });
  });

  test("AIFF 16-bit big-endian decodes natively", () => {
    const bytes = aiffBytes([0, 0.5, -0.5], 44_100);
    expect(nativeFormat(bytes)).toBe("aiff");
    const pcm = decodeAiff(bytes);
    expect(pcm.sampleRate).toBeCloseTo(44_100, 3);
    expect(pcm.frames).toBe(3);
    expect(pcm.data[1]).toBeCloseTo(0.5, 3);
  });

  test("linear resampling keeps duration and shape", () => {
    const out = resampleLinear(Float32Array.from(ramp(441)), 44_100, 48_000);
    expect(out.length).toBe(480);
    expect(out[0]).toBe(0);
    expect(out[240]!).toBeCloseTo(0.5, 2);
  });

  test("cached PCM round-trips and rejects foreign bytes", () => {
    const pcm = decodeWav(wavBytes([0.1, 0.2, 0.3, 0.4], { channels: 2 }));
    expect(decodeCachedPcm(encodeCachedPcm(pcm))).toMatchObject({
      sampleRate: 48_000,
      channels: 2,
      frames: 2,
    });
    expect(decodeCachedPcm(new Uint8Array(32))).toBeUndefined();
  });
});

describe("sample library", () => {
  test("loads track-relative voices and caches by content hash", async () => {
    const root = await project();
    const bytes = wavBytes(dc(100), { sampleRate: 44_100 });
    await writeFile(join(root, "tracks/drums/samples/kick.wav"), bytes);
    const score = scoreWith({ kick: { src: "samples/kick.wav" } });
    const first = new SampleLibrary({ projectRoot: root, ffmpeg: null });
    const bank = await first.load(score);
    expect(bank.problems).toEqual([]);
    const kick = bank.voices.get(sampleKey("drums", "kick"))!;
    expect(kick.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(kick).toMatchObject({ sampleRate: 44_100, frames: 100 });
    expect(first.counters.decodes).toBe(1);
    await first.load(score);
    expect(first.counters).toMatchObject({ decodes: 1, memoryHits: 1 });
    expect(await readdir(join(root, ".dawg/assets"))).toEqual([
      `${kick.sha256}.pcm`,
    ]);
    // A fresh library (another process) reads the decoded PCM from disk.
    const second = new SampleLibrary({ projectRoot: root, ffmpeg: null });
    await second.load(score);
    expect(second.counters).toMatchObject({ decodes: 0, diskHits: 1 });
    // Project-relative src works too.
    const direct = await second.load(
      scoreWith({ kick: { src: "tracks/drums/samples/kick.wav" } }),
    );
    expect(direct.problems).toEqual([]);
  });

  test("the asset cache evicts least recently used files", async () => {
    const root = await project();
    const dir = join(root, "cache");
    await mkdir(dir);
    const names = ["a", "b", "c"].map((c) => `${c.repeat(64)}.pcm`);
    for (const [i, name] of names.entries()) {
      await writeFile(join(dir, name), new Uint8Array(100));
      const at = new Date(Date.UTC(2026, 0, 1 + i));
      await utimes(join(dir, name), at, at);
    }
    expect(await pruneAssetCache(dir, 250)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(names.slice(1));
    // Through the library: a budget for one decoded file keeps only the newest.
    const lib = new SampleLibrary({
      projectRoot: root,
      ffmpeg: null,
      cacheDir: join(root, "assets"),
      maxCacheBytes: 16 + 100 * 4 + 50,
    });
    for (const level of [0.1, 0.2]) {
      await writeFile(
        join(root, "tracks/drums/samples/kick.wav"),
        wavBytes(dc(100, level)),
      );
      await lib.load(scoreWith({ kick: { src: "samples/kick.wav" } }));
    }
    expect(await readdir(join(root, "assets"))).toHaveLength(1);
  });

  test("missing files, escapes and limits are problems, not crashes", async () => {
    const root = await project();
    const outside = await mkdtemp(join(tmpdir(), "dawg-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.wav"), wavBytes(dc(10)));
    await symlink(
      join(outside, "secret.wav"),
      join(root, "tracks/drums/samples/link.wav"),
    );
    await writeFile(join(root, "tracks/drums/samples/big.wav"), "");
    await truncate(
      join(root, "tracks/drums/samples/big.wav"),
      50 * 1024 * 1024 + 1,
    );
    await writeFile(
      join(root, "tracks/drums/samples/noise.mp3"),
      new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]),
    );
    const lib = new SampleLibrary({ projectRoot: root, ffmpeg: null });
    const bank = await lib.load(
      scoreWith({
        gone: { src: "samples/gone.wav" },
        link: { src: "samples/link.wav" },
        big: { src: "samples/big.wav" },
        mp3: { src: "samples/noise.mp3" },
        dot: { src: ".dawg/assets/x.pcm" },
      }),
    );
    expect(bank.voices.size).toBe(0);
    const byVoice = new Map(bank.problems.map((p) => [p.voice, p]));
    expect(byVoice.get("gone")?.message).toContain("file is missing");
    expect(byVoice.get("link")?.message).toContain("keep samples inside");
    expect(byVoice.get("big")?.message).toContain("sample file limit");
    expect(byVoice.get("mp3")?.message).toContain("ffmpeg is not on PATH");
    expect(byVoice.get("dot")?.level).toBe("error");
    for (const problem of bank.problems)
      expect(problem.message.split(" · ").length).toBeGreaterThanOrEqual(3);
  });

  test("over-long samples are rejected", async () => {
    const root = await project();
    // 8 kHz mono, 601 s: 9.6 MB, under the byte limit, over 10 minutes.
    const frames = 8_000 * 601;
    const bytes = wavBytes(new Float32Array(frames), { sampleRate: 8_000 });
    await writeFile(join(root, "tracks/drums/samples/long.wav"), bytes);
    const bank = await new SampleLibrary({
      projectRoot: root,
      ffmpeg: null,
    }).load(scoreWith({ long: { src: "samples/long.wav" } }));
    expect(bank.voices.size).toBe(0);
    expect(bank.problems[0]?.message).toMatch(/10 min|minute/);
  });

  test("other formats decode through ffmpeg when it is available", async () => {
    const root = await project();
    await writeFile(
      join(root, "tracks/drums/samples/hit.flac"),
      new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    const calls: string[][] = [];
    const lib = new SampleLibrary({
      projectRoot: root,
      ffmpeg: "/opt/ffmpeg",
      runFfmpeg: async (args) => {
        calls.push([...args]);
        const out = new Float32Array([0.5, 0.5, -0.5, -0.5]);
        return {
          code: 0,
          stdout: new Uint8Array(out.buffer),
          stderr: "",
        };
      },
    });
    const bank = await lib.load(
      scoreWith({ hit: { src: "samples/hit.flac" } }),
    );
    expect(bank.problems).toEqual([]);
    expect(calls[0]?.[0]).toBe("/opt/ffmpeg");
    expect(calls[0]).toContain("pcm_f32le");
    const hit = bank.voices.get(sampleKey("drums", "hit"))!;
    expect(hit).toMatchObject({ sampleRate: 48_000, channels: 2, frames: 2 });
    expect(Array.from(hit.mono)).toEqual([0.5, -0.5]);
  });

  test("a sha256 mismatch warns and still plays the file", async () => {
    const root = await project();
    await writeFile(
      join(root, "tracks/drums/samples/kick.wav"),
      wavBytes(dc(8)),
    );
    const bank = await new SampleLibrary({
      projectRoot: root,
      ffmpeg: null,
    }).load(
      scoreWith({ kick: { src: "samples/kick.wav", sha256: "0".repeat(64) } }),
    );
    expect(bank.voices.has(sampleKey("drums", "kick"))).toBe(true);
    expect(bank.problems).toHaveLength(1);
    expect(bank.problems[0]).toMatchObject({ level: "warning", voice: "kick" });
    expect(bank.problems[0]!.message).toContain(
      "changed since it was imported",
    );
  });
});
