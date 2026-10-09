/**
 * Glottal source: the Liljencrants-Fant (LF) flow-derivative pulse shaped by
 * one voice-quality knob Rd (Fant 1995, "The LF-model revisited"): 0.3 is
 * pressed and bright, 1.0 modal, 2.7 breathy and dark. One period tables are
 * precomputed on an Rd grid and read with linear interpolation in phase and
 * across Rd, so the per-sample cost is two table reads.
 *
 * Fant's Rd relations (all in units of the period T0 = 1):
 *   Ra = (-1 + 4.8 Rd) / 100, Rk = (22.4 + 11.8 Rd) / 100,
 *   Rg = Rk / (4 (0.11 Rd / (0.5 + 1.2 Rk) - Ra)),
 *   tp = 1 / (2 Rg), te = tp (1 + Rk), ta = Ra.
 */
import { fftInPlace } from "./fft.ts";

export const GLOTTAL_TABLE = 2048;
export const RD_MIN = 0.3;
export const RD_MAX = 2.7;
export const RD_STEP = 0.1;
const RD_COUNT = Math.round((RD_MAX - RD_MIN) / RD_STEP) + 1;

function lfTable(rd: number, n: number): Float64Array {
  const ra = (-1 + 4.8 * rd) / 100;
  const rk = (22.4 + 11.8 * rd) / 100;
  const rg = rk / (4 * ((0.11 * rd) / (0.5 + 1.2 * rk) - ra));
  const tp = 1 / (2 * rg);
  let te = tp * (1 + rk);
  if (te > 0.98) te = 0.98;
  const ta = Math.max(ra, 1e-4);
  const tc = 1;
  // return-phase constant: eps * ta = 1 - exp(-eps (tc - te))
  let eps = 1 / ta;
  for (let i = 0; i < 60; i += 1) eps = (1 - Math.exp(-eps * (tc - te))) / ta;
  const wg = Math.PI / tp;
  const shape = (alpha: number, out: Float64Array): number => {
    const e0 = -1 / (Math.exp(alpha * te) * Math.sin(wg * te));
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      let v: number;
      if (t <= te) v = e0 * Math.exp(alpha * t) * Math.sin(wg * t);
      else
        v =
          -(1 / (eps * ta)) *
          (Math.exp(-eps * (t - te)) - Math.exp(-eps * (tc - te)));
      out[i] = v;
      sum += v;
    }
    return sum / n;
  };
  // alpha makes the net flow zero (the derivative integrates to 0)
  const out = new Float64Array(n);
  let lo = -50;
  let hi = 200;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (shape(mid, out) > 0) hi = mid;
    else lo = mid;
  }
  shape((lo + hi) / 2, out);
  // remove residual DC exactly
  let mean = 0;
  for (const v of out) mean += v;
  mean /= n;
  for (let i = 0; i < n; i += 1) out[i] = out[i]! - mean;
  return out;
}

let tables: Float64Array[] | undefined;
function lfTables(): Float64Array[] {
  if (!tables) {
    tables = [];
    for (let i = 0; i < RD_COUNT; i += 1)
      tables.push(lfTable(RD_MIN + i * RD_STEP, GLOTTAL_TABLE));
  }
  return tables;
}

/**
 * Band-limited mip levels (review fix: the single table aliased badly at
 * 22,050 Hz). Each Rd table is truncated by FFT to its first H harmonics,
 * H on a half-octave grid. A voice at f0 reads the two levels below
 * nmax = fs / (2 f0) and crossfades between them by log(nmax), so the
 * output never holds a harmonic above Nyquist and the timbre moves
 * continuously with pitch (no level jumps under vibrato). The build stores
 * Float32 tables of size max(64, 8 H) rounded up to a power of two
 * (about 0.6 MB for 25 Rd x 19 levels).
 */
export const MIP_HARMONICS = [
  2, 3, 4, 6, 8, 11, 16, 23, 32, 45, 64, 91, 128, 181, 256, 362, 512, 724, 1023,
];
let mips: Float64Array[][] | undefined; // [level][rd]
function truncate(src: Float64Array, harmonics: number): Float64Array {
  const n = src.length;
  const re = Float64Array.from(src);
  const im = new Float64Array(n);
  fftInPlace(re, im);
  for (let k = 0; k < n; k += 1) {
    const h = k <= n / 2 ? k : n - k;
    if (h > harmonics) {
      re[k] = 0;
      im[k] = 0;
    }
  }
  fftInPlace(re, im, true);
  for (let i = 0; i < n; i += 1) re[i] = re[i]! / n;
  return re;
}
function mipTables(): Float64Array[][] {
  if (!mips) {
    const base = lfTables();
    mips = MIP_HARMONICS.map((h) => base.map((t) => truncate(t, h)));
  }
  return mips;
}

function readLevel(
  level: Float64Array[],
  ri: number,
  rf: number,
  i0: number,
  i1: number,
  pf: number,
): number {
  const a = level[ri]!;
  const b = level[ri + 1]!;
  const va = a[i0]! + (a[i1]! - a[i0]!) * pf;
  const vb = b[i0]! + (b[i1]! - b[i0]!) * pf;
  return va + (vb - va) * rf;
}

/**
 * LF flow derivative at `phase` in [0,1) for voice quality `rd`; peak
 * excitation -1. `inc` is f0 / sampleRate: when given, the read is
 * band-limited (mip levels); without it, the full table (aliases; kept
 * only to measure the difference).
 */
// The mip level choice depends only on `inc`, which changes once per period
// or control step: memoised so the per-sample cost is the table reads.
let lastInc = Number.NaN;
let lastLevel = 0;
let lastBlend = 0;
function chooseLevel(inc: number): void {
  lastInc = inc;
  const nmax = 0.5 / Math.max(inc, 1e-9);
  let j = 0;
  while (j + 1 < MIP_HARMONICS.length && MIP_HARMONICS[j + 1]! <= nmax) j += 1;
  if (j === 0 || MIP_HARMONICS[j]! > nmax) {
    lastLevel = 0;
    lastBlend = -1;
    return;
  }
  // blend level j-1 (weight 1-f) and level j (weight f): both are below nmax
  const top =
    j + 1 < MIP_HARMONICS.length
      ? MIP_HARMONICS[j + 1]!
      : MIP_HARMONICS[j]! * Math.SQRT2;
  lastLevel = j;
  lastBlend = Math.min(
    1,
    Math.log(nmax / MIP_HARMONICS[j]!) / Math.log(top / MIP_HARMONICS[j]!),
  );
}

/**
 * Builds the LF tables and their mip levels now (about 50 ms) instead of on
 * the first sounding sample, so a live key never pays for them. Idempotent.
 */
export function warmGlottal(): void {
  mipTables();
}

/**
 * LF flow derivative at `phase` in [0,1) for voice quality `rd`; peak
 * excitation -1. `inc` is f0 / sampleRate: when given, the read is
 * band-limited (mip levels); without it, the full table (aliases; kept
 * only to measure the difference).
 */
export function glottal(phase: number, rd: number, inc?: number): number {
  const r = (Math.min(RD_MAX, Math.max(RD_MIN, rd)) - RD_MIN) / RD_STEP;
  const ri = Math.min(RD_COUNT - 2, Math.floor(r));
  const rf = r - ri;
  const p = phase * GLOTTAL_TABLE;
  const pi = Math.floor(p);
  const pf = p - pi;
  const i0 = pi % GLOTTAL_TABLE;
  const i1 = (pi + 1) % GLOTTAL_TABLE;
  if (inc === undefined) return readLevel(lfTables(), ri, rf, i0, i1, pf);
  const m = mipTables();
  if (inc !== lastInc) chooseLevel(inc);
  const j = lastLevel;
  if (lastBlend < 0) return readLevel(m[0]!, ri, rf, i0, i1, pf);
  const lo = readLevel(m[j - 1]!, ri, rf, i0, i1, pf);
  const hi = readLevel(m[j]!, ri, rf, i0, i1, pf);
  return lo + (hi - lo) * lastBlend;
}

/** Open-phase weight (1 while the glottis is open) for breath-noise gating. */
let owRd = Number.NaN;
let owTe = 0;
export function openWeight(phase: number, rd: number): number {
  if (rd !== owRd) {
    const rk = (22.4 + 11.8 * rd) / 100;
    const ra = (-1 + 4.8 * rd) / 100;
    const rg = rk / (4 * ((0.11 * rd) / (0.5 + 1.2 * rk) - ra));
    owRd = rd;
    owTe = Math.min(0.98, (1 / (2 * rg)) * (1 + rk));
  }
  const te = owTe;
  return phase < te ? 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / te) : 0.15;
}
