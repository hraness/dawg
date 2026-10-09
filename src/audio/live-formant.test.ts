import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LIVE_RIG_WINDOW_SECONDS, LiveSynth } from "./live.ts";

const RATE = 22_050;

const score = (formant: boolean) =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "v",
        name: "v",
        instrument: "saw",
        ...(formant ? { fx: { formant: { shift: -3 } } } : {}),
      },
    ],
  } as never);

describe("live formant fx", () => {
  test("a held key sounds a window that is the full note's exact prefix", () => {
    const synth = new LiveSynth(RATE);
    const request = {
      score: score(true),
      trackId: "v",
      pitch: 57,
      velocity: 0.8,
      seconds: 4,
    };
    const t0 = performance.now();
    const first = synth.render(request)!;
    const windowMs = performance.now() - t0;
    expect(first.partial).toBe(true);
    expect(first.frames).toBeLessThanOrEqual(
      Math.round(LIVE_RIG_WINDOW_SECONDS * RATE),
    );
    const full = synth.render({ ...request, full: true })!;
    expect(full.partial).toBeUndefined();
    expect(full.frames).toBeGreaterThan(first.frames);
    expect(Array.from(full.pcm.subarray(0, first.pcm.length))).toEqual(
      Array.from(first.pcm),
    );
    // The first window stays inside the live budget (15 ms at 22.05 kHz,
    // with headroom for a loaded machine).
    expect(windowMs).toBeLessThan(60);
  });

  test("a track without the formant fx renders whole", () => {
    const synth = new LiveSynth(RATE);
    expect(
      synth.render({
        score: score(false),
        trackId: "v",
        pitch: 57,
        velocity: 0.8,
        seconds: 4,
      })!.partial,
    ).toBeUndefined();
  });
});
