/**
 * Chords: vocabulary, key-mode harmony, voice leading, bass, performance
 * (block, strum, arpeggio, harp) and a seeded progression engine. Pure and
 * deterministic; shared by play mode, the agent tools and the SDK docs.
 *
 * Two layers, kept apart on purpose:
 *
 * - Orchid-style input (Telepathic Instruments ORC-1). Four chord-type
 *   buttons (dim, min, maj, sus) pick the triad and four extension buttons
 *   (6, m7, M7, 9) add notes; any number of extensions combine with one
 *   type. "Key mode" makes every key play a chord that fits the song key
 *   (in C major, D plays D minor). The voicing control rotates the chord:
 *   one step moves the lowest note up an octave, or the highest down.
 *   Bass plays one note under each chord. Those behaviours come from the
 *   Orchid support articles and reviews (see DAWG.md, Chords).
 *   The "secret chords" (`COMBINED_TYPES`) follow the Orchid manual's
 *   table (section 14.8, firmware 3.84+): dim+sus power chord, maj+sus
 *   augmented, min+sus m(add4), min+dim with 6 m(b6), maj+dim with 6
 *   (b6), maj+min with m7 7#9. Slop (humanised timing) is an Orchid
 *   performance mode too.
 * - dawg's own design. A secret chord plays even when its extension button
 *   is not latched (terminals have no chords of held keys), three held
 *   types use the first two, non-scale keys in key mode, the voice leader
 *   (minimal movement from the previous chord), spread, the perform
 *   timings, slop amounts and the progression graph.
 */

// ---------------------------------------------------------------------------
// Vocabulary

/** The four Orchid chord-type buttons. */
export const CHORD_TYPES = ["dim", "min", "maj", "sus"] as const;
export type ChordType = (typeof CHORD_TYPES)[number];

/** The four Orchid extension buttons. */
export const EXTENSIONS = ["6", "m7", "M7", "9"] as const;
export type Extension = (typeof EXTENSIONS)[number];

/** Triad qualities: the four buttons plus dawg's two-button combinations. */
export const QUALITIES = [
  "maj",
  "min",
  "dim",
  "sus4",
  "aug",
  "sus2",
  "5",
  "madd4",
  "mb6",
  "b6",
  "7#9",
] as const;
export type Quality = (typeof QUALITIES)[number];

const QUALITY_INTERVALS: Readonly<Record<Quality, readonly number[]>> =
  Object.freeze({
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    sus4: [0, 5, 7],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    "5": [0, 7],
    madd4: [0, 3, 5, 7],
    mb6: [0, 3, 7, 8],
    b6: [0, 4, 7, 8],
    "7#9": [0, 4, 7, 10, 15],
  });

/**
 * The extension button a secret chord is built with: it is part of the
 * chord, so `makeChord` drops it rather than stacking it again.
 */
const SECRET_EXTENSION: Readonly<Partial<Record<Quality, Extension>>> =
  Object.freeze({ mb6: "6", b6: "6", "7#9": "m7" });

const EXTENSION_INTERVAL: Readonly<Record<Extension, number>> = Object.freeze({
  "6": 9,
  m7: 10,
  M7: 11,
  "9": 14,
});

/**
 * Two chord-type buttons held together: Orchid's "secret chords" (manual
 * section 14.8). min+dim and maj+dim are listed with the 6 button and
 * maj+min with m7; dawg plays them without it too.
 */
export const COMBINED_TYPES: Readonly<Record<string, Quality>> = Object.freeze({
  "dim+sus": "5",
  "maj+sus": "aug",
  "min+sus": "madd4",
  "dim+min": "mb6",
  "dim+maj": "b6",
  "maj+min": "7#9",
});

/** Quality for a set of held chord-type buttons, or undefined for none. */
export function qualityOf(types: Iterable<ChordType>): Quality | undefined {
  const held = [...new Set(types)].sort();
  if (held.length === 0) return undefined;
  if (held.length === 1) return held[0] === "sus" ? "sus4" : held[0]!;
  return COMBINED_TYPES[held.slice(0, 2).join("+")] ?? "maj";
}

/** A chord: root pitch class, triad quality, extensions, optional bass. */
export type Chord = Readonly<{
  /** 0..11, C = 0. */
  root: number;
  quality: Quality;
  extensions: readonly Extension[];
  /** Slash bass pitch class, when not the root. */
  bass?: number | undefined;
}>;

export function makeChord(
  root: number,
  quality: Quality,
  extensions: Iterable<Extension> = [],
  bass?: number,
): Chord {
  const held = new Set(extensions);
  const own = SECRET_EXTENSION[quality];
  const ext = EXTENSIONS.filter((value) => held.has(value) && value !== own);
  const pc = mod12(root);
  const slash = bass === undefined ? undefined : mod12(bass);
  return Object.freeze({
    root: pc,
    quality,
    extensions: Object.freeze(ext),
    ...(slash !== undefined && slash !== pc ? { bass: slash } : {}),
  });
}

/** Semitones above the root, ascending and unique (9 sits at 14). */
export function chordIntervals(chord: Chord): number[] {
  const set = new Set(QUALITY_INTERVALS[chord.quality]);
  for (const ext of chord.extensions) set.add(EXTENSION_INTERVAL[ext]);
  // m7 and M7 together keep both; 6 with m7 on a dim triad is the dim7's bb7.
  return [...set].sort((a, b) => a - b);
}

/** Pitch classes of the chord (bass excluded), root first. */
export function chordPitchClasses(chord: Chord): number[] {
  return chordIntervals(chord).map((step) => mod12(chord.root + step));
}

// ---------------------------------------------------------------------------
// Names

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
const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

/** Note name for a pitch class; flats when `flats`. */
export function noteName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!;
}

const SECRET_SUFFIX: Readonly<Partial<Record<Quality, string>>> = Object.freeze(
  { madd4: "m(add4)", mb6: "m(b6)", b6: "(b6)", "7#9": "7#9" },
);

/** Chord symbol suffix: `m7`, `maj9`, `7sus4`, `dim7`, `m7b5`, `6/9`. */
export function chordSuffix(chord: Chord): string {
  const ext = new Set(chord.extensions);
  const b7 = ext.has("m7");
  const M7 = ext.has("M7");
  const six = ext.has("6");
  const nine = ext.has("9");
  const q = chord.quality;
  const add = (base: string, parts: string[]) =>
    parts.length === 0 ? base : `${base}(${parts.join(",")})`;
  const extras: string[] = [];
  let base: string;
  const secret = SECRET_SUFFIX[q];
  if (secret !== undefined) {
    const names: Readonly<Record<Extension, string>> = {
      "6": "6",
      m7: "7",
      M7: "maj7",
      "9": "9",
    };
    const parts = chord.extensions.map((e) => names[e]);
    if (parts.length === 0 || !secret.endsWith(")")) return add(secret, parts);
    return `${secret.slice(0, -1)},${parts.join(",")})`;
  }
  if (q === "dim" && six && !b7 && !M7) {
    base = "dim7";
    if (nine) extras.push("add9");
    return add(base, extras);
  }
  if (b7 && M7) {
    // Both sevenths: name the dominant and list the major seventh.
    extras.push("maj7");
  }
  const seventh = b7 ? "7" : M7 ? "maj7" : "";
  if (seventh) {
    const ninth = nine ? (seventh === "7" ? "9" : "maj9") : seventh;
    switch (q) {
      case "maj":
        base = ninth;
        break;
      case "min":
        base = b7 ? (nine ? "m9" : "m7") : nine ? "m(maj9)" : "m(maj7)";
        break;
      case "dim":
        base = b7 ? (nine ? "m9b5" : "m7b5") : "dim(maj7)";
        if (!b7 && nine) extras.push("9");
        break;
      case "aug":
        base = b7 ? (nine ? "aug9" : "aug7") : "aug(maj7)";
        if (!b7 && nine) extras.push("9");
        break;
      case "sus4":
        base = `${ninth}sus4`;
        break;
      case "sus2":
        base = `${seventh}sus2`;
        if (nine) extras.push("9");
        break;
      case "5":
        base = `${seventh}(no3)`;
        if (nine) extras.push("9");
        break;
      default:
        base = seventh; // secret qualities returned above
    }
    if (six) extras.push("13");
    return add(base, b7 && M7 ? extras : extras.filter((e) => e !== "maj7"));
  }
  const triad: Record<Quality, string> = {
    maj: "",
    min: "m",
    dim: "dim",
    sus4: "sus4",
    aug: "aug",
    sus2: "sus2",
    "5": "5",
    madd4: "m(add4)",
    mb6: "m(b6)",
    b6: "(b6)",
    "7#9": "7#9",
  };
  base = triad[q];
  if (six && nine && (q === "maj" || q === "min")) return `${base}6/9`;
  if (six) {
    if (q === "maj" || q === "min") base = `${base}6`;
    else extras.push("6");
  }
  if (nine) {
    if (extras.length === 0 && (q === "maj" || q === "min"))
      return `${base}${q === "min" && !six ? "(add9)" : "add9"}`;
    extras.push("9");
  }
  return add(base, extras);
}

/** Chord symbol: `Cm7`, `F#dim`, `Bbmaj9`, `G7sus4`, `C/E`. */
export function chordName(chord: Chord, flats = false): string {
  const slash =
    chord.bass === undefined ? "" : `/${noteName(chord.bass, flats)}`;
  return `${noteName(chord.root, flats)}${chordSuffix(chord)}${slash}`;
}

/** Suffix → quality and extensions, longest first when parsing. */
const SUFFIXES: readonly (readonly [string, Quality, readonly Extension[]])[] =
  [
    ["", "maj", []],
    ["maj", "maj", []],
    ["M", "maj", []],
    ["m", "min", []],
    ["min", "min", []],
    ["-", "min", []],
    ["dim", "dim", []],
    ["°", "dim", []],
    ["o", "dim", []],
    ["aug", "aug", []],
    ["+", "aug", []],
    ["sus", "sus4", []],
    ["sus4", "sus4", []],
    ["sus2", "sus2", []],
    ["5", "5", []],
    ["6", "maj", ["6"]],
    ["m6", "min", ["6"]],
    ["6/9", "maj", ["6", "9"]],
    ["69", "maj", ["6", "9"]],
    ["m6/9", "min", ["6", "9"]],
    ["m69", "min", ["6", "9"]],
    ["7", "maj", ["m7"]],
    ["dom7", "maj", ["m7"]],
    ["maj7", "maj", ["M7"]],
    ["M7", "maj", ["M7"]],
    ["Δ", "maj", ["M7"]],
    ["Δ7", "maj", ["M7"]],
    ["m7", "min", ["m7"]],
    ["min7", "min", ["m7"]],
    ["-7", "min", ["m7"]],
    ["m(maj7)", "min", ["M7"]],
    ["mM7", "min", ["M7"]],
    ["m7b5", "dim", ["m7"]],
    ["ø", "dim", ["m7"]],
    ["ø7", "dim", ["m7"]],
    ["dim7", "dim", ["6"]],
    ["°7", "dim", ["6"]],
    ["o7", "dim", ["6"]],
    ["aug7", "aug", ["m7"]],
    ["+7", "aug", ["m7"]],
    ["9", "maj", ["m7", "9"]],
    ["maj9", "maj", ["M7", "9"]],
    ["M9", "maj", ["M7", "9"]],
    ["m9", "min", ["m7", "9"]],
    ["add9", "maj", ["9"]],
    ["madd9", "min", ["9"]],
    ["m(add9)", "min", ["9"]],
    ["7sus4", "sus4", ["m7"]],
    ["7sus", "sus4", ["m7"]],
    ["9sus4", "sus4", ["m7", "9"]],
    ["7sus2", "sus2", ["m7"]],
    ["maj7sus4", "sus4", ["M7"]],
    ["m(add4)", "madd4", []],
    ["madd4", "madd4", []],
    ["m(b6)", "mb6", []],
    ["mb6", "mb6", []],
    ["(b6)", "b6", []],
    ["addb6", "b6", []],
    ["7#9", "7#9", []],
  ];
const SUFFIX_TABLE = new Map(
  SUFFIXES.map(([suffix, quality, ext]) => [suffix, { quality, ext }]),
);

const LETTER: Readonly<Record<string, number>> = Object.freeze({
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
});

/** Pitch class of a note name (`C`, `f#`, `Bb`), or undefined. */
export function parsePitchClass(text: string): number | undefined {
  const match = text.trim().match(/^([a-gA-G])(#|b|♯|♭)?$/);
  if (!match) return undefined;
  const accidental =
    match[2] === "#" || match[2] === "♯"
      ? 1
      : match[2] === "b" || match[2] === "♭"
        ? -1
        : 0;
  return mod12(LETTER[match[1]!.toLowerCase()]! + accidental);
}

/** Parse a chord symbol (`Cm7`, `F#dim`, `Bbmaj9`, `G7sus4`, `C/E`). */
export function parseChord(symbol: string): Chord | undefined {
  if (typeof symbol !== "string" || symbol.length > 24) return undefined;
  const trimmed = symbol
    .trim()
    .replace(/6\/9$/, "69")
    .replace(/6\/9\//, "69/");
  const match = trimmed.match(/^([A-Ga-g])(#|b|♯|♭)?([^/]*)(?:\/(.+))?$/);
  if (!match) return undefined;
  const root = parsePitchClass(`${match[1]}${match[2] ?? ""}`);
  const entry = SUFFIX_TABLE.get(match[3] ?? "");
  if (root === undefined || !entry) return undefined;
  let bass: number | undefined;
  if (match[4] !== undefined) {
    bass = parsePitchClass(match[4]);
    if (bass === undefined) return undefined;
  }
  return makeChord(root, entry.quality, entry.ext, bass);
}

// ---------------------------------------------------------------------------
// Keys and modes

export const MODES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic-minor": [0, 2, 3, 5, 7, 9, 11],
  "phrygian-dominant": [0, 1, 4, 5, 7, 8, 10],
} as const);
export type ModeName = keyof typeof MODES;
export const MODE_NAMES = Object.keys(MODES) as ModeName[];

const MODE_ALIASES: Readonly<Record<string, ModeName>> = Object.freeze({
  "": "major",
  maj: "major",
  major: "major",
  ionian: "major",
  m: "minor",
  min: "minor",
  minor: "minor",
  aeolian: "minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  mixo: "mixolydian",
  locrian: "locrian",
  "harmonic-minor": "harmonic-minor",
  "harmonic minor": "harmonic-minor",
  harmonic: "harmonic-minor",
  "melodic-minor": "melodic-minor",
  "melodic minor": "melodic-minor",
  melodic: "melodic-minor",
  "jazz minor": "melodic-minor",
  "phrygian-dominant": "phrygian-dominant",
  "phrygian dominant": "phrygian-dominant",
  freygish: "phrygian-dominant",
  spanish: "phrygian-dominant",
  ajam: "major",
  mahur: "major",
  bilawal: "major",
});

export type ScaleFamily =
  "pentatonic" | "blues" | "maqam" | "dastgah" | "raga" | "messiaen";

/**
 * Scales beyond the chord modes, for keys such as `D bayati`, `C yaman` or
 * `C messiaen-3`. `steps` are semitones above the tonic and may be
 * fractional (a quarter tone is .5); `mode` is the seven-note mode the
 * chord engine harmonizes with (the closest one; see DAWG.md). A raga's
 * `intonation` is each step's traditional just pitch in cents (shruti
 * offsets), which its named tuning applies (`tuning yaman`): Pythagorean
 * ati-komal re and dha for Bhairavi, Bhairav, Purvi and Todi, the high
 * tivra ma (729/512) for Yaman, 9/5 komal ni for Kafi, after Daniélou and
 * Jairazbhoy. Maqam and dastgah quarter tones follow the 24-tone convention;
 * Segah and Sikah start on a half-flat note, so their tonic is the key.
 */
export type ScaleInfo = Readonly<{
  steps: readonly number[];
  mode: ModeName;
  family: ScaleFamily;
  intonation?: readonly number[];
  aliases?: readonly string[];
}>;

export const SCALES = Object.freeze({
  "major-pentatonic": {
    steps: [0, 2, 4, 7, 9],
    mode: "major",
    family: "pentatonic",
    aliases: ["pentatonic", "major pentatonic", "pent"],
  },
  "minor-pentatonic": {
    steps: [0, 3, 5, 7, 10],
    mode: "minor",
    family: "pentatonic",
    aliases: ["minor pentatonic", "m pentatonic", "min pentatonic"],
  },
  blues: {
    steps: [0, 3, 5, 6, 7, 10],
    mode: "minor",
    family: "blues",
    aliases: ["minor blues"],
  },
  "major-blues": {
    steps: [0, 2, 3, 4, 7, 9],
    mode: "major",
    family: "blues",
    aliases: ["major blues"],
  },
  hijaz: {
    steps: [0, 1, 4, 5, 7, 8, 10],
    mode: "phrygian-dominant",
    family: "maqam",
  },
  bayati: {
    steps: [0, 1.5, 3, 5, 7, 8, 10],
    mode: "phrygian",
    family: "maqam",
  },
  rast: { steps: [0, 2, 3.5, 5, 7, 9, 10.5], mode: "major", family: "maqam" },
  saba: { steps: [0, 1.5, 3, 4, 7, 8, 10], mode: "phrygian", family: "maqam" },
  kurd: { steps: [0, 1, 3, 5, 7, 8, 10], mode: "phrygian", family: "maqam" },
  nahawand: {
    steps: [0, 2, 3, 5, 7, 8, 11],
    mode: "harmonic-minor",
    family: "maqam",
  },
  sikah: {
    steps: [0, 1.5, 3.5, 5.5, 7, 8.5, 10.5],
    mode: "phrygian",
    family: "maqam",
    aliases: ["sika"],
  },
  huzam: {
    steps: [0, 1.5, 3.5, 4.5, 7.5, 8.5, 10.5],
    mode: "phrygian",
    family: "maqam",
    aliases: ["houzam"],
  },
  nikriz: { steps: [0, 2, 3, 6, 7, 9, 10], mode: "dorian", family: "maqam" },
  shur: {
    steps: [0, 1.5, 3, 5, 7, 8, 10],
    mode: "phrygian",
    family: "dastgah",
  },
  homayoun: {
    steps: [0, 1.5, 4, 5, 7, 8, 10],
    mode: "phrygian-dominant",
    family: "dastgah",
    aliases: ["homayun"],
  },
  chahargah: {
    steps: [0, 1.5, 4, 5, 7, 8.5, 11],
    mode: "phrygian-dominant",
    family: "dastgah",
    aliases: ["chahar-gah"],
  },
  segah: {
    steps: [0, 1.5, 3.5, 5, 6.5, 8.5, 10.5],
    mode: "phrygian",
    family: "dastgah",
    aliases: ["sehgah", "se-gah"],
  },
  nava: {
    steps: [0, 2, 3.5, 5, 7, 8, 10],
    mode: "minor",
    family: "dastgah",
  },
  yaman: {
    steps: [0, 2, 4, 6, 7, 9, 11],
    mode: "lydian",
    family: "raga",
    intonation: [0, 203.91, 386.31, 611.73, 701.96, 884.36, 1088.27],
    aliases: ["kalyan", "yaman kalyan"],
  },
  bhairav: {
    steps: [0, 1, 4, 5, 7, 8, 11],
    mode: "phrygian-dominant",
    family: "raga",
    intonation: [0, 90.22, 386.31, 498.04, 701.96, 792.18, 1088.27],
  },
  kafi: {
    steps: [0, 2, 3, 5, 7, 9, 10],
    mode: "dorian",
    family: "raga",
    intonation: [0, 203.91, 315.64, 498.04, 701.96, 884.36, 1017.6],
  },
  bhairavi: {
    steps: [0, 1, 3, 5, 7, 8, 10],
    mode: "phrygian",
    family: "raga",
    intonation: [0, 90.22, 294.13, 498.04, 701.96, 792.18, 996.09],
  },
  asavari: {
    steps: [0, 2, 3, 5, 7, 8, 10],
    mode: "minor",
    family: "raga",
    intonation: [0, 203.91, 315.64, 498.04, 701.96, 813.69, 996.09],
  },
  khamaj: {
    steps: [0, 2, 4, 5, 7, 9, 10],
    mode: "mixolydian",
    family: "raga",
    intonation: [0, 203.91, 386.31, 498.04, 701.96, 884.36, 996.09],
  },
  todi: {
    steps: [0, 1, 3, 6, 7, 8, 11],
    mode: "phrygian",
    family: "raga",
    intonation: [0, 95, 294, 606, 702, 792, 1107],
  },
  purvi: {
    steps: [0, 1, 4, 6, 7, 8, 11],
    mode: "phrygian-dominant",
    family: "raga",
    intonation: [0, 90.22, 386.31, 590.22, 701.96, 792.18, 1088.27],
  },
  marwa: {
    steps: [0, 1, 4, 6, 9, 11],
    mode: "lydian",
    family: "raga",
    intonation: [0, 111.73, 386.31, 590.22, 884.36, 1088.27],
  },
  darbari: {
    steps: [0, 2, 3, 5, 7, 8, 10],
    mode: "minor",
    family: "raga",
    intonation: [0, 203.91, 294.13, 498.04, 701.96, 792.18, 996.09],
    aliases: ["darbari kanada"],
  },
  malkauns: {
    steps: [0, 3, 5, 8, 10],
    mode: "minor",
    family: "raga",
    intonation: [0, 315.64, 498.04, 813.69, 996.09],
  },
  bhupali: {
    steps: [0, 2, 4, 7, 9],
    mode: "major",
    family: "raga",
    intonation: [0, 203.91, 386.31, 701.96, 884.36],
  },
  durga: {
    steps: [0, 2, 5, 7, 9],
    mode: "major",
    family: "raga",
    intonation: [0, 203.91, 498.04, 701.96, 884.36],
  },
  "messiaen-1": {
    steps: [0, 2, 4, 6, 8, 10],
    mode: "lydian",
    family: "messiaen",
    aliases: ["whole-tone", "whole tone", "wholetone"],
  },
  "messiaen-2": {
    steps: [0, 1, 3, 4, 6, 7, 9, 10],
    mode: "mixolydian",
    family: "messiaen",
    aliases: ["octatonic", "diminished", "half-whole"],
  },
  "messiaen-3": {
    steps: [0, 2, 3, 4, 6, 7, 8, 10, 11],
    mode: "minor",
    family: "messiaen",
  },
  "messiaen-4": {
    steps: [0, 1, 2, 5, 6, 7, 8, 11],
    mode: "harmonic-minor",
    family: "messiaen",
  },
  "messiaen-5": {
    steps: [0, 1, 5, 6, 7, 11],
    mode: "lydian",
    family: "messiaen",
  },
  "messiaen-6": {
    steps: [0, 2, 4, 5, 6, 8, 10, 11],
    mode: "major",
    family: "messiaen",
  },
  "messiaen-7": {
    steps: [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
    mode: "harmonic-minor",
    family: "messiaen",
  },
} as const satisfies Record<string, ScaleInfo>);
export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

const SCALE_ALIASES: Readonly<Record<string, ScaleName>> = (() => {
  const aliases: Record<string, ScaleName> = {};
  for (const name of SCALE_NAMES) {
    const info: ScaleInfo = SCALES[name];
    aliases[name] = name;
    aliases[name.replace(/-/g, " ")] = name;
    for (const alias of info.aliases ?? []) aliases[alias] = name;
  }
  return Object.freeze(aliases);
})();

/** The library scale named `text` (case and `-`/space insensitive). */
export function scaleNamed(text: string): ScaleName | undefined {
  const word = text.trim().toLowerCase().replace(/\s+/g, " ");
  return SCALE_ALIASES[word] ?? SCALE_ALIASES[word.replace(/ /g, "-")];
}

/**
 * A key: a tonic and the seven-note `mode` the chord engine uses, plus the
 * library `scale` when the key names one (`D bayati`, `C yaman`).
 */
export type Key = Readonly<{
  tonic: number;
  mode: ModeName;
  scale?: ScaleName;
}>;

/**
 * Parse a key: `C`, `c major`, `Am`, `a minor`, `F# dorian`, `Eb mixo`,
 * `D bayati`, `C messiaen-3`. Accepts the `<note> <mode>` form
 * `core/key.ts` writes.
 */
export function parseKey(text: string | null | undefined): Key | undefined {
  if (typeof text !== "string" || text.length > 40) return undefined;
  const match = text
    .trim()
    .match(/^([a-gA-G])(#|b|♯|♭)?\s*(m(?![a-z])|[a-zA-Z][a-zA-Z0-9 -]*)?$/);
  if (!match) return undefined;
  const tonic = parsePitchClass(`${match[1]}${match[2] ?? ""}`);
  if (tonic === undefined) return undefined;
  const word = (match[3] ?? "").trim();
  const mode = MODE_ALIASES[word === "m" ? "m" : word.toLowerCase()];
  if (mode !== undefined) return Object.freeze({ tonic, mode });
  const scale = scaleNamed(word);
  if (scale === undefined) return undefined;
  return Object.freeze({ tonic, mode: SCALES[scale].mode, scale });
}

/**
 * Steps of the key's whole scale in semitones above the tonic (fractional
 * for quarter tones): the library scale when the key names one, else the
 * mode.
 */
export function scaleSteps(key: Key): number[] {
  return [...(key.scale ? SCALES[key.scale].steps : MODES[key.mode])];
}

/** True when names in the key read better with flats (F, Bb, Eb, d minor…). */
export function keyUsesFlats(key: Key): boolean {
  // The parent major scale's tonic decides: F, Bb, Eb, Ab, Db read in flats.
  const parentOffset: Record<ModeName, number> = {
    major: 0,
    dorian: 2,
    phrygian: 4,
    lydian: 5,
    mixolydian: 7,
    minor: 9,
    locrian: 11,
    "harmonic-minor": 9,
    "melodic-minor": 9,
    "phrygian-dominant": 4,
  };
  const parent = mod12(key.tonic - parentOffset[key.mode]);
  return [5, 10, 3, 8, 1].includes(parent);
}

/** `C major`, `F# dorian`, `Bb minor`. */
export function keyName(key: Key): string {
  return `${noteName(key.tonic, keyUsesFlats(key))} ${key.scale ?? key.mode}`;
}

/** Pitch classes of the key's scale, tonic first. */
export function scaleOf(key: Key): number[] {
  return MODES[key.mode].map((step) => mod12(key.tonic + step));
}

function qualityFromThirds(third: number, fifth: number): Quality {
  if (third === 4 && fifth === 7) return "maj";
  if (third === 3 && fifth === 7) return "min";
  if (third === 3 && fifth === 6) return "dim";
  if (third === 4 && fifth === 8) return "aug";
  return "maj";
}

/**
 * The diatonic chord on scale degree `degree` (0-based): stacked thirds
 * from the scale. `sevenths` adds the scale's seventh above the root.
 */
export function diatonicChord(
  key: Key,
  degree: number,
  sevenths = false,
): Chord {
  const scale = MODES[key.mode];
  const at = (index: number) => {
    const octave = Math.floor(index / 7);
    return scale[((index % 7) + 7) % 7]! + 12 * octave;
  };
  const d = ((degree % 7) + 7) % 7;
  const root = at(d);
  const third = at(d + 2) - root;
  const fifth = at(d + 4) - root;
  const quality = qualityFromThirds(third, fifth);
  const ext: Extension[] = [];
  if (sevenths) {
    const seventh = at(d + 6) - root;
    if (quality === "dim" && seventh === 9) ext.push("6");
    else ext.push(seventh === 11 ? "M7" : "m7");
  }
  return makeChord(key.tonic + root, quality, ext);
}

/** The seven diatonic chords of the key. */
export function diatonicChords(key: Key, sevenths = false): Chord[] {
  return Array.from({ length: 7 }, (_, degree) =>
    diatonicChord(key, degree, sevenths),
  );
}

/** Scale degree (0-based) of a pitch class, or undefined when not in key. */
export function degreeOf(key: Key, pc: number): number | undefined {
  const index = scaleOf(key).indexOf(mod12(pc));
  return index < 0 ? undefined : index;
}

/**
 * Orchid Key mode: the chord a key plays. In-scale pitches play their
 * diatonic chord (C major: D → Dm). Out-of-scale pitches are dawg's
 * choice: the chord borrowed from the parallel major/minor when that
 * scale contains the pitch (C major: Eb → Eb, Ab → Ab, Bb → Bb), otherwise
 * a passing diminished seventh (C major: C# → C#dim7, F# → F#dim7).
 * `types` and `extensions` are the held Orchid buttons: a type overrides
 * the quality ("unorthodox" choices), extensions add on top.
 */
export function keyModeChord(
  key: Key,
  pitch: number,
  options: Readonly<{
    types?: Iterable<ChordType>;
    extensions?: Iterable<Extension>;
    sevenths?: boolean;
  }> = {},
): Chord {
  const pc = mod12(pitch);
  const extensions = [...(options.extensions ?? [])];
  const forced = qualityOf(options.types ?? []);
  const degree = degreeOf(key, pc);
  let base: Chord;
  if (degree !== undefined) base = diatonicChord(key, degree, options.sevenths);
  else {
    const parallel: Key = {
      tonic: key.tonic,
      mode: MODES[key.mode][2] === 4 ? "minor" : "major",
    };
    const borrowed = degreeOf(parallel, pc);
    base =
      borrowed !== undefined
        ? diatonicChord(parallel, borrowed, options.sevenths)
        : makeChord(pc, "dim", ["6"]);
  }
  if (forced === undefined && extensions.length === 0) return base;
  const quality = forced ?? base.quality;
  const ext =
    forced === undefined ? [...base.extensions, ...extensions] : extensions;
  return makeChord(pc, quality, ext);
}

/** Manual (non-key) mode: the held buttons on the pressed root. */
export function manualChord(
  pitch: number,
  types: Iterable<ChordType>,
  extensions: Iterable<Extension> = [],
): Chord | undefined {
  const quality = qualityOf(types);
  const ext = [...extensions];
  if (quality === undefined && ext.length === 0) return undefined;
  return makeChord(pitch, quality ?? "maj", ext);
}

// ---------------------------------------------------------------------------
// Roman numerals

const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];

/** Roman numeral for a chord in a key (`ii`, `V7`, `bVII`, `vii°`). */
export function romanOf(key: Key, chord: Chord): string {
  const scale = scaleOf(key);
  let degree = scale.indexOf(chord.root);
  let accidental = "";
  if (degree < 0) {
    // Name chromatic roots against the major scale: bIII, #iv°.
    const major = MODES.major.map((step) => mod12(key.tonic + step));
    const flat = major.indexOf(mod12(chord.root + 1));
    const sharp = major.indexOf(mod12(chord.root - 1));
    if (flat >= 0) {
      degree = flat;
      accidental = "b";
    } else {
      degree = Math.max(0, sharp);
      accidental = "#";
    }
  }
  const lower =
    chord.quality === "min" ||
    chord.quality === "dim" ||
    chord.quality === "5" ||
    chord.quality === "madd4" ||
    chord.quality === "mb6";
  const numeral = NUMERALS[degree]!;
  const body = lower ? numeral : numeral.toUpperCase();
  const ext = new Set(chord.extensions);
  let mark = "";
  if (chord.quality === "dim") mark = ext.has("m7") ? "ø" : "°";
  else if (chord.quality === "aug") mark = "+";
  const seventh =
    ext.has("6") && chord.quality === "dim"
      ? "7"
      : ext.has("m7")
        ? "7"
        : ext.has("M7")
          ? "maj7"
          : "";
  return `${accidental}${body}${mark}${seventh}`;
}

/**
 * Parse a roman numeral in a key: `I`, `ii`, `V7`, `vii°`, `bVII`, `iv`,
 * `IVmaj7`, `ii7`, `V/V` (secondary dominant), `Vsus4`.
 *
 * A numeral whose case matches the diatonic chord (lowercase for minor or
 * diminished) takes the diatonic quality, so `vii` is diminished in major;
 * a mismatched case is explicit (`iv` in major is minor, `IV` in minor is
 * major). `7` adds the diatonic seventh; `maj7`/`M7` and `dom7` are exact.
 */
export function parseRoman(key: Key, text: string): Chord | undefined {
  if (typeof text !== "string" || text.length > 16) return undefined;
  const trimmed = text.trim();
  const slash = trimmed.match(/^(.+)\/(.+)$/);
  if (slash) {
    // V/x: the chord built on the degree of x in the key (secondary function).
    const target = parseRoman(key, slash[2]!);
    if (!target) return undefined;
    const sub = parseRoman({ tonic: target.root, mode: "major" }, slash[1]!);
    return sub;
  }
  const match = trimmed.match(
    /^(b|#|♭|♯)?(vii|vi|v|iv|iii|ii|i|VII|VI|V|IV|III|II|I)(°|o|ø|\+)?(maj7|M7|dom7|7|9|maj9|6|sus4|sus2|sus|add9)?$/,
  );
  if (!match) return undefined;
  const accidental =
    match[1] === "b" || match[1] === "♭" ? -1 : match[1] ? 1 : 0;
  const numeral = match[2]!;
  const lower = numeral === numeral.toLowerCase();
  const degree = NUMERALS.indexOf(numeral.toLowerCase());
  const mark = match[3];
  const suffix = match[4] ?? "";
  const root =
    accidental === 0
      ? scaleOf(key)[degree]!
      : mod12(key.tonic + MODES.major[degree]! + accidental);
  const inKey = degreeOf(key, root);
  const triad = inKey === undefined ? undefined : diatonicChord(key, inKey);
  const seventh =
    inKey === undefined ? undefined : diatonicChord(key, inKey, true);
  const diatonicLower =
    triad !== undefined && (triad.quality === "min" || triad.quality === "dim");
  const matches = triad !== undefined && diatonicLower === lower;
  let quality: Quality;
  if (mark === "°" || mark === "o" || mark === "ø") quality = "dim";
  else if (mark === "+") quality = "aug";
  else if (matches) quality = triad.quality;
  else quality = lower ? "min" : "maj";
  // The diatonic seventh when the triad is the diatonic one, else b7.
  const diatonicSeventh = (): Extension[] =>
    mark === "ø"
      ? ["m7"]
      : seventh && seventh.quality === quality
        ? [...seventh.extensions]
        : quality === "dim" && mark !== undefined
          ? ["6"]
          : ["m7"];
  let ext: Extension[] = mark === "ø" ? ["m7"] : [];
  switch (suffix) {
    case "7":
      ext = diatonicSeventh();
      break;
    case "dom7":
      ext = ["m7"];
      break;
    case "maj7":
    case "M7":
      ext = ["M7"];
      break;
    case "9":
      ext = [...diatonicSeventh(), "9"];
      break;
    case "maj9":
      ext = ["M7", "9"];
      break;
    case "6":
      ext = ["6"];
      break;
    case "add9":
      ext = ["9"];
      break;
    case "sus4":
    case "sus":
      quality = "sus4";
      break;
    case "sus2":
      quality = "sus2";
      break;
  }
  return makeChord(root, quality, ext);
}

// ---------------------------------------------------------------------------
// Voicing

/** Default chord register: a voicing is kept inside [low, high]. */
export const VOICING_RANGE = Object.freeze({ low: 48, high: 79 });
/** Voicing dial: Orchid-style rotation steps, -12..12. */
export const MAX_VOICING_STEP = 12;
export const SPREADS = ["close", "open", "wide"] as const;
export type Spread = (typeof SPREADS)[number];

export type VoicingOptions = Readonly<{
  /** Rotation steps from root position (Orchid's voicing dial). */
  inversion?: number;
  spread?: Spread;
  /** Voice-lead from this voicing (minimal movement). */
  previous?: readonly number[] | undefined;
  /** Root-position anchor: the root lands at or above this pitch. */
  anchor?: number;
  low?: number;
  high?: number;
}>;

/**
 * Root position of a chord with its root at or above `anchor`, then the
 * Orchid voicing dial: each positive step moves the lowest note up an
 * octave, each negative step the highest note down.
 */
export function rotate(pitches: readonly number[], steps: number): number[] {
  const notes = [...pitches].sort((a, b) => a - b);
  if (notes.length === 0) return notes;
  for (let i = 0; i < Math.abs(Math.trunc(steps)); i += 1) {
    if (steps > 0) notes.push(notes.shift()! + 12);
    else notes.unshift(notes.pop()! - 12);
  }
  return notes;
}

export function rootPosition(chord: Chord, anchor = 60): number[] {
  const rootPitch = anchor + mod12(chord.root - anchor);
  return chordIntervals(chord).map((step) => rootPitch + step);
}

/** Open voicings: `open` drops the second voice from the top an octave
 * (drop 2); `wide` also drops the fourth from the top (drop 2+4). */
export function applySpread(
  pitches: readonly number[],
  spread: Spread,
): number[] {
  const notes = [...pitches].sort((a, b) => a - b);
  if (spread === "close" || notes.length < 3) return notes;
  const n = notes.length;
  notes[n - 2] = notes[n - 2]! - 12;
  if (spread === "wide" && n >= 4) notes[n - 4] = notes[n - 4]! - 12;
  return notes.sort((a, b) => a - b);
}

/**
 * Movement between two voicings: each voice of the new chord pays its
 * distance to the nearest previous voice and vice versa, so voicings of
 * different sizes compare and common tones are free.
 */
export function movement(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const nearest = (pitch: number, set: readonly number[]) =>
    Math.min(...set.map((other) => Math.abs(other - pitch)));
  let total = 0;
  for (const pitch of b) total += nearest(pitch, a);
  for (const pitch of a) total += nearest(pitch, b);
  return total;
}

/**
 * Voice a chord. Without `previous`, root position at `anchor` rotated by
 * `inversion` (the Orchid dial). With `previous` (voice leading), every
 * rotation within an octave either side of the dial is tried and the one
 * with the least movement wins; ties go to the voicing nearest the dial,
 * then the lower one. Results stay within [low, high] when they fit.
 */
export function voiceChord(
  chord: Chord,
  options: VoicingOptions = {},
): number[] {
  const anchor = options.anchor ?? 60;
  const spread = options.spread ?? "close";
  const low = options.low ?? VOICING_RANGE.low;
  const high = options.high ?? VOICING_RANGE.high;
  const dial = clampInt(
    options.inversion ?? 0,
    -MAX_VOICING_STEP,
    MAX_VOICING_STEP,
  );
  const base = rootPosition(chord, anchor);
  const size = base.length;
  const fit = (notes: number[]) =>
    notes.every((pitch) => pitch >= low && pitch <= high);
  const clampMidi = (notes: number[]) =>
    notes.map((pitch) => Math.max(0, Math.min(127, pitch)));
  const at = (steps: number) => applySpread(rotate(base, steps), spread);
  if (!options.previous || options.previous.length === 0)
    return clampMidi(at(dial));
  let best: { notes: number[]; cost: number; distance: number } | undefined;
  for (let offset = -size; offset <= size; offset += 1) {
    const notes = at(dial + offset);
    if (!fit(notes) && offset !== 0) continue;
    const cost = movement(options.previous, notes);
    const distance = Math.abs(offset);
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost && distance < best.distance)
    )
      best = { notes, cost, distance };
  }
  return clampMidi(best!.notes);
}

/** Bass under a chord: its slash bass or root, in C2..B2 by default. */
export function bassNote(chord: Chord, low = 36): number {
  return low + mod12((chord.bass ?? chord.root) - low);
}

/**
 * Orchid's bass behaviours (manual 10.2 and the "How to use Bass" article),
 * plus `off`. Labels in BASS_MODE_TEXT; `chords` is Orchid's default
 * "Chords Only".
 */
export const BASS_MODES = [
  "off",
  "chords",
  "unison",
  "single",
  "solo",
] as const;
export type BassMode = (typeof BASS_MODES)[number];

export const BASS_MODE_TEXT: Readonly<Record<BassMode, string>> = {
  off: "no bass",
  chords: "bass root under chords only",
  unison: "bass doubles single notes; root under chords",
  single: "single notes play bass only; chords play treble and root",
  solo: "bass only: the treble is muted, even for chords",
};

/** What one key press sounds once the bass mode has routed it. */
export type BassRoute = Readonly<{
  /** Whether the treble (chord or single note) sounds. */
  treble: boolean;
  /** Bass pitch, or undefined for none. */
  bass: number | undefined;
}>;

/**
 * Route a key press through a bass mode. `chord` is the chord the key
 * played (undefined for a single note); `pitch` the pressed key; `low` the
 * bottom of the bass octave. Sourced semantics (Orchid manual 10.2, support
 * article "How to use Bass on Orchid"): `chords` adds the chord's root only
 * when a chord plays; `unison` plays bass and treble together on single
 * notes; `single` plays only bass on single notes and the treble only on
 * chords; `solo` mutes the treble entirely, even for chords. dawg's
 * reading where the sources are silent: every mode that sounds bass under
 * a chord uses the chord's root (or slash bass), and a single note's bass
 * is the pressed pitch class in the bass octave.
 */
export function routeBass(
  mode: BassMode,
  chord: Chord | undefined,
  pitch: number,
  low = 36,
): BassRoute {
  const under = chord ? bassNote(chord, low) : low + mod12(pitch - low);
  switch (mode) {
    case "off":
      return { treble: true, bass: undefined };
    case "chords":
      return { treble: true, bass: chord ? under : undefined };
    case "unison":
      return { treble: true, bass: under };
    case "single":
      return { treble: chord !== undefined, bass: under };
    case "solo":
      return { treble: false, bass: under };
  }
}

export function parseBassMode(value: string | undefined): BassMode | undefined {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "on" || text === "true") return "chords";
  if (text === "false" || text === "none") return "off";
  if (text === "single-notes" || text === "singles") return "single";
  return (BASS_MODES as readonly string[]).includes(text)
    ? (text as BassMode)
    : undefined;
}

// ---------------------------------------------------------------------------
// Performance

export const PERFORM_MODES = [
  "block",
  "strum-up",
  "strum-down",
  "arp-up",
  "arp-down",
  "arp-updown",
  "arp-random",
  "harp",
  "slop",
  "pattern",
] as const;
export type PerformMode = (typeof PERFORM_MODES)[number];

export type PerformOptions = Readonly<{
  mode?: PerformMode;
  /** Arp step in beats (the grid), default 1/8 beat... 0.25. */
  rate?: number;
  /** Arp/harp octaves, 1..4. */
  octaves?: number;
  /** Strum gap between voices in beats, default 1/32 beat. */
  strum?: number;
  /** Seed for arp-random and slop. */
  seed?: number;
  /** Slop amount 0..1: each voice lands up to `slop` × 1/8 beat late. */
  slop?: number;
  /** Pattern mode: a CHORD_PATTERNS name or 1-based number, default 1. */
  pattern?: string | number;
  /** 0..1. */
  velocity?: number;
}>;

export type PerformedNote = Readonly<{
  pitch: number;
  /** Beats. */
  start: number;
  length: number;
  velocity: number;
}>;

export const DEFAULT_ARP_RATE = 0.25;
export const DEFAULT_STRUM = 1 / 32;
export const DEFAULT_SLOP = 0.5;
/** Latest a slopped voice can land, in beats, at slop 1. */
export const MAX_SLOP = 1 / 8;

// ---------------------------------------------------------------------------
// Patterns

/**
 * One hit of a chord pattern. `voices` picks chord tones by index, low to
 * high: `all`, `upper` (all but the lowest), or a list where an index past
 * the top wraps an octave up (index 3 of a triad is the root +12) and a
 * negative index counts down from the top (-1 is the highest voice).
 */
export type PatternHit = Readonly<{
  /** Beats from the cycle start. */
  at: number;
  /** Beats. */
  length: number;
  voices: "all" | "upper" | readonly number[];
  /** 0..1, scaled by the press velocity. */
  velocity: number;
  /** Octave shift for these voices (the bass half of oom-pah is -1). */
  octave?: number;
}>;

export type ChordPattern = Readonly<{
  name: string;
  description: string;
  /** Cycle length in beats; the pattern repeats from the press. */
  beats: number;
  hits: readonly PatternHit[];
}>;

const everyStep = (
  step: number,
  beats: number,
  hit: (index: number) => Omit<PatternHit, "at">,
): PatternHit[] =>
  Array.from({ length: Math.round(beats / step) }, (_, index) => ({
    at: index * step,
    ...hit(index),
  }));

/**
 * Pattern mode. Orchid's own patterns are not published (manual 7.2: "Plays
 * chord notes in pre-determined rhythmic patterns", tempo-synced, the
 * rhythm independent of the chord's note count, with per-note velocities
 * scaled by the press; 11 at launch and two more in firmware 3.84). These
 * 13 are dawg's own design in that spirit: each hit names voices by index
 * so the rhythm holds for triads and 9th chords alike.
 */
export const CHORD_PATTERNS: readonly ChordPattern[] = Object.freeze([
  {
    name: "eighths",
    description: "straight 8ths, beats accented",
    beats: 4,
    hits: everyStep(0.5, 4, (i) => ({
      length: 0.45,
      voices: "all",
      velocity: i % 2 === 0 ? 1 : 0.7,
    })),
  },
  {
    name: "sixteenths",
    description: "straight 16ths, 1-e-&-a accents",
    beats: 4,
    hits: everyStep(0.25, 4, (i) => ({
      length: 0.2,
      voices: "all",
      velocity: [1, 0.55, 0.8, 0.55][i % 4]!,
    })),
  },
  {
    name: "offbeat",
    description: "short stabs on every &",
    beats: 4,
    hits: everyStep(1, 4, () => ({
      length: 0.25,
      voices: "all",
      velocity: 0.9,
    })).map((hit) => ({ ...hit, at: hit.at + 0.5 })),
  },
  {
    name: "pop",
    description: "syncopated pop comp with 16th pushes",
    beats: 4,
    hits: [
      { at: 0, length: 0.5, voices: "all", velocity: 1 },
      { at: 0.75, length: 0.5, voices: "upper", velocity: 0.7 },
      { at: 1.5, length: 0.75, voices: "all", velocity: 0.85 },
      { at: 2.5, length: 0.5, voices: "upper", velocity: 0.7 },
      { at: 3, length: 0.25, voices: "all", velocity: 0.6 },
      { at: 3.5, length: 0.5, voices: "all", velocity: 0.85 },
    ],
  },
  {
    name: "charleston",
    description: "dotted quarter, then the & of 2",
    beats: 4,
    hits: [
      { at: 0, length: 0.75, voices: "all", velocity: 1 },
      { at: 1.5, length: 0.5, voices: "all", velocity: 0.85 },
    ],
  },
  {
    name: "bossa",
    description: "two-bar bossa comp over a root-fifth pulse",
    beats: 8,
    hits: [
      ...everyStep(2, 8, () => ({
        length: 1.5,
        voices: [0],
        velocity: 0.85,
        octave: -1,
      })),
      ...[0, 1.5, 3, 4.5, 6].map((at) => ({
        at,
        length: 0.5,
        voices: "upper" as const,
        velocity: at === 0 ? 0.9 : 0.75,
      })),
    ],
  },
  {
    name: "skank",
    description: "reggae skank: short upper stabs on 2 and 4",
    beats: 4,
    hits: [1, 3].map((at) => ({
      at,
      length: 0.2,
      voices: "upper" as const,
      velocity: 0.95,
    })),
  },
  {
    name: "gallop",
    description: "gallop: an 8th and two 16ths per beat",
    beats: 4,
    hits: everyStep(1, 4, () => ({
      length: 0.4,
      voices: "all",
      velocity: 1,
    })).flatMap((hit) => [
      hit,
      { ...hit, at: hit.at + 0.5, length: 0.2, velocity: 0.7 },
      { ...hit, at: hit.at + 0.75, length: 0.2, velocity: 0.75 },
    ]),
  },
  {
    name: "half-time",
    description: "half-time: a long hit and a pickup per two bars",
    beats: 8,
    hits: [
      { at: 0, length: 3.5, voices: "all", velocity: 1 },
      { at: 4, length: 1.5, voices: "all", velocity: 0.8 },
      { at: 7.5, length: 0.5, voices: "upper", velocity: 0.65 },
    ],
  },
  {
    name: "tresillo",
    description: "tresillo 3+3+2",
    beats: 4,
    hits: [
      { at: 0, length: 1.25, voices: "all", velocity: 1 },
      { at: 1.5, length: 1.25, voices: "all", velocity: 0.8 },
      { at: 3, length: 0.75, voices: "all", velocity: 0.9 },
    ],
  },
  {
    name: "oom-pah",
    description: "alternating bass and chord: low root, upper chord",
    beats: 4,
    hits: everyStep(1, 4, (i) =>
      i % 2 === 0
        ? { length: 0.9, voices: [0], velocity: 1, octave: -1 }
        : { length: 0.8, voices: "upper", velocity: 0.75 },
    ),
  },
  {
    name: "roll",
    description: "broken-chord roll up in 16ths, ringing to the half bar",
    beats: 4,
    hits: [0, 2].flatMap((bar) =>
      [0, 1, 2, 3].map((step) => ({
        at: bar + step * 0.25,
        length: 2 - step * 0.25,
        voices: [step],
        velocity: 0.7 + step * 0.08,
      })),
    ),
  },
  {
    name: "pick",
    description: "broken-chord picking: low, high, middle, high in 8ths",
    beats: 4,
    hits: everyStep(0.5, 4, (i) => ({
      length: 0.5,
      voices: [[0, -1, 1, -1][i % 4]!],
      velocity: i % 4 === 0 ? 0.95 : 0.7,
    })),
  },
]);

/** A pattern by name or 1-based number, or undefined. */
export function findChordPattern(
  value: string | number | undefined,
): ChordPattern | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim().toLowerCase();
  const number = Number(text);
  if (/^\d+$/.test(text)) return CHORD_PATTERNS[number - 1];
  return CHORD_PATTERNS.find((pattern) => pattern.name === text);
}

function patternVoices(notes: readonly number[], hit: PatternHit): number[] {
  const n = notes.length;
  const indices =
    hit.voices === "all"
      ? notes.map((_, i) => i)
      : hit.voices === "upper"
        ? n > 1
          ? notes.slice(1).map((_, i) => i + 1)
          : [0]
        : hit.voices;
  const shift = 12 * (hit.octave ?? 0);
  const out = new Set<number>();
  for (const index of indices) {
    const i = index < 0 ? ((index % n) + n) % n : index;
    const wrapped = ((i % n) + n) % n;
    const pitch = notes[wrapped]! + 12 * Math.floor(i / n) + shift;
    if (pitch >= 0 && pitch <= 127) out.add(pitch);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Lay a voiced chord out in time over [start, start + length). Block holds
 * every voice; strums offset voices by `strum` beats and hold to the end;
 * arpeggios step one voice per `rate` beats across `octaves`, aligned to
 * multiples of `rate` from `start`; harp is an upward strum across the
 * octaves that rings to the end; slop (Orchid's humanised timing) holds
 * every voice like block but delays each by a seeded random fraction of
 * `slop` × MAX_SLOP, so each seed lands differently; pattern repeats a
 * CHORD_PATTERNS rhythm from `start`, each hit's velocity scaled by
 * `velocity`.
 */
export function perform(
  pitches: readonly number[],
  start: number,
  length: number,
  options: PerformOptions = {},
): PerformedNote[] {
  const mode = options.mode ?? "block";
  const velocity = options.velocity ?? 0.8;
  const notes = [...pitches].sort((a, b) => a - b);
  if (notes.length === 0 || !(length > 0)) return [];
  const end = start + length;
  const octaves = clampInt(options.octaves ?? 1, 1, 4);
  const spanned: number[] = [];
  for (let o = 0; o < octaves; o += 1)
    for (const pitch of notes)
      if (pitch + 12 * o <= 127) spanned.push(pitch + 12 * o);
  const at = (pitch: number, from: number, to: number): PerformedNote => ({
    pitch,
    start: round6(from),
    length: round6(Math.max(1e-6, to - from)),
    velocity,
  });
  switch (mode) {
    case "block":
      return notes.map((pitch) => at(pitch, start, end));
    case "strum-up":
    case "strum-down": {
      const gap = Math.max(0, options.strum ?? DEFAULT_STRUM);
      const order = mode === "strum-up" ? notes : [...notes].reverse();
      return order
        .map((pitch, index) =>
          at(pitch, Math.min(end - gap, start + index * gap), end),
        )
        .filter((note) => note.length > 0);
    }
    case "slop": {
      const amount = Math.min(1, Math.max(0, options.slop ?? DEFAULT_SLOP));
      const random = mulberry32(options.seed ?? 0);
      const late = Math.min(amount * MAX_SLOP, length / 2);
      return notes.map((pitch) => at(pitch, start + random() * late, end));
    }
    case "pattern": {
      const pattern =
        findChordPattern(options.pattern ?? 1) ?? CHORD_PATTERNS[0]!;
      const out: PerformedNote[] = [];
      for (let cycle = start; cycle < end - 1e-9; cycle += pattern.beats)
        for (const hit of pattern.hits) {
          const from = cycle + hit.at;
          if (from >= end - 1e-9) continue;
          const to = Math.min(end, from + hit.length);
          for (const pitch of patternVoices(notes, hit))
            out.push({
              ...at(pitch, from, to),
              velocity: round6(velocity * hit.velocity),
            });
        }
      return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    }
    case "harp": {
      const gap = Math.max(0, options.strum ?? DEFAULT_STRUM * 2);
      return spanned.map((pitch, index) =>
        at(pitch, Math.min(end - 1e-3, start + index * gap), end),
      );
    }
    default: {
      const rate =
        options.rate && options.rate > 0 ? options.rate : DEFAULT_ARP_RATE;
      const steps = Math.max(1, Math.floor(length / rate + 1e-9));
      let order: number[];
      if (mode === "arp-down") order = [...spanned].reverse();
      else if (mode === "arp-updown")
        order =
          spanned.length > 2
            ? [...spanned, ...spanned.slice(1, -1).reverse()]
            : spanned;
      else order = spanned;
      const random = mulberry32(options.seed ?? 0);
      const out: PerformedNote[] = [];
      for (let step = 0; step < steps; step += 1) {
        const from = start + step * rate;
        const to = Math.min(end, from + rate);
        const pitch =
          mode === "arp-random"
            ? spanned[Math.floor(random() * spanned.length)]!
            : order[step % order.length]!;
        out.push(at(pitch, from, to));
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Progressions

/** A progression preset: roman numerals and the mode they read in. */
export type ProgressionPreset = Readonly<{
  name: string;
  mode: "major" | "minor" | "dorian" | "mixolydian";
  numerals: readonly string[];
  /** Use diatonic sevenths. */
  sevenths?: boolean;
  description: string;
}>;

export const PROGRESSION_PRESETS: readonly ProgressionPreset[] = Object.freeze([
  {
    name: "axis",
    mode: "major",
    numerals: ["I", "V", "vi", "IV"],
    description: "I–V–vi–IV, the four-chord pop loop",
  },
  {
    name: "sad-pop",
    mode: "major",
    numerals: ["vi", "IV", "I", "V"],
    description: "vi–IV–I–V, the same loop from the relative minor",
  },
  {
    name: "fifties",
    mode: "major",
    numerals: ["I", "vi", "IV", "V"],
    description: "I–vi–IV–V doo-wop",
  },
  {
    name: "ii-v-i",
    mode: "major",
    numerals: ["ii", "V", "I", "I"],
    sevenths: true,
    description: "ii7–V7–Imaj7, the jazz cadence",
  },
  {
    name: "turnaround",
    mode: "major",
    numerals: ["I", "vi", "ii", "V"],
    sevenths: true,
    description: "Imaj7–vi7–ii7–V7 turnaround",
  },
  {
    name: "canon",
    mode: "major",
    numerals: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
    description: "Pachelbel's canon",
  },
  {
    name: "aeolian",
    mode: "minor",
    numerals: ["i", "VI", "III", "VII"],
    description: "i–VI–III–VII minor anthem",
  },
  {
    name: "andalusian",
    mode: "minor",
    numerals: ["i", "VII", "VI", "V"],
    description: "i–VII–VI–V descending (major V)",
  },
  {
    name: "minor-ii-v",
    mode: "minor",
    numerals: ["iiø", "V7", "i", "i"],
    sevenths: true,
    description: "iiø7–V7–i minor cadence",
  },
  {
    name: "dorian-vamp",
    mode: "dorian",
    numerals: ["i", "IV"],
    sevenths: true,
    description: "i7–IV7 dorian vamp",
  },
  {
    name: "mixolydian-rock",
    mode: "mixolydian",
    numerals: ["I", "bVII", "IV", "I"],
    description: "I–bVII–IV–I mixolydian rock",
  },
]);

export const PROGRESSION_STYLES = [
  "pop",
  "jazz",
  "modal",
  "classical",
] as const;
export type ProgressionStyle = (typeof PROGRESSION_STYLES)[number];

/**
 * Functional-harmony transition weights between scale degrees (0 = I),
 * per style. Tonic (I, vi, iii) moves to predominant (IV, ii), which moves
 * to dominant (V, vii°), which resolves to tonic; pop adds the plagal and
 * vi–IV moves, jazz favours the cycle of fifths, modal keeps to the tonic
 * and its neighbours.
 */
export const TRANSITIONS: Readonly<
  Record<ProgressionStyle, readonly (readonly number[])[]>
> = Object.freeze({
  //            I  ii iii IV  V  vi vii
  pop: [
    [0, 1, 1, 4, 4, 4, 0], // I
    [1, 0, 0, 2, 5, 1, 0], // ii
    [0, 0, 0, 3, 1, 4, 0], // iii
    [4, 1, 0, 0, 4, 2, 0], // IV
    [4, 0, 0, 2, 0, 4, 0], // V
    [1, 2, 1, 5, 3, 0, 0], // vi
    [5, 0, 1, 0, 0, 1, 0], // vii°
  ],
  jazz: [
    [0, 4, 1, 2, 1, 4, 0],
    [0, 0, 0, 0, 8, 0, 1],
    [0, 0, 0, 1, 0, 6, 0],
    [2, 2, 0, 0, 2, 0, 3],
    [6, 0, 0, 0, 0, 2, 0],
    [0, 7, 0, 1, 1, 0, 0],
    [2, 0, 5, 0, 0, 0, 0],
  ],
  modal: [
    [0, 3, 1, 4, 1, 2, 2],
    [5, 0, 1, 1, 0, 0, 1],
    [3, 1, 0, 1, 0, 0, 1],
    [5, 1, 0, 0, 1, 0, 2],
    [3, 0, 0, 2, 0, 1, 1],
    [3, 1, 0, 1, 0, 0, 1],
    [5, 0, 0, 2, 0, 0, 0],
  ],
  classical: [
    [0, 2, 1, 4, 5, 3, 1],
    [0, 0, 0, 0, 6, 0, 2],
    [0, 0, 0, 2, 0, 5, 0],
    [2, 3, 0, 0, 5, 0, 1],
    [6, 0, 0, 0, 0, 2, 0],
    [0, 4, 0, 4, 1, 0, 0],
    [6, 0, 1, 0, 0, 0, 0],
  ],
});

/** Seeded PRNG (mulberry32): same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(weights: readonly number[], random: () => number): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return 0;
  let roll = random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

export function findPreset(name: string): ProgressionPreset | undefined {
  const wanted = name.trim().toLowerCase();
  return PROGRESSION_PRESETS.find((preset) => preset.name === wanted);
}

/** The next degree the graph favours most after `degree` (no randomness). */
export function likelyNext(
  degree: number,
  style: ProgressionStyle = "pop",
): number {
  const row = TRANSITIONS[style][((degree % 7) + 7) % 7]!;
  let best = 0;
  for (let i = 1; i < row.length; i += 1) if (row[i]! > row[best]!) best = i;
  return best;
}

/**
 * The chord play mode shows as "next": with a preset, the preset chord
 * after the last one played (matched by root); otherwise the strongest
 * graph transition from the last chord's degree, or I when there is none.
 */
export function suggestNext(
  key: Key,
  last: Chord | undefined,
  options: Readonly<{
    preset?: string;
    style?: ProgressionStyle;
    sevenths?: boolean;
  }> = {},
): Chord {
  const preset = options.preset ? findPreset(options.preset) : undefined;
  if (preset) {
    const chords = presetChords(key, preset);
    const index = last
      ? chords.findIndex((chord) => chord.root === last.root)
      : -1;
    return chords[(index + 1) % chords.length]!;
  }
  const degree = last ? degreeOf(key, last.root) : undefined;
  const next = degree === undefined ? 0 : likelyNext(degree, options.style);
  return diatonicChord(key, next, options.sevenths);
}

/** A preset's chords in `key` (numerals read in the key's own mode). */
export function presetChords(key: Key, preset: ProgressionPreset): Chord[] {
  return preset.numerals.map((numeral) => {
    const chord = parseRoman(key, numeral);
    if (!chord) throw new Error(`bad preset numeral ${numeral}`);
    if (!preset.sevenths || chord.extensions.length > 0) return chord;
    const withSeventh = parseRoman(key, `${numeral}7`);
    return withSeventh ?? chord;
  });
}

export type ProgressionRequest = Readonly<{
  key: Key;
  /** Number of chords, 1..64. */
  length: number;
  /** A preset name or a style for the random walk. */
  style?: ProgressionStyle | string;
  seed?: number;
  sevenths?: boolean;
}>;

/**
 * A progression of `length` chords. A preset name cycles the preset. A
 * style walks the transition graph from I with a seeded PRNG; when the
 * progression is 4+ chords long, the last chord is drawn from the
 * dominant-function chords (V, vii°, or IV in modal) so the loop leads
 * back to I. Same request, same chords.
 */
export function generateProgression(request: ProgressionRequest): Chord[] {
  const length = clampInt(request.length, 1, 64);
  const preset = request.style ? findPreset(request.style) : undefined;
  if (preset) {
    const chords = presetChords(request.key, preset);
    return Array.from({ length }, (_, i) => chords[i % chords.length]!);
  }
  const style = (PROGRESSION_STYLES as readonly string[]).includes(
    request.style ?? "",
  )
    ? (request.style as ProgressionStyle)
    : "pop";
  const sevenths = request.sevenths ?? style === "jazz";
  const random = mulberry32(request.seed ?? 1);
  const degrees: number[] = [0];
  for (let i = 1; i < length; i += 1) {
    const row: number[] = [...TRANSITIONS[style][degrees[i - 1]!]!];
    if (i === length - 1 && length >= 4) {
      const cadence = style === "modal" ? [3, 6] : [4, 6];
      for (let d = 0; d < 7; d += 1) if (!cadence.includes(d)) row[d] = 0;
      if (!row.some((w) => w > 0)) row[cadence[0]!] = 1;
    }
    degrees.push(pick(row, random));
  }
  return degrees.map((degree) => diatonicChord(request.key, degree, sevenths));
}

/** A chord with its voicing, as tools and the SDK report it. */
export type VoicedChord = Readonly<{
  name: string;
  roman: string;
  pitches: readonly number[];
  bass?: number | undefined;
}>;

/** Voice a progression with minimal movement chord to chord. */
export function voiceProgression(
  key: Key,
  chords: readonly Chord[],
  options: Readonly<{
    inversion?: number;
    spread?: Spread;
    bass?: boolean;
    anchor?: number;
    lead?: boolean;
  }> = {},
): VoicedChord[] {
  const flats = keyUsesFlats(key);
  let previous: number[] | undefined;
  return chords.map((chord) => {
    const pitches = voiceChord(chord, {
      ...(options.inversion !== undefined
        ? { inversion: options.inversion }
        : {}),
      ...(options.spread ? { spread: options.spread } : {}),
      ...(options.anchor !== undefined ? { anchor: options.anchor } : {}),
      previous: options.lead === false ? undefined : previous,
    });
    previous = pitches;
    return Object.freeze({
      name: chordName(chord, flats),
      roman: romanOf(key, chord),
      pitches: Object.freeze(pitches),
      ...(options.bass ? { bass: bassNote(chord) } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers

function mod12(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Rendering a progression to notes (tools, SDK, recording)

/** A roman numeral (`ii7`, `bVII`) or chord symbol (`Cm7`, `F/A`) in `key`. */
export function resolveChord(key: Key, text: string): Chord | undefined {
  return parseRoman(key, text) ?? parseChord(text);
}

export type RenderOptions = Readonly<{
  key: Key;
  chords: readonly Chord[];
  /** Beats each chord lasts (one bar of 4/4 by default). */
  beatsPerChord?: number;
  /** First chord's start in beats. */
  start?: number;
  perform?: PerformOptions;
  inversion?: number;
  spread?: Spread;
  /** Add a bass note under each chord. */
  bass?: boolean;
  /**
   * Bass behaviour (overrides `bass`). Every progression step is a chord,
   * so `chords` and `single` add the root (or slash bass), `unison` the
   * chord's root (the key a player would press), and `solo` drops the
   * treble and keeps only that bass.
   */
  bassMode?: BassMode;
  /** Voice-lead chord to chord (default true). */
  lead?: boolean;
  anchor?: number;
}>;

export type RenderedProgression = Readonly<{
  voiced: readonly VoicedChord[];
  notes: readonly PerformedNote[];
  bass: readonly PerformedNote[];
}>;

/**
 * A progression as notes: voice-led voicings performed over consecutive
 * spans of `beatsPerChord`, plus one sustained bass note per chord. The
 * arp-random seed advances per chord so repeated chords vary but the
 * whole render stays deterministic.
 */
export function renderProgression(options: RenderOptions): RenderedProgression {
  const span =
    options.beatsPerChord && options.beatsPerChord > 0
      ? options.beatsPerChord
      : 4;
  const start = options.start ?? 0;
  const voiced = voiceProgression(options.key, options.chords, {
    ...(options.inversion !== undefined
      ? { inversion: options.inversion }
      : {}),
    ...(options.spread ? { spread: options.spread } : {}),
    ...(options.anchor !== undefined ? { anchor: options.anchor } : {}),
    ...(options.lead !== undefined ? { lead: options.lead } : {}),
    bass: true,
  });
  const notes: PerformedNote[] = [];
  const bass: PerformedNote[] = [];
  const velocity = options.perform?.velocity ?? 0.8;
  const mode: BassMode = options.bassMode ?? (options.bass ? "chords" : "off");
  voiced.forEach((chord, index) => {
    const at = start + index * span;
    if (mode !== "solo")
      notes.push(
        ...perform(chord.pitches, at, span, {
          ...options.perform,
          seed: (options.perform?.seed ?? 0) + index,
        }),
      );
    const source = options.chords[index]!;
    const under =
      mode === "off"
        ? undefined
        : mode === "unison"
          ? bassNote({ ...source, bass: undefined })
          : chord.bass;
    if (under !== undefined)
      bass.push({
        pitch: under,
        start: round6(at),
        length: round6(span),
        velocity,
      });
  });
  return {
    voiced:
      mode !== "off"
        ? voiced
        : voiced.map(({ bass: _bass, ...rest }) => Object.freeze(rest)),
    notes,
    bass,
  };
}

/** How dawg builds chords, for the agent prompt and tool descriptions. */
export const CHORD_PROCESS = [
  "Chords (Orchid-style): pick chords from the song key's diatonic set (in C major: C Dm Em F G Am Bdim; minor keys i ii° III iv v VI VII, V major for cadences).",
  "Move tonic (I vi iii) → predominant (IV ii) → dominant (V vii°) → tonic; loops end on V or IV to lead home.",
  "Add sevenths/9ths as colour (6, m7, M7, 9 extensions); voice-lead each chord to the inversion nearest the previous one in C3–G5 so common tones hold; put the root an octave or two below as bass.",
  "Use suggest_progression to get voice-led chords and write_chords to write them (block, strum, arpeggio, harp, slop or a rhythm pattern; bassMode chords|unison|single|solo), instead of hand-placing chord notes with add_notes.",
].join(" ");
