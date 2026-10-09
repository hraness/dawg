/**
 * Pitch shift at constant duration (0.6 B2 `shift`, `formant`), ported from
 * the granular prototype (`proto/granular/stretch.ts` `pitchShift`):
 * phase-vocoder stretch by rho = 2^(st/12) onto an intermediate axis (bins
 * above Nyquist/rho dropped so the read-back cannot alias), then read it
 * rho times faster with a 4-point Hermite, so the length is kept exactly.
 *
 * Formants: absent follows the pitch (like a tape); a number moves them
 * that many semitones from where they were, so `0` keeps them (cepstral
 * envelope from `envelope.ts`: magnitudes are divided by the frame's
 * envelope and multiplied by the envelope warped to where it must land
 * after the read-back). Identity phase locking after Laroche and Dolson,
 * "Improved phase vocoder time-scale modification of audio", IEEE TSAP 1999.
 * Strudel's `stretch` (superdough's phase-vocoder worklet) is the same idea.
 */
import {
  ENVELOPE_ITERATIONS,
  ENVELOPE_LIFTER_SECONDS,
  cepstralEnvelope,
  envelopeScratch,
  peakEnvelope,
} from "./envelope.ts";
import { hermite4 } from "./interp.ts";
import {
  HANN_SQUARED_OLA_QUARTER,
  analyse,
  frameSize,
  hann,
  inverse,
  princarg,
  sampleAt,
} from "./stft.ts";

/** Analysis frame, as the `tones` fit (85 ms). */
export const SHIFT_FRAME_SECONDS = 0.085;
/** Vocoder hops between yields of `pitchShiftJob`. */
const SHIFT_YIELD_HOPS = 16;
/** Largest per-frame level restore after formant correction (12 dB). */
const FORMANT_LEVEL_CAP = 4;
/** Largest formant correction gain (24 dB), so a deep envelope dip cannot explode. */
const MAX_FORMANT_GAIN = 16;

export type ShiftOptions = Readonly<{
  /** Formant shift in semitones; 0 keeps them; absent follows the pitch. */
  formant?: number;
  /** Frame length in seconds (rounded up to a power of two). */
  frame?: number;
  /** Cepstral lifter in seconds. */
  lifter?: number;
  /** True-envelope passes (0 is the plain cepstral envelope; default 16). */
  iterations?: number;
  /** Shrink the lifter to a quarter pitch period per frame (default on). */
  adaptive?: boolean;
  /**
   * Envelope used to keep formants: "peaks" (default) joins the harmonic
   * peaks; "cepstral" is the true cepstral envelope alone.
   */
  envelope?: "peaks" | "cepstral";
}>;

/**
 * Phase vocoder reading `x` at `t / rho` for `outLength` frames, with
 * bins above Nyquist/rho removed and optional formant correction for a
 * later read-back at `rho`.
 */
function* stretchForShift(
  x: ArrayLike<number>,
  sampleRate: number,
  rho: number,
  outLength: number,
  formantRatio: number | undefined,
  options: ShiftOptions,
): Generator<void, Float64Array> {
  const n = frameSize(options.frame ?? SHIFT_FRAME_SECONDS, sampleRate);
  const hs = n / 4;
  const half = n / 2;
  const w = hann(n);
  const norm = 1 / HANN_SQUARED_OLA_QUARTER;
  const keep = rho > 1 ? Math.floor(half / rho) : half;
  const lifter = Math.max(
    4,
    Math.round((options.lifter ?? ENVELOPE_LIFTER_SECONDS) * sampleRate),
  );
  const periodRange = [sampleRate / 800, sampleRate / 50] as const;
  const out = new Float64Array(outLength + n);
  const reA = new Float64Array(n);
  const imA = new Float64Array(n);
  const reB = new Float64Array(n);
  const imB = new Float64Array(n);
  const mag = new Float64Array(half + 1);
  const phA = new Float64Array(half + 1);
  const syn = new Float64Array(half + 1);
  const next = new Float64Array(half + 1);
  const omega = new Float64Array(half + 1);
  const env = new Float64Array(half + 1);
  const scratch = envelopeScratch(n);
  const smooth = new Float64Array(half + 1);
  const envPeaks: number[] = [];
  const peaks: number[] = [];
  for (let m = 0; m * hs < outLength; m += 1) {
    if (m % SHIFT_YIELD_HOPS === SHIFT_YIELD_HOPS - 1) yield;
    const at = Math.round((m * hs + half) / rho - half);
    analyse(x, at, w, reA, imA);
    analyse(x, at - hs, w, reB, imB);
    for (let k = 0; k <= half; k += 1) {
      mag[k] = Math.hypot(reA[k]!, imA[k]!);
      phA[k] = Math.atan2(imA[k]!, reA[k]!);
      const phB = Math.atan2(imB[k]!, reB[k]!);
      const bin = (2 * Math.PI * k * hs) / n;
      omega[k] = bin + princarg(phA[k]! - phB - bin);
    }
    if (formantRatio !== undefined)
      cepstralEnvelope(
        mag,
        n,
        lifter,
        env,
        scratch,
        options.iterations ?? ENVELOPE_ITERATIONS,
        options.adaptive === false ? undefined : periodRange,
      );
    if (formantRatio !== undefined && options.envelope !== "cepstral") {
      smooth.set(env);
      peakEnvelope(mag, half, env, smooth, envPeaks);
    }
    if (m === 0) syn.set(phA);
    else {
      peaks.length = 0;
      for (let k = 2; k <= half - 2; k += 1) {
        const v = mag[k]!;
        if (
          v > mag[k - 1]! &&
          v >= mag[k + 1]! &&
          v > mag[k - 2]! &&
          v >= mag[k + 2]!
        )
          peaks.push(k);
      }
      if (peaks.length === 0)
        for (let k = 0; k <= half; k += 1) syn[k] = syn[k]! + omega[k]!;
      else {
        for (const p of peaks) next[p] = syn[p]! + omega[p]!;
        let j = 0;
        for (let k = 0; k <= half; k += 1) {
          while (
            j + 1 < peaks.length &&
            Math.abs(peaks[j + 1]! - k) < Math.abs(peaks[j]! - k)
          )
            j += 1;
          const p = peaks[j]!;
          if (k !== p) next[k] = next[p]! + phA[k]! - phA[p]!;
        }
        syn.set(next);
      }
    }
    let before = 0;
    let after = 0;
    for (let k = 0; k <= half; k += 1) {
      let a = k > keep ? 0 : mag[k]!;
      before += a * a;
      if (formantRatio !== undefined && a > 0) {
        // Bin k lands at k*rho after the read-back; give it the envelope
        // found at k*rho/formantRatio in the source frame.
        const src = (k * rho) / formantRatio;
        const i0 = Math.floor(src);
        const target =
          i0 + 1 <= half
            ? env[i0]! + (env[i0 + 1]! - env[i0]!) * (src - i0)
            : env[half]! * 1e-3;
        a *= Math.min(target / env[k]!, MAX_FORMANT_GAIN);
      }
      after += a * a;
      reA[k] = a * Math.cos(syn[k]!);
      imA[k] = a * Math.sin(syn[k]!);
      if (k > 0 && k < half) {
        reA[n - k] = reA[k]!;
        imA[n - k] = -imA[k]!;
      }
    }
    imA[0] = 0;
    imA[half] = 0;
    // Formant correction reshapes the spectrum, not the loudness: give the
    // frame back its energy (a scale moves no peak), capped at 12 dB.
    if (formantRatio !== undefined && after > 0) {
      const gain = Math.min(Math.sqrt(before / after), FORMANT_LEVEL_CAP);
      for (let k = 0; k < n; k += 1) {
        reA[k] = reA[k]! * gain;
        imA[k] = imA[k]! * gain;
      }
    }
    inverse(reA, imA);
    const o0 = m * hs;
    for (let i = 0; i < n; i += 1)
      out[o0 + i] = out[o0 + i]! + reA[i]! * w[i]! * norm;
  }
  return out;
}

/**
 * `x` shifted by `semitones` at the same length. `formant` (semitones)
 * moves the formants independently; 0 keeps them.
 */
export function pitchShift(
  x: ArrayLike<number>,
  sampleRate: number,
  semitones: number,
  options: ShiftOptions = {},
): Float32Array {
  const job = pitchShiftJob(x, sampleRate, semitones, options);
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

/**
 * `pitchShift` as resumable work: yields every few vocoder hops so a live
 * engine can spread a long shift over idle time (`src/audio/fit.ts`).
 */
export function* pitchShiftJob(
  x: ArrayLike<number>,
  sampleRate: number,
  semitones: number,
  options: ShiftOptions = {},
): Generator<void, Float32Array> {
  const length = x.length;
  const out = new Float32Array(length);
  if (semitones === 0 && options.formant === undefined) {
    for (let i = 0; i < length; i += 1) out[i] = x[i]!;
    return out;
  }
  const rho = 2 ** (semitones / 12);
  const formantRatio =
    options.formant === undefined ? undefined : 2 ** (options.formant / 12);
  const midLength = Math.ceil(length * rho) + 4;
  const y = yield* stretchForShift(
    x,
    sampleRate,
    rho,
    midLength,
    formantRatio,
    options,
  );
  for (let i = 0; i < length; i += 1) {
    const pos = i * rho;
    const j = Math.floor(pos);
    out[i] = hermite4(
      sampleAt(y, j - 1),
      sampleAt(y, j),
      sampleAt(y, j + 1),
      sampleAt(y, j + 2),
      pos - j,
    );
  }
  return out;
}
