import { describe, expect, test } from "bun:test";
import { applyRigPreset } from "../../core/fx.ts";
import { createScore } from "../../core/score.ts";
import {
  LIVE_RIG_WINDOW_SECONDS,
  LiveFullRenderer,
  LiveSynth,
} from "./live.ts";

const RATE = 44_100;

const rigged = (preset: string) =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "gtr",
        name: "gtr",
        instrument: "pluck",
        fx: applyRigPreset(undefined, preset as never),
      },
    ],
  } as never);

describe("live guitar rig", () => {
  test("a held note sounds its first window, then the exact full note", () => {
    const score = rigged("crunch");
    const synth = new LiveSynth(RATE);
    const request = {
      score,
      trackId: "gtr",
      pitch: 52,
      velocity: 0.8,
      seconds: 3,
    };
    const first = synth.render(request)!;
    expect(first.partial).toBe(true);
    expect(first.frames).toBeLessThanOrEqual(
      Math.round(LIVE_RIG_WINDOW_SECONDS * RATE),
    );
    const full = synth.render({ ...request, full: true })!;
    expect(full.partial).toBeUndefined();
    expect(full.frames).toBeGreaterThan(first.frames);
    // Every rig stage is causal: the window is the full note's prefix.
    expect(Array.from(full.pcm.subarray(0, first.pcm.length))).toEqual(
      Array.from(first.pcm),
    );
    // Once the full note is cached, a repeat key gets it straight away.
    expect(synth.render(request)!.partial).toBeUndefined();
  });

  test("short notes and tracks without a rig render whole", () => {
    const synth = new LiveSynth(RATE);
    const score = rigged("clean");
    expect(
      synth.render({
        score,
        trackId: "gtr",
        pitch: 52,
        velocity: 0.8,
        seconds: 0.5,
      })!.partial,
    ).toBeUndefined();
    const plain = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "p", name: "p", instrument: "pluck" }],
    });
    expect(
      synth.render({
        score: plain,
        trackId: "p",
        pitch: 52,
        velocity: 0.8,
        seconds: 3,
      })!.partial,
    ).toBeUndefined();
  });

  test("the full pass runs on a worker, matches the main-thread render and is cached", async () => {
    const score = rigged("metal");
    const request = {
      score,
      trackId: "gtr",
      pitch: 40,
      velocity: 0.9,
      seconds: 4,
    };
    const local = new LiveSynth(RATE).render({ ...request, full: true })!;
    const synth = new LiveSynth(RATE);
    const renderer = new LiveFullRenderer();
    try {
      expect(synth.render(request)!.partial).toBe(true);
      const started = performance.now();
      const pending = renderer.full(synth, request);
      // Handing off costs the key path next to nothing.
      expect(performance.now() - started).toBeLessThan(20);
      const full = (await pending)!;
      expect(full.frames).toBe(local.frames);
      expect(Array.from(full.pcm)).toEqual(Array.from(local.pcm));
      expect(synth.render(request)!.partial).toBeUndefined();
    } finally {
      renderer.close();
    }
  });

  test("a six-string strum's windows fit the live budget", () => {
    const score = rigged("metal");
    const synth = new LiveSynth(RATE);
    let worst = Infinity;
    // Best of three: a strum of distinct pitches, each a cold render.
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      for (const pitch of [40, 45, 50, 55, 59, 64])
        synth.render({
          score,
          trackId: "gtr",
          pitch,
          velocity: 0.8 - round * 0.01,
          seconds: 4,
        });
      worst = Math.min(worst, performance.now() - started);
    }
    // Six cold windows on the key path; the full passes are off-thread.
    expect(worst).toBeLessThan(process.env.DAWG_PERF ? 200 : 600);
  });
});
