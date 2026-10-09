/**
 * Code graders for the agent eval: small, deterministic predicates over the
 * resulting score. No LLM judges anything. Positions are in quarter-note
 * beats from the loop start (`startTick / ticksPerBeat`).
 */
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";
import type { Note, Track, TrackScore } from "../../core/score.ts";

export type Check = Readonly<{ name: string; ok: boolean; detail?: string }>;

export type ToolCallRecord = Readonly<{
  name: string;
  outcome: "applied" | "rejected" | "read";
}>;

export type GradeContext = Readonly<{
  initial: TrackScore;
  score: TrackScore;
  /** The final assistant text of the last turn. */
  text: string;
  calls: readonly ToolCallRecord[];
  /** Result of re-evaluating the project files after the run. */
  files: Readonly<{ ok: boolean; detail: string }>;
}>;

export type DrumVoice =
  "kick" | "snare" | "clap" | "rim" | "tom" | "hat" | "openhat";

export const EPS = 1e-6;

export function check(name: string, ok: boolean, detail?: string): Check {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

export const near = (a: number | undefined, b: number, tol = 0.011) =>
  a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tol;

export const beatOf = (score: TrackScore, note: Note) =>
  note.startTick / score.ticksPerBeat;

export const lengthOf = (score: TrackScore, note: Note) =>
  note.durationTicks / score.ticksPerBeat;

/** The song's opening meter: `time.meter` at bar 0/1 wins over the fields. */
export function meterOf(score: TrackScore): { beats: number; unit: number } {
  const first = score.time?.meter?.find((change) => change.bar <= 1);
  if (first) return { beats: first.beatsPerBar, unit: first.beatUnit ?? 4 };
  return { beats: score.beatsPerBar, unit: 4 };
}

/** Quarter-note beats per bar of the opening meter. */
export const barBeats = (score: TrackScore) => {
  const meter = meterOf(score);
  return (meter.beats * 4) / meter.unit;
};

export const loopBeats = (score: TrackScore) => score.bars * barBeats(score);

export const notesOf = (score: TrackScore, trackId: string) =>
  score.notes
    .filter((note) => note.trackId === trackId)
    .slice()
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

export const trackById = (score: TrackScore, id: string) =>
  score.tracks.find((track) => track.id === id);

/** Tracks whose id, name or instrument matches `pattern`. */
export function tracksMatching(
  score: TrackScore,
  pattern: RegExp,
): readonly Track[] {
  return score.tracks.filter(
    (track) =>
      pattern.test(track.id) ||
      pattern.test(track.name) ||
      pattern.test(track.instrument),
  );
}

export const isDrumTrack = (track: Track) =>
  isDrumInstrument(track.instrument) || (track.rhythm?.length ?? 0) > 0;

export const drumTracks = (score: TrackScore) =>
  score.tracks.filter(isDrumTrack);

export const pitchedTracks = (score: TrackScore) =>
  score.tracks.filter((track) => !isDrumTrack(track));

/** Every hit of `voice` on any drum track, as sorted unique beats. */
export function drumHits(score: TrackScore, voice: DrumVoice): number[] {
  const ids = new Set(drumTracks(score).map((track) => track.id));
  const beats = score.notes
    .filter(
      (note) =>
        ids.has(note.trackId) && drumVoiceForPitch(note.pitch) === voice,
    )
    .map((note) => round(beatOf(score, note)));
  return [...new Set(beats)].sort((a, b) => a - b);
}

export const round = (value: number) => Math.round(value * 1000) / 1000;

/** True when `beats` hold exactly the positions `expected` (to 1/1000). */
export function sameBeats(
  beats: readonly number[],
  expected: readonly number[],
): boolean {
  const want = [...new Set(expected.map(round))].sort((a, b) => a - b);
  return beats.length === want.length && beats.every((b, i) => b === want[i]);
}

/** Beats `0, step, 2·step …` below `end`, offset by `from`. */
export function grid(end: number, step: number, from = 0): number[] {
  const out: number[] = [];
  for (let beat = from; beat < end - EPS; beat += step) out.push(round(beat));
  return out;
}

/** Positions of a per-bar pattern repeated over every bar of the loop. */
export function everyBar(score: TrackScore, offsets: readonly number[]) {
  const bar = barBeats(score);
  const out: number[] = [];
  for (let b = 0; b < score.bars; b += 1)
    for (const offset of offsets) out.push(round(b * bar + offset));
  return out;
}

/** Hits within each bar, folded to their offset in the bar. */
export function offsetsInBars(score: TrackScore, beats: readonly number[]) {
  const bar = barBeats(score);
  return [...new Set(beats.map((beat) => round(beat % bar)))].sort(
    (a, b) => a - b,
  );
}

const mod12 = (value: number) => ((value % 12) + 12) % 12;

/** Pitch classes sounding at any point in [from, to) on `tracks`. */
export function pitchClassesIn(
  score: TrackScore,
  tracks: readonly Track[],
  from: number,
  to: number,
): Set<number> {
  const ids = new Set(tracks.map((track) => track.id));
  const out = new Set<number>();
  for (const note of score.notes) {
    if (!ids.has(note.trackId)) continue;
    const start = beatOf(score, note);
    const end = start + lengthOf(score, note);
    if (start < to - EPS && end > from + EPS) out.add(mod12(note.pitch));
  }
  return out;
}

const NAMES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** `"Bb"` → 10. */
export function pc(name: string): number {
  const base = NAMES[name[0]!.toUpperCase()];
  if (base === undefined) throw new Error(`bad pitch class ${name}`);
  let value = base;
  for (const accidental of name.slice(1))
    value += accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return mod12(value);
}

const QUALITY: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  "7": [0, 4, 10],
  m7: [0, 3, 10],
  maj7: [0, 4, 11],
  m7b5: [0, 3, 6, 10],
};

/**
 * The tones a chord symbol needs present: root, third and the defining
 * seventh (fifths may be omitted from sevenths, as voicings often do).
 */
export function chordTones(symbol: string): number[] {
  const match = /^([A-G][#b]?)(maj7|m7b5|m7|dim|m|7)?$/.exec(symbol);
  if (!match) throw new Error(`bad chord ${symbol}`);
  const root = pc(match[1]!);
  return QUALITY[match[2] ?? ""]!.map((step) => mod12(root + step));
}

/**
 * Do `symbols` appear in order over `windowBeats`-long windows of
 * `tracks`? A window matches a chord when it holds every required tone and
 * at most `maxClasses` pitch classes (so a cluster of everything fails).
 */
export function progressionInOrder(
  score: TrackScore,
  tracks: readonly Track[],
  symbols: readonly string[],
  windowBeats = 2,
  maxClasses = 7,
): { ok: boolean; detail: string } {
  const required = symbols.map(chordTones);
  const total = loopBeats(score);
  const seen: string[] = [];
  let next = 0;
  for (let from = 0; from < total - EPS; from += windowBeats) {
    const pcs = pitchClassesIn(score, tracks, from, from + windowBeats);
    if (pcs.size === 0 || pcs.size > maxClasses) continue;
    const hit = required.findIndex((tones) => tones.every((t) => pcs.has(t)));
    if (hit >= 0) seen.push(symbols[hit]!);
    if (next < required.length && required[next]!.every((t) => pcs.has(t)))
      next += 1;
  }
  return {
    ok: next === required.length,
    detail: `matched ${next}/${required.length}; windows: ${seen.join(" ") || "none"}`,
  };
}

/** Pitch classes of a scale: `scale("E", [0,3,5,7,10])`. */
export const scale = (tonic: string, steps: readonly number[]) =>
  new Set(steps.map((step) => mod12(pc(tonic) + step)));

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
export const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/** Fraction of `notes` whose pitch class is in `set`. */
export function inScale(notes: readonly Note[], set: Set<number>): number {
  if (notes.length === 0) return 0;
  return (
    notes.filter((note) => set.has(mod12(note.pitch))).length / notes.length
  );
}

/** Note shape without ids, for "nothing else changed" checks. */
export function shape(score: TrackScore, trackId: string): string {
  return notesOf(score, trackId)
    .map(
      (note) =>
        `${note.pitch}@${note.startTick}+${note.durationTicks}v${round(note.velocity)}`,
    )
    .join(" ");
}

/** Every track of `initial` other than `except` kept its notes and mix. */
export function othersUnchanged(
  ctx: GradeContext,
  except: readonly string[],
): Check {
  const changed = ctx.initial.tracks
    .filter((track) => !except.includes(track.id))
    .filter((track) => {
      const now = trackById(ctx.score, track.id);
      return (
        !now ||
        shape(ctx.initial, track.id) !== shape(ctx.score, track.id) ||
        now.muted !== track.muted ||
        now.volume !== track.volume ||
        now.instrument !== track.instrument
      );
    })
    .map((track) => track.id);
  return check(
    "other tracks unchanged",
    changed.length === 0,
    changed.length ? `changed: ${changed.join(", ")}` : undefined,
  );
}

/** The model used a workspace write (write_file or edit_file) that applied. */
export function usedFiles(ctx: GradeContext): Check {
  const ok = ctx.calls.some(
    (call) =>
      (call.name === "write_file" || call.name === "edit_file") &&
      call.outcome !== "rejected",
  );
  return check("edited the project files", ok);
}

export function filesEvaluate(ctx: GradeContext): Check {
  return check("project files evaluate", ctx.files.ok, ctx.files.detail);
}

/** The single new track (by id) added to the score, if exactly one. */
export function newTracks(ctx: GradeContext): readonly Track[] {
  const before = new Set(ctx.initial.tracks.map((track) => track.id));
  return ctx.score.tracks.filter((track) => !before.has(track.id));
}

/** Intervals between successive notes of a monophonic line. */
export function leaps(notes: readonly Note[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i += 1)
    out.push(Math.abs(notes[i]!.pitch - notes[i - 1]!.pitch));
  return out;
}

/** The lowest note starting at each distinct onset (a line's top-down view). */
export function lowestPerOnset(
  score: TrackScore,
  notes: readonly Note[],
): Note[] {
  const byStart = new Map<number, Note>();
  for (const note of notes) {
    const current = byStart.get(note.startTick);
    if (!current || note.pitch < current.pitch)
      byStart.set(note.startTick, note);
  }
  return [...byStart.values()].sort((a, b) => a.startTick - b.startTick);
}

/** Filter-cutoff points of a track as `[beat, value]`. */
export function filterRamp(
  score: TrackScore,
  track: Track,
): Array<[number, number]> {
  return (track.filterAutomation ?? []).map((point) => [
    point.tick / score.ticksPerBeat,
    point.value,
  ]);
}
