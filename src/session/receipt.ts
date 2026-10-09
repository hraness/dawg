/**
 * Musical receipts: one line that says what changed in the song, built from
 * the score operations a change applied (`diffScores(before, after)`).
 *
 *   ◆ 96 BPM · +2 notes on bass (C4 E4) · reverb 0.4
 *
 * Receipts name tempo in BPM, notes by pitch, and track settings by their
 * musical value; revision numbers and validator counts stay in the ctrl-o
 * log. The builder is pure, so the agent turn, undo and redo share it.
 */
import { diffScores } from "../../core/diff.ts";
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";
import { midiToPitch } from "../../core/pitch.ts";
import type { ScoreOperation, TrackScore } from "../../core/score.ts";

/** Parts kept before the rest collapse to `+N more`. */
const MAX_PARTS = 5;
/** Pitch names listed after a note count. */
const MAX_PITCHES = 4;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function round(value: number, places = 2): string {
  const scale = 10 ** places;
  return String(Math.round(value * scale) / scale);
}

function noteName(pitch: number, drum: boolean): string {
  return drum ? drumVoiceForPitch(pitch) : midiToPitch(pitch);
}

type NoteTally = { added: number[]; removed: number; changed: number };

/** One field of a track patch as a musical phrase, or undefined to skip. */
function trackField(field: string, value: unknown): string | undefined {
  if (value === null || value === undefined) {
    if (field === "volumeAutomation" || field.endsWith("Automation"))
      return `${field.replace(/Automation$/, "")} automation off`;
    return `${field} off`;
  }
  switch (field) {
    case "volume":
      return typeof value === "number" ? `volume ${round(value)}` : undefined;
    case "pan":
      return typeof value === "number" ? `pan ${round(value)}` : undefined;
    case "muted":
      return value === true ? "muted" : "unmuted";
    case "solo":
      return value === true ? "solo" : "solo off";
    case "instrument":
      return typeof value === "string" ? `→ ${value}` : undefined;
    case "name":
      return typeof value === "string" ? `renamed ${value}` : undefined;
    case "reverb":
    case "delay": {
      const mix = (value as { mix?: unknown }).mix;
      return typeof mix === "number" ? `${field} ${round(mix)}` : field;
    }
    case "filter": {
      const cutoff = (value as { cutoff?: unknown }).cutoff;
      return typeof cutoff === "number"
        ? `filter ${Math.round(cutoff)} Hz`
        : "filter";
    }
    case "fx": {
      const names = Object.keys(value as Record<string, unknown>);
      return names.length ? `fx ${names.join(" ")}` : "fx off";
    }
    default:
      if (Array.isArray(value) && field.endsWith("Automation"))
        return value.length === 0
          ? `${field.replace(/Automation$/, "")} automation off`
          : `${field.replace(/Automation$/, "")} automation`;
      return field;
  }
}

/**
 * The receipt parts for `operations` applied to `before`. Tracks are named
 * only when the song has more than one, so a single-track edit reads
 * `reverb 0.4` and a band edit `bass reverb 0.4`.
 */
export function receiptParts(
  before: TrackScore,
  operations: readonly ScoreOperation[],
): string[] {
  const parts: string[] = [];
  // Track settings follow the notes: what you hear first reads first.
  const settings: string[] = [];
  const instruments = new Map(
    before.tracks.map((track) => [track.id, track.instrument]),
  );
  const noteTrack = new Map(
    before.notes.map((note) => [note.id, note.trackId]),
  );
  const tallies = new Map<string, NoteTally>();
  const tally = (trackId: string): NoteTally => {
    let found = tallies.get(trackId);
    if (!found) {
      found = { added: [], removed: 0, changed: 0 };
      tallies.set(trackId, found);
    }
    return found;
  };
  const added = new Set<string>();
  const removed = new Set<string>();
  const trackCount = new Set([
    ...before.tracks.map((track) => track.id),
    ...operations.flatMap((op) =>
      op.type === "addTrack" ? [op.track.id ?? "track"] : [],
    ),
  ]).size;
  const prefix = (trackId: string) => (trackCount > 1 ? `${trackId} ` : "");
  // Notes are summarised per track after the song-level parts.
  for (const op of operations) {
    switch (op.type) {
      case "setTempo":
        parts.push(`${round(op.tempoBpm, 1)} BPM`);
        break;
      case "setKey":
        parts.push(op.key ? `key ${op.key}` : "no key");
        break;
      case "setBars":
        parts.push(plural(op.bars, "bar"));
        break;
      case "setMeter":
        parts.push(`${op.beatsPerBar} beats a bar`);
        break;
      case "setTime":
        parts.push(op.time ? "tempo map" : "steady tempo");
        break;
      case "setTuning":
        parts.push(
          op.tuning ? `tuning ${op.tuning.name ?? ""}`.trim() : "12-TET",
        );
        break;
      case "setMaster":
        parts.push(op.master ? "master" : "master off");
        break;
      case "setStyle":
        if (op.style) parts.push(op.style.id);
        break;
      case "setSections":
        parts.push(plural(op.sections.length, "section"));
        break;
      case "setCalibration":
        break;
      case "addTrack": {
        const id = op.track.id ?? "track";
        const instrument = op.track.instrument;
        added.add(id);
        instruments.set(id, instrument ?? "");
        parts.push(
          `+${id}${instrument && instrument !== id ? ` (${instrument})` : ""}`,
        );
        break;
      }
      case "removeTrack":
        removed.add(op.trackId);
        parts.push(`−${op.trackId}`);
        break;
      case "moveTrack":
        parts.push(`moved ${op.trackId}`);
        break;
      case "clearTrack":
        parts.push(`cleared ${op.trackId}`);
        break;
      case "setClips":
        settings.push(
          `${prefix(op.trackId)}${op.clips && op.clips.length ? plural(op.clips.length, "clip") : "no clips"}`,
        );
        break;
      case "setAutomation":
        settings.push(`${prefix(op.trackId)}${op.parameter} automation`);
        break;
      case "updateTrack": {
        if (added.has(op.trackId)) break;
        const fields = Object.entries(op.patch)
          .map(([field, value]) => trackField(field, value))
          .filter((text): text is string => text !== undefined);
        if (fields.length === 0) break;
        const name = op.patch.name;
        const label =
          typeof name === "string" ? op.trackId : prefix(op.trackId).trim();
        const text = fields.slice(0, 2).join(" ");
        settings.push(label ? `${label} ${text}` : text);
        break;
      }
      case "addNote": {
        const entry = tally(op.note.trackId);
        entry.added.push(
          typeof op.note.pitch === "number" ? op.note.pitch : Number.NaN,
        );
        break;
      }
      case "removeNote": {
        const trackId = noteTrack.get(op.noteId);
        if (trackId && !removed.has(trackId)) tally(trackId).removed += 1;
        break;
      }
      case "updateNote": {
        const trackId = noteTrack.get(op.noteId);
        if (trackId) tally(trackId).changed += 1;
        break;
      }
    }
  }
  for (const [trackId, entry] of tallies) {
    const drum = isDrumInstrument(instruments.get(trackId));
    if (entry.added.length > 0) {
      const names = entry.added
        .filter((pitch) => Number.isFinite(pitch))
        .slice(0, MAX_PITCHES)
        .map((pitch) => noteName(pitch, drum));
      const more = entry.added.length > MAX_PITCHES ? " …" : "";
      parts.push(
        `+${plural(entry.added.length, "note")} on ${trackId}${names.length ? ` (${names.join(" ")}${more})` : ""}`,
      );
    }
    if (entry.removed > 0)
      parts.push(`−${plural(entry.removed, "note")} on ${trackId}`);
    if (entry.changed > 0)
      parts.push(`${plural(entry.changed, "note")} edited on ${trackId}`);
  }
  parts.push(...settings);
  if (parts.length > MAX_PARTS)
    return [
      ...parts.slice(0, MAX_PARTS - 1),
      `+${parts.length - (MAX_PARTS - 1)} more`,
    ];
  return parts;
}

/** `96 BPM · +2 notes on bass (C4 E4) · reverb 0.4`, or "" for no change. */
export function musicalReceipt(before: TrackScore, after: TrackScore): string {
  if (before === after) return "";
  let operations: readonly ScoreOperation[];
  try {
    operations = diffScores(before, after);
  } catch {
    // A resolution change cannot diff: say the song changed.
    return "song changed";
  }
  return receiptParts(before, operations).join(" · ");
}
