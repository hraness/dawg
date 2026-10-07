/**
 * Wavetables from ordinary audio: a downloaded track, a stem, an imported
 * sample. The agent's `make_wavetable` tool runs this; the TUI only lists
 * the results.
 *
 * Two extraction methods:
 *
 * - `slice`: pitch-synchronous single cycles. The source's period is found
 *   with a YIN-style difference function (computed through the FFT), one
 *   period is read at each frame's time, resampled to 2048 samples with
 *   cubic interpolation, and its endpoint mismatch is spread over the cycle
 *   so the loop point does not click.
 * - `spectral`: FFT magnitude snapshots. Each frame's harmonic h takes the
 *   RMS magnitude of the source spectrum around h × the reference pitch,
 *   and every frame uses the same fixed phase per harmonic, so frames morph
 *   without phase cancellation. Good for vocals, pads and noise.
 *
 * `auto` picks `slice` when the region is clearly periodic and `spectral`
 * otherwise. Frames are phase-aligned (the fundamental starts as a rising
 * sine), optionally smoothed across neighbours in the spectral domain, and
 * normalised. All arithmetic is float64 in a fixed order and nothing is
 * random, so the same input and options always give the same bytes.
 */
import { midiToPitch } from "../../core/pitch.ts";
import { fft, MAX_FRAMES } from "./wavetable.ts";

/** Samples per frame in tables dawg writes (the Serum/Vital convention). */
export const MAKE_FRAME_SIZE = 2048;
export const MAKE_MAX_FRAMES = Math.min(256, MAX_FRAMES);
export const MAKE_DEFAULT_FRAMES = 64;
export const MAKE_METHODS = Object.freeze([
  "auto",
  "slice",
  "spectral",
] as const);
export type MakeMethod = (typeof MAKE_METHODS)[number];
export const MAKE_NORMALIZE = Object.freeze(["frame", "table", "off"] as const);
export type MakeNormalize = (typeof MAKE_NORMALIZE)[number];

/** Pitch range the detector searches. */
const MIN_F0 = 30;
const MAX_F0 = 2000;
/** Below this clarity a window counts as unpitched. */
const TONAL_CLARITY = 0.6;
/** Longest auto-picked region. */
const AUTO_REGION_SECONDS = 2;
/** Analysis windows over the whole source (bounds the cost on long files). */
const MAX_WINDOWS = 400;
/** Harmonic count of a 2048-sample frame. */
const HARMONICS = MAKE_FRAME_SIZE / 2 - 1;
/** Reference pitch for spectral frames of unpitched material (A2). */
const SPECTRAL_REFERENCE_HZ = 110;

export type MakeOptions = Readonly<{
  /** Frame count 1..256 (default 64). */
  frames?: number;
  /** Region in source seconds; both absent → auto-picked. */
  start?: number;
  end?: number;
  method?: MakeMethod;
  /** Peak-normalise each frame (default), the whole table, or nothing. */
  normalize?: MakeNormalize;
  /** Drop DC (default true; playback ignores DC either way). */
  removeDc?: boolean;
  /** Rotate frames so the fundamental starts as a rising sine (default true). */
  align?: boolean;
  /** 0..1: blend each frame with its neighbours (default 0). */
  smooth?: number;
}>;

export type DetectedPitch = Readonly<{
  hz: number;
  note: string;
  /** 0..1, how periodic the region is (1 - YIN aperiodicity). */
  clarity: number;
}>;

export type MadeWavetable = Readonly<{
  /** `frames` × 2048 samples. */
  frames: readonly Float32Array[];
  method: "slice" | "spectral";
  /** Median pitch over the region; absent for unpitched material. */
  pitch?: DetectedPitch;
  region: Readonly<{ start: number; end: number; auto: boolean }>;
  /** Per-frame spectral centroid in harmonics (power-weighted, 30 dB floor). */
  centroids: readonly number[];
  /** One paragraph on how the timbre moves across the table. */
  sweep: string;
}>;

export class WavetableMakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavetableMakeError";
  }
}

// ---------------------------------------------------------------------------
// Pitch

type PitchWindow = { time: number; hz: number; clarity: number; rms: number };

function nextPow2(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** Window length (power of two) that holds two of the longest periods. */
function pitchWindowSize(sampleRate: number): number {
  return nextPow2(2 * Math.ceil(sampleRate / MIN_F0));
}

/**
 * YIN on `signal[offset, offset + size)`: cumulative-mean-normalised
 * difference over a fixed integration window, via FFT cross-correlation.
 */
export function detectWindow(
  signal: Float32Array,
  offset: number,
  sampleRate: number,
  size = pitchWindowSize(sampleRate),
): { hz: number; clarity: number; rms: number } {
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_F0), size >> 1);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_F0));
  const integration = size - maxLag;
  const x = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const at = offset + i;
    x[i] = at >= 0 && at < signal.length ? signal[at]! : 0;
  }
  let energy = 0;
  for (let i = 0; i < size; i += 1) energy += x[i]! * x[i]!;
  const rms = Math.sqrt(energy / size);
  if (rms < 1e-6) return { hz: 0, clarity: 0, rms };
  const n = size * 2;
  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);
  for (let i = 0; i < integration; i += 1) aRe[i] = x[i]!;
  for (let i = 0; i < size; i += 1) bRe[i] = x[i]!;
  fft(aRe, aIm);
  fft(bRe, bIm);
  // conj(A)·B → cross-correlation r(τ) = Σ_j a_j b_{j+τ}.
  for (let k = 0; k < n; k += 1) {
    const re = aRe[k]! * bRe[k]! + aIm[k]! * bIm[k]!;
    const im = aRe[k]! * bIm[k]! - aIm[k]! * bRe[k]!;
    aRe[k] = re;
    aIm[k] = im;
  }
  fft(aRe, aIm, true);
  const squares = new Float64Array(size + 1);
  for (let i = 0; i < size; i += 1)
    squares[i + 1] = squares[i]! + x[i]! * x[i]!;
  const head = squares[integration]!;
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    const tail = squares[lag + integration]! - squares[lag]!;
    const d = Math.max(0, head + tail - (2 * aRe[lag]!) / n);
    running += d;
    cmnd[lag] = running > 0 ? (d * lag) / running : 1;
  }
  let best = -1;
  for (let lag = minLag; lag < maxLag; lag += 1) {
    if (cmnd[lag]! < 0.15) {
      while (lag + 1 < maxLag && cmnd[lag + 1]! < cmnd[lag]!) lag += 1;
      best = lag;
      break;
    }
  }
  if (best < 0) {
    best = minLag;
    for (let lag = minLag; lag < maxLag; lag += 1)
      if (cmnd[lag]! < cmnd[best]!) best = lag;
  }
  const clarity = Math.max(0, Math.min(1, 1 - cmnd[best]!));
  // Parabolic refinement of the dip.
  let period = best;
  if (best > 1 && best < maxLag) {
    const a = cmnd[best - 1]!;
    const b = cmnd[best]!;
    const c = cmnd[best + 1]!;
    const denom = a - 2 * b + c;
    if (denom > 1e-12) period = best + (0.5 * (a - c)) / denom;
  }
  return { hz: sampleRate / period, clarity, rms };
}

function analyzeSource(
  signal: Float32Array,
  sampleRate: number,
  from: number,
  to: number,
): PitchWindow[] {
  const size = pitchWindowSize(sampleRate);
  const span = to - from;
  const hop = Math.max(size >> 1, Math.ceil((span - size) / MAX_WINDOWS));
  const windows: PitchWindow[] = [];
  for (let offset = from; ; offset += hop) {
    const start = Math.min(offset, Math.max(from, to - size));
    const result = detectWindow(signal, start, sampleRate, size);
    windows.push({ time: (start + size / 2) / sampleRate, ...result });
    if (offset + size >= to) break;
  }
  return windows;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pitchOf(windows: readonly PitchWindow[]): DetectedPitch | undefined {
  const voiced = windows.filter((w) => w.clarity >= TONAL_CLARITY && w.hz > 0);
  if (voiced.length === 0) return undefined;
  const hz = 2 ** median(voiced.map((w) => Math.log2(w.hz)));
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return {
    hz: Math.round(hz * 100) / 100,
    note: midiToPitch(Math.max(0, Math.min(127, midi))),
    clarity: Math.round(median(windows.map((w) => w.clarity)) * 1000) / 1000,
  };
}

/** Loudness weight 0..1 over the 40 dB below the loudest window. */
function loudness(windows: readonly PitchWindow[]): number[] {
  const peak = Math.max(...windows.map((w) => w.rms), 1e-9);
  return windows.map((w) => {
    const db = 20 * Math.log10(Math.max(w.rms, 1e-9) / peak);
    return Math.max(0, Math.min(1, (db + 40) / 40));
  });
}

/**
 * The region whose windows score best: clarity × loudness for pitched
 * material, loudness alone when nothing in the file is periodic.
 */
function pickRegion(
  windows: readonly PitchWindow[],
  durationSeconds: number,
): { start: number; end: number } {
  const length = Math.min(durationSeconds, AUTO_REGION_SECONDS);
  if (length >= durationSeconds - 1e-9)
    return { start: 0, end: durationSeconds };
  const loud = loudness(windows);
  const tonal = windows.some((w) => w.clarity >= TONAL_CLARITY);
  const score = windows.map((w, i) => (tonal ? w.clarity : 1) * loud[i]!);
  let best = { start: 0, value: -1 };
  for (let i = 0; i < windows.length; i += 1) {
    const start = Math.max(
      0,
      Math.min(durationSeconds - length, windows[i]!.time - length / 2),
    );
    let sum = 0;
    let count = 0;
    for (let j = 0; j < windows.length; j += 1) {
      const t = windows[j]!.time;
      if (t < start || t > start + length) continue;
      sum += score[j]!;
      count += 1;
    }
    const value = count ? sum / count : 0;
    if (value > best.value + 1e-12) best = { start, value };
  }
  return { start: best.start, end: best.start + length };
}

// ---------------------------------------------------------------------------
// Frames

type Spectrum = { re: Float64Array; im: Float64Array };

function cubic(signal: Float32Array, position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const at = (k: number) =>
    signal[Math.max(0, Math.min(signal.length - 1, k))]!;
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return (
    p1 +
    0.5 *
      t *
      (p2 -
        p0 +
        t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}

/** One period at `start` (fractional), resampled to 2048 and made loopable. */
function sliceCycle(
  signal: Float32Array,
  start: number,
  period: number,
): Float64Array {
  const n = MAKE_FRAME_SIZE;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1)
    out[i] = cubic(signal, start + (i * period) / n);
  // Spread the loop-point mismatch over the cycle.
  const jump = cubic(signal, start + period) - out[0]!;
  for (let i = 0; i < n; i += 1) out[i] = out[i]! - (jump * i) / n;
  return out;
}

function forward(cycle: Float64Array): Spectrum {
  const re = Float64Array.from(cycle);
  const im = new Float64Array(cycle.length);
  fft(re, im);
  return { re, im };
}

function inverse(spectrum: Spectrum): Float64Array {
  const n = spectrum.re.length;
  const re = Float64Array.from(spectrum.re);
  const im = Float64Array.from(spectrum.im);
  fft(re, im, true);
  for (let i = 0; i < n; i += 1) re[i] = re[i]! / n;
  return re;
}

/**
 * Rotates a frame in time so its fundamental (or, when that is weak, its
 * strongest low harmonic) starts as a rising sine.
 */
function alignPhase(spectrum: Spectrum): void {
  const n = spectrum.re.length;
  const mag = (h: number) => Math.hypot(spectrum.re[h]!, spectrum.im[h]!);
  let anchor = 1;
  for (let h = 2; h <= 4; h += 1) if (mag(h) > 4 * mag(anchor)) anchor = h;
  if (mag(anchor) < 1e-9) return;
  // FFT bin X[h] = (N/2)·(a - i·b) for a·cos + b·sin; a rising sine is arg -π/2.
  const delta =
    (-Math.PI / 2 - Math.atan2(spectrum.im[anchor]!, spectrum.re[anchor]!)) /
    anchor;
  for (let h = 1; h < n / 2; h += 1) {
    const c = Math.cos(h * delta);
    const s = Math.sin(h * delta);
    const re = spectrum.re[h]! * c - spectrum.im[h]! * s;
    const im = spectrum.re[h]! * s + spectrum.im[h]! * c;
    spectrum.re[h] = re;
    spectrum.im[h] = im;
    spectrum.re[n - h] = re;
    spectrum.im[n - h] = -im;
  }
  spectrum.re[n / 2] = 0;
  spectrum.im[n / 2] = 0;
}

/** A fixed phase per harmonic (same in every frame), from an integer hash. */
function harmonicPhase(h: number): number {
  if (h === 1) return -Math.PI / 2;
  let x = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 2 ** 32) * 2 * Math.PI - Math.PI;
}

function spectralFrame(
  signal: Float32Array,
  centre: number,
  sampleRate: number,
  referenceHz: number,
): Spectrum {
  const size = nextPow2(Math.round(sampleRate * 0.085));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const offset = Math.round(centre) - size / 2;
  for (let i = 0; i < size; i += 1) {
    const at = offset + i;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    re[i] = at >= 0 && at < signal.length ? signal[at]! * w : 0;
  }
  fft(re, im);
  const binHz = sampleRate / size;
  const n = MAKE_FRAME_SIZE;
  const out: Spectrum = { re: new Float64Array(n), im: new Float64Array(n) };
  for (let h = 1; h <= HARMONICS; h += 1) {
    const lo = (h - 0.5) * referenceHz;
    const hi = (h + 0.5) * referenceHz;
    if (lo >= sampleRate / 2) break;
    const first = Math.max(1, Math.ceil(lo / binHz));
    const last = Math.min(size / 2 - 1, Math.floor(hi / binHz));
    let power = 0;
    let count = 0;
    for (let k = first; k <= last; k += 1) {
      power += re[k]! * re[k]! + im[k]! * im[k]!;
      count += 1;
    }
    if (count === 0) {
      // Band narrower than a bin: interpolate the nearest bin.
      const k = Math.min(
        size / 2 - 1,
        Math.max(1, Math.round((h * referenceHz) / binHz)),
      );
      power = re[k]! * re[k]! + im[k]! * im[k]!;
      count = 1;
    }
    const amp = Math.sqrt(power / count);
    const phase = harmonicPhase(h);
    out.re[h] = amp * Math.cos(phase);
    out.im[h] = amp * Math.sin(phase);
    out.re[n - h] = out.re[h]!;
    out.im[n - h] = -out.im[h]!;
  }
  return out;
}

function smoothFrames(spectra: Spectrum[], amount: number): Spectrum[] {
  const sigma = (amount * spectra.length) / 8;
  if (sigma < 0.25 || spectra.length < 2) return spectra;
  const reach = Math.ceil(3 * sigma);
  const weights: number[] = [];
  for (let d = -reach; d <= reach; d += 1)
    weights.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  const n = MAKE_FRAME_SIZE;
  return spectra.map((_, index) => {
    const out: Spectrum = { re: new Float64Array(n), im: new Float64Array(n) };
    let total = 0;
    for (let d = -reach; d <= reach; d += 1) {
      const j = index + d;
      if (j < 0 || j >= spectra.length) continue;
      const w = weights[d + reach]!;
      total += w;
      const src = spectra[j]!;
      for (let k = 0; k < n; k += 1) {
        out.re[k] = out.re[k]! + w * src.re[k]!;
        out.im[k] = out.im[k]! + w * src.im[k]!;
      }
    }
    for (let k = 0; k < n; k += 1) {
      out.re[k] = out.re[k]! / total;
      out.im[k] = out.im[k]! / total;
    }
    return out;
  });
}

function centroid(spectrum: Spectrum): number {
  // Power-weighted over the harmonics that stand out: within 30 dB of the
  // strongest and well above the noise floor (20x the median bin, which a
  // noise bin exceeds with probability ~1e-6), so a quiet noise floor spread
  // across a thousand harmonics does not outweigh the few loud ones a
  // listener hears.
  const power = new Float64Array(HARMONICS);
  let peak = 0;
  for (let h = 1; h <= HARMONICS; h += 1) {
    power[h - 1] = spectrum.re[h]! ** 2 + spectrum.im[h]! ** 2;
    peak = Math.max(peak, power[h - 1]!);
  }
  const sorted = Float64Array.from(power).sort();
  const median = sorted[sorted.length >> 1]!;
  const floor = Math.max(peak * 1e-3, median * 20);
  let sum = 0;
  let weighted = 0;
  for (let h = 1; h <= HARMONICS; h += 1) {
    const p = power[h - 1]!;
    if (p < floor) continue;
    sum += p;
    weighted += h * p;
  }
  return sum > 1e-24 ? weighted / sum : 0;
}

function brightness(c: number): string {
  if (c < 1.3) return "near-sine";
  if (c < 3) return "dark";
  if (c < 7) return "warm";
  if (c < 16) return "bright";
  return "buzzy";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Centroid in up to 8 segments, the overall trend and how smooth the morph is. */
export function describeSweep(
  centroids: readonly number[],
  changes: readonly number[],
): string {
  const count = centroids.length;
  if (count === 1)
    return `one frame · centroid h${round1(centroids[0]!)} (${brightness(centroids[0]!)})`;
  const segments = Math.min(8, count);
  const parts: string[] = [];
  for (let s = 0; s < segments; s += 1) {
    const from = Math.floor((s * count) / segments);
    const to = Math.floor(((s + 1) * count) / segments) - 1;
    let sum = 0;
    for (let i = from; i <= to; i += 1) sum += centroids[i]!;
    const c = sum / (to - from + 1);
    parts.push(
      `${from === to ? from : `${from}-${to}`} h${round1(c)} ${brightness(c)}`,
    );
  }
  const first = centroids[0]!;
  const last = centroids[count - 1]!;
  const lo = Math.min(...centroids);
  const hi = Math.max(...centroids);
  const trend =
    hi - lo < 0.15 * Math.max(1, lo)
      ? "steady timbre"
      : last > first * 1.25
        ? "brightens"
        : first > last * 1.25
          ? "darkens"
          : "moves and returns";
  const step = changes.length
    ? changes.reduce((a, b) => a + b, 0) / changes.length
    : 0;
  const morph =
    step < 0.05
      ? "very smooth morph"
      : step < 0.2
        ? "smooth morph"
        : step < 0.5
          ? "audible steps between frames"
          : "jumpy (try smooth 0.3+ or fewer frames)";
  return `${trend} (centroid h${round1(lo)}..h${round1(hi)}), ${morph} (mean frame change ${Math.round(step * 100)}%) · ${parts.join(" · ")}`;
}

/** Relative spectral distance between neighbouring frames, 0..~2. */
function frameChanges(spectra: readonly Spectrum[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < spectra.length; i += 1) {
    const a = spectra[i - 1]!;
    const b = spectra[i]!;
    let diff = 0;
    let norm = 0;
    for (let h = 1; h <= HARMONICS; h += 1) {
      const ma = Math.hypot(a.re[h]!, a.im[h]!);
      const mb = Math.hypot(b.re[h]!, b.im[h]!);
      diff += (ma - mb) * (ma - mb);
      norm += ma * ma + mb * mb;
    }
    out.push(norm > 1e-18 ? Math.sqrt((2 * diff) / norm) : 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point

export function makeWavetable(
  mono: Float32Array,
  sampleRate: number,
  options: MakeOptions = {},
): MadeWavetable {
  const count = options.frames ?? MAKE_DEFAULT_FRAMES;
  if (!Number.isInteger(count) || count < 1 || count > MAKE_MAX_FRAMES)
    throw new WavetableMakeError(
      `frames must be an integer 1..${MAKE_MAX_FRAMES}`,
    );
  if (!(sampleRate >= 8000 && sampleRate <= 384_000))
    throw new WavetableMakeError("sample rate must be 8..384 kHz");
  const duration = mono.length / sampleRate;
  if (duration < 0.05)
    throw new WavetableMakeError("the source is shorter than 50 ms");
  const smooth = options.smooth ?? 0;
  if (!(smooth >= 0 && smooth <= 1))
    throw new WavetableMakeError("smooth must be 0..1");

  let region: { start: number; end: number; auto: boolean };
  if (options.start !== undefined || options.end !== undefined) {
    const start = Math.max(0, options.start ?? 0);
    const end = Math.min(duration, options.end ?? duration);
    if (!(end - start >= 0.05))
      throw new WavetableMakeError(
        `region ${round1(start)}..${round1(end)} s must be at least 50 ms inside the ${round1(duration)} s source`,
      );
    region = { start, end, auto: false };
  } else {
    const all = analyzeSource(mono, sampleRate, 0, mono.length);
    region = { ...pickRegion(all, duration), auto: true };
  }
  const from = Math.floor(region.start * sampleRate);
  const to = Math.min(mono.length, Math.ceil(region.end * sampleRate));
  const windows = analyzeSource(mono, sampleRate, from, to);
  const pitch = pitchOf(windows);
  const tonal =
    pitch !== undefined &&
    median(windows.map((w) => w.clarity)) >= TONAL_CLARITY;
  const requested = options.method ?? "auto";
  const method: "slice" | "spectral" =
    requested === "auto" ? (tonal ? "slice" : "spectral") : requested;
  if (method === "slice" && !pitch)
    throw new WavetableMakeError(
      "no stable pitch in the region · use method spectral, or pick a region with a sustained note",
    );

  const span = to - from;
  const centres: number[] = [];
  for (let k = 0; k < count; k += 1)
    centres.push(from + ((k + 0.5) * span) / count);

  let spectra: Spectrum[];
  if (method === "slice") {
    const fallback = sampleRate / pitch!.hz;
    const size = pitchWindowSize(sampleRate);
    spectra = centres.map((centre) => {
      const local = detectWindow(
        mono,
        Math.round(centre) - size / 2,
        sampleRate,
        size,
      );
      const period =
        local.clarity >= TONAL_CLARITY && local.hz > 0
          ? sampleRate / local.hz
          : fallback;
      // Start half a period before the centre so the cycle straddles it.
      return forward(
        sliceCycle(mono, Math.max(0, centre - period / 2), period),
      );
    });
  } else {
    const reference = pitch && tonal ? pitch.hz : SPECTRAL_REFERENCE_HZ;
    spectra = centres.map((centre) =>
      spectralFrame(mono, centre, sampleRate, reference),
    );
  }
  for (const spectrum of spectra) {
    if (options.removeDc ?? true) {
      spectrum.re[0] = 0;
      spectrum.im[0] = 0;
    }
    if ((options.align ?? true) && method === "slice") alignPhase(spectrum);
  }
  spectra = smoothFrames(spectra, smooth);

  const cycles = spectra.map(inverse);
  const normalize = options.normalize ?? "frame";
  if (normalize === "table") {
    let peak = 0;
    for (const cycle of cycles)
      for (const v of cycle) peak = Math.max(peak, Math.abs(v));
    if (peak > 1e-12)
      for (const cycle of cycles)
        for (let i = 0; i < cycle.length; i += 1)
          cycle[i] = (cycle[i]! * 0.98) / peak;
  } else if (normalize === "frame") {
    for (const cycle of cycles) {
      let peak = 0;
      for (const v of cycle) peak = Math.max(peak, Math.abs(v));
      if (peak > 1e-12)
        for (let i = 0; i < cycle.length; i += 1)
          cycle[i] = (cycle[i]! * 0.98) / peak;
    }
  }
  const frames = cycles.map((cycle) => Float32Array.from(cycle));
  const centroids = spectra.map((s) => round1(centroid(s)));
  return Object.freeze({
    frames: Object.freeze(frames),
    method,
    ...(pitch ? { pitch } : {}),
    region: Object.freeze({
      start: Math.round(region.start * 1000) / 1000,
      end: Math.round(region.end * 1000) / 1000,
      auto: region.auto,
    }),
    centroids: Object.freeze(centroids),
    sweep: describeSweep(centroids, frameChanges(spectra)),
  });
}

/**
 * Float32 mono WAV with a `clm ` chunk (`<!>2048 …`) before `data`, the
 * layout `wavetableFromWav` reads back.
 */
export function encodeWavetableWav(
  frames: readonly Float32Array[],
  sampleRate = 44_100,
): Uint8Array {
  const size = frames[0]?.length ?? MAKE_FRAME_SIZE;
  const clm = `<!>${size} 00000000 dawg wavetable`;
  const clmBytes = clm.length + (clm.length & 1);
  const dataBytes = frames.length * size * 4;
  const total = 12 + 8 + 16 + 8 + clmBytes + 8 + dataBytes;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1)
      bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, total - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  let offset = 36;
  ascii(offset, "clm ");
  view.setUint32(offset + 4, clm.length, true);
  ascii(offset + 8, clm);
  offset += 8 + clmBytes;
  ascii(offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  offset += 8;
  for (const frame of frames)
    for (let i = 0; i < size; i += 1, offset += 4)
      view.setFloat32(offset, frame[i]!, true);
  return bytes;
}
