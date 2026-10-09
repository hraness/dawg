/**
 * Granular instrument (0.6): the `Track.granular` field, its parameter
 * table, presets and validation. Pure, no audio imports; the voice lives in
 * `src/audio/granular.ts` and reads `resolveGranular`.
 *
 * Names follow common granular UIs (Mutable Instruments Clouds, Ableton
 * Granulator II) where Strudel has no word: `pos`, `grain`, `overlap`,
 * `spray`, `jitter`, `freeze`; `begin`/`end`/`attack`/`release` are the
 * Strudel names.
 */
import type { ParamSpec } from "./params.ts";
import { FxValidationError, isRecord, normalizeParam } from "./params.ts";
import { SYNTH_PRESETS, SYNTH_SOUNDS } from "./synth.ts";
import type { SampleRef } from "./score.ts";
import { pitchToMidi } from "./pitch.ts";

/** Instrument name that plays a track's `granular` field. */
export const GRANULAR_INSTRUMENT = "granular" as const;

export function isGranularInstrument(instrument: string | undefined): boolean {
  return instrument === GRANULAR_INSTRUMENT;
}

export const GRAIN_WINDOWS = Object.freeze([
  "hann",
  "tukey",
  "gauss",
  "tri",
  "perc",
  "rperc",
] as const);
export type GrainWindow = (typeof GRAIN_WINDOWS)[number];

/** Prefix of a built-in source: a held render of a synth preset or sound. */
export const SYNTH_SOURCE_PREFIX = "synth:";
/** The source a granular track plays when `src` is absent. */
export const DEFAULT_GRANULAR_SOURCE = "synth:pad";
/** Note and length of a built-in synth source render. */
/** The sample-bank voice name a granular track's sample source loads under. */
export const GRANULAR_SOURCE_VOICE = "granular:src";
export const SYNTH_SOURCE_NOTE = 60;
export const SYNTH_SOURCE_SECONDS = 4;

/**
 * A granular source: a sample (same shape and pinning as a sampler voice)
 * or `synth:<preset|sound>[@<note>]`, a deterministic offline render.
 */
export type GranularSource = SampleRef | string;

/** Every stored field is optional; absent means the default or the preset. */
export type TrackGranular = Readonly<{
  src?: GranularSource;
  preset?: GranularPresetName;
  seed?: number;
  root?: number;
  begin?: number;
  end?: number;
  pos?: number;
  scan?: number;
  grain?: number;
  overlap?: number;
  jitter?: number;
  spray?: number;
  pitch?: number;
  detune?: number;
  shimmer?: number;
  shimint?: number;
  spread?: number;
  window?: GrainWindow;
  reverse?: number;
  freeze?: boolean;
  repeat?: number;
  hold?: number;
  drift?: number;
  drate?: number;
  attack?: number;
  release?: number;
  veltone?: number;
  gain?: number;
  /**
   * The instrument `grain off` returns to (set when granular turns on;
   * absent: a sampler, a wavetable, or the source's synth).
   */
  from?: string;
}>;

const n = (
  min: number,
  max: number,
  value: number,
  step: number | "log",
  doc: string,
  extra: Partial<{ unit: string; integer: boolean; automate: boolean }> = {},
): ParamSpec =>
  Object.freeze({
    kind: "number",
    min,
    max,
    default: value,
    step,
    doc,
    ...extra,
  });

/**
 * The granular parameter table: one row per stored number, enum or flag,
 * in stored key order. It drives validation, the printer, the menu, the
 * `grain` command and the `set_granular` tool. `automate` marks the rows a
 * later lane exposes as `grain-<name>` automation lanes.
 */
export const GRANULAR_PARAMS: Readonly<Record<string, ParamSpec>> =
  Object.freeze({
    seed: n(
      0,
      2_147_483_647,
      0,
      1,
      "texture variation; same seed, same grains",
      {
        integer: true,
      },
    ),
    root: n(0, 127, 60, 1, "the note that plays the source at its own pitch", {
      integer: true,
    }),
    begin: n(
      0,
      1,
      0,
      0.01,
      "start of the region the head reads, 0..1 of the file",
    ),
    end: n(0, 1, 1, 0.01, "end of the region the head reads, 0..1 of the file"),
    pos: n(0, 1, 0, 0.01, "where the head starts inside the region", {
      automate: true,
    }),
    scan: n(
      -4,
      4,
      1,
      0.05,
      "head speed: 1 the source's own speed, 0 held, negative backwards",
      {
        unit: "x",
        automate: true,
      },
    ),
    grain: n(0.005, 2, 0.08, "log", "grain length", {
      unit: "s",
      automate: true,
    }),
    overlap: n(
      0.05,
      32,
      4,
      0.5,
      "grains sounding at once (density = overlap / grain)",
      {
        automate: true,
      },
    ),
    jitter: n(
      0,
      1,
      0.25,
      0.05,
      "onset randomness, fraction of the grain period",
      {
        automate: true,
      },
    ),
    spray: n(0, 2, 0.01, 0.01, "random offset of each grain's read position", {
      unit: "s",
      automate: true,
    }),
    pitch: n(-48, 48, 0, 1, "semitones on top of the note", {
      unit: "st",
      automate: true,
    }),
    detune: n(0, 24, 0, 0.05, "random per-grain pitch spread (± half)", {
      unit: "st",
      automate: true,
    }),
    shimmer: n(0, 1, 0, 0.05, "chance a grain plays shimint semitones up", {
      automate: true,
    }),
    shimint: n(-24, 24, 12, 1, "the shimmer interval", { unit: "st" }),
    spread: n(0, 1, 0.3, 0.05, "stereo spread of the grains", {
      automate: true,
    }),
    window: Object.freeze({
      kind: "enum",
      values: GRAIN_WINDOWS,
      default: "hann",
      doc: "grain envelope: hann tukey gauss tri perc rperc",
    }),
    reverse: n(0, 1, 0, 0.05, "chance a grain plays backwards", {
      automate: true,
    }),
    freeze: Object.freeze({
      kind: "boolean",
      default: false,
      doc: "hold the read head (the cloud stops moving)",
    }),
    repeat: n(
      0,
      1,
      0,
      0.05,
      "chance a grain step latches the head (beat repeat)",
      {
        automate: true,
      },
    ),
    hold: n(1, 16, 1, 1, "grain steps a latch lasts", { integer: true }),
    drift: n(0, 1, 0, 0.05, "slow random walk of the head (depth)", {
      automate: true,
    }),
    drate: n(0.01, 10, 0.2, "log", "drift rate", { unit: "Hz" }),
    attack: n(0, 10, 0.01, "log", "voice fade in", { unit: "s" }),
    release: n(0, 20, 0.3, "log", "voice fade out after the note ends", {
      unit: "s",
    }),
    veltone: n(0, 1, 0, 0.05, "soft notes are darker"),
    gain: n(0, 4, 1, 0.05, "voice level"),
  });

export type GranularParamName = keyof typeof GRANULAR_PARAMS & string;

/** Resolved settings the voice reads (presets and defaults applied). */
export type GranularSettings = Readonly<{
  src: GranularSource;
  seed: number;
  root: number;
  begin: number;
  end: number;
  pos: number;
  scan: number;
  grain: number;
  overlap: number;
  jitter: number;
  spray: number;
  pitch: number;
  detune: number;
  shimmer: number;
  shimint: number;
  spread: number;
  window: GrainWindow;
  reverse: number;
  freeze: boolean;
  repeat: number;
  hold: number;
  drift: number;
  drate: number;
  attack: number;
  release: number;
  veltone: number;
  gain: number;
}>;

/**
 * Presets: partial settings over the defaults (the prototype's values).
 * `microloop`, `sparkle` and `backwards` come into their own on a resampled
 * phrase; on the built-in pad they are textures.
 */
export const GRANULAR_PRESETS = Object.freeze({
  cloud: {
    doc: "slow-scanning soft cloud, wide",
    params: {
      grain: 0.12,
      overlap: 6,
      jitter: 0.5,
      spray: 0.06,
      scan: 0.25,
      spread: 0.6,
      window: "hann",
      attack: 0.4,
      release: 1.2,
    },
  },
  hold: {
    doc: "held, shimmering sustain of one moment",
    params: {
      grain: 0.2,
      overlap: 8,
      jitter: 0.6,
      spray: 0.03,
      freeze: true,
      spread: 0.7,
      window: "gauss",
      attack: 0.6,
      release: 2,
    },
  },
  sparkle: {
    doc: "octave-and-fifth sparkle over a slow scan (best on a resample)",
    params: {
      grain: 0.15,
      overlap: 8,
      jitter: 0.5,
      spray: 0.05,
      scan: 0.2,
      shimmer: 0.35,
      shimint: 19,
      spread: 0.8,
      attack: 0.5,
      release: 2.5,
    },
  },
  swarm: {
    doc: "dense, detuned, fully wide",
    params: {
      grain: 0.09,
      overlap: 14,
      jitter: 0.8,
      spray: 0.08,
      detune: 0.35,
      spread: 1,
      scan: 0.5,
      attack: 0.2,
      release: 0.8,
    },
  },
  stutter: {
    doc: "dry 45 ms repeats that latch and follow the music",
    params: {
      grain: 0.045,
      overlap: 1,
      jitter: 0,
      spray: 0,
      scan: 1,
      repeat: 0.5,
      hold: 4,
      window: "perc",
      reverse: 0.25,
      spread: 0.2,
      attack: 0.002,
      release: 0.08,
    },
  },
  microloop: {
    doc: "tight looping grains that slowly advance (best on a resample)",
    params: {
      grain: 0.06,
      overlap: 2,
      jitter: 0,
      spray: 0,
      scan: 0.5,
      window: "tukey",
      spread: 0.1,
      attack: 0.005,
      release: 0.15,
    },
  },
  backwards: {
    doc: "backwards swells (best on a resample)",
    params: {
      grain: 0.25,
      overlap: 4,
      jitter: 0.3,
      spray: 0.02,
      reverse: 1,
      window: "rperc",
      spread: 0.5,
      attack: 0.05,
      release: 0.6,
    },
  },
  dust: {
    doc: "sparse random crackles across the source",
    params: {
      grain: 0.02,
      overlap: 0.4,
      jitter: 1,
      spray: 0.4,
      detune: 0.2,
      spread: 1,
      window: "perc",
      attack: 0.01,
      release: 0.5,
    },
  },
} as const satisfies Record<
  string,
  { doc: string; params: Partial<Record<string, number | string | boolean>> }
>);

export type GranularPresetName = keyof typeof GRANULAR_PRESETS;
export const GRANULAR_PRESET_NAMES: readonly GranularPresetName[] =
  Object.freeze(Object.keys(GRANULAR_PRESETS) as GranularPresetName[]);

export function isGranularPreset(name: string): name is GranularPresetName {
  return Object.prototype.hasOwnProperty.call(GRANULAR_PRESETS, name);
}

/** Synth preset and sound names a `synth:` source accepts. */
export function synthSourceNames(): readonly string[] {
  return [...Object.keys(SYNTH_PRESETS), ...SYNTH_SOUNDS];
}

/** `synth:<name>[@<note>]` parsed, or undefined when malformed or unknown. */
export function parseSynthSource(
  src: string,
): Readonly<{ name: string; note: number }> | undefined {
  if (!src.startsWith(SYNTH_SOURCE_PREFIX)) return undefined;
  const match =
    /^([a-z][a-z0-9_]{0,31})(?:@(\d{1,3}|[a-gA-G][#b]?-?\d))?$/.exec(
      src.slice(SYNTH_SOURCE_PREFIX.length),
    );
  if (!match) return undefined;
  const name = match[1]!;
  const at = match[2];
  const note =
    at === undefined
      ? SYNTH_SOURCE_NOTE
      : /^\d+$/.test(at)
        ? Number(at)
        : pitchToMidi(at);
  if (!(note <= 127) || !synthSourceNames().includes(name)) return undefined;
  return { name, note };
}

/**
 * Validates `Track.granular`. Fields are kept as given (a value equal to
 * the default still overrides the preset), in table order after `src` and
 * `preset`. `normalizeRef` is the score's sample-ref validator.
 */
export function normalizeGranular(
  input: unknown,
  normalizeRef: (value: unknown) => SampleRef,
): TrackGranular | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track granular must be an object or null");
  const out: Record<string, unknown> = {};
  if (input.src !== undefined) {
    if (typeof input.src === "string") {
      if (!parseSynthSource(input.src))
        throw new FxValidationError(
          `granular src "${input.src.slice(0, 40)}" must be synth:<preset>[@note] (${Object.keys(SYNTH_PRESETS).join(" ")}) or a sample`,
        );
      // A note name (`synth:pad@C3`) is stored as its MIDI number.
      out.src = /@[a-gA-G]/.test(input.src)
        ? `${SYNTH_SOURCE_PREFIX}${parseSynthSource(input.src)!.name}@${parseSynthSource(input.src)!.note}`
        : input.src;
    } else out.src = normalizeRef(input.src);
  }
  if (input.preset !== undefined) {
    if (typeof input.preset !== "string" || !isGranularPreset(input.preset))
      throw new FxValidationError(
        `granular preset must be one of ${GRANULAR_PRESET_NAMES.join(", ")}`,
      );
    out.preset = input.preset;
  }
  for (const [name, spec] of Object.entries(GRANULAR_PARAMS)) {
    const value = input[name];
    if (value === undefined) continue;
    out[name] = normalizeParam(spec, value, `granular ${name}`);
  }
  if (input.from !== undefined) {
    if (
      typeof input.from !== "string" ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(input.from) ||
      isGranularInstrument(input.from)
    )
      throw new FxValidationError(
        "granular from must be the instrument name grain off returns to",
      );
    out.from = input.from;
  }
  for (const key of Object.keys(input))
    if (
      key !== "src" &&
      key !== "preset" &&
      key !== "from" &&
      !Object.prototype.hasOwnProperty.call(GRANULAR_PARAMS, key)
    )
      throw new FxValidationError(
        `granular has no parameter "${key.slice(0, 32)}"`,
      );
  const begin = (out.begin as number | undefined) ?? 0;
  const end = (out.end as number | undefined) ?? 1;
  if (end <= begin)
    throw new FxValidationError("granular end must be greater than begin");
  return Object.freeze(out) as TrackGranular;
}

/** Defaults, then the preset, then the stored fields. */
export function resolveGranular(
  granular: TrackGranular | undefined,
): GranularSettings {
  const out: Record<string, unknown> = { src: DEFAULT_GRANULAR_SOURCE };
  for (const [name, spec] of Object.entries(GRANULAR_PARAMS))
    out[name] = spec.default;
  if (granular?.preset)
    Object.assign(out, GRANULAR_PRESETS[granular.preset].params);
  if (granular)
    for (const [key, value] of Object.entries(granular))
      if (key !== "preset" && key !== "from" && value !== undefined)
        out[key] = value;
  return Object.freeze(out) as GranularSettings;
}

/** A settings value as stored, or the preset's, or the default. */
export function granularValue(
  granular: TrackGranular | undefined,
  name: GranularParamName,
): number | string | boolean {
  return resolveGranular(granular)[name as keyof GranularSettings] as
    number | string | boolean;
}

/** Ring-out after a note: release plus 1.5 grains, capped at 10 s. */
export const GRANULAR_TAIL_SECONDS_MAX = 10;
export function granularTailSeconds(
  granular: TrackGranular | undefined,
): number {
  const s = resolveGranular(granular);
  return Math.min(GRANULAR_TAIL_SECONDS_MAX, s.release + 1.5 * s.grain);
}

/** A short label for the source (`synth:pad`, a file name). */
export function granularSourceLabel(src: GranularSource | undefined): string {
  const value = src ?? DEFAULT_GRANULAR_SOURCE;
  if (typeof value === "string") return value;
  const base = value.src.split("/").pop() ?? value.src;
  return base;
}
