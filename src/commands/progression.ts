/**
 * `progression …`: sustained, voice-led block chords on the focused track,
 * the prompt form of the SDK's `progression()` and the agent's write_chords.
 *
 *   progression i7 IV7 i7 IV7 each 8     roman numerals in the song key
 *   progression Am7 D9 at 16 bass        chord symbols, a root under each
 *
 * Chords run core/chords.ts renderProgression in `block` mode with voice
 * leading, so a carrier for a vocoder or talkbox holds each chord for its
 * whole span. Existing notes stay; chords past the end grow the song.
 */
import {
  chordName,
  keyUsesFlats,
  parseKey,
  renderProgression,
  resolveChord,
  type Chord,
  type Key,
} from "../../core/chords.ts";
import { applyScoreOperations } from "../../core/diff.ts";
import {
  SCORE_LIMITS,
  ScoreValidationError,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { barTicks } from "../../core/sections.ts";
import { resolveTuning, snapToTuning } from "../../core/tuning.ts";
import type { CommandResult } from "./strum.ts";

export const PROGRESSION_USAGE =
  "progression <chords> [each <beats>] [at <beat>] [bass] · progression i7 IV7 each 8 · progression Am7 D9 bass";

export type ProgressionOptions = Readonly<{
  chords: readonly string[];
  each?: number;
  at?: number;
  bass?: boolean;
}>;

export type ProgressionCommand =
  | Readonly<{ type: "progression"; options: ProgressionOptions }>
  | Readonly<{ type: "progression-hint"; message: string }>;

/** `progression …`, or undefined when the prompt is not one. */
export function parseProgressionCommand(
  prompt: string,
): ProgressionCommand | undefined {
  if (prompt.length > 1_024) return undefined;
  const words = prompt.trim().replace(/^\//, "").split(/\s+/);
  const head = words[0]?.toLowerCase();
  if (head !== "progression" && head !== "prog") return undefined;
  const chords: string[] = [];
  let each: number | undefined;
  let at: number | undefined;
  let bass = false;
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i]!;
    const lower = word.toLowerCase();
    if (lower === "each" || lower === "at") {
      const value = Number(words[i + 1]);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (lower === "each" && value <= 0)
      )
        return { type: "progression-hint", message: PROGRESSION_USAGE };
      if (lower === "each") each = value;
      else at = value;
      i += 1;
    } else if (lower === "bass") bass = true;
    else chords.push(word);
  }
  if (chords.length === 0)
    return { type: "progression-hint", message: PROGRESSION_USAGE };
  if (chords.length > 64)
    return {
      type: "progression-hint",
      message: "progression takes up to 64 chords",
    };
  return {
    type: "progression",
    options: {
      chords,
      ...(each !== undefined ? { each } : {}),
      ...(at !== undefined ? { at } : {}),
      ...(bass ? { bass } : {}),
    },
  };
}

/** Writes a progression command's chords onto `trackId`. */
export function applyProgressionCommand(
  score: TrackScore,
  trackId: string,
  command: ProgressionCommand,
  newId: (index: number) => string,
): CommandResult {
  if (command.type === "progression-hint")
    return { ok: false, message: command.message };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const { options } = command;
  const key: Key = parseKey(score.key) ?? { tonic: 0, mode: "major" };
  const chords: Chord[] = [];
  for (const text of options.chords) {
    const chord = resolveChord(key, text);
    if (!chord)
      return {
        ok: false,
        message: `unknown chord ${JSON.stringify(text.slice(0, 32))} (a symbol like Am7 or a numeral like ii7)`,
      };
    chords.push(chord);
  }
  const each = options.each ?? score.beatsPerBar;
  const rendered = renderProgression({
    key,
    chords,
    beatsPerChord: each,
    start: options.at ?? 0,
    bass: options.bass === true,
    lead: true,
    perform: { mode: "block" },
  });
  const performed = [...rendered.notes, ...rendered.bass];
  if (performed.length > 4096)
    return { ok: false, message: "progression would write over 4096 notes" };
  const tpb = score.ticksPerBeat;
  const table = resolveTuning(score.tuning, track.tuning, score.key);
  const operations: ScoreOperation[] = performed.map((note, index) => ({
    type: "addNote",
    note: {
      id: newId(index),
      trackId,
      startTick: Math.round(note.start * tpb),
      durationTicks: Math.max(1, Math.round(note.length * tpb)),
      pitch: snapToTuning(note.pitch, table),
      velocity: note.velocity,
    },
  }));
  let next: TrackScore;
  try {
    next = applyScoreOperations(score, operations);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return { ok: false, message: `progression · ${error.message}` };
    throw error;
  }
  const end = next.notes.reduce(
    (max, note) => Math.max(max, note.startTick + note.durationTicks),
    0,
  );
  const needed = Math.min(
    SCORE_LIMITS.maxBars,
    Math.ceil(end / barTicks(next)),
  );
  const grew = needed > next.bars;
  if (grew)
    next = applyScoreOperations(next, [{ type: "setBars", bars: needed }]);
  const flats = keyUsesFlats(key);
  const names = chords.map((chord) => chordName(chord, flats));
  return {
    ok: true,
    message: `progression · ${names.join(" ")} · ${each} beats each · ${performed.length} notes${grew ? ` · song now ${needed} bars` : ""}`,
    next,
    kind: "score.notes",
    payload: { trackId, progression: names },
  };
}
