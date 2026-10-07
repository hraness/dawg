// Vendored from soundfish `lib/song-import/drums.ts` (same owner): the STFT drum reducer; the legacy classifier and stem wrapper are dropped.
import type { TimedNote } from "../types.ts";
import { clamp } from "./util.ts";
import { parseWav, type ParsedWav } from "./wav.ts";

function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function medianAbsoluteDeviation(
  values: ArrayLike<number>,
  center: number,
): number {
  const deviations = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1)
    deviations[index] = Math.abs(values[index]! - center);
  return median(deviations);
}

// ---------------------------------------------------------------------------
// Drum vocabulary shared by the classifier, analysis.json, and the tests.
// ---------------------------------------------------------------------------

export const DRUM_CLASS_PITCHES = {
  kick: 36,
  snare: 38,
  clap: 39,
  "low-tom": 45,
  "mid-tom": 47,
  "closed-hat": 42,
  "open-hat": 46,
  crash: 49,
  ride: 51,
} as const;

export type DrumClassName = keyof typeof DRUM_CLASS_PITCHES;

export const DRUM_CLASS_NAMES = Object.keys(
  DRUM_CLASS_PITCHES,
) as readonly DrumClassName[];

// ---------------------------------------------------------------------------
// STFT front end: 1024-point Hann frames every 256 samples.
// ---------------------------------------------------------------------------

export const STFT_FRAME_SIZE = 1024;
export const STFT_HOP_SIZE = 256;
const LOW_BAND_HZ = 150;
const HIGH_BAND_HZ = 2_500;
/** Compression applied to peak-normalized magnitudes before spectral flux. */
const FLUX_COMPRESSION = 20;
/** Onset threshold: per-band median plus this many MADs. */
const THRESHOLD_MADS = 4;
/** No band may trigger below this fraction of its own strongest flux. */
const THRESHOLD_FLOOR_FRACTION = 0.03;
const MINIMUM_ONSET_SPACING_SECONDS = 0.04;
const ENVELOPE_BLOCK_SECONDS = 0.001;
const ATTACK_WINDOW_SECONDS = 0.04;
const DECAY_FLOOR_RATIO = 0.01;
const MAXIMUM_DECAY_SECONDS = 1.5;
const SUB_ONSET_WINDOW_SECONDS = 0.045;
const SUB_ONSET_LOOKBACK_SECONDS = 0.025;
/** Onsets weaker than this fraction of the strongest onset are rumble or bleed. */
const STRENGTH_FLOOR = 0.03;
/** Two refined onsets closer than this are one hit. */
const DUPLICATE_ONSET_SECONDS = 0.03;
/** A much weaker onset this soon after a strong one is its own ring-out. */
const ECHO_WINDOW_SECONDS = 0.1;
const ECHO_STRENGTH_RATIO = 0.35;
/** A far weaker onset inside a cymbal's ring-out is its shimmer, not a hit. */
const RING_OUT_WINDOW_SECONDS = 0.5;
const RING_OUT_STRENGTH_RATIO = 8;
/** An onset must push at least one band this far past its threshold to count. */
const MINIMUM_BAND_EXCESS = 3.5;
const MINIMUM_ONSET_POWER_GROWTH = 1.2;
/** A hat under a kick or snare shows as high-band flux centred above this. */
const HAT_CO_ONSET_EXCESS = 5;
const HAT_CO_ONSET_CENTROID_HZ = 4_800;
const HAT_CO_ONSET_MINIMUM_SHARE = 0.02;
/** The low band has few bins and a tiny MAD, so a low-only trigger needs more margin. */
const LOW_ONLY_BAND_EXCESS = 8;

type Fft = Readonly<{
  size: number;
  reverse: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}>;

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
      const tempRe = re[index]!;
      re[index] = re[target]!;
      re[target] = tempRe;
      const tempIm = im[index]!;
      im[index] = im[target]!;
      im[target] = tempIm;
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

export type FrameFeatures = Readonly<{
  sampleRate: number;
  frameCount: number;
  /** Seconds at the centre of each analysis window. */
  time: Float64Array;
  powerLow: Float64Array;
  powerMid: Float64Array;
  powerHigh: Float64Array;
  fluxLow: Float64Array;
  fluxMid: Float64Array;
  fluxHigh: Float64Array;
  /** Power-weighted centroid over 30–1,000 Hz, in Hz. */
  centroidLowMid: Float64Array;
  /** Power-weighted centroid over the whole spectrum, in Hz. */
  centroid: Float64Array;
  /** Power-weighted centroid inside the high band, in Hz. */
  centroidHigh: Float64Array;
  /** Spectral flatness over 100 Hz to Nyquist; 1 is white noise, 0 is a pure tone. */
  flatness: Float64Array;
  /** 1 ms RMS envelope of the mono signal. */
  envelope: Float32Array;
}>;

function monoPeakAndEnvelope(
  wav: ParsedWav,
): Readonly<{ peak: number; envelope: Float32Array }> {
  const blockSize = Math.max(
    1,
    Math.round(wav.sampleRate * ENVELOPE_BLOCK_SECONDS),
  );
  const envelope = new Float32Array(Math.ceil(wav.sampleCount / blockSize));
  let peak = 0;
  let block = 0;
  let accumulator = 0;
  let count = 0;
  for (let index = 0; index < wav.sampleCount; index += 1) {
    let mono = 0;
    for (let channel = 0; channel < wav.channels; channel += 1)
      mono += wav.sample(index, channel);
    mono /= wav.channels;
    const magnitude = Math.abs(mono);
    if (magnitude > peak) peak = magnitude;
    accumulator += mono * mono;
    count += 1;
    if (count === blockSize) {
      envelope[block] = Math.sqrt(accumulator / count);
      block += 1;
      accumulator = 0;
      count = 0;
    }
  }
  if (count > 0) envelope[block] = Math.sqrt(accumulator / count);
  return { peak, envelope };
}

function extractFrameFeatures(wav: ParsedWav): FrameFeatures | undefined {
  const size = STFT_FRAME_SIZE;
  const hop = STFT_HOP_SIZE;
  if (wav.sampleCount < size) return undefined;
  const frameCount = Math.floor((wav.sampleCount - size) / hop) + 1;
  const { peak, envelope } = monoPeakAndEnvelope(wav);
  if (peak <= 0) return undefined;
  const fft = createFft(size);
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  // A full-scale sine under a Hann window peaks near size / 4 in magnitude.
  const magnitudeScale = 1 / ((peak * size) / 4);
  const binHz = wav.sampleRate / size;
  const bins = size / 2;
  const lowEnd = Math.min(bins, Math.ceil(LOW_BAND_HZ / binHz));
  const highStart = Math.min(bins, Math.ceil(HIGH_BAND_HZ / binHz));
  const centroidStart = Math.max(1, Math.floor(30 / binHz));
  const centroidEnd = Math.min(bins, Math.ceil(1_000 / binHz));
  const flatnessStart = Math.max(1, Math.floor(100 / binHz));
  const lag = Math.max(1, Math.round((0.01 * wav.sampleRate) / hop));

  const features = {
    sampleRate: wav.sampleRate,
    frameCount,
    time: new Float64Array(frameCount),
    powerLow: new Float64Array(frameCount),
    powerMid: new Float64Array(frameCount),
    powerHigh: new Float64Array(frameCount),
    fluxLow: new Float64Array(frameCount),
    fluxMid: new Float64Array(frameCount),
    fluxHigh: new Float64Array(frameCount),
    centroidLowMid: new Float64Array(frameCount),
    centroid: new Float64Array(frameCount),
    centroidHigh: new Float64Array(frameCount),
    flatness: new Float64Array(frameCount),
    envelope,
  };

  const ring = new Float64Array(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const history: Float64Array[] = Array.from(
    { length: lag + 1 },
    () => new Float64Array(bins),
  );
  let ringWrite = 0;
  let nextSample = 0;
  const readInto = (until: number): void => {
    for (; nextSample < until; nextSample += 1) {
      let mono = 0;
      for (let channel = 0; channel < wav.channels; channel += 1)
        mono += wav.sample(nextSample, channel);
      ring[ringWrite] = mono / wav.channels;
      ringWrite = (ringWrite + 1) % size;
    }
  };

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hop;
    readInto(start + size);
    const ringStart = ringWrite; // oldest sample is exactly `size` samples back
    for (let index = 0; index < size; index += 1) {
      re[index] = ring[(ringStart + index) % size]! * window[index]!;
      im[index] = 0;
    }
    fftInPlace(fft, re, im);
    const compressed = history[frame % history.length]!;
    const previous = history[(frame - lag + history.length) % history.length]!;
    let powerLow = 0;
    let powerMid = 0;
    let powerHigh = 0;
    let fluxLow = 0;
    let fluxMid = 0;
    let fluxHigh = 0;
    let weightedHz = 0;
    let weightedHighHz = 0;
    let weightedLowMidHz = 0;
    let powerLowMid = 0;
    let logSum = 0;
    let linearSum = 0;
    let flatnessBins = 0;
    for (let bin = 1; bin < bins; bin += 1) {
      const magnitude = Math.hypot(re[bin]!, im[bin]!) * magnitudeScale;
      const power = magnitude * magnitude;
      const value = Math.log1p(FLUX_COMPRESSION * magnitude);
      const flux = frame >= lag ? Math.max(0, value - previous[bin]!) : 0;
      compressed[bin] = value;
      const hz = bin * binHz;
      weightedHz += hz * power;
      if (bin < lowEnd) {
        powerLow += power;
        fluxLow += flux;
      } else if (bin < highStart) {
        powerMid += power;
        fluxMid += flux;
      } else {
        powerHigh += power;
        fluxHigh += flux;
        weightedHighHz += hz * power;
      }
      if (bin >= centroidStart && bin < centroidEnd) {
        weightedLowMidHz += hz * power;
        powerLowMid += power;
      }
      if (bin >= flatnessStart) {
        logSum += Math.log(magnitude + 1e-9);
        linearSum += magnitude;
        flatnessBins += 1;
      }
    }
    const total = powerLow + powerMid + powerHigh;
    features.time[frame] = (start + size / 2) / wav.sampleRate;
    features.powerLow[frame] = powerLow;
    features.powerMid[frame] = powerMid;
    features.powerHigh[frame] = powerHigh;
    features.fluxLow[frame] = fluxLow;
    features.fluxMid[frame] = fluxMid;
    features.fluxHigh[frame] = fluxHigh;
    features.centroid[frame] = total > 0 ? weightedHz / total : 0;
    features.centroidHigh[frame] =
      powerHigh > 0 ? weightedHighHz / powerHigh : 0;
    features.centroidLowMid[frame] =
      powerLowMid > 0 ? weightedLowMidHz / powerLowMid : 0;
    features.flatness[frame] =
      flatnessBins > 0 && linearSum > 0
        ? Math.exp(logSum / flatnessBins) / (linearSum / flatnessBins)
        : 0;
  }
  return features;
}

// ---------------------------------------------------------------------------
// Onset detection: per-band median + k·MAD thresholds, peak picking on the
// threshold-normalized sum, and a time-domain refinement of each onset.
// ---------------------------------------------------------------------------

function bandThreshold(flux: Float64Array): number {
  const center = median(flux);
  const deviation = medianAbsoluteDeviation(flux, center);
  let maximum = 0;
  for (const value of flux) if (value > maximum) maximum = value;
  return Math.max(
    center + THRESHOLD_MADS * deviation,
    THRESHOLD_FLOOR_FRACTION * maximum,
    1e-9,
  );
}

export type DrumOnsetFeatures = Readonly<{
  /** Refined onset time in seconds. */
  time: number;
  frame: number;
  /** Each band's share of the power the onset adds; the three sum to 1. */
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  /** Each band's flux divided by that band's threshold. */
  lowExcess: number;
  midExcess: number;
  highExcess: number;
  /** Total onset flux relative to the strongest onset in the stem. */
  strength: number;
  centroidHz: number;
  centroidLowMidHz: number;
  centroidHighHz: number;
  flatness: number;
  /** Seconds until the total power falls 20 dB under its attack peak, capped at the next onset. */
  decaySeconds: number;
  /** Seconds until the high band falls 20 dB under its attack peak, capped at the next onset. */
  highDecaySeconds: number;
  /** Envelope peaks inside the first 45 ms; claps flam into several. */
  subOnsets: number;
}>;

function refineOnsetTime(
  envelope: Float32Array,
  blockSeconds: number,
  approximate: number,
): number {
  const center = Math.round(approximate / blockSeconds);
  const radius = Math.round(0.025 / blockSeconds);
  let best = clamp(center, 0, envelope.length - 1);
  let bestRise = -Infinity;
  for (
    let block = Math.max(2, center - radius);
    block <= Math.min(envelope.length - 1, center + radius);
    block += 1
  ) {
    const rise = envelope[block]! - envelope[block - 2]!;
    if (rise > bestRise) {
      bestRise = rise;
      best = block;
    }
  }
  return best * blockSeconds;
}

function countSubOnsets(
  envelope: Float32Array,
  blockSeconds: number,
  onsetSeconds: number,
): number {
  const start = Math.max(
    0,
    Math.round((onsetSeconds - SUB_ONSET_LOOKBACK_SECONDS) / blockSeconds),
  );
  const end = Math.min(
    envelope.length - 1,
    start +
      Math.round(
        (SUB_ONSET_WINDOW_SECONDS + SUB_ONSET_LOOKBACK_SECONDS) / blockSeconds,
      ),
  );
  let maximum = 0;
  for (let block = start; block <= end; block += 1)
    maximum = Math.max(maximum, envelope[block]!);
  if (maximum <= 0) return 0;
  const separation = Math.max(1, Math.round(0.006 / blockSeconds));
  let count = 0;
  let lastPeak = -Infinity;
  for (let block = start + 1; block < end; block += 1) {
    const value = envelope[block]!;
    if (value < 0.45 * maximum) continue;
    if (value < envelope[block - 1]! || value < envelope[block + 1]!) continue;
    // Require a dip of at least half between successive peaks.
    let dipped = lastPeak === -Infinity;
    if (!dipped) {
      for (let back = block - 1; back > lastPeak; back -= 1) {
        if (envelope[back]! < 0.5 * Math.min(value, envelope[lastPeak]!)) {
          dipped = true;
          break;
        }
      }
    }
    if (!dipped || block - lastPeak < separation) continue;
    count += 1;
    lastPeak = block;
  }
  return count;
}

function decayLength(
  power: Float64Array,
  time: Float64Array,
  onsetFrame: number,
  attackFrames: number,
  limitFrame: number,
): number {
  let peak = 0;
  let peakFrame = onsetFrame;
  for (
    let frame = onsetFrame;
    frame <= Math.min(limitFrame, onsetFrame + attackFrames);
    frame += 1
  ) {
    if (power[frame]! > peak) {
      peak = power[frame]!;
      peakFrame = frame;
    }
  }
  if (peak <= 0) return 0;
  const floor = peak * DECAY_FLOOR_RATIO;
  for (let frame = peakFrame; frame <= limitFrame; frame += 1) {
    if (power[frame]! <= floor)
      return Math.max(0, time[frame]! - time[onsetFrame]!);
  }
  return Math.min(
    MAXIMUM_DECAY_SECONDS,
    Math.max(0, time[limitFrame]! - time[onsetFrame]!),
  );
}

export function detectDrumOnsets(
  features: FrameFeatures,
): readonly DrumOnsetFeatures[] {
  const { frameCount, time } = features;
  if (frameCount < 3) return [];
  const thresholds = {
    low: bandThreshold(features.fluxLow),
    mid: bandThreshold(features.fluxMid),
    high: bandThreshold(features.fluxHigh),
  };
  const combined = new Float64Array(frameCount);
  const triggered = new Uint8Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const low = features.fluxLow[frame]! / thresholds.low;
    const mid = features.fluxMid[frame]! / thresholds.mid;
    const high = features.fluxHigh[frame]! / thresholds.high;
    combined[frame] = low + mid + high;
    triggered[frame] = low >= 1 || mid >= 1 || high >= 1 ? 1 : 0;
  }
  const hopSeconds = STFT_HOP_SIZE / features.sampleRate;
  const neighborhood = Math.max(1, Math.round(0.012 / hopSeconds));
  const spacingFrames = Math.max(
    1,
    Math.round(MINIMUM_ONSET_SPACING_SECONDS / hopSeconds),
  );
  const peaks: number[] = [];
  for (let frame = 1; frame < frameCount - 1; frame += 1) {
    if (triggered[frame] === 0) continue;
    let isPeak = true;
    for (let offset = 1; offset <= neighborhood && isPeak; offset += 1) {
      if (frame - offset >= 0 && combined[frame - offset]! > combined[frame]!)
        isPeak = false;
      if (
        frame + offset < frameCount &&
        combined[frame + offset]! >= combined[frame]!
      )
        isPeak = false;
    }
    if (!isPeak) continue;
    const previous = peaks.at(-1);
    if (previous !== undefined && frame - previous < spacingFrames) {
      if (combined[frame]! > combined[previous]!)
        peaks[peaks.length - 1] = frame;
      continue;
    }
    peaks.push(frame);
  }
  if (peaks.length === 0) return [];

  const lag = Math.max(
    1,
    Math.round((0.01 * features.sampleRate) / STFT_HOP_SIZE),
  );
  const attackFrames = Math.max(
    1,
    Math.round(ATTACK_WINDOW_SECONDS / hopSeconds),
  );
  const blockSeconds = ENVELOPE_BLOCK_SECONDS;
  const totalPower = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    totalPower[frame] =
      features.powerLow[frame]! +
      features.powerMid[frame]! +
      features.powerHigh[frame]!;
  }

  // Stage one: score every candidate, then drop rumble, duplicates, and ring-outs
  // so stage two measures each hit against its real neighbours.
  let maximumFlux = 0;
  const scored = peaks.map((frame) => {
    // Sum the increment over the frames the flux lag spreads an attack across.
    let totalFlux = 0;
    for (let offset = -lag; offset <= lag; offset += 1) {
      const at = frame + offset;
      if (at < 0 || at >= frameCount) continue;
      totalFlux +=
        features.fluxLow[at]! + features.fluxMid[at]! + features.fluxHigh[at]!;
    }
    maximumFlux = Math.max(maximumFlux, totalFlux);
    return {
      frame,
      totalFlux,
      time: refineOnsetTime(features.envelope, blockSeconds, time[frame]!),
      lowExcess: features.fluxLow[frame]! / thresholds.low,
      midExcess: features.fluxMid[frame]! / thresholds.mid,
      highExcess: features.fluxHigh[frame]! / thresholds.high,
    };
  });
  const hasBandAttack = (power: Float64Array, frame: number): boolean => {
    let before = 0;
    let after = 0;
    for (let at = Math.max(0, frame - lag - 3); at < frame; at += 1)
      before = Math.max(before, power[at]!);
    for (
      let at = frame;
      at <= Math.min(frameCount - 1, frame + attackFrames);
      at += 1
    )
      after = Math.max(after, power[at]!);
    return after > 0 && after >= before * MINIMUM_ONSET_POWER_GROWTH;
  };
  const kept: Array<(typeof scored)[number] & { strength: number }> = [];
  for (const candidate of scored) {
    const onset = {
      ...candidate,
      strength:
        maximumFlux > 0 ? clamp(candidate.totalFlux / maximumFlux, 0, 1) : 0,
    };
    if (onset.strength < STRENGTH_FLOOR) continue;
    if (
      Math.max(onset.lowExcess, onset.midExcess, onset.highExcess) <
      MINIMUM_BAND_EXCESS
    )
      continue;
    if (
      onset.midExcess < MINIMUM_BAND_EXCESS &&
      onset.highExcess < MINIMUM_BAND_EXCESS &&
      onset.lowExcess < LOW_ONLY_BAND_EXCESS
    )
      continue;
    if (!(
      (onset.lowExcess >= MINIMUM_BAND_EXCESS &&
        hasBandAttack(features.powerLow, onset.frame)) ||
      (onset.midExcess >= MINIMUM_BAND_EXCESS &&
        hasBandAttack(features.powerMid, onset.frame)) ||
      (onset.highExcess >= MINIMUM_BAND_EXCESS &&
        hasBandAttack(features.powerHigh, onset.frame))
    ))
      continue;
    const previous = kept.at(-1);
    if (previous !== undefined) {
      const gap = onset.time - previous.time;
      if (gap < DUPLICATE_ONSET_SECONDS) {
        if (onset.strength > previous.strength) kept[kept.length - 1] = onset;
        continue;
      }
      if (
        gap < ECHO_WINDOW_SECONDS &&
        onset.strength < ECHO_STRENGTH_RATIO * previous.strength
      )
        continue;
    }
    // `kept` is time-ordered, so the scan stops at the first onset outside the window.
    let insideRingOut = false;
    for (let back = kept.length - 1; back >= 0; back -= 1) {
      const earlier = kept[back]!;
      if (onset.time - earlier.time >= RING_OUT_WINDOW_SECONDS) break;
      if (earlier.strength >= RING_OUT_STRENGTH_RATIO * onset.strength) {
        insideRingOut = true;
        break;
      }
    }
    if (insideRingOut) continue;
    kept.push(onset);
  }

  // Stage two: band shares, spectral shape, and decay for each kept onset.
  const bandRise = (
    power: Float64Array,
    frame: number,
    limitFrame: number,
  ): number => {
    let before = Infinity;
    for (let at = Math.max(0, frame - lag - 2); at < frame; at += 1)
      before = Math.min(before, power[at]!);
    if (before === Infinity) before = 0;
    let after = 0;
    for (
      let at = frame;
      at <= Math.min(limitFrame, frame + attackFrames);
      at += 1
    )
      after = Math.max(after, power[at]!);
    return Math.max(0, after - before);
  };
  return kept.map((onset, index) => {
    const { frame } = onset;
    const nextFrame = kept[index + 1]?.frame;
    const limitFrame = Math.min(
      frameCount - 1,
      nextFrame === undefined ? frameCount - 1 : nextFrame - 1,
      frame + Math.round(MAXIMUM_DECAY_SECONDS / hopSeconds),
    );
    const lowRise = bandRise(features.powerLow, frame, limitFrame);
    const midRise = bandRise(features.powerMid, frame, limitFrame);
    const highRise = bandRise(features.powerHigh, frame, limitFrame);
    const totalRise = lowRise + midRise + highRise;
    let attackPower = 0;
    let centroid = 0;
    let centroidLowMid = 0;
    let centroidHigh = 0;
    let highPower = 0;
    let flatness = 0;
    for (
      let at = frame;
      at <= Math.min(limitFrame, frame + attackFrames);
      at += 1
    ) {
      const weight = totalPower[at]!;
      attackPower += weight;
      centroid += features.centroid[at]! * weight;
      centroidLowMid += features.centroidLowMid[at]! * weight;
      flatness += features.flatness[at]! * weight;
      centroidHigh += features.centroidHigh[at]! * features.powerHigh[at]!;
      highPower += features.powerHigh[at]!;
    }
    return {
      time: onset.time,
      frame,
      lowRatio: totalRise > 0 ? lowRise / totalRise : 0,
      midRatio: totalRise > 0 ? midRise / totalRise : 0,
      highRatio: totalRise > 0 ? highRise / totalRise : 0,
      lowExcess: onset.lowExcess,
      midExcess: onset.midExcess,
      highExcess: onset.highExcess,
      strength: onset.strength,
      centroidHz: attackPower > 0 ? centroid / attackPower : 0,
      centroidLowMidHz: attackPower > 0 ? centroidLowMid / attackPower : 0,
      centroidHighHz: highPower > 0 ? centroidHigh / highPower : 0,
      flatness: attackPower > 0 ? flatness / attackPower : 0,
      decaySeconds: decayLength(
        totalPower,
        time,
        frame,
        attackFrames,
        limitFrame,
      ),
      highDecaySeconds: decayLength(
        features.powerHigh,
        time,
        frame,
        attackFrames,
        limitFrame,
      ),
      subOnsets: countSubOnsets(features.envelope, blockSeconds, onset.time),
    };
  });
}

// ---------------------------------------------------------------------------
// Classification into the eight General MIDI drum classes.
// ---------------------------------------------------------------------------

export type ClassifiedDrumHit = Readonly<{
  className: DrumClassName;
  /** The winning band's share of the onset increment; feeds the heuristic score. */
  dominance: number;
}>;

export function classifyDrumOnset(
  onset: DrumOnsetFeatures,
): readonly ClassifiedDrumHit[] {
  const { lowRatio, midRatio, highRatio } = onset;
  const cymbalFamily =
    lowRatio < 0.15 && highRatio >= Math.max(0.35, midRatio * 0.8);
  if (cymbalFamily) {
    let className: DrumClassName;
    if (onset.highDecaySeconds >= 0.5 && midRatio >= 0.25) className = "crash";
    else if (onset.highDecaySeconds >= 0.35 && onset.centroidHz < 5_000)
      className = "ride";
    else if (onset.highDecaySeconds >= 0.15) className = "open-hat";
    else className = "closed-hat";
    return [{ className, dominance: highRatio }];
  }
  const hits: ClassifiedDrumHit[] = [];
  // Toms ring longer than kicks and snares and carry almost no high band.
  const pitched = highRatio < 0.1 && onset.decaySeconds >= 0.18;
  if (lowRatio >= 0.4 && highRatio < 0.25) {
    if (pitched && onset.centroidLowMidHz >= 130) {
      hits.push({
        className: onset.centroidLowMidHz < 230 ? "low-tom" : "mid-tom",
        dominance: lowRatio,
      });
    } else {
      hits.push({ className: "kick", dominance: lowRatio });
    }
  } else if (pitched && onset.centroidLowMidHz < 500) {
    hits.push({ className: "mid-tom", dominance: midRatio });
  } else if (
    onset.subOnsets >= 3 &&
    onset.flatness >= 0.2 &&
    onset.centroidLowMidHz >= 450
  ) {
    hits.push({ className: "clap", dominance: midRatio });
  } else {
    hits.push({ className: "snare", dominance: midRatio });
  }
  // A hat struck with a kick or snare adds little power but a distinct
  // high-band flux centred well above the drum's own brightness.
  if (
    onset.highExcess >= HAT_CO_ONSET_EXCESS &&
    highRatio >= HAT_CO_ONSET_MINIMUM_SHARE &&
    onset.centroidHighHz >= HAT_CO_ONSET_CENTROID_HZ
  ) {
    hits.push({
      className: "closed-hat",
      dominance: clamp(onset.highExcess / 10, 0, 1),
    });
  }
  return hits;
}

/** dawg velocities are 0..1 (soundfish used MIDI 1..127 here). */
function velocityFor(strength: number): number {
  const midi = clamp(Math.round(35 + 92 * Math.sqrt(strength)), 1, 127);
  return Math.round((midi / 127) * 100) / 100;
}

/**
 * STFT drum reducer. Every onset becomes one hit per emitted class with a
 * one-hop duration; the loop builder later snaps each hit to a single step.
 */
export function classifyDrumWav(bytes: Uint8Array): readonly TimedNote[] {
  const wav = parseWav(bytes);
  const features = extractFrameFeatures(wav);
  if (features === undefined) return [];
  const onsets = detectDrumOnsets(features);
  const hopSeconds = STFT_HOP_SIZE / wav.sampleRate;
  const notes: TimedNote[] = [];
  for (const onset of onsets) {
    const hits = classifyDrumOnset(onset);
    for (const [index, hit] of hits.entries()) {
      // A co-emitted hat rides under the drum it was struck with.
      const share = index > 0 ? 0.5 : 1;
      notes.push({
        pitch: DRUM_CLASS_PITCHES[hit.className],
        startSeconds: onset.time,
        endSeconds: onset.time + hopSeconds,
        velocity: velocityFor(onset.strength * share),
        heuristicScore: clamp(
          0.35 + 0.4 * hit.dominance + 0.25 * onset.strength,
          0,
          1,
        ),
      });
    }
  }
  return notes.sort(
    (left, right) =>
      left.startSeconds - right.startSeconds || left.pitch - right.pitch,
  );
}
