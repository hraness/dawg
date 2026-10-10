/**
 * The runner's view of one section for one block: flat typed arrays only,
 * so every node kernel is a plain function over offsets (no closures, no
 * per-sample allocation). `m` is the section's sample memory: slot `s`
 * of the current block starts at `s * stride + blk`. A voice uses
 * `stride = BLOCK` and `blk = 0`; the global section keeps every slot for
 * the whole render (`stride` = padded frames) and walks `blk`. Negative
 * slots are block-local: `-1 - s` blocks past `local` (slot -1 stays zero).
 */
export const BLOCK = 32;

export type Frame = {
  /** Sample memory of the section instance (a voice, or the track). */
  m: Float64Array;
  /** Per-block control values (inputs and number settings), in ctl slots. */
  ctl: Float64Array;
  /** The previous block's control values, for smoothed ports. */
  prev: Float64Array;
  /** Node state (phases, filter memories, generator seeds). */
  st: Float64Array;
  stride: number;
  /** Offset of the current block inside each slot. */
  blk: number;
  /** Where block-local slots start in `m` (slot -1 is the zero block). */
  local: number;
  sampleRate: number;
  /** Beats per second for this block (tempo / 60). */
  bps: number;
  /** Per-node program data for the section. */
  slotBase: Int32Array;
  slots: Int32Array;
  ctlBase: Int32Array;
  stBase: Int32Array;
  mode: Int32Array;
  nIn: Int32Array;
  /** The global slot holding the song position in beats (clock reads it). */
  beatSlot: number;
};

/** Memory offset of port `k` (inputs then outputs) of node `node`. */
export function at(f: Frame, node: number, k: number): number {
  const s = f.slots[f.slotBase[node]! + k]!;
  return s >= 0 ? s * f.stride + f.blk : f.local - (s + 1) * BLOCK;
}

/** Mulberry32 over a state cell holding an int32; returns [0, 1). */
export function draw(st: Float64Array, cell: number): number {
  let a = (st[cell]! + 0x6d2b79f5) | 0;
  st[cell] = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

/** Flushes subnormal-scale values in feedback state to exactly zero. */
export function flush(x: number): number {
  return x > 1e-30 || x < -1e-30 ? x : 0;
}

/** Fills one block with `value` (a loop: `fill` on 32 cells costs a native call). */
export function put(m: Float64Array, value: number, o: number): void {
  for (let i = 0; i < BLOCK; i += 1) m[o + i] = value;
}
