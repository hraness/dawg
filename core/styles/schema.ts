/**
 * StyleCard schema (quality-08). A card holds a style's theory as numbers:
 * meter and cycles, tempo, groove templates, onset probability grids per
 * role, the pitch system, a harmonic grammar, melody statistics, bass
 * behaviour, form plans, a texture of dawg instruments, expression and mix.
 * Generators (`generate.ts`) sample these numbers with a seeded PRNG and
 * validators (`validate.ts`) measure the same numbers on the result.
 *
 * Cards form the taxonomy tree (`taxonomy.ts`). A root or branch card holds
 * what its leaves share; a leaf holds only its deltas. `resolveStyle(id)`
 * (index.ts) folds BASE_STYLE and the cards on the path root..leaf into one
 * frozen `ResolvedStyle`. Merge rules (`mergeCard`):
 *
 * - scalars, ranges and arrays: the child replaces the parent
 * - records (roles, onsets, chain, fx, levels): merged per key, `null`
 *   deletes the key
 * - `{ "+": Weighted<T> }` in place of a weighted list appends to the
 *   parent's list (same value: the weight adds)
 *
 * Theory, not material: cards hold grids, distributions and grammars, never
 * melodies, lyrics, transcriptions or audio. Every instrument, preset, kit,
 * rig, tuning, scale, progression, stroke, section and fx name must exist on
 * main; `styles.test.ts` checks them against the registries.
 */

/** A taxonomy id (kebab-case), node or leaf. */
import type { SongStyle } from "../style-provenance.ts";

export type StyleId = string;
/** Inclusive `[min, max]`. */
export type Range = readonly [min: number, max: number];
/** Weighted choices; weights are positive and renormalised when sampled. */
export type Weighted<T> = readonly (readonly [value: T, weight: number])[];

export const ROLE_NAMES = Object.freeze([
  "kick",
  "snare",
  "clap",
  "hat",
  "openhat",
  "rim",
  "tom",
  "perc",
  "shaker",
  "bell",
  "bass",
  "chords",
  "pad",
  "lead",
  "counter",
  "drone",
  "arp",
] as const);
export type RoleName = (typeof ROLE_NAMES)[number];

/** Roles played by the drum kit track (the seven kit voices). */
export const KIT_ROLES = Object.freeze([
  "kick",
  "snare",
  "clap",
  "rim",
  "tom",
  "hat",
  "openhat",
] as const satisfies readonly RoleName[]);
export type KitRole = (typeof KIT_ROLES)[number];

/** Percussion roles on their own track (pitched hand drums, bells). */
export const PERC_ROLES = Object.freeze([
  "perc",
  "shaker",
  "bell",
] as const satisfies readonly RoleName[]);

/** Pitched roles: one track each. */
export const PITCHED_ROLES = Object.freeze([
  "bass",
  "chords",
  "pad",
  "lead",
  "counter",
  "drone",
  "arp",
] as const satisfies readonly RoleName[]);
export type PitchedRole = (typeof PITCHED_ROLES)[number];

// ---------------------------------------------------------------------------
// Meter, cycle, tempo

export type CycleSpec = Readonly<{
  kind: "tala" | "iqa" | "gongan" | "timeline" | "usul" | "compas";
  /** Theory name of the cycle ("tintal", "maqsum", "lancaran"). */
  name: string;
  /** Pulses per cycle. */
  beats: number;
  /** Section lengths summing to `beats` (tintal [4,4,4,4]). */
  divisions: readonly number[];
  /**
   * One stroke per pulse, `"."` for a rest. Strokes in `low` (default
   * dum, dha, dhin, ge, gong, kempul, doum, bum) play the low voice of the
   * perc role; others play the high voice.
   */
  strokes: readonly string[];
  low?: readonly string[];
  /** Stressed pulses, 1-based (sam = 1). */
  stress: readonly number[];
  /** Released (khali, wave) pulses, 1-based. */
  release?: readonly number[];
}>;

export type MeterSpec = Readonly<{
  /** Weighted time signatures: [["4/4", 1]], [["7/8", 0.6], ["9/8", 0.4]]. */
  signatures: Weighted<string>;
  /**
   * Beat grouping for additive meters in the signature's denominator
   * units: 7/8 [2,2,3]. Sums to the numerator. Drives the accent profile.
   */
  grouping?: Weighted<readonly number[]>;
  /** Bars per hypermetric unit (phrase grid): 4 pop, 8 EDM, 12 blues. */
  hypermeter: Weighted<number>;
  /** A cyclic time system (tala, iqa', gongan) played by the perc role. */
  cycle?: CycleSpec;
}>;

export type TempoSpec = Readonly<{
  /** Quarter-note BPM, inclusive; also clamped to dawg's 20..300. */
  bpm: Range;
  /** The mode of the tempo distribution. */
  typical: number;
}>;

// ---------------------------------------------------------------------------
// Groove and rhythm

export type GrooveSpec = Readonly<{
  /** Template steps per quarter beat: 4 (16ths), 3 (triplets), 2 (8ths). */
  subdivision: number;
  /**
   * Long:short ratio of each off-beat pair: 1 straight, 1.5 light,
   * 2 triplet, 2.5 hard shuffle. Only meaningful for even subdivisions.
   */
  swingRatio: Range;
  /** Per-step offsets over one beat in fractions of a step (-0.5..0.5). */
  microtiming?: readonly number[];
  /** Per-step velocity multipliers over one beat (0..1.5). */
  velocity?: readonly number[];
  /** Per-role timing bias in fractions of a step (snare 0.08 lays back). */
  roleOffset?: Readonly<Partial<Record<RoleName, number>>>;
  /** Seeded humanisation: timing sd in ms (0..30), velocity sd (0..0.2). */
  humanize: Readonly<{ timingMs: number; velocity: number }>;
}>;

export type RhythmLock = Readonly<{
  /** with: b only where a; avoid: b never where a. */
  kind: "with" | "avoid";
  a: RoleName;
  b: RoleName;
}>;

export type RhythmSpec = Readonly<{
  /**
   * Onset probability per step over one bar (steps = bar beats ×
   * subdivision; for a cycle, cycle beats × subdivision). 1 is a defining
   * hit, 0.3 an optional ghost. The pattern is stretched to the actual
   * grid when the bar length differs (`gridFor`).
   */
  onsets: Readonly<Partial<Record<RoleName, readonly number[]>>>;
  /** Locks the generator enforces and the validator checks. */
  locks?: readonly RhythmLock[];
  /** A fill on the kit's toms and snare every `every` bars at phrase ends. */
  fills?: Readonly<{ every: number; density: Range }>;
}>;

// ---------------------------------------------------------------------------
// Pitch, harmony, melody, bass

export type RagaSpec = Readonly<{
  /** Ascent and descent as semitone degrees above Sa (0..12). */
  aroha: readonly number[];
  avaroha: readonly number[];
  /** Most important degree and its partner (semitones from Sa). */
  vadi: number;
  samvadi: number;
  /** Characteristic cells (theory, not a quotation), semitone degrees. */
  pakad?: readonly (readonly number[])[];
}>;

export type MaqamSpec = Readonly<{
  /** Sayr: register targets in scale degrees (0-based) the phrases visit in order. */
  sayr: readonly number[];
  /** Degree (0-based) of the ghammaz, the upper jins's tonic. */
  ghammaz: number;
}>;

export type PitchSpec = Readonly<{
  /** A TUNING_NAMES entry; absent is 12-TET. */
  tuning?: string;
  /**
   * Weighted SCALES or MODES names (12-note tunings). Fractional steps
   * (maqam quarter tones) play as cents offsets on the nearest key.
   */
  scales: Weighted<string>;
  /**
   * For a tuning whose period is not 12 notes (pelog, slendro): the tuning
   * degrees (0-based) the style uses, e.g. pelog nem [0,1,2,4,5]. Notes
   * are keys `root + octave × size + degree`.
   */
  degrees?: readonly number[];
  /** Weighted tonic pitch classes, or "any". */
  tonic: Weighted<number> | "any";
  maqam?: MaqamSpec;
  raga?: RagaSpec;
}>;

export type VoicingSpec = Readonly<{
  /** close, open, wide (chord engine spreads), shell (3+7), power (1+5), quartal. */
  types: Weighted<string>;
  /** MIDI range of the chord role. */
  range: Range;
  /** Sounding notes per chord. */
  notes: Range;
  /** A STROKE_PATTERNS name for a strummed chord role. */
  strokes?: Weighted<string>;
}>;

export type HarmonySpec = Readonly<{
  /**
   * functional: numeral grammar (presets, chain, forms); modal: a vamp on
   * the tonic and neighbours; drone: tonic and fifth only; none: no chords.
   */
  model: "functional" | "modal" | "drone" | "none";
  /** Weighted PROGRESSION_PRESETS names. */
  presets?: Weighted<string>;
  /** Weighted fixed changes (12-bar blues) as numerals, one per bar unit. */
  forms?: Weighted<readonly string[]>;
  /** Markov chain over numerals: from -> weighted next. */
  chain?: Readonly<Record<string, Weighted<string>>>;
  /** Weights of presets : forms : chain when several are set. */
  sources?: Readonly<{ presets?: number; forms?: number; chain?: number }>;
  /** Phrase-final cadences: "V-I", "IV-I", "bVII-I", "V-vi", "iv-I", "bII-I", "half". */
  cadences: Weighted<string>;
  /** Chords per bar (0.5 = one chord per two bars). */
  rhythm: Weighted<number>;
  /** Seventh rate: chance a triad numeral gets its diatonic seventh. */
  sevenths: number;
  voicing: VoicingSpec;
}>;

export type MelodySpec = Readonly<{
  /** arch, ascending, descending, wave, flat, terraced. */
  contour: Weighted<string>;
  /** Semitone span of one phrase. */
  ambitus: Range;
  /** MIDI range of the lead. */
  range: Range;
  /** Signed step weights for -12..12 semitones (25 bins). */
  intervals: readonly number[];
  /** Chance a strong-beat note is a chord tone (functional harmony only). */
  chordToneRate: number;
  /** Onsets per beat. */
  density: Range;
  /** Phrase lengths in bars. */
  phraseBars: Weighted<number>;
  /** Chance a phrase repeats the previous phrase's rhythm. */
  repetition: number;
  /** Phrase-final scale degrees (0-based scale indices). */
  finals: Weighted<number>;
}>;

export type BassSpec = Readonly<{
  /** root, root-fifth, walking, octave, arpeggio, pedal, ostinato, none. */
  behaviour: Weighted<string>;
  range: Range;
  /** Onset probability grid (same steps as rhythm); walking ignores it. */
  onsets?: readonly number[];
  /** Walking: chord tone on beat 1 rate and chromatic approach rate. */
  walk?: Readonly<{ chordToneOnOne: number; chromaticApproach: number }>;
  /** Fraction of bass onsets that must coincide with a kick (validator). */
  kickLock?: number;
}>;

// ---------------------------------------------------------------------------
// Form, texture, expression, mix

/** SECTION_KINDS from core/sections.ts. */
export type SectionKind =
  | "intro"
  | "verse"
  | "pre"
  | "chorus"
  | "build"
  | "drop"
  | "breakdown"
  | "bridge"
  | "outro";

export type FormSpec = Readonly<{
  /** Weighted section plans. */
  plans: Weighted<readonly SectionKind[]>;
  /** Energy 0..1 per section kind: density and role entry. */
  energy?: Readonly<Partial<Record<SectionKind, number>>>;
  /** Roles that play in a section kind (absent: every role). */
  roleMap?: Readonly<Partial<Record<SectionKind, readonly RoleName[]>>>;
  /** Named archetype for the agent: aaba, 12-bar, strophic, alap-jor-jhala. */
  archetype?: string;
}>;

export type RoleVoice = Readonly<{
  /**
   * An instrument word on main (`core/instruments.ts`): a legacy word
   * (piano, bass, lead...), a row word (upright, rhodes, oud, tabla,
   * flute, choir...), or "drums" for the kit.
   */
  instrument: string;
  /** Drum kit: a SYNTH_KIT_NAMES entry. */
  kit?: string;
  /** Guitar rig: a RIG_PRESETS name. */
  rig?: string;
  weight: number;
}>;

export type RoleTexture = Readonly<{
  required: boolean;
  voices: readonly RoleVoice[];
}>;

export type TextureSpec = Readonly<{
  roles: Readonly<Partial<Record<RoleName, RoleTexture | null>>>;
  kind:
    | "monophonic"
    | "homophonic"
    | "polyphonic"
    | "heterophonic"
    | "interlocking";
}>;

export type ExpressionSpec = Readonly<{
  /** Velocity range across the song, 0..1. */
  dynamics: Range;
  /** ARTICULATIONS weights per pitched role. */
  articulation?: Readonly<Partial<Record<RoleName, Weighted<string>>>>;
}>;

export type MixSpec = Readonly<{
  /** FX_PRESETS per role: effect -> preset name. */
  fx?: Readonly<Partial<Record<RoleName, Readonly<Record<string, string>>>>>;
  /** Role levels in dB relative to 0 (lead). */
  levels?: Readonly<Partial<Record<RoleName, number>>>;
  /** Pan -1..1. */
  pan?: Readonly<Partial<Record<RoleName, number>>>;
  /** Overall reverb amount 0..1. */
  space: number;
  /**
   * Loudness target the song master normalises to (core/master.ts
   * LOUDNESS_TARGETS: streaming, club, loud, classical, ambient...). The
   * generated song always carries a limiter, so it never clips.
   */
  loudness?: string;
}>;

// ---------------------------------------------------------------------------
// Cards

/** A full style: every section present (BASE_STYLE plus the card path). */
export type ResolvedStyle = Readonly<{
  id: StyleId;
  title: string;
  /** Root..leaf ids whose cards were merged (cards only). */
  lineage: readonly StyleId[];
  summary: string;
  seedSalt: number;
  meter: MeterSpec;
  tempo: TempoSpec;
  groove: GrooveSpec;
  rhythm: RhythmSpec;
  pitch: PitchSpec;
  harmony: HarmonySpec;
  melody: MelodySpec;
  bass: BassSpec;
  form: FormSpec;
  texture: TextureSpec;
  expression: ExpressionSpec;
  mix: MixSpec;
  wants: readonly string[];
}>;

/** Deep partial with `null` deletions for records. */
export type Patch<T> = T extends readonly unknown[]
  ? T | Readonly<{ "+": T }>
  : T extends object
    ? { readonly [K in keyof T]?: Patch<T[K]> | null }
    : T;

/** The fields of a resolved style a card may set. */
export type StyleBody = Omit<ResolvedStyle, "id" | "title" | "lineage">;

export type StyleCard = Readonly<{
  /** A taxonomy id. */
  id: StyleId;
  /** Abstract cards (branch nodes) resolve but are flagged in /style list. */
  abstract?: boolean;
}> &
  Patch<StyleBody>;

/** Identity helper for card literals (type checks the patch). */
export function card(value: StyleCard): StyleCard {
  return Object.freeze(value);
}

/** Generation options shared by /style, the agent tool and the SDK. */
export type StyleOptions = Readonly<{
  seed?: number;
  bars?: number;
  /** Tonic pitch class override (0 = C). */
  tonic?: number;
  /** Tempo override (clamped into the style's range). */
  bpm?: number;
}>;

/** Provenance stored on a song: which style and seed made it (`score.style`). */
export type StyleProvenance = SongStyle;
