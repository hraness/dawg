/**
 * Drum-track adapter for the highway: drum hits stream in one lane per voice
 * (kick, snare, clap, rim, tom, hat, open hat) instead of by pitch.
 */
import { DRUM_VOICES, drumLane, isDrumInstrument } from "../core/drums.ts";
import {
  isSamplerInstrument,
  samplerVoiceSlots,
  type Track,
} from "../core/score.ts";
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

/**
 * Sampler adapter: oneshot samplers stream one lane per voice (named, in
 * pitch-slot order from 36); keyed samplers keep the pitch axis, labelled by
 * note name like any melodic track.
 */
export function samplerSnapshotFields(
  track: Pick<Track, "instrument" | "sampler"> | undefined,
  notes: readonly NoteSnapshot[],
): Partial<TrackScoreSnapshot> {
  const lanes = samplerLanes(track);
  if (!lanes) return {};
  return {
    laneCount: lanes.labels.length,
    laneLabels: lanes.labels,
    notes: notes.flatMap((note) => {
      const lane = lanes.laneOf(note.pitch ?? -1);
      return lane === undefined ? [] : [{ ...note, lane }];
    }),
  };
}

/** Oneshot sampler lanes, or undefined for keyed/non-sampler tracks. */
export function samplerLanes(
  track: Pick<Track, "instrument" | "sampler"> | undefined,
):
  | { labels: string[]; laneOf: (pitch: number) => number | undefined }
  | undefined {
  if (!track || !isSamplerInstrument(track.instrument) || !track.sampler)
    return undefined;
  if (track.sampler.mode !== "oneshot") return undefined;
  const slots = [...samplerVoiceSlots(track.sampler)];
  if (slots.length === 0) return undefined;
  const byPitch = new Map(slots.map(([, slot], index) => [slot, index]));
  return {
    labels: slots.map(([voice]) => voice),
    laneOf: (pitch) => byPitch.get(pitch),
  };
}
