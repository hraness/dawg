/**
 * Lyric edits as score operations (machine vox V0, design 3.4): retype a
 * range without touching notes, re-flow a range's text onto its current
 * notes, clear a range, split a note (the second half holds `_`) and join
 * notes (absorbed syllables are dropped and reported). Every edit is one
 * `ScoreOperation[]` batch, so one revision and one Ctrl-Z, shared by the
 * typed commands, the agent tools and their previews.
 */
import { newId } from "./ids.ts";
import { assignLyrics, lyricLine } from "./lyrics.ts";
import type { Note, NoteInput, ScoreOperation, TrackScore } from "./score.ts";
import {
  DEFAULT_BREATH,
  joinLyric,
  patchNoteVox,
  splitLyric,
  sungLine,
  type NoteVox,
} from "./vox.ts";

/** A half-open tick range `[fromTick, toTick)`; absent ends are open. */
export type TickRange = Readonly<{ fromTick?: number; toTick?: number }>;

export type LyricEdit = Readonly<{
  operations: ScoreOperation[];
  /** The range's lyric line after the edit, in the grammar. */
  line: string;
  /** Sung notes (one per onset) in the range. */
  notes: number;
  /** Syllables that did not fit (retype, reflow) or were merged away (join). */
  dropped: readonly string[];
  /** Words split automatically by the syllable guess. */
  split: readonly string[];
}>;

const inRange = (note: Note, range: TickRange): boolean =>
  note.startTick >= (range.fromTick ?? 0) &&
  note.startTick < (range.toTick ?? Infinity);

/** A track's notes in the range, every pitch of a chord, in time order. */
export function rangeNotes(
  score: TrackScore,
  trackId: string,
  range: TickRange,
): Note[] {
  return score.notes
    .filter((note) => note.trackId === trackId && inRange(note, range))
    .sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);
}

function sameVox(a: NoteVox | undefined, b: NoteVox | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** An `updateNote` op when the lyric or vox differ; nothing otherwise. */
function lyricOp(
  note: Note,
  lyric: string | undefined,
  vox: NoteVox | undefined,
): ScoreOperation[] {
  const patch: Record<string, unknown> = {};
  if (lyric !== note.lyric) patch.lyric = lyric ?? null;
  if (!sameVox(vox, note.vox)) patch.vox = vox ?? null;
  return Object.keys(patch).length
    ? [{ type: "updateNote", noteId: note.id, patch } as ScoreOperation]
    : [];
}

/** The lyric line of a range as it reads now. */
export function rangeLyricLine(
  score: TrackScore,
  trackId: string,
  range: TickRange,
): string {
  return lyricLine(sungLine(rangeNotes(score, trackId, range), trackId));
}

/**
 * Put `text` (the lyric grammar) on the range's notes in time order. Only
 * `lyric` and the `vox` fields the text carries (`ph`, `breath`) change;
 * pitch, timing and velocity never do. Notes beyond the text hold; leftover
 * syllables are reported.
 */
export function retypeLyrics(
  score: TrackScore,
  trackId: string,
  range: TickRange,
  text: string,
): LyricEdit {
  const notes = rangeNotes(score, trackId, range);
  const { lyrics, ph, breaths, dropped, split } = assignLyrics(text, notes);
  const operations: ScoreOperation[] = [];
  const after: Note[] = [];
  for (const note of notes) {
    const lyric = lyrics.get(note.id);
    const vox = patchNoteVox(note.vox, {
      ph: ph.get(note.id) ?? null,
      breath: breaths.has(note.id)
        ? (note.vox?.breath ?? DEFAULT_BREATH)
        : null,
    });
    operations.push(...lyricOp(note, lyric, vox));
    after.push({
      ...note,
      ...(lyric !== undefined ? { lyric } : { lyric: undefined }),
      ...(vox ? { vox } : { vox: undefined }),
    } as Note);
  }
  return {
    operations,
    line: lyricLine(sungLine(after, trackId)),
    notes: sungLine(notes, trackId).length,
    dropped,
    split,
  };
}

/**
 * Re-assign the range's current lyric text (word continuations, phones and
 * breaths kept) onto its notes in time order: after re-recording,
 * re-quantizing or reversing a melody. Unchanged notes give zero ops.
 */
export function reflowLyrics(
  score: TrackScore,
  trackId: string,
  range: TickRange,
): LyricEdit {
  const notes = rangeNotes(score, trackId, range);
  // Read the text in reading order: sung notes (chord tops) only, `~` gaps
  // dropped so the syllables close up onto the notes.
  const line = sungLine(notes, trackId).filter((n) => n.lyric !== undefined);
  const text = lyricLine(line);
  if (!text)
    return { operations: [], line: "", notes: 0, dropped: [], split: [] };
  const edit = retypeLyrics(score, trackId, range, text);
  return { ...edit, split: [] };
}

/** Remove `lyric` and `vox.ph` (and breaths) in the range. */
export function clearLyrics(
  score: TrackScore,
  trackId: string,
  range: TickRange,
): LyricEdit {
  const notes = rangeNotes(score, trackId, range);
  const operations = notes.flatMap((note) =>
    lyricOp(
      note,
      undefined,
      patchNoteVox(note.vox, { ph: null, breath: null }),
    ),
  );
  return {
    operations,
    line: "",
    notes: sungLine(notes, trackId).length,
    dropped: [],
    split: [],
  };
}

/**
 * Split each note at `fraction` of its length (default half): the first
 * part keeps its id, lyric and vox (minus `dyn`), the second is a new note
 * holding `_` (with `ph` only when that is one vowel). Never creates a
 * syllable. Notes too short to split are skipped.
 */
export function splitNotes(
  score: TrackScore,
  noteIds: readonly string[],
  fraction = 0.5,
): Readonly<{ operations: ScoreOperation[]; split: number }> {
  const ids = new Set(noteIds);
  const used = new Set(score.notes.map((note) => note.id));
  const operations: ScoreOperation[] = [];
  let split = 0;
  for (const note of score.notes) {
    if (!ids.has(note.id)) continue;
    const head = Math.round(note.durationTicks * fraction);
    if (head < 1 || head >= note.durationTicks) continue;
    const { first, second } = splitLyric(note);
    let id = newId("n");
    while (used.has(id)) id = newId("n");
    used.add(id);
    const patch: Record<string, unknown> = { durationTicks: head };
    if (!sameVox(first.vox, note.vox)) patch.vox = first.vox ?? null;
    operations.push({
      type: "updateNote",
      noteId: note.id,
      patch,
    } as ScoreOperation);
    const {
      id: _id,
      lyric: _lyric,
      vox: _vox,
      startTick,
      durationTicks,
      ...rest
    } = note;
    const added: Record<string, unknown> = {
      ...rest,
      id,
      startTick: startTick + head,
      durationTicks: durationTicks - head,
    };
    if (second.lyric !== undefined) added.lyric = second.lyric;
    if (second.vox) added.vox = second.vox;
    operations.push({ type: "addNote", note: added as NoteInput });
    split += 1;
  }
  return { operations, split };
}

/**
 * Join notes into the earliest of them (per track): it stretches to the end
 * of the last and keeps its own lyric and vox. Every real syllable of the
 * absorbed notes is dropped and reported; a `_` merges silently.
 */
export function joinNotes(
  score: TrackScore,
  noteIds: readonly string[],
): Readonly<{
  operations: ScoreOperation[];
  joined: number;
  dropped: readonly string[];
}> {
  const ids = new Set(noteIds);
  const byTrack = new Map<string, Note[]>();
  for (const note of score.notes)
    if (ids.has(note.id))
      byTrack.set(note.trackId, [...(byTrack.get(note.trackId) ?? []), note]);
  const operations: ScoreOperation[] = [];
  const dropped: string[] = [];
  let joined = 0;
  for (const notes of byTrack.values()) {
    if (notes.length < 2) continue;
    const sorted = [...notes].sort(
      (a, b) => a.startTick - b.startTick || b.pitch - a.pitch,
    );
    const head = sorted[0]!;
    const end = Math.max(...sorted.map((n) => n.startTick + n.durationTicks));
    const result = joinLyric(sorted);
    dropped.push(...result.dropped);
    operations.push({
      type: "updateNote",
      noteId: head.id,
      patch: { durationTicks: end - head.startTick },
    } as ScoreOperation);
    for (const note of sorted.slice(1))
      operations.push({ type: "removeNote", noteId: note.id });
    joined += sorted.length - 1;
  }
  return { operations, joined, dropped };
}
