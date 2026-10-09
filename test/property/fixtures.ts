/**
 * Field-value pools for property tests: for every field of `Track`, `Note`
 * and the song, up to three real values (each with the track or note that
 * carried it, since some fields only validate alongside their instrument),
 * harvested from the repo's own fixtures into `fields.json`.
 */

import { readFileSync } from "node:fs";
import type { Note, Track, TrackScoreData } from "../../core/score.ts";

const fields = JSON.parse(
  readFileSync(new URL("./fields.json", import.meta.url), "utf8"),
) as Record<"tracks" | "notes" | "song", unknown>;

type Pool<T> = Readonly<Record<string, readonly T[]>>;

export const TRACK_SAMPLES = fields.tracks as unknown as Pool<Track>;
export const NOTE_SAMPLES = fields.notes as unknown as Pool<Note>;
export const SONG_VALUES = fields.song as unknown as Pool<
  TrackScoreData[keyof TrackScoreData]
>;

/** Lanes no fixture happens to use: plain automation points. */
export const EXTRA_LANES = [
  "resonanceAutomation",
  "delayFeedbackAutomation",
  "delayMixAutomation",
] as const;

export const ALL_TRACKS: readonly Track[] = Object.values(TRACK_SAMPLES).flat();
export const ALL_NOTES: readonly Note[] = Object.values(NOTE_SAMPLES).flat();
