import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LoopRenderer } from "./renderer.ts";
import { renderScorePcm } from "./wav.ts";

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
