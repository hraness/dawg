/**
 * Sing on the live path (formant.md section 4.5): a held choir key sounds
 * its first window within the live budget, the window is the full note's
 * prefix, and an 8 s choir audition stays under its render budget.
 */
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { LIVE_RIG_WINDOW_SECONDS, LiveSynth, warmLive } from "../live.ts";
import { renderScorePcm } from "../wav.ts";

const RATE = 22_050;

function choir(notes: readonly Record<string, unknown>[] = []): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 4,
    tracks: [
      {
        id: "ch",
        name: "choir",
        instrument: "sing",
        sing: { preset: "choir" },
      },
    ],
    notes: notes.map((n) => ({ trackId: "ch", ...n })),
  } as never);
}

const time = (run: () => void): number => {
  const t = performance.now();
  run();
  return performance.now() - t;
};
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const best = (run: () => void, n = 3) => {
  let low = Infinity;
  for (let i = 0; i < n; i += 1) {
    const t = performance.now();
    run();
    low = Math.min(low, performance.now() - t);
  }
  return low;
};

describe("sing live", () => {
  test("a held choir key: first window, then the exact full note", () => {
    const score = choir();
    const synth = new LiveSynth(RATE);
    const request = {
      score,
      trackId: "ch",
      pitch: 60,
      velocity: 0.8,
      seconds: 3,
    };
    const first = synth.render(request)!;
    expect(first.partial).toBe(true);
    expect(first.frames).toBeLessThanOrEqual(
      Math.round(LIVE_RIG_WINDOW_SECONDS * RATE),
    );
    const full = synth.render({ ...request, full: true })!;
    expect(full.frames).toBeGreaterThan(first.frames);
    expect(Array.from(full.pcm.subarray(0, first.pcm.length))).toEqual(
      Array.from(first.pcm),
    );
  });

  test("first window and 8 s audition fit the budgets", () => {
    const score = choir();
    warmLive(score, "ch", RATE);
    // 15 ms on the reference host for the first window (median over ten
    // pitches, each a fresh synth); CI gets 3x.
    const window = median(
      Array.from({ length: 10 }, (_, i) =>
        time(() => {
          new LiveSynth(RATE).render({
            score,
            trackId: "ch",
            pitch: 50 + i,
            velocity: 0.8,
            seconds: 4,
          });
        }),
      ),
    );
    expect(window).toBeLessThan(process.env.DAWG_PERF ? 15 : 45);
    const notes = [0, 1, 2, 3].map((bar) => ({
      id: `n${bar}`,
      pitch: [57, 60, 64, 62][bar]!,
      startTick: bar * 4 * 480,
      durationTicks: 4 * 480,
      velocity: 0.8,
    }));
    const song = choir(notes);
    expect(song.notes.length).toBe(4);
    // 350 ms on the reference host for 8 s; CI gets 3x.
    const audition = best(() => renderScorePcm(song, { sampleRate: RATE }));
    expect(audition).toBeLessThan(process.env.DAWG_PERF ? 350 : 1050);
  }, 30_000);

  test("the first key of a fresh session, after play mode warms, fits", () => {
    // A fresh process: the glottal tables and the engine's loops are cold,
    // as on the first key of a session (review fix: 58-80 ms before).
    const live = new URL("../live.ts", import.meta.url).pathname;
    const score = new URL("../../../core/score.ts", import.meta.url).pathname;
    const code = `
      const { LiveSynth, warmLive } = await import(${JSON.stringify(live)});
      const { createScore } = await import(${JSON.stringify(score)});
      const out = {};
      for (const preset of ["choir", "airy", "khoomei", "aah"]) {
        const s = createScore({ tempoBpm: 120, bars: 4, tracks: [{ id: "t",
          name: "t", instrument: "sing", sing: { preset } }], notes: [] });
        warmLive(s, "t", ${RATE});
        const t = performance.now();
        new LiveSynth(${RATE}).render({ score: s, trackId: "t", pitch: 55,
          velocity: 0.8, seconds: 4 });
        out[preset] = performance.now() - t;
      }
      console.log(JSON.stringify(out));`;
    const run = Bun.spawnSync([process.execPath, "--eval", code]);
    expect(run.exitCode).toBe(0);
    const times = JSON.parse(run.stdout.toString().trim()) as Record<
      string,
      number
    >;
    for (const ms of Object.values(times))
      expect(ms).toBeLessThan(process.env.DAWG_PERF ? 15 : 45);
  }, 30_000);
});
