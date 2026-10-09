/**
 * Formant shift at constant pitch (0.7 `fx.formant`): the throat or gender
 * knob. Per STFT frame the cepstral spectral envelope E is taken and each
 * bin is scaled by E(k / a) / E(k), a = 2^(shift / 12), with its phase left
 * untouched, then the frames overlap-add. The pitch never moves, so no
 * phase vocoder is needed (Röbel and Rodet, "Efficient spectral envelope
 * estimation and its application to pitch shifting and envelope
 * preservation", DAFx 2005; Little AlterBoy and VocalSynth's formant knob).
 *
 * The lifter adapts to the voice: 0.75 periods of a 5-frame median
 * autocorrelation f0, clamped to 1-2 ms, 1 ms when unvoiced. A fixed 2 ms
 * lifter resolves single harmonics above about 500 Hz and makes high
 * voices worse than no processing (design formant.md section 2).
 *
 * Frames sit at multiples of the hop in absolute track samples (an
 * arranged window passes its origin as `seedSeconds`), and a window padded
 * back by `FORMANT_PAD` samples and forward by one frame equals the same
 * span of a full render bit for bit.
 */
import type { FxValues } from "../../../core/fx.ts";
import type { Track } from "../../../core/score.ts";
import { cepstralEnvelope, envelopeScratch } from "../dsp/envelope.ts";
import { fftInPlace } from "../dsp/fft.ts";
import { hann, HANN_SQUARED_OLA_QUARTER } from "../dsp/stft.ts";
import { fxReader, type EffectContext } from "./common.ts";

/** Per-bin gain clamp (24 dB), as shift.ts holds formants. */
const MAX_GAIN = 10 ** (24 / 20);
/** Lifter periods and clamps (design formant.md section 2). */
const LIFTER_PERIODS = 0.75;
const LIFTER_MIN_SECONDS = 0.001;
const LIFTER_MAX_SECONDS = 0.002;
/** Frames in the f0 median (this one and the four before it). */
const F0_MEDIAN = 5;
const F0_MIN_HZ = 60;
const F0_MAX_HZ = 1500;
/** Below this normalized autocorrelation a frame counts as unvoiced. */
const VOICED = 0.45;
/** The first peak within this fraction of the best is the period. */
const FIRST_PEAK = 0.85;

/** Frame length: 1024 at or below 24 kHz, 2048 above. */
export function formantFrame(sampleRate: number): number {
  return sampleRate > 24_000 ? 2048 : 1024;
}

/**
 * Samples a window render must start before its first output sample (4
 * hops for the f0 median plus one frame), and it renders one frame past
 * its last.
 */
export function formantPad(sampleRate: number): number {
  const n = formantFrame(sampleRate);
  return n + 4 * (n / 4);
}

export type FormantShiftOptions = Readonly<{
  /** Wet amount 0..1 (1: fully shifted). */
  mix?: number | ((index: number) => number);
  /** Absolute track sample of `x[0]`; frames anchor at hop multiples of it. */
  origin?: number;
}>;

type Analysis = {
  n: number;
  hop: number;
  win: Float64Array;
  wac: Float64Array;
  minLag: number;
  maxLag: number;
};

const analyses = new Map<number, Analysis>();

function analysisFor(sampleRate: number): Analysis {
  let a = analyses.get(sampleRate);
  if (a) return a;
  const n = formantFrame(sampleRate);
  const win = hann(n);
  const minLag = Math.floor(sampleRate / F0_MAX_HZ);
  const maxLag = Math.min(n / 2 - 1, Math.ceil(sampleRate / F0_MIN_HZ));
  // The window's own autocorrelation, divided out so long lags are not
  // biased down (Boersma 1993).
  const wac = new Float64Array(maxLag + 1);
  for (let t = 0; t <= maxLag; t += 1) {
    let sum = 0;
    for (let i = 0; i + t < n; i += 1) sum += win[i]! * win[i + t]!;
    wac[t] = sum;
  }
  a = { n, hop: n / 4, win, wac, minLag, maxLag };
  analyses.set(sampleRate, a);
  return a;
}

/** One frame's f0 from its power spectrum (0: unvoiced). */
function frameF0(
  mag: Float64Array,
  a: Analysis,
  sampleRate: number,
  re: Float64Array,
  im: Float64Array,
): number {
  const { n, wac, minLag, maxLag } = a;
  const half = n / 2;
  for (let k = 0; k <= half; k += 1) {
    re[k] = mag[k]! * mag[k]!;
    im[k] = 0;
    if (k > 0 && k < half) {
      re[n - k] = re[k]!;
      im[n - k] = 0;
    }
  }
  fftInPlace(re, im, true);
  const r0 = re[0]!;
  if (r0 <= 1e-12) return 0;
  const w0 = wac[0]! / r0;
  for (let t = minLag - 1; t <= maxLag; t += 1) re[t] = (re[t]! * w0) / wac[t]!;
  let best = 0;
  for (let t = minLag; t <= maxLag; t += 1) best = Math.max(best, re[t]!);
  if (best < VOICED) return 0;
  for (let t = minLag + 1; t < maxLag; t += 1) {
    const v = re[t]!;
    if (v >= FIRST_PEAK * best && v >= re[t - 1]! && v >= re[t + 1]!) {
      const l = re[t - 1]!;
      const r = re[t + 1]!;
      const d = l - 2 * v + r;
      const offset = d < 0 ? (0.5 * (l - r)) / d : 0;
      return sampleRate / (t + offset);
    }
  }
  return 0;
}

/**
 * Shift the formants of `x` by `shift` semitones (a number, or a function
 * of the buffer index read once per hop) at constant pitch. Returns a new
 * buffer; `shift` 0 everywhere returns a copy of `x`.
 */
export function formantShift(
  x: Float64Array,
  sampleRate: number,
  shift: number | ((index: number) => number),
  options: FormantShiftOptions = {},
): Float64Array {
  if (shift === 0) return Float64Array.from(x);
  const a = analysisFor(sampleRate);
  const { n, hop, win } = a;
  const half = n / 2;
  const origin = Math.round(options.origin ?? 0);
  const out = new Float64Array(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const acRe = new Float64Array(n);
  const acIm = new Float64Array(n);
  const mag = new Float64Array(half + 1);
  const env = new Float64Array(half + 1);
  const scratch = envelopeScratch(n);
  const history = new Float64Array(F0_MEDIAN);
  const sorted = new Float64Array(F0_MEDIAN);
  let frames = 0;
  const ola = 1 / HANN_SQUARED_OLA_QUARTER;
  const auto = typeof shift === "function";
  // First frame: the latest hop multiple (absolute) whose frame still
  // reaches x[0].
  const firstAbs = Math.floor((origin - n + 1 + (hop - 1)) / hop) * hop;
  for (let start = firstAbs - origin; start < x.length; start += hop) {
    const st = auto ? shift(Math.max(0, start + half)) : shift;
    for (let i = 0; i < n; i += 1) {
      const j = start + i;
      re[i] = j >= 0 && j < x.length ? x[j]! * win[i]! : 0;
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = 0; k <= half; k += 1) mag[k] = Math.hypot(re[k]!, im[k]!);
    // Every frame joins the f0 history, so a window and the full render
    // agree whatever the shift was.
    history[frames % F0_MEDIAN] = frameF0(mag, a, sampleRate, acRe, acIm);
    frames += 1;
    if (st === 0) {
      fftInPlace(re, im, true);
    } else {
      const m = Math.min(frames, F0_MEDIAN);
      for (let i = 0; i < m; i += 1) sorted[i] = history[i]!;
      for (let i = 1; i < m; i += 1)
        for (let j = i; j > 0 && sorted[j - 1]! > sorted[j]!; j -= 1) {
          const tmp = sorted[j]!;
          sorted[j] = sorted[j - 1]!;
          sorted[j - 1] = tmp;
        }
      const f0 = sorted[m >> 1]!;
      const seconds =
        f0 > 0
          ? Math.min(
              LIFTER_MAX_SECONDS,
              Math.max(LIFTER_MIN_SECONDS, LIFTER_PERIODS / f0),
            )
          : LIFTER_MIN_SECONDS;
      const lifter = Math.max(4, Math.round(seconds * sampleRate));
      cepstralEnvelope(mag, n, lifter, env, scratch);
      const ratio = 2 ** (-st / 12);
      for (let k = 0; k <= half; k += 1) {
        const source = k * ratio;
        const i0 = Math.floor(source);
        const f = source - i0;
        const e =
          i0 >= half
            ? env[half]!
            : env[i0]! + (env[Math.min(half, i0 + 1)]! - env[i0]!) * f;
        const g = Math.min(
          MAX_GAIN,
          Math.max(1 / MAX_GAIN, e / Math.max(env[k]!, 1e-12)),
        );
        re[k] = re[k]! * g;
        im[k] = im[k]! * g;
        if (k > 0 && k < half) {
          re[n - k] = re[k]!;
          im[n - k] = -im[k]!;
        }
      }
      fftInPlace(re, im, true);
    }
    for (let i = 0; i < n; i += 1) {
      const j = start + i;
      if (j >= 0 && j < x.length)
        out[j] = out[j]! + (re[i]! / n) * win[i]! * ola;
    }
  }
  const mix = options.mix ?? 1;
  if (typeof mix === "function")
    for (let i = 0; i < x.length; i += 1)
      out[i] = x[i]! + (out[i]! - x[i]!) * mix(i);
  else if (mix < 1)
    for (let i = 0; i < x.length; i += 1)
      out[i] = x[i]! + (out[i]! - x[i]!) * mix;
  return out;
}

/** `fx.formant`: formant shift with mix, both automatable. */
export function applyFormant(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "formant", values, context);
  const shift = read.param("shift");
  const mix = read.param("mix");
  if (!shift.automated && shift.fallback === 0) return;
  if (!mix.automated && mix.fallback <= 0) return;
  const origin = context.seedSeconds
    ? Math.round(context.seedSeconds * context.sampleRate)
    : 0;
  const out = formantShift(
    buffer,
    context.sampleRate,
    shift.automated ? (index) => shift.at(index) : shift.fallback,
    {
      origin,
      mix: mix.automated ? (index) => mix.at(index) : mix.fallback,
    },
  );
  buffer.set(out);
}
