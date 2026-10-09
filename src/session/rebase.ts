/**
 * Server-side rebase of agent operation intents.
 *
 * An agent validates its operations against the score at `base`. When other
 * windows committed in the meantime, dawgd replays the operations on the
 * current score instead of rejecting, but only when nothing they touch
 * changed since `base`: the notes they update or remove, the tracks whose
 * settings or contents they rewrite, the tracks they add notes to, and the
 * tempo or length they set. Anything else is a conflict and the caller gets
 * the usual `rebase` reply. The reducer still validates every operation.
 */
import {
  applyScoreOperation,
  scoreFromJSON,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { rewindComposition, type Rewind } from "./delta.ts";
import { deepEqual } from "../../core/diff.ts";

/** How far behind a base may be and still be rebased. */
export const MAX_REBASE_DISTANCE = 64;

export type RebaseResult =
  { ok: true; next: TrackScore } | { ok: false; reason: string };

export function rebaseOperations(
  base: TrackScore,
  current: TrackScore,
  operations: readonly ScoreOperation[],
): RebaseResult {
  const baseNotes = new Map(base.notes.map((note) => [note.id, note]));
  const currentNotes = new Map(current.notes.map((note) => [note.id, note]));
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const trackSettings = (score: TrackScore, id: string) =>
    score.tracks.find((track) => track.id === id);
  const trackNotes = (score: TrackScore, id: string) =>
    score.notes.filter((note) => note.trackId === id);
  const settingsUnchanged = (id: string) =>
    same(trackSettings(base, id), trackSettings(current, id));
  const notesUnchanged = (id: string) =>
    same(trackNotes(base, id), trackNotes(current, id));
  // Tracks and notes the intent itself creates are not concurrent edits.
  const added = { tracks: new Set<string>(), notes: new Set<string>() };
  for (const operation of operations) {
    switch (operation.type) {
      case "addTrack": {
        const id = operation.track.id;
        if (typeof id === "string") {
          if (trackSettings(current, id) && !trackSettings(base, id))
            return { ok: false, reason: `track ${id} was added concurrently` };
          added.tracks.add(id);
        }
        break;
      }
      case "addNote": {
        const { id, trackId } = operation.note;
        if (
          typeof id === "string" &&
          currentNotes.has(id) &&
          !baseNotes.has(id)
        )
          return { ok: false, reason: `note ${id} was added concurrently` };
        if (typeof id === "string") added.notes.add(id);
        if (
          typeof trackId === "string" &&
          !added.tracks.has(trackId) &&
          !trackSettings(current, trackId)
        )
          return { ok: false, reason: `track ${trackId} was removed` };
        break;
      }
      case "removeNote":
      case "updateNote": {
        if (added.notes.has(operation.noteId)) break;
        if (
          !same(
            baseNotes.get(operation.noteId),
            currentNotes.get(operation.noteId),
          )
        )
          return { ok: false, reason: `note ${operation.noteId} changed` };
        break;
      }
      case "updateTrack":
      case "setClips":
      case "setAutomation": {
        if (added.tracks.has(operation.trackId)) break;
        if (!settingsUnchanged(operation.trackId))
          return { ok: false, reason: `track ${operation.trackId} changed` };
        break;
      }
      case "clearTrack": {
        if (added.tracks.has(operation.trackId)) break;
        if (
          !settingsUnchanged(operation.trackId) ||
          !notesUnchanged(operation.trackId)
        )
          return { ok: false, reason: `track ${operation.trackId} changed` };
        break;
      }
      case "setTempo":
        if (base.tempoBpm !== current.tempoBpm)
          return { ok: false, reason: "tempo changed" };
        break;
      case "setBars":
        if (base.bars !== current.bars)
          return { ok: false, reason: "loop length changed" };
        break;
      case "setKey":
        if (base.key !== current.key)
          return { ok: false, reason: "key changed" };
        break;
      case "setMeter":
        if (base.beatsPerBar !== current.beatsPerBar)
          return { ok: false, reason: "meter changed" };
        break;
      case "setTime":
        if (!same(base.time, current.time))
          return { ok: false, reason: "tempo map changed" };
        break;
      case "setTuning":
        if (!same(base.tuning ?? null, current.tuning ?? null))
          return { ok: false, reason: "tuning changed" };
        break;
      case "setCalibration":
        if ((base.calibration ?? 0) !== (current.calibration ?? 0))
          return { ok: false, reason: "calibration changed" };
        break;
      case "setMaster":
        if (!deepEqual(base.master, current.master))
          return { ok: false, reason: "master changed" };
        break;
      case "setSections":
        if (
          JSON.stringify(base.sections) !== JSON.stringify(current.sections) ||
          JSON.stringify(base.form) !== JSON.stringify(current.form) ||
          base.loopSection !== current.loopSection
        )
          return { ok: false, reason: "sections changed" };
        break;
      case "removeTrack": {
        if (added.tracks.has(operation.trackId)) break;
        if (
          !settingsUnchanged(operation.trackId) ||
          !notesUnchanged(operation.trackId)
        )
          return { ok: false, reason: `track ${operation.trackId} changed` };
        break;
      }
      case "moveTrack": {
        const order = (score: TrackScore) =>
          score.tracks.map((track) => track.id).join("\u0000");
        if (order(base) !== order(current))
          return { ok: false, reason: "track order changed" };
        break;
      }
      default:
        return { ok: false, reason: "unsupported operation" };
    }
  }
  try {
    let next = current;
    for (const operation of operations)
      next = applyScoreOperation(next, operation);
    return { ok: true, next: scoreFromJSON(next.toJSON()) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The composition at revision `revision`, recovered by rewinding the current
 * composition through every later event's `rewind`. Undefined when the log
 * cannot vouch for it (a gap in revisions, or a rewind compacted away).
 */
export function compositionAt(
  record: {
    composition: unknown;
    events: readonly { revision: number; rewind?: Rewind | undefined }[];
    /** Events folded out of the front of the log (see `SessionRecord`). */
    folded?: number | undefined;
  },
  revision: number,
): unknown {
  const { events } = record;
  const base = record.folded ?? 0;
  if (!Number.isSafeInteger(revision) || revision < base) return undefined;
  const start = revision - base;
  if (start >= events.length) return undefined;
  for (let index = start; index < events.length; index += 1)
    if (events[index]!.revision !== base + index + 1) return undefined;
  return rewindComposition(record.composition, events, start);
}
