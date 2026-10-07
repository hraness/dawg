/**
 * Multi-track highway: every other audible track as a dimmed overlay layer.
 * Solo rules match the mixer: when any track is soloed, only soloed unmuted
 * tracks are drawn.
 */
import { DRUM_VOICES, drumLane, isDrumInstrument } from "../core/drums.ts";
import {
  drumLaneProjection,
  MAX_LAYER_NOTES,
  type HighwayLayer,
} from "./highway.ts";
import { samplerLanes } from "./drums.ts";
import type { Sampler } from "../core/score.ts";

export interface LayerTrack {
  id: string;
  name: string;
  instrument: string;
  muted: boolean;
  solo?: boolean | undefined;
  sampler?: Sampler | undefined;
}

export interface LayerNote {
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}

export function highwayLayers(
  tracks: readonly LayerTrack[],
  notes: readonly LayerNote[],
  ticksPerBeat: number,
  focusedTrackId: string,
): HighwayLayer[] {
  const soloing = tracks.some((track) => track.solo && !track.muted);
  const audible = tracks.filter(
    (track) =>
      track.id !== focusedTrackId &&
      !track.muted &&
      (!soloing || track.solo === true),
  );
  const tpb = Math.max(1, ticksPerBeat);
  let budget = MAX_LAYER_NOTES;
  return audible.map((track) => {
    const drum = isDrumInstrument(track.instrument);
    const sampled = drum ? undefined : samplerLanes(track);
    const own = [];
    for (const note of notes) {
      if (note.trackId !== track.id) continue;
      if (budget <= 0) break;
      const lane = drum
        ? drumLane(note.pitch)
        : sampled
          ? sampled.laneOf(note.pitch)
          : undefined;
      if (sampled && lane === undefined) continue;
      budget -= 1;
      own.push({
        startBeat: note.startTick / tpb,
        durationBeats: note.durationTicks / tpb,
        pitch: note.pitch,
        velocity: note.velocity,
        ...(lane !== undefined ? { lane } : {}),
      });
    }
    return {
      trackId: track.id,
      trackName: track.name,
      notes: own,
      projection: drum
        ? drumLaneProjection(DRUM_VOICES.map((info) => info.label))
        : sampled
          ? drumLaneProjection(sampled.labels)
          : undefined,
    };
  });
}
