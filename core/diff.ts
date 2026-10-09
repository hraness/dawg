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

/**
 * How each field diffs: `same` is identity (never patched), `set` patches
 * the new value, `clear` patches the new value or null, `zero` treats
 * absent as 0, `flag` treats absent as false and `lane` treats absent as
 * []. The records are keyed by every field of `Note` and `Track`, so a new
 * field fails typechecking until it is classified here.
 */
type FieldRule = "same" | "set" | "clear" | "zero" | "flag" | "lane";

const NOTE_FIELDS: { readonly [K in keyof Note]-?: FieldRule } = {
  id: "same",
  trackId: "same",
  startTick: "set",
  durationTicks: "set",
  pitch: "set",
  velocity: "set",
  cents: "zero",
  lyric: "clear",
  vowel: "clear",
  articulation: "clear",
  glide: "clear",
  bend: "clear",
  vibrato: "clear",
  humanize: "clear",
};

const TRACK_FIELDS: { readonly [K in keyof Track]-?: FieldRule } = {
  id: "same",
  name: "set",
  instrument: "set",
  muted: "set",
  volume: "set",
  pan: "set",
  solo: "flag",
  volumeAutomation: "lane",
  panAutomation: "lane",
  filterAutomation: "lane",
  resonanceAutomation: "lane",
  delayFeedbackAutomation: "lane",
  delayMixAutomation: "lane",
  wtAutomation: "lane",
  filter: "clear",
  delay: "clear",
  reverb: "clear",
  fx: "clear",
  fxAutomation: "clear",
  synth: "clear",
  wavetable: "clear",
  sampler: "clear",
  rhythm: "clear",
  kit: "clear",
  time: "clear",
  tuning: "clear",
  string: "clear",
  granular: "clear",
  keys: "clear",
  modal: "clear",
  softPedal: "clear",
  sostenuto: "clear",
  guitar: "clear",
  wind: "clear",
  sing: "clear",
  clips: "clear",
  takes: "clear",
  glide: "clear",
  pedal: "clear",
  velocityCurve: "clear",
  humanize: "clear",
};

/** Field names of `Note` and `Track`, for tests that check completeness. */
export const NOTE_FIELD_NAMES = Object.freeze(
  Object.keys(NOTE_FIELDS),
) as readonly (keyof Note)[];
export const TRACK_FIELD_NAMES = Object.freeze(
  Object.keys(TRACK_FIELDS),
) as readonly (keyof Track)[];

function fieldPatch(
  rules: Readonly<Record<string, FieldRule>>,
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const before = a[key];
    const after = b[key];
    if (rule === "same") continue;
    if (rule === "set") {
      if (!deepEqual(before, after)) patch[key] = after;
    } else if (rule === "zero") {
      if (!deepEqual(before ?? 0, after ?? 0)) patch[key] = after ?? 0;
    } else if (rule === "flag") {
      if ((before ?? false) !== (after ?? false)) patch[key] = after ?? false;
    } else if (rule === "lane") {
      if (!deepEqual(before ?? [], after ?? [])) patch[key] = after ?? [];
    } else if (!deepEqual(before, after)) patch[key] = after ?? null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** Operations turning `a` into `b`; empty when they are equal. */
export function diffScores(
  a: TrackScore,
  b: TrackScore,
): readonly ScoreOperation[] {
  if (a.ticksPerBeat !== b.ticksPerBeat)
    throw new DiffError(
      `ticksPerBeat differs (${a.ticksPerBeat} → ${b.ticksPerBeat}); the session resolution is fixed`,
    );
  const ops: ScoreOperation[] = [...songOperations(a, b)];
  const aTracks = new Map(a.tracks.map((track) => [track.id, track]));
  const bTracks = new Map(b.tracks.map((track) => [track.id, track]));
  const aNotes = new Map(a.notes.map((note) => [note.id, note]));
  const bNotes = new Map(b.notes.map((note) => [note.id, note]));

  const updates: ScoreOperation[] = [];
  const additions: ScoreOperation[] = [];
  // Notes that leave `a`: dropped with their track, or removed one by one
  // (a note may name a track the score lacks, so check `a` too).
  const gone = new Set<string>();
  for (const note of a.notes) {
    if (aTracks.has(note.trackId) && !bTracks.has(note.trackId)) {
      gone.add(note.id); // removed with its track
      continue;
    }
    const next = bNotes.get(note.id);
    if (!next || next.trackId !== note.trackId) {
      ops.push({ type: "removeNote", noteId: note.id });
      gone.add(note.id);
      continue;
    }
    const patch = notePatch(note, next);
    if (patch) updates.push({ type: "updateNote", noteId: note.id, patch });
  }
  for (const note of b.notes)
    if (!aNotes.has(note.id) || gone.has(note.id))
      additions.push({ type: "addNote", note });

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

/**
 * Song settings, ordered so every step is valid on its own: constraints
 * that go away are dropped first (sections before meter changes, fermatas
 * before the tempo or meter that time them) and constraints that arrive
 * are added last. Steps are checked on a copy without tracks or notes,
 * because song settings never depend on them.
 */
function songOperations(a: TrackScore, b: TrackScore): ScoreOperation[] {
  const ops: ScoreOperation[] = [];
  let song = new TrackScore({ ...a.toJSON(), tracks: [], notes: [] });
  const emit = (operation: ScoreOperation): void => {
    song = applyScoreOperation(song, operation);
    ops.push(operation);
  };
  const sectionsDiffer = (): boolean =>
    !deepEqual(song.sections, b.sections) ||
    !deepEqual(song.form, b.form) ||
    song.loopSection !== b.loopSection;
  const setSections = (): void =>
    emit({
      type: "setSections",
      sections: b.sections,
      form: b.form,
      ...(b.loopSection === undefined ? {} : { loopSection: b.loopSection }),
    });
  if (b.sections.length === 0 && sectionsDiffer()) setSections();
  const retimed =
    song.beatsPerBar !== b.beatsPerBar ||
    song.bars !== b.bars ||
    song.tempoBpm !== b.tempoBpm;
  if (retimed && song.time?.fermatas && !deepEqual(song.time, b.time)) {
    const { fermatas: _fermatas, ...rest } = b.time ?? {};
    const interim = Object.keys(rest).length > 0 ? rest : null;
    if (!deepEqual(song.time, interim ?? undefined))
      emit({ type: "setTime", time: interim });
  } else if (retimed && song.time?.fermatas) {
    // Same fermatas before and after, but timed by a new tempo or meter.
    const { fermatas: _fermatas, ...rest } = song.time;
    emit({
      type: "setTime",
      time: Object.keys(rest).length > 0 ? rest : null,
    });
  }
  if (song.beatsPerBar !== b.beatsPerBar)
    emit({ type: "setMeter", beatsPerBar: b.beatsPerBar });
  if (song.bars !== b.bars) emit({ type: "setBars", bars: b.bars });
  if (song.tempoBpm !== b.tempoBpm)
    emit({ type: "setTempo", tempoBpm: b.tempoBpm });
  if (song.key !== b.key) emit({ type: "setKey", key: b.key });
  if (!deepEqual(song.time, b.time))
    emit({ type: "setTime", time: b.time ?? null });
  if (!deepEqual(song.tuning, b.tuning))
    emit({ type: "setTuning", tuning: b.tuning ?? null });
  if (!deepEqual(song.master, b.master))
    emit({ type: "setMaster", master: b.master ?? null });
  if (sectionsDiffer()) setSections();
  return ops;
}

/** Applies operations in order; the inverse of `diffScores`. */
export function applyScoreOperations(
  score: TrackScore,
  operations: readonly ScoreOperation[],
): TrackScore {
  return operations.reduce(applyScoreOperation, score);
}

function notePatch(a: Note, b: Note): NotePatch | undefined {
  return fieldPatch(NOTE_FIELDS, a, b) as NotePatch | undefined;
}

function trackPatch(a: Track, b: Track): TrackPatch | undefined {
  return fieldPatch(TRACK_FIELDS, a, b) as TrackPatch | undefined;
}

/** Structural equality for plain JSON-like data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  // === so -0 equals 0: a printed song.ts reads -0 back as 0.
  if (a === b) return true;
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
