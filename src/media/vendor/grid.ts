// Vendored from soundfish `lib/song-import/grid.ts` (same owner); the protocol constants it imported are local here.
import type { BeatGrid } from "../types.ts";
import { clamp, finiteNumber, isRecord, parseJson } from "./util.ts";

const MAX_BEATS = 20_000;
const MAX_DURATION_SECONDS = 7_200;
export const FIXED_GRID_DETECTOR = "dawg-fixed-grid";

/** Validates a StemDeck `/api/jobs/<id>/beats` body from `unknown`. */
export function parseBeatGrid(bytes: Uint8Array): BeatGrid {
  const value = parseJson(bytes, "StemDeck beat grid");
  if (!isRecord(value) || !Array.isArray(value.beats)) {
    throw new Error("StemDeck beat grid did not contain a beats array.");
  }
  if (value.beats.length < 2 || value.beats.length > MAX_BEATS) {
    throw new Error(`StemDeck beat grid must contain 2–${MAX_BEATS} beats.`);
  }
  const beats = value.beats.map((entry, index) => {
    const beat = finiteNumber(entry);
    if (beat === undefined || beat < 0 || beat > MAX_DURATION_SECONDS) {
      throw new Error(
        `StemDeck beat ${index} is outside the supported time range.`,
      );
    }
    return beat;
  });
  for (let index = 1; index < beats.length; index += 1) {
    if (beats[index]! <= beats[index - 1]!) {
      throw new Error("StemDeck beat times must be strictly increasing.");
    }
  }
  const duration = finiteNumber(value.duration);
  const lastBeat = beats.at(-1)!;
  const fallbackDuration = Math.min(
    MAX_DURATION_SECONDS,
    lastBeat + (lastBeat - beats.at(-2)!),
  );
  const durationSeconds =
    duration === undefined
      ? fallbackDuration
      : clamp(duration, lastBeat, MAX_DURATION_SECONDS);
  const bars = Array.isArray(value.bars)
    ? value.bars.slice(0, 2_000).flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const beat = finiteNumber(entry.beat);
        const beatsPerBar = finiteNumber(
          entry.beats_per_bar ?? entry.beatsPerBar,
        );
        if (
          beat === undefined ||
          beatsPerBar === undefined ||
          !Number.isSafeInteger(beat) ||
          !Number.isSafeInteger(beatsPerBar) ||
          beat < 0 ||
          beat >= beats.length ||
          beatsPerBar < 1 ||
          beatsPerBar > 32
        ) {
          return [];
        }
        return [{ beat, beatsPerBar }];
      })
    : [];
  const bpm = finiteNumber(value.bpm);
  const confidence = finiteNumber(value.confidence);
  const intervalCv = finiteNumber(value.interval_cv);
  return {
    beats,
    bars,
    durationSeconds,
    ...(bpm === undefined ? {} : { bpm }),
    ...(typeof value.detector === "string"
      ? { detector: value.detector.slice(0, 80) }
      : {}),
    ...(confidence === undefined
      ? {}
      : { confidence: clamp(confidence, 0, 100) }),
    intervalCv:
      intervalCv === undefined
        ? beatIntervalCv(beats)
        : clamp(intervalCv, 0, 10),
  };
}

export function beatIntervalCv(beats: readonly number[]): number {
  if (beats.length < 3) return 0;
  const intervals = beats
    .slice(1)
    .map((beat, index) => beat - beats[index]!)
    .filter((value) => value > 0);
  if (intervals.length < 2) return 0;
  const mean =
    intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    intervals.length;
  return mean <= 0 ? 0 : Math.sqrt(variance) / mean;
}

function edgeInterval(beats: readonly number[], atEnd: boolean): number {
  const count = Math.min(8, beats.length - 1);
  let sum = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const index = atEnd ? beats.length - 2 - offset : offset;
    sum += beats[index + 1]! - beats[index]!;
  }
  return sum / count;
}

/** Piecewise-linear source seconds to the global beat axis (beat 0 = first beat). */
export function secondsToBeat(
  grid: Pick<BeatGrid, "beats">,
  seconds: number,
): number {
  const beats = grid.beats;
  if (beats.length < 2 || !Number.isFinite(seconds)) {
    throw new Error("Cannot map time without a valid beat grid.");
  }
  if (seconds <= beats[0]!) {
    return (seconds - beats[0]!) / edgeInterval(beats, false);
  }
  const lastIndex = beats.length - 1;
  if (seconds >= beats[lastIndex]!) {
    return (
      lastIndex + (seconds - beats[lastIndex]!) / edgeInterval(beats, true)
    );
  }
  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle]! <= seconds) low = middle;
    else high = middle;
  }
  const interval = beats[low + 1]! - beats[low]!;
  return low + (seconds - beats[low]!) / interval;
}

/** Inverse of secondsToBeat on the same piecewise-linear beat axis. */
export function beatToSeconds(
  grid: Pick<BeatGrid, "beats">,
  beat: number,
): number {
  const beats = grid.beats;
  if (beats.length < 2 || !Number.isFinite(beat)) {
    throw new Error("Cannot map beats without a valid beat grid.");
  }
  const lastIndex = beats.length - 1;
  if (beat <= 0) return beats[0]! + beat * edgeInterval(beats, false);
  if (beat >= lastIndex) {
    return beats[lastIndex]! + (beat - lastIndex) * edgeInterval(beats, true);
  }
  const index = Math.floor(beat);
  const fraction = beat - index;
  return beats[index]! + fraction * (beats[index + 1]! - beats[index]!);
}

export function gridMedianBpm(grid: Pick<BeatGrid, "beats" | "bpm">): number {
  if (grid.bpm !== undefined && Number.isFinite(grid.bpm)) {
    return clamp(Math.round(grid.bpm), 40, 240);
  }
  const intervals = grid.beats
    .slice(1)
    .map((beat, index) => beat - grid.beats[index]!)
    .filter((interval) => interval > 0)
    .sort((left, right) => left - right);
  if (intervals.length === 0) return 120;
  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2 === 0
      ? (intervals[middle - 1]! + intervals[middle]!) / 2
      : intervals[middle]!;
  return clamp(Math.round(60 / median), 40, 240);
}

/** A metronomic grid at `bpm` from `offsetSeconds`, 4 beats per bar. */
export function fixedBeatGrid(
  bpm: number,
  durationSeconds: number,
  offsetSeconds = 0,
): BeatGrid {
  const interval = 60 / clamp(bpm, 40, 240);
  const duration = clamp(durationSeconds, interval * 2, MAX_DURATION_SECONDS);
  const count = Math.min(
    MAX_BEATS,
    Math.max(2, Math.ceil(duration / interval)),
  );
  const beats: number[] = [];
  const start = clamp(offsetSeconds, 0, interval);
  for (let index = 0; index < count; index += 1)
    beats.push(start + index * interval);
  const bars: { beat: number; beatsPerBar: number }[] = [];
  for (let beat = 0; beat < count; beat += 4)
    bars.push({ beat, beatsPerBar: 4 });
  return {
    beats,
    bars,
    durationSeconds: duration,
    bpm,
    detector: FIXED_GRID_DETECTOR,
    intervalCv: 0,
  };
}
