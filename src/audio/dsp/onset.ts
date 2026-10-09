/**
 * Onset detection: SuperFlux (Böck and Widmer, "Maximum filter vibrato
 * suppression for onset detection", DAFx 2013): positive log-magnitude flux
 * of each frame against a 3-bin maximum-filtered previous frame, peak-picked
 * against a local median plus the global mean, then refined to the start of
 * the energy rise. Deterministic; positions are sample frames.
 *
 * A hit at t = 0 has no previous frame to rise from, so it is reported when
 * the signal starts loud (first 5 ms above 10 % of the peak).
 */
import { analyse, frameCount, hann, nextPow2 } from "./stft.ts";

/** Hits closer than this merge into the first (a flam). */
export const ONSET_MIN_GAP_SECONDS = 0.03;
/** A refined onset sits this far before the energy rise. */
export const ONSET_LEAD_SECONDS = 0.001;

export function detectOnsets(
  x: ArrayLike<number>,
  sampleRate: number,
  sensitivity = 1,
): number[] {
  const n = nextPow2(0.021 * sampleRate);
  const hop = n / 4;
  const half = n / 2;
  const w = hann(n);
  const frames = frameCount(x.length, n, hop);
  const flux = new Float64Array(frames);
  let prev = new Float64Array(half + 1);
  let cur = new Float64Array(half + 1);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let m = 0; m < frames; m += 1) {
    analyse(x, m * hop, w, re, im);
    let f = 0;
    for (let k = 0; k <= half; k += 1) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      const lo = k > 0 ? prev[k - 1]! : prev[k]!;
      const hi = k < half ? prev[k + 1]! : prev[k]!;
      const d = cur[k]! - Math.max(lo, prev[k]!, hi);
      if (d > 0) f += d;
    }
    flux[m] = m === 0 ? 0 : f;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  let mean = 0;
  for (let m = 0; m < frames; m += 1) mean += flux[m]!;
  mean /= Math.max(1, frames);
  const onsets: number[] = [];
  const minGap = Math.round(ONSET_MIN_GAP_SECONDS * sampleRate);
  const radius = 8;
  const local: number[] = [];
  const startsLoud = loudStart(x, sampleRate);
  if (startsLoud) onsets.push(0);
  for (let m = 1; m < frames - 1; m += 1) {
    const v = flux[m]!;
    let isPeak = true;
    for (let j = Math.max(0, m - 3); j <= Math.min(frames - 1, m + 3); j += 1)
      if (flux[j]! > v || (flux[j] === v && j < m)) {
        isPeak = false;
        break;
      }
    if (!isPeak) continue;
    local.length = 0;
    for (
      let j = Math.max(0, m - radius);
      j <= Math.min(frames - 1, m + radius);
      j += 1
    )
      local.push(flux[j]!);
    local.sort((a, b) => a - b);
    const median = local[local.length >> 1]!;
    if (v < (median * 1.5 + mean * 0.5) / sensitivity) continue;
    const at = refineOnset(x, sampleRate, m * hop + half);
    if (onsets.length > 0 && at - onsets[onsets.length - 1]! < minGap) continue;
    onsets.push(at);
  }
  return onsets;
}

function loudStart(x: ArrayLike<number>, sampleRate: number): boolean {
  let peak = 0;
  for (let i = 0; i < x.length; i += 1) peak = Math.max(peak, Math.abs(x[i]!));
  if (peak === 0) return false;
  const head = Math.min(x.length, Math.round(0.005 * sampleRate));
  for (let i = 0; i < head; i += 1)
    if (Math.abs(x[i]!) > 0.1 * peak) return true;
  return false;
}

/**
 * The start of the energy rise near `coarse`, less 1 ms. Within -30..+15 ms
 * of the coarse frame, 1 ms envelope blocks of the signal and of its first
 * difference (which favours the clicks of a transient over the low ring of a
 * previous kick) are compared with the loudest block of the 10 ms before
 * them; the block that rises most over that background wins, and the onset
 * is its first sample above the background plus a quarter of the rise. A
 * hit in silence is unchanged; one in the previous hit's ring-out no longer
 * latches onto the tail.
 */
function refineOnset(
  x: ArrayLike<number>,
  sampleRate: number,
  coarse: number,
): number {
  const from = Math.max(1, Math.round(coarse - 0.03 * sampleRate));
  const to = Math.min(x.length, Math.round(coarse + 0.015 * sampleRate));
  if (to <= from) return coarse;
  const block = Math.max(1, Math.round(0.001 * sampleRate));
  const back = 10;
  const start = Math.max(1, from - back * block);
  const blocks = Math.ceil((to - start) / block);
  const raw = new Float64Array(blocks);
  const diff = new Float64Array(blocks);
  for (let i = start; i < to; i += 1) {
    const b = Math.floor((i - start) / block);
    raw[b] = Math.max(raw[b]!, Math.abs(x[i]!));
    diff[b] = Math.max(diff[b]!, Math.abs(x[i]! - x[i - 1]!));
  }
  let peakRaw = 0;
  let peakDiff = 0;
  for (let b = 0; b < blocks; b += 1) {
    peakRaw = Math.max(peakRaw, raw[b]!);
    peakDiff = Math.max(peakDiff, diff[b]!);
  }
  if (peakRaw === 0) return coarse;
  const first = Math.floor((from - start) / block);
  let best = -1;
  let bestScore = 0;
  let bestDiff = false;
  let bestBg = 0;
  for (let b = Math.max(1, first); b < blocks; b += 1) {
    let bgRaw = 0;
    let bgDiff = 0;
    for (let k = Math.max(0, b - back); k < b; k += 1) {
      bgRaw = Math.max(bgRaw, raw[k]!);
      bgDiff = Math.max(bgDiff, diff[k]!);
    }
    const rawScore = raw[b]! / (bgRaw + 0.02 * peakRaw);
    const diffScore = peakDiff > 0 ? diff[b]! / (bgDiff + 0.02 * peakDiff) : 0;
    const score = Math.max(rawScore, diffScore);
    if (score > bestScore) {
      bestScore = score;
      best = b;
      bestDiff = diffScore > rawScore;
      bestBg = bestDiff ? bgDiff : bgRaw;
    }
  }
  if (best < 0) return coarse;
  const level = bestDiff ? diff[best]! : raw[best]!;
  const threshold = bestBg + 0.25 * (level - bestBg);
  const lo = Math.max(1, start + (best - 1) * block);
  const hi = Math.min(to, start + (best + 1) * block);
  let at = start + best * block;
  for (let i = lo; i < hi; i += 1) {
    const v = bestDiff ? Math.abs(x[i]! - x[i - 1]!) : Math.abs(x[i]!);
    if (v > threshold) {
      at = i;
      break;
    }
  }
  return Math.max(0, at - Math.round(ONSET_LEAD_SECONDS * sampleRate));
}

/**
 * Crest factor (peak over RMS) and onset rate (per second) of a window:
 * the content probe that suggests a fit mode.
 */
export function contentProbe(
  x: ArrayLike<number>,
  sampleRate: number,
): { crest: number; onsetRate: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, x.length));
  const seconds = x.length / sampleRate;
  return {
    crest: rms > 0 ? peak / rms : 0,
    onsetRate: seconds > 0 ? detectOnsets(x, sampleRate).length / seconds : 0,
  };
}

/** Drums and speech (crest > 5 and > 2 onsets/s) fit as `beats`, the rest as `tones`. */
export function suggestFitMode(
  x: ArrayLike<number>,
  sampleRate: number,
): "beats" | "tones" {
  const { crest, onsetRate } = contentProbe(x, sampleRate);
  return crest > 5 && onsetRate > 2 ? "beats" : "tones";
}
