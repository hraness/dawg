/**
 * Prompt grammar for generated rhythm rows (`core/euclid.ts`). Every
 * command is one next score, so one revision and one undo step; the
 * Euclidean editor (`src/tui/euclid.ts`) emits these same lines.
 *
 *   euclid <voice> <pulses> [<steps>] [<field> <value> ...]
 *   euclid <voice> <field> <value> [<field> <value> ...]
 *   euclid <voice> off | freeze           remove the row (freeze keeps notes)
 *   grid <voice> <steps>                  explicit steps: x hit, X accent, . rest
 *
 * Fields: steps, pulses, rotate (rot), division (div), repeats (rep), time,
 * pace, ramp, velocity (vel), accent, accents, gate, legato on|off,
 * probability (prob), seed, swing, nudge. `default` resets a field. Named
 * fields merge into the voice's existing row, so `euclid hat rotate 2`
 * only rotates.
 */
import {
  RHYTHM_DEFAULTS,
  canonicalDivision,
  normalizeRhythmRow,
  rowSummary,
  type RhythmRow,
} from "../../core/euclid.ts";
import {
  removeRhythmRow,
  rhythmVoicePitch,
  setRhythmRow,
} from "../../core/rhythm.ts";
import { ScoreValidationError, type TrackScore } from "../../core/score.ts";

export type RhythmCommand =
  | Readonly<{
      type: "rhythm-set";
      voice: string;
      /** Field values to merge; `null` resets a field to its default. */
      fields: Readonly<Record<string, number | string | boolean | null>>;
    }>
  | Readonly<{ type: "rhythm-remove"; voice: string; keepNotes: boolean }>;

const FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  steps: "steps",
  pulses: "pulses",
  hits: "pulses",
  rotate: "rotate",
  rot: "rotate",
  division: "division",
  div: "division",
  repeats: "repeats",
  rep: "repeats",
  time: "time",
  pace: "pace",
  ramp: "ramp",
  velocity: "velocity",
  vel: "velocity",
  accent: "accent",
  accents: "accents",
  gate: "gate",
  sustain: "gate",
  legato: "legato",
  probability: "probability",
  prob: "probability",
  seed: "seed",
  swing: "swing",
  nudge: "nudge",
  grid: "grid",
});

const DIVISION_FIELDS = new Set(["division", "time"]);
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const VOICE = /^[A-Za-z0-9#_-]{1,32}$/;

/** Parses one rhythm command, or undefined when `prompt` is not one. */
export function parseRhythmCommand(prompt: string): RhythmCommand | undefined {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (text.length > 512) return undefined;
  const grid = text.match(/^grid ([A-Za-z0-9#_-]{1,32}) ([xX.\-]{1,64})$/i);
  if (grid)
    return {
      type: "rhythm-set",
      voice: grid[1]!.toLowerCase(),
      fields: { grid: grid[2]! },
    };
  const head = text.match(/^euclid ([A-Za-z0-9#_-]{1,32})(?: (.*))?$/i);
  if (!head) return undefined;
  const voice = head[1]!;
  if (!VOICE.test(voice)) return undefined;
  const tokens = (head[2] ?? "").split(" ").filter((token) => token !== "");
  if (tokens.length === 1 && /^(off|clear|remove)$/i.test(tokens[0]!))
    return { type: "rhythm-remove", voice: lowerDrum(voice), keepNotes: false };
  if (tokens.length === 1 && /^freeze$/i.test(tokens[0]!))
    return { type: "rhythm-remove", voice: lowerDrum(voice), keepNotes: true };
  const fields: Record<string, number | string | boolean | null> = {};
  let index = 0;
  if (tokens[index] !== undefined && /^\d+$/.test(tokens[index]!)) {
    fields.pulses = Number(tokens[index]);
    index += 1;
    if (tokens[index] !== undefined && /^\d+$/.test(tokens[index]!)) {
      fields.steps = Number(tokens[index]);
      index += 1;
    }
  }
  while (index < tokens.length) {
    const key = FIELD_ALIASES[tokens[index]!.toLowerCase()];
    const raw = tokens[index + 1];
    if (!key || raw === undefined) return undefined;
    index += 2;
    if (/^default$/i.test(raw)) fields[key] = null;
    else if (key === "legato") {
      if (!/^(on|off|true|false)$/i.test(raw)) return undefined;
      fields[key] = /^(on|true)$/i.test(raw);
    } else if (DIVISION_FIELDS.has(key)) {
      const division = canonicalDivision(raw);
      if (!division) return undefined;
      fields[key] = division;
    } else if (key === "grid") {
      if (!/^[xX.\-]{1,64}$/.test(raw)) return undefined;
      fields[key] = raw;
    } else {
      if (!NUMBER.test(raw)) return undefined;
      fields[key] = Number(raw);
    }
  }
  // `euclid hat` alone names a row to edit: the window opens the editor on
  // it (`/euclid hat`), so it is not an empty edit here.
  if (Object.keys(fields).length === 0) return undefined;
  return { type: "rhythm-set", voice: lowerDrum(voice), fields };
}

/** Pitch voices keep their case (`C#2`); drum and sampler names are lower-case. */
function lowerDrum(voice: string): string {
  return /^[A-Ga-g][#b]?-?\d$/.test(voice) ? voice : voice.toLowerCase();
}

export type RhythmResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/**
 * The row `command` produces from `current` (the voice's existing row, if
 * any). Throws `Error` naming the field when the result is invalid.
 */
export function mergeRhythmRow(
  current: RhythmRow | undefined,
  voice: string,
  fields: Readonly<Record<string, number | string | boolean | null>>,
): RhythmRow {
  const merged: Record<string, unknown> = { ...(current ?? { voice }) };
  merged.voice = voice;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  // Naming pulses or steps switches a grid row back to a Euclidean one.
  if ("pulses" in fields || "steps" in fields)
    if (!("grid" in fields)) delete merged.grid;
  if ("grid" in fields && fields.grid !== null) {
    delete merged.steps;
    delete merged.pulses;
    delete merged.rotate;
  }
  // Keep pulses inside a shortened row instead of rejecting the edit.
  if (merged.grid === undefined) {
    const steps =
      typeof merged.steps === "number" ? merged.steps : RHYTHM_DEFAULTS.steps;
    const pulses =
      typeof merged.pulses === "number"
        ? merged.pulses
        : RHYTHM_DEFAULTS.pulses;
    if (!("pulses" in fields) && pulses > steps) merged.pulses = steps;
  }
  return normalizeRhythmRow(merged, voice);
}

/** Applies `command` to `trackId`; one next score, one session event. */
export function applyRhythmCommand(
  score: TrackScore,
  trackId: string,
  command: RhythmCommand,
): RhythmResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const existing = (track.rhythm ?? []).find(
    (row) => row.voice === command.voice,
  );
  if (command.type === "rhythm-remove") {
    if (!existing)
      return { ok: false, message: `no ${command.voice} row on ${trackId}` };
    return {
      ok: true,
      message: `euclid · ${command.voice} ${command.keepNotes ? "frozen" : "off"}`,
      next: removeRhythmRow(score, trackId, command.voice, command.keepNotes),
      kind: "score.rhythm",
      payload: {
        trackId,
        voice: command.voice,
        remove: true,
        keepNotes: command.keepNotes,
      },
    };
  }
  if (rhythmVoicePitch(track, command.voice) === undefined)
    return {
      ok: false,
      message: `${command.voice} is not a voice on ${trackId} · try instrument kit`,
    };
  let row: RhythmRow;
  try {
    row = mergeRhythmRow(existing, command.voice, command.fields);
  } catch (error) {
    return {
      ok: false,
      message: `euclid · ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    const next = setRhythmRow(score, trackId, row);
    return {
      ok: true,
      message: `euclid · ${row.voice} ${rowSummary(row)}`,
      next,
      kind: "score.rhythm",
      payload: { trackId, row },
    };
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return { ok: false, message: `euclid · ${error.message}` };
    throw error;
  }
}
