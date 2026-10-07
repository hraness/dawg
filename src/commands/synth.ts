/**
 * The `synth` prompt command: the focused track's synth voice parameters
 * (core/synth.ts), named as in Strudel.
 *
 *   synth                               list the parameters this track sets
 *   synth preset <name>                 load a preset (instrument + params)
 *   synth <param> <value> [<param> <value>…]   set (Strudel aliases accepted)
 *   synth <param> off                   unset one parameter (back to default)
 *   synth partials 1 0.5 0.33           additive harmonics (also `phases`)
 *   synth reset                         unset every parameter
 *   synth zzfx 1,.05,220,,,.1,2         a raw ZzFX array (z_* sound + params)
 *
 * `synth lpf 800 lpenv 3 lpdecay 0.2`, `synth fm 4 fmh 1.5`, `synth adsr
 * 0.01 0.2 0.5 0.3` (Strudel's `adsr` shorthand). Each command is one
 * `updateTrack` revision and one undo step.
 */
import { FxValidationError } from "../../core/params.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import {
  SYNTH_PARAMS,
  SYNTH_PRESETS,
  SYNTH_SIMPLE,
  isSynthList,
  isSynthPreset,
  normalizeSynth,
  synthParamName,
  ZZFX_ARRAY_LAYOUT,
  zzfxArraySynth,
  type TrackSynth,
} from "../../core/synth.ts";
import { parseParamValue } from "./fx.ts";

export type SynthCommand =
  | { type: "synth-list" }
  | { type: "synth-reset" }
  | { type: "synth-preset"; preset: string }
  /** A raw ZzFX parameter array (Strudel `zzfx([...])`); empty slots null. */
  | { type: "synth-zzfx"; values: readonly (number | null)[] }
  | {
      type: "synth-set";
      /** `null` unsets a parameter. */
      values: Readonly<
        Record<string, number | string | boolean | readonly number[] | null>
      >;
    };

const ADSR = ["attack", "decay", "sustain", "release"] as const;

export function parseSynthCommand(prompt: string): SynthCommand | undefined {
  const words = prompt.trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== "synth") return undefined;
  if (words.length === 1) return { type: "synth-list" };
  if (prompt.length > 1_024) return undefined;
  const rest = words.slice(1).map((word) => word.toLowerCase());
  if (rest.length === 1 && (rest[0] === "reset" || rest[0] === "off"))
    return { type: "synth-reset" };
  if (rest[0] === "preset")
    return rest.length === 2 && isSynthPreset(rest[1]!)
      ? { type: "synth-preset", preset: rest[1]! }
      : undefined;
  const list = synthParamName(rest[0]!);
  if (list && isSynthList(list)) {
    if (rest.length === 2 && rest[1] === "off")
      return { type: "synth-set", values: { [list]: null } };
    const numbers = rest.slice(1).map(Number);
    if (numbers.length === 0 || numbers.some((n) => !Number.isFinite(n)))
      return undefined;
    return { type: "synth-set", values: { [list]: numbers } };
  }
  if (rest[0] === "zzfx") return zzfxCommand(words.slice(2).join(" "));
  if (rest[0] === "adsr") {
    // Strudel's `adsr("a:d:s:r")`, as four words or one colon string.
    const parts = rest.length === 2 ? rest[1]!.split(":") : rest.slice(1);
    if (parts.length !== 4) return undefined;
    const values: Record<string, number> = {};
    for (const [index, name] of ADSR.entries()) {
      const value = parseParamValue(SYNTH_PARAMS[name]!, parts[index]!);
      if (typeof value !== "number") return undefined;
      values[name] = value;
    }
    return { type: "synth-set", values };
  }
  if (rest.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | boolean | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = synthParamName(rest[index]!);
    if (!name || isSynthList(name)) return undefined;
    const word = rest[index + 1]!;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    const value = parseParamValue(SYNTH_PARAMS[name]!, word);
    if (value === undefined) return undefined;
    values[name] = value;
  }
  return { type: "synth-set", values };
}

/**
 * `synth zzfx 1,.05,220,,,.1` or the pasted `zzfx(...[,,129,.01])` form:
 * commas keep empty slots; without commas, spaces separate the values.
 */
function zzfxCommand(text: string): SynthCommand | undefined {
  const body = text
    .trim()
    .replace(/^zzfx\s*\(/i, "")
    .replace(/\)\s*;?$/, "")
    .replace(/^\.\.\./, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim();
  if (body.length === 0) return undefined;
  const parts = body.includes(",") ? body.split(",") : body.split(/\s+/);
  if (parts.length > ZZFX_ARRAY_LAYOUT.length) return undefined;
  const values: (number | null)[] = [];
  for (const part of parts) {
    const word = part.trim();
    if (word === "") {
      values.push(null);
      continue;
    }
    const value = Number(
      word.startsWith(".") ? `0${word}` : word.replace(/^-\./, "-0."),
    );
    if (!Number.isFinite(value)) return undefined;
    values.push(value);
  }
  return { type: "synth-zzfx", values };
}

/** `attack 0.01 · lpf 800 …` in spec order, or `defaults`. */
export function describeSynth(synth: TrackSynth | undefined): string {
  if (!synth) return "defaults";
  return Object.entries(synth)
    .map(([key, value]) =>
      Array.isArray(value)
        ? `${key} [${value.join(" ")}]`
        : `${key} ${String(value)}`,
    )
    .join(" · ");
}

export type SynthResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

export function applySynthCommand(
  score: TrackScore,
  trackId: string,
  command: SynthCommand,
): SynthResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (track.sampler)
    return {
      ok: false,
      message: `synth · ${trackId} is a sampler track; synth parameters shape synth voices`,
    };
  if (command.type === "synth-list")
    return {
      ok: true,
      message: `synth · ${track.instrument} · ${describeSynth(track.synth)} · basics ${SYNTH_SIMPLE.join(" ")}`,
    };
  let instrument = track.instrument;
  let synth: Record<string, unknown> | null;
  if (command.type === "synth-reset") {
    if (!track.synth) return { ok: true, message: "synth · already defaults" };
    synth = null;
  } else if (command.type === "synth-zzfx") {
    try {
      const sound = zzfxArraySynth(command.values);
      instrument = sound.instrument;
      synth = { ...sound.synth };
    } catch (error) {
      if (error instanceof FxValidationError)
        return { ok: false, message: `synth · ${error.message}` };
      throw error;
    }
  } else if (command.type === "synth-preset") {
    const preset = SYNTH_PRESETS[command.preset]!;
    instrument = preset.instrument;
    synth = { ...preset.synth };
  } else {
    synth = { ...track.synth };
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete synth[key];
      else synth[key] = value;
    }
  }
  let next: TrackScore;
  try {
    const normalized = normalizeSynth(synth);
    next = updateTrack(score, trackId, {
      instrument,
      synth: normalized ?? null,
    });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `synth · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((candidate) => candidate.id === trackId);
  return {
    ok: true,
    message:
      command.type === "synth-preset"
        ? `synth · preset ${command.preset} · ${stored?.instrument} · ${describeSynth(stored?.synth)}`
        : `synth · ${describeSynth(stored?.synth)}`,
    next,
    kind: "score.synth",
    payload: {
      trackId,
      instrument: stored?.instrument ?? instrument,
      synth: stored?.synth ?? null,
    },
  };
}
