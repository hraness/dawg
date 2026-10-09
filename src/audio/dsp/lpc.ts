/**
 * Linear prediction (0.7 talkbox): autocorrelation with a deterministic
 * white-noise floor and a 60 Hz Gaussian lag window, and Levinson-Durbin.
 */

/** Autocorrelation r[0..order] of `x` into `r`. */
export function autocorrelate(
  x: Float64Array,
  order: number,
  r: Float64Array,
  sampleRate: number,
): Float64Array {
  for (let lag = 0; lag <= order; lag += 1) {
    let s = 0;
    for (let i = lag; i < x.length; i += 1) s += x[i]! * x[i - lag]!;
    r[lag] = s;
  }
  r[0] = r[0]! * (1 + 1e-6) + 1e-12;
  for (let lag = 1; lag <= order; lag += 1)
    r[lag] =
      r[lag]! * Math.exp(-0.5 * ((2 * Math.PI * 60 * lag) / sampleRate) ** 2);
  return r;
}

/**
 * Levinson-Durbin: predictor `a` (a[0] = 1) from autocorrelation `r`.
 * Returns the prediction error (0 when the recursion goes unstable).
 */
export function levinson(
  r: Float64Array,
  order: number,
  a: Float64Array,
): number {
  a.fill(0);
  a[0] = 1;
  let err = r[0]!;
  if (err <= 0) return 0;
  const tmp = new Float64Array(order + 1);
  for (let i = 1; i <= order; i += 1) {
    let acc = r[i]!;
    for (let j = 1; j < i; j += 1) acc += a[j]! * r[i - j]!;
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j += 1) a[j] = tmp[j]! + k * tmp[i - j]!;
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return 0;
  }
  return err;
}
