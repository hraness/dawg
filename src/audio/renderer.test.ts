import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LoopRenderer } from "./renderer.ts";
import { renderScorePcm } from "./wav.ts";
import { SampleLibrary } from "./samples.ts";
import { dc, wavBytes } from "./sample-fixtures.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const score = (pitch: number) =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      { id: "kit", name: "kit", instrument: "kit" },
      {
        id: "lead",
        name: "lead",
        instrument: "saw",
        pan: 0.5,
        delay: { beats: 0.5, feedback: 0.3, mix: 0.3 },
      },
    ],
    notes: [
      {
        id: "k",
        trackId: "kit",
        pitch: 36,
        startTick: 0,
        durationTicks: 120,
        velocity: 1,
      },
      {
        id: "l",
        trackId: "lead",
        pitch,
        startTick: 480,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });

describe("loop renderer", () => {
  test("renders in a worker byte-identical to the calling thread", async () => {
    const worker = new LoopRenderer({ sampleRate: 8_000 });
    const inline = new LoopRenderer({ sampleRate: 8_000, worker: false });
    try {
      expect(worker.offThread).toBe(true);
      expect(inline.offThread).toBe(false);
      for (const pitch of [60, 64, 60]) {
        const expected = renderScorePcm(score(pitch), {
          sampleRate: 8_000,
          loop: true,
        });
        const [a, b] = await Promise.all([
          worker.render(score(pitch)),
          inline.render(score(pitch)),
        ]);
        expect(a.frames).toBe(expected.frames);
        expect(a.pcm).toEqual(expected.pcm);
        expect(b.pcm).toEqual(expected.pcm);
        expect(a.renderMs).toBeGreaterThanOrEqual(0);
      }
      // Concurrent requests come back matched to their scores.
      const renders = await Promise.all(
        [62, 65, 67].map((pitch) => worker.render(score(pitch))),
      );
      renders.forEach((render, index) =>
        expect(render.pcm).toEqual(
          renderScorePcm(score([62, 65, 67][index]!), {
            sampleRate: 8_000,
            loop: true,
          }).pcm,
        ),
      );
    } finally {
      worker.dispose();
      inline.dispose();
    }
    await expect(worker.render(score(60))).rejects.toThrow("disposed");
  });
});

describe("loop renderer with sampler tracks", () => {
  test("worker, inline and cold renders agree, and a replaced file re-renders", async () => {
    const root = await mkdtemp(join(tmpdir(), "dawg-renderer-"));
    try {
      await mkdir(join(root, "tracks", "hits", "samples"), { recursive: true });
      const file = join(root, "tracks", "hits", "samples", "kick.wav");
      await writeFile(file, wavBytes(dc(600, 0.7), { sampleRate: 22_050 }));
      const sampled = createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [
          {
            id: "hits",
            name: "hits",
            instrument: "sampler",
            pan: -0.3,
            sampler: {
              mode: "oneshot",
              voices: { kick: { src: "samples/kick.wav" } },
            },
          },
          { id: "lead", name: "lead", instrument: "saw" },
        ],
        notes: [
          {
            id: "k",
            trackId: "hits",
            pitch: 36,
            startTick: 0,
            durationTicks: 60,
            velocity: 1,
          },
          {
            id: "l",
            trackId: "lead",
            pitch: 60,
            startTick: 480,
            durationTicks: 240,
            velocity: 0.7,
          },
        ],
      });
      const expected = async () =>
        renderScorePcm(sampled, {
          sampleRate: 8_000,
          loop: true,
          samples: await new SampleLibrary({
            projectRoot: root,
            ffmpeg: null,
            cacheDir: join(root, "cold"),
          }).load(sampled),
        });
      const worker = new LoopRenderer({ sampleRate: 8_000, projectRoot: root });
      const inline = new LoopRenderer({
        sampleRate: 8_000,
        worker: false,
        projectRoot: root,
      });
      try {
        const first = await expected();
        expect(first.pcm.some((value) => value !== 0)).toBe(true);
        for (let pass = 0; pass < 2; pass += 1) {
          const [a, b] = await Promise.all([
            worker.render(sampled),
            inline.render(sampled),
          ]);
          expect(a.pcm).toEqual(first.pcm);
          expect(b.pcm).toEqual(first.pcm);
        }
        // Same score, new file contents: the cached stem must not be reused.
        await writeFile(file, wavBytes(dc(600, 0.2), { sampleRate: 22_050 }));
        const second = await expected();
        expect(second.pcm).not.toEqual(first.pcm);
        expect((await worker.render(sampled)).pcm).toEqual(second.pcm);
        expect((await inline.render(sampled)).pcm).toEqual(second.pcm);
      } finally {
        worker.dispose();
        inline.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
