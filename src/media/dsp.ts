/**
 * Pure-TypeScript analysis used when no StemDeck beat grid exists: an onset
 * envelope → autocorrelation tempo estimate with beat phase, a pitch-class
 * histogram for key estimation, and a 240-bucket RMS waveform. Everything
 * works on a mono float signal and is O(n) in samples plus a bounded search.
 */
import { estimateKey } from "../../core/key.ts";
import { MEDIA_LIMITS } from "./types.ts";
import type { ParsedWav } from "./vendor/wav.ts";

export const MIN_BPM = 60;
export const MAX_BPM = 200;
const HOP = 512;
/** Analyse at most this much audio for tempo and key (the first minutes decide). */
const MAX_ANALYSIS_SECONDS = 240;

/** Downmixed mono samples, bounded to MAX_ANALYSIS_SECONDS. */
export function monoSignal(wav: ParsedWav, maxSeconds = MAX_ANALYSIS_SECONDS) {
  const count = Math.min(
    wav.sampleCount,
    Math.floor(maxSeconds * wav.sampleRate),
  );
  const mono = new Float32Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < wav.channels; channel += 1)
      sum += wav.sample(frame, channel);
    mono[frame] = sum / wav.channels;
  }
  return mono;
}

/** Half-wave-rectified log-energy difference per hop: a cheap onset envelope. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number) {
  const frames = Math.floor(mono.length / HOP);
  const envelope = new Float32Array(frames);
  let previous = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let energy = 0;
    const start = frame * HOP;
    for (let index = 0; index < HOP; index += 1) {
      const value = mono[start + index]!;
      energy += value * value;
    }
    const level = Math.log1p(energy * 1e3);
    envelope[frame] = Math.max(0, level - previous);
    previous = level;
  }
  // Remove the local mean so sustained loudness does not look like onsets.
  const window = Math.max(1, Math.round((0.25 * sampleRate) / HOP));
  const smoothed = new Float32Array(frames);
  let running = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    running += envelope[frame]!;
    if (frame >= window) running -= envelope[frame - window]!;
    const mean = running / Math.min(window, frame + 1);
    smoothed[frame] = Math.max(0, envelope[frame]! - mean);
  }
  return { envelope: smoothed, hopSeconds: HOP / sampleRate };
}

export type TempoEstimate = Readonly<{
  bpm: number;
  /** 0..1, how far the winning lag stands above the autocorrelation floor. */
  confidence: number;
  /** Seconds of the first beat, from the phase that best matches onsets. */
  offsetSeconds: number;
}>;

/**
 * Autocorrelation over the 60–200 BPM lag range with a mild preference for
 * ~120 BPM, so half/double-time ambiguities resolve toward the usual octave.
 */
export function estimateTempo(
  envelope: Float32Array,
  hopSeconds: number,
): TempoEstimate | undefined {
  const frames = envelope.length;
  // Spread each onset over ±2 frames so a beat period that is not a whole
  // number of hops still correlates with itself (else 2× the period wins).
  envelope = smoothEnvelope(envelope);
  const minLag = Math.max(1, Math.floor(60 / MAX_BPM / hopSeconds));
  const maxLag = Math.ceil(60 / MIN_BPM / hopSeconds);
  if (frames < maxLag * 4) return undefined;
  let total = 0;
  for (const value of envelope) total += value;
  if (!(total > 0)) return undefined;
  const scores = new Float64Array(maxLag + 1);
  let best = -1;
  let bestScore = 0;
  let floor = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let frame = lag; frame < frames; frame += 1)
      sum += envelope[frame]! * envelope[frame - lag]!;
    const bpm = 60 / (lag * hopSeconds);
    // Gaussian weight centred on 120 BPM in log tempo (Ellis-style prior).
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    const score = (sum / (frames - lag)) * weight;
    scores[lag] = score;
    floor += score;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0 || bestScore <= 0) return undefined;
  floor /= maxLag - minLag + 1;
  // Refine with a parabolic fit between neighbouring lags.
  let lag = best;
  if (best > minLag && best < maxLag) {
    const left = scores[best - 1]!;
    const right = scores[best + 1]!;
    const denominator = left - 2 * bestScore + right;
    if (denominator < 0) lag = best + (0.5 * (left - right)) / denominator;
  }
  const bpm = Math.round((60 / (lag * hopSeconds)) * 10) / 10;
  const confidence = Math.max(0, Math.min(1, 1 - floor / bestScore));
  // Phase: the offset whose comb of beats collects the most onset energy.
  const period = lag;
  const steps = Math.max(1, Math.round(period));
  let bestOffset = 0;
  let bestComb = -1;
  for (let step = 0; step < steps; step += 1) {
    let comb = 0;
    for (let position = step; position < frames; position += period)
      comb += envelope[Math.round(position)] ?? 0;
    if (comb > bestComb) {
      bestComb = comb;
      bestOffset = step;
    }
  }
  return { bpm, confidence, offsetSeconds: bestOffset * hopSeconds };
}

const SMOOTH_KERNEL = [1, 2, 3, 2, 1].map((weight) => weight / 9);

function smoothEnvelope(envelope: Float32Array): Float32Array {
  const out = new Float32Array(envelope.length);
  const half = (SMOOTH_KERNEL.length - 1) / 2;
  for (let frame = 0; frame < envelope.length; frame += 1) {
    let sum = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      const value = envelope[frame + offset];
      if (value !== undefined) sum += value * SMOOTH_KERNEL[offset + half]!;
    }
    out[frame] = sum;
  }
  return out;
}

type Fft = {
  size: number;
  reverse: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
};

function createFft(size: number): Fft {
  const reverse = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let index = 0; index < size; index += 1) {
    let value = 0;
    for (let bit = 0; bit < bits; bit += 1)
      value |= ((index >> bit) & 1) << (bits - 1 - bit);
    reverse[index] = value;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let index = 0; index < size / 2; index += 1) {
    cos[index] = Math.cos((2 * Math.PI * index) / size);
    sin[index] = -Math.sin((2 * Math.PI * index) / size);
  }
  return { size, reverse, cos, sin };
}

function fftInPlace(fft: Fft, re: Float64Array, im: Float64Array): void {
  const size = fft.size;
  for (let index = 0; index < size; index += 1) {
    const target = fft.reverse[index]!;
    if (target > index) {
      [re[index], re[target]] = [re[target]!, re[index]!];
      [im[index], im[target]] = [im[target]!, im[index]!];
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const half = width / 2;
    const step = size / width;
    for (let start = 0; start < size; start += width) {
      for (let offset = 0; offset < half; offset += 1) {
        const twiddle = offset * step;
        const cos = fft.cos[twiddle]!;
        const sin = fft.sin[twiddle]!;
        const even = start + offset;
        const odd = even + half;
        const oddRe = re[odd]! * cos - im[odd]! * sin;
        const oddIm = re[odd]! * sin + im[odd]! * cos;
        re[odd] = re[even]! - oddRe;
        im[odd] = im[even]! - oddIm;
        re[even] = re[even]! + oddRe;
        im[even] = im[even]! + oddIm;
      }
    }
  }
}

/**
 * 12-bin pitch-class histogram from sparse 4096-point frames (one every
 * half second) over 55–1760 Hz, weighted by log magnitude.
 */
export function pitchClassHistogram(mono: Float32Array, sampleRate: number) {
  const size = 4096;
  const histogram = new Array<number>(12).fill(0);
  if (mono.length < size) return histogram;
  const fft = createFft(size);
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hop = Math.max(size, Math.round(sampleRate / 2));
  const binHz = sampleRate / size;
  const lowBin = Math.max(1, Math.floor(55 / binHz));
  const highBin = Math.min(size / 2 - 1, Math.ceil(1760 / binHz));
  for (let start = 0; start + size <= mono.length; start += hop) {
    for (let index = 0; index < size; index += 1) {
      re[index] = mono[start + index]! * window[index]!;
      im[index] = 0;
    }
    fftInPlace(fft, re, im);
    for (let bin = lowBin; bin <= highBin; bin += 1) {
      const magnitude = Math.hypot(re[bin]!, im[bin]!);
      if (magnitude < 1e-4) continue;
      // Only spectral peaks vote, so harmonics spread less onto neighbours.
      const left = Math.hypot(re[bin - 1]!, im[bin - 1]!);
      const right = Math.hypot(re[bin + 1]!, im[bin + 1]!);
      if (magnitude < left || magnitude < right) continue;
      const midi = 69 + 12 * Math.log2((bin * binHz) / 440);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      histogram[pitchClass] =
        histogram[pitchClass]! + Math.log1p(magnitude * 100);
    }
  }
  return histogram;
}

export function keyFromHistogram(histogram: readonly number[]): string | null {
  return estimateKey(histogram);
}

/** 240 normalised RMS buckets over the whole file, rounded to 3 decimals. */
export function waveformPeaks(
  wav: ParsedWav,
  buckets = MEDIA_LIMITS.waveformBuckets,
): readonly number[] {
  const count = Math.max(1, Math.min(buckets, wav.sampleCount));
  const peaks = new Array<number>(count).fill(0);
  const perBucket = wav.sampleCount / count;
  let maximum = 0;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * perBucket);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * perBucket));
    // Stride long buckets so a 10-minute file costs the same as a short one.
    const stride = Math.max(1, Math.floor((end - start) / 2_048));
    let energy = 0;
    let samples = 0;
    for (let frame = start; frame < end; frame += stride) {
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const value = wav.sample(frame, channel);
        energy += value * value;
        samples += 1;
      }
    }
    const rms = samples > 0 ? Math.sqrt(energy / samples) : 0;
    peaks[bucket] = rms;
    if (rms > maximum) maximum = rms;
  }
  return peaks.map((value) =>
    maximum > 0 ? Math.round((value / maximum) * 1000) / 1000 : 0,
  );
}
