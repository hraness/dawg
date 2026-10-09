/**
 * The built-in singing voice (0.7 "Voice", lane f07-sing): an LF glottal
 * source through a five-formant Klatt cascade with SATB singer tables,
 * vowel morphs, a choir ensemble and Tuvan throat singing
 * (`src/audio/sing/`). Pure and import-light, like `core/winds.ts`: the
 * parameter table, the presets and the validators that the score, the
 * prompt, the menu, the agent and the SDK printer share.
 *
 * A track plays this engine only when its `instrument` is `"sing"` AND it
 * carries a `sing` object (`{ preset, ...overrides }`). No voice is cloned:
 * the voice is a synthetic source-filter model.
 */
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type EnumParam,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** Instrument value that selects the sing engine. */
export const SING_INSTRUMENT = "sing" as const;

/** Bumped when the LF or formant tables change (joins the stem digest). */
export const SING_VERSION = 1;

export const SING_VOICES = Object.freeze([
  "auto",
  "soprano",
  "alto",
  "tenor",
  "bass",
] as const);
export type SingVoice = (typeof SING_VOICES)[number];

export const SING_VOWELS = Object.freeze(["a", "e", "i", "o", "u"] as const);
/** `"a"` or a two-vowel morph `"a>o"` (validated by `parseVowel`). */
export type SingVowel = string;

export const SING_PRESET_NAMES = Object.freeze([
  "aah",
  "ooh",
  "choir",
  "oohchoir",
  "chorale",
  "airy",
  "glass",
  "lament",
  "soprano",
  "basso",
  "drone",
  "khoomei",
  "sygyt",
  "kargyraa",
] as const);
export type SingPreset = (typeof SING_PRESET_NAMES)[number];

/** Presets that are also instrument words (`/instrument choir`). */
export const SING_WORDS = Object.freeze([
  "aah",
  "ooh",
  "choir",
  "chorale",
  "khoomei",
  "sygyt",
  "kargyraa",
] as const);

/** Browse groups for Sound > browse sounds > Voices. */
export const SING_GROUPS: readonly Readonly<{
  label: string;
  presets: readonly SingPreset[];
}>[] = Object.freeze([
  {
    label: "Choir",
    presets: ["aah", "ooh", "choir", "oohchoir", "chorale", "airy", "glass"],
  },
  { label: "Solo", presets: ["lament", "soprano", "basso"] },
  { label: "Throat", presets: ["drone", "khoomei", "sygyt", "kargyraa"] },
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

/** Lowest and highest drone pitch (C2..G4). */
export const SING_DRONE_RANGE = Object.freeze([36, 67] as const);
/** Harmonic numbers a throat melody may select. */
export const SING_HARMONIC_RANGE = Object.freeze([2, 24] as const);

/**
 * Every sing parameter (formant.md section 4.1). All are optional: an
 * absent one takes the preset's value, then the default here. `automate`
 * ones have a `sing-<param>` lane read every 32-sample control tick.
 * `vowel` also takes a morph (`a>o`) and `harmonics` is a pair; both are
 * validated by `normalizeSing`, not by these rows.
 */
export const SING_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze({
  voice: Object.freeze({
    kind: "enum",
    values: SING_VOICES,
    default: "auto",
    optional: true,
    doc: "formant table: auto picks one per part from its median pitch (bass < F3, tenor < C#4, alto < G4, soprano)",
  }) as EnumParam,
  vowel: Object.freeze({
    kind: "enum",
    values: SING_VOWELS,
    default: "a",
    optional: true,
    doc: "sung vowel; a>o morphs across each note; a note's vowel wins",
    strudel: ["vowel"],
  }) as EnumParam,
  morph: num(0, 1, 1, 0.05, "how far an a>o vowel travels by the note's end", {
    automate: true,
  }),
  formant: num(-12, 12, 0, 0.5, "throat size: formant shift, keeps pitch", {
    unit: "st",
    automate: true,
  }),
  bright: num(0, 1, 0.5, 0.05, "voice quality: breathy and dark .. pressed", {
    automate: true,
  }),
  breath: num(0, 1, 0.12, 0.02, "aspiration noise", { automate: true }),
  jitter: num(0, 3, 0.3, 0.1, "period jitter", { unit: "%" }),
  shimmer: num(0, 1, 0.3, 0.05, "amplitude jitter"),
  attack: num(0.005, 2, 0.08, "log", "onset", {
    unit: "s",
    strudel: ["att"],
  }),
  release: num(0.01, 4, 0.18, "log", "fade after the note", {
    unit: "s",
    strudel: ["rel"],
  }),
  vib: num(0, 9, 5.5, 0.25, "vibrato rate", {
    unit: "Hz",
    strudel: ["vibrato"],
  }),
  vibmod: num(0, 1, 0.3, 0.05, "vibrato depth", {
    unit: "st",
    automate: true,
    strudel: ["vmod"],
  }),
  vibdelay: num(0, 2, 0.25, 0.05, "vibrato fades in after this", {
    unit: "s",
  }),
  voices: num(1, 8, 1, 1, "singers per note (choir)", { integer: true }),
  spread: num(0, 40, 10, 1, "ensemble detune scatter", { unit: "cents" }),
  ring: num(0, 1, 0, 0.05, "singer's formant (bright 3 kHz ring)", {
    automate: true,
  }),
  drone: num(
    SING_DRONE_RANGE[0],
    SING_DRONE_RANGE[1],
    50,
    1,
    "throat singing: a held drone at this pitch; notes steer the overtone",
    { integer: true },
  ),
  overtone: num(0, 1, 0, 0.05, "overtone filter sharpness and level", {
    automate: true,
  }),
  sub: num(0, 1, 0, 0.05, "kargyraa subharmonic (an octave below)", {
    automate: true,
  }),
  gain: num(0, 2, 0.8, 0.05, "engine output"),
});

/** Stored key order after `preset` (`harmonics` sits before `sub`). */
export const SING_KEY_ORDER: readonly string[] = Object.freeze(
  Object.keys(SING_PARAMS).flatMap((key) =>
    key === "sub" ? ["harmonics", "sub"] : [key],
  ),
);

/** The rows shown under Sound > Parameters > Throat. */
export const SING_THROAT_PARAMS = Object.freeze([
  "drone",
  "overtone",
  "harmonics",
  "sub",
] as const);

/** A track's stored sing settings: a preset plus overrides, all optional. */
export type TrackSing = Readonly<{
  preset?: SingPreset;
  voice?: SingVoice;
  vowel?: SingVowel;
  morph?: number;
  formant?: number;
  bright?: number;
  breath?: number;
  jitter?: number;
  shimmer?: number;
  attack?: number;
  release?: number;
  vib?: number;
  vibmod?: number;
  vibdelay?: number;
  voices?: number;
  spread?: number;
  ring?: number;
  /** MIDI 36..67; present turns on throat mode. */
  drone?: number;
  overtone?: number;
  harmonics?: readonly [number, number];
  sub?: number;
  gain?: number;
}>;

/** Every setting resolved: defaults, then the preset, then overrides. */
export type SingSettings = Readonly<{
  voice: SingVoice;
  vowel: SingVowel;
  morph: number;
  formant: number;
  bright: number;
  breath: number;
  jitter: number;
  shimmer: number;
  attack: number;
  release: number;
  vib: number;
  vibmod: number;
  vibdelay: number;
  voices: number;
  spread: number;
  ring: number;
  drone?: number;
  overtone: number;
  harmonics: readonly [number, number];
  sub: number;
  gain: number;
}>;

export const SING_DEFAULTS: SingSettings = Object.freeze({
  voice: "auto",
  vowel: "a",
  morph: 1,
  formant: 0,
  bright: 0.5,
  breath: 0.12,
  jitter: 0.3,
  shimmer: 0.3,
  attack: 0.08,
  release: 0.18,
  vib: 5.5,
  vibmod: 0.3,
  vibdelay: 0.25,
  voices: 1,
  spread: 10,
  ring: 0,
  overtone: 0,
  harmonics: Object.freeze([6, 12]) as readonly [number, number],
  sub: 0,
  gain: 0.8,
});

export type SingPresetEntry = Readonly<{
  settings: SingSettings;
  doc: string;
  styles: string;
}>;

const preset = (
  settings: Partial<SingSettings>,
  doc: string,
  styles: string,
): SingPresetEntry =>
  Object.freeze({
    settings: Object.freeze({ ...SING_DEFAULTS, ...settings }),
    doc,
    styles,
  });

const pair = (lo: number, hi: number): readonly [number, number] =>
  Object.freeze([lo, hi]) as readonly [number, number];

/** Presets (formant.md section 5). */
export const SING_PRESETS: Readonly<Record<SingPreset, SingPresetEntry>> =
  Object.freeze({
    aah: preset(
      { vowel: "a" },
      'warm "aah", one voice, gentle vibrato',
      "wordless leads, Sakamoto, ballads",
    ),
    ooh: preset(
      { vowel: "u", bright: 0.3 },
      'soft rounded "ooh", darker',
      "dark ballad, Beach House, Mitski backing",
    ),
    choir: preset(
      { voices: 6, ring: 0.2 },
      'six-voice "aah" ensemble',
      "Eno, Bach cantata color, pads",
    ),
    oohchoir: preset(
      { voices: 6, vowel: "u", breath: 0.3, bright: 0.35 },
      'six-voice breathy "ooh"',
      "Beach House, shoegaze, ambient",
    ),
    chorale: preset(
      { voices: 4, vibmod: 0.15, ring: 0.35, bright: 0.6 },
      "four voices, little vibrato, clear ring",
      "Bach and Brahms chorales",
    ),
    airy: preset(
      {
        voices: 8,
        breath: 0.35,
        spread: 18,
        attack: 0.6,
        release: 1.2,
        bright: 0.35,
      },
      "eight breathy voices, slow swell",
      "Eno, OPN, Four Tet pads",
    ),
    glass: preset(
      { voices: 4, vowel: "i", formant: 5, bright: 0.8, vibmod: 0 },
      'four bright "ee" voices, no vibrato',
      "OPN, A. G. Cook, hyperpop pads",
    ),
    lament: preset(
      { vowel: "o", formant: -2, vib: 4.5, vibmod: 0.5, vibdelay: 0.4 },
      'solo low "oh", slow wide vibrato',
      "dark ballad, Gesaffelstein intros",
    ),
    soprano: preset(
      { voice: "soprano", ring: 0.5, vib: 6, vibmod: 0.5, bright: 0.65 },
      "solo soprano with an operatic ring",
      "Messiaen, Debussy, wordless arias",
    ),
    basso: preset(
      { voice: "bass", vowel: "o", ring: 0.4 },
      'solo bass "oh"',
      "cantata recitative color, drones",
    ),
    drone: preset(
      {
        voice: "tenor",
        drone: 48,
        overtone: 0.3,
        harmonics: pair(2, 16),
        vibmod: 0,
        release: 1.5,
      },
      "held drone, the melody colors its overtones",
      "La Monte Young, Barbieri, Eno",
    ),
    khoomei: preset(
      {
        voice: "tenor",
        vowel: "o",
        drone: 50,
        overtone: 0.85,
        harmonics: pair(6, 10),
        vibmod: 0,
      },
      "Tuvan khoomei: a D3 drone with a whistled melody",
      "Tuvan khoomei",
    ),
    sygyt: preset(
      {
        voice: "tenor",
        vowel: "u>i",
        drone: 55,
        bright: 0.85,
        overtone: 1,
        harmonics: pair(9, 12),
        vibmod: 0,
      },
      "Tuvan sygyt: a G3 drone with a high flute-like whistle",
      "Tuvan sygyt",
    ),
    kargyraa: preset(
      {
        voice: "bass",
        vowel: "a",
        drone: 45,
        sub: 0.8,
        overtone: 0.25,
        harmonics: pair(5, 9),
        vibmod: 0,
        bright: 0.6,
      },
      "Tuvan kargyraa: an A2 growl with a sub an octave below",
      "Tuvan kargyraa",
    ),
  });

export const DEFAULT_SING_PRESET: SingPreset = "aah";

export function isSingPreset(name: string): name is SingPreset {
  return (SING_PRESET_NAMES as readonly string[]).includes(name);
}

export function isSingWord(word: string): boolean {
  return (SING_WORDS as readonly string[]).includes(word);
}

export function isSingParam(name: string): boolean {
  return (
    name === "harmonics" ||
    Object.prototype.hasOwnProperty.call(SING_PARAMS, name)
  );
}

/** Strudel spelling (`att`, `vmod`) to a sing parameter name. */
export function singParamName(name: string): string | undefined {
  if (isSingParam(name)) return name;
  for (const [key, spec] of Object.entries(SING_PARAMS))
    if (spec.strudel?.includes(name)) return key;
  return undefined;
}

const NOTE_LETTERS: Readonly<Record<string, number>> = Object.freeze({
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
});

/** `D3`, `f#2`, `Bb3` to MIDI (C4 = 60); undefined if not a note name. */
export function singNoteNumber(text: string): number | undefined {
  const match = /^([a-gA-G])(#|b|s)?(-?\d)$/.exec(text.trim());
  if (!match) return undefined;
  const base = NOTE_LETTERS[match[1]!.toLowerCase()]!;
  const accidental =
    match[2] === "#" || match[2] === "s" ? 1 : match[2] ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + base + accidental;
}

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** MIDI to a sharp note name (`50` -> `D3`). */
export function singNoteName(midi: number): string {
  const m = Math.round(midi);
  return `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** A drone as a note name or MIDI number; throws naming both forms. */
export function parseDrone(value: unknown): number {
  const n =
    typeof value === "string"
      ? (singNoteNumber(value) ??
        (/^\d+$/.test(value.trim()) ? Number(value) : undefined))
      : typeof value === "number"
        ? value
        : undefined;
  const [lo, hi] = SING_DRONE_RANGE;
  if (n === undefined || !Number.isInteger(n) || n < lo || n > hi)
    throw new FxValidationError(
      `sing drone must be a note name C2..G4 (e.g. "D3") or a MIDI number ${lo}..${hi}`,
    );
  return n;
}

/**
 * Validates a vowel: `"a"` or a two-vowel morph `"a>o"`. Returns the
 * parts; throws on anything else.
 */
/** Sung spellings of the five vowels (`sing vowels ah oo`). */
const VOWEL_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  ah: "a",
  eh: "e",
  ee: "i",
  oh: "o",
  oo: "u",
});

export function parseVowel(text: string): readonly [string, string?] {
  const parts =
    typeof text === "string"
      ? text
          .trim()
          .toLowerCase()
          .split(">")
          .map((part) => VOWEL_SPELLINGS[part.trim()] ?? part.trim())
      : [];
  const ok = (v: string | undefined): v is string =>
    v !== undefined && (SING_VOWELS as readonly string[]).includes(v);
  if (parts.length === 1 && ok(parts[0])) return Object.freeze([parts[0]]);
  if (parts.length === 2 && ok(parts[0]) && ok(parts[1]))
    return Object.freeze([parts[0], parts[1]]) as readonly [string, string];
  throw new FxValidationError(
    `vowel must be one of ${SING_VOWELS.join(" ")} or a morph like a>o`,
  );
}

/** The canonical text of a vowel (`"A > O"` -> `"a>o"`). */
export function normalizeVowel(text: unknown): SingVowel {
  if (typeof text !== "string")
    throw new FxValidationError(
      `vowel must be one of ${SING_VOWELS.join(" ")} or a morph like a>o`,
    );
  return parseVowel(text).join(">");
}

/**
 * Spelling patterns to a sung vowel, longest first. English diphthongs
 * become two-vowel morphs (the nucleus a singer holds, then the glide).
 */
const SPELLINGS: readonly (readonly [RegExp, SingVowel])[] = Object.freeze([
  [/igh|ie$|i[^aeiou]e$/, "a>i"],
  // final -y is a short i (hap-py, lone-ly, ev-ery); my, why, sky ... are
  // in VOWEL_WORDS
  [/[^aeiou]y$/, "i"],
  [/ou|ow/, "a>u"],
  [/oi|oy/, "o>i"],
  [/ai|ay|ey|eigh|a[^aeiou]e$/, "e>i"],
  [/oo|ew|ue|u[^aeiou]e$/, "u"],
  [/ee|ea|ie|ei/, "i"],
  [/oa|o[^aeiou]e$|o$/, "o"],
  // an open syllable ending in u (hal-le-lu-jah, flu) is u
  [/[^aeiou]u$/, "u"],
  [/au|aw|ah|ar/, "a"],
  [/a/, "a"],
  [/e/, "e"],
  [/i/, "i"],
  [/o/, "o"],
  [/u/, "a"],
]);

/** Common lyric words the spelling rules get wrong. */
const VOWEL_WORDS: Readonly<Record<string, SingVowel>> = Object.freeze({
  you: "u",
  to: "u",
  do: "u",
  who: "u",
  heart: "a",
  are: "a",
  yeah: "e",
  eye: "a>i",
  eyes: "a>i",
  i: "a>i",
  ...Object.fromEntries(
    [
      "my",
      "by",
      "why",
      "fly",
      "cry",
      "sky",
      "try",
      "dry",
      "shy",
      "spy",
      "fry",
    ].map((word) => [word, "a>i" as const]),
  ),
  love: "a",
  come: "a",
  some: "a",
  one: "a",
  done: "a",
  none: "a",
  above: "a",
  was: "a",
  of: "a",
  the: "a",
});

/**
 * The vowel a lyric syllable sings (its nucleus): `"night"` -> `"a>i"`,
 * `"you"` -> `"u"`, `"la"` -> `"a"`. A bare vowel letter or `a>o` passes
 * through. Undefined when the syllable has no vowel letter.
 */
export function vowelOf(syllable: string | undefined): SingVowel | undefined {
  if (!syllable) return undefined;
  const lower = syllable.toLowerCase();
  try {
    return normalizeVowel(lower);
  } catch {
    // a word, not a vowel
  }
  const word = lower.replace(/[^a-z]/g, "");
  const exception = VOWEL_WORDS[word];
  if (exception) return exception;
  for (const [pattern, vowel] of SPELLINGS)
    if (pattern.test(word)) return vowel;
  return undefined;
}

/**
 * Validates a `sing` field: `{ preset?, ...overrides }`, null or absent
 * meaning none. Keys come out in canonical order (preset, then
 * `SING_PARAMS` order, harmonics before sub). `{}` is kept: it means the
 * default preset.
 */
export function normalizeSing(input: unknown): TrackSing | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track sing must be an object or null");
  const params: Record<string, unknown> = {};
  let presetName: SingPreset | undefined;
  let vowel: SingVowel | undefined;
  let drone: number | undefined;
  let harmonics: readonly [number, number] | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "preset") {
      const name = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (!isSingPreset(name))
        throw new FxValidationError(
          `sing preset must be one of ${SING_PRESET_NAMES.join(", ")}`,
        );
      presetName = name;
      continue;
    }
    const name = singParamName(key);
    if (!name)
      throw new FxValidationError(
        `sing has no parameter "${key.slice(0, 32)}" (try ${[...Object.keys(SING_PARAMS), "harmonics"].join(", ")})`,
      );
    if (name === "vowel") vowel = normalizeVowel(value);
    else if (name === "drone") drone = parseDrone(value);
    else if (name === "harmonics") harmonics = parseHarmonics(value);
    else {
      // A stored count is whole; `voices: 2.5` is a mistake, not a 3.
      const spec = SING_PARAMS[name];
      if (
        spec?.kind === "number" &&
        spec.integer === true &&
        typeof value === "number" &&
        !Number.isInteger(value)
      )
        throw new FxValidationError(`sing ${name} must be a whole number`);
      params[name] = value;
    }
  }
  const values = normalizeParams(SING_PARAMS, params, "sing", false);
  const out: Record<string, unknown> = {};
  if (presetName) out.preset = presetName;
  const special: Record<string, unknown> = { vowel, drone, harmonics };
  for (const key of SING_KEY_ORDER) {
    const value = key in special ? special[key] : values[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.freeze(out) as TrackSing;
}

function parseHarmonics(value: unknown): readonly [number, number] {
  const [lo, hi] = SING_HARMONIC_RANGE;
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((h) => Number.isInteger(h) && h >= lo && h <= hi) ||
    value[0] >= value[1]
  )
    throw new FxValidationError(
      `sing harmonics must be [lo, hi], whole numbers ${lo}..${hi} with lo < hi`,
    );
  return pair(value[0] as number, value[1] as number);
}

/** The preset a `sing` field plays. */
export function singPresetOf(sing: TrackSing | undefined): SingPreset {
  return sing?.preset ?? DEFAULT_SING_PRESET;
}

/**
 * The settings a `sing` field plays: defaults, then the preset, then
 * explicit overrides. `keyRoot` (a pitch class) moves a throat preset's
 * drone to the song's key root in the preset drone's octave when the
 * user set no drone.
 */
export function resolveSing(
  sing: TrackSing | undefined,
  keyRoot?: number,
): SingSettings {
  const base = SING_PRESETS[singPresetOf(sing)].settings;
  const out: Record<string, unknown> = { ...base };
  if (sing)
    for (const [key, value] of Object.entries(sing))
      if (key !== "preset" && value !== undefined) out[key] = value;
  if (
    keyRoot !== undefined &&
    sing?.drone === undefined &&
    base.drone !== undefined
  ) {
    // The key root nearest the preset's drone (within a tritone), so each
    // style keeps its register: sygyt's whistle stays near 2 kHz and
    // kargyraa's growl near A2 in any key.
    const offset = (((Math.round(keyRoot) - base.drone) % 12) + 18) % 12;
    let drone = base.drone + offset - 6;
    if (drone > SING_DRONE_RANGE[1]) drone -= 12;
    if (drone < SING_DRONE_RANGE[0]) drone += 12;
    out.drone = drone;
  }
  return Object.freeze(out) as SingSettings;
}

/** Parameters with a `sing-<param>` automation lane. */
export const SING_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(SING_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

/** The formant table `auto` picks for a MIDI pitch. */
export function autoVoice(pitch: number): Exclude<SingVoice, "auto"> {
  if (pitch < 48) return "bass";
  if (pitch < 55) return "tenor";
  if (pitch < 72) return "alto";
  return "soprano";
}

/**
 * `voice: "auto"` for a whole part: the voice type of the part's median
 * pitch, so an SATB part keeps one formant table across its range (a tenor
 * line around B3-D4 sings the tenor table, not the alto one note by note).
 * Undefined for no pitches.
 */
export function autoPartVoice(
  pitches: readonly number[],
): Exclude<SingVoice, "auto"> | undefined {
  if (pitches.length === 0) return undefined;
  const sorted = [...pitches].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
  if (median < 53) return "bass";
  if (median < 61) return "tenor";
  if (median < 67) return "alto";
  return "soprano";
}

/** Ring after the last note ends, in seconds. */
export function singTailSeconds(sing: TrackSing | undefined): number {
  return resolveSing(sing).release + 0.05;
}

/** Whether a track sings: instrument `sing` with a `sing` field. */
export function singTrack(
  track: Readonly<{ instrument: string; sing?: unknown }> | undefined,
): boolean {
  return (
    track?.instrument === SING_INSTRUMENT &&
    typeof track.sing === "object" &&
    track.sing !== null
  );
}

/** Whether a track sings in throat mode (a drone): play mode is mono. */
export function singThroat(
  track: Readonly<{ instrument: string; sing?: TrackSing }> | undefined,
): boolean {
  return singTrack(track) && resolveSing(track!.sing).drone !== undefined;
}

/** Whether the drone that plays is the preset's, moved to the song key. */
export function singDroneFollows(
  sing: TrackSing | undefined,
  keyRoot?: number,
): boolean {
  return (
    keyRoot !== undefined &&
    sing?.drone === undefined &&
    SING_PRESETS[singPresetOf(sing)].settings.drone !== undefined
  );
}

/** The one-line summary the prompt and menu show. */
export function singSummary(
  sing: TrackSing | undefined,
  keyRoot?: number,
): string {
  const s = resolveSing(sing, keyRoot);
  const parts = [singPresetOf(sing), `vowel ${s.vowel}`];
  if (s.voices > 1) parts.push(`${s.voices} voices`);
  if (s.drone !== undefined)
    parts.push(
      `drone ${singNoteName(s.drone)}${singDroneFollows(sing, keyRoot) ? " (key)" : ""}`,
    );
  if (s.formant !== 0)
    parts.push(`formant ${s.formant > 0 ? "+" : ""}${s.formant}`);
  return parts.join(" · ");
}
