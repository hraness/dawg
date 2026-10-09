/**
 * Pitch measurement for wind calibration and tests (not on the render
 * path): Hann-windowed, zero-padded FFT, the largest bin within a window
 * around the expected fundamental, refined by a parabola on the log
 * magnitude (J. O. Smith, "Quadratic Interpolation of Spectral Peaks").
 */
import { fftInPlace } from "../dsp/fft.ts";

export type PitchReading = Readonly<{
  /** Measured fundamental, Hz. */
  hz: number;
  /** Fundamental level over the strongest partial, dB (<= 0). */
  fundamentalDb: number;
}>;

/** Magnitude spectrum of x[from..from+length), zero-padded to `size`. */
function spectrum(
  x: Float64Array,
  from: number,
  length: number,
  size: number,
): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < length; i += 1) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    re[i] = (x[from + i] ?? 0) * win;
  }
  fftInPlace(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k += 1)
    mag[k] = Math.hypot(re[k]!, im[k]!) + 1e-300;
  return mag;
}

/**
 * The fundamental near `expected` Hz in x between `fromSec` and `toSec`,
 * searched within +-`spanCents`.
 */
export function measurePitch(
  x: Float64Array,
  sampleRate: number,
  expected: number,
  fromSec = 0.2,
  toSec = 0.9,
  spanCents = 150,
): PitchReading {
  const from = Math.floor(fromSec * sampleRate);
  const length = Math.max(
    256,
    Math.min(x.length - from, Math.floor((toSec - fromSec) * sampleRate)),
  );
  let size = 1;
  while (size < length * 8) size *= 2;
  const mag = spectrum(x, from, length, size);
  const binHz = sampleRate / size;
  const lo = Math.max(
    1,
    Math.floor((expected * 2 ** (-spanCents / 1200)) / binHz),
  );
  const hi = Math.min(
    mag.length - 2,
    Math.ceil((expected * 2 ** (spanCents / 1200)) / binHz),
  );
  let best = lo;
  for (let k = lo; k <= hi; k += 1) if (mag[k]! > mag[best]!) best = k;
  const a = Math.log(mag[best - 1]!);
  const b = Math.log(mag[best]!);
  const c = Math.log(mag[best + 1]!);
  const denom = a - 2 * b + c;
  const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  let peak = 0;
  for (let k = 1; k < mag.length; k += 1) peak = Math.max(peak, mag[k]!);
  return {
    hz: (best + clampHalf(delta)) * binHz,
    fundamentalDb: 20 * Math.log10(mag[best]! / peak),
  };
}

function clampHalf(d: number): number {
  return d < -0.5 ? -0.5 : d > 0.5 ? 0.5 : d;
}

/** Spectral centroid of x over a window, Hz. */
export function spectralCentroid(
  x: Float64Array,
  sampleRate: number,
  fromSec: number,
  toSec: number,
): number {
  const from = Math.floor(fromSec * sampleRate);
  const length = Math.floor((toSec - fromSec) * sampleRate);
  let size = 1;
  while (size < length) size *= 2;
  const mag = spectrum(x, from, length, size);
  let num = 0;
  let den = 0;
  for (let k = 1; k < mag.length; k += 1) {
    const hz = (k * sampleRate) / size;
    num += hz * mag[k]!;
    den += mag[k]!;
  }
  return den > 0 ? num / den : 0;
}
