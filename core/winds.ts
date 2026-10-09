/**
 * Blown instruments (0.6.1 "Instruments wave 2", lane f061-gamelan-winds):
 * flutes, reeds, saxes and brass played by one waveguide engine
 * (`src/audio/winds/`). Pure and import-light, like `core/resonators.ts`
 * (which re-exports this file): the parameter table, the 21 presets and the
 * validator that the score, the prompt, the menu, the agent and the SDK
 * printer share.
 *
 * A track plays this engine only when its `instrument` is `"wind"` AND it
 * carries a `wind` object (`{ preset, ...overrides }`). A bare `"wind"`
 * instrument without the field keeps the legacy wind tone byte for byte.
 *
 * Models (STK's waveguides, Cook and Scavone, corrected for exact pitch by
 * per-rate trim tables): `jet` flutes, `reed` clarinets, `sax` conical reeds
 * (saxes, and oboe and bassoon until a true double-reed table lands) and
 * `lips` brass.
 */
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type EnumParam,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** Instrument value that selects the wind engine. */
export const WIND_INSTRUMENT = "wind" as const;

export const WIND_MODELS = Object.freeze(["jet", "reed", "sax", "lips"]);
export type WindModel = "jet" | "reed" | "sax" | "lips";

export const WIND_MUTES = Object.freeze([
  "open",
  "straight",
  "cup",
  "harmon",
  "plunger",
]);
export type WindMute = "open" | "straight" | "cup" | "harmon" | "plunger";

export const WIND_PRESET_NAMES = Object.freeze([
  "flute",
  "recorder",
  "whistle",
  "ney",
  "shakuhachi",
  "panpipe",
  "suling",
  "bansuri",
  "clarinet",
  "bassclarinet",
  "oboe",
  "bassoon",
  "sax",
  "altosax",
  "barisax",
  "trumpet",
  "harmon",
  "plunger",
  "trombone",
  "tuba",
  "horn",
] as const);
export type WindPresetName = (typeof WIND_PRESET_NAMES)[number];

/** Extra words that pick a preset (`wind preset saxophone`). */
export const WIND_ALIASES: Readonly<Record<string, WindPresetName>> =
  Object.freeze({
    tinwhistle: "whistle",
    pennywhistle: "whistle",
    nay: "ney",
    panflute: "panpipe",
    panpipes: "panpipe",
    saxophone: "sax",
    tenorsax: "sax",
    tenor: "sax",
    alto: "altosax",
    bari: "barisax",
    baritonesax: "barisax",
    frenchhorn: "horn",
    mutedtrumpet: "harmon",
    wahtrumpet: "plunger",
  });

/** The browse group "Winds and brass", in menu order. */
export const WIND_GROUPS: readonly Readonly<{
  label: string;
  presets: readonly WindPresetName[];
}>[] = Object.freeze([
  {
    label: "Flutes",
    presets: [
      "flute",
      "recorder",
      "whistle",
      "ney",
      "shakuhachi",
      "panpipe",
      "suling",
      "bansuri",
    ],
  },
  {
    label: "Saxophones",
    presets: ["sax", "altosax", "barisax"],
  },
  {
    label: "Reeds",
    presets: ["clarinet", "bassclarinet", "oboe", "bassoon"],
  },
  {
    label: "Brass",
    presets: ["trumpet", "harmon", "plunger", "trombone", "tuba", "horn"],
  },
]);

const num = (
  min: number,
  max: number,
  fallback: number,
  step: number | "log",
  doc: string,
  extra: Partial<NumberParam> = {},
): NumberParam =>
  Object.freeze({
    kind: "number",
    min,
    max,
    default: fallback,
    step,
    optional: true,
    doc,
    ...extra,
  });

/**
 * Every wind parameter. All are optional: an absent one takes the preset's
 * value, then the default here. `automate` ones have a `wind-<param>` lane
 * the voice reads every 32-sample control tick.
 */
export const WIND_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze({
  model: Object.freeze({
    kind: "enum",
    values: WIND_MODELS,
    default: "jet",
    optional: true,
    doc: "exciter and bore: jet (flute), reed (clarinet), sax (conical reed), lips (brass)",
  }) as EnumParam,
  breath: num(0, 1, 0.6, 0.05, "blowing pressure: swells, louder and fuller", {
    automate: true,
  }),
  noise: num(0, 1, 0.08, 0.05, "breath noise", { automate: true }),
  attack: num(0.001, 2, 0.04, "log", "breath rise", {
    unit: "s",
    strudel: ["att"],
  }),
  release: num(0.005, 2, 0.08, "log", "breath fall", {
    unit: "s",
    strudel: ["rel"],
  }),
  vib: num(0, 12, 5, 0.25, "vibrato rate", {
    unit: "Hz",
    strudel: ["vibrato"],
  }),
  vibmod: num(0, 1, 0, 0.02, "vibrato depth", {
    unit: "st",
    strudel: ["vmod", "vibdepth", "depth"],
  }),
  reed: num(0, 1, 0.5, 0.05, "reed stiffness, jet offset or lip tension"),
  bright: num(0, 1, 0.5, 0.05, "bore loss: dark to bright"),
  stopped: Object.freeze({
    kind: "boolean",
    default: false,
    optional: true,
    doc: "stopped pipe, odd harmonics (jet only)",
  }),
  mute: Object.freeze({
    kind: "enum",
    values: WIND_MUTES,
    default: "open",
    optional: true,
    doc: "brass mute: open, straight, cup, harmon or plunger",
  }) as EnumParam,
  wah: num(0, 1, 1, 0.05, "plunger opening: 0 closed, 1 open", {
    automate: true,
  }),
  wahenv: num(0, 1, 0, 0.05, "plunger opens with each note (doo-wah)"),
  growl: num(0, 1, 0, 0.05, "hum into the horn: rough, raspy", {
    automate: true,
  }),
  flutter: num(0, 1, 0, 0.05, "flutter tongue (rolled r)", { automate: true }),
  players: num(1, 8, 1, 1, "section size, spread over chord tones", {
    integer: true,
  }),
  gain: num(0, 2, 0.8, 0.05, "level"),
});

/** Menu rows most people reach for. */
export const WIND_SIMPLE = Object.freeze([
  "breath",
  "bright",
  "mute",
  "players",
  "growl",
]);

/** Resolved settings the engine plays. */
export type WindSettings = Readonly<{
  model: WindModel;
  breath: number;
  noise: number;
  attack: number;
  release: number;
  vib: number;
  vibmod: number;
  reed: number;
  bright: number;
  stopped: boolean;
  mute: WindMute;
  wah: number;
  wahenv: number;
  growl: number;
  flutter: number;
  players: number;
  gain: number;
}>;

export const WIND_DEFAULTS: WindSettings = Object.freeze({
  model: "jet",
  breath: 0.6,
  noise: 0.08,
  attack: 0.04,
  release: 0.08,
  vib: 5,
  vibmod: 0,
  reed: 0.5,
  bright: 0.5,
  stopped: false,
  mute: "open",
  wah: 1,
  wahenv: 0,
  growl: 0,
  flutter: 0,
  players: 1,
  gain: 0.8,
});

export type WindPreset = Readonly<{
  settings: WindSettings;
  /** MIDI range the instrument is built for (sounding pitch). */
  range: readonly [number, number];
  doc: string;
  styles: string;
}>;

const preset = (
  settings: Partial<WindSettings>,
  range: [number, number],
  doc: string,
  styles: string,
): WindPreset =>
  Object.freeze({
    settings: Object.freeze({ ...WIND_DEFAULTS, ...settings }),
    range: Object.freeze(range) as readonly [number, number],
    doc,
    styles,
  });

/**
 * Presets, ported from the reviewed prototype (proto/resonators/presets.ts)
 * and extended to the 21 of the revised brief. Ranges are sounding pitch
 * (written ranges of the transposing instruments, transposed).
 */
export const WIND_PRESETS: Readonly<Record<WindPresetName, WindPreset>> =
  Object.freeze({
    flute: preset(
      {
        model: "jet",
        breath: 0.6,
        noise: 0.12,
        attack: 0.06,
        vib: 5,
        vibmod: 0.12,
        bright: 0.5,
      },
      [60, 96],
      "concert flute, airy with gentle vibrato",
      "Debussy, Bach cantata, jazz flute",
    ),
    recorder: preset(
      { model: "jet", breath: 0.5, noise: 0.06, attack: 0.02, bright: 0.6 },
      [65, 93],
      "alto recorder, pure and straight",
      "Bach cantata, early music",
    ),
    whistle: preset(
      { model: "jet", breath: 0.6, noise: 0.08, attack: 0.015, bright: 0.7 },
      [74, 98],
      "tin whistle, bright and reedy",
      "celtic",
    ),
    ney: preset(
      {
        model: "jet",
        breath: 0.45,
        noise: 0.35,
        attack: 0.12,
        vib: 5.5,
        vibmod: 0.08,
        bright: 0.3,
      },
      [55, 86],
      "Persian reed flute, very breathy",
      "Persian, Sufi, ambient",
    ),
    shakuhachi: preset(
      {
        model: "jet",
        breath: 0.55,
        noise: 0.3,
        attack: 0.08,
        vib: 4,
        vibmod: 0.2,
        bright: 0.35,
      },
      [62, 86],
      "bamboo end-blown flute, breath accents",
      "Sakamoto, OPN, ambient",
    ),
    panpipe: preset(
      {
        model: "jet",
        stopped: true,
        breath: 0.6,
        noise: 0.2,
        attack: 0.03,
        bright: 0.5,
      },
      [60, 96],
      "stopped cane pipes, hollow odd harmonics",
      "ambient, Andean, Eno",
    ),
    suling: preset(
      {
        model: "jet",
        breath: 0.5,
        noise: 0.25,
        attack: 0.05,
        vib: 5.5,
        vibmod: 0.1,
        bright: 0.45,
      },
      [67, 93],
      "Sundanese and Balinese ring flute, soft and breathy",
      "gamelan, degung, ambient",
    ),
    bansuri: preset(
      {
        model: "jet",
        breath: 0.55,
        noise: 0.22,
        attack: 0.07,
        vib: 5,
        vibmod: 0.15,
        bright: 0.4,
      },
      [55, 84],
      "Indian bamboo flute, warm with deep vibrato",
      "Hindustani, Bollywood, ambient",
    ),
    clarinet: preset(
      { model: "reed", breath: 0.6, noise: 0.05, attack: 0.04, reed: 0.5 },
      [50, 91],
      "cylindrical bore, woody odd harmonics",
      "Brahms, jazz, klezmer, Motown",
    ),
    bassclarinet: preset(
      {
        model: "reed",
        breath: 0.6,
        noise: 0.06,
        attack: 0.05,
        reed: 0.4,
        bright: 0.4,
      },
      [37, 72],
      "bass clarinet, dark and hollow",
      "Bitches Brew, Messiaen, film",
    ),
    oboe: preset(
      {
        model: "sax",
        breath: 0.6,
        noise: 0.04,
        attack: 0.03,
        vib: 5.5,
        vibmod: 0.08,
        reed: 0.8,
        bright: 0.75,
      },
      [58, 91],
      "double reed, nasal and singing",
      "Bach, Ravel, Morricone",
    ),
    bassoon: preset(
      {
        model: "sax",
        breath: 0.6,
        noise: 0.04,
        attack: 0.04,
        vib: 5,
        vibmod: 0.06,
        reed: 0.7,
        bright: 0.35,
      },
      [34, 72],
      "bassoon, reedy and woody low voice",
      "Stravinsky, Prokofiev, orchestral",
    ),
    sax: preset(
      {
        model: "sax",
        breath: 0.65,
        noise: 0.1,
        attack: 0.03,
        vib: 5.2,
        vibmod: 0.15,
      },
      [44, 79],
      "tenor sax, warm to raspy with breath",
      "jazz, Motown, soul, funk",
    ),
    altosax: preset(
      {
        model: "sax",
        breath: 0.65,
        noise: 0.09,
        attack: 0.03,
        vib: 5.4,
        vibmod: 0.12,
        bright: 0.55,
      },
      [49, 81],
      "alto sax, bright and vocal",
      "bebop, Motown, soul",
    ),
    barisax: preset(
      {
        model: "sax",
        breath: 0.68,
        noise: 0.1,
        attack: 0.04,
        vib: 5,
        vibmod: 0.08,
        bright: 0.45,
      },
      [36, 69],
      "baritone sax, honking low end",
      "Motown, funk, ska",
    ),
    trumpet: preset(
      {
        model: "lips",
        breath: 0.7,
        noise: 0.03,
        attack: 0.03,
        bright: 0.6,
        vib: 5.5,
      },
      [52, 82],
      "open trumpet, brightens as it gets louder",
      "Louis Armstrong, Motown, salsa, jazz",
    ),
    harmon: preset(
      {
        model: "lips",
        breath: 0.7,
        noise: 0.03,
        attack: 0.03,
        bright: 0.6,
        mute: "harmon",
      },
      [52, 82],
      "trumpet with a harmon mute, buzzy and close",
      "jazz, Radiohead, Sakamoto",
    ),
    plunger: preset(
      {
        model: "lips",
        breath: 0.75,
        noise: 0.04,
        attack: 0.03,
        bright: 0.6,
        mute: "plunger",
        wah: 0.3,
      },
      [52, 82],
      "trumpet with a plunger: automate wah for ya-ya",
      "Louis Armstrong, Duke Ellington, funk",
    ),
    trombone: preset(
      { model: "lips", breath: 0.7, noise: 0.03, attack: 0.04, bright: 0.45 },
      [40, 72],
      "slide trombone, broad",
      "salsa, Motown, jazz",
    ),
    tuba: preset(
      { model: "lips", breath: 0.7, noise: 0.02, attack: 0.06, bright: 0.3 },
      [28, 58],
      "tuba, round and deep",
      "New Orleans brass band, oompah, orchestral",
    ),
    horn: preset(
      { model: "lips", breath: 0.6, noise: 0.02, attack: 0.06, bright: 0.25 },
      [41, 77],
      "French horn, dark and round",
      "Brahms, Beethoven, orchestral",
    ),
  });

/** Default preset of a `wind` field that names none. */
export const DEFAULT_WIND_PRESET: WindPresetName = "flute";

/** A track's stored wind settings: a preset plus overrides, all optional. */
export type TrackWind = Readonly<{
  preset?: WindPresetName;
  model?: WindModel;
  breath?: number;
  noise?: number;
  attack?: number;
  release?: number;
  vib?: number;
  vibmod?: number;
  reed?: number;
  bright?: number;
  stopped?: boolean;
  mute?: WindMute;
  wah?: number;
  wahenv?: number;
  growl?: number;
  flutter?: number;
  players?: number;
  gain?: number;
}>;

export function isWindPreset(name: string): name is WindPresetName {
  return (WIND_PRESET_NAMES as readonly string[]).includes(name);
}

/** A preset word or alias (`saxophone`) to its preset; undefined if neither. */
export function windPresetFor(word: string): WindPresetName | undefined {
  const lower = word.trim().toLowerCase();
  if (isWindPreset(lower)) return lower;
  return WIND_ALIASES[lower];
}

export function isWindParam(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(WIND_PARAMS, name);
}

/** Strudel spelling (`att`, `rel`) to a wind parameter name. */
export function windParamName(name: string): string | undefined {
  if (isWindParam(name)) return name;
  for (const [key, spec] of Object.entries(WIND_PARAMS))
    if (spec.strudel?.includes(name)) return key;
  return undefined;
}

/**
 * Validates a `wind` field: `{ preset?, ...overrides }`, null or absent
 * meaning none. Keys come out in canonical order (preset, then
 * `WIND_PARAMS` order). `{}` is kept: it means the default preset.
 */
export function normalizeWind(input: unknown): TrackWind | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track wind must be an object or null");
  const params: Record<string, unknown> = {};
  let presetName: WindPresetName | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "preset") {
      const resolved =
        typeof value === "string" ? windPresetFor(value) : undefined;
      if (!resolved)
        throw new FxValidationError(
          `wind preset must be one of ${WIND_PRESET_NAMES.join(", ")}`,
        );
      presetName = resolved;
      continue;
    }
    const name = windParamName(key);
    if (!name)
      throw new FxValidationError(
        `wind has no parameter "${key.slice(0, 32)}"`,
      );
    params[name] = value;
  }
  const values = normalizeParams(WIND_PARAMS, params, "wind", false);
  return Object.freeze({
    ...(presetName ? { preset: presetName } : {}),
    ...values,
  }) as TrackWind;
}

/** The preset a `wind` field plays. */
export function windPresetOf(wind: TrackWind | undefined): WindPresetName {
  return wind?.preset ?? DEFAULT_WIND_PRESET;
}

/**
 * The settings a `wind` field plays: defaults, then the preset, then
 * explicit overrides, then any automation lane values from `lane`.
 */
export function windSettings(
  wind: TrackWind | undefined,
  lane?: (param: string) => number | undefined,
): WindSettings {
  const base = WIND_PRESETS[windPresetOf(wind)].settings;
  const out: Record<string, number | string | boolean> = { ...base };
  if (wind)
    for (const [key, value] of Object.entries(wind))
      if (key !== "preset" && value !== undefined) out[key] = value;
  if (lane)
    for (const { param } of WIND_LANE_PARAMS) {
      const value = lane(param);
      if (value !== undefined) out[param] = value;
    }
  return Object.freeze(out) as WindSettings;
}

/** Parameters with a `wind-<param>` automation lane. */
export const WIND_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(WIND_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

/** Voices one wind track sounds at once; the oldest onset is stolen. */
export const MAX_WIND_VOICES = 24;

/** Ring after the last breath ends, in seconds. */
export function windTailSeconds(wind: TrackWind | undefined): number {
  return windSettings(wind).release + 0.15;
}
