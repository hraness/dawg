/**
 * Audition: a short phrase of one track (or some of its pitches) rendered
 * through the offline renderer, as a live voice the engine can mix over
 * silence. The Euclidean editor plays the edited voice's lane once after
 * every change, and the pattern picker previews a pattern before it lands.
 *
 * Like `live.ts` this only builds a smaller score; the renderer is shared,
 * so an audition sounds exactly like the track does in the loop before the
 * song master. Auditions and live notes are pre-master on purpose: the
 * master's glue, limiter and loudness target act on the whole mix, and
 * running them over one voice would pump and boost it by a different amount
 * than the loop. The staged A/B loop (`src/tui/audition.ts`) is the place to
 * hear master changes; it plays the full mix while one is staged.
 */
import {
  SCORE_LIMITS,
  TrackScore,
  type Note,
  type Track,
} from "../../core/score.ts";
import {
  barStartTick,
  meterSegments,
  secondsAtTick,
} from "../../core/tempo.ts";
import type { LiveNotePcm } from "./live.ts";
import type { SampleBank } from "./samples.ts";
import { RENDER_CHANNELS, renderScorePcm } from "./wav.ts";

export type AuditionRequest = Readonly<{
  score: TrackScore;
  trackId: string;
  /** Only these pitches (one drum voice); all of the track's notes when absent. */
  pitches?: ReadonlySet<number>;
  /** Bars rendered from the loop start (default 1, at most the loop). */
  bars?: number;
  sampleRate: number;
  samples?: SampleBank;
}>;

/** Longest audition, so a slow tempo cannot hold a voice for long. */
export const MAX_AUDITION_SECONDS = 6;

export function renderAudition(
  request: AuditionRequest,
): LiveNotePcm | undefined {
  const { score } = request;
  const track = score.tracks.find(
    (candidate) => candidate.id === request.trackId,
  );
  if (!track) return undefined;
  const opening = meterSegments(score)[0]!;
  const secondsPerBar = secondsAtTick(score, opening.barTicks);
  const bars = Math.max(
    1,
    Math.min(
      score.bars,
      request.bars ?? 1,
      Math.floor(MAX_AUDITION_SECONDS / secondsPerBar) || 1,
    ),
  );
  const endTick = barStartTick(score, bars);
  const notes: Note[] = score.notes.filter(
    (note) =>
      note.trackId === track.id &&
      note.startTick < endTick &&
      (!request.pitches || request.pitches.has(note.pitch)),
  );
  if (notes.length === 0) return undefined;
  const single = new TrackScore({
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars,
    ticksPerBeat: score.ticksPerBeat,
    // The song's meter and tempo map, so bar spans match `endTick`.
    ...(score.time ? { time: score.time } : {}),
    tracks: [auditionTrack(track)],
    notes: notes.map((note) => ({
      ...note,
      durationTicks: Math.max(
        1,
        Math.min(
          note.durationTicks,
          endTick - note.startTick,
          SCORE_LIMITS.maxTick,
        ),
      ),
    })),
  });
  const audio = renderScorePcm(single, {
    sampleRate: request.sampleRate,
    maxSeconds: MAX_AUDITION_SECONDS + 4,
    ...(request.samples ? { samples: request.samples } : {}),
  });
  let last = audio.pcm.length - 1;
  while (last >= 0 && audio.pcm[last] === 0) last -= 1;
  const frames = Math.ceil((last + 1) / RENDER_CHANNELS);
  if (frames === 0) return undefined;
  return { pcm: audio.pcm.subarray(0, frames * RENDER_CHANNELS), frames };
}

/** Audible regardless of mute and solo; the generator rows are not needed. */
function auditionTrack(track: Track): Track {
  const { solo: _solo, rhythm: _rhythm, ...rest } = track;
  return { ...rest, muted: false };
}
