/**
 * Modelled pianos (0.6 "Instruments", keys lane): the piano families, the one
 * `KEYS_PARAMS` table that drives validation, printing, the menu, the
 * `keys` prompt command, the `set_keys` agent tool and the `keys-<param>`
 * automation lanes, and the named presets.
 *
 * A track plays the modelled piano only when its instrument is a piano
 * family (`grand`, `upright`, `felt`, `honkytonk`, `prepared`) AND it carries
 * `keys` (possibly `{}`). A stored `instrument: "piano"` stays the legacy
 * tone forever; every new write of the word `piano` stores `grand` with
 * `keys: {}` (see `pianoWrite`).
 */
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** The piano families this lane models (the `Track.instrument` values). */
export const PIANO_FAMILIES = Object.freeze([
  "grand",
  "upright",
  "felt",
  "honkytonk",
  "prepared",
] as const);

export type PianoFamily = (typeof PIANO_FAMILIES)[number];

export function isPianoFamily(
  instrument: string | undefined,
): instrument is PianoFamily {
  return (PIANO_FAMILIES as readonly string[]).includes(instrument ?? "");
}

/**
 * Electric keys (0.6.1, keys-electric): the Rhodes-style tine piano, the
 * Wurlitzer-style reed piano and the clavinet. They share `Track.keys` and
 * the `KEYS_PARAMS` table with the pianos; `KEYS_PARAM_FAMILIES` says which
 * rows each family reads.
 */
export const ELECTRIC_FAMILIES = Object.freeze([
  "epiano",
  "wurli",
  "clav",
] as const);

export type ElectricFamily = (typeof ELECTRIC_FAMILIES)[number];

export function isElectricFamily(
  instrument: string | undefined,
): instrument is ElectricFamily {
  return (ELECTRIC_FAMILIES as readonly string[]).includes(instrument ?? "");
}

/** Every keys family (the instruments that read `Track.keys`). */
export const KEYS_FAMILIES = Object.freeze([
  ...PIANO_FAMILIES,
  ...ELECTRIC_FAMILIES,
] as const);

export type KeysFamily = (typeof KEYS_FAMILIES)[number];

export function isKeysFamily(
  instrument: string | undefined,
): instrument is KeysFamily {
  return (KEYS_FAMILIES as readonly string[]).includes(instrument ?? "");
}

/** Body EQ voicings (soundboard and case colour). */
export const PIANO_BODIES = Object.freeze([
  "grand",
  "upright",
  "felt",
  "honkytonk",
  "prepared",
] as const);

export type PianoBody = (typeof PIANO_BODIES)[number];

const unit = (
  value: number,
  doc: string,
  automate = false,
  step = 0.05,
): NumberParam => ({
  kind: "number",
  min: 0,
  max: 1,
  default: value,
  step,
  ...(automate ? { automate } : {}),
  doc,
});

/**
 * Every keys parameter, in storage and print order. Defaults are the grand's;
 * a family's own defaults (`PIANO_FAMILY_DEFAULTS`) sit between these and
 * the track's overrides. `automate` parameters have a `keys-<param>` lane,
 * read at each note's onset.
 */
export const KEYS_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze({
  hardness: unit(
    0.5,
    "hammer felt hardness: brightness at a given velocity",
    true,
  ),
  touch: unit(1, "velocity sensitivity (0 plays every note at 0.8)", true),
  inharm: {
    kind: "number",
    min: 0,
    max: 4,
    default: 1,
    step: 0.1,
    unit: "x",
    doc: "inharmonicity multiplier (0 harmonic, 1 grand, 2.5 upright)",
  },
  unison: {
    kind: "number",
    min: 0,
    max: 30,
    default: 0.7,
    step: 0.5,
    unit: "c",
    doc: "detune spread of the unison strings in cents",
  },
  decay: {
    kind: "number",
    min: 0.1,
    max: 4,
    default: 1,
    step: 0.1,
    unit: "x",
    automate: true,
    doc: "sustain time multiplier",
  },
  release: {
    kind: "number",
    min: 0.1,
    max: 4,
    default: 1,
    step: 0.1,
    unit: "x",
    automate: true,
    doc: "damper time multiplier (how fast a released key stops)",
  },
  strike: {
    kind: "number",
    min: 0.04,
    max: 0.3,
    default: 0.12,
    step: 0.01,
    doc: "hammer position along the string",
  },
  after: unit(0.3, "aftersound share (the slow second stage of the decay)"),
  knock: unit(0.5, "soundboard knock and hammer thump", true),
  noise: unit(0.25, "key-off and damper mechanics", true),
  felt: unit(0, "felt strip between hammers and strings", true),
  prep: unit(0, "share of keys carrying a preparation (seeded per key)"),
  width: unit(0.6, "keyboard stereo spread, bass left and treble right"),
  stretch: unit(
    1,
    "octave stretch from the strings' own inharmonicity; 0 keeps tuning exact",
  ),
  body: {
    kind: "enum",
    values: PIANO_BODIES,
    default: "grand",
    optional: true,
    doc: "body EQ voicing (default: the family's own)",
  },
  vib: {
    kind: "number",
    min: 0,
    max: 64,
    default: 0,
    step: 0.25,
    unit: "Hz",
    doc: "pitch wobble rate (tape wow); 0 is off; note vibrato replaces it",
    strudel: ["vib", "vibrato", "v"],
  },
  vibmod: {
    kind: "number",
    min: 0,
    max: 24,
    default: 0.5,
    step: 0.05,
    unit: "st",
    doc: "pitch wobble depth in semitones",
    strudel: ["vibmod", "vmod"],
  },
  // keys-electric (0.6.1): epiano, wurli and clav rows.
  bark: unit(0.35, "pickup drive: growl when played hard (epiano, wurli)"),
  bell: unit(0.5, "tine or reed bell ping (epiano, wurli)"),
  tone: {
    kind: "number",
    min: 0,
    max: 12000,
    default: 0,
    step: 100,
    unit: "Hz",
    automate: true,
    doc: "output low-pass of the electric keys; 0 is off",
  },
  pickup: {
    kind: "enum",
    values: ["neck", "bridge", "both", "out"],
    default: "both",
    doc: "clav pickup switch; out is both pickups out of phase",
  },
  mute: unit(0, "clav mute slider: damps the upper partials"),
  vibe: unit(
    0,
    "suitcase stereo vibrato depth: antiphase left/right pan (epiano)",
    true,
  ),
  vibehz: {
    kind: "number",
    min: 0.5,
    max: 12,
    default: 4,
    step: 0.25,
    unit: "Hz",
    doc: "suitcase vibrato rate (epiano)",
  },
  trem: unit(0, "reed piano tremolo depth at 5.6 Hz (wurli)", true),
  // keys-electric (0.6.1): piano sympathetic resonance (pianos only; 0 keeps
  // 0.6.0 renders byte-identical).
  sym: unit(
    0,
    "sympathetic string resonance while the sustain pedal is down; 0 is off",
  ),
});

/**
 * The families each keys parameter applies to (menus and listings show a
 * track only its family's rows). A parameter missing here is a piano row.
 */
export const KEYS_PARAM_FAMILIES: Readonly<
  Record<string, readonly KeysFamily[]>
> = Object.freeze({
  hardness: KEYS_FAMILIES,
  touch: KEYS_FAMILIES,
  decay: KEYS_FAMILIES,
  release: KEYS_FAMILIES,
  width: KEYS_FAMILIES,
  vib: KEYS_FAMILIES,
  vibmod: KEYS_FAMILIES,
  bark: ["epiano", "wurli"],
  bell: ["epiano", "wurli"],
  tone: ELECTRIC_FAMILIES,
  pickup: ["clav"],
  mute: ["clav"],
  vibe: ["epiano"],
  vibehz: ["epiano"],
  trem: ["wurli"],
});

/** The keys parameters a family reads, in `KEYS_PARAMS` order. */
export function keysParamsFor(instrument: string | undefined): string[] {
  const family = isKeysFamily(instrument) ? instrument : "grand";
  return Object.keys(KEYS_PARAMS).filter((name) => {
    const families = KEYS_PARAM_FAMILIES[name];
    return families ? families.includes(family) : isPianoFamily(family);
  });
}

/** The parameters shown first in the menu and `keys` listing. */
export const KEYS_SIMPLE = Object.freeze([
  "hardness",
  "decay",
  "release",
  "felt",
]);

/** The electric families' first rows. */
export const ELECTRIC_SIMPLE: Readonly<
  Record<ElectricFamily, readonly string[]>
> = Object.freeze({
  epiano: Object.freeze(["bark", "bell", "tone", "vibe"]),
  wurli: Object.freeze(["bark", "bell", "tone", "trem"]),
  clav: Object.freeze(["pickup", "mute", "tone", "decay"]),
});

/** The first rows for a keys family. */
export function keysSimpleFor(
  instrument: string | undefined,
): readonly string[] {
  return isElectricFamily(instrument)
    ? ELECTRIC_SIMPLE[instrument]
    : KEYS_SIMPLE;
}

export type TrackKeys = Readonly<
  Record<string, number | string> & { preset?: string }
>;

/** Each family's own defaults over the grand's (`KEYS_PARAMS`). */
export const PIANO_FAMILY_DEFAULTS: Readonly<
  Record<PianoFamily, Readonly<Record<string, number | string>>>
> = Object.freeze({
  grand: Object.freeze({ body: "grand" }),
  upright: Object.freeze({ inharm: 2.5, decay: 0.6, body: "upright" }),
  felt: Object.freeze({
    felt: 1,
    hardness: 0.3,
    noise: 0.6,
    body: "felt",
  }),
  honkytonk: Object.freeze({ unison: 16, hardness: 0.7, body: "honkytonk" }),
  prepared: Object.freeze({ prep: 0.6, body: "prepared" }),
});

/** Each electric family's own defaults over `KEYS_PARAMS`. */
export const ELECTRIC_FAMILY_DEFAULTS: Readonly<
  Record<ElectricFamily, Readonly<Record<string, number | string>>>
> = Object.freeze({
  epiano: Object.freeze({ width: 0.3, tone: 6000 }),
  wurli: Object.freeze({ width: 0.3, bark: 0.5, bell: 0.2, tone: 5000 }),
  clav: Object.freeze({ width: 0.3 }),
});

/** Effects a preset sets with the voice (applied over the effect defaults). */
export type KeysPresetFx = Readonly<{
  /** The track filter (`Track.filter`). */
  filter?: Readonly<{ cutoff: number; resonance: number; type?: "lpf" }>;
  /** Chain effects (`Track.fx`), merged over the track's own. */
  fx?: Readonly<Record<string, Readonly<Record<string, number | string>>>>;
  reverb?: Readonly<{ mix: number; size: number }>;
}>;

export type KeysPreset = Readonly<{
  instrument: KeysFamily;
  /** The preset's overrides over the family defaults. */
  keys: Readonly<Record<string, number | string>>;
  doc: string;
  /** Styles it suits (shown in /help and the agent prompt). */
  styles: string;
}> &
  KeysPresetFx;

/**
 * Named starting points. Loading one stores `keys: { preset }` (replacing
 * any overrides, the synth rule); its overrides are read at render, so a
 * later `keys hardness 0.4` tweaks the preset.
 */
export const KEYS_PRESETS: Readonly<Record<string, KeysPreset>> = Object.freeze(
  {
    grand: {
      instrument: "grand",
      keys: {},
      doc: "concert grand, bright and long, three-string unisons",
      styles: "Chopin, Beethoven, Brahms, Debussy, jazz, Glass, hyperpop",
    },
    ballad: {
      instrument: "grand",
      keys: { hardness: 0.3, after: 0.5, decay: 1.3 },
      reverb: { mix: 0.25, size: 0.7 },
      doc: "darker grand, soft hammer, more aftersound, in a room",
      styles: "dark ballads, Mitski, Sakamoto, Brahms intermezzi",
    },
    upright: {
      instrument: "upright",
      keys: {},
      doc: "boxy, more inharmonic, shorter",
      styles: "soul, Motown, indie, Beach House",
    },
    felt: {
      instrument: "felt",
      keys: {},
      reverb: { mix: 0.2, size: 0.5 },
      doc: "felt strip down, muted and intimate, audible mechanics",
      styles: "Sakamoto, Eno, Nils Frahm, The Field, Four Tet",
    },
    lofi: {
      instrument: "felt",
      keys: { vib: 0.3, vibmod: 0.05 },
      filter: { cutoff: 3500, resonance: 0.1 },
      fx: { crush: { bits: 10 } },
      doc: "felt piano with tape wow, a dark filter and a little crush",
      styles: "lo-fi hip hop, bedroom pop, chillhop",
    },
    honkytonk: {
      instrument: "honkytonk",
      keys: {},
      doc: "16-cent unisons, bright saloon upright",
      styles: "ragtime, saloon, A. G. Cook",
    },
    prepared: {
      instrument: "prepared",
      keys: {},
      doc: "bolts, rubber and screws on 60% of keys (seeded per key)",
      styles: "Cage, Aphex-style, Oneohtrix Point Never",
    },
    // keys-electric (0.6.1)
    epiano: {
      instrument: "epiano",
      keys: {},
      doc: "Rhodes-style stage tine piano: bell and bark with velocity",
      styles: "jazz, soul, Flying Lotus, Radiohead",
    },
    suitcase: {
      instrument: "epiano",
      keys: { vibe: 0.7, vibehz: 4, bark: 0.3 },
      doc: "tine piano with the suitcase stereo vibrato, left and right in turn",
      styles: "70s soul, Stevie Wonder ballads, neo-soul",
    },
    dyno: {
      instrument: "epiano",
      keys: { bell: 0.85, tone: 9000, hardness: 0.7 },
      doc: "bright, bell-heavy tine piano",
      styles: "80s ballads, city pop",
    },
    wurli: {
      instrument: "wurli",
      keys: {},
      doc: "Wurlitzer-style reed piano, nasal and growly",
      styles: "soul, funk, Radiohead, Supertramp",
    },
    clav: {
      instrument: "clav",
      keys: {},
      doc: "clavinet, both pickups",
      styles: "funk, disco, reggae",
    },
    funkclav: {
      instrument: "clav",
      keys: { pickup: "out", mute: 0.3 },
      doc: "clavinet with both pickups out of phase and the mute slider up",
      styles: "Stevie Wonder funk, Bill Withers",
    },
  },
);

export function isKeysPreset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYS_PRESETS, name);
}

export function isKeysParam(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYS_PARAMS, name);
}

/** Spec name for a parameter typed as its name or a Strudel alias. */
export function keysParamName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (isKeysParam(lower)) return lower;
  if (lower === "aftersound") return "after";
  if (lower === "prepared") return "prep";
  for (const [key, spec] of Object.entries(KEYS_PARAMS))
    if (spec.strudel?.some((alias) => alias.toLowerCase() === lower))
      return key;
  return undefined;
}

/** Keys parameters with a `keys-<param>` lane (read at note onsets). */
export const KEYS_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(KEYS_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

/**
 * Validates `Track.keys`: overrides in `KEYS_PARAMS` order, then `preset`.
 * `{}` stays `{}` (its presence turns the modelled piano on); null and
 * undefined are absent.
 */
export function normalizeKeys(input: unknown): TrackKeys | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track keys must be an object or null");
  const params: Record<string, unknown> = {};
  let preset: string | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "preset") {
      if (typeof value !== "string" || !isKeysPreset(value))
        throw new FxValidationError(
          `keys preset must be one of ${Object.keys(KEYS_PRESETS).join(", ")}`,
        );
      preset = value;
      continue;
    }
    if (!isKeysParam(key)) {
      const name = keysParamName(key);
      throw new FxValidationError(
        `keys has no parameter "${key}"${name ? ` (did you mean "${name}"?)` : ""}`,
      );
    }
    params[key] = value;
  }
  const values = normalizeParams(KEYS_PARAMS, params, "keys", false);
  return Object.freeze({
    ...(values as Record<string, number | string>),
    ...(preset ? { preset } : {}),
  });
}

/**
 * Every keys parameter for a track: the grand defaults, then the family's,
 * then the stored preset's, then the stored overrides.
 */
export function resolvedKeys(
  instrument: string,
  keys: TrackKeys | undefined,
): Readonly<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  for (const [key, spec] of Object.entries(KEYS_PARAMS))
    out[key] = spec.default as number | string;
  if (isPianoFamily(instrument))
    Object.assign(out, PIANO_FAMILY_DEFAULTS[instrument]);
  if (isElectricFamily(instrument))
    Object.assign(out, ELECTRIC_FAMILY_DEFAULTS[instrument]);
  const preset = keys?.preset ? KEYS_PRESETS[keys.preset] : undefined;
  if (preset) Object.assign(out, preset.keys);
  for (const [key, value] of Object.entries(keys ?? {}))
    if (key !== "preset") out[key] = value;
  return out;
}

/** Other names for the electric keys presets (keys-electric, 0.6.1). */
const KEYS_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  rhodes: "epiano",
  wurlitzer: "wurli",
  clavinet: "clav",
});

/**
 * What a new write of a keys word stores: `piano` and `grand` become the
 * modelled grand, a preset name its instrument and overrides. Undefined
 * for any other word.
 */
export function pianoWrite(word: string):
  | (Readonly<{
      instrument: KeysFamily;
      keys: TrackKeys;
      preset?: string;
    }> &
      KeysPresetFx)
  | undefined {
  const lower = word.toLowerCase();
  const name =
    lower === "piano" || lower === "uprightpiano"
      ? lower === "piano"
        ? "grand"
        : "upright"
      : lower === "feltpiano"
        ? "felt"
        : (KEYS_ALIASES[lower] ?? lower);
  if (!isKeysPreset(name)) return undefined;
  const preset = KEYS_PRESETS[name]!;
  return Object.freeze({
    instrument: preset.instrument,
    keys: Object.freeze({ preset: name }),
    preset: name,
    ...(preset.filter ? { filter: preset.filter } : {}),
    ...(preset.fx ? { fx: preset.fx } : {}),
    ...(preset.reverb ? { reverb: preset.reverb } : {}),
  });
}
