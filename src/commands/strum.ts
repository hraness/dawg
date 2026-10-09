/**
 * `guitar …` and `strum …` (0.6.1): a track's fretting setup and strummed
 * guitar chords written as notes.
 *
 *   guitar                          show the setup
 *   guitar tune dadgad | E A D G B E   tuning name or open-string notes
 *   guitar capo 2 · hand 5 · ring 0.8 · position 5 · guitar reset
 *   strum G D Em C folk             chords (symbols or roman numerals)
 *   strum I V vi IV strokes D-DU-UDU speed 30ms each 2 at 4
 *   strum                           strum the chords already on the track
 *
 * Strumming runs core/chords.ts perform mode `guitar`, so play mode, the
 * agent's strum_chords and the SDK's strum() write the same notes.
 */

import {
  chordName,
  chordPitchClasses,
  DEFAULT_STROKE_SPEED,
  EXTENSIONS,
  GUITAR_TUNING_NAMES,
  guitarStrings,
  keyUsesFlats,
  makeChord,
  parseKey,
  QUALITIES,
  renderProgression,
  resolveChord,
  STROKE_PATTERN_NAMES,
  strokeGrid,
  type Chord,
  type Extension,
  type Key,
  type PerformedNote,
} from "../../core/chords.ts";
import { pitchToMidi } from "../../core/pitch.ts";

function parsePitch(text: string): number | undefined {
  const midi = pitchToMidi(text);
  return Number.isNaN(midi) ? undefined : midi;
}
import {
  normalizeGuitar,
  SCORE_LIMITS,
  ScoreValidationError,
  updateTrack,
  type Note,
  type ScoreOperation,
  type TrackGuitar,
  type TrackScore,
} from "../../core/score.ts";
import { resolveTuning, snapToTuning } from "../../core/tuning.ts";
import { applyScoreOperations } from "../../core/diff.ts";
import { barTicks } from "../../core/sections.ts";

export type GuitarCommand =
  | { type: "guitar-show" }
  | { type: "guitar-reset" }
  | { type: "guitar-set"; patch: Partial<Record<keyof TrackGuitar, unknown>> }
  | { type: "guitar-hint"; message: string };

const GUITAR_USAGE =
  "guitar tune <name|E A D G B E> · capo 0..12 · hand 3..6 · ring 0..1 · position 0..12 · reset";

/** `guitar …`, or undefined when the prompt is not a guitar command. */
export function parseGuitarCommand(prompt: string): GuitarCommand | undefined {
  if (prompt.length > 512) return undefined;
  const words = prompt.trim().replace(/^\//, "").split(/\s+/);
  if (words[0]?.toLowerCase() !== "guitar") return undefined;
  const field = words[1]?.toLowerCase();
  const rest = words.slice(2);
  if (field === undefined) return { type: "guitar-show" };
  if (field === "reset" || field === "off") return { type: "guitar-reset" };
  if (field === "tune" || field === "tuning") {
    if (rest.length === 1) {
      const name = rest[0]!.toLowerCase().replace(/[\s_-]/g, "");
      if ((GUITAR_TUNING_NAMES as readonly string[]).includes(name))
        return { type: "guitar-set", patch: { tune: name } };
    }
    const pitches = parseOpenStrings(rest);
    if (pitches) return { type: "guitar-set", patch: { tune: pitches } };
    return {
      type: "guitar-hint",
      message: `guitar tune takes ${GUITAR_TUNING_NAMES.join(" ")} or 3..12 notes low to high (E2 A2 D3 G3 B3 E4, or E A D G B E)`,
    };
  }
  if (
    field === "capo" ||
    field === "hand" ||
    field === "ring" ||
    field === "position"
  ) {
    const value = Number(rest[0]);
    if (rest.length !== 1 || !Number.isFinite(value))
      return { type: "guitar-hint", message: GUITAR_USAGE };
    return { type: "guitar-set", patch: { [field]: value } };
  }
  return { type: "guitar-hint", message: GUITAR_USAGE };
}

/**
 * Open strings low to high: `E2 A2 D3 G3 B3 E4`, MIDI numbers, or bare
 * letters (`D A D G A D`), each placed at or above the previous string from
 * octave 2 (a high re-entrant string needs its octave: `G4 C4 E4 A4`).
 */
export function parseOpenStrings(
  words: readonly string[],
): readonly number[] | undefined {
  if (words.length < 3 || words.length > 12) return undefined;
  const out: number[] = [];
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      const pitch = Number(word);
      if (pitch > 127) return undefined;
      out.push(pitch);
      continue;
    }
    const bare = /^([a-g])([#b]?)$/i.exec(word);
    if (bare) {
      const pitch = parsePitch(`${bare[1]!.toUpperCase()}${bare[2]}2`);
      if (pitch === undefined) return undefined;
      const previous = out.at(-1);
      let placed = pitch;
      while (previous !== undefined && placed <= previous) placed += 12;
      out.push(placed);
      continue;
    }
    const pitch = parsePitch(word.charAt(0).toUpperCase() + word.slice(1));
    if (pitch === undefined) return undefined;
    out.push(pitch);
  }
  return out;
}

export type CommandResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** One-line description of a guitar setup. */
export function describeGuitar(guitar: TrackGuitar | undefined): string {
  const tune = guitar?.tune ?? "standard";
  const parts = [
    typeof tune === "string" ? tune : tune.join(" "),
    `capo ${guitar?.capo ?? 0}`,
    `hand ${guitar?.hand ?? 4}`,
    `ring ${guitar?.ring ?? 0.5}`,
  ];
  if (guitar?.position !== undefined) parts.push(`position ${guitar.position}`);
  return parts.join(" · ");
}

export function applyGuitarCommand(
  score: TrackScore,
  trackId: string,
  command: GuitarCommand,
): CommandResult {
  if (command.type === "guitar-hint")
    return { ok: false, message: command.message };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "guitar-show")
    return {
      ok: true,
      message: `guitar · ${describeGuitar(track.guitar)}${track.guitar ? "" : " (default)"}`,
    };
  let guitar: TrackGuitar | undefined;
  try {
    guitar =
      command.type === "guitar-reset"
        ? undefined
        : normalizeGuitar({ ...track.guitar, ...command.patch });
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return { ok: false, message: error.message.replace(/^track /, "") };
    throw error;
  }
  const next = updateTrack(score, trackId, { guitar: guitar ?? null });
  return {
    ok: true,
    message: guitar ? `guitar · ${describeGuitar(guitar)}` : "guitar · reset",
    next,
    kind: "score.effect",
    payload: { trackId, guitar: guitar ?? null },
  };
}

// ---------------------------------------------------------------------------
// strum

export type StrumOptions = Readonly<{
  /** Chord symbols or roman numerals; empty strums the track's own chords. */
  chords: readonly string[];
  /** STROKE_PATTERNS name or a D U d u x - . grid. */
  strokes?: string;
  /** Ms a full down stroke takes. */
  speedMs?: number;
  /** Grid step in beats. */
  step?: number;
  /** Beats per chord (default one bar). */
  each?: number;
  /** First beat (default 0). */
  at?: number;
  velocity?: number;
  seed?: number;
}>;

export type StrumCommand =
  | { type: "strum"; options: StrumOptions }
  | { type: "strum-hint"; message: string };

const STRUM_USAGE = `strum <chords> [${STROKE_PATTERN_NAMES.join("|")}] [strokes D-DU-UDU] [speed 22ms] [each 4] [at 0] · strum alone strums the track's chords`;

/** `strum …`, or undefined when the prompt is not a strum command. */
export function parseStrumCommand(prompt: string): StrumCommand | undefined {
  if (prompt.length > 1_024) return undefined;
  const words = prompt.trim().replace(/^\//, "").split(/\s+/);
  if (words[0]?.toLowerCase() !== "strum") return undefined;
  const chords: string[] = [];
  const options: Record<string, unknown> = {};
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]!;
    const lower = word.toLowerCase();
    const next = words[i + 1];
    if (lower === "strokes") {
      if (!next || !strokeGrid(next))
        return { type: "strum-hint", message: STRUM_USAGE };
      options.strokes = next;
      i += 1;
    } else if (lower === "speed") {
      const ms = /^(\d+(?:\.\d+)?)(?:ms)?$/i.exec(next ?? "");
      if (!ms || Number(ms[1]) > 200)
        return { type: "strum-hint", message: "strum speed takes 0..200 ms" };
      options.speedMs = Number(ms[1]);
      i += 1;
    } else if (
      lower === "each" ||
      lower === "at" ||
      lower === "step" ||
      lower === "seed"
    ) {
      const value = Number(next);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (lower !== "at" && lower !== "seed" && value <= 0)
      )
        return { type: "strum-hint", message: STRUM_USAGE };
      options[lower] = value;
      i += 1;
    } else if ((STROKE_PATTERN_NAMES as readonly string[]).includes(lower))
      options.strokes = lower;
    else chords.push(word);
  }
  if (chords.length > 64)
    return { type: "strum-hint", message: "strum takes up to 64 chords" };
  return { type: "strum", options: { ...options, chords } as StrumOptions };
}

/** Pitch classes of a chord, as a sorted key. */
function pcKey(pcs: Iterable<number>): string {
  return [...new Set([...pcs].map((p) => ((p % 12) + 12) % 12))]
    .sort((a, b) => a - b)
    .join(",");
}

/**
 * The chord a set of sounding pitches spells, preferring the lowest note as
 * the root (else a slash chord over it), or undefined.
 */
export function detectChord(pitches: readonly number[]): Chord | undefined {
  if (pitches.length < 2) return undefined;
  const sorted = [...pitches].sort((a, b) => a - b);
  const want = pcKey(sorted);
  const bass = ((sorted[0]! % 12) + 12) % 12;
  const roots = [...new Set(sorted.map((p) => ((p % 12) + 12) % 12))];
  const subsets: Extension[][] = [];
  for (let mask = 0; mask < 1 << EXTENSIONS.length; mask += 1)
    subsets.push(EXTENSIONS.filter((_, i) => mask & (1 << i)));
  subsets.sort((a, b) => a.length - b.length);
  for (const root of roots)
    for (const extensions of subsets)
      for (const quality of QUALITIES) {
        const chord = makeChord(root, quality, extensions);
        if (pcKey(chordPitchClasses(chord)) === want)
          return root === bass
            ? chord
            : makeChord(root, quality, extensions, bass);
      }
  return undefined;
}

/** Chords already on a track: one per onset with two or more notes. */
export function trackChords(
  notes: readonly Note[],
): { chord: Chord; startTick: number; endTick: number; ids: string[] }[] {
  const byStart = new Map<number, Note[]>();
  for (const note of notes) {
    const group = byStart.get(note.startTick) ?? [];
    group.push(note);
    byStart.set(note.startTick, group);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const out: {
    chord: Chord;
    startTick: number;
    endTick: number;
    ids: string[];
  }[] = [];
  starts.forEach((start, index) => {
    const group = byStart.get(start)!;
    const chord = detectChord(group.map((note) => note.pitch));
    if (!chord) return;
    const own = Math.max(...group.map((n) => n.startTick + n.durationTicks));
    const following = starts[index + 1];
    out.push({
      chord,
      startTick: start,
      endTick: following === undefined ? own : Math.min(own, following),
      ids: group.map((note) => note.id),
    });
  });
  return out;
}

export type StrumPlan = Readonly<{
  operations: ScoreOperation[];
  names: string[];
  noteCount: number;
}>;

export class StrumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrumError";
  }
}

/**
 * Strummed notes for `options` on `trackId`, as score operations (removing
 * the block chords when strumming the track's own). Throws StrumError.
 */
export function planStrum(
  score: TrackScore,
  trackId: string,
  options: StrumOptions,
  newId: (index: number) => string,
  maxNotes = 4096,
): StrumPlan {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new StrumError(`no track · ${trackId}`);
  if (options.strokes !== undefined && !strokeGrid(options.strokes))
    throw new StrumError(
      `strokes must be ${STROKE_PATTERN_NAMES.join(", ")} or a grid of D U d u x - .`,
    );
  const key: Key = parseKey(score.key) ?? { tonic: 0, mode: "major" };
  const tpb = score.ticksPerBeat;
  const perform = {
    mode: "guitar" as const,
    ...(options.strokes !== undefined ? { strokes: options.strokes } : {}),
    ...(options.step !== undefined ? { step: options.step } : {}),
    speed: (options.speedMs ?? DEFAULT_STROKE_SPEED * 1000) / 1000,
    tempo: score.tempoBpm,
    velocity: options.velocity ?? 0.8,
    seed: options.seed ?? 0,
    ...(track.guitar ? { guitar: track.guitar } : {}),
  };
  const regions: { chord: Chord; start: number; beats: number }[] = [];
  const removals: string[] = [];
  if (options.chords.length === 0) {
    const found = trackChords(score.notes.filter((n) => n.trackId === trackId));
    if (found.length === 0)
      throw new StrumError(
        "no chords on this track to strum · strum G D Em C, or write chords first",
      );
    for (const region of found) {
      regions.push({
        chord: region.chord,
        start: region.startTick / tpb,
        beats: (region.endTick - region.startTick) / tpb,
      });
      removals.push(...region.ids);
    }
  } else {
    const each = options.each ?? score.beatsPerBar;
    const at = options.at ?? 0;
    options.chords.forEach((text, index) => {
      const chord = resolveChord(key, text);
      if (!chord)
        throw new StrumError(
          `unknown chord ${JSON.stringify(text.slice(0, 32))} (a symbol like Em7 or a numeral like vi)`,
        );
      regions.push({ chord, start: at + index * each, beats: each });
    });
  }
  const performed: PerformedNote[] = [];
  regions.forEach((region, index) => {
    const rendered = renderProgression({
      key,
      chords: [region.chord],
      beatsPerChord: region.beats,
      start: region.start,
      lead: false,
      perform: { ...perform, seed: perform.seed + index },
    });
    performed.push(...rendered.notes);
  });
  if (performed.length > maxNotes)
    throw new StrumError(
      `${performed.length} notes exceed ${maxNotes}; strum fewer chords or a sparser grid`,
    );
  const table = resolveTuning(score.tuning, track.tuning, score.key);
  const operations: ScoreOperation[] = removals.map((noteId) => ({
    type: "removeNote",
    noteId,
  }));
  performed.forEach((note, index) => {
    operations.push({
      type: "addNote",
      note: {
        id: newId(index),
        trackId,
        startTick: Math.round(note.start * tpb),
        durationTicks: Math.max(1, Math.round(note.length * tpb)),
        pitch: snapToTuning(note.pitch, table),
        velocity: note.velocity,
      },
    });
  });
  const flats = keyUsesFlats(key);
  return {
    operations,
    names: regions.map((region) => chordName(region.chord, flats)),
    noteCount: performed.length,
  };
}

/** Runs a strum command against the score. */
export function applyStrumCommand(
  score: TrackScore,
  trackId: string,
  command: StrumCommand,
  newId: (index: number) => string,
): CommandResult {
  if (command.type === "strum-hint")
    return { ok: false, message: command.message };
  let plan: StrumPlan;
  try {
    plan = planStrum(score, trackId, command.options, newId);
  } catch (error) {
    if (error instanceof StrumError)
      return { ok: false, message: error.message };
    throw error;
  }
  const track = score.tracks.find((candidate) => candidate.id === trackId)!;
  let next: TrackScore;
  try {
    next = applyScoreOperations(score, plan.operations);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return { ok: false, message: `strum · ${error.message}` };
    throw error;
  }
  // Chords that run past the song's end grow it, so they are heard.
  const end = next.notes.reduce(
    (max, note) => Math.max(max, note.startTick + note.durationTicks),
    0,
  );
  const perBar = barTicks(next);
  const needed = Math.min(SCORE_LIMITS.maxBars, Math.ceil(end / perBar));
  const grew = needed > next.bars;
  if (grew)
    next = applyScoreOperations(next, [{ type: "setBars", bars: needed }]);
  const strings = guitarStrings(track.guitar?.tune).length;
  return {
    ok: true,
    message: `strum · ${plan.names.join(" ")} · ${command.options.strokes ?? "down"} · ${plan.noteCount} notes on ${strings} strings${grew ? ` · song now ${needed} bars` : ""}`,
    next,
    kind: "score.notes",
    payload: { trackId, strum: plan.names },
  };
}
