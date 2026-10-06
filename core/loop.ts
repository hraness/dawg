import {
  SCORE_VERSION,
  TrackScore,
  ScoreValidationError,
  scoreFromJSON,
  type Note,
  type Track,
} from "./score.ts";

export const LOOP_FORMAT = "track.loop/v1" as const;

export type TrackLoopV1 = Readonly<{
  format: typeof LOOP_FORMAT;
  version: typeof SCORE_VERSION;
  tempoBpm: number;
  beatsPerBar: number;
  bars: number;
  ticksPerBeat: number;
  key: string | null;
  tracks: readonly Track[];
  notes: readonly Note[];
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
    tracks: score.tracks,
    notes: score.notes,
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
