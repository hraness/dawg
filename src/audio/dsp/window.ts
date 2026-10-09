/**
 * Grain window tables (0.6 granular, shared): 2048 + 1 entries over 0..1,
 * read by index with linear interpolation. Ported from the 0.6 granular
 * prototype (`proto/granular/dsp.ts`, `windowTable`).
 *
 * - hann: raised cosine, the smooth default (Roads, Microsound, 2001).
 * - tukey: flat over the middle half, cosine edges (denser, louder grains).
 * - gauss: sigma 0.15 with the edges pulled to zero.
 * - tri: Bartlett.
 * - perc: 2 % attack then a cubic decay (plucky grains).
 * - rperc: perc reversed (swelling grains).
 */
export const WINDOW_SHAPES = Object.freeze([
  "hann",
  "tukey",
  "gauss",
  "tri",
  "perc",
  "rperc",
] as const);
export type WindowShape = (typeof WINDOW_SHAPES)[number];

/** Table resolution; tables hold `WINDOW_TABLE + 1` points (both ends). */
export const WINDOW_TABLE = 2048;

export type GrainWindowTable = Readonly<{
  table: Float64Array;
  /** Mean of w² over the window, for the 1/sqrt(overlap·mean w²) gain. */
  meanSq: number;
}>;

function shapeAt(shape: WindowShape, u: number): number {
  switch (shape) {
    case "hann":
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    case "tukey": {
      const edge = 0.25;
      if (u < edge) return 0.5 - 0.5 * Math.cos((Math.PI * u) / edge);
      if (u > 1 - edge) return 0.5 - 0.5 * Math.cos((Math.PI * (1 - u)) / edge);
      return 1;
    }
    case "gauss": {
      const g = Math.exp(-0.5 * ((u - 0.5) / 0.15) ** 2);
      const e = Math.exp(-0.5 * (0.5 / 0.15) ** 2);
      return (g - e) / (1 - e);
    }
    case "tri":
      return 1 - Math.abs(2 * u - 1);
    case "perc":
      return (u < 0.02 ? u / 0.02 : 1) * (1 - u) ** 3;
    case "rperc":
      return (u > 0.98 ? (1 - u) / 0.02 : 1) * u ** 3;
  }
}

/** A fresh table for `shape` (`WINDOW_TABLE + 1` points). */
export function windowTable(shape: WindowShape): Float64Array {
  const table = new Float64Array(WINDOW_TABLE + 1);
  for (let i = 0; i <= WINDOW_TABLE; i += 1)
    table[i] = shapeAt(shape, i / WINDOW_TABLE);
  return table;
}

const cache = new Map<WindowShape, GrainWindowTable>();

/** The shared (cached, never mutated) table and its mean square. */
export function grainWindow(shape: WindowShape): GrainWindowTable {
  let entry = cache.get(shape);
  if (!entry) {
    const table = windowTable(shape);
    let sq = 0;
    for (let i = 0; i < WINDOW_TABLE; i += 1) sq += table[i]! * table[i]!;
    entry = Object.freeze({ table, meanSq: sq / WINDOW_TABLE });
    cache.set(shape, entry);
  }
  return entry;
}
