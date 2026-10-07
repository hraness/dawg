/**
 * Convolution reverb for `reverb.ir` (Strudel `iresponse`/`ir`): the track's
 * stereo pair, summed to mono, is convolved with a stereo impulse response
 * by uniformly partitioned overlap-save FFT convolution.
 *
 * The impulse is cut into P blocks of B samples; each block's spectrum is
 * kept once. Every input block is transformed once, multiplied with the
 * last P input spectra (a frequency-domain delay line) and transformed back,
 * so the cost per sample is O(P + log B) instead of O(IR length). Left and
 * right impulses share one transform: G = FFT(hL + i·hR), and because the
 * input is real, Re(IFFT(X·G)) is the left output and Im(…) the right.
 *
 * Built-in impulses (`builtin:room`, `builtin:hall`, `builtin:plate`) are
 * generated from a seeded integer PRNG, so they need no files and are
 * identical on every render path. Everything here is plain float64
 * arithmetic over fixed loops: deterministic. Clean-room, from standard DSP
 * literature (Gardner 1995; Wefers 2015), not from any Strudel source.
 */
import { seededRandom } from "../random.ts";

/** Longest impulse a render uses, in seconds; longer files are cut. */
export const MAX_IMPULSE_SECONDS = 10;

/** A stereo impulse response at the render rate, energy-normalized. */
export type Impulse = Readonly<{
  /** Stable identity for stem cache keys. */
  id: string;
  left: Float64Array;
  right: Float64Array;
}>;

type Twiddles = { cos: Float64Array; sin: Float64Array; rev: Uint32Array };
const TWIDDLES = new Map<number, Twiddles>();

function twiddles(n: number): Twiddles {
  let table = TWIDDLES.get(n);
  if (table) return table;
  const cos = new Float64Array(n >> 1);
  const sin = new Float64Array(n >> 1);
  for (let k = 0; k < n >> 1; k += 1) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    rev[i] = j;
  }
  table = { cos, sin, rev };
  TWIDDLES.set(n, table);
  return table;
}

/**
 * In-place radix-2 complex FFT with cached tables. `inverse` uses e^{+i}
 * and no scaling (inverse(forward(x)) = n·x).
 */
export function fftInPlace(
  re: Float64Array,
  im: Float64Array,
  inverse = false,
): void {
  const n = re.length;
  const { cos, sin, rev } = twiddles(n);
  for (let i = 1; i < n; i += 1) {
    const j = rev[i]!;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length <<= 1) {
    const half = length >> 1;
    const stride = n / length;
    for (let k = 0; k < half; k += 1) {
      const wr = cos[k * stride]!;
      const wi = sign * sin[k * stride]!;
      for (let a = k; a < n; a += length) {
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
      }
    }
  }
}

function nextPow2(value: number): number {
  let n = 1;
  while (n < value) n <<= 1;
  return n;
}

/** Partition size for an impulse: large blocks offline, a few partitions. */
export function partitionSize(impulseLength: number): number {
  return Math.min(32_768, Math.max(512, nextPow2(impulseLength) >> 3));
}

/**
 * Adds `gain`·(input ∗ impulse) to `outL`/`outR` (same length as `input`;
 * the tail past the end is dropped, as with every other effect).
 * `gainAt`, when given, is sampled per output sample instead of `gain`.
 */
export function convolveStereo(
  input: Float64Array,
  impulse: Impulse,
  outL: Float64Array,
  outR: Float64Array,
  gain: number,
  gainAt?: (index: number) => number,
): void {
  const length = input.length;
  const irLength = impulse.left.length;
  if (length === 0 || irLength === 0) return;
  const block = partitionSize(irLength);
  const n = block * 2;
  const partitions = Math.ceil(irLength / block);
  // Impulse partition spectra G_p = FFT(hL_p + i·hR_p), zero-padded to n.
  const gRe: Float64Array[] = [];
  const gIm: Float64Array[] = [];
  for (let p = 0; p < partitions; p += 1) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const start = p * block;
    const end = Math.min(irLength, start + block);
    for (let i = start; i < end; i += 1) {
      re[i - start] = impulse.left[i]!;
      im[i - start] = impulse.right[i]!;
    }
    fftInPlace(re, im);
    gRe.push(re);
    gIm.push(im);
  }
  // Frequency-domain delay line of input spectra (ring of `partitions`).
  const xRe = Array.from({ length: partitions }, () => new Float64Array(n));
  const xIm = Array.from({ length: partitions }, () => new Float64Array(n));
  const accRe = new Float64Array(n);
  const accIm = new Float64Array(n);
  const blocks = Math.ceil(length / block);
  const scale = 1 / n;
  for (let k = 0; k < blocks; k += 1) {
    const slot = k % partitions;
    const re = xRe[slot]!;
    const im = xIm[slot]!;
    // Window: previous block then this block.
    const base = (k - 1) * block;
    for (let i = 0; i < n; i += 1) {
      const at = base + i;
      re[i] = at >= 0 && at < length ? input[at]! : 0;
      im[i] = 0;
    }
    fftInPlace(re, im);
    accRe.fill(0);
    accIm.fill(0);
    for (let p = 0; p < partitions && p <= k; p += 1) {
      const source = (slot - p + partitions) % partitions;
      const ar = xRe[source]!;
      const ai = xIm[source]!;
      const br = gRe[p]!;
      const bi = gIm[p]!;
      for (let i = 0; i < n; i += 1) {
        const r = ar[i]!;
        const m = ai[i]!;
        accRe[i]! += r * br[i]! - m * bi[i]!;
        accIm[i]! += r * bi[i]! + m * br[i]!;
      }
    }
    fftInPlace(accRe, accIm, true);
    const outStart = k * block;
    const count = Math.min(block, length - outStart);
    for (let i = 0; i < count; i += 1) {
      const index = outStart + i;
      const g = (gainAt ? gainAt(index) : gain) * scale;
      outL[index]! += accRe[block + i]! * g;
      outR[index]! += accIm[block + i]! * g;
    }
  }
}

/** Built-in impulse names (`builtin:<name>`). */
export const BUILTIN_IMPULSES = Object.freeze({
  room: { title: "small room", seconds: 0.7, damp: 6000, early: 7, attack: 0 },
  hall: {
    title: "concert hall",
    seconds: 2.8,
    damp: 4500,
    early: 5,
    attack: 0.06,
  },
  plate: { title: "plate", seconds: 1.8, damp: 9000, early: 0, attack: 0 },
} as const);
export type BuiltinImpulse = keyof typeof BUILTIN_IMPULSES;

const BUILTIN_CACHE = new Map<string, Impulse>();

/**
 * A generated stereo impulse: early reflections (seeded taps in the first
 * 40 ms) then decorrelated noise per side with an exact -60 dB decay at
 * `seconds`, a fade-in over `attack` (diffuse build-up of a large hall) and
 * a one-pole low-pass that closes from 16 kHz toward `damp` as the tail
 * decays, so it darkens like air absorption.
 */
export function builtinImpulse(
  name: string,
  sampleRate: number,
): Impulse | undefined {
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_IMPULSES, name))
    return undefined;
  const key = `${name}@${sampleRate}`;
  const cached = BUILTIN_CACHE.get(key);
  if (cached) return cached;
  const spec = BUILTIN_IMPULSES[name as BuiltinImpulse];
  const length = Math.max(1, Math.round(spec.seconds * sampleRate));
  const sides = ["L", "R"].map((side) => {
    const random = seededRandom(`dawg-ir:${name}:${side}`);
    const out = new Float64Array(length);
    const decay = Math.log(1000) / spec.seconds;
    let state = 0;
    for (let index = 0; index < length; index += 1) {
      const t = index / sampleRate;
      const progress = t / spec.seconds;
      const cutoff = 16_000 * (spec.damp / 16_000) ** progress;
      const coefficient =
        1 -
        Math.exp(
          (-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate,
        );
      state += coefficient * (random() * 2 - 1 - state);
      const build = spec.attack > 0 ? Math.min(1, t / spec.attack) : 1;
      out[index] = state * Math.exp(-decay * t) * build;
    }
    for (let tap = 0; tap < spec.early; tap += 1) {
      const at = Math.floor((0.004 + random() * 0.036) * sampleRate);
      if (at < length)
        out[at]! += (random() < 0.5 ? -1 : 1) * (0.9 - tap * 0.08);
    }
    return out;
  });
  const impulse = normalizeImpulse(`builtin:${name}`, sides[0]!, sides[1]!);
  BUILTIN_CACHE.set(key, impulse);
  return impulse;
}

/**
 * An impulse from a decoded sample (mono, any rate): resampled linearly to
 * the render rate, cut to `MAX_IMPULSE_SECONDS`, energy-normalized; both
 * sides play the same response.
 */
export function sampleImpulse(
  id: string,
  mono: Float32Array,
  sourceRate: number,
  sampleRate: number,
): Impulse {
  const length = Math.max(
    1,
    Math.min(
      Math.round((mono.length * sampleRate) / sourceRate),
      Math.round(MAX_IMPULSE_SECONDS * sampleRate),
    ),
  );
  const out = new Float64Array(length);
  const step = sourceRate / sampleRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const base = Math.floor(position);
    const a = mono[Math.min(mono.length - 1, base)] ?? 0;
    const b = mono[Math.min(mono.length - 1, base + 1)] ?? 0;
    out[index] = a + (b - a) * (position - base);
  }
  return normalizeImpulse(id, out, out);
}

/** Scales both sides so the mean energy per side is 1 (silence stays 0). */
function normalizeImpulse(
  id: string,
  left: Float64Array,
  right: Float64Array,
): Impulse {
  let energy = 0;
  for (let index = 0; index < left.length; index += 1)
    energy += left[index]! * left[index]! + right[index]! * right[index]!;
  const scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 0;
  const l = new Float64Array(left.length);
  const r = new Float64Array(right.length);
  for (let index = 0; index < left.length; index += 1) {
    l[index] = left[index]! * scale;
    r[index] = right[index]! * scale;
  }
  return Object.freeze({ id, left: l, right: r });
}
