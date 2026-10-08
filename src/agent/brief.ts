import { describeMaster } from "../../core/master.ts";
import type { TrackScore } from "../../core/score.ts";
import {
  describeSongTime,
  loopTicksOf,
  meterSegments,
} from "../../core/tempo.ts";
import {
  AVAILABLE_EFFECTS,
  AVAILABLE_FX_PRESETS,
  AVAILABLE_INSTRUMENTS,
} from "../audio/wav.ts";
import type { ProjectOutline } from "./workspace.ts";
import {
  describeTuning,
  resolveTuning,
  type Tuning,
} from "../../core/tuning.ts";

export const MAX_BRIEF_BYTES = 12 * 1024;
const MAX_FOCUSED_NOTES = 96;
const MAX_RECENT = 8;
const MAX_RECENT_CHARS = 120;
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * A compact, deterministic snapshot of the composition for the model. It is
 * derived only from score state and caller-supplied operation summaries, so
 * the same score, revision, and history always yield the same bytes, and no
 * environment value (including credentials) can reach it.
 */
export function compositionBrief(options: {
  score: TrackScore;
  revision: number;
  focusedTrackId: string;
  recentOperations?: readonly string[];
  /** Bounded project tree and notes head from `projectOutline`; dropped first under pressure. */
  project?: ProjectOutline;
  maxBytes?: number;
}): string {
  const { score } = options;
  const maxBytes = options.maxBytes ?? MAX_BRIEF_BYTES;
  const tpb = score.ticksPerBeat;
  const beats = (ticks: number) => Math.round((ticks / tpb) * 1000) / 1000;
  const tracks = score.tracks.map((track) => {
    const notes = score.notes.filter((note) => note.trackId === track.id);
    const pitches = notes.map((note) => note.pitch);
    return {
      id: track.id,
      name: track.name,
      instrument: track.instrument,
      ...(track.muted ? { muted: true } : {}),
      volume: track.volume,
      pan: track.pan,
      notes: notes.length,
      ...(notes.length > 0
        ? {
            range: `${noteName(Math.min(...pitches))}..${noteName(Math.max(...pitches))}`,
          }
        : {}),
      ...(track.volumeAutomation.length > 0
        ? { volumeAutomation: track.volumeAutomation.length }
        : {}),
      ...(track.panAutomation.length > 0
        ? { panAutomation: track.panAutomation.length }
        : {}),
      ...(track.solo ? { solo: true } : {}),
      ...(track.filter ? { filter: track.filter } : {}),
      ...(track.delay ? { delay: track.delay } : {}),
      ...((track.filterAutomation?.length ?? 0) > 0
        ? { filterAutomation: track.filterAutomation!.length }
        : {}),
      ...(track.reverb ? { reverb: track.reverb } : {}),
      ...(track.fx ? { fx: track.fx } : {}),
      ...(track.fxAutomation
        ? {
            fxAutomation: Object.fromEntries(
              Object.entries(track.fxAutomation).map(([lane, points]) => [
                lane,
                points?.length ?? 0,
              ]),
            ),
          }
        : {}),
      ...((track.resonanceAutomation?.length ?? 0) > 0
        ? { resonanceAutomation: track.resonanceAutomation!.length }
        : {}),
      ...((track.delayFeedbackAutomation?.length ?? 0) > 0
        ? { delayFeedbackAutomation: track.delayFeedbackAutomation!.length }
        : {}),
      ...((track.delayMixAutomation?.length ?? 0) > 0
        ? { delayMixAutomation: track.delayMixAutomation!.length }
        : {}),
      ...(track.time
        ? {
            // Per-track time in beats: rate, phase offset and loop cycle.
            time: {
              ...(track.time.rate !== undefined
                ? { rate: track.time.rate }
                : {}),
              ...(track.time.phase !== undefined
                ? { phaseBeats: beats(track.time.phase) }
                : {}),
              ...(track.time.cycle !== undefined
                ? { cycleBeats: beats(track.time.cycle) }
                : {}),
            },
          }
        : {}),
      ...(track.tuning
        ? { tuning: tuningBrief(score.tuning, track.tuning, score.key) }
        : {}),
      ...(track.wavetable ? { wavetable: track.wavetable } : {}),
      ...((track.wtAutomation?.length ?? 0) > 0
        ? { wtAutomation: track.wtAutomation!.length }
        : {}),
    };
  });
  const tunedNotes = score.notes.some(
    (note) =>
      note.trackId === options.focusedTrackId && note.cents !== undefined,
  );
  const focusedNotes = score.notes
    .filter((note) => note.trackId === options.focusedTrackId)
    .slice()
    .sort(
      (left, right) =>
        left.startTick - right.startTick ||
        left.pitch - right.pitch ||
        left.id.localeCompare(right.id),
    )
    .map((note) => [
      note.id,
      noteName(note.pitch),
      beats(note.startTick),
      beats(note.durationTicks),
      Math.round(note.velocity * 100) / 100,
      ...(tunedNotes ? [note.cents ?? 0] : []),
    ]);
  const recent = (options.recentOperations ?? [])
    .slice(-MAX_RECENT)
    .map((line) => line.replace(/\s+/g, " ").slice(0, MAX_RECENT_CHARS));
  const project = options.project;
  const opening = meterSegments(score)[0]!;
  const openingMeter = `${opening.beatsPerBar}/${opening.beatUnit}`;
  const build = (
    noteLimit: number,
    trackLimit: number,
    projectLevel: number,
    presets: boolean,
  ) => {
    const visible = focusedNotes.slice(0, noteLimit);
    return JSON.stringify({
      revision: options.revision,
      tempoBpm: score.tempoBpm,
      meter: openingMeter,
      bars: score.bars,
      loopBeats: beats(loopTicksOf(score)),
      // Tempo events (=step, →ramp; bpm@beat), meter changes and fermatas.
      ...(score.time ? { time: describeSongTime(score) } : {}),
      ...(score.key ? { key: score.key } : {}),
      ...(score.tuning
        ? { tuning: tuningBrief(score.tuning, undefined, score.key) }
        : {}),
      ...(score.master ? { master: describeMaster(score.master) } : {}),
      focusedTrack: options.focusedTrackId,
      tracks: tracks.slice(0, trackLimit),
      ...(tracks.length > trackLimit
        ? { omittedTracks: tracks.length - trackLimit }
        : {}),
      focusedNotes: {
        columns: [
          "id",
          "pitch",
          "startBeat",
          "durationBeats",
          "velocity",
          ...(tunedNotes ? ["cents"] : []),
        ],
        rows: visible,
        ...(focusedNotes.length > visible.length
          ? { omitted: focusedNotes.length - visible.length }
          : {}),
      },
      recentOperations: recent,
      instruments: AVAILABLE_INSTRUMENTS,
      effects: AVAILABLE_EFFECTS,
      ...(presets ? { fxPresets: AVAILABLE_FX_PRESETS } : {}),
      ...(project && projectLevel > 0 && project.tree.length > 0
        ? {
            project: {
              tree: project.tree,
              ...(project.notes !== undefined && projectLevel > 1
                ? { notes: project.notes }
                : {}),
            },
          }
        : {}),
    });
  };
  const encoder = new TextEncoder();
  let noteLimit = Math.min(MAX_FOCUSED_NOTES, focusedNotes.length);
  let trackLimit = tracks.length;
  let projectLevel = 2;
  // Preset names are a convenience (`set_fx` lists them on a miss), so
  // the brief carries them only when the score already uses effects.
  let presets = score.tracks.some((track) => track.fx !== undefined);
  let brief = build(noteLimit, trackLimit, projectLevel, presets);
  while (encoder.encode(brief).byteLength > maxBytes) {
    if (presets) presets = false;
    else if (noteLimit > 0) noteLimit = Math.floor(noteLimit / 2);
    else if (projectLevel > 0) projectLevel -= 1;
    else if (trackLimit > 1) trackLimit = Math.floor(trackLimit / 2);
    else break;
    brief = build(noteLimit, trackLimit, projectLevel, presets);
  }
  return brief;
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * A tuning as the agent reads it: the summary, plus the steps per period and
 * whether keys map one per step (`linear`), in which case a key name such as
 * C5 no longer sounds as its 12-TET pitch.
 */
function tuningBrief(
  song: Tuning | undefined,
  track: Tuning | undefined,
  key: string | null | undefined,
): { summary: string; steps?: number; linear?: boolean } {
  const summary = describeTuning(track ?? song);
  try {
    const table = resolveTuning(song, track, key);
    if (!table) return { summary };
    return {
      summary,
      steps: table.size,
      ...(table.linear && table.size !== 12 ? { linear: true } : {}),
    };
  } catch {
    return { summary };
  }
}
