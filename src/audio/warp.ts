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
  /** Fractional sample index where `tick` sounds. */
  sample(tick: number): number;
  /** Score tick sounding at sample `index`. */
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
  // Per-sample callers (automation, effects, sampler positions) read
  // `tick` once per sample: evaluate the map once per block and interpolate
  // between block edges. That is exact inside constant-tempo stretches,
  // within a hair inside a ramp, and at most one block's ticks off across
  // a step or fermata edge (about a tick at 48 kHz), for automation and
  // modulation reads only: note onsets use `sample`, which stays exact.
  let grid = new Float64Array(0);
  let known = new Uint8Array(0);
  const edge = (block: number): number => {
    if (block >= grid.length) {
      const size = Math.max(block + 1, grid.length * 2, 1024);
      const nextGrid = new Float64Array(size);
      const nextKnown = new Uint8Array(size);
      nextGrid.set(grid);
      nextKnown.set(known);
      grid = nextGrid;
      known = nextKnown;
    }
    if (known[block] === 0) {
      grid[block] = map.tick((block * WARP_BLOCK) / sampleRate);
      known[block] = 1;
    }
    return grid[block]!;
  };
  return Object.freeze({
    sample: (tick: number) => map.seconds(tick) * sampleRate,
    tick: (index: number) => {
      if (!(index >= 0) || index > MAX_GRID_SAMPLES)
        return map.tick(index / sampleRate);
      const block = Math.floor(index / WARP_BLOCK);
      const into = index - block * WARP_BLOCK;
      const from = edge(block);
      if (into === 0) return from;
      return from + ((edge(block + 1) - from) * into) / WARP_BLOCK;
    },
    bpm: (tick: number) => map.bpm(tick),
  });
}

/** Samples between exact `tick` evaluations; ticks in between interpolate. */
export const WARP_BLOCK = 64;
/** Past this sample index (about 3 h at 48 kHz) `tick` evaluates directly. */
const MAX_GRID_SAMPLES = 2 ** 29;

/**
 * Start sample and length of a note through a warp: a note inside a
 * fermata beat stretches with it.
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
