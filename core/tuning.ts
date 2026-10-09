/**
 * Tuning systems: how a MIDI key becomes a frequency.
 *
 * A tuning table lists each degree above the root in cents, ending with the
 * period (normally the 2/1 octave), the way a Scala `.scl` file does. A
 * table comes from an n-EDO, a list of just ratios, a list of cents, a
 * Scala file, or a named preset.
 *
 * Keys map onto the table one step per key from the root key, which is the
 * linear default of Scala, Surge and Ableton Live 12, so a 19-EDO octave
 * spans 19 keys. `map: "nearest"` instead gives each key the table pitch
 * closest to its 12-TET pitch, so music written in 12-TET keeps its shape
 * (a 12-TET melody played in 31-EDO sounds in meantone). Without a Scala
 * keyboard mapping the root key sounds at its 12-TET frequency for the
 * reference A4 (`ref`, 440 Hz by default), as the Surge tuning library's
 * default mapping keeps middle C at 261.63 Hz; a `.kbm` mapping sets its
 * own middle key, reference key and frequency.
 *
 * Pure and deterministic: no file or network access. Callers read `.scl`
 * and `.kbm` files and pass their text to `parseScl` and `parseKbm`.
 */

import { parseKey, SCALES, SCALE_NAMES, type ScaleInfo } from "./chords.ts";
import { midiToPitch } from "./pitch.ts";

export const TUNING_LIMITS = Object.freeze({
  /** Degrees in one table (Scala files may hold more; 128 keys use fewer). */
  maxSteps: 512,
  maxEdo: 128,
  /** |cents| of one table entry. */
  maxCents: 9600,
  /** Ratio numerators and denominators, as the Scala format requires. */
  maxRatioTerm: 2_147_483_647,
  minRefHz: 220,
  maxRefHz: 880,
  /** |cents| of a note's static offset. */
  maxNoteCents: 1200,
  maxNameLength: 64,
  maxPathLength: 256,
});

export class TuningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuningError";
  }
}

export type TuningMap = "linear" | "nearest";
export const TUNING_MAPS: readonly TuningMap[] = Object.freeze([
  "linear",
  "nearest",
]);

/** A Scala keyboard mapping (`.kbm`), resolved. */
export type KeyMapping = Readonly<{
  /** Keys in one repeating pattern; 0 maps every key to the next degree. */
  size: number;
  /** First and last MIDI keys retuned; keys outside keep 12-TET. */
  first: number;
  last: number;
  /** Key the first mapping entry sits on. */
  middle: number;
  /** Key whose frequency is given. */
  refKey: number;
  refHz: number;
  /** Degree whose interval separates two patterns; 0 means the period. */
  octave: number;
  /** Scale degree per pattern key; null leaves the key silent. */
  map: readonly (number | null)[];
}>;

/**
 * A song or track tuning. One table source (`edo`, `ratios`, `cents`) or a
 * library `name`; with a source, `name` is just a label. With neither, a
 * track tuning keeps the song's table and changes only `ref` or `root`.
 */
export type Tuning = Readonly<{
  name?: string;
  edo?: number;
  /** Ratios for degrees 1..n (`9/8`, `3/2`, `2/1`); the last is the period. */
  ratios?: readonly string[];
  /** Cents for degrees 1..n; the last is the period. */
  cents?: readonly number[];
  /** Project path of the `.scl` file the table was read from. */
  scl?: string;
  /** Project path of the `.kbm` file `keymap` was read from. */
  kbm?: string;
  keymap?: KeyMapping;
  /**
   * 12-TET A4 in Hz (440) that fixes the root: the root key sounds at its
   * 12-TET frequency for this A4, so A4 itself sounds at `ref` only when the
   * table keeps A at its 12-TET place (always when the root is an A).
   */
  ref?: number;
  /** MIDI key of degree 0 (the song key's tonic in octave 4, else C4). */
  root?: number;
  map?: TuningMap;
}>;

// ---------------------------------------------------------------------------
// Ratios and cents

/** Cents of a positive ratio. */
export function ratioCents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

/** Parses `3/2` or `2` (Scala ratio syntax) to a number, or undefined. */
export function parseRatio(text: string): number | undefined {
  const match = text.trim().match(/^(\d+)(?:\/(\d+))?$/);
  if (!match) return undefined;
  const top = Number(match[1]);
  const bottom = match[2] === undefined ? 1 : Number(match[2]);
  if (
    top < 1 ||
    bottom < 1 ||
    top > TUNING_LIMITS.maxRatioTerm ||
    bottom > TUNING_LIMITS.maxRatioTerm
  )
    return undefined;
  return top / bottom;
}

export function edoCents(steps: number): number[] {
  return Array.from(
    { length: steps },
    (_, index) => ((index + 1) * 1200) / steps,
  );
}

// ---------------------------------------------------------------------------
// Library

export type TuningFamily =
  | "equal"
  | "just"
  | "historical"
  | "gamelan"
  | "african"
  | "maqam"
  | "dastgah"
  | "raga"
  | "indian";

export type TuningPreset = Readonly<{
  name: string;
  family: TuningFamily;
  about: string;
  /** Degrees 1..n in cents; the last is the period. */
  cents: readonly number[];
  /** The just ratios behind `cents`, when the preset is just. */
  ratios?: readonly string[];
  /** Pitch class of the root when the preset fixes one. */
  root?: number;
  /** True when the values are typical rather than canonical. */
  approximate?: boolean;
  aliases?: readonly string[];
}>;

function fromRatios(ratios: readonly string[]): number[] {
  return ratios.map((ratio) => ratioCents(parseRatio(ratio)!));
}

const PYTHAGOREAN = [
  "2187/2048",
  "9/8",
  "32/27",
  "81/64",
  "4/3",
  "729/512",
  "3/2",
  "6561/4096",
  "27/16",
  "16/9",
  "243/128",
  "2/1",
];
const JUST_5 = [
  "16/15",
  "9/8",
  "6/5",
  "5/4",
  "4/3",
  "45/32",
  "3/2",
  "8/5",
  "5/3",
  "9/5",
  "15/8",
  "2/1",
];
const JUST_7 = [
  "16/15",
  "9/8",
  "7/6",
  "5/4",
  "4/3",
  "7/5",
  "3/2",
  "8/5",
  "5/3",
  "7/4",
  "15/8",
  "2/1",
];
/** Kyle Gann's published key map of The Well-Tuned Piano, from E♭. */
const WELL_TUNED_PIANO = [
  "567/512",
  "9/8",
  "147/128",
  "21/16",
  "1323/1024",
  "189/128",
  "3/2",
  "49/32",
  "7/4",
  "441/256",
  "63/32",
  "2/1",
];
/** The twelve svaras in their common just ratios, from Sa. */
const HINDUSTANI = [
  "16/15",
  "9/8",
  "6/5",
  "5/4",
  "4/3",
  "45/32",
  "3/2",
  "8/5",
  "5/3",
  "16/9",
  "15/8",
  "2/1",
];
/** The 22 shrutis, from Sa. */
const SHRUTIS = [
  "256/243",
  "16/15",
  "10/9",
  "9/8",
  "32/27",
  "6/5",
  "5/4",
  "81/64",
  "4/3",
  "27/20",
  "45/32",
  "729/512",
  "3/2",
  "128/81",
  "8/5",
  "5/3",
  "27/16",
  "16/9",
  "9/5",
  "15/8",
  "243/128",
  "2/1",
];

const FIXED_PRESETS: readonly TuningPreset[] = [
  {
    name: "12-tet",
    family: "equal",
    about: "twelve-tone equal temperament, the default",
    cents: edoCents(12),
    aliases: ["12edo", "12-edo", "12tet", "12-et", "equal", "et", "standard"],
  },
  {
    name: "19-edo",
    family: "equal",
    about: "19 equal steps: meantone-like thirds, 19 keys per octave",
    cents: edoCents(19),
    aliases: ["19edo", "19-tet", "19tet"],
  },
  {
    name: "24-edo",
    family: "equal",
    about: "24 equal steps: quarter tones, 24 keys per octave",
    cents: edoCents(24),
    aliases: ["24edo", "24-tet", "24tet", "quarter-tone", "quarter-tones"],
  },
  {
    name: "31-edo",
    family: "equal",
    about: "31 equal steps: near quarter-comma meantone, 31 keys per octave",
    cents: edoCents(31),
    aliases: ["31edo", "31-tet", "31tet"],
  },
  {
    name: "pythagorean",
    family: "historical",
    about: "pure 3/2 fifths from E♭ to G♯ (the wolf between them)",
    cents: fromRatios(PYTHAGOREAN),
    ratios: PYTHAGOREAN,
    aliases: ["pythag", "3-limit"],
  },
  {
    name: "just",
    family: "just",
    about: "5-limit just intonation: pure 5/4 thirds and 3/2 fifths",
    cents: fromRatios(JUST_5),
    ratios: JUST_5,
    aliases: ["ji", "5-limit", "just-intonation", "ptolemaic"],
  },
  {
    name: "7-limit",
    family: "just",
    about: "7-limit just intonation: septimal 7/6, 7/5 and 7/4",
    cents: fromRatios(JUST_7),
    ratios: JUST_7,
    aliases: ["septimal", "7-limit-ji"],
  },
  {
    name: "well-tuned-piano",
    family: "just",
    about:
      "La Monte Young's Well-Tuned Piano key map (7-limit, from E♭, after Gann)",
    cents: fromRatios(WELL_TUNED_PIANO),
    ratios: WELL_TUNED_PIANO,
    root: 3,
    aliases: ["wtp", "young", "la-monte-young"],
  },
  {
    name: "pelog",
    family: "gamelan",
    about:
      "Javanese pelog, 7 notes (Kunst's average of 39 gamelans; every gamelan differs)",
    cents: [120, 270, 540, 670, 785, 950, 1200],
    approximate: true,
  },
  {
    name: "slendro",
    family: "gamelan",
    about:
      "Javanese slendro, 5 notes (Surjodiningrat's average of 30 gamelans; every gamelan differs)",
    cents: [231, 474, 717, 955, 1200],
    approximate: true,
  },
  {
    name: "thai",
    family: "equal",
    about:
      "Thai and Khmer seven-tone equidistant tuning, about 171 cents a step (Morton's theoretical norm; every ensemble differs)",
    cents: edoCents(7),
    approximate: true,
    aliases: ["7-edo", "7edo", "7-tet", "khmer"],
  },
  {
    name: "nyamaropa",
    family: "african",
    about:
      "Shona mbira nyamaropa-style, 7 notes (John Kunaka's mbira after Berliner; every mbira differs)",
    cents: [196, 377, 506, 676, 877, 1050, 1200],
    approximate: true,
    aliases: ["mbira"],
  },
  {
    name: "hindustani",
    family: "indian",
    about: "the twelve svaras in common just ratios, from Sa",
    cents: fromRatios(HINDUSTANI),
    ratios: HINDUSTANI,
    aliases: ["svara", "sargam"],
  },
  {
    name: "shruti",
    family: "indian",
    about: "the 22 shrutis, 22 keys per octave",
    cents: fromRatios(SHRUTIS),
    ratios: SHRUTIS,
    aliases: ["22-shruti", "shrutis", "sruti"],
  },
];

/**
 * A twelve-key table that retunes a library scale's degrees: maqam and
 * dastgah quarter tones lower the natural key a quarter tone (as Arabic
 * keyboards' scale presets do); ragas apply their shruti intonation over
 * the Hindustani just table.
 */
function scalePreset(name: string, info: ScaleInfo): TuningPreset | undefined {
  const quarter = info.steps.some((step) => !Number.isInteger(step));
  if (!quarter && !info.intonation) return undefined;
  // Quarter-tone art scales keep both a key and its shadow: note cents
  // carry them, so no twelve-key table can.
  if (info.family === "quarter-tone") return undefined;
  const raga = info.family === "raga";
  const table = raga ? fromRatios(HINDUSTANI) : edoCents(12);
  const keys = [0, ...table.slice(0, 11)];
  info.steps.forEach((step, index) => {
    const key = Math.ceil(step) % 12;
    if (key === 0) return;
    keys[key] = info.intonation?.[index] ?? step * 100;
  });
  return {
    name,
    family:
      info.family === "raga"
        ? "raga"
        : info.family === "dastgah"
          ? "dastgah"
          : info.family === "overtone"
            ? "just"
            : "maqam",
    about: raga
      ? `raga ${name} with its shruti intonation over the Hindustani just table`
      : info.family === "overtone"
        ? `partials 8 to 15 of the harmonic series over the tonic, in just cents`
        : `${info.family} ${name} quarter tones on the twelve keys (24-tone convention)`,
    cents: [...keys.slice(1), 1200],
    approximate: true,
  };
}

const SCALE_PRESETS: readonly TuningPreset[] = SCALE_NAMES.flatMap((name) => {
  const preset = scalePreset(name, SCALES[name]);
  return preset ? [preset] : [];
});

export const TUNING_PRESETS: readonly TuningPreset[] = Object.freeze([
  ...FIXED_PRESETS,
  ...SCALE_PRESETS,
]);
export const TUNING_NAMES: readonly string[] = Object.freeze(
  TUNING_PRESETS.map((preset) => preset.name),
);

const PRESET_INDEX: ReadonlyMap<string, TuningPreset> = (() => {
  const index = new Map<string, TuningPreset>();
  for (const preset of TUNING_PRESETS) {
    index.set(preset.name, preset);
    for (const alias of preset.aliases ?? []) index.set(alias, preset);
  }
  return index;
})();

/** The library tuning named `text` (case, space and `-` insensitive). */
export function tuningPreset(text: string): TuningPreset | undefined {
  const word = text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return PRESET_INDEX.get(word) ?? PRESET_INDEX.get(word.replace(/-/g, ""));
}

// ---------------------------------------------------------------------------
// Scala files

export type ScalaScale = Readonly<{
  description: string;
  /** Degrees 1..n in cents. */
  cents: readonly number[];
  /** The degrees as ratios when every line is a ratio. */
  ratios?: readonly string[];
}>;

/**
 * Parses a Scala `.scl` file: `!` comment lines, a description line, the
 * note count, then one pitch per line (a value with a period is cents,
 * otherwise a ratio `a/b` or integer `a`; anything after the value is
 * ignored; the 1/1 unison is implicit and the last pitch is the period).
 */
export function parseScl(text: string): ScalaScale {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("!"));
  if (lines.length === 0) throw new TuningError(".scl: missing description");
  const description = lines[0]!.trim();
  const rest = lines.slice(1).filter((line) => line.trim() !== "");
  const countText = rest[0]?.trim().split(/\s+/)[0] ?? "";
  if (!/^\d+$/.test(countText))
    throw new TuningError(
      ".scl: the line after the description must be the note count",
    );
  const count = Number(countText);
  if (count < 1)
    throw new TuningError(
      ".scl: a scale needs at least one pitch (its period)",
    );
  if (count > TUNING_LIMITS.maxSteps)
    throw new TuningError(`.scl: at most ${TUNING_LIMITS.maxSteps} notes`);
  const pitchLines = rest.slice(1, 1 + count);
  if (pitchLines.length < count)
    throw new TuningError(
      `.scl: expected ${count} pitches, found ${pitchLines.length}`,
    );
  const cents: number[] = [];
  const ratios: string[] = [];
  pitchLines.forEach((line, index) => {
    const value = line.trim().split(/\s+/)[0] ?? "";
    if (value.includes(".")) {
      if (!/^-?(\d+\.\d*|\.\d+)$/.test(value))
        throw new TuningError(
          `.scl: pitch ${index + 1} "${value}" is not a cents value`,
        );
      cents.push(Number(value));
      return;
    }
    const ratio = parseRatio(value);
    if (ratio === undefined)
      throw new TuningError(
        `.scl: pitch ${index + 1} "${value}" is not a positive ratio or cents value`,
      );
    cents.push(ratioCents(ratio));
    ratios.push(value.includes("/") ? value : `${value}/1`);
  });
  checkTable(cents, ".scl");
  return Object.freeze({
    description,
    cents: Object.freeze(cents),
    ...(ratios.length === count ? { ratios: Object.freeze(ratios) } : {}),
  });
}

/**
 * Parses a Scala `.kbm` keyboard mapping: map size, first and last keys
 * to retune, middle key, reference key, its frequency, the formal-octave
 * degree, then one degree (or `x` for an unmapped key) per pattern key;
 * trailing unmapped keys may be left out.
 */
export function parseKbm(text: string): KeyMapping {
  const values = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("!") && line.trim() !== "")
    .map((line) => line.trim().split(/\s+/)[0]!);
  const fields = [
    "map size",
    "first key",
    "last key",
    "middle key",
    "reference key",
    "reference frequency",
    "formal octave degree",
  ];
  if (values.length < fields.length)
    throw new TuningError(`.kbm: missing the ${fields[values.length]}`);
  const integer = (index: number, min: number, max: number): number => {
    const value = values[index]!;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new TuningError(
        `.kbm: the ${fields[index]} must be an integer from ${min} to ${max}`,
      );
    return Number(value);
  };
  const size = integer(0, 0, TUNING_LIMITS.maxSteps);
  const first = integer(1, 0, 127);
  const last = integer(2, 0, 127);
  const middle = integer(3, 0, 127);
  const refKey = integer(4, 0, 127);
  const refHz = Number(values[5]);
  if (
    !/^\d*\.?\d+$|^\d+\.$/.test(values[5]!) ||
    !(refHz > 0) ||
    refHz > 100_000
  )
    throw new TuningError(
      ".kbm: the reference frequency must be a positive number of Hz",
    );
  const octave = integer(6, 0, TUNING_LIMITS.maxSteps);
  const entries = values.slice(7);
  if (entries.length > size)
    throw new TuningError(
      `.kbm: ${entries.length} mapping entries for a map of size ${size}`,
    );
  const map = entries.map((entry, index) => {
    if (entry === "x" || entry === "X") return null;
    if (!/^\d+$/.test(entry))
      throw new TuningError(
        `.kbm: mapping entry ${index + 1} "${entry}" must be a degree or x`,
      );
    return Number(entry);
  });
  while (map.length < size) map.push(null);
  return normalizeKeyMapping(
    { size, first, last, middle, refKey, refHz, octave, map },
    ".kbm",
  );
}

/**
 * Fills a plain song or track tuning's `scl` table and `kbm` keymap from
 * project files. `read` returns a file's text, or undefined when it is
 * missing. A tuning without `scl` or `kbm` comes back unchanged.
 */
export function readTuningFiles(
  input: unknown,
  read: (path: string) => string | undefined,
  where: string,
): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = { ...input };
  const load = (field: "scl" | "kbm"): string | undefined => {
    if (input[field] === undefined || input[field] === null) return undefined;
    const path = projectPath(input[field], `${where} ${field}`, `.${field}`);
    const text = read(path);
    if (text === undefined)
      throw new TuningError(`${where} ${field} file ${path} not found`);
    return text;
  };
  const scl = load("scl");
  if (scl !== undefined) {
    if (input.edo != null || input.ratios != null || input.cents != null)
      throw new TuningError(
        `${where}: scl is the table; drop edo, ratios and cents`,
      );
    const scale = withFile(String(input.scl), () => parseScl(scl));
    if (scale.ratios) out.ratios = scale.ratios;
    else out.cents = scale.cents;
  }
  const kbm = load("kbm");
  if (kbm !== undefined)
    out.keymap = withFile(String(input.kbm), () => parseKbm(kbm));
  return out;
}

function withFile<T>(path: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TuningError(`${path}: ${message.replace(/^\.(scl|kbm): /, "")}`);
  }
}

// ---------------------------------------------------------------------------
// Validation

function checkTable(cents: readonly number[], where: string): void {
  if (cents.length < 1 || cents.length > TUNING_LIMITS.maxSteps)
    throw new TuningError(
      `${where} needs 1 to ${TUNING_LIMITS.maxSteps} steps`,
    );
  for (const value of cents)
    if (!Number.isFinite(value) || Math.abs(value) > TUNING_LIMITS.maxCents)
      throw new TuningError(
        `${where} cents must be within ±${TUNING_LIMITS.maxCents}`,
      );
  if (!(cents[cents.length - 1]! > 0))
    throw new TuningError(
      `${where} period (the last step) must be above the root`,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectPath(value: unknown, where: string, extension: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > TUNING_LIMITS.maxPathLength ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    value.split(/[\\/]/).includes("..") ||
    !value.toLowerCase().endsWith(extension)
  )
    throw new TuningError(
      `${where} must be a ${extension} path inside the project`,
    );
  return value;
}

export function normalizeKeyMapping(input: unknown, where: string): KeyMapping {
  if (!isRecord(input))
    throw new TuningError(`${where} keymap must be an object`);
  const key = (field: string): number => {
    const value = input[field];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 127
    )
      throw new TuningError(
        `${where} keymap ${field} must be a MIDI key 0-127`,
      );
    return value;
  };
  const size = input.size;
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 0 ||
    size > TUNING_LIMITS.maxSteps
  )
    throw new TuningError(
      `${where} keymap size must be an integer from 0 to ${TUNING_LIMITS.maxSteps}`,
    );
  const octave = input.octave;
  if (
    typeof octave !== "number" ||
    !Number.isInteger(octave) ||
    octave < 0 ||
    octave > TUNING_LIMITS.maxSteps
  )
    throw new TuningError(
      `${where} keymap octave must be a degree from 0 to ${TUNING_LIMITS.maxSteps}`,
    );
  const refHz = input.refHz;
  if (
    typeof refHz !== "number" ||
    !Number.isFinite(refHz) ||
    refHz <= 0 ||
    refHz > 100_000
  )
    throw new TuningError(`${where} keymap refHz must be a positive frequency`);
  const map = input.map;
  if (!Array.isArray(map) || map.length !== size)
    throw new TuningError(`${where} keymap map must list ${size} entries`);
  for (const entry of map)
    if (
      entry !== null &&
      (typeof entry !== "number" ||
        !Number.isInteger(entry) ||
        entry < 0 ||
        entry > TUNING_LIMITS.maxSteps * 128)
    )
      throw new TuningError(`${where} keymap entries must be degrees or null`);
  const mapping: KeyMapping = {
    size,
    first: key("first"),
    last: key("last"),
    middle: key("middle"),
    refKey: key("refKey"),
    refHz,
    octave,
    map: Object.freeze([...(map as (number | null)[])]),
  };
  if (mapping.first > mapping.last)
    throw new TuningError(`${where} keymap first key is above its last key`);
  if (mappedEntry(mapping, mapping.refKey) === undefined)
    throw new TuningError(
      `${where} keymap reference key ${mapping.refKey} is unmapped`,
    );
  return Object.freeze(mapping);
}

/**
 * Validates and canonicalizes a song or track tuning; null and undefined
 * mean none. Throws `TuningError` with a message naming `where`.
 */
export function normalizeTuning(
  input: unknown,
  where: string,
): Tuning | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return normalizeTuning({ name: input }, where);
  if (!isRecord(input)) throw new TuningError(`${where} must be an object`);
  const known = new Set([
    "name",
    "edo",
    "ratios",
    "cents",
    "scl",
    "kbm",
    "keymap",
    "ref",
    "root",
    "map",
  ]);
  for (const field of Object.keys(input))
    if (!known.has(field))
      throw new TuningError(`${where} has an unknown field "${field}"`);
  const out: Record<string, unknown> = {};
  const sources = ["edo", "ratios", "cents"].filter(
    (field) => input[field] !== undefined && input[field] !== null,
  );
  if (sources.length > 1)
    throw new TuningError(
      `${where} takes one of edo, ratios or cents, not ${sources.join(" and ")}`,
    );
  if (input.name !== undefined && input.name !== null) {
    if (
      typeof input.name !== "string" ||
      input.name.trim() === "" ||
      input.name.length > TUNING_LIMITS.maxNameLength
    )
      throw new TuningError(`${where} name must be a short string`);
    if (sources.length === 0) {
      const preset = tuningPreset(input.name);
      if (!preset)
        throw new TuningError(
          `${where}: unknown tuning "${input.name}" (try ${TUNING_NAMES.slice(0, 12).join(", ")}, …)`,
        );
      out.name = preset.name;
    } else out.name = input.name.trim();
  }
  if (input.edo !== undefined && input.edo !== null) {
    const edo = input.edo;
    if (
      typeof edo !== "number" ||
      !Number.isInteger(edo) ||
      edo < 1 ||
      edo > TUNING_LIMITS.maxEdo
    )
      throw new TuningError(
        `${where} edo must be an integer from 1 to ${TUNING_LIMITS.maxEdo}`,
      );
    out.edo = edo;
  }
  if (input.ratios !== undefined && input.ratios !== null) {
    if (!Array.isArray(input.ratios))
      throw new TuningError(
        `${where} ratios must be a list like ["9/8", "5/4", "2/1"]`,
      );
    const ratios = input.ratios.map((ratio, index) => {
      const text =
        typeof ratio === "number" && Number.isInteger(ratio)
          ? String(ratio)
          : ratio;
      if (typeof text !== "string" || parseRatio(text) === undefined)
        throw new TuningError(
          `${where} ratio ${index + 1} must be a positive ratio like "3/2"`,
        );
      return text.trim();
    });
    checkTable(
      ratios.map((ratio) => ratioCents(parseRatio(ratio)!)),
      `${where} ratios`,
    );
    out.ratios = Object.freeze(ratios);
  }
  if (input.cents !== undefined && input.cents !== null) {
    if (
      !Array.isArray(input.cents) ||
      input.cents.some((value) => typeof value !== "number")
    )
      throw new TuningError(
        `${where} cents must be a list of numbers like [100, 200, 1200]`,
      );
    checkTable(input.cents as number[], `${where} cents`);
    out.cents = Object.freeze([...(input.cents as number[])]);
  }
  if (input.scl !== undefined && input.scl !== null) {
    out.scl = projectPath(input.scl, `${where} scl`, ".scl");
    if (out.ratios === undefined && out.cents === undefined)
      throw new TuningError(
        `${where} scl ${String(input.scl)} has not been read (no ratios or cents)`,
      );
  }
  if (input.kbm !== undefined && input.kbm !== null) {
    out.kbm = projectPath(input.kbm, `${where} kbm`, ".kbm");
    if (input.keymap === undefined || input.keymap === null)
      throw new TuningError(
        `${where} kbm ${String(input.kbm)} has not been read (no keymap)`,
      );
  }
  if (input.keymap !== undefined && input.keymap !== null)
    out.keymap = normalizeKeyMapping(input.keymap, where);
  if (input.ref !== undefined && input.ref !== null) {
    const ref = input.ref;
    if (
      typeof ref !== "number" ||
      !Number.isFinite(ref) ||
      ref < TUNING_LIMITS.minRefHz ||
      ref > TUNING_LIMITS.maxRefHz
    )
      throw new TuningError(
        `${where} ref (12-TET A4 in Hz) must be between ${TUNING_LIMITS.minRefHz} and ${TUNING_LIMITS.maxRefHz}`,
      );
    out.ref = ref;
  }
  if (input.root !== undefined && input.root !== null) {
    const root = input.root;
    if (
      typeof root !== "number" ||
      !Number.isInteger(root) ||
      root < 0 ||
      root > 127
    )
      throw new TuningError(`${where} root must be a MIDI key 0-127`);
    out.root = root;
  }
  if (input.map !== undefined && input.map !== null) {
    if (!TUNING_MAPS.includes(input.map as TuningMap))
      throw new TuningError(`${where} map must be ${TUNING_MAPS.join(" or ")}`);
    if (input.map !== "linear") out.map = input.map;
  }
  if (
    out.keymap &&
    (out.ref !== undefined || out.root !== undefined || out.map !== undefined)
  )
    throw new TuningError(
      `${where}: a keymap sets its own reference and root (drop ref, root and map)`,
    );
  return Object.freeze(out as Tuning);
}

/** Validates a note's static cents offset; 0 and absence are the same. */
export function normalizeNoteCents(
  input: unknown,
  where: string,
): number | undefined {
  if (input === undefined || input === null || input === 0) return undefined;
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    Math.abs(input) > TUNING_LIMITS.maxNoteCents
  )
    throw new TuningError(
      `${where} cents must be within ±${TUNING_LIMITS.maxNoteCents}`,
    );
  return input;
}

// ---------------------------------------------------------------------------
// Resolution

/** Degrees 1..n in cents for a tuning's own table, or undefined to inherit. */
export function tuningTable(tuning: Tuning): readonly number[] | undefined {
  if (tuning.edo !== undefined) return edoCents(tuning.edo);
  if (tuning.ratios)
    return tuning.ratios.map((ratio) => ratioCents(parseRatio(ratio)!));
  if (tuning.cents) return tuning.cents;
  if (tuning.name) return tuningPreset(tuning.name)?.cents;
  return undefined;
}

/** Keys tuned at or above this frequency are silent (unmapped). */
export const TUNING_MAX_HZ = 20_000;

/** A tuning merged from the song and a track, ready to play. */
export type TuningTable = Readonly<{
  /** Frequency of each MIDI key 0..127 in Hz; 0 for an unmapped key. */
  hz: Float64Array;
  /** Steps per period. */
  size: number;
  /** Period in cents. */
  period: number;
  /** Key of degree 0. */
  root: number;
  /** True when keys step through the table one key per degree. */
  linear: boolean;
  /** Display name. */
  name: string;
}>;

function mappedEntry(
  mapping: KeyMapping,
  key: number,
): { pattern: number; degree: number } | undefined {
  const offset = key - mapping.middle;
  if (mapping.size === 0) return { pattern: 0, degree: offset };
  const pattern = Math.floor(offset / mapping.size);
  const entry = mapping.map[offset - pattern * mapping.size];
  if (entry === null || entry === undefined) return undefined;
  return { pattern, degree: entry };
}

/**
 * The merged tuning for a track: the track's table if it has one, else the
 * song's; `ref`, `root`, `map` and the keymap come from the track when it
 * sets them, else the song. Undefined when neither has a tuning, so callers
 * keep their 12-TET path untouched. `keyText` is the song key, whose
 * tonic is the default root.
 */
export function resolveTuning(
  song: Tuning | undefined,
  track: Tuning | undefined,
  keyText?: string | null,
): TuningTable | undefined {
  if (!song && !track) return undefined;
  const own = track ? tuningTable(track) : undefined;
  const source = own ? track! : song;
  const table = (source ? tuningTable(source) : undefined) ?? edoCents(12);
  const keymap = track?.keymap ?? (own ? undefined : song?.keymap);
  const ref = track?.ref ?? song?.ref ?? 440;
  const presetRoot =
    source?.name && !source.edo && !source.ratios && !source.cents
      ? tuningPreset(source.name)?.root
      : undefined;
  const tonic = parseKey(keyText ?? undefined)?.tonic;
  const root = track?.root ?? song?.root ?? 60 + (presetRoot ?? tonic ?? 0);
  const nearest = (track?.map ?? song?.map) === "nearest";
  const size = table.length;
  const period = table[size - 1]!;
  const degreeCents = (degree: number): number => {
    const octave = Math.floor(degree / size);
    const index = degree - octave * size;
    return octave * period + (index === 0 ? 0 : table[index - 1]!);
  };
  const hz = new Float64Array(128);
  if (keymap) {
    const step = keymap.octave === 0 ? period : degreeCents(keymap.octave);
    const centsOf = (key: number): number | undefined => {
      const found = mappedEntry(keymap, key);
      return found
        ? found.pattern * step + degreeCents(found.degree)
        : undefined;
    };
    const refCents = centsOf(keymap.refKey)!;
    for (let key = 0; key < 128; key += 1) {
      if (key < keymap.first || key > keymap.last) {
        hz[key] = ref * 2 ** ((key - 69) / 12);
        continue;
      }
      const cents = centsOf(key);
      hz[key] =
        cents === undefined
          ? 0
          : keymap.refHz * 2 ** ((cents - refCents) / 1200);
    }
  } else {
    const rootHz = ref * 2 ** ((root - 69) / 12);
    for (let key = 0; key < 128; key += 1) {
      const cents = nearest
        ? nearestCents(table, (key - root) * 100)
        : degreeCents(key - root);
      hz[key] = rootHz * 2 ** (cents / 1200);
    }
  }
  const name =
    source?.name ??
    (source?.edo
      ? `${source.edo}-edo`
      : source?.scl
        ? source.scl.split("/").pop()!
        : source
          ? "custom"
          : "12-tet");
  // Keys above the audible range (or overflowing, as `{ edo: 1 }` does at
  // key 127) are unmapped, so voices stay silent instead of aliasing.
  for (let key = 0; key < 128; key += 1)
    if (!Number.isFinite(hz[key]!) || hz[key]! >= TUNING_MAX_HZ) hz[key] = 0;
  return Object.freeze({
    hz,
    size,
    period,
    root: keymap ? keymap.middle : root,
    linear: !keymap && !nearest,
    name,
  });
}

/** The table pitch (any period) closest to `target` cents; lower on ties. */
function nearestCents(table: readonly number[], target: number): number {
  const period = table[table.length - 1]!;
  let best = 0;
  let bestDistance = Infinity;
  for (const step of [0, ...table.slice(0, -1)]) {
    const octave = Math.round((target - step) / period);
    for (const candidate of [
      (octave - 1) * period + step,
      octave * period + step,
      (octave + 1) * period + step,
    ]) {
      const distance = Math.abs(candidate - target);
      if (
        distance < bestDistance - 1e-9 ||
        (Math.abs(distance - bestDistance) <= 1e-9 && candidate < best)
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * A note's frequency: `440 · 2^((pitch − 69)/12)` exactly when there is no
 * tuning and no cents, so untuned projects render byte-identically.
 */
export function noteHz(
  pitch: number,
  cents: number | undefined,
  table: TuningTable | undefined,
): number {
  const base = table ? table.hz[pitch]! : 440 * 2 ** ((pitch - 69) / 12);
  return cents ? base * 2 ** (cents / 1200) : base;
}

/**
 * Cents a key sounds above A4 = 440 Hz in a tuning, for glides between
 * tuned keys (`PerformanceTiming.keyCents`). An unmapped key falls back to
 * its 12-TET place.
 */
export function keyCentsFor(table: TuningTable): (pitch: number) => number {
  return (pitch) => {
    const hz = table.hz[pitch];
    return hz && hz > 0 ? ratioCents(hz / 440) : (pitch - 69) * 100;
  };
}

/** Cents a key sounds away from 12-TET at A4 = 440 Hz (0 when unmapped). */
export function keyDeviation(
  table: TuningTable | undefined,
  pitch: number,
  cents = 0,
): number {
  const hz = noteHz(pitch, cents, table);
  if (!(hz > 0)) return 0;
  return ratioCents(hz / (440 * 2 ** ((pitch - 69) / 12)));
}

/**
 * The key that sounds closest to a 12-TET pitch, measured from the tuning's
 * root. Twelve-key and mapped tunings return the pitch unchanged (JI chords
 * stay on their keys and sound pure); a linear non-12 tuning (19-EDO,
 * pelog) moves it to the nearest step, so a chord written in semitones
 * keeps its shape instead of collapsing into small steps.
 */
export function snapToTuning(
  pitch: number,
  table: TuningTable | undefined,
): number {
  if (!table || !table.linear || table.size === 12) return pitch;
  const rootHz = table.hz[table.root]!;
  if (!(rootHz > 0)) return pitch;
  const target = rootHz * 2 ** ((pitch - table.root) / 12);
  let best = pitch;
  let bestDistance = Infinity;
  for (let key = 0; key < 128; key += 1) {
    const hz = table.hz[key]!;
    if (!(hz > 0)) continue;
    const distance = Math.abs(Math.log2(hz / target));
    if (distance < bestDistance - 1e-12) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/** `+14`, `−32`: a compact signed cents label (empty within ±0.5). */
export function centsLabel(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded === 0) return "";
  return rounded > 0 ? `+${rounded}` : `−${-rounded}`;
}

/** One line describing a tuning, for `/tuning` and the menu. */
export function describeTuning(tuning: Tuning | undefined): string {
  if (!tuning) return "12-tet (default)";
  const parts: string[] = [];
  if (tuning.name) parts.push(tuning.name);
  else if (tuning.edo) parts.push(`${tuning.edo}-edo`);
  if (tuning.scl) parts.push(tuning.scl);
  else if (tuning.ratios) parts.push(`${tuning.ratios.length} ratios`);
  else if (tuning.cents) parts.push(`${tuning.cents.length} steps`);
  if (tuning.kbm) parts.push(tuning.kbm);
  if (tuning.ref !== undefined) parts.push(`A4=${tuning.ref}Hz`);
  if (tuning.root !== undefined) parts.push(`root ${midiToPitch(tuning.root)}`);
  if (tuning.map) parts.push(tuning.map);
  return parts.length > 0 ? parts.join(" · ") : "inherits the song tuning";
}

/**
 * Cents a note sounds away from its nearest 12-TET pitch, folded to ±50, for
 * the highway tag. Undefined when it sounds in 12-TET.
 */
export function displayCents(
  table: TuningTable | undefined,
  pitch: number,
  cents: number | undefined,
): number | undefined {
  if (!table && !cents) return undefined;
  const deviation = keyDeviation(table, pitch, cents ?? 0);
  const folded = deviation - 100 * Math.round(deviation / 100);
  return Math.abs(folded) < 0.5 ? undefined : folded;
}

/**
 * The highway tag for a note. In a twelve-key table the lane is the note the
 * deviation is measured from, so the tag is bare cents (`+14`). In a linear
 * non-12 table (19-EDO, slendro) the lane is just the key, so the tag names
 * the nearest 12-TET pitch class it is measured from (`D−47`, or `C` when it
 * sounds on that pitch). Undefined when the note sounds on its own lane.
 */
export function displayTag(
  table: TuningTable | undefined,
  pitch: number,
  cents: number | undefined,
): { cents?: number; name?: string } | undefined {
  if (!table || !table.linear || table.size === 12) {
    const folded = displayCents(table, pitch, cents);
    return folded === undefined ? undefined : { cents: folded };
  }
  const hz = noteHz(pitch, cents, table);
  if (!(hz > 0)) return undefined;
  const semitones = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(semitones);
  const off = (semitones - nearest) * 100;
  if (nearest === pitch && Math.abs(off) < 0.5) return undefined;
  const name = midiToPitch(Math.max(0, Math.min(127, nearest))).replace(
    /-?\d+$/,
    "",
  );
  return Math.abs(off) < 0.5 ? { name } : { cents: off, name };
}
