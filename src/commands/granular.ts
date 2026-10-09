/**
 * The `grain` prompt command: the focused track's granular instrument
 * (core/granular.ts, `Track.granular`).
 *
 *   grain                               this track's preset, source and overrides
 *   grain presets                       the granular presets
 *   grain <preset> | preset <name>      play a preset (instrument "granular")
 *   grain on [voice V]                  grain this track's own sound
 *   grain src synth:<name>[@note]       a built-in synth source
 *   grain src voice <V>                 a sampler voice of this track as source
 *   grain <param> <value> [...]         override parameters (`off` unsets)
 *   grain reset                         drop the overrides, keep preset and source
 *   grain off                           back to the track's previous voice
 *
 * On a synth track the source is that synth (`synth:<instrument>`), on a
 * sampler the first (or named) voice, pinned like the sampler voice. Each
 * command is one `updateTrack` revision and one undo step.
 */
import {
  DEFAULT_GRANULAR_SOURCE,
  GRANULAR_INSTRUMENT,
  GRANULAR_PARAMS,
  GRANULAR_PRESET_NAMES,
  GRANULAR_PRESETS,
  granularSourceLabel,
  isGranularInstrument,
  isGranularPreset,
  normalizeGranular,
  resolveGranular,
  parseSynthSource,
  synthSourceNames,
  SYNTH_SOURCE_PREFIX,
  type GranularPresetName,
  type GranularSource,
  type TrackGranular,
} from "../../core/granular.ts";
import { isDrumInstrument } from "../../core/drums.ts";
import { FxValidationError } from "../../core/params.ts";
import {
  ScoreValidationError,
  updateTrack,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { pitchToMidi } from "../../core/pitch.ts";
import { normalizeSynth, SYNTH_PRESETS } from "../../core/synth.ts";
import { parseParamValue } from "./fx.ts";

/** `grain 0.12s · overlap 6 · scan 0.25x …`; overrides marked `*`. */
function basicsLine(settings: TrackGranular | undefined): string {
  const resolved = resolveGranular(settings) as Record<string, unknown>;
  return GRANULAR_SIMPLE_PARAMS.map((name) => {
    const spec = GRANULAR_PARAMS[name]!;
    const value = resolved[name];
    const unit =
      spec.kind === "number" && spec.unit
        ? spec.unit
        : name === "scan"
          ? "x"
          : "";
    const shown =
      typeof value === "number"
        ? `${Number(value.toFixed(3))}${unit}`
        : String(value);
    const mark =
      settings && Object.prototype.hasOwnProperty.call(settings, name)
        ? "*"
        : "";
    return `${name} ${shown}${mark}`;
  }).join(" · ");
}

/** The basics shown first in the menu and the `grain` listing. */
export const GRANULAR_SIMPLE_PARAMS = Object.freeze([
  "grain",
  "overlap",
  "scan",
  "pos",
  "spray",
  "pitch",
  "shimmer",
  "spread",
  "freeze",
]);

export type GranularCommand =
  | { type: "grain-list" }
  | { type: "grain-presets" }
  | { type: "grain-reset" }
  | { type: "grain-off" }
  | { type: "grain-on"; voice?: string }
  | { type: "grain-preset"; preset: GranularPresetName; voice?: string }
  | { type: "grain-src"; synth?: string; voice?: string }
  | {
      type: "grain-set";
      /** `null` unsets a parameter (the preset's value again). */
      values: Readonly<Record<string, number | string | boolean | null>>;
    };

const VOICE_NAME = /^[a-z0-9._-]{1,64}$/;

export function parseGranularCommand(
  prompt: string,
): GranularCommand | undefined {
  const words = prompt.trim().split(/\s+/);
  const head = words[0]?.toLowerCase();
  if (head !== "grain" && head !== "granular") return undefined;
  if (words.length === 1) return { type: "grain-list" };
  if (prompt.length > 1_024) return undefined;
  const rest = words.slice(1).map((word) => word.toLowerCase());
  const voiceAt = (index: number): string | undefined | null => {
    if (rest.length === index) return undefined;
    if (
      rest.length === index + 2 &&
      rest[index] === "voice" &&
      VOICE_NAME.test(rest[index + 1]!)
    )
      return rest[index + 1]!;
    return null;
  };
  if (rest[0] === "reset" && rest.length === 1) return { type: "grain-reset" };
  if (rest[0] === "off" && rest.length === 1) return { type: "grain-off" };
  if ((rest[0] === "presets" || rest[0] === "list") && rest.length === 1)
    return { type: "grain-presets" };
  if (rest[0] === "on") {
    const voice = voiceAt(1);
    return voice === null ? undefined : { type: "grain-on", voice };
  }
  // `hold` is a preset and a parameter: `grain hold 4` sets the parameter.
  const presetWord =
    rest[0] === "preset" ||
    (isGranularPreset(rest[0]!) &&
      (rest.length === 1 ||
        rest[1] === "voice" ||
        !GRANULAR_PARAMS[rest[0]!] ||
        rest.length % 2 !== 0));
  if (presetWord) {
    const at = rest[0] === "preset" ? 1 : 0;
    const name = rest[at];
    if (!name || !isGranularPreset(name)) return undefined;
    const voice = voiceAt(at + 1);
    return voice === null
      ? undefined
      : { type: "grain-preset", preset: name, voice };
  }
  if (rest[0] === "src" || rest[0] === "source") {
    if (rest.length === 3 && rest[1] === "voice" && VOICE_NAME.test(rest[2]!))
      return { type: "grain-src", voice: rest[2]! };
    if (rest.length !== 2) return undefined;
    const text = rest[1]!.startsWith(SYNTH_SOURCE_PREFIX)
      ? rest[1]!
      : `${SYNTH_SOURCE_PREFIX}${rest[1]!}`;
    return parseSynthSource(text)
      ? { type: "grain-src", synth: text }
      : undefined;
  }
  if (rest.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | boolean | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]!;
    const spec = GRANULAR_PARAMS[name];
    if (!spec) return undefined;
    // Dotted note values as the rest of dawg writes them: `1/8.` is `1/8d`.
    const word =
      name === "sync" ? rest[index + 1]!.replace(/\.$/, "d") : rest[index + 1]!;
    if ((word === "off" || word === "unset") && spec.kind !== "boolean") {
      values[name] = null;
      continue;
    }
    const value =
      name === "root" && !/^\d/.test(word)
        ? noteNumber(word)
        : parseParamValue(spec, word);
    if (value === undefined) return undefined;
    // 0.6.1 switches: off removes the field, so on-then-off leaves the
    // score (and its sha256) as it was.
    values[name] =
      value === false && (name === "mono" || name === "pedal") ? null : value;
  }
  return { type: "grain-set", values };
}

/** A note name (`c4`, `f#3`) as its MIDI number. */
function noteNumber(word: string): number | undefined {
  const midi = pitchToMidi(word);
  return Number.isFinite(midi) ? midi : undefined;
}

/** `cloud · synth:pad · scan 0.1`, preset first, then source and overrides. */
export function describeGranular(settings: TrackGranular | undefined): string {
  const parts = [
    settings?.preset ?? "default",
    granularSourceLabel(settings?.src),
  ];
  for (const [key, value] of Object.entries(settings ?? {}))
    if (
      key !== "preset" &&
      key !== "src" &&
      key !== "from" &&
      value !== undefined
    )
      parts.push(`${key} ${String(value)}`);
  return parts.join(" · ");
}

/**
 * The source a track's own sound gives: a sampler voice (the named one or
 * the first), the track's synth when it is a known synth source, else the
 * built-in pad.
 */
export function ownGranularSource(
  track: Track,
  voice?: string,
): { src: GranularSource } | { error: string } {
  if (track.sampler) {
    const names = Object.keys(track.sampler.voices);
    const name = voice ?? names[0];
    const ref = name === undefined ? undefined : track.sampler.voices[name];
    if (!ref)
      return {
        error: `no sampler voice ${voice ?? ""} on ${track.id} (${names.join(" ") || "none"})`,
      };
    return { src: ref };
  }
  if (voice !== undefined)
    return { error: `${track.id} has no sampler voices` };
  if (track.granular?.src !== undefined) return { src: track.granular.src };
  // `synth preset pad` stores supersaw plus pad's params: grain the preset.
  const preset = synthPresetOf(track);
  if (preset) return { src: `${SYNTH_SOURCE_PREFIX}${preset}` };
  // A sound plays with the track's own synth params (src/audio/granular.ts).
  if (synthSourceNames().includes(track.instrument))
    return { src: `${SYNTH_SOURCE_PREFIX}${track.instrument}` };
  return { src: DEFAULT_GRANULAR_SOURCE };
}

/** The synth preset a track's instrument and synth params are, if any. */
export function synthPresetOf(track: Track): string | undefined {
  if (!track.synth) return undefined;
  const own = JSON.stringify(track.synth);
  for (const [name, preset] of Object.entries(SYNTH_PRESETS))
    if (
      preset.instrument === track.instrument &&
      JSON.stringify(normalizeSynth({ ...preset.synth })) === own
    )
      return name;
  return undefined;
}

export type GranularResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/**
 * The patch a granular change writes: instrument granular plus the
 * validated settings, or `null` settings to turn it off.
 */
export function applyGranularCommand(
  score: TrackScore,
  trackId: string,
  command: GranularCommand,
): GranularResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "grain-presets")
    return {
      ok: true,
      message: `grain presets · ${GRANULAR_PRESET_NAMES.map((name) => `${name} (${GRANULAR_PRESETS[name].doc})`).join(" · ")}`,
    };
  if (track.kit || isDrumInstrument(track.instrument))
    return {
      ok: false,
      message: `grain · ${trackId} is a drum track; granular plays pitched notes`,
    };
  const active = isGranularInstrument(track.instrument);
  if (command.type === "grain-list")
    return {
      ok: true,
      message: active
        ? `grain · ${track.granular?.preset ?? "default"} · ${granularSourceLabel(track.granular?.src)} · ${basicsLine(track.granular)}`
        : `grain · off (${track.instrument}) · grain cloud turns it on · grain presets`,
    };
  let instrument = track.instrument;
  let granular: Record<string, unknown> | null;
  let synthPatch: Record<string, unknown> | undefined;
  const keepSrc = (): Record<string, unknown> | { error: string } => {
    const own = ownGranularSource(track);
    if ("error" in own) return own;
    return own.src === DEFAULT_GRANULAR_SOURCE ? {} : { src: own.src };
  };
  if (command.type === "grain-off") {
    if (!active) return { ok: true, message: "grain · already off" };
    // A sampler keeps its voices; anything else returns to its synth
    // source's voice (or sine), and the settings stay for `grain on`.
    // The voice granular turned on from (`from`), else a wavetable, else
    // the synth source's own instrument (a preset maps to its instrument
    // and params), else sine.
    const src = track.granular?.src;
    const parsed = typeof src === "string" ? parseSynthSource(src) : undefined;
    if (track.sampler) instrument = "sampler";
    else if (track.granular?.from) instrument = track.granular.from;
    else if (track.wavetable) instrument = "wavetable";
    else if (parsed && SYNTH_PRESETS[parsed.name]) {
      instrument = SYNTH_PRESETS[parsed.name]!.instrument;
      if (!track.synth) synthPatch = { ...SYNTH_PRESETS[parsed.name]!.synth };
    } else if (parsed) instrument = parsed.name;
    else instrument = "sine";
    granular = track.granular ? { ...track.granular } : null;
  } else if (command.type === "grain-reset") {
    if (!active) return { ok: true, message: "grain · already off" };
    granular = {};
    if (track.granular?.preset) granular.preset = track.granular.preset;
    if (track.granular?.src !== undefined) granular.src = track.granular.src;
  } else if (command.type === "grain-on" || command.type === "grain-preset") {
    instrument = GRANULAR_INSTRUMENT;
    const base: Record<string, unknown> =
      active || (track.granular && command.voice === undefined)
        ? { ...track.granular }
        : {};
    if (command.voice !== undefined || base.src === undefined) {
      const own =
        command.voice !== undefined
          ? ownGranularSource(track, command.voice)
          : ((): { src: GranularSource } | { error: string } => {
              const kept = keepSrc();
              if ("error" in kept) return kept as { error: string };
              return {
                src: (kept.src as GranularSource) ?? DEFAULT_GRANULAR_SOURCE,
              };
            })();
      if ("error" in own) return { ok: false, message: `grain · ${own.error}` };
      if (own.src === DEFAULT_GRANULAR_SOURCE) delete base.src;
      else base.src = own.src;
    }
    if (command.type === "grain-preset") {
      // A preset replaces the overrides; the source stays.
      granular = { preset: command.preset };
      if (base.src !== undefined) granular.src = base.src;
    } else granular = base;
  } else if (command.type === "grain-src") {
    instrument = GRANULAR_INSTRUMENT;
    granular = active || track.granular ? { ...track.granular } : {};
    if (command.voice !== undefined) {
      const own = ownGranularSource(track, command.voice);
      if ("error" in own) return { ok: false, message: `grain · ${own.error}` };
      granular.src = own.src;
    } else if (command.synth === DEFAULT_GRANULAR_SOURCE) delete granular.src;
    else granular.src = command.synth;
  } else {
    instrument = GRANULAR_INSTRUMENT;
    granular = active && track.granular ? { ...track.granular } : {};
    if (!active) {
      const kept = keepSrc();
      if ("error" in kept)
        return { ok: false, message: `grain · ${kept.error}` };
      Object.assign(granular, track.granular ?? {}, kept);
    }
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete granular[key];
      else granular[key] = value;
    }
  }
  // Remember the voice to go back to when granular turns on.
  if (granular !== null && command.type !== "grain-off") {
    const from = active
      ? track.granular?.from
      : track.sampler || isGranularInstrument(track.instrument)
        ? undefined
        : track.instrument;
    if (from) granular.from = from;
    else delete granular.from;
  }
  let next: TrackScore;
  try {
    next = updateTrack(score, trackId, {
      instrument,
      granular: granular === null ? null : granularOrEmpty(granular),
      ...(synthPatch ? { synth: synthPatch as never } : {}),
    });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `grain · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((candidate) => candidate.id === trackId);
  return {
    ok: true,
    message:
      command.type === "grain-off"
        ? `grain · off · ${instrument}`
        : `grain · ${describeGranular(stored?.granular)}`,
    next,
    kind: "score.granular",
    payload: {
      trackId,
      instrument: stored?.instrument ?? instrument,
      granular: stored?.granular ?? null,
    },
  };
}

/** Validated settings; the score's normaliser re-checks the SampleRef. */
function granularOrEmpty(value: Record<string, unknown>): TrackGranular {
  return normalizeGranular(value, (ref) => ref as never) ?? Object.freeze({});
}

/** Track names that create a granular track: `cloud`, `hold-2`, … */
export function granularTrackPreset(
  trackId: string,
): GranularPresetName | undefined {
  const match = /^([a-z]+)(?:-\d{1,3})?$/.exec(trackId);
  return match && isGranularPreset(match[1]!) ? match[1] : undefined;
}

/**
 * The local answer for `grain src <something else>` (`grain src bus:guitars`),
 * so a source dawg cannot read yet never goes to the agent.
 */
export function grainSrcHint(prompt: string): string | undefined {
  const words = prompt.trim().toLowerCase().split(/\s+/);
  if (words[0] !== "grain" || (words[1] !== "src" && words[1] !== "source"))
    return undefined;
  if (parseGranularCommand(prompt)) return undefined;
  return "grain src synth:<preset>[@note] | voice <name> · a bus or another track is not a source yet: render it and load the file as a sampler voice";
}
