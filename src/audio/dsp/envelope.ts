/**
 * Cepstral spectral envelope (0.6 B2): the smooth outline of a magnitude
 * spectrum, used by `shift.ts` to hold formants still while the pitch moves.
 * Log magnitude, inverse transform to the real cepstrum, keep the
 * quefrencies below the lifter, forward transform, exponentiate
 * (Oppenheim and Schafer, *Discrete-Time Signal Processing*, ch. 13;
 * J. O. Smith, *Spectral Audio Signal Processing*, "Cepstral Windowing";
 * Röbel and Rodet, "Efficient spectral envelope estimation and its
 * application to pitch shifting and envelope preservation", DAFx 2005, for
 * the true-envelope iteration).
 */
import { fftInPlace } from "./fft.ts";
import { inverse } from "./stft.ts";

/**
 * Default lifter: quefrencies below 2 ms (measured on a synthetic vowel:
 * with 16 true-envelope passes F1 stays within 3% after +-7 and +-12 st at
 * 110 Hz; 1 ms smeared F1 by up to 15%).
 */
export const ENVELOPE_LIFTER_SECONDS = 0.002;
/** True-envelope passes used by `pitchShift` when keeping formants. */
export const ENVELOPE_ITERATIONS = 16;

/** Adaptive lifter as a fraction of the cepstral period. */
export const PERIOD_FRACTION = 0.25;

/** Scratch buffers for one frame size, reused across frames. */
export type EnvelopeScratch = Readonly<{
  re: Float64Array;
  im: Float64Array;
  log: Float64Array;
}>;

export function envelopeScratch(n: number): EnvelopeScratch {
  return Object.freeze({
    re: new Float64Array(n),
    im: new Float64Array(n),
    log: new Float64Array(n / 2 + 1),
  });
}

/**
 * Writes the cepstral envelope of `mag` (bins 0..n/2 of an n-point
 * spectrum) into `out` (length n/2 + 1). `lifter` is in samples (at least
 * 4). With `iterations` > 0 it is the true envelope (Röbel and Rodet 2005):
 * the log spectrum is raised to the smoothed curve wherever it lies below
 * it and smoothed again, so the envelope rides the harmonic peaks instead
 * of the valleys between them. With `periodRange` (samples) the lifter
 * shrinks to a quarter of the frame's cepstral pitch period when that is
 * shorter, so higher voices keep their harmonics out of the envelope.
 */
export function cepstralEnvelope(
  mag: Float64Array,
  n: number,
  lifter: number,
  out: Float64Array,
  scratch: EnvelopeScratch = envelopeScratch(n),
  iterations = 0,
  periodRange?: readonly [number, number],
): Float64Array {
  const half = n / 2;
  const { re, im, log } = scratch;
  let peak = 0;
  for (let k = 0; k <= half; k += 1) peak = Math.max(peak, mag[k]!);
  // Floor 120 dB under the frame's peak (silence stays finite).
  const floor = peak * 1e-6 + 1e-12;
  for (let k = 0; k <= half; k += 1) log[k] = Math.log(mag[k]! + floor);
  let cut = Math.max(4, Math.min(half, Math.round(lifter)));
  for (let pass = 0; pass <= iterations; pass += 1) {
    for (let k = 0; k < n; k += 1) {
      re[k] = log[k <= half ? k : n - k]!;
      im[k] = 0;
    }
    inverse(re, im);
    if (pass === 0 && periodRange) {
      // Pitch-adaptive lifter: a quarter of the period found as the
      // strongest cepstral peak in range, never longer than `lifter`.
      const [lo, hi] = periodRange;
      let q = Math.max(2, Math.round(lo));
      for (let i = q; i <= Math.min(half, Math.round(hi)); i += 1)
        if (re[i]! > re[q]!) q = i;
      cut = Math.max(4, Math.min(cut, Math.round(q * PERIOD_FRACTION)));
    }
    for (let q = cut; q <= n - cut; q += 1) {
      re[q] = 0;
      im[q] = 0;
    }
    fftInPlace(re, im);
    if (pass < iterations)
      for (let k = 0; k <= half; k += 1) log[k] = Math.max(log[k]!, re[k]!);
  }
  for (let k = 0; k <= half; k += 1) out[k] = Math.exp(re[k]!);
  return out;
}

/**
 * Harmonic-peak envelope (0.6.1): log magnitude interpolated linearly
 * between the spectral peaks (each refined by a parabola to its true bin
 * and height) of `mag` that stand within `range` of the
 * frame's loudest, held flat past the first and last. Between harmonics it
 * follows the line joining them instead of the smoothed valley, so it stays
 * on the formant at any pitch where the cepstral envelope (whose lifter
 * must shrink with the period) starts to smear or ripple. `smooth` (an
 * envelope from `cepstralEnvelope`) is used where no peak stands.
 * Measured with `formant 0` on a synthetic vowel: F1 within 1.1% of the
 * same vowel sung at the new pitch for f0 110-330 Hz at +-7 and +12 st
 * (the cepstral envelope alone: -29% to +46% above 200 Hz).
 */
export function peakEnvelope(
  mag: Float64Array,
  half: number,
  out: Float64Array,
  smooth: Float64Array,
  peaks: number[],
  range = 1e-4,
): Float64Array {
  let top = 0;
  for (let k = 0; k <= half; k += 1) top = Math.max(top, mag[k]!);
  peaks.length = 0;
  const floor = top * range;
  for (let k = 2; k <= half - 2; k += 1) {
    const v = mag[k]!;
    if (
      v > floor &&
      v > mag[k - 1]! &&
      v >= mag[k + 1]! &&
      v > mag[k - 2]! &&
      v >= mag[k + 2]!
    )
      peaks.push(k);
  }
  if (peaks.length < 2) {
    out.set(smooth.subarray(0, half + 1));
    return out;
  }
  // Each peak refined by a parabola on log magnitude: its true frequency
  // (fractional bin) and height.
  const at = (i: number) => {
    const k = peaks[i]!;
    const a = Math.log(mag[k - 1]! + 1e-30);
    const b = Math.log(mag[k]! + 1e-30);
    const c = Math.log(mag[k + 1]! + 1e-30);
    const d = a - 2 * b + c;
    const delta =
      d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
    return [k + delta, b - 0.25 * (a - c) * delta] as const;
  };
  let j = 0;
  let [x0, y0] = at(0);
  let [x1, y1] = at(1);
  for (let k = 0; k <= half; k += 1) {
    while (j + 2 < peaks.length && x1 <= k) {
      j += 1;
      [x0, y0] = [x1, y1];
      [x1, y1] = at(j + 1);
    }
    const t = Math.max(0, Math.min(1, (k - x0) / (x1 - x0)));
    out[k] = Math.exp(y0 + (y1 - y0) * t);
  }
  return out;
}
