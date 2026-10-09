/**
 * The `wind` prompt command (0.6.1): blown waveguides on the focused track
 * (core/winds.ts). The menu and the `set_wind` agent tool build the same
 * edits.
 *
 *   wind                               show the track's preset and overrides
 *   wind <preset>                      play a preset: flute recorder whistle
 *                                      ney shakuhachi panpipe suling bansuri
 *                                      clarinet bassclarinet oboe bassoon sax
 *                                      altosax barisax trumpet harmon plunger
 *                                      trombone tuba horn (and aliases such
 *                                      as saxophone frenchhorn panflute)
 *   wind <preset> <param> <value>…     a preset with overrides
 *   wind preset <name>                 the same, spelled out
 *   wind mute <open|straight|cup|harmon|plunger>
 *   wind <param> <value> [<param> <value>…]   breath 0.8, players 4 …
 *   wind <param> off                   back to the preset's value
 *   wind reset                         clear overrides (keep the preset)
 *   wind off                           back to the legacy wind tone
 *   wind list | presets wind           the presets with one-line characters
 *
 * Any edit turns the track into a wind-engine track (`instrument "wind"`
 * plus a `wind` field); a stored `wind` with no field keeps the legacy tone.
 * One `updateTrack` revision and one undo step per command.
 */
import { FxValidationError } from "../../core/params.ts";
import {
  DEFAULT_WIND_PRESET,
  normalizeWind,
  WIND_INSTRUMENT,
  WIND_PARAMS,
  WIND_PRESETS,
  WIND_PRESET_NAMES,
  WIND_SIMPLE,
  windParamName,
  windPresetFor,
  type TrackWind,
} from "../../core/resonators.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import { nearestWord } from "../audio/instrument-check.ts";
import { parseParamValue } from "./fx.ts";

export type WindCommand =
  | { type: "wind-show" }
  | { type: "wind-list" }
  | { type: "wind-reset" }
  | { type: "wind-off" }
  | { type: "wind-preset"; preset: string }
  | { type: "wind-usage"; message: string }
  | {
      type: "wind-set";
      /** A preset applied before the values (`wind trumpet mute harmon`). */
      preset?: string;
      /** `null` returns a parameter to the preset's value. */
      values: Readonly<Record<string, number | string | boolean | null>>;
    };

export const WIND_USAGE =
  "wind <preset> | wind <param> <value> | wind mute <name> | wind reset | wind off | wind presets";

function rangeOf(name: string): string {
  const spec = WIND_PARAMS[name]!;
  if (spec.kind === "number") return `${name} is ${spec.min}..${spec.max}`;
  if (spec.kind === "enum") return `${name} is one of ${spec.values.join(" ")}`;
  return `${name} is on or off`;
}

export function parseWindCommand(prompt: string): WindCommand | undefined {
  const words = prompt.trim().toLowerCase().split(/\s+/);
  if (words[0] === "presets" && words[1] === "wind" && words.length === 2)
    return { type: "wind-list" };
  if (words[0] !== "wind") return undefined;
  if (words.length === 1) return { type: "wind-show" };
  if (prompt.length > 512) return undefined;
  const rest = words.slice(1);
  if (rest.length === 1 && rest[0] === "reset") return { type: "wind-reset" };
  if (rest.length === 1 && rest[0] === "off") return { type: "wind-off" };
  if (rest.length === 1 && (rest[0] === "list" || rest[0] === "presets"))
    return { type: "wind-list" };
  if (rest[0] === "preset") {
    const preset = rest.length === 2 ? windPresetFor(rest[1]!) : undefined;
    return preset
      ? { type: "wind-preset", preset }
      : {
          type: "wind-usage",
          message: `wind preset is one of ${WIND_PRESET_NAMES.join(" ")}`,
        };
  }
  if (rest.length === 1) {
    const preset = windPresetFor(rest[0]!);
    if (preset) return { type: "wind-preset", preset };
    const mute = WIND_PARAMS.mute;
    if (mute?.kind === "enum" && mute.values.includes(rest[0]!))
      return { type: "wind-set", values: { mute: rest[0]! } };
    return { type: "wind-usage", message: WIND_USAGE };
  }
  // `wind <preset> <param> <value>…`: the preset, then its overrides.
  const lead = rest.length % 2 === 1 ? windPresetFor(rest[0]!) : undefined;
  if (lead) rest.shift();
  if (rest.length % 2 !== 0) return { type: "wind-usage", message: WIND_USAGE };
  const values: Record<string, number | string | boolean | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = windParamName(rest[index]!);
    if (!name) {
      const word = rest[index]!.slice(0, 24);
      const near = nearestWord(word, Object.keys(WIND_PARAMS));
      return {
        type: "wind-usage",
        message: `wind has no parameter ${word}${near ? ` · did you mean ${near}?` : ""} · ${WIND_SIMPLE.join(" ")} …`,
      };
    }
    const word = rest[index + 1]!;
    if (word === "off" && name !== "stopped") {
      values[name] = null;
      continue;
    }
    if (word === "unset") {
      values[name] = null;
      continue;
    }
    const value = parseParamValue(WIND_PARAMS[name]!, word);
    if (value === undefined)
      return { type: "wind-usage", message: rangeOf(name) };
    values[name] = value;
  }
  return lead
    ? { type: "wind-set", preset: lead, values }
    : { type: "wind-set", values };
}

/** `preset sax · breath 0.8 · players 4`, overrides in canonical order. */
export function describeWind(wind: TrackWind | undefined): string {
  if (!wind) return "not a wind-engine track";
  const preset = wind.preset ?? DEFAULT_WIND_PRESET;
  const overrides = Object.entries(wind)
    .filter(([key]) => key !== "preset")
    .map(([key, value]) => `${key} ${value}`);
  return [`preset ${preset}`, ...overrides].join(" · ");
}

/** One line per preset, for `wind list` and the agent brief. */
export function windListLines(): string[] {
  return WIND_PRESET_NAMES.map(
    (name) => `${name.padEnd(13)} ${WIND_PRESETS[name].doc}`,
  );
}

export type WindResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/**
 * The wind field a command leaves on a track (pure; the agent tool shares
 * it). A preset switch keeps the overrides; `reset` keeps the preset.
 */
export function nextWind(
  current: TrackWind | undefined,
  command: Extract<
    WindCommand,
    { type: "wind-reset" | "wind-preset" | "wind-set" }
  >,
): TrackWind {
  if (command.type === "wind-reset")
    return normalizeWind(current?.preset ? { preset: current.preset } : {})!;
  const base: Record<string, unknown> = { ...current };
  if (command.type === "wind-preset") base.preset = command.preset;
  else {
    if (command.preset) base.preset = command.preset;
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
  }
  return normalizeWind(base)!;
}

export function applyWindCommand(
  score: TrackScore,
  trackId: string,
  command: WindCommand,
): WindResult {
  if (command.type === "wind-usage")
    return { ok: false, message: `wind · ${command.message}` };
  if (command.type === "wind-list")
    return {
      ok: true,
      message: `wind presets · ${WIND_PRESET_NAMES.join(" ")}`,
    };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const current = track.instrument === WIND_INSTRUMENT ? track.wind : undefined;
  if (command.type === "wind-show")
    return {
      ok: true,
      message: current
        ? `wind · ${describeWind(current)}`
        : `wind · ${trackId} plays ${track.instrument} · wind <preset> to switch (${WIND_PRESET_NAMES.join(" ")})`,
    };
  if (track.sampler || track.instrument === "kit")
    return {
      ok: false,
      message: `wind · ${trackId} is a ${track.sampler ? "sampler" : "drum"} track`,
    };
  if (command.type === "wind-off") {
    if (!current) return { ok: true, message: "wind · already off" };
    // The stored word stays `wind`, which is the legacy tone without a field.
    const next = updateTrack(score, trackId, { wind: null });
    return {
      ok: true,
      message: `wind · off (legacy wind tone) · wind ${current.preset ?? DEFAULT_WIND_PRESET} turns it back on`,
      next,
      kind: "score.wind",
      payload: { trackId, instrument: WIND_INSTRUMENT, wind: null },
    };
  }
  let wind: TrackWind;
  let next: TrackScore;
  try {
    wind = nextWind(current, command);
    next = updateTrack(score, trackId, { instrument: WIND_INSTRUMENT, wind });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `wind · ${error.message}` };
    throw error;
  }
  return {
    ok: true,
    message: `wind · ${describeWind(wind)}`,
    next,
    kind: "score.wind",
    payload: { trackId, instrument: WIND_INSTRUMENT, wind },
  };
}
