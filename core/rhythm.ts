/**
 * Rhythm rows on a score: the glue between `core/euclid.ts` generators and
 * the stored notes.
 *
 * A track's `rhythm` rows each own one voice lane (a drum voice, a one-shot
 * sampler voice, or a pitch). `withTrackRhythm` replaces the rows and
 * regenerates exactly those lanes' notes, so an edit is one next score and
 * therefore one revision and one undo step. Other notes on the track, and
 * every other track, are untouched. Generated notes carry deterministic ids
 * (`rh.<track hash>.<voice>.<n>`), so the same rows always produce the same
 * score and `diffScores` sees only real changes.
 */
import { isDrumInstrument, parseDrumVoice, drumVoicePitch } from "./drums.ts";
import { expandRow, rowSummary, type RhythmRow } from "./euclid.ts";
import { pitchToMidi } from "./pitch.ts";
import {
  SCORE_LIMITS,
  ScoreValidationError,
  TrackScore,
  isSamplerInstrument,
  samplerVoiceSlots,
  type Note,
  type Track,
} from "./score.ts";
import { loopTicksOf } from "./tempo.ts";

/** MIDI pitch a row's voice plays on `track`, or undefined when unknown. */
export function rhythmVoicePitch(
  track: Track,
  voice: string,
): number | undefined {
  const name = voice.trim();
  if (isSamplerInstrument(track.instrument) && track.sampler) {
    const slot = samplerVoiceSlots(track.sampler).get(name);
    if (slot !== undefined) return slot;
  }
  if (isDrumInstrument(track.instrument)) {
    const drum = parseDrumVoice(name);
    if (drum) return drumVoicePitch(drum);
  }
  if (/^\d{1,3}$/.test(name)) {
    const midi = Number(name);
    return midi <= 127 ? midi : undefined;
  }
  const midi = pitchToMidi(name);
  return Number.isNaN(midi) ? undefined : midi;
}

function trackHash(trackId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < trackId.length; index += 1) {
    hash ^= trackId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function idVoice(voice: string): string {
  return voice.replace(/[^A-Za-z0-9_#-]/g, "_").slice(0, 32);
}

/** The notes `row` generates on `track` over the score's loop. */
export function expandTrackRow(
  score: TrackScore,
  track: Track,
  row: RhythmRow,
): Note[] {
  const pitch = rhythmVoicePitch(track, row.voice);
  if (pitch === undefined)
    throw new ScoreValidationError(
      `track ${track.id} has no voice "${row.voice}"`,
      "invalid-track",
    );
  const loopTicks = loopTicksOf(score);
  const prefix = `rh.${trackHash(track.id)}.${idVoice(row.voice)}.`;
  return expandRow(row, { ticksPerBeat: score.ticksPerBeat, loopTicks }).map(
    (hit, index) => ({
      id: `${prefix}${index}`,
      trackId: track.id,
      startTick: hit.startTick,
      durationTicks: Math.min(hit.durationTicks, SCORE_LIMITS.maxTick),
      pitch,
      velocity: hit.velocity,
    }),
  );
}

/** Pitches the rows own on `track` (unresolvable voices are skipped). */
function ownedPitches(track: Track, rows: readonly RhythmRow[]): Set<number> {
  const pitches = new Set<number>();
  for (const row of rows) {
    const pitch = rhythmVoicePitch(track, row.voice);
    if (pitch !== undefined) pitches.add(pitch);
  }
  return pitches;
}

/**
 * The score with `trackId`'s rows replaced by `rows` (empty removes them)
 * and the lanes of the old and new rows regenerated. Throws
 * `ScoreValidationError` for an unknown track or voice, or past the note
 * limit.
 */
export function withTrackRhythm(
  score: TrackScore,
  trackId: string,
  rows: readonly RhythmRow[],
): TrackScore {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track)
    throw new ScoreValidationError(`no track ${trackId}`, "invalid-track");
  const nextTrack: Track = { ...track };
  const tracks = score.tracks.map((candidate) =>
    candidate.id === trackId
      ? { ...candidate, rhythm: rows.length > 0 ? rows : null }
      : candidate,
  );
  const cleared = ownedPitches(track, [...(track.rhythm ?? []), ...rows]);
  const generated = rows.flatMap((row) =>
    expandTrackRow(score, nextTrack, row),
  );
  const notes = [
    ...score.notes.filter(
      (note) => note.trackId !== trackId || !cleared.has(note.pitch),
    ),
    ...generated,
  ];
  if (notes.length > SCORE_LIMITS.maxNotes)
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxNotes} notes`,
      "invalid-score",
    );
  return new TrackScore({ ...score.toJSON(), tracks, notes });
}

/** Adds or replaces the row for `row.voice` on the track. */
export function setRhythmRow(
  score: TrackScore,
  trackId: string,
  row: RhythmRow,
): TrackScore {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  const current = track?.rhythm ?? [];
  const index = current.findIndex((existing) => existing.voice === row.voice);
  const rows =
    index < 0
      ? [...current, row]
      : current.map((existing, at) => (at === index ? row : existing));
  return withTrackRhythm(score, trackId, rows);
}

/**
 * Drops the row for `voice`. With `keepNotes` its generated notes stay as
 * plain notes (the row is "frozen"); otherwise the lane is cleared.
 */
export function removeRhythmRow(
  score: TrackScore,
  trackId: string,
  voice: string,
  keepNotes = false,
): TrackScore {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  const current = track?.rhythm ?? [];
  const rows = current.filter((row) => row.voice !== voice);
  if (rows.length === current.length) return score;
  if (!keepNotes) return withTrackRhythm(score, trackId, rows);
  return new TrackScore({
    ...score.toJSON(),
    tracks: score.tracks.map((candidate) =>
      candidate.id === trackId
        ? { ...candidate, rhythm: rows.length > 0 ? rows : null }
        : candidate,
    ),
  });
}

/**
 * Every track's rows regenerated for the current loop length (after a
 * `bars` change, or for a score fresh from `song.ts`). Returns `score`
 * itself when nothing changes.
 */
export function refreshRhythm(score: TrackScore): TrackScore {
  let next = score;
  for (const track of score.tracks)
    if (track.rhythm && !rhythmInSync(next, track.id))
      next = withTrackRhythm(next, track.id, track.rhythm);
  return next;
}

/** True when the track's owned lanes hold exactly what its rows generate. */
export function rhythmInSync(score: TrackScore, trackId: string): boolean {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track?.rhythm) return true;
  let expected: Note[];
  try {
    expected = track.rhythm.flatMap((row) => expandTrackRow(score, track, row));
  } catch {
    return false;
  }
  const owned = ownedPitches(track, track.rhythm);
  const actual = score.notes.filter(
    (note) => note.trackId === trackId && owned.has(note.pitch),
  );
  return sameNotes(expected, actual);
}

/** True when `row`'s lane on the track holds exactly what the row generates. */
export function rowInSync(
  score: TrackScore,
  track: Track,
  row: RhythmRow,
): boolean {
  const pitch = rhythmVoicePitch(track, row.voice);
  if (pitch === undefined) return false;
  let expected: Note[];
  try {
    expected = expandTrackRow(score, track, row);
  } catch {
    return false;
  }
  const actual = score.notes.filter(
    (note) => note.trackId === track.id && note.pitch === pitch,
  );
  return sameNotes(expected, actual);
}

function sameNotes(
  expected: readonly Note[],
  actual: readonly Note[],
): boolean {
  if (actual.length !== expected.length) return false;
  const key = (note: Note) =>
    `${note.pitch}|${note.startTick}|${note.durationTicks}|${note.velocity}|${note.cents ?? 0}`;
  const want = new Map<string, number>();
  for (const note of expected)
    want.set(key(note), (want.get(key(note)) ?? 0) + 1);
  for (const note of actual) {
    // Expression is a hand edit: the generator cannot reproduce it.
    if (
      note.articulation !== undefined ||
      note.glide !== undefined ||
      note.bend !== undefined ||
      note.vibrato !== undefined
    )
      return false;
    const left = want.get(key(note));
    if (!left) return false;
    want.set(key(note), left - 1);
  }
  return true;
}

/**
 * Keeps rows and their lanes consistent after an arbitrary edit from
 * `previous` to `next`: when the loop grid changed (bars, meter, ticks per
 * beat) every row regenerates; otherwise a row whose lane was hand-edited
 * is frozen (dropped, its notes kept as plain notes). Returns `next` itself
 * when nothing needs to change.
 */
export function reconcileRhythm(
  previous: TrackScore,
  next: TrackScore,
): TrackScore {
  const regridded =
    previous.bars !== next.bars ||
    previous.beatsPerBar !== next.beatsPerBar ||
    previous.ticksPerBeat !== next.ticksPerBeat;
  let out = next;
  for (const track of next.tracks) {
    if (!track.rhythm) continue;
    if (regridded) {
      if (!rhythmInSync(out, track.id))
        out = withTrackRhythm(out, track.id, track.rhythm);
      continue;
    }
    const current = out.tracks.find((candidate) => candidate.id === track.id)!;
    const kept = track.rhythm.filter((row) => rowInSync(out, current, row));
    if (kept.length !== track.rhythm.length)
      out = new TrackScore({
        ...out.toJSON(),
        tracks: out.tracks.map((candidate) =>
          candidate.id === track.id
            ? { ...candidate, rhythm: kept.length > 0 ? kept : null }
            : candidate,
        ),
      });
  }
  return out;
}

/** `kick E(4,16) · hat E(7,16,r2)` for a status line. */
export function rhythmSummary(track: Track): string {
  return (track.rhythm ?? [])
    .map((row) => `${row.voice} ${rowSummary(row)}`)
    .join(" · ");
}
