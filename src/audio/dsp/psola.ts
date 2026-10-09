/**
 * Time-varying TD-PSOLA (Moulines and Charpentier, Speech Communication
 * 1990) for 0.7 Voice. Analysis marks sit one per period on voiced runs;
 * two-period Hann grains are re-spaced at the corrected period and
 * overlap-added at the same time position, so duration is kept and the
 * spectral envelope (formants) stays where it was. Unvoiced stretches are
 * copied with fixed 4 ms grains at ratio 1, so breath and consonants pass
 * through unchanged.
 *
 * Review fixes over the prototype: mark polarity is chosen once per voiced
 * run (the sign of sum x^3), so negative-going glottal closures and inverted
 * microphones mark the same way every period; grains are placed at
 * fractional output positions with 4-point Hermite reads instead of a 2-tap
 * split; stereo shares one set of marks found on the mid signal.
 *
 * Autotune and the 0.7.1 harmony lane import these unchanged.
 */
import { hermiteAt } from "./interp.ts";

/** Unvoiced grain spacing in seconds. */
export const UNVOICED_PERIOD = 0.004;

/** What a psola pass does, per input sample. */
export type ShiftCurve = Readonly<{
  /** Input f0 in Hz per input sample (0 = unvoiced). */
  f0: Float64Array;
  /** Shift in cents per input sample (ignored where unvoiced). */
  cents: Float64Array;
}>;

export type PsolaOptions = Readonly<{
  /**
   * Formant factor: grains are read this many times faster, which moves the
   * spectral envelope by the same ratio (1 keeps it, the default). Limited to
   * 0.5..2.
   */
  formant?: number;
  /** First input sample of the output (default 0). */
  offset?: number;
  /** Output length in samples (default the rest of the input). */
  length?: number;
  /** Precomputed analysis marks (from `pitchMarks`), e.g. shared by L/R. */
  marks?: Int32Array;
}>;

/**
 * Analysis marks: one per period at the waveform's largest peak (in the
 * run's polarity) near the expected place, and one every 4 ms where
 * unvoiced.
 */
export function pitchMarks(
  x: Float64Array,
  sampleRate: number,
  f0: Float64Array,
): Int32Array {
  const n = x.length;
  const up = Math.max(1, Math.round(UNVOICED_PERIOD * sampleRate));
  const polarity = new Int8Array(n).fill(1);
  for (let a = 0; a < n;) {
    if (!(f0[a]! > 0)) {
      a += 1;
      continue;
    }
    let b = a;
    let s3 = 0;
    while (b < n && f0[b]! > 0) {
      s3 += x[b]! ** 3;
      b += 1;
    }
    if (s3 < 0) polarity.fill(-1, a, b);
    a = b;
  }
  const marks: number[] = [];
  let i = 0;
  while (i < n) {
    const hz = f0[i]!;
    if (!(hz > 0)) {
      marks.push(i);
      i += up;
      continue;
    }
    const period = sampleRate / hz;
    const last = marks.length ? marks[marks.length - 1]! : -1;
    const afterVoiced = last >= 0 && f0[last]! > 0;
    const lo = Math.max(0, Math.round(i - (afterVoiced ? period / 4 : 0)));
    const hi = Math.min(
      n - 1,
      Math.round(i + (afterVoiced ? period / 4 : period)),
    );
    const sign = polarity[i]!;
    let best = lo;
    for (let j = lo + 1; j <= hi; j += 1)
      if (sign * x[j]! > sign * x[best]!) best = j;
    if (last >= 0 && best <= last)
      best = last + Math.max(1, Math.round(period / 2));
    if (best >= n) break;
    marks.push(best);
    const next = f0[best]! > 0 ? sampleRate / f0[best]! : period;
    i = best + Math.max(1, Math.round(next));
  }
  return Int32Array.from(marks);
}

/**
 * Shifts the pitch of `x` by `curve.cents` while keeping duration and (at
 * formant 1) the formants. Deterministic: same input, same bytes.
 */
export function psola(
  x: Float64Array,
  sampleRate: number,
  curve: ShiftCurve,
  options: PsolaOptions = {},
): Float64Array {
  const n = x.length;
  const offset = Math.max(0, Math.min(n, Math.round(options.offset ?? 0)));
  const length = Math.max(0, Math.round(options.length ?? n - offset));
  const out = new Float64Array(length);
  const marks = options.marks ?? pitchMarks(x, sampleRate, curve.f0);
  if (marks.length === 0 || length === 0) return out;
  const formant = Math.min(2, Math.max(0.5, options.formant ?? 1));
  const up = UNVOICED_PERIOD * sampleRate;
  const end = offset + length;
  // synthesis marks walk the output at the target period; each takes the
  // nearest analysis mark
  // The walk always starts at the first mark, so a window (offset, length)
  // renders exactly the samples of the whole pass.
  let k = 0;
  let t = marks[0]!;
  while (t < end + up) {
    while (
      k + 1 < marks.length &&
      Math.abs(marks[k + 1]! - t) <= Math.abs(marks[k]! - t)
    )
      k += 1;
    const m = marks[k]!;
    const hz = curve.f0[m]!;
    const voiced = hz > 0;
    const period = voiced ? sampleRate / hz : up;
    // the analysis spacing: the next mark when it is about a period away,
    // so ratio 1 lands every synthesis mark on its analysis mark
    const gap = k + 1 < marks.length ? marks[k + 1]! - m : 0;
    const pin = gap >= period * 0.5 && gap <= period * 1.5 ? gap : period;
    const at = Math.min(n - 1, Math.max(0, Math.round(t)));
    const ratio = voiced ? 2 ** ((curve.cents[at] || 0) / 1200) : 1;
    const pout = pin / ratio;
    // the grain spans the neighbouring marks, capped at 1.5 periods a side
    const left =
      k > 0 ? Math.min(period * 1.5, Math.max(2, m - marks[k - 1]!)) : period;
    const right =
      k + 1 < marks.length
        ? Math.min(period * 1.5, Math.max(2, marks[k + 1]! - m))
        : period;
    const f = voiced ? formant : 1;
    const gain = voiced ? Math.min(2, (pout * f) / pin) : 1;
    // output span of the grain, in output samples around t
    const lo = Math.max(offset, Math.ceil(t - left / f));
    const hi = Math.min(end - 1, Math.floor(t + right / f));
    for (let o = lo; o <= hi; o += 1) {
      const j = (o - t) * f;
      const w =
        j < 0
          ? 0.5 * (1 + Math.cos((Math.PI * j) / left))
          : 0.5 * (1 + Math.cos((Math.PI * j) / right));
      out[o - offset]! += hermiteAt(x, m + j) * w * gain;
    }
    // unvoiced grains are copied in place, so the walk re-anchors on the
    // marks there and enters every voiced run on its first mark
    t = !voiced && k + 1 < marks.length ? marks[k + 1]! : t + pout;
    if (k + 1 >= marks.length && t > m + 2 * period) break;
  }
  return out;
}

/**
 * Stereo PSOLA: marks found once on the mid signal and shared by both
 * channels, so the image does not smear. `curve.f0` comes from the mono
 * mixdown.
 */
export function psolaStereo(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  curve: ShiftCurve,
  options: PsolaOptions = {},
): [Float64Array, Float64Array] {
  const mid = new Float64Array(left.length);
  for (let i = 0; i < mid.length; i += 1)
    mid[i] = 0.5 * (left[i]! + (right[i] ?? 0));
  const marks = options.marks ?? pitchMarks(mid, sampleRate, curve.f0);
  return [
    psola(left, sampleRate, curve, { ...options, marks }),
    psola(right, sampleRate, curve, { ...options, marks }),
  ];
}

/** A constant shift of `cents` over an f0-per-sample curve. */
export function constantShift(f0: Float64Array, cents: number): ShiftCurve {
  return { f0, cents: new Float64Array(f0.length).fill(cents) };
}
