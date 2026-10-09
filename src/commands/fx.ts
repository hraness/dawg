/**
 * The `fx` prompt command: turn effects on and off and set any parameter.
 *
 *   fx                                   list the focused track's effects
 *   fx <effect> on|off|reset             enable with defaults, remove, reset
 *   fx <effect> preset <name>            load a named preset (FX_PRESETS)
 *   fx <effect> <param> <value>          set one parameter (enables it)
 *   fx <effect> <number>                 set its first parameter (`fx orbit 2`)
 *   fx <effect> <param> <value> <param> <value>…   several at once
 *   fx reverb ir <impulse>|off           convolution reverb (Strudel `ir`):
 *                                        room|hall|plate, a pack sound or a
 *                                        project file; `fx ir hall` too
 *
 * Effects are every `FX_CHAIN` stage except pan (see core/fx.ts), plus
 * aliases (`dist`, `comp`, `room`, `bitcrush`, `trem`, `auto-filter`…).
 * Parameter names are the spec names or any Strudel name the spec lists
 * (`fx delay delayfeedback 0.4`, `fx filter lpq 0.3`). Booleans take
 * on/off/true/false; enums take one of their values. Each command is one
 * `updateTrack` revision and one undo step.
 */
import { nearestWord } from "../audio/instrument-check.ts";
import {
  EFFECT_NAMES,
  FX_PRESETS,
  FX_CHAIN,
  TRACK_EFFECT_SPECS,
  effectSpec,
  isEffectName,
  normalizeParam,
  FxValidationError,
  type EffectName,
  type FxName,
  type FxValues,
  type ParamSpec,
  type TrackEffectName,
} from "../../core/fx.ts";
import {
  ScoreValidationError,
  normalizeReverbIr,
  updateTrack,
  type SampleRef,
  type Track,
  type TrackPatch,
  type TrackScore,
} from "../../core/score.ts";

export type FxCommand =
  | { type: "fx-list" }
  | { type: "fx-on"; effect: EffectName }
  | { type: "fx-off"; effect: EffectName }
  | { type: "fx-reset"; effect: EffectName }
  | { type: "fx-preset"; effect: EffectName; preset: string }
  /** `fx reverb ir <src>`: `null` removes the impulse (algorithmic tail). */
  | { type: "fx-ir"; ir: string | null }
  | {
      type: "fx-set";
      effect: EffectName;
      values: Readonly<Record<string, number | string | boolean>>;
    };

const EFFECT_ALIASES: Readonly<Record<string, EffectName>> = Object.freeze({
  lpf: "filter",
  hpf: "filter",
  bpf: "filter",
  dj: "djf",
  "dj-filter": "djf",
  "auto-filter": "autofilter",
  autof: "autofilter",
  formant: "vowel",
  bitcrush: "crush",
  bitcrusher: "crush",
  coarse: "crush",
  distortion: "distort",
  dist: "distort",
  drive: "distort",
  shape: "distort",
  trem: "tremolo",
  comp: "compressor",
  compress: "compressor",
  rotary: "leslie",
  gain: "postgain",
  echo: "delay",
  bus: "orbit",
  o: "orbit",
  sidechain: "duck",
  duckorbit: "duck",
  room: "reverb",
  verb: "reverb",
});

export function parseEffectName(name: string): EffectName | undefined {
  const lower = name.toLowerCase();
  if (isEffectName(lower)) return lower;
  return Object.prototype.hasOwnProperty.call(EFFECT_ALIASES, lower)
    ? EFFECT_ALIASES[lower]
    : undefined;
}

/** Spec name for a parameter typed as its name or a listed Strudel alias. */
export function parseParamName(
  effect: EffectName,
  name: string,
): string | undefined {
  const params = effectSpec(effect).params;
  const lower = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(params, lower)) return lower;
  for (const [key, spec] of Object.entries(params))
    if (spec.strudel?.some((alias) => alias.toLowerCase() === lower))
      return key;
  return undefined;
}

/** Parse a typed value for a parameter spec; `undefined` when invalid. */
export function parseParamValue(
  spec: ParamSpec,
  text: string,
): number | string | boolean | undefined {
  const lower = text.toLowerCase();
  let value: number | string | boolean;
  if (spec.kind === "boolean") {
    if (["on", "true", "yes", "1"].includes(lower)) value = true;
    else if (["off", "false", "no", "0"].includes(lower)) value = false;
    else return undefined;
  } else if (spec.kind === "enum") value = lower;
  else {
    if (!/^-?\d+(?:\.\d+)?$/.test(lower)) return undefined;
    value = Number(lower);
  }
  try {
    return normalizeParam(spec, value, "value");
  } catch {
    return undefined;
  }
}

export function parseFxCommand(prompt: string): FxCommand | undefined {
  const words = prompt.trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== "fx") return undefined;
  if (words.length === 1) return { type: "fx-list" };
  if (prompt.length > 1_024) return undefined;
  const irWord = (word: string | undefined) =>
    word !== undefined && ["ir", "iresponse"].includes(word.toLowerCase());
  // `fx ir hall`, `fx reverb ir samples/church.wav`, `fx room ir off`.
  if (irWord(words[1]) && words.length === 3) return irCommand(words[2]!);
  const effect = parseEffectName(words[1]!);
  if (!effect) return undefined;
  if (effect === "reverb" && irWord(words[2]) && words.length === 4)
    return irCommand(words[3]!);
  const rest = words.slice(2).map((word) => word.toLowerCase());
  if (rest.length === 1 && (rest[0] === "on" || rest[0] === "off"))
    return { type: rest[0] === "on" ? "fx-on" : "fx-off", effect };
  if (rest.length === 1 && rest[0] === "reset")
    return { type: "fx-reset", effect };
  if (rest.length === 2 && rest[0] === "preset")
    return Object.prototype.hasOwnProperty.call(
      FX_PRESETS[effect] ?? {},
      rest[1]!,
    )
      ? { type: "fx-preset", effect, preset: rest[1]! }
      : undefined;
  // `fx hpf cutoff 300` picks the filter type from the alias.
  const alias = words[1]!.toLowerCase();
  const typed: Record<string, string> =
    effect === "filter" && (alias === "hpf" || alias === "bpf")
      ? { type: alias }
      : {};
  if (rest.length === 1) {
    // `fx orbit 2`, `fx duck 3`, `fx hpf 300`: the first numeric parameter.
    const params = effectSpec(effect).params;
    const first = effectSpec(effect).simple.find(
      (key) => params[key]?.kind === "number",
    );
    if (!first) return undefined;
    const value = parseParamValue(params[first]!, rest[0]!);
    return value === undefined
      ? undefined
      : { type: "fx-set", effect, values: { ...typed, [first]: value } };
  }
  if (rest.length === 0 || rest.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | boolean> = { ...typed };
  for (let index = 0; index < rest.length; index += 2) {
    const param = parseParamName(effect, rest[index]!);
    if (!param) return undefined;
    const value = parseParamValue(
      effectSpec(effect).params[param]!,
      rest[index + 1]!,
    );
    if (value === undefined) return undefined;
    values[param] = value;
  }
  return { type: "fx-set", effect, values };
}

/**
 * A short `fx <word> …` whose word is no effect (`fx wobble on`, `fx dela
 * mix 0.3`): the local answer, so a typo never goes to the agent. Longer
 * free text after `fx` still does.
 */
export function unknownFxMessage(prompt: string): string | undefined {
  const words = prompt.trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== "fx" || words.length < 2) return undefined;
  const name = words[1]!.toLowerCase();
  if (parseEffectName(name) || ["ir", "iresponse", "amp"].includes(name))
    return undefined;
  const near = nearestWord(name, [
    ...EFFECT_NAMES,
    ...Object.keys(EFFECT_ALIASES),
    "reverb",
  ]);
  const rest = words.slice(2).map((word) => word.toLowerCase());
  const commandShaped =
    rest.length <= 1 ||
    ["on", "off", "reset", "preset"].includes(rest[0]!) ||
    rest.every((word, index) => index % 2 === 0 || /^-?[\d.]+/.test(word));
  if (!near && !commandShaped) return undefined;
  return `unknown effect ${name.slice(0, 24)}${near ? ` · did you mean ${near}?` : ""} · effects ${EFFECT_NAMES.join(", ")}`;
}

function irCommand(value: string): FxCommand | undefined {
  const lower = value.toLowerCase();
  if (lower === "off" || lower === "none") return { type: "fx-ir", ir: null };
  try {
    return { type: "fx-ir", ir: normalizeReverbIr(value).src };
  } catch {
    return undefined;
  }
}

/** Every default, optional ones included: what `fx <effect> on` stores. */
export function effectDefaults(effect: EffectName): FxValues {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, spec] of Object.entries(effectSpec(effect).params))
    // An optional switch that defaults off (orbit `shared`) stays absent.
    if (!(spec.optional && spec.default === false)) out[key] = spec.default;
  // A zero `time` means "follow beats"; the canonical form omits it.
  if (effect === "delay") delete out.time;
  // A head's sag follows its type and its noise gate is off until set.
  if (effect === "head") {
    delete out.sag;
    delete out.gate;
  }
  return out;
}

function isTrackEffect(effect: EffectName): effect is TrackEffectName {
  return Object.prototype.hasOwnProperty.call(TRACK_EFFECT_SPECS, effect);
}

/** The effect's stored values on a track, or `undefined` when off. */
export function effectValues(
  track: Track | undefined,
  effect: EffectName,
): FxValues | undefined {
  if (!track) return undefined;
  if (isTrackEffect(effect)) return track[effect] as FxValues | undefined;
  return track.fx?.[effect as FxName];
}

/** Patch that sets (or with `null` removes) one effect's values. */
export function effectPatch(
  track: Track,
  effect: EffectName,
  values: FxValues | null,
): TrackPatch {
  if (isTrackEffect(effect))
    return { [effect]: values } as unknown as TrackPatch;
  const fx: Record<string, FxValues> = { ...track.fx };
  if (values) fx[effect] = values;
  else delete fx[effect];
  return { fx: Object.keys(fx).length > 0 ? fx : null };
}

function describe(effect: EffectName, values: FxValues): string {
  const simple = effectSpec(effect).simple;
  return simple
    .filter((key) => values[key] !== undefined)
    .map((key) => `${key} ${String(values[key])}`)
    .join(" ");
}

export type FxResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

export function applyFxCommand(
  score: TrackScore,
  trackId: string,
  command: FxCommand,
  /** For `fx-ir` on a pack sound: the pinned reference (src, sha256, url). */
  pinnedIr?: SampleRef,
): FxResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "fx-list") {
    const on = EFFECT_NAMES.filter((effect) => effectValues(track, effect));
    return {
      ok: true,
      message: on.length
        ? `fx · ${on.map((effect) => `${effect} (${describe(effect, effectValues(track, effect)!)})`).join(" → ")}`
        : `fx · none · chain ${FX_CHAIN.join(" → ")}`,
    };
  }
  if (command.type === "fx-ir")
    return applyIr(score, track, command.ir, pinnedIr);
  const { effect } = command;
  const current = effectValues(track, effect);
  let values: FxValues | null;
  if (command.type === "fx-off") {
    if (!current) return { ok: true, message: `${effect} · already off` };
    values = null;
  } else if (command.type === "fx-on") {
    if (current) return { ok: true, message: `${effect} · already on` };
    values = effectDefaults(effect);
  } else if (command.type === "fx-reset") values = effectDefaults(effect);
  else if (command.type === "fx-preset")
    values = {
      ...effectDefaults(effect),
      ...FX_PRESETS[effect]![command.preset],
    };
  else values = { ...(current ?? effectDefaults(effect)), ...command.values };
  if (values && effect === "delay" && values.time === 0) {
    const { time: _time, ...rest } = values;
    values = rest;
  }
  let next: TrackScore;
  try {
    next = updateTrack(score, trackId, effectPatch(track, effect, values));
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `${effect} · ${error.message}` };
    throw error;
  }
  const stored = effectValues(
    next.tracks.find((candidate) => candidate.id === trackId),
    effect,
  );
  return {
    ok: true,
    message: stored
      ? `${effect} · ${describe(effect, stored)}`
      : `${effect} · off`,
    next,
    kind: "score.effect",
    payload: { trackId, effect, value: stored ?? null },
  };
}

/** Sets or clears `reverb.ir`, turning the reverb on with defaults if off. */
function applyIr(
  score: TrackScore,
  track: Track,
  ir: string | null,
  pinned?: SampleRef,
): FxResult {
  const current = track.reverb;
  if (ir === null && !current?.ir)
    return { ok: true, message: "reverb · no impulse response" };
  const { ir: _old, ...rest } = (current ?? effectDefaults("reverb")) as Record<
    string,
    unknown
  >;
  const reverb =
    ir === null
      ? rest
      : { ...rest, ir: pinned?.src === ir ? pinned : { src: ir } };
  let next: TrackScore;
  try {
    next = updateTrack(score, track.id, { reverb } as unknown as TrackPatch);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return { ok: false, message: `reverb · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((item) => item.id === track.id)?.reverb;
  return {
    ok: true,
    message: stored?.ir
      ? `reverb · ir ${stored.ir.src.replace(/^builtin:/, "")} · mix ${stored.mix}`
      : `reverb · ir off · algorithmic tail`,
    next,
    kind: "score.effect",
    payload: { trackId: track.id, effect: "reverb", value: stored ?? null },
  };
}
