/**
 * Loudness and mix measurement after ITU-R BS.1770-4 and EBU R 128:
 * K-weighted mean square, momentary (400 ms) and short-term (3 s) loudness
 * every 100 ms, gated integrated loudness (absolute -70 LUFS, relative
 * -10 LU), loudness range per EBU Tech 3342 (short-term values gated at
 * -70 LUFS and -20 LU, 10th to 95th percentile) and true peak from a 4x
 * oversampled polyphase interpolator (BS.1770-4 Annex 2). Validated against
 * the synthetic test signals of EBU Tech 3341 and 3342 in loudness.test.ts.
 *
 * A `loop` buffer is measured as if it repeated forever: filters start in
 * their steady state and windows wrap around the loop end.
 */
import { fftInPlace } from "./effects/convolution.ts";

export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = -10;
export const RANGE_GATE_LU = -20;
/** Series step (and the gating-block hop): 100 ms. */
export const LOUDNESS_STEP_SECONDS = 0.1;
export const MOMENTARY_SECONDS = 0.4;
export const SHORT_TERM_SECONDS = 3;
/** True-peak oversampling factor and taps per polyphase branch. */
export const TRUE_PEAK_FACTOR = 4;
const TAPS_PER_PHASE = 12;

export type Loudness = Readonly<{
  /** Gated integrated loudness, LUFS; -Infinity when everything is gated. */
  integrated: number;
  momentaryMax: number;
  shortTermMax: number;
  /** Loudness range (LRA), LU. */
  range: number;
  /** dBTP: the 4x oversampled peak. */
  truePeak: number;
  /** dBFS: the highest sample. */
  samplePeak: number;
  /** Momentary loudness of the 400 ms ending at each 100 ms step. */
  momentary: Float64Array;
  /** Short-term loudness of the 3 s ending at each 100 ms step. */
  shortTerm: Float64Array;
  /** Seconds between series values. */
  step: number;
  /** Seconds measured. */
  seconds: number;
}>;

export type LoudnessOptions = Readonly<{
  /** Measure the buffer as a loop playing forever (see the module doc). */
  loop?: boolean;
  /** Skip the oversampled true peak (reported as the sample peak). */
  truePeak?: boolean;
}>;

/** -0.691 + 10·log10(power): BS.1770 loudness of a K-weighted power sum. */
export function powerToLufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

type Coefficients = Readonly<{
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}>;

/**
 * K-weighting at any sample rate: the BS.1770 shelving pre-filter and RLB
 * high-pass, from their analog prototypes by the bilinear transform (the
 * parameters libebur128 derives; at 48 kHz they reproduce the standard's
 * coefficient tables).
 */
export function kWeighting(
  sampleRate: number,
): readonly [Coefficients, Coefficients] {
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highPass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highPass];
}

/** K-weighted `left² + right²` per sample (stereo weights are 1). */
function weightedPower(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  loop: boolean,
): Float64Array {
  const n = left.length;
  const power = new Float64Array(n);
  const [shelf, highPass] = kWeighting(sampleRate);
  for (const channel of [left, right]) {
    let s1 = 0;
    let s2 = 0;
    let h1 = 0;
    let h2 = 0;
    // A loop runs one pass first so the filters start in their steady state.
    for (let pass = loop ? 0 : 1; pass < 2; pass += 1)
      for (let index = 0; index < n; index += 1) {
        const x = channel[index]!;
        const y = shelf.b0 * x + s1;
        s1 = shelf.b1 * x - shelf.a1 * y + s2;
        s2 = shelf.b2 * x - shelf.a2 * y;
        const z = highPass.b0 * y + h1;
        h1 = highPass.b1 * y - highPass.a1 * z + h2;
        h2 = highPass.b2 * y - highPass.a2 * z;
        if (pass === 1) power[index]! += z * z;
      }
  }
  return power;
}

/** Prefix sums, so any window's power is a difference of two entries. */
function prefixSums(values: Float64Array): Float64Array {
  const sums = new Float64Array(values.length + 1);
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index]!;
    sums[index + 1] = total;
  }
  return sums;
}

/**
 * Mean power of the `width` samples ending at `end`. A loop wraps around;
 * a one-shot treats everything before the start as silence.
 */
function windowPower(
  sums: Float64Array,
  end: number,
  width: number,
  loop: boolean,
): number {
  const n = sums.length - 1;
  if (n === 0 || width <= 0) return 0;
  if (!loop) {
    const start = Math.max(0, end - width);
    return (sums[end]! - sums[start]!) / width;
  }
  let total = 0;
  let remaining = width;
  let stop = end;
  while (remaining > 0) {
    const take = Math.min(remaining, stop);
    total += sums[stop]! - sums[stop - take]!;
    remaining -= take;
    stop = stop - take === 0 ? n : stop - take;
  }
  return total / width;
}

/** BS.1770-4 gating over block powers: -70 LUFS, then `relative` LU. */
export function gatedLoudness(
  powers: readonly number[] | Float64Array,
  relative = RELATIVE_GATE_LU,
): number {
  let sum = 0;
  let count = 0;
  for (const power of powers)
    if (powerToLufs(power) > ABSOLUTE_GATE_LUFS) {
      sum += power;
      count += 1;
    }
  if (count === 0) return -Infinity;
  const gate = powerToLufs(sum / count) + relative;
  sum = 0;
  count = 0;
  for (const power of powers)
    if (powerToLufs(power) > ABSOLUTE_GATE_LUFS && powerToLufs(power) > gate) {
      sum += power;
      count += 1;
    }
  return count === 0 ? -Infinity : powerToLufs(sum / count);
}

/** EBU Tech 3342 loudness range of short-term block powers, LU. */
export function loudnessRange(
  powers: readonly number[] | Float64Array,
): number {
  const kept: number[] = [];
  let sum = 0;
  for (const power of powers)
    if (powerToLufs(power) > ABSOLUTE_GATE_LUFS) {
      kept.push(power);
      sum += power;
    }
  if (kept.length === 0) return 0;
  const gate = powerToLufs(sum / kept.length) + RANGE_GATE_LU;
  const values = kept
    .map(powerToLufs)
    .filter((value) => value > gate)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const low = values[Math.round((values.length - 1) * 0.1)]!;
  const high = values[Math.round((values.length - 1) * 0.95)]!;
  return high - low;
}

/**
 * The interpolating FIR of ITU-R BS.1770-4 Annex 2 (48 taps, 4 phases of
 * 12), each phase in time order over x[n-5] .. x[n+6]. The phases estimate
 * the signal at n + 1/8, 3/8, 5/8 and 7/8; together with the samples
 * themselves (as libebur128 does) they give the 4x oversampled true peak.
 */
const TRUE_PEAK_TAPS: readonly (readonly number[])[] = [
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875,
    -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875,
    0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625,
    -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625,
    0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125,
    -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625,
    -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125,
    -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875,
    0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
  ],
];

let phases: Float64Array[] | undefined;

/** The Annex 2 phases as typed arrays (see TRUE_PEAK_TAPS). */
export function truePeakPhases(): readonly Float64Array[] {
  phases ??= TRUE_PEAK_TAPS.map((taps) => Float64Array.from(taps));
  return phases;
}

/**
 * Largest absolute value between each sample and the next (both samples
 * and the four interpolated points), as `out[n]` for n .. n+1.
 */
export function interSamplePeaks(
  channel: Float64Array,
  loop: boolean,
  out: Float64Array,
): void {
  const n = channel.length;
  const branches = truePeakPhases();
  const before = TAPS_PER_PHASE / 2 - 1;
  const at = (index: number): number => {
    if (index >= 0 && index < n) return channel[index]!;
    if (!loop || n === 0) return 0;
    return channel[((index % n) + n) % n]!;
  };
  for (let index = 0; index < n; index += 1) {
    let peak = Math.abs(channel[index]!);
    const next = Math.abs(at(index + 1));
    if (next > peak) peak = next;
    const inside = index - before >= 0 && index + TAPS_PER_PHASE - before <= n;
    for (const taps of branches) {
      let sum = 0;
      if (inside)
        for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1)
          sum += channel[index - before + tap]! * taps[tap]!;
      else
        for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1)
          sum += at(index - before + tap) * taps[tap]!;
      const magnitude = Math.abs(sum);
      if (magnitude > peak) peak = magnitude;
    }
    if (peak > out[index]!) out[index] = peak;
  }
}

/** The 4x oversampled true peak of a stereo buffer, linear. */
export function truePeakGain(
  left: Float64Array,
  right: Float64Array,
  loop = false,
): number {
  const peaks = new Float64Array(left.length);
  interSamplePeaks(left, loop, peaks);
  interSamplePeaks(right, loop, peaks);
  let max = 0;
  for (const peak of peaks) if (peak > max) max = peak;
  return max;
}

/** Integrated loudness only (no series, no true peak), LUFS. */
export function integratedLoudness(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  loop = false,
): number {
  const sums = prefixSums(weightedPower(left, right, sampleRate, loop));
  return gatedLoudness(blockPowers(sums, sampleRate, loop, MOMENTARY_SECONDS));
}

/** Window ends every 100 ms: complete windows only for a one-shot. */
function stepEnds(n: number, sampleRate: number, loop: boolean): number[] {
  const step = sampleRate * LOUDNESS_STEP_SECONDS;
  const count = loop
    ? Math.max(1, Math.round(n / step))
    : Math.floor(n / step + 1e-9);
  const ends: number[] = [];
  for (let k = 1; k <= count; k += 1)
    ends.push(loop ? Math.round((k * n) / count) : Math.round(k * step));
  return ends;
}

function blockPowers(
  sums: Float64Array,
  sampleRate: number,
  loop: boolean,
  seconds: number,
): number[] {
  const n = sums.length - 1;
  const width = Math.round(seconds * sampleRate);
  const powers: number[] = [];
  for (const end of stepEnds(n, sampleRate, loop))
    if (loop || end >= width) powers.push(windowPower(sums, end, width, loop));
  return powers;
}

/** Grid of the momentary and short-term maxima: 10 ms (EBU Tech 3341). */
export const MAX_STEP_SECONDS = 0.01;

/**
 * The loudest `width`-sample window, with window ends on a 10 ms grid (the
 * update rate EBU Tech 3341 asks of max momentary and short-term), so a
 * burst between two 100 ms series steps still reads its full loudness.
 */
function maxWindowLufs(
  sums: Float64Array,
  sampleRate: number,
  width: number,
  loop: boolean,
): number {
  const n = sums.length - 1;
  const step = sampleRate * MAX_STEP_SECONDS;
  let max = -Infinity;
  const consider = (end: number) => {
    const value = powerToLufs(windowPower(sums, end, width, loop));
    if (value > max) max = value;
  };
  if (loop) {
    const count = Math.max(1, Math.round(n / step));
    for (let k = 1; k <= count; k += 1) consider(Math.round((k * n) / count));
    return max;
  }
  if (n < width) return max;
  for (let k = 0; ; k += 1) {
    const end = width + Math.round(k * step);
    if (end > n) break;
    consider(end);
  }
  consider(n);
  return max;
}

/** Everything a loudness meter shows, for a stereo buffer. */
export function measureLoudness(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  options: LoudnessOptions = {},
): Loudness {
  const loop = options.loop ?? false;
  const n = left.length;
  const sums = prefixSums(weightedPower(left, right, sampleRate, loop));
  const ends = stepEnds(n, sampleRate, loop);
  const momentaryWidth = Math.round(MOMENTARY_SECONDS * sampleRate);
  const shortWidth = Math.round(SHORT_TERM_SECONDS * sampleRate);
  const momentary = new Float64Array(ends.length);
  const shortTerm = new Float64Array(ends.length);
  const blocks: number[] = [];
  const shortBlocks: number[] = [];
  ends.forEach((end, index) => {
    const m = windowPower(sums, end, momentaryWidth, loop);
    const s = windowPower(sums, end, shortWidth, loop);
    momentary[index] = powerToLufs(m);
    shortTerm[index] = powerToLufs(s);
    if (loop || end >= momentaryWidth) blocks.push(m);
    if (loop || end >= shortWidth) shortBlocks.push(s);
  });
  const momentaryMax = maxWindowLufs(sums, sampleRate, momentaryWidth, loop);
  const shortTermMax = maxWindowLufs(sums, sampleRate, shortWidth, loop);
  let samplePeak = 0;
  for (let index = 0; index < n; index += 1) {
    const peak = Math.max(Math.abs(left[index]!), Math.abs(right[index]!));
    if (peak > samplePeak) samplePeak = peak;
  }
  const truePeak =
    options.truePeak === false
      ? samplePeak
      : Math.max(samplePeak, truePeakGain(left, right, loop));
  return Object.freeze({
    integrated: gatedLoudness(blocks),
    momentaryMax,
    shortTermMax,
    range: loudnessRange(shortBlocks),
    truePeak: gainToDb(truePeak),
    samplePeak: gainToDb(samplePeak),
    momentary,
    shortTerm,
    step: LOUDNESS_STEP_SECONDS,
    seconds: n / sampleRate,
  });
}

/** Interleaved 16-bit stereo PCM as two float channels. */
export function pcmChannels(
  pcm: Int16Array,
): readonly [Float64Array, Float64Array] {
  const frames = Math.floor(pcm.length / 2);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let index = 0; index < frames; index += 1) {
    left[index] = pcm[index * 2]! / 32767;
    right[index] = pcm[index * 2 + 1]! / 32767;
  }
  return [left, right];
}

/** Spectral bands `measureMix` reports, low edge to high edge in Hz. */
export const MIX_BANDS = Object.freeze([
  { name: "sub", low: 20, high: 60 },
  { name: "bass", low: 60, high: 250 },
  { name: "low-mid", low: 250, high: 2_000 },
  { name: "high-mid", low: 2_000, high: 6_000 },
  { name: "high", low: 6_000, high: 20_000 },
] as const);

export type MixMeasurement = Readonly<{
  loudness: Loudness;
  /** Share of energy per band in dB relative to the whole (0 = all of it). */
  bands: Readonly<Record<(typeof MIX_BANDS)[number]["name"], number>>;
  /** Pearson correlation of left and right: 1 mono, 0 wide, <0 out of phase. */
  correlation: number;
  /** Side energy relative to mid energy, dB (-Infinity for mono). */
  sideDb: number;
  /** Peak-to-loudness ratio (EBU PLR): true peak minus integrated, LU. */
  plr: number;
}>;

/**
 * Loudness, spectral balance (Welch average of 4096-point Hann frames),
 * stereo correlation and side level of a stereo buffer.
 */
export function measureMix(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  options: LoudnessOptions = {},
): MixMeasurement {
  const loudness = measureLoudness(left, right, sampleRate, options);
  const n = left.length;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  let mid = 0;
  let side = 0;
  for (let index = 0; index < n; index += 1) {
    const l = left[index]!;
    const r = right[index]!;
    lr += l * r;
    ll += l * l;
    rr += r * r;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  const correlation = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  const size = 4096;
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  const spectrum = new Float64Array(size / 2 + 1);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hop = size / 2;
  for (let start = 0; start === 0 || start + size <= n; start += hop) {
    for (const channel of [left, right]) {
      for (let index = 0; index < size; index += 1) {
        const at = start + index;
        re[index] = at < n ? channel[at]! * window[index]! : 0;
        im[index] = 0;
      }
      fftInPlace(re, im);
      for (let bin = 0; bin <= size / 2; bin += 1)
        spectrum[bin]! += re[bin]! * re[bin]! + im[bin]! * im[bin]!;
    }
    if (start + size >= n) break;
  }
  let total = 0;
  const energy = MIX_BANDS.map(() => 0);
  for (let bin = 1; bin <= size / 2; bin += 1) {
    const hz = (bin * sampleRate) / size;
    total += spectrum[bin]!;
    const band = MIX_BANDS.findIndex(
      (entry) => hz >= entry.low && hz < entry.high,
    );
    if (band >= 0) energy[band]! += spectrum[bin]!;
  }
  const bands = Object.fromEntries(
    MIX_BANDS.map((band, index) => [
      band.name,
      total > 0 && energy[index]! > 0
        ? 10 * Math.log10(energy[index]! / total)
        : -Infinity,
    ]),
  ) as MixMeasurement["bands"];
  return Object.freeze({
    loudness,
    bands,
    correlation,
    sideDb: mid > 0 && side > 0 ? 10 * Math.log10(side / mid) : -Infinity,
    plr: loudness.truePeak - loudness.integrated,
  });
}
