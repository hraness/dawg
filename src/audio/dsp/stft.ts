/**
 * Short-time Fourier helpers on the shared radix-2 FFT (`fft.ts`): frame
 * sizes, a periodic Hann window, windowed frame reads and magnitude spectra.
 * Pure functions on Float64Array buffers; zero outside the signal.
 */
import { fftInPlace } from "./fft.ts";

/** Smallest power of two at or above `value` (at least 1). */
export function nextPow2(value: number): number {
  let n = 1;
  while (n < value) n <<= 1;
  return n;
}

/** Power-of-two frame length covering `seconds` at `sampleRate`. */
export function frameSize(seconds: number, sampleRate: number): number {
  return nextPow2(Math.max(2, seconds * sampleRate));
}

/** Periodic Hann window: sums to a constant at 50 % and 75 % overlap. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Sum of a periodic Hann squared over its hops at hop n/4: 1.5. */
export const HANN_SQUARED_OLA_QUARTER = 1.5;

/** Sample `index` of `x`, zero outside it. */
export function sampleAt(x: ArrayLike<number>, index: number): number {
  return index >= 0 && index < x.length ? x[index]! : 0;
}

/** Wrap a phase to (-π, π]. */
export function princarg(phase: number): number {
  return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
}

/** Frames of hop `hop` and length `n` that fit in `length` samples. */
export function frameCount(length: number, n: number, hop: number): number {
  return Math.max(0, Math.floor((length - n) / hop) + 1);
}

/**
 * Windowed frame of `x` starting at `at` into `re` (imaginary cleared),
 * transformed in place: `re`/`im` hold the spectrum afterwards.
 */
export function analyse(
  x: ArrayLike<number>,
  at: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  const n = window.length;
  for (let i = 0; i < n; i += 1) {
    re[i] = sampleAt(x, at + i) * window[i]!;
    im[i] = 0;
  }
  fftInPlace(re, im);
}

/** Inverse transform with 1/n scaling (the shared FFT does not scale). */
export function inverse(re: Float64Array, im: Float64Array): void {
  fftInPlace(re, im, true);
  const scale = 1 / re.length;
  for (let i = 0; i < re.length; i += 1) {
    re[i] = re[i]! * scale;
    im[i] = im[i]! * scale;
  }
}
