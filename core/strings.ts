/**
 * String instruments (0.6 lane A, plucked and struck): the `Track.string`
 * parameter table, the frozen preset table and the words that pick them.
 *
 * `Track.string` stores only a preset name and the parameters the user
 * changed; absent keys take the preset's value, then the table default.
 * The engine (`src/audio/strings/`) runs only when `instrument` is
 * `"string"` AND `string` is present, so a stored legacy `sitar`, `ebass`,
 * `cello` or `pluck` keeps today's voice.
 */
import {
  FxValidationError,
  isRecord,
  normalizeParam,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** The `Track.instrument` value of the string engine. */
export const STRING_INSTRUMENT = "string" as const;

/** A track's string settings: a preset plus parameter overrides. */
export type TrackString = Readonly<
  { preset?: string } & Record<string, number | string | undefined>
>;

const log = "log" as const;

/** Every string parameter (section 4 of the strings spec, plucked subset). */
export const STRING_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze(
  {
    exciter: {
      kind: "enum",
      values: ["pick", "finger", "hammer", "noise"],
      default: "pick",
      doc: "how the string is set in motion",
    },
    ring: {
      kind: "number",
      min: 0.05,
      max: 60,
      default: 3,
      step: log,
      unit: "s",
      automate: true,
      doc: "how long a note rings (T60 at C4)",
      strudel: ["decay"],
    },
    track: {
      kind: "number",
      min: 0,
      max: 1.5,
      default: 0.5,
      step: 0.05,
      doc: "higher notes ring shorter: T60 x (f/C4)^-track",
    },
    damp: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0.4,
      step: 0.05,
      automate: true,
      doc: "high-frequency loss (dark, dead strings at 1)",
    },
    stiff: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0,
      step: 0.05,
      doc: "inharmonicity B = 1e-6 x 400^stiff (0 off, 0.5 a wound bass string)",
    },
    pos: {
      kind: "number",
      min: 0.02,
      max: 0.5,
      default: 0.15,
      step: 0.01,
      automate: true,
      doc: "pluck or strike position from the bridge (0.5 round, 0.04 nasal)",
    },
    bright: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0.6,
      step: 0.05,
      automate: true,
      doc: "excitation brightness at full velocity",
    },
    noise: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0.04,
      step: 0.02,
      doc: "noise share of the excitation (pick scrape, finger squeak)",
    },
    release: {
      kind: "number",
      min: 0.005,
      max: 10,
      default: 0.1,
      step: log,
      unit: "s",
      doc: "damping time after note-off",
    },
    mute: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0,
      step: 0.05,
      automate: true,
      doc: "palm mute: shortens the ring and darkens the string",
    },
    buzz: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0,
      step: 0.05,
      automate: true,
      doc: "bridge buzz (sitar, tanpura jawari); 0 off",
      strudel: ["jawari"],
    },
    vel: {
      kind: "number",
      min: 0,
      max: 1,
      default: 1,
      step: 0.05,
      doc: "velocity sensitivity of level and brightness (harpsichord 0.05)",
    },
    pickup: {
      kind: "number",
      min: 0,
      max: 0.5,
      default: 0,
      step: 0.01,
      doc: "magnetic pickup position (0 = acoustic bridge)",
    },
    vib: {
      kind: "number",
      min: 0,
      max: 12,
      default: 0,
      step: 0.25,
      unit: "Hz",
      automate: true,
      doc: "vibrato rate (a note's own vibrato overrides it)",
      strudel: ["vib"],
    },
    vibmod: {
      kind: "number",
      min: 0,
      max: 2,
      default: 0.18,
      step: 0.02,
      unit: "st",
      automate: true,
      doc: "vibrato depth in semitones",
      strudel: ["vibmod"],
    },
    vibdelay: {
      kind: "number",
      min: 0,
      max: 2,
      default: 0.25,
      step: 0.05,
      unit: "s",
      doc: "vibrato onset delay",
    },
    body: {
      kind: "enum",
      values: [
        "none",
        "guitar",
        "steel",
        "small",
        "bowl",
        "gourd",
        "skin",
        "board",
        "violin",
        "bass",
      ],
      default: "none",
      doc: "body resonance",
    },
    size: {
      kind: "number",
      min: 0.25,
      max: 5,
      default: 1,
      step: log,
      doc: "body scale: mode frequencies x 1/size (2 is a body twice as big)",
    },
    sym: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0,
      step: 0.05,
      doc: "sympathetic strings level",
    },
    symtune: {
      kind: "enum",
      values: ["scale", "open", "drone"],
      default: "scale",
      doc: "what the sympathetic strings are tuned to",
    },
    unison: {
      kind: "number",
      min: 1,
      max: 8,
      default: 1,
      step: 1,
      integer: true,
      doc: "strings per course",
      strudel: ["unison"],
    },
    detune: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0.1,
      step: 0.01,
      unit: "st",
      doc: "total detune spread across the course",
      strudel: ["detune"],
    },
    spread: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0.5,
      step: 0.05,
      doc: "stereo spread across the strings of a course",
      strudel: ["spread"],
    },
    oct: {
      kind: "number",
      min: 0,
      max: 1,
      default: 0,
      step: 0.05,
      doc: "octave string level (12-string, harpsichord 4', tres)",
    },
    octbelow: {
      kind: "number",
      min: 0,
      max: 128,
      default: 128,
      step: 1,
      integer: true,
      doc: "octave strings only below this MIDI key",
    },
    voices: {
      kind: "number",
      min: 1,
      max: 32,
      default: 8,
      step: 1,
      integer: true,
      doc: "polyphony cap (the oldest chord is released first)",
    },
    gain: {
      kind: "number",
      min: 0,
      max: 2,
      default: 1,
      step: 0.05,
      automate: true,
      doc: "output level (presets carry a calibrated trim)",
      strudel: ["gain"],
    },
  },
);

/** Simple rows first in the menu; the rest are listed under "advanced". */
export const STRING_SIMPLE_PARAMS: readonly string[] = Object.freeze([
  "ring",
  "bright",
  "damp",
  "pos",
  "mute",
  "buzz",
  "body",
  "sym",
]);

/** Parameter name for a Strudel alias (`decay` -> `ring`), or the name. */
export function stringParamName(word: string): string | undefined {
  if (STRING_PARAMS[word]) return word;
  for (const [name, spec] of Object.entries(STRING_PARAMS))
    if (spec.strudel?.includes(word)) return name;
  return undefined;
}

/** String parameters with a `string-<param>` lane (read at note onsets). */
export const STRING_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(STRING_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

export type StringValues = Readonly<Record<string, number | string>>;

export type StringPreset = Readonly<{
  doc: string;
  styles: string;
  values: StringValues;
}>;

// Prototype base (proto/strings/presets.ts): every preset starts here.
const BASE: StringValues = {
  exciter: "pick",
  ring: 3,
  track: 0.5,
  damp: 0.4,
  stiff: 0,
  pos: 0.15,
  bright: 0.6,
  noise: 0.04,
  release: 0.1,
  buzz: 0,
  vel: 1,
  pickup: 0,
  body: "none",
  size: 1,
  sym: 0,
  symtune: "open",
  unison: 1,
  detune: 0,
  spread: 0,
  oct: 0,
  octbelow: 128,
  voices: 6,
};

function preset(
  doc: string,
  styles: string,
  values: StringValues,
): StringPreset {
  return Object.freeze({
    doc,
    styles,
    values: Object.freeze({ ...BASE, ...values }),
  });
}

/**
 * The plucked presets, ported from the prototype (stiffness rewritten from
 * B = 0.002 s^2 to the 1e-6 x 400^stiff scale, `gain` is the per-preset
 * level calibration). Frozen by a sha256 test: a retune gets a new name.
 */
export const STRING_PRESETS: Readonly<Record<string, StringPreset>> =
  Object.freeze({
    nylon: preset(
      "nylon-string classical guitar, warm fingerstyle",
      "bachata rhythm, bossa, Mitski, ballads",
      {
        ring: 3,
        damp: 0.45,
        stiff: 0.194,
        pos: 0.15,
        exciter: "finger",
        bright: 0.55,
        noise: 0.05,
        release: 0.12,
        body: "guitar",
        sym: 0.1,
        gain: 0.62,
      },
    ),
    steel: preset(
      "steel-string acoustic, bright pick",
      "Neil Young, folk, jangle, bachata segunda",
      {
        ring: 4,
        damp: 0.25,
        stiff: 0.425,
        pos: 0.12,
        exciter: "pick",
        bright: 0.7,
        noise: 0.08,
        body: "steel",
        sym: 0.12,
        gain: 0.5,
      },
    ),
    electric: preset(
      "clean electric guitar, bridge-ish pickup",
      "angular rock, funk, jazz, Radiohead",
      {
        ring: 5,
        damp: 0.3,
        stiff: 0.381,
        pos: 0.2,
        exciter: "pick",
        bright: 0.7,
        pickup: 0.18,
        gain: 0.5,
      },
    ),
    jangle: preset(
      "electric 12-string, octave courses",
      "the Smiths, jangle rock, Byrds",
      {
        ring: 5,
        damp: 0.25,
        stiff: 0.381,
        pos: 0.18,
        exciter: "pick",
        bright: 0.8,
        pickup: 0.15,
        unison: 2,
        detune: 0.08,
        spread: 0.6,
        oct: 0.75,
        octbelow: 60,
        voices: 12,
        gain: 0.45,
      },
    ),
    ebass: preset("electric bass, fingers", "Motown, funk, soul, salsa", {
      ring: 6,
      track: 0.3,
      damp: 0.35,
      stiff: 0.806,
      pos: 0.18,
      exciter: "finger",
      bright: 0.45,
      release: 0.06,
      pickup: 0.15,
      voices: 4,
      gain: 0.55,
    }),
    slap: preset(
      "slap bass, thumb near the neck with fret clatter",
      "funk, disco",
      {
        ring: 4,
        track: 0.3,
        damp: 0.2,
        stiff: 0.806,
        pos: 0.25,
        exciter: "hammer",
        bright: 0.95,
        release: 0.05,
        pickup: 0.15,
        buzz: 0.12,
        voices: 4,
        gain: 0.45,
      },
    ),
    upright: preset(
      "upright bass pizzicato",
      "jazz, salsa tumbao, Louis Armstrong",
      {
        ring: 1.6,
        track: 0.4,
        damp: 0.55,
        stiff: 0.696,
        pos: 0.25,
        exciter: "finger",
        bright: 0.35,
        release: 0.08,
        body: "bass",
        voices: 4,
        gain: 0.7,
      },
    ),
    sitar: preset(
      "sitar: jawari buzz and taraf sympathetic strings",
      "raga, psychedelia",
      {
        ring: 5,
        track: 0.3,
        damp: 0.25,
        stiff: 0.194,
        pos: 0.08,
        exciter: "pick",
        bright: 0.8,
        buzz: 0.6,
        release: 0.4,
        body: "gourd",
        sym: 0.35,
        symtune: "scale",
        voices: 3,
        gain: 0.55,
      },
    ),
    tanpura: preset(
      "tanpura drone, open strings with strong jawari",
      "raga drone, La Monte Young",
      {
        ring: 9,
        track: 0.2,
        damp: 0.2,
        stiff: 0.098,
        pos: 0.05,
        exciter: "finger",
        bright: 0.45,
        buzz: 0.9,
        release: 1.5,
        body: "gourd",
        size: 1.25,
        voices: 4,
        gain: 0.55,
      },
    ),
    harpsichord: preset(
      "harpsichord 8'+8' (oct adds the 4', pos 0.04 is the lute stop)",
      "Bach, baroque continuo",
      {
        ring: 4,
        track: 0.6,
        damp: 0.15,
        stiff: 0.098,
        pos: 0.12,
        exciter: "pick",
        bright: 0.9,
        noise: 0.02,
        release: 0.08,
        vel: 0.05,
        body: "board",
        unison: 2,
        detune: 0.03,
        spread: 0.3,
        voices: 24,
        gain: 0.45,
      },
    ),
    lute: preset(
      "renaissance lute, gut double courses",
      "Dowland, early music, cantata continuo",
      {
        ring: 2.5,
        damp: 0.5,
        pos: 0.18,
        exciter: "finger",
        bright: 0.45,
        body: "bowl",
        unison: 2,
        detune: 0.04,
        spread: 0.3,
        voices: 8,
        gain: 0.6,
      },
    ),
    oud: preset("fretless oud with a plectrum", "maqam, Persian, Arabic", {
      ring: 2.5,
      damp: 0.4,
      pos: 0.12,
      exciter: "pick",
      bright: 0.55,
      body: "bowl",
      size: 0.909,
      unison: 2,
      detune: 0.03,
      spread: 0.2,
      voices: 6,
      gain: 0.55,
    }),
    setar: preset(
      "Persian setar, nail-plucked, drone strings",
      "Persian dastgah",
      {
        ring: 2.5,
        damp: 0.3,
        pos: 0.1,
        exciter: "pick",
        bright: 0.65,
        body: "small",
        sym: 0.15,
        symtune: "drone",
        voices: 4,
        gain: 0.6,
      },
    ),
    tar: preset("Persian tar, skin-topped double bowl", "Persian dastgah", {
      ring: 2.2,
      damp: 0.25,
      pos: 0.1,
      exciter: "pick",
      bright: 0.75,
      body: "skin",
      unison: 2,
      detune: 0.03,
      voices: 6,
      gain: 0.55,
    }),
    santur: preset(
      "santur: light mallets, four-string courses, undamped",
      "Persian, celtic",
      {
        ring: 6,
        track: 0.5,
        damp: 0.25,
        pos: 0.12,
        exciter: "hammer",
        bright: 0.7,
        release: 3,
        body: "board",
        size: 0.833,
        sym: 0.12,
        symtune: "scale",
        unison: 4,
        detune: 0.1,
        spread: 0.4,
        voices: 24,
        gain: 0.4,
      },
    ),
    dulcimer: preset(
      "hammered dulcimer, softer hammers",
      "celtic, Appalachian",
      {
        ring: 5,
        damp: 0.35,
        pos: 0.13,
        exciter: "hammer",
        bright: 0.55,
        release: 2.5,
        body: "board",
        unison: 2,
        detune: 0.06,
        spread: 0.3,
        voices: 24,
        gain: 0.45,
      },
    ),
    koto: preset(
      "koto, picks near the bridge; bends via note bend",
      "Japanese, Ryuichi Sakamoto",
      {
        ring: 3,
        damp: 0.4,
        pos: 0.08,
        exciter: "pick",
        bright: 0.6,
        release: 0.5,
        body: "board",
        size: 1.43,
        voices: 13,
        gain: 0.6,
      },
    ),
    harp: preset(
      "concert harp, plucked mid-string, open strings ring",
      "Debussy, celtic, cantatas, film",
      {
        ring: 5,
        track: 0.7,
        damp: 0.35,
        pos: 0.45,
        exciter: "finger",
        bright: 0.4,
        release: 1.2,
        body: "board",
        sym: 0.15,
        symtune: "scale",
        voices: 32,
        gain: 0.55,
      },
    ),
    banjo: preset(
      "5-string banjo, skin head, finger picks",
      "bluegrass, folk",
      {
        ring: 2,
        damp: 0.2,
        pos: 0.1,
        exciter: "pick",
        bright: 0.85,
        body: "skin",
        voices: 5,
        gain: 0.5,
      },
    ),
    tres: preset(
      "Cuban tres, paired courses with octaves",
      "salsa, son montuno",
      {
        ring: 2.5,
        damp: 0.25,
        pos: 0.12,
        exciter: "pick",
        bright: 0.75,
        body: "small",
        unison: 2,
        detune: 0.03,
        oct: 0.5,
        voices: 6,
        gain: 0.5,
      },
    ),
    requinto: preset(
      "bachata requinto, small bright steel guitar",
      "bachata lead",
      {
        ring: 3,
        damp: 0.2,
        stiff: 0.329,
        pos: 0.1,
        exciter: "pick",
        bright: 0.85,
        body: "small",
        voices: 6,
        gain: 0.5,
      },
    ),
  });

/** Preset names in table order. */
export const STRING_PRESET_NAMES: readonly string[] = Object.freeze(
  Object.keys(STRING_PRESETS),
);

/** The preset a bare `string: {}` plays. */
export const DEFAULT_STRING_PRESET = "nylon";

/** Words that pick a preset (resolved before the preset table). */
export const STRING_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  guitar: "steel",
  acoustic: "steel",
  classical: "nylon",
  "12string": "jangle",
  bassguitar: "ebass",
  fender: "ebass",
  doublebass: "upright",
  cembalo: "harpsichord",
  hammered: "dulcimer",
  sehtar: "setar",
});

/** A preset name for a word or alias, or undefined. */
export function stringPresetName(word: string): string | undefined {
  const name = STRING_ALIASES[word] ?? word;
  return STRING_PRESETS[name] ? name : undefined;
}

export function isStringTrack(
  track: Readonly<{ instrument: string; string?: TrackString }>,
): boolean {
  return track.instrument === STRING_INSTRUMENT && track.string !== undefined;
}

/**
 * Validates `track.string`: a known preset, known parameter names (Strudel
 * aliases are rewritten), values in range. Keys come back preset first,
 * then in table order, so equal documents print equally. `{}` is kept: it
 * is the marker that turns the engine on with the default preset.
 */
export function normalizeString(input: unknown): TrackString | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track string must be an object or null");
  const values: Record<string, unknown> = {};
  let presetName: string | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "preset") {
      const name =
        typeof value === "string" ? stringPresetName(value) : undefined;
      if (!name)
        throw new FxValidationError(
          `string preset must be one of ${STRING_PRESET_NAMES.join(", ")}`,
        );
      presetName = name;
      continue;
    }
    const name = stringParamName(key);
    if (!name)
      throw new FxValidationError(
        `string has no parameter "${key.slice(0, 32)}"`,
      );
    values[name] = value;
  }
  const out: Record<string, number | string> = {};
  if (presetName) out.preset = presetName;
  for (const [name, spec] of Object.entries(STRING_PARAMS)) {
    if (values[name] === undefined) continue;
    out[name] = normalizeParam(spec, values[name], `string ${name}`) as
      number | string;
  }
  return Object.freeze(out);
}

/** The preset a track's string settings play. */
export function stringPresetOf(settings: TrackString | undefined): string {
  const name = settings?.preset;
  return typeof name === "string" && STRING_PRESETS[name]
    ? name
    : DEFAULT_STRING_PRESET;
}

/** Every parameter's value: overrides, then the preset, then the default. */
export function resolveString(settings: TrackString | undefined): StringValues {
  const presetValues = STRING_PRESETS[stringPresetOf(settings)]!.values;
  const out: Record<string, number | string> = {};
  for (const [name, spec] of Object.entries(STRING_PARAMS)) {
    const own = settings?.[name];
    out[name] =
      own !== undefined && typeof own !== "boolean"
        ? own
        : (presetValues[name] ?? (spec.default as number | string));
  }
  return Object.freeze(out);
}

/** Stable text of the preset table (its sha256 is pinned by a test). */
export function stringPresetTableText(): string {
  return JSON.stringify(
    STRING_PRESET_NAMES.map((name) => [name, STRING_PRESETS[name]!.values]),
  );
}
