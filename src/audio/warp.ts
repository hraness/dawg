/**
 * Sample positions through a song's tempo map (core/tempo.ts).
 *
 * Renderers keep their 0.4 arithmetic (`tick / samplesPerTick`) whenever
 * `warp` is absent, which is every score without tempo events or
 * fermatas, so those renders stay byte-identical. With a map, every tick
 * to sample conversion goes through it instead.
 */

import { timeMapFor, type TimeScore } from "../../core/tempo.ts";

export type SampleWarp = Readonly<{
  /** Fractional sample index where `tick` sounds (before a fermata there). */
  sample(tick: number): number;
  /** Score tick sounding at sample `index` (held ticks stay put). */
  tick(index: number): number;
  /** Tempo at `tick`. */
  bpm(tick: number): number;
}>;

export function sampleWarpFor(
  score: TimeScore,
  sampleRate: number,
): SampleWarp | undefined {
  const map = timeMapFor(score);
  if (!map) return undefined;
  return Object.freeze({
    sample: (tick: number) => map.seconds(tick) * sampleRate,
    tick: (index: number) => map.tick(index / sampleRate),
    bpm: (tick: number) => map.bpm(tick),
  });
}

/**
 * Start sample and length of a note through a warp: a note that starts on
 * a fermata's tick sustains through the hold.
 */
export function warpedSpan(
  warp: SampleWarp,
  startTick: number,
  durationTicks: number,
): { start: number; length: number } {
  const from = warp.sample(startTick);
  const to = warp.sample(startTick + durationTicks);
  return {
    start: Math.max(0, Math.floor(from)),
    length: Math.max(1, Math.floor(to - from)),
  };
}
