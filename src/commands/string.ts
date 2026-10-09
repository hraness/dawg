/**
 * The `string` prompt command: the focused track's plucked-string engine
 * (core/strings.ts, `Track.string`).
 *
 *   string                              list this track's preset and overrides
 *   string presets                      the plucked presets
 *   string <preset> | preset <name>     play a preset (instrument "string")
 *   string <param> <value> [<param> <value>…]   override parameters
 *   string <param> off                  back to the preset's value
 *   string reset                        drop the overrides, keep the preset
 *   string off                          back to the track's synth voice
 *
 * `string sitar`, `string buzz 0.8 sym 0.5`, `string ring 6`. Each command
 * is one `updateTrack` revision and one undo step.
 */
import { FxValidationError } from "../../core/params.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import {
  DEFAULT_STRING_PRESET,
  isStringTrack,
  normalizeString,
  STRING_INSTRUMENT,
  STRING_PARAMS,
  STRING_PRESET_NAMES,
  STRING_PRESETS,
  STRING_SIMPLE_PARAMS,
  stringParamName,
  stringPresetName,
  stringPresetOf,
  type TrackString,
} from "../../core/strings.ts";
import { parseParamValue } from "./fx.ts";

export type StringCommand =
  | { type: "string-list" }
  | { type: "string-presets" }
  | { type: "string-reset" }
  | { type: "string-off" }
  | { type: "string-preset"; preset: string }
  | {
      type: "string-set";
      /** `null` unsets a parameter (the preset's value again). */
      values: Readonly<Record<string, number | string | null>>;
    };

export function parseStringCommand(prompt: string): StringCommand | undefined {
  const words = prompt.trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== "string") return undefined;
  if (words.length === 1) return { type: "string-list" };
  if (prompt.length > 1_024) return undefined;
  const rest = words.slice(1).map((word) => word.toLowerCase());
  if (rest.length === 1) {
    if (rest[0] === "reset") return { type: "string-reset" };
    if (rest[0] === "off") return { type: "string-off" };
    if (rest[0] === "presets" || rest[0] === "list")
      return { type: "string-presets" };
    const preset = stringPresetName(rest[0]!);
    return preset ? { type: "string-preset", preset } : undefined;
  }
  if (rest[0] === "preset") {
    const preset = rest.length === 2 ? stringPresetName(rest[1]!) : undefined;
    return preset ? { type: "string-preset", preset } : undefined;
  }
  if (rest.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = stringParamName(rest[index]!);
    if (!name) return undefined;
    const word = rest[index + 1]!;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    const value = parseParamValue(STRING_PARAMS[name]!, word);
    if (value === undefined || typeof value === "boolean") return undefined;
    values[name] = value;
  }
  return { type: "string-set", values };
}

/** `sitar · buzz 0.8 · sym 0.5`, or `nylon` for a bare preset. */
export function describeString(settings: TrackString | undefined): string {
  const parts = [stringPresetOf(settings)];
  for (const [key, value] of Object.entries(settings ?? {}))
    if (key !== "preset" && value !== undefined) parts.push(`${key} ${value}`);
  return parts.join(" · ");
}

export type StringResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

export function applyStringCommand(
  score: TrackScore,
  trackId: string,
  command: StringCommand,
): StringResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "string-presets")
    return {
      ok: true,
      message: `string presets · ${STRING_PRESET_NAMES.map((name) => `${name} (${STRING_PRESETS[name]!.doc})`).join(" · ")}`,
    };
  if (track.sampler || track.kit)
    return {
      ok: false,
      message: `string · ${trackId} is a ${track.sampler ? "sampler" : "drum"} track; the string engine plays pitched notes`,
    };
  const active = isStringTrack(track);
  if (command.type === "string-list")
    return {
      ok: true,
      message: active
        ? `string · ${describeString(track.string)} · basics ${STRING_SIMPLE_PARAMS.join(" ")}`
        : `string · off (${track.instrument}) · string ${DEFAULT_STRING_PRESET} turns it on · string presets`,
    };
  let instrument = track.instrument;
  let string: Record<string, unknown> | null;
  if (command.type === "string-off") {
    if (!active) return { ok: true, message: "string · already off" };
    instrument = "pluck";
    string = null;
  } else if (command.type === "string-reset") {
    if (!active) return { ok: true, message: "string · already off" };
    string = { preset: stringPresetOf(track.string) };
  } else if (command.type === "string-preset") {
    instrument = STRING_INSTRUMENT;
    string = { preset: command.preset };
  } else {
    instrument = STRING_INSTRUMENT;
    string = active ? { ...track.string } : { preset: DEFAULT_STRING_PRESET };
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete string[key];
      else string[key] = value;
    }
  }
  let next: TrackScore;
  try {
    next = updateTrack(score, trackId, {
      instrument,
      string: string === null ? null : (normalizeString(string) ?? null),
    });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `string · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((candidate) => candidate.id === trackId);
  return {
    ok: true,
    message:
      command.type === "string-off"
        ? `string · off · ${instrument}`
        : `string · ${describeString(stored?.string)}`,
    next,
    kind: "score.string",
    payload: {
      trackId,
      instrument: stored?.instrument ?? instrument,
      string: stored?.string ?? null,
    },
  };
}
