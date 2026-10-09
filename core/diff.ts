/**
 * Score diff: the shortest list of `ScoreOperation`s that turns score A into
 * score B, so a project edit commits as ordinary session operations that
 * rebase, undo and broadcast like everything else.
 *
 * Order: song settings, note removals, track removals, track additions,
 * track moves, track patches, note updates, note additions. Each track and
 * each note appears at most once per kind. `applyScoreOperations(a,
 * diffScores(a, b))` deep-equals `b` (notes and tracks are stored in
 * canonical order, so insertion order never matters).
 */

import {
  NOTE_EXPRESSION_FIELDS,
  TRACK_PERFORMANCE_FIELDS,
} from "./expression.ts";
import {
  applyScoreOperation,
  TrackScore,
  type Note,
  type NotePatch,
  type ScoreOperation,
  type Track,
  type TrackPatch,
} from "./score.ts";

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffError";
  }
}

const EFFECTS = [
  "filter",
  "delay",
  "reverb",
  "sampler",
  "fx",
  "fxAutomation",
  "synth",
  "wavetable",
  "string",
  "granular",
  "keys",
  "modal",
  "softPedal",
  "sostenuto",
  // f061-guitar: fretting setup.
  "guitar",
  "wind",
] as const;
const LANES = [
  "volumeAutomation",
  "panAutomation",
  "filterAutomation",
  "resonanceAutomation",
  "delayFeedbackAutomation",
  "delayMixAutomation",
  "wtAutomation",
] as const;

/** Operations turning `a` into `b`; empty when they are equal. */
export function diffScores(
  a: TrackScore,
  b: TrackScore,
): readonly ScoreOperation[] {
  if (a.ticksPerBeat !== b.ticksPerBeat)
    throw new DiffError(
      `ticksPerBeat differs (${a.ticksPerBeat} → ${b.ticksPerBeat}); the session resolution is fixed`,
    );
  const ops: ScoreOperation[] = [];
  if (a.beatsPerBar !== b.beatsPerBar)
    ops.push({ type: "setMeter", beatsPerBar: b.beatsPerBar });
  if (a.bars !== b.bars) ops.push({ type: "setBars", bars: b.bars });
  if (a.tempoBpm !== b.tempoBpm)
    ops.push({ type: "setTempo", tempoBpm: b.tempoBpm });
  if (a.key !== b.key) ops.push({ type: "setKey", key: b.key });
  if (!deepEqual(a.time, b.time))
    ops.push({ type: "setTime", time: b.time ?? null });
  if (!deepEqual(a.tuning, b.tuning))
    ops.push({ type: "setTuning", tuning: b.tuning ?? null });
  if (!deepEqual(a.master, b.master))
    ops.push({ type: "setMaster", master: b.master ?? null });
  if (
    !deepEqual(a.sections, b.sections) ||
    !deepEqual(a.form, b.form) ||
    a.loopSection !== b.loopSection
  )
    ops.push({
      type: "setSections",
      sections: b.sections,
      form: b.form,
      ...(b.loopSection === undefined ? {} : { loopSection: b.loopSection }),
    });

  const aTracks = new Map(a.tracks.map((track) => [track.id, track]));
  const bTracks = new Map(b.tracks.map((track) => [track.id, track]));
  const aNotes = new Map(a.notes.map((note) => [note.id, note]));
  const bNotes = new Map(b.notes.map((note) => [note.id, note]));

  const updates: ScoreOperation[] = [];
  const additions: ScoreOperation[] = [];
  for (const note of a.notes) {
    if (!bTracks.has(note.trackId)) continue; // removed with its track
    const next = bNotes.get(note.id);
    if (!next || next.trackId !== note.trackId) {
      ops.push({ type: "removeNote", noteId: note.id });
      continue;
    }
    const patch = notePatch(note, next);
    if (patch) updates.push({ type: "updateNote", noteId: note.id, patch });
  }
  for (const note of b.notes) {
    const previous = aNotes.get(note.id);
    if (
      previous &&
      previous.trackId === note.trackId &&
      bTracks.has(note.trackId)
    )
      continue;
    if (
      previous &&
      previous.trackId === note.trackId &&
      !aTracks.has(note.trackId)
    )
      continue;
    additions.push({ type: "addNote", note });
  }

  for (const track of a.tracks)
    if (!bTracks.has(track.id))
      ops.push({ type: "removeTrack", trackId: track.id });
  const order = a.tracks
    .filter((track) => bTracks.has(track.id))
    .map((t) => t.id);
  for (const track of b.tracks)
    if (!aTracks.has(track.id)) {
      ops.push({ type: "addTrack", track });
      order.push(track.id);
    }
  b.tracks.forEach((track, index) => {
    if (order[index] === track.id) return;
    const from = order.indexOf(track.id);
    order.splice(from, 1);
    order.splice(index, 0, track.id);
    ops.push({ type: "moveTrack", trackId: track.id, index });
  });
  for (const track of b.tracks) {
    const previous = aTracks.get(track.id);
    if (!previous) continue;
    const patch = trackPatch(previous, track);
    if (patch) ops.push({ type: "updateTrack", trackId: track.id, patch });
  }
  ops.push(...updates, ...additions);
  return Object.freeze(ops);
}

/** Applies operations in order; the inverse of `diffScores`. */
export function applyScoreOperations(
  score: TrackScore,
  operations: readonly ScoreOperation[],
): TrackScore {
  return operations.reduce(applyScoreOperation, score);
}

function notePatch(a: Note, b: Note): NotePatch | undefined {
  const patch: Record<string, unknown> = {};
  for (const key of [
    "startTick",
    "durationTicks",
    "pitch",
    "velocity",
  ] as const)
    if (a[key] !== b[key]) patch[key] = b[key];
  for (const key of NOTE_EXPRESSION_FIELDS)
    if (!deepEqual(a[key], b[key])) patch[key] = b[key] ?? null;
  if ((a.cents ?? 0) !== (b.cents ?? 0)) patch.cents = b.cents ?? 0;
  return Object.keys(patch).length > 0 ? (patch as NotePatch) : undefined;
}

function trackPatch(a: Track, b: Track): TrackPatch | undefined {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "instrument", "muted", "volume", "pan"] as const)
    if (a[key] !== b[key]) patch[key] = b[key];
  if ((a.solo ?? false) !== (b.solo ?? false)) patch.solo = b.solo ?? false;
  for (const key of EFFECTS)
    if (!deepEqual(a[key], b[key])) patch[key] = b[key] ?? null;
  for (const key of [
    "rhythm",
    "kit",
    "time",
    "tuning",
    ...TRACK_PERFORMANCE_FIELDS,
  ] as const)
    if (!deepEqual(a[key], b[key])) patch[key] = b[key] ?? null;
  for (const key of LANES)
    if (!deepEqual(a[key] ?? [], b[key] ?? [])) patch[key] = b[key] ?? [];
  return Object.keys(patch).length > 0 ? (patch as TrackPatch) : undefined;
}

/** Structural equality for plain JSON-like data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const other = Object.keys(right).filter((key) => right[key] !== undefined);
  if (keys.length !== other.length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}

/**
 * Gives the notes of `evaluated` (fresh from `song.ts`, content-hash ids)
 * the ids of matching notes in `current` (the session, whose ids the TUI
 * and agent may have chosen) so `diffScores(current, result)` updates
 * notes in place instead of replacing them. A note matches by exact
 * content first, then by track, pitch and start.
 */
export function adoptNoteIds(
  current: TrackScore,
  evaluated: TrackScore,
): TrackScore {
  const exact = new Map<string, Note[]>();
  const loose = new Map<string, Note[]>();
  for (const note of current.notes) {
    push(exact, exactKey(note), note);
    push(loose, looseKey(note), note);
  }
  const taken = new Set<string>();
  const adopted: Note[] = [];
  const pending: Note[] = [];
  for (const note of evaluated.notes) {
    const match = take(exact, exactKey(note), taken);
    if (match) {
      taken.add(match.id);
      adopted.push(match.id === note.id ? note : { ...note, id: match.id });
    } else pending.push(note);
  }
  for (const note of pending) {
    const match = take(loose, looseKey(note), taken);
    if (match) {
      taken.add(match.id);
      adopted.push({ ...note, id: match.id });
    } else adopted.push(note);
  }
  // A fresh content id can collide with an adopted one; keep ids unique.
  const used = new Set<string>();
  const unique = adopted.map((note) => {
    let id = note.id;
    for (let n = 2; used.has(id); n += 1) id = `${note.id.slice(0, 60)}-${n}`;
    used.add(id);
    return id === note.id ? note : { ...note, id };
  });
  return new TrackScore({ ...evaluated.toJSON(), notes: unique });
}

function exactKey(note: Note): string {
  const cents = note.cents ? `|${note.cents}` : "";
  return `${note.trackId}|${note.pitch}|${note.startTick}|${note.durationTicks}|${note.velocity}${cents}`;
}

function looseKey(note: Note): string {
  return `${note.trackId}|${note.pitch}|${note.startTick}`;
}

function push(map: Map<string, Note[]>, key: string, note: Note): void {
  const list = map.get(key);
  if (list) list.push(note);
  else map.set(key, [note]);
}

function take(
  map: Map<string, Note[]>,
  key: string,
  taken: Set<string>,
): Note | undefined {
  const list = map.get(key);
  if (!list) return undefined;
  const index = list.findIndex((note) => !taken.has(note.id));
  if (index < 0) return undefined;
  return list.splice(index, 1)[0];
}
