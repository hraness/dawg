import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LIVE_CASES } from "../../bench/perf/live.ts";
import { LIVE_RIG_WINDOW_SECONDS, LiveSynth } from "./live.ts";

describe("responsive live keys", () => {
  test("short taps and sustained voices render a bounded, exact prefix", () => {
    for (const [name, track] of Object.entries(LIVE_CASES)) {
      const score = createScore({
        tempoBpm: 120,
        tracks: [{ id: "t", name, ...track }],
      } as never);
      for (const seconds of [0.125, 8]) {
        let rendered = 0;
        const synth = new LiveSynth(22_050, {
          onRender: (frames) => {
            rendered = Math.max(rendered, frames);
          },
        });
        const request = {
          score,
          trackId: "t",
          pitch: 48,
          velocity: 0.8,
          seconds,
          clock: 0,
          firstWindow: true,
        };
        const first = synth.render(request)!;
        expect(first.partial).toBe(true);
        expect(rendered).toBeLessThanOrEqual(22_050);
        expect(first.frames).toBeLessThanOrEqual(
          Math.round(LIVE_RIG_WINDOW_SECONDS * 22_050),
        );
        const full = synth.render({ ...request, full: true })!;
        if (!Bun.deepEquals(first.pcm, full.pcm.subarray(0, first.pcm.length)))
          throw new Error(`${name} ${seconds}s prefix differs from full audio`);
        expect(first.releaseSeconds).toBe(full.releaseSeconds);
        expect(first.ringOut).toBe(full.ringOut);
      }
    }
  });
  test("ring-out instruments retain their whole tail after key release", () => {
    const score = createScore({
      tracks: [
        {
          id: "gong",
          name: "gong",
          instrument: "modal",
          modal: { preset: "gong", damp: 0 },
        },
      ],
    } as never);
    const request = {
      score,
      trackId: "gong",
      pitch: 48,
      velocity: 0.8,
      seconds: 0.125,
    };
    const first = new LiveSynth(8_000).render({
      ...request,
      firstWindow: true,
    })!;
    const full = new LiveSynth(8_000).render({ ...request, full: true })!;
    expect(first.partial).toBeUndefined();
    expect(first.ringOut).toBe(true);
    expect(first.pcm).toEqual(full.pcm);
  });
});
