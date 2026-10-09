/**
 * Fitting sampler windows to the song's time (0.6 `bpm`, `len`, `fit` with
 * `fitmode`). Each algorithm turns a window (already at the render rate)
 * and its position map (`warp.ts` `FitMap`) into a fitted buffer that the
 * sampler then plays at step 1, so `renderSamplerVoices` keeps one code
 * path and one call site.
 *
 * - `repitch` reads the window along the map (tape: pitch follows speed).
 * - `beats` cuts the window at its SuperFlux onsets and places every slice
 *   verbatim at its mapped time; a slice ends with a 2 ms fade at the next
 *   slice's start, and a slowed slice leaves a gap (Ableton Beats without
 *   transient loops; no WSOLA, so drums keep their exact transients).
 * - `tones` is a phase vocoder with identity phase locking (Laroche and
 *   Dolson, IEEE TSAP 1999), 85 ms Hann frames, hop N/4, analysing two
 *   frames one hop apart around the map's source position so any map works.
 *
 * Results are cached by content key in a 64 MB Float32 LRU (the played
 * window only). Offline renders always compute exactly. Live renders
 * (`withLiveFit`) compute windows up to 8 s synchronously and longer ones
 * in the background: until ready the voice is silent and `fitting()` is
 * true, so a live note never plays at the wrong pitch.
 */
import { ONSET_LEAD_SECONDS, detectOnsets } from "./dsp/onset.ts";
import {
  HANN_SQUARED_OLA_QUARTER,
  analyse,
  frameSize,
  hann,
  inverse,
  princarg,
  sampleAt,
} from "./dsp/stft.ts";
import { hermite4 } from "./dsp/interp.ts";
import type { FitMap } from "./warp.ts";

export type FitAlgorithm = "repitch" | "beats" | "tones";

/** Cache bound, in bytes of Float32 output. */
export const FIT_CACHE_BYTES = 64 * 1024 * 1024;
/** Live renders compute windows up to this long synchronously. */
export const LIVE_SYNC_FIT_SECONDS = 8;
/** Slice end fade for `beats`. */
const SLICE_FADE_SECONDS = 0.002;
/** Phase vocoder frame for `tones`. */
const VOCODER_FRAME_SECONDS = 0.085;
/** Frames of work between yields of a background fit. */
const CHUNK = 64;

const cache = new Map<string, Float32Array>();
let cachedBytes = 0;
const onsetCache = new Map<string, readonly number[]>();
const pending = new Map<string, Generator<void, Float32Array>>();
let live = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Run `render` as a live render: long uncached fits go to the background. */
export function withLiveFit<T>(render: () => T): T {
  const was = live;
  live = true;
  try {
    return render();
  } finally {
    live = was;
  }
}

/** True while a background fit is running ("fitting"). */
export function fitting(): boolean {
  return pending.size > 0;
}

/** Called once each time a background fit finishes. */
export function onFitReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops every cached fit (tests). */
export function clearFitCache(): void {
  cache.clear();
  cachedBytes = 0;
  onsetCache.clear();
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
}

/**
 * The fitted buffer for `key`, computing it when needed. Returns undefined
 * only in a live render while a long window is still fitting.
 */
export function fittedBuffer(
  key: string,
  window: Float32Array,
  sampleRate: number,
  map: FitMap,
  algorithm: FitAlgorithm,
  onsetKey: string,
): Float32Array | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const work = () =>
    fitWork(window, sampleRate, map, algorithm, () => {
      const known = onsetCache.get(onsetKey);
      if (known) return known;
      const found = detectOnsets(window, sampleRate);
      onsetCache.set(onsetKey, found);
      return found;
    });
  if (live && window.length > LIVE_SYNC_FIT_SECONDS * sampleRate) {
    if (!pending.has(key)) {
      pending.set(key, work());
      schedule();
    }
    return undefined;
  }
  pending.delete(key);
  const out = drain(work());
  remember(key, out);
  return out;
}

function drain(job: Generator<void, Float32Array>): Float32Array {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const next = pending.entries().next();
    if (next.done) return;
    const [key, job] = next.value;
    const until = performance.now() + 8;
    for (;;) {
      const step = job.next();
      if (step.done) {
        pending.delete(key);
        remember(key, step.value);
        for (const listener of listeners) listener();
        break;
      }
      if (performance.now() > until) break;
    }
    if (pending.size > 0) schedule();
  }, 0);
}

function remember(key: string, out: Float32Array): void {
  if (out.byteLength > FIT_CACHE_BYTES) return;
  cache.set(key, out);
  cachedBytes += out.byteLength;
  for (const [old, buffer] of cache) {
    if (cachedBytes <= FIT_CACHE_BYTES) break;
    cache.delete(old);
    cachedBytes -= buffer.byteLength;
  }
}

/** Bytes held by the fit cache. */
export function fitCacheBytes(): number {
  return cachedBytes;
}

function* fitWork(
  window: Float32Array,
  sampleRate: number,
  map: FitMap,
  algorithm: FitAlgorithm,
  onsets: () => readonly number[],
): Generator<void, Float32Array> {
  const length = Math.max(1, Math.round(map.length));
  if (algorithm === "repitch") {
    const out = new Float32Array(length);
    for (let e = 0; e < length; e += 1) {
      out[e] = hermiteRead(window, map.at(e));
      if (e % (CHUNK * 1024) === 0) yield;
    }
    return out;
  }
  if (algorithm === "beats") {
    yield;
    return beatsFit(window, sampleRate, onsets(), map, length);
  }
  return yield* tonesFit(window, sampleRate, map, length);
}

/**
 * `beats`: each inter-onset slice copied verbatim to its mapped start,
 * cut with a 2 ms fade at the next slice's mapped start.
 */
export function beatsFit(
  x: Float32Array,
  sampleRate: number,
  onsets: readonly number[],
  map: FitMap,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  const marks = [0, ...onsets.filter((v) => v > 0 && v < x.length), x.length];
  const fade = Math.max(1, Math.round(SLICE_FADE_SECONDS * sampleRate));
  // Onsets sit 1 ms before the rise (onset.ts); anchoring at the rise puts
  // the transient itself, not the slice edge, on the mapped time.
  const lead = Math.round(ONSET_LEAD_SECONDS * sampleRate);
  const place = (v: number) =>
    v === 0 || v === x.length
      ? Math.round(map.outAt(v))
      : Math.round(map.outAt(Math.min(x.length, v + lead))) - lead;
  for (let s = 0; s + 1 < marks.length; s += 1) {
    const a = marks[s]!;
    const b = marks[s + 1]!;
    const oa = Math.max(0, place(a));
    const ob = Math.min(length, place(b));
    const span = Math.min(ob - oa, b - a);
    if (span <= 0) continue;
    const cut = ob - oa < b - a;
    for (let i = 0; i < span && oa + i < length; i += 1) {
      const g = cut && i >= span - fade ? (span - i) / fade : 1;
      out[oa + i] = out[oa + i]! + x[a + i]! * g;
    }
  }
  return out;
}

/**
 * `tones`: phase vocoder with identity phase locking. Each output hop
 * analyses the window at the map's position and one hop before it, so the
 * instantaneous frequency comes from the source and the map may vary.
 */
export function* tonesFit(
  x: Float32Array,
  sampleRate: number,
  map: FitMap,
  length: number,
): Generator<void, Float32Array> {
  const n = frameSize(VOCODER_FRAME_SECONDS, sampleRate);
  const hs = n / 4;
  const half = n / 2;
  const w = hann(n);
  const norm = 1 / HANN_SQUARED_OLA_QUARTER;
  const out = new Float64Array(length + n);
  const reA = new Float64Array(n);
  const imA = new Float64Array(n);
  const reB = new Float64Array(n);
  const imB = new Float64Array(n);
  const mag = new Float64Array(half + 1);
  const phA = new Float64Array(half + 1);
  const syn = new Float64Array(half + 1);
  const next = new Float64Array(half + 1);
  const omega = new Float64Array(half + 1);
  const peaks: number[] = [];
  for (let m = 0; m * hs < length; m += 1) {
    if (m % CHUNK === CHUNK - 1) yield;
    const at = Math.round(map.at(m * hs + half) - half);
    analyse(x, at, w, reA, imA);
    analyse(x, at - hs, w, reB, imB);
    for (let k = 0; k <= half; k += 1) {
      mag[k] = Math.hypot(reA[k]!, imA[k]!);
      phA[k] = Math.atan2(imA[k]!, reA[k]!);
      const phB = Math.atan2(imB[k]!, reB[k]!);
      const bin = (2 * Math.PI * k * hs) / n;
      omega[k] = bin + princarg(phA[k]! - phB - bin);
    }
    if (m === 0) syn.set(phA);
    else {
      // Peaks: local maxima over ±2 bins; each bin keeps its phase offset
      // from its nearest peak, which advances by its own frequency.
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
    for (let k = 0; k <= half; k += 1) {
      const a = mag[k]!;
      reA[k] = a * Math.cos(syn[k]!);
      imA[k] = a * Math.sin(syn[k]!);
      if (k > 0 && k < half) {
        reA[n - k] = reA[k]!;
        imA[n - k] = -imA[k]!;
      }
    }
    imA[0] = 0;
    imA[half] = 0;
    inverse(reA, imA);
    const o0 = m * hs;
    for (let i = 0; i < n; i += 1)
      out[o0 + i] = out[o0 + i]! + reA[i]! * w[i]! * norm;
  }
  const result = new Float32Array(length);
  for (let i = 0; i < length; i += 1) result[i] = out[i]!;
  return result;
}

/** Window `[from, to)` of `mono` at `rate` source frames per output frame, linear reads like the sampler's; reversed when asked. */
export function windowAt(
  mono: Float32Array,
  from: number,
  to: number,
  rate: number,
  reverse: boolean,
): Float32Array {
  const frames = Math.max(1, Math.floor((to - from) / rate));
  const out = new Float32Array(frames);
  const last = mono.length - 1;
  for (let i = 0; i < frames; i += 1) {
    const position = reverse ? to - 1 - i * rate : from + i * rate;
    if (position <= 0) out[i] = mono[0]!;
    else if (position >= last) out[i] = mono[last]!;
    else {
      const base = Math.floor(position);
      const a = mono[base]!;
      out[i] = a + (mono[base + 1]! - a) * (position - base);
    }
  }
  return out;
}

/** 4-point Hermite read of a Float32 buffer, zero outside it. */
function hermiteRead(x: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  return hermite4(
    sampleAt(x, i - 1),
    sampleAt(x, i),
    sampleAt(x, i + 1),
    sampleAt(x, i + 2),
    pos - i,
  );
}
