/**
 * Drum-track adapter for the highway: drum hits stream in one lane per voice
 * (kick, snare, clap, rim, tom, hat, open hat) instead of by pitch.
 */
import { DRUM_VOICES, drumLane, isDrumInstrument } from "../core/drums.ts";
import type { NoteSnapshot, TrackScoreSnapshot } from "./render.ts";

export function drumSnapshotFields(
  instrument: string | undefined,
  notes: readonly NoteSnapshot[],
): Partial<TrackScoreSnapshot> {
  if (instrument === undefined || !isDrumInstrument(instrument)) return {};
  return {
    laneCount: DRUM_VOICES.length,
    laneLabels: DRUM_VOICES.map((info) => info.label),
    notes: notes.map((note) => ({
      ...note,
      lane: drumLane(note.pitch ?? 0),
    })),
  };
}
