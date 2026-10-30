import type { TrackScore } from "../../core/score.ts";
import { clipSpan } from "../../core/clips.ts";
import { secondsAtTick } from "../../core/tempo.ts";
import { clipAudio } from "../audio/clips.ts";
import type { SampleBank } from "../audio/samples.ts";

/** The durable receipt's legacy renderedNotes count includes loaded audio-clip events. */
export function audibleEventCount(
  score: TrackScore,
  bank: SampleBank | undefined,
  range: Readonly<{ from: number; to: number }>,
  trackIds: readonly string[],
): number {
  const solo = score.tracks.some((track) => track.solo && !track.muted);
  const active = score.tracks.filter(
    (track) =>
      trackIds.includes(track.id) &&
      !track.muted &&
      track.volume > 0 &&
      (!solo || track.solo),
  );
  const ids = new Set(active.map((track) => track.id));
  const from = secondsAtTick(score, range.from * score.ticksPerBeat),
    to = secondsAtTick(score, range.to * score.ticksPerBeat);
  const notes = score.notes.filter(
    (note) =>
      ids.has(note.trackId) &&
      note.velocity > 0 &&
      note.startTick / score.ticksPerBeat < range.to &&
      (note.startTick + note.durationTicks) / score.ticksPerBeat > range.from,
  ).length;
  return (
    notes +
    active.flatMap((track) =>
      (track.clips ?? []).filter((clip) => {
        const audio = clipAudio(bank, track.id, clip);
        if (clip.mute || !audio || (clip.gain ?? 1) <= 0) return false;
        const span = clipSpan(
          score,
          clip,
          audio.frames / audio.sampleRate,
          track.time,
        );
        return span.start < to && span.end > from;
      }),
    ).length
  );
}

/** Missing clips are renderer warnings, but cannot count as a ready musical draft. */
export function missingPlaybackAssets(
  score: TrackScore,
  bank: SampleBank | undefined,
): readonly string[] {
  const solo = score.tracks.some((track) => track.solo && !track.muted);
  const active = score.tracks.filter(
    (track) => !track.muted && track.volume > 0 && (!solo || track.solo),
  );
  const ids = new Set(active.map((track) => track.id));
  return [
    ...new Set([
      ...(bank?.problems ?? [])
        .filter(
          (problem) => ids.has(problem.trackId) && problem.level === "error",
        )
        .map((problem) => problem.src),
      ...active.flatMap((track) =>
        (track.clips ?? [])
          .filter((clip) => !clip.mute && !clipAudio(bank, track.id, clip))
          .map((clip) => clip.src),
      ),
    ]),
  ];
}
