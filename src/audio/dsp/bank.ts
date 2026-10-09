/**
 * Shared grain bank (0.6 granular, shared DSP): a source band-limited at
 * one level per semitone of upward read speed, so grains read at any step
 * stay alias-free with a 4-point Hermite read.
 *
 * Level `L` holds the source low-passed so that reading it at a step of up
 * to 2^(L/12) puts the stopband edge at or below the output Nyquist (a
 * Kaiser-windowed sinc, about -70 dB stopband, transition scaled with the
 * step so the output passband reaches about 0.43 of the output rate at
 * every level). Level 0 is the source itself (steps <= 1 never alias).
 * Every level keeps the source's frame rate, so a voice that changes its
 * step (bend, vibrato, glide) re-picks the level per 32-frame control
 * block without moving its read position.
 *
 * This replaces the prototype's octave mipmap (`proto/granular/dsp.ts`,
 * `buildMipmap`) after the 0.6 review: octave levels over-filter
 * non-octave intervals (a shimmer fifth lost up to 11 semitones of top
 * band) and full-length Float64 levels had no memory bound. Here a level
 * is a sparse map of Float32 chunks filled on first read, and all chunks of
 * all sources share one byte budget (64 MB) evicted least recently used;
 * an eviction only costs a recompute. Output is deterministic: a chunk's
 * contents depend only on the source, the level and the chunk index.
 */

/** Frames per chunk (a power of two). */
export const BANK_CHUNK_FRAMES = 4096;
const CHUNK_SHIFT = 12;
/** Chunks carry one frame before and two after for the Hermite read. */
export const BANK_CHUNK_PAD = 3;
/** Highest level (five octaves up); faster reads use it and may alias. */
export const BANK_MAX_LEVEL = 60;
/** Byte budget shared by every source's chunks. */
export const BANK_MAX_BYTES = 64 * 1024 * 1024;

const STOPBAND_DB = 70;
const KAISER_BETA = 0.1102 * (STOPBAND_DB - 8.7);
/** Taps at step 1 (scaled up with the step, capped). */
const BASE_TAPS = 96;
const MAX_TAPS = 511;

/** A mono source registered with the bank. */
export type BankSource = Readonly<{
  /** Content id: a sample's sha256 or a built-in render key. */
  id: string;
  rate: number;
  data: Float32Array;
}>;

type Chunk = Float32Array;

/**
 * Chunks per source (`id` and rate) keyed by level and index as one number.
 * Grains look a chunk up every 32-frame block, so the lookup avoids string
 * keys and the LRU order is a use counter (scanned only to evict).
 */
type Entry = { chunk: Chunk; used: number };
const chunks = new Map<string, Map<number, Entry>>();
const sourceTables = new WeakMap<BankSource, Map<number, Entry>>();
let count = 0;
let clock = 0;
let bytes = 0;
let byteCap = BANK_MAX_BYTES;
const ZERO_CHUNK = new Float32Array(BANK_CHUNK_FRAMES + BANK_CHUNK_PAD);
const kernels = new Map<number, Float64Array>();

/** The level for a read step (frames of source per output frame). */
export function bankLevel(step: number): number {
  const r = step < 0 ? -step : step;
  if (r <= 1 + 1e-9) return 0;
  const level = Math.ceil(12 * Math.log2(r) - 1e-6);
  return level > BANK_MAX_LEVEL ? BANK_MAX_LEVEL : level;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k += 1) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** The low-pass kernel of a level (odd length, unity DC gain). */
export function bankKernel(level: number): Float64Array {
  let h = kernels.get(level);
  if (h) return h;
  const r = 2 ** (level / 12);
  let taps = Math.min(MAX_TAPS, Math.ceil(BASE_TAPS * r));
  if (taps % 2 === 0) taps += 1;
  // Kaiser transition width for the tap count, centred inside the band.
  const transition = (STOPBAND_DB - 8) / (2.285 * 2 * Math.PI * (taps - 1));
  const fc = Math.max(0.01, 0.5 / r - transition / 2);
  h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  const norm = besselI0(KAISER_BETA);
  let sum = 0;
  for (let i = 0; i < taps; i += 1) {
    const m = i - mid;
    const sinc =
      m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const ratio = m / mid;
    const w = besselI0(KAISER_BETA * Math.sqrt(1 - ratio * ratio)) / norm;
    h[i] = sinc * w;
    sum += h[i]!;
  }
  for (let i = 0; i < taps; i += 1) h[i] = h[i]! / sum;
  kernels.set(level, h);
  return h;
}

function fill(source: BankSource, level: number, index: number): Chunk {
  const out = new Float32Array(BANK_CHUNK_FRAMES + BANK_CHUNK_PAD);
  const data = source.data;
  const n = data.length;
  const first = index * BANK_CHUNK_FRAMES - 1;
  if (level === 0) {
    for (let i = 0; i < out.length; i += 1) {
      const k = first + i;
      out[i] = k >= 0 && k < n ? data[k]! : 0;
    }
    return out;
  }
  const h = bankKernel(level);
  const taps = h.length;
  const mid = (taps - 1) >> 1;
  for (let i = 0; i < out.length; i += 1) {
    const centre = first + i;
    const lo = centre - mid;
    let from = 0;
    let to = taps;
    if (lo < 0) from = -lo;
    if (lo + to > n) to = n - lo;
    let acc = 0;
    for (let j = from; j < to; j += 1) acc += h[j]! * data[lo + j]!;
    out[i] = acc;
  }
  return out;
}

/**
 * The chunk holding frames `index * 4096 - 1 .. (index + 1) * 4096 + 2` of
 * `level`; a frame `i` of the level is `chunk[(i & 4095) + 1]`. Chunks
 * wholly outside the source are a shared zero chunk.
 */
export function bankChunk(
  source: BankSource,
  level: number,
  index: number,
): Chunk {
  if (index < 0 || index * BANK_CHUNK_FRAMES > source.data.length + 2)
    return ZERO_CHUNK;
  let table = sourceTables.get(source);
  if (!table) {
    const id = `${source.id}\u0000${source.rate}`;
    table = chunks.get(id);
    if (!table) chunks.set(id, (table = new Map()));
    sourceTables.set(source, table);
  }
  const key = level * 2 ** 32 + index;
  clock += 1;
  const hit = table.get(key);
  if (hit) {
    hit.used = clock;
    return hit.chunk;
  }
  const chunk = fill(source, level, index);
  table.set(key, { chunk, used: clock });
  count += 1;
  bytes += chunk.byteLength;
  if (bytes > byteCap) evict();
  return chunk;
}

/** Drops least recently used chunks until under the budget (keeps one). */
function evict(): void {
  const all: { table: Map<number, Entry>; key: number; used: number }[] = [];
  for (const table of chunks.values())
    for (const [key, entry] of table)
      all.push({ table, key, used: entry.used });
  all.sort((a, b) => a.used - b.used);
  for (const { table, key } of all) {
    if (bytes <= byteCap || count <= 1) break;
    bytes -= table.get(key)!.chunk.byteLength;
    table.delete(key);
    count -= 1;
  }
}

/** Chunk index of a level frame. */
export function chunkIndex(frame: number): number {
  return frame >> CHUNK_SHIFT;
}

/** Hermite read of `level` at a fractional frame (slow path, tests). */
export function bankRead(
  source: BankSource,
  level: number,
  pos: number,
): number {
  const i = Math.floor(pos);
  const t = pos - i;
  const chunk = bankChunk(source, level, i >> CHUNK_SHIFT);
  const o = (i & (BANK_CHUNK_FRAMES - 1)) + 1;
  const xm1 = chunk[o - 1]!;
  const x0 = chunk[o]!;
  const x1 = chunk[o + 1]!;
  const x2 = chunk[o + 2]!;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

/** Bytes held by chunks now. */
export function bankBytes(): number {
  return bytes;
}

/** Chunks held now. */
export function bankChunks(): number {
  return count;
}

/** Drops every chunk; with `cap`, sets a new byte budget (tests). */
export function resetBank(cap: number = BANK_MAX_BYTES): void {
  for (const table of chunks.values()) table.clear();
  count = 0;
  bytes = 0;
  byteCap = Math.max(0, cap);
}
