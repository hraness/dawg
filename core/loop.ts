import type { SongTime } from "./tempo.ts";
import {
  SCORE_VERSION,
  TrackScore,
  ScoreValidationError,
  scoreFromJSON,
  type Note,
  type Track,
} from "./score.ts";
import type { SongMaster } from "./master.ts";
import type { Tuning } from "./tuning.ts";

export const LOOP_FORMAT = "track.loop/v1" as const;

export type TrackLoopV1 = Readonly<{
  format: typeof LOOP_FORMAT;
  version: typeof SCORE_VERSION;
  tempoBpm: number;
  beatsPerBar: number;
  bars: number;
  ticksPerBeat: number;
  key: string | null;
  /** Tempo map, meter changes and fermatas (0.5); absent: constant time. */
  time?: SongTime;
  /** Song tuning (0.5); absent: 12-TET at A4 = 440 Hz. */
  tuning?: Tuning;
  tracks: readonly Track[];
  notes: readonly Note[];
  /** Song master (dawg 0.5); absent means none. */
  master?: SongMaster;
}>;

/** Return the stable object form used by files and IPC messages. */
export function encodeLoopDocument(score: TrackScore): TrackLoopV1 {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("encodeLoop requires a TrackScore");
  return Object.freeze({
    format: LOOP_FORMAT,
    version: SCORE_VERSION,
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: score.bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    ...(score.time ? { time: score.time } : {}),
    ...(score.tuning ? { tuning: score.tuning } : {}),
    tracks: score.tracks,
    notes: score.notes,
    ...(score.master ? { master: score.master } : {}),
  });
}

/** Encode with deterministic property and note ordering. */
export function encodeLoop(score: TrackScore): string {
  return JSON.stringify(encodeLoopDocument(score));
}

export function decodeLoopDocument(value: unknown): TrackScore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScoreValidationError("track.loop/v1 must be an object");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.format !== LOOP_FORMAT)
    throw new ScoreValidationError(
      `unsupported loop format: ${String(envelope.format)}`,
    );
  if (envelope.version !== SCORE_VERSION)
    throw new ScoreValidationError(
      `unsupported loop version: ${String(envelope.version)}`,
    );
  return scoreFromJSON(envelope);
}

export function decodeLoop(serialized: unknown): TrackScore {
  let value: unknown = serialized;
  if (typeof serialized === "string") {
    try {
      value = JSON.parse(serialized) as unknown;
    } catch (error) {
      throw new ScoreValidationError(
        `invalid track.loop/v1 JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return decodeLoopDocument(value);
}

// Explicit aliases make the format boundary easy to discover from callers.
export const encodeTrackLoop = encodeLoop;
export const decodeTrackLoop = decodeLoop;
