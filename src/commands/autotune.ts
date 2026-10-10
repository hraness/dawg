/**
 * The `autotune` prompt command (0.7): pitch correction on the focused
 * track's clips and sampler voices (core/autotune.ts). `/vocal autotune`
 * is the same command; the menu and the `autotune_vocal` agent tool build
 * the same edits through `nextAutotune`.
 *
 *   autotune                         pop on the focused track (or show it)
 *   autotune <preset>                hard robot warble trap pop natural
 *                                    gentle guided locked
 *   autotune <preset> <field> <v>…   a preset with overrides
 *   autotune speed 35 relax 0.4      fields (base pop)
 *   autotune to chord                follow the chords
 *   autotune to notes melody         note-guided from another track
 *   autotune key D bayati            a key for the scale target
 *   autotune voice alto              the tracking range
 *   autotune <field> off             back to the preset's value
 *   autotune reset                   keep only the preset
 *   autotune off                     remove autotune
 *   autotune presets                 the presets with one-line characters
 *
 * `/tune` stays the alias of `/tuning`: `/tune hard` explains the
 * difference and points here. One `updateTrack` revision per command.
 */
import {
  AUTOTUNE_FIELDS,
  AUTOTUNE_PARAMS,
  AUTOTUNE_PRESET_HELP,
  AUTOTUNE_PRESETS,
  AUTOTUNE_TARGETS,
  AUTOTUNE_VOICES,
  describeAutotune,
  isAutotunePreset,
  normalizeAutotune,
  resolveAutotune,
  type AutotunePreset,
  type TrackAutotune,
} from "../../core/autotune.ts";
import { parseKey } from "../../core/chords.ts";
import { FxValidationError } from "../../core/params.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import { autotuneEngineNote, hasGuideNotes } from "../audio/autotune.ts";
import { nearest } from "./nearest.ts";

/** A field value from a command: `null` returns it to the preset's value. */
export type AutotuneValue = number | string | null;

export type AutotuneCommand =
  | { type: "autotune-show" }
  | { type: "autotune-list" }
  | { type: "autotune-reset" }
  | { type: "autotune-off" }
  | { type: "autotune-usage"; message: string }
  | {
      type: "autotune-set";
      preset?: AutotunePreset;
      values: Readonly<Partial<Record<keyof TrackAutotune, AutotuneValue>>>;
    };

export const AUTOTUNE_USAGE =
  "autotune [preset] [field value …] | autotune to scale|chromatic|chord|notes [track] | autotune key <key> | autotune off | autotune presets";

/** Fields the command takes, in type order (`preset` is a leading word). */
const FIELD_WORDS = AUTOTUNE_FIELDS.filter((field) => field !== "preset");

/** Short spellings people type. */
const FIELD_ALIASES: Readonly<Record<string, keyof TrackAutotune>> = {
  target: "to",
  rate: "vib",
  depth: "vibmod",
  mix: "amount",
  retune: "speed",
};

function fieldName(word: string): keyof TrackAutotune | undefined {
  if ((FIELD_WORDS as readonly string[]).includes(word))
    return word as keyof TrackAutotune;
  return FIELD_ALIASES[word];
}

function rangeOf(name: keyof TrackAutotune): string {
  const spec = AUTOTUNE_PARAMS.find((param) => param.name === name);
  if (name === "glide" && spec)
    return `glide is 0..${spec.max * 1000} ms (glide 40 or 40ms)`;
  if (spec)
    return `${name} is ${spec.min}..${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`;
  if (name === "to") return `to is one of ${AUTOTUNE_TARGETS.join(" ")}`;
  if (name === "voice") return `voice is one of ${AUTOTUNE_VOICES.join(" ")}`;
  return `${name} needs a value`;
}

const OFF = /^(off|unset|default)$/;

/** Fields in time units: speed and hold store ms, glide stores seconds. */
const TIME_FIELDS: Readonly<Partial<Record<keyof TrackAutotune, number>>> = {
  speed: 1,
  hold: 1,
  glide: 0.001,
};

/** Suffixes each numeric field takes besides a bare number. */
const UNIT_SUFFIX: Readonly<Partial<Record<keyof TrackAutotune, RegExp>>> = {
  vib: /^hz$/,
  vibmod: /^st$/,
};

/**
 * A field's number, or the message why not. Time fields read like /glide:
 * a bare number is ms, `ms` and `s` convert (`glide 40`, `speed 0.2s`),
 * and a bare fraction of a millisecond is a unit slip. `%` scales 0..1
 * fields. A suffix that does not fit the field is refused.
 */
function fieldNumber(
  name: keyof TrackAutotune,
  value: string,
): number | string {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/.exec(value);
  if (!match) return rangeOf(name);
  const number = Number(match[1]);
  const suffix = match[2]!;
  const toUnit = TIME_FIELDS[name];
  if (toUnit !== undefined) {
    if (suffix === "ms") return number * toUnit;
    if (suffix === "s") return number * 1000 * toUnit;
    if (suffix !== "")
      return `${name} takes ms or s, not ${suffix.slice(0, 4)}`;
    if (number > 0 && number < 1)
      return `${name} · a bare number is ms · write ${name} ${Math.round(number * 1000)}ms or ${name} ${match[1]}s`;
    const spec = AUTOTUNE_PARAMS.find((param) => param.name === name);
    if (spec && (number * toUnit < spec.min || number * toUnit > spec.max))
      return rangeOf(name);
    return number * toUnit;
  }
  if (suffix === "") return number;
  if (suffix === "%") {
    const spec = AUTOTUNE_PARAMS.find((param) => param.name === name);
    if (spec && spec.max === 1) return number / 100;
    if (spec && spec.max === 100) return number;
  }
  if (UNIT_SUFFIX[name]?.test(suffix)) return number;
  return `${name} takes no ${suffix.slice(0, 4)} · ${rangeOf(name)}`;
}

/** Parses `/autotune …`, `/vocal autotune …` args, and `/tune <preset>`. */
export function parseAutotuneCommand(
  prompt: string,
): AutotuneCommand | undefined {
  if (prompt.length > 512) return undefined;
  const raw = prompt.trim().replace(/^\//, "").split(/\s+/);
  const verb = raw[0]?.toLowerCase();
  // `/tune hard`: `/tune` is `/tuning`; an autotune word gets a pointer.
  if (verb === "tune") {
    const next = raw[1]?.toLowerCase();
    return raw.length >= 2 && (isAutotunePreset(next) || next === "autotune")
      ? {
          type: "autotune-usage",
          message:
            `/tune sets the tuning (edo, ratios, scl) · for pitch correction use /autotune ${isAutotunePreset(next) ? next : ""}`.trimEnd(),
        }
      : undefined;
  }
  if (verb !== "autotune") return undefined;
  return parseAutotuneArgs(raw.slice(1));
}

/** The words after `autotune` (also `/vocal autotune <args>`). */
export function parseAutotuneArgs(raw: readonly string[]): AutotuneCommand {
  const words = raw.filter((word) => word.length > 0);
  const lower = words.map((word) => word.toLowerCase());
  if (lower.length === 0) return { type: "autotune-show" };
  if (lower.length === 1) {
    const only = lower[0]!;
    if (only === "off" || only === "none" || only === "remove")
      return { type: "autotune-off" };
    if (only === "reset") return { type: "autotune-reset" };
    if (only === "list" || only === "presets") return { type: "autotune-list" };
    if (only === "on") return { type: "autotune-set", values: {} };
  }
  let index = 0;
  let preset: AutotunePreset | undefined;
  if (lower[0] === "preset") {
    if (!isAutotunePreset(lower[1]))
      return {
        type: "autotune-usage",
        message: `preset is one of ${AUTOTUNE_PRESETS.join(" ")}`,
      };
    preset = lower[1];
    index = 2;
  } else if (isAutotunePreset(lower[0])) {
    preset = lower[0];
    index = 1;
  }
  const values: Partial<Record<keyof TrackAutotune, AutotuneValue>> = {};
  while (index < lower.length) {
    const word = lower[index]!;
    const name = fieldName(word);
    if (!name && isAutotunePreset(word))
      return {
        type: "autotune-usage",
        message: preset
          ? `one preset at a time (${preset} or ${word})`
          : `the preset comes first · autotune ${word} …`,
      };
    if (!name) {
      const near = nearest(word.slice(0, 24), [
        ...FIELD_WORDS,
        ...AUTOTUNE_PRESETS,
      ]);
      return {
        type: "autotune-usage",
        message: `no field or preset ${word.slice(0, 24)}${near ? ` · did you mean ${near}?` : ""} · ${AUTOTUNE_USAGE}`,
      };
    }
    index += 1;
    const value = lower[index];
    if (value === undefined)
      return { type: "autotune-usage", message: rangeOf(name) };
    if (OFF.test(value)) {
      values[name] = null;
      index += 1;
      continue;
    }
    if (name === "to") {
      const target = value === "melody" || value === "note" ? "notes" : value;
      if (!(AUTOTUNE_TARGETS as readonly string[]).includes(target))
        return { type: "autotune-usage", message: rangeOf(name) };
      values.to = target;
      index += 1;
      // `to notes melody`: a track id (anything that is not a field word).
      const from = words[index];
      if (
        target === "notes" &&
        from !== undefined &&
        !fieldName(from.toLowerCase())
      ) {
        values.from = from;
        index += 1;
      }
      continue;
    }
    if (name === "from") {
      values.from = words[index]!;
      index += 1;
      continue;
    }
    if (name === "voice") {
      if (!(AUTOTUNE_VOICES as readonly string[]).includes(value))
        return { type: "autotune-usage", message: rangeOf(name) };
      values.voice = value;
      index += 1;
      continue;
    }
    if (name === "key") {
      // `key D bayati`, `key A minor`: words up to the next field word.
      const parts: string[] = [];
      while (index < words.length && !fieldName(lower[index]!)) {
        parts.push(words[index]!);
        index += 1;
      }
      const text = parts.join(" ");
      if (!parseKey(text))
        return {
          type: "autotune-usage",
          message: `key ${text.slice(0, 32)} is not a key (A minor, D bayati, C# major)`,
        };
      values.key = text;
      continue;
    }
    const number = fieldNumber(name, value);
    if (typeof number === "string")
      return { type: "autotune-usage", message: number };
    values[name] = number;
    index += 1;
  }
  return preset
    ? { type: "autotune-set", preset, values }
    : { type: "autotune-set", values };
}

/** One line per preset, for `autotune presets` and the agent brief. */
export function autotuneListLines(): string[] {
  return AUTOTUNE_PRESETS.map(
    (name) => `${name.padEnd(8)} ${AUTOTUNE_PRESET_HELP[name]}`,
  );
}

/**
 * The autotune field a command leaves on a track (pure; the menu and the
 * agent tool share it). A preset switch keeps the overrides; `reset`
 * keeps only the preset; a bare `autotune` on a track without it is pop.
 */
export function nextAutotune(
  current: TrackAutotune | undefined,
  command: Extract<
    AutotuneCommand,
    { type: "autotune-reset" | "autotune-set" }
  >,
  instrument?: string,
): TrackAutotune {
  if (command.type === "autotune-reset")
    return normalizeAutotune({ preset: current?.preset ?? "pop" }, instrument)!;
  const base: Record<string, unknown> = { ...current };
  if (command.preset) base.preset = command.preset;
  for (const [key, value] of Object.entries(command.values)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  // A target other than notes drops a stale `from`.
  if (base.to !== undefined && base.to !== "notes") delete base.from;
  if (Object.keys(base).length === 0) base.preset = "pop";
  return normalizeAutotune(base, instrument)!;
}

/** `· no guide notes · try autotune guided from lead`. */
function noGuideHint(
  score: TrackScore,
  trackId: string,
  preset: string | undefined,
): string {
  const melodic = score.tracks
    .filter(
      (other) =>
        other.id !== trackId &&
        other.instrument !== "kit" &&
        other.kit === undefined &&
        hasGuideNotes(score, other.id),
    )
    .map((other) => other.id)
    .slice(0, 4);
  const word = preset ?? "guided";
  return melodic.length > 0
    ? ` · no guide notes on ${trackId} · try autotune ${word} from ${melodic[0]}${melodic.length > 1 ? ` (or ${melodic.slice(1).join(", ")})` : ""}`
    : ` · no guide notes on ${trackId} · write notes on it or autotune ${word} from <track>`;
}

export type AutotuneResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

export function applyAutotuneCommand(
  score: TrackScore,
  trackId: string,
  command: AutotuneCommand,
): AutotuneResult {
  if (command.type === "autotune-usage")
    return { ok: false, message: `autotune · ${command.message}` };
  if (command.type === "autotune-list")
    return {
      ok: true,
      message: `autotune presets · ${AUTOTUNE_PRESETS.join(" ")}`,
    };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const current = track.autotune;
  if (command.type === "autotune-show" && current)
    return { ok: true, message: `autotune · ${describeAutotune(current)}` };
  if (command.type === "autotune-off") {
    if (!current) return { ok: true, message: "autotune · already off" };
    const next = updateTrack(score, trackId, { autotune: null });
    return {
      ok: true,
      message: `autotune · off · /autotune ${current.preset ?? "pop"} turns it back on`,
      next,
      kind: "score.autotune",
      payload: { trackId, autotune: null },
    };
  }
  let autotune: TrackAutotune;
  let next: TrackScore;
  try {
    autotune = nextAutotune(
      current,
      command.type === "autotune-show"
        ? { type: "autotune-set", values: {} }
        : command,
      track.instrument,
    );
    next = updateTrack(score, trackId, { autotune });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return {
        ok: false,
        message: `autotune · ${error.message.replace(/^autotune: /, "")}`,
      };
    throw error;
  }
  const inert =
    !track.sampler && track.clips === undefined
      ? ` · ${trackId} has no audio yet (it tunes clips and sampler voices)`
      : "";
  const keyHint =
    (autotune.to ?? "scale") === "scale" &&
    autotune.key === undefined &&
    !score.key &&
    !(autotune.preset === "guided" || autotune.preset === "locked")
      ? " · no song key, so chromatic (/scale or autotune key …)"
      : "";
  const guide =
    resolveAutotune(autotune).to === "notes" &&
    autotune.from === undefined &&
    !hasGuideNotes(score, trackId)
      ? noGuideHint(score, trackId, autotune.preset)
      : "";
  return {
    ok: true,
    message: `autotune · ${describeAutotune(autotune)}${keyHint}${guide}${inert}${autotuneEngineNote()}`,
    next,
    kind: "score.autotune",
    payload: { trackId, autotune },
  };
}
