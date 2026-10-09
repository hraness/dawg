/**
 * dawg SDK v1: pure builders for `song.ts` and `tracks/<slug>/track.ts`.
 *
 * Author everything in beats; `song()` converts to the integer ticks the
 * score stores. Every function returns frozen plain data, does no I/O and
 * has no dependencies, so this file is vendored unchanged into
 * `.dawg/sdk/v1.ts` and imported as `"dawg"`:
 *
 * ```ts
 * // tracks/bass/track.ts
 * import { track, note, seq } from "dawg";
 * export default track({
 *   name: "bass",
 *   instrument: "bass",
 *   volume: 0.8,
 *   notes: [note("A1", 0, 1), ...seq("E2 G2 A2", { from: 4, step: 0.5 })],
 * });
 *
 * // song.ts
 * import { song } from "dawg";
 * import bass from "./tracks/bass/track.ts";
 * export default song({ tempo: 120, meter: [4, 4], bars: 4, tracks: [bass] });
 * ```
 *
 * Additions to v1 are backwards compatible: new optional fields default to
 * the old behaviour and files that do not use them reprint byte-for-byte.
 */

/** SDK release; dawg refreshes the vendored copy when its own is newer. */
export const SDK_VERSION = "1.20.0";
/** Major of `SDK_VERSION`; `dawg.json` records it as `sdk`. */
export const SDK_MAJOR = 1;

/** Ticks per beat the score uses unless `song({ ticksPerBeat })` says otherwise. */
export const DEFAULT_TICKS_PER_BEAT = 480;
/** Velocity used when a note or hit omits it. */
export const DEFAULT_VELOCITY = 0.8;
/** Length in beats used when a hit omits it (a sixteenth at 4/4). */
export const DEFAULT_HIT_LENGTH = 0.25;

/** A MIDI number 0..127 or a pitch name such as `"C4"`, `"F#2"`, `"Bb3"`. */
export type Pitch = number | string;

/** Thrown by every builder when its input is malformed; the message names the field. */
export class DawgSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DawgSdkError";
  }
}

// ---------------------------------------------------------------------------
// Pitches

const SEMITONES: Readonly<Record<string, number>> = Object.freeze({
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
});

/**
 * MIDI number for a pitch name (`"A4"` → 69, `"C#3"` → 49, `"Bb2"` → 46;
 * octaves -1..9, case-insensitive). Numbers 0..127 pass through.
 * Throws `DawgSdkError` otherwise.
 */
export function midi(pitch: Pitch): number {
  if (typeof pitch === "number") {
    if (Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) return pitch;
    throw new DawgSdkError(`pitch must be a MIDI integer 0..127: ${pitch}`);
  }
  const match =
    typeof pitch === "string"
      ? pitch.trim().match(/^([a-gA-G])([#b]?)(-?\d{1,2})$/)
      : null;
  if (!match)
    throw new DawgSdkError(
      `pitch must be a name like "C4" or "F#2": ${JSON.stringify(pitch)}`,
    );
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const value =
    (Number(match[3]) + 1) * 12 +
    SEMITONES[match[1]!.toLowerCase()]! +
    accidental;
  if (value < 0 || value > 127)
    throw new DawgSdkError(`pitch is outside MIDI 0..127: ${pitch}`);
  return value;
}

/**
 * A pitch with an optional cents suffix (SDK 1.16.0): `"E4-14c"` is E4
 * fourteen cents flat, `"A3+50c"` a quarter tone sharp. The offset is
 * static and sits on top of the song or track tuning; ±1200 at most.
 */
export function pitchCents(pitch: Pitch): Readonly<{
  pitch: number;
  cents: number;
}> {
  const match =
    typeof pitch === "string"
      ? pitch.trim().match(/^(.+?)([+-]\d+(?:\.\d+)?)c$/)
      : null;
  if (!match) return { pitch: midi(pitch), cents: 0 };
  const cents = Number(match[2]);
  if (!(Math.abs(cents) <= 1200))
    throw new DawgSdkError(`pitch cents must be within ±1200: ${pitch}`);
  return { pitch: midi(match[1]!), cents };
}

// ---------------------------------------------------------------------------
// Drum voices (General MIDI numbers, same table as dawg's `kit`)

/** Drum voice names a `kit` track understands in `hit()`. */
export type DrumVoice =
  "kick" | "snare" | "clap" | "rim" | "tom" | "hat" | "openhat";

/** GM pitch stored for each kit voice; `hit("kick", 0)` writes pitch 36. */
export const DRUM_PITCHES: Readonly<Record<DrumVoice, number>> = Object.freeze({
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  hat: 42,
  tom: 45,
  openhat: 46,
});

const DRUM_ALIASES: Readonly<Record<string, DrumVoice>> = Object.freeze({
  kick: "kick",
  bd: "kick",
  snare: "snare",
  sd: "snare",
  clap: "clap",
  cp: "clap",
  rim: "rim",
  rimshot: "rim",
  perc: "rim",
  tom: "tom",
  lt: "tom",
  hat: "hat",
  hh: "hat",
  hihat: "hat",
  "hi-hat": "hat",
  closedhat: "hat",
  "closed-hat": "hat",
  chh: "hat",
  openhat: "openhat",
  "open-hat": "openhat",
  ohh: "openhat",
  oh: "openhat",
  open: "openhat",
});

/** Instrument names dawg treats as the synthesized drum kit. */
export const KIT_INSTRUMENTS: readonly string[] = Object.freeze([
  "kit",
  "drums",
  "drum",
  "drumkit",
]);

/** Instrument name that selects a track's sampler. */
export const SAMPLER_INSTRUMENT = "sampler";
/** First pitch slot given to one-shot sampler voices (voice names sorted). */
export const SAMPLER_FIRST_SLOT = 36;

// ---------------------------------------------------------------------------
// Notes and hits

/** A pitched note in beats. Build with `note()` or `seq()`. */
export type NoteSpec = Readonly<{
  kind: "note";
  /** MIDI 0..127. */
  pitch: number;
  /** Start in beats from the loop start, ≥ 0. */
  start: number;
  /** Length in beats, > 0. */
  length: number;
  /** 0..1. */
  velocity: number;
  /** Static offset in cents from a `"E4-14c"` pitch (SDK 1.16.0); absent is 0. */
  cents?: number;
}> &
  NoteExpressionSpec;

/** A drum or sampler hit addressed by voice name; resolved to a pitch slot by `track()`. */
export type HitSpec = Readonly<{
  kind: "hit";
  voice: string;
  start: number;
  length: number;
  velocity: number;
}> &
  NoteExpressionSpec;

/** How a note is articulated (SDK 1.15.0). */
export type Articulation =
  "staccato" | "legato" | "accent" | "tenuto" | "marcato" | "ghost";

export const ARTICULATIONS: readonly Articulation[] = Object.freeze([
  "staccato",
  "legato",
  "accent",
  "tenuto",
  "marcato",
  "ghost",
]);

/** A pitch-bend point: `[at, cents]`, `at` 0..1 through the note. */
export type BendPoint = readonly [number, number];

/**
 * How one note is played (SDK 1.15.0). Every field is optional.
 *
 * ```ts
 * note("C4", 0, 1, 0.8, { art: "staccato" })
 * note("E4", 1, 2, 0.8, { glide: 0.1, vibrato: { depth: 30, delay: 0.3 } })
 * note("G4", 3, 1, 0.8, { bend: [[0, -200], [0.25, 0]] }) // scoop up a tone
 * ```
 */
export type Expression = Readonly<{
  /**
   * `staccato` (half length), `legato` (held into the next note),
   * `accent` (louder), `tenuto` (full length, a little louder), `marcato`
   * (two-thirds length, much louder) or `ghost` (half length, much softer).
   */
  articulation?: Articulation;
  /** Short alias of `articulation`. */
  art?: Articulation;
  /** Portamento into this note from the track's previous pitch, seconds (0..10). */
  glide?: number;
  /** Pitch curve in cents as `[at, cents]` points, `at` 0..1 through the note; linear between points. */
  bend?: readonly BendPoint[];
  /** Vibrato: `rate` Hz (default 5.5), `depth` cents either side (default 20), `delay` seconds before it fades in. */
  vibrato?: Readonly<{ rate?: number; depth?: number; delay?: number }>;
  /**
   * This note's humanize (SDK 1.15.0), replacing the track's amounts:
   * `{ timing ms, velocity %, length % }`; `{}` keeps the note exact.
   * Humanize just bars 5-8 with `expr({ humanize: { timing: 10 } }, ...)`.
   */
  humanize?: Readonly<{ timing?: number; velocity?: number; length?: number }>;
}>;

/** The expression a built note carries; fields are present only when set. */
export type NoteExpressionSpec = Readonly<{
  articulation?: Articulation;
  glide?: number;
  bend?: readonly BendPoint[];
  vibrato?: Readonly<{ rate: number; depth: number; delay?: number }>;
  humanize?: Readonly<{ timing?: number; velocity?: number; length?: number }>;
}>;

const DEFAULT_VIBRATO_RATE = 5.5;
const DEFAULT_VIBRATO_DEPTH = 20;

function expression(
  input: Expression | undefined,
  label: string,
): NoteExpressionSpec {
  if (input === undefined) return {};
  if (!isRecord(input))
    throw new DawgSdkError(`${label} expression must be an object`);
  for (const key of Object.keys(input))
    if (
      !["articulation", "art", "glide", "bend", "vibrato", "humanize"].includes(
        key,
      )
    )
      throw new DawgSdkError(
        `${label} expression has an unknown field "${key.slice(0, 32)}" (articulation glide bend vibrato humanize)`,
      );
  const out: {
    articulation?: Articulation;
    glide?: number;
    bend?: readonly BendPoint[];
    vibrato?: Readonly<{ rate: number; depth: number; delay?: number }>;
    humanize?: Readonly<{
      timing?: number;
      velocity?: number;
      length?: number;
    }>;
  } = {};
  const articulation = input.articulation ?? input.art;
  if (articulation !== undefined) {
    if (!ARTICULATIONS.includes(articulation))
      throw new DawgSdkError(
        `${label} articulation must be one of ${ARTICULATIONS.join(" ")}`,
      );
    out.articulation = articulation;
  }
  if (input.glide !== undefined) {
    const glide = finite(input.glide, `${label} glide`);
    if (glide < 0) throw new DawgSdkError(`${label} glide must be ≥ 0`);
    out.glide = glide;
  }
  if (input.bend !== undefined) {
    if (!Array.isArray(input.bend) || input.bend.length > 32)
      throw new DawgSdkError(
        `${label} bend must be at most 32 [at, cents] points`,
      );
    if (input.bend.length > 0)
      out.bend = Object.freeze(
        input.bend.map((point: unknown, index: number): BendPoint => {
          if (!Array.isArray(point) || point.length !== 2)
            throw new DawgSdkError(
              `${label} bend[${index}] must be [at, cents]`,
            );
          return Object.freeze([
            unit(point[0], `${label} bend[${index}] at`),
            finite(point[1], `${label} bend[${index}] cents`),
          ] as const);
        }),
      );
  }
  if (input.vibrato !== undefined) {
    if (!isRecord(input.vibrato))
      throw new DawgSdkError(`${label} vibrato must be { rate, depth, delay }`);
    const delay =
      input.vibrato.delay === undefined
        ? 0
        : finite(input.vibrato.delay, `${label} vibrato delay`);
    out.vibrato = Object.freeze({
      rate: finite(
        input.vibrato.rate ?? DEFAULT_VIBRATO_RATE,
        `${label} vibrato rate`,
      ),
      depth: finite(
        input.vibrato.depth ?? DEFAULT_VIBRATO_DEPTH,
        `${label} vibrato depth`,
      ),
      ...(delay !== 0 ? { delay } : {}),
    });
  }
  if (input.humanize !== undefined) {
    if (!isRecord(input.humanize))
      throw new DawgSdkError(
        `${label} humanize must be { timing, velocity, length }`,
      );
    const amounts: Record<string, number> = {};
    for (const key of Object.keys(input.humanize)) {
      if (key !== "timing" && key !== "velocity" && key !== "length")
        throw new DawgSdkError(
          `${label} humanize has an unknown field "${key.slice(0, 32)}" (timing velocity length)`,
        );
      const value = finite(input.humanize[key], `${label} humanize ${key}`);
      if (value < 0)
        throw new DawgSdkError(`${label} humanize ${key} must be ≥ 0`);
      if (value > 0) amounts[key] = value;
    }
    out.humanize = Object.freeze(amounts);
  }
  return out;
}

/**
 * The same expression on many notes or hits (SDK 1.15.0); a note's own
 * fields win.
 *
 * ```ts
 * notes: expr(seq("C2 C2 Eb2 C3", { step: 0.25 }), { art: "staccato" })
 * ```
 */
export function expr<T extends NoteSpec | HitSpec>(
  notes: readonly T[],
  expression_: Expression,
): readonly T[] {
  if (!Array.isArray(notes))
    throw new DawgSdkError("expr needs an array of notes or hits");
  const shared = expression(expression_, "expr");
  return Object.freeze(
    notes.map((item, index) => {
      if (!isRecord(item) || (item.kind !== "note" && item.kind !== "hit"))
        throw new DawgSdkError(
          `expr notes[${index}] must come from note(), seq(), hit() or hits()`,
        );
      return Object.freeze({ ...shared, ...item }) as T;
    }),
  );
}

/**
 * One note. `pitch` is a name or MIDI number, `start` and `length` are
 * beats, `velocity` defaults to 0.8, and `how` adds expression
 * (articulation, glide, bend, vibrato; SDK 1.15.0). A cents suffix detunes
 * one note (SDK 1.16.0): `"E4-14c"` (see `pitchCents`).
 *
 * ```ts
 * note("A1", 0, 1)          // A1 on the downbeat for one beat
 * note("A1", 1.5, 0.5, 0.6) // off-beat eighth, softer
 * note("A1", 2, 1, 0.8, { art: "staccato" })
 * note("E4-14c", 2)         // a just major third over C, 14 cents flat
 * ```
 */
export function note(
  pitch: Pitch,
  start: number,
  length = 1,
  velocity = DEFAULT_VELOCITY,
  how?: Expression,
): NoteSpec {
  const tuned = pitchCents(pitch);
  return Object.freeze({
    kind: "note",
    pitch: tuned.pitch,
    start: beat(start, "note start"),
    length: positive(length, "note length"),
    velocity: unit(velocity, "note velocity"),
    ...expression(how, "note"),
    ...(tuned.cents !== 0 ? { cents: tuned.cents } : {}),
  });
}

/** Options for `seq()`. */
export type SeqOptions = Readonly<{
  /** Beat of the first step, default 0. */
  from?: number;
  /** Beats between steps, default 1. */
  step?: number;
  /** Length of each note in beats, default `step`. */
  len?: number;
  /** Velocity of each note, default 0.8. */
  vel?: number;
}>;

/**
 * A step sequence: pitches separated by spaces (or an array), one per
 * `step` beats starting at `from`. `.`, `-` or `_` is a rest.
 *
 * ```ts
 * seq("E2 G2 A2", { from: 4, step: 0.5, len: 0.5 })
 * seq("C4 . E4 . G4", { step: 0.25 })
 * ```
 */
export function seq(
  pattern: string | readonly Pitch[],
  options: SeqOptions = {},
): readonly NoteSpec[] {
  const tokens =
    typeof pattern === "string" ? pattern.trim().split(/\s+/) : [...pattern];
  if (
    tokens.length === 0 ||
    tokens.length > 4096 ||
    tokens.every((token) => token === "")
  )
    throw new DawgSdkError("seq pattern must have 1..4096 steps");
  const from = beat(options.from ?? 0, "seq from");
  const step = positive(options.step ?? 1, "seq step");
  const len = positive(options.len ?? step, "seq len");
  const vel = unit(options.vel ?? DEFAULT_VELOCITY, "seq vel");
  const notes: NoteSpec[] = [];
  tokens.forEach((token, index) => {
    if (token === "." || token === "-" || token === "_" || token === "") return;
    notes.push(note(token, from + index * step, len, vel));
  });
  return Object.freeze(notes);
}

/**
 * One drum or sampler hit. On a `kit` track `voice` is `kick`, `snare`,
 * `clap`, `rim`, `tom`, `hat` or `openhat` (aliases `bd`, `sd`, `cp`, `hh`,
 * `oh` work); on a `sampler()` track it is a voice name. `length` defaults
 * to a sixteenth; `how` adds expression (`{ art: "ghost" }`, SDK 1.15.0).
 */
export function hit(
  voice: string,
  start: number,
  velocity = DEFAULT_VELOCITY,
  length = DEFAULT_HIT_LENGTH,
  how?: Expression,
): HitSpec {
  if (typeof voice !== "string" || voice.length === 0 || voice.length > 32)
    throw new DawgSdkError("hit voice must be a short name");
  return Object.freeze({
    kind: "hit",
    voice,
    start: beat(start, "hit start"),
    length: positive(length, "hit length"),
    velocity: unit(velocity, "hit velocity"),
    ...expression(how, "hit"),
  });
}

/**
 * The same hit on several beats: `hits("kick", [0, 1, 2, 3])` or
 * `hits("hat", every(0.5, { from: 0.25 }), 0.5)`.
 */
export function hits(
  voice: string,
  beats: readonly number[],
  velocity = DEFAULT_VELOCITY,
  length = DEFAULT_HIT_LENGTH,
): readonly HitSpec[] {
  if (!Array.isArray(beats) || beats.length > 4096)
    throw new DawgSdkError("hits needs an array of at most 4096 beats");
  return Object.freeze(beats.map((at) => hit(voice, at, velocity, length)));
}

/** Options for `every()`. */
export type EveryOptions = Readonly<{
  /** First beat, default 0. */
  from?: number;
  /** Exclusive end in beats, default 16 (four bars of 4/4). Pass `bars * beatsPerBar`. */
  until?: number;
}>;

/**
 * Beats from `from` (default 0) up to but excluding `until` (default 16)
 * every `step` beats: `every(1)` → `[0, 1, …, 15]`,
 * `every(0.5, { from: 0.25, until: 4 })` → `[0.25, 0.75, …, 3.75]`.
 */
export function every(step: number, options: EveryOptions = {}): number[] {
  const size = positive(step, "every step");
  const from = beat(options.from ?? 0, "every from");
  const until = beat(options.until ?? 16, "every until");
  const count = Math.max(0, Math.ceil((until - from) / size - 1e-9));
  if (count > 4096)
    throw new DawgSdkError("every would produce over 4096 beats");
  const beats: number[] = [];
  for (let index = 0; index < count; index += 1)
    beats.push(round(from + index * size));
  return beats;
}

// ---------------------------------------------------------------------------
// Rhythm rows (Euclidean generators, Torso T-1 style)

/** Per-pass variation of a rhythm row (T-1 Cycles). */
export type RhythmCycleSpec = Readonly<{
  pulses?: number;
  rotate?: number;
  repeats?: number;
  probability?: number;
  velocity?: number;
}>;

/**
 * Parameters of one generated voice. Every field is optional; dawg checks
 * ranges when the song loads. Note values are strings: `"1/16"`, `"1/8t"`.
 */
export type RhythmOptions = Readonly<{
  /** Steps 1..64, default 16. */
  steps?: number;
  /** Hits 0..steps spread as evenly as possible, default 4. */
  pulses?: number;
  /** Shift the pattern later by this many steps (negative: earlier), like Strudel's `euclidRot`. */
  rotate?: number;
  /** Length of a step, default `"1/16"`. */
  division?: string;
  /** Explicit steps instead of a Euclidean pattern: `x` hit, `X` accent, `.` rest. */
  grid?: string;
  /** Extra triggers after each pulse, 0..16 (T-1 Repeats). Cut off by the next pulse. */
  repeats?: number;
  /** Spacing of the repeats as a note value, default the step (T-1 Time). */
  time?: string;
  /** -1..1: repeats accelerate (<0) or decelerate (>0) (T-1 Pace). */
  pace?: number;
  /** -1..1: repeats fade out (<0) or build up (>0). */
  ramp?: number;
  /** Base velocity 0..1, default 0.8. */
  velocity?: number;
  /** 0..1: how far accented pulses rise toward full velocity. */
  accent?: number;
  /** Accented pulses as E(accents, pulses); default 1 (the first). */
  accents?: number;
  /** Note length in steps, 0.05..4 (T-1 Sustain), default 1. */
  gate?: number;
  /** Every pulse lasts until the next one, like Strudel's `euclidLegato`. */
  legato?: boolean;
  /** Chance 0..1 that a pulse plays; deterministic for a given `seed`. */
  probability?: number;
  /** Integer 0..1000000 choosing which pulses `probability` drops. */
  seed?: number;
  /** -0.5..0.5 of a step: every second step later (>0) or earlier. */
  swing?: number;
  /** -0.5..0.5 of a step: the whole row later or earlier. */
  nudge?: number;
  /** Variations applied on successive passes of the row (T-1 Cycles). */
  cycles?: readonly RhythmCycleSpec[];
}>;

/** One generated voice on a track's `rhythm` list. Build with `euclid()` or `grid()`. */
export type RhythmSpec = Readonly<
  RhythmOptions & {
    kind: "rhythm";
    voice: string;
  }
>;

/**
 * A Euclidean rhythm row: `pulses` hits spread over `steps`, rotated later
 * by `rotate` steps. Same patterns and rotation direction as Strudel's
 * `euclid`/`euclidRot` (`euclid("kick", 3, 8)` is `x..x..x.`). dawg expands
 * the row into hits when the song loads, so you edit the parameters, not
 * the notes; the row repeats every `steps` steps to the end of the loop.
 *
 * ```ts
 * rhythm: [
 *   euclid("kick", 4, 16),
 *   euclid("hat", 7, 16, 2, { velocity: 0.5, accent: 0.6, accents: 3 }),
 *   euclid({ voice: "snare", pulses: 2, steps: 16, rotate: 4 }),
 * ]
 * ```
 */
export function euclid(
  voice: string | (RhythmOptions & { voice: string }),
  pulses?: number,
  steps?: number,
  rotate?: number | RhythmOptions,
  options: RhythmOptions = {},
): RhythmSpec {
  if (isRecord(voice)) {
    const input = voice as RhythmOptions & { voice: string };
    return rhythmSpec(input.voice, input);
  }
  // `euclid("hat", 7, 16, { velocity: 0.5 })`: options without a rotate.
  if (isRecord(rotate)) {
    options = { ...(rotate as RhythmOptions), ...options };
    rotate = undefined;
  }
  const fields: Record<string, unknown> = { ...options };
  if (pulses !== undefined) fields.pulses = pulses;
  if (steps !== undefined) fields.steps = steps;
  if (rotate !== undefined) fields.rotate = rotate;
  return rhythmSpec(voice, fields as RhythmOptions);
}

/** `euclid(voice, pulses, steps, rotate)` under Strudel's name. */
export function euclidRot(
  voice: string,
  pulses: number,
  steps: number,
  rotate: number,
  options: RhythmOptions = {},
): RhythmSpec {
  return euclid(voice, pulses, steps, rotate, options);
}

/** A Euclidean row whose hits last until the next one (Strudel `euclidLegato`). */
export function euclidLegato(
  voice: string,
  pulses: number,
  steps: number,
  rotate = 0,
  options: RhythmOptions = {},
): RhythmSpec {
  return euclid(voice, pulses, steps, rotate, { ...options, legato: true });
}

/**
 * An explicit step row: `grid("snare", "....x.......x...")`. `X` is an
 * accented hit; the string's length is the step count.
 */
export function grid(
  voice: string,
  steps: string,
  options: RhythmOptions = {},
): RhythmSpec {
  return rhythmSpec(voice, { ...options, grid: steps });
}

function rhythmSpec(voice: unknown, options: RhythmOptions): RhythmSpec {
  if (
    typeof voice !== "string" ||
    voice.trim().length === 0 ||
    voice.length > 32
  )
    throw new DawgSdkError("rhythm voice must be a short name");
  if (!isRecord(options))
    throw new DawgSdkError("rhythm options must be an object");
  const out: Record<string, unknown> = { kind: "rhythm", voice: voice.trim() };
  for (const [key, value] of Object.entries(options)) {
    if (key === "voice" || key === "kind" || value === undefined) continue;
    if (!RHYTHM_KEYS.includes(key))
      throw new DawgSdkError(
        `rhythm ${voice}: unknown option "${key}" (${RHYTHM_KEYS.join(" ")})`,
      );
    out[key] =
      key === "cycles" && Array.isArray(value)
        ? Object.freeze(value.map((cycle) => Object.freeze({ ...cycle })))
        : value;
  }
  return Object.freeze(out) as RhythmSpec;
}

/** Row fields in the order dawg stores and prints them. */
export const RHYTHM_KEYS: readonly string[] = Object.freeze([
  "steps",
  "pulses",
  "rotate",
  "division",
  "grid",
  "repeats",
  "time",
  "pace",
  "ramp",
  "velocity",
  "accent",
  "accents",
  "gate",
  "legato",
  "probability",
  "seed",
  "swing",
  "nudge",
  "cycles",
]);

// ---------------------------------------------------------------------------
// Drum pattern library

/**
 * A named starting groove: one rhythm row per voice, ready for a
 * `instrument: "kit"` track. Rows are Euclidean where the part is
 * Euclidean and explicit grids otherwise. All patterns are 4/4; `swing`
 * is already applied to the rows.
 */
export type DrumPattern = Readonly<{
  name: string;
  label: string;
  tags: readonly string[];
  /** Usual tempo range and a suggested tempo, BPM. */
  tempo: Readonly<{ min: number; max: number; bpm: number }>;
  beatsPerBar: number;
  /** Swing of the 16th rows, -0.5..0.5 of a step. */
  swing: number;
  /** A synthesized kit that suits it (see `kit` on `track()`). */
  kit: string;
  rows: readonly RhythmSpec[];
}>;

function drumPattern(
  name: string,
  label: string,
  tags: readonly string[],
  tempo: readonly [number, number, number],
  kit: string,
  swing: number,
  rows: readonly RhythmSpec[],
): DrumPattern {
  return Object.freeze({
    name,
    label,
    tags: Object.freeze([...tags]),
    tempo: Object.freeze({ min: tempo[0], max: tempo[1], bpm: tempo[2] }),
    beatsPerBar: 4,
    swing,
    kit,
    rows: Object.freeze(
      rows.map((row) =>
        swing !== 0 && row.swing === undefined && row.division === undefined
          ? Object.freeze({ ...row, swing })
          : row,
      ),
    ),
  });
}

/**
 * The library. Written for dawg from common knowledge of each style (no
 * transcriptions): the defining placements of kick, snare and hats, kept
 * short so they are easy to vary.
 */
export const DRUM_PATTERNS: readonly DrumPattern[] = Object.freeze([
  drumPattern(
    "house",
    "House four-on-the-floor",
    ["house", "dance", "four-on-the-floor"],
    [118, 128, 124],
    "syn909",
    0,
    [
      euclid("kick", 4, 16),
      grid("clap", "....x.......x..."),
      euclid("openhat", 4, 16, 2, { velocity: 0.6 }),
      euclid("hat", 16, 16, 0, { velocity: 0.35, accent: 0.4, accents: 4 }),
    ],
  ),
  drumPattern(
    "disco",
    "Disco",
    ["disco", "dance", "four-on-the-floor"],
    [110, 125, 118],
    "acoustic",
    0,
    [
      euclid("kick", 4, 16),
      grid("snare", "....x.......x..."),
      euclid("openhat", 4, 16, 2, { velocity: 0.65 }),
      euclid("hat", 8, 16, 0, { velocity: 0.45 }),
    ],
  ),
  drumPattern(
    "techno",
    "Techno",
    ["techno", "dance", "four-on-the-floor"],
    [125, 140, 132],
    "syn909",
    0,
    [
      euclid("kick", 4, 16),
      euclid("openhat", 4, 16, 2, { velocity: 0.55 }),
      euclid("hat", 16, 16, 0, {
        velocity: 0.4,
        accent: 0.5,
        accents: 4,
        probability: 0.9,
        seed: 7,
      }),
      euclid("rim", 3, 8, 3, { velocity: 0.55 }),
      grid("clap", "............x...", { velocity: 0.7 }),
    ],
  ),
  drumPattern(
    "minimal",
    "Minimal Euclidean",
    ["minimal", "techno", "euclidean"],
    [120, 130, 124],
    "electro",
    0,
    [
      euclid("kick", 4, 16),
      euclid("rim", 5, 16, 3, { velocity: 0.6 }),
      euclid("hat", 7, 16, 2, { velocity: 0.45, accent: 0.5, accents: 3 }),
      euclid("tom", 3, 16, 6, { velocity: 0.5 }),
    ],
  ),
  drumPattern(
    "electro",
    "Electro",
    ["electro", "breaks"],
    [120, 135, 128],
    "electro",
    0,
    [
      grid("kick", "x.....x..x......"),
      grid("snare", "....x.......x..."),
      euclid("hat", 16, 16, 0, { velocity: 0.4, accent: 0.5, accents: 4 }),
      grid("clap", "....x.......x..x", { velocity: 0.6 }),
    ],
  ),
  drumPattern(
    "breakbeat",
    "Breakbeat",
    ["breaks", "big beat"],
    [120, 140, 130],
    "acoustic",
    0,
    [
      grid("kick", "x.........x.x...x.x.......x....."),
      grid("snare", "....x.......x.......x..x....x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.5 }),
    ],
  ),
  drumPattern(
    "amen-style",
    "Amen-style break",
    ["breaks", "jungle", "drum and bass"],
    [160, 176, 170],
    "acoustic",
    0,
    [
      grid("kick", "x.x.......xx....x.x.......x....."),
      grid("snare", "....X..x.x..X..x....X..x.x....X.", {
        velocity: 0.55,
        accent: 0.4,
      }),
      euclid("hat", 8, 16, 0, { velocity: 0.45 }),
    ],
  ),
  drumPattern(
    "dnb",
    "Drum & bass two-step",
    ["drum and bass", "jungle"],
    [168, 178, 174],
    "syn909",
    0,
    [
      grid("kick", "x.........x....."),
      grid("snare", "....x.......x..."),
      euclid("hat", 8, 16, 1, { velocity: 0.45 }),
      grid("openhat", "..............x.", { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "halftime",
    "Halftime",
    ["halftime", "drum and bass", "dubstep"],
    [140, 175, 170],
    "syn909",
    0,
    [
      grid("kick", "x.........x.....x......x.x......"),
      grid("snare", "........x.......", { velocity: 0.95 }),
      euclid("hat", 8, 16, 0, { velocity: 0.4, probability: 0.85, seed: 3 }),
    ],
  ),
  drumPattern(
    "boom-bap",
    "Boom bap",
    ["hip hop", "boom bap"],
    [84, 96, 90],
    "lofi",
    0.12,
    [
      grid("kick", "x......x..x.....x.x....x..x....."),
      grid("snare", "....x.......x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.5, accent: 0.4, accents: 4 }),
    ],
  ),
  drumPattern(
    "lofi",
    "Lo-fi hip hop",
    ["hip hop", "lo-fi", "chill"],
    [70, 90, 80],
    "lofi",
    0.18,
    [
      grid("kick", "x.........x.....x......x..x....."),
      grid("snare", "....x.......x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.4, probability: 0.9, seed: 11 }),
      grid("rim", "...............x", { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "trap",
    "Trap with hat rolls",
    ["trap", "hip hop"],
    [130, 160, 140],
    "trap",
    0,
    [
      grid("kick", "x......x..x.....x.x....x......x."),
      grid("snare", "........x......."),
      grid("hat", "x.x.x.x.x.x.x.x.x.x.x.x.x.xxxxxx", {
        division: "1/32",
        velocity: 0.45,
      }),
      grid("openhat", "..............x.", { velocity: 0.35 }),
    ],
  ),
  drumPattern("drill", "Drill", ["drill", "trap"], [138, 146, 142], "trap", 0, [
    grid("kick", "x.....x.........x..x......x....."),
    grid("snare", "........x..........x....x......."),
    grid("hat", "x..x..x.x..x..x.", { velocity: 0.45 }),
  ]),
  drumPattern(
    "reggaeton",
    "Reggaeton / dembow",
    ["reggaeton", "dembow", "latin"],
    [88, 100, 95],
    "syn808",
    0,
    [
      euclid("kick", 4, 16),
      grid("snare", "...x..x....x..x."),
      euclid("hat", 8, 16, 0, { velocity: 0.45 }),
    ],
  ),
  drumPattern(
    "dancehall",
    "Dancehall",
    ["dancehall", "caribbean"],
    [90, 110, 100],
    "syn808",
    0,
    [
      euclid("kick", 3, 8),
      grid("snare", "....x.......x..."),
      euclid("rim", 5, 16, 2, { velocity: 0.5 }),
      euclid("hat", 8, 16, 0, { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "one-drop",
    "Reggae one drop",
    ["reggae", "dub"],
    [66, 80, 74],
    "acoustic",
    0.1,
    [
      grid("kick", "........x......."),
      grid("rim", "........x......."),
      euclid("hat", 8, 16, 0, { velocity: 0.45, accent: 0.4, accents: 2 }),
    ],
  ),
  drumPattern(
    "afrobeat",
    "Afrobeat",
    ["afrobeat", "african", "funk"],
    [100, 120, 110],
    "acoustic",
    0.05,
    [
      grid("kick", "x.....x...x.....x.....x...x..x.."),
      grid("snare", "....x..x....x..x", { velocity: 0.6 }),
      euclid("openhat", 4, 16, 2, { velocity: 0.45 }),
      euclid("hat", 12, 16, 0, { velocity: 0.4 }),
      grid("rim", "x.x.xx.x.x.x....", { velocity: 0.5 }),
    ],
  ),
  drumPattern(
    "afrobeats",
    "Afrobeats / afro-pop",
    ["afrobeats", "afro-pop", "african"],
    [100, 115, 106],
    "syn808",
    0.06,
    [
      euclid("kick", 4, 16),
      grid("rim", "...x..x...x..x..", { velocity: 0.6 }),
      euclid("hat", 8, 16, 0, { velocity: 0.4 }),
      grid("clap", "............x...", { velocity: 0.6 }),
    ],
  ),
  drumPattern(
    "bembe",
    "Bembé 12/8 bell",
    ["afro-cuban", "african", "euclidean"],
    [100, 130, 112],
    "acoustic",
    0,
    [
      euclid("kick", 4, 12, 0, { division: "1/8t" }),
      euclid("rim", 7, 12, 9, { division: "1/8t", velocity: 0.6 }),
      euclid("hat", 12, 12, 0, {
        division: "1/8t",
        velocity: 0.35,
        accent: 0.4,
        accents: 4,
      }),
    ],
  ),
  drumPattern(
    "tresillo",
    "Tresillo",
    ["latin", "euclidean", "habanera"],
    [90, 120, 100],
    "syn808",
    0,
    [
      euclid("kick", 3, 8),
      grid("snare", "....x.......x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "son-clave",
    "Son clave groove",
    ["afro-cuban", "salsa", "latin"],
    [90, 120, 100],
    "acoustic",
    0,
    [
      grid("rim", "x..x..x...x.x...", { velocity: 0.65 }),
      grid("kick", "...x.......x....", { velocity: 0.7 }),
      euclid("hat", 8, 16, 0, { velocity: 0.35 }),
    ],
  ),
  drumPattern(
    "bossa-nova",
    "Bossa nova",
    ["bossa nova", "brazilian", "latin"],
    [120, 145, 132],
    "acoustic",
    0,
    [
      grid("kick", "x..xx..xx..xx..x", { velocity: 0.6 }),
      grid("rim", "x..x..x...x..x..", { velocity: 0.55 }),
      euclid("hat", 16, 16, 0, { velocity: 0.3, accent: 0.4, accents: 4 }),
    ],
  ),
  drumPattern(
    "samba",
    "Samba",
    ["samba", "brazilian", "latin"],
    [92, 110, 100],
    "acoustic",
    0.04,
    [
      grid("kick", "x..xX..xx..xX..x", { velocity: 0.6, accent: 0.5 }),
      grid("rim", "x.x..x.x.x.x..x.", { velocity: 0.5 }),
      euclid("hat", 16, 16, 0, { velocity: 0.35, accent: 0.5, accents: 4 }),
    ],
  ),
  drumPattern(
    "cumbia",
    "Cumbia",
    ["cumbia", "latin"],
    [85, 105, 95],
    "acoustic",
    0,
    [
      grid("kick", "x.......x......."),
      grid("rim", "....x.......x...", { velocity: 0.6 }),
      euclid("hat", 12, 16, 0, { velocity: 0.35, accent: 0.5, accents: 4 }),
      euclid("openhat", 4, 16, 2, { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "garage",
    "UK garage 2-step",
    ["uk garage", "2-step", "dance"],
    [128, 136, 132],
    "syn909",
    0.15,
    [
      grid("kick", "x.........x..x..x.......x.x....."),
      grid("snare", "....x.......x..."),
      euclid("hat", 12, 16, 0, { velocity: 0.4 }),
      euclid("openhat", 4, 16, 2, { velocity: 0.35 }),
    ],
  ),
  drumPattern(
    "jersey-club",
    "Jersey club",
    ["jersey club", "club"],
    [135, 145, 140],
    "syn808",
    0,
    [
      grid("kick", "x...x...x..x.x..x...x...x.x.x.x."),
      grid("clap", "....x.......x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.4 }),
    ],
  ),
  drumPattern(
    "footwork",
    "Footwork / juke",
    ["footwork", "juke", "chicago"],
    [155, 165, 160],
    "syn808",
    0,
    [
      grid("kick", "x..x..x...x..x..x..x..x...x.x.x."),
      grid("clap", "............x..."),
      euclid("hat", 6, 16, 2, { velocity: 0.45 }),
      euclid("tom", 3, 16, 8, { velocity: 0.5 }),
    ],
  ),
  drumPattern(
    "rock",
    "Rock basic",
    ["rock", "pop"],
    [100, 140, 120],
    "acoustic",
    0,
    [
      grid("kick", "x.......x.x....."),
      grid("snare", "....x.......x..."),
      euclid("hat", 8, 16, 0, { velocity: 0.55, accent: 0.3, accents: 4 }),
    ],
  ),
  drumPattern(
    "funk",
    "Funk with ghost notes",
    ["funk", "soul"],
    [95, 110, 102],
    "acoustic",
    0.08,
    [
      grid("kick", "x.x.......x..x.."),
      grid("snare", ".x..X..x.x..X..x", { velocity: 0.4, accent: 0.9 }),
      euclid("hat", 16, 16, 0, { velocity: 0.35, accent: 0.4, accents: 4 }),
    ],
  ),
  drumPattern(
    "shuffle",
    "Shuffle",
    ["blues", "shuffle", "rock"],
    [90, 130, 110],
    "acoustic",
    0.33,
    [
      grid("kick", "x.......x......."),
      grid("snare", "....x.......x..."),
      euclid("hat", 16, 16, 0, { velocity: 0.35, accent: 0.5, accents: 8 }),
    ],
  ),
  drumPattern(
    "euclid-poly",
    "Euclidean polymeter",
    ["euclidean", "experimental", "polymeter"],
    [110, 130, 120],
    "electro",
    0,
    [
      euclid("kick", 5, 16),
      euclid("snare", 3, 8, 2, { velocity: 0.7 }),
      euclid("hat", 7, 12, 0, { velocity: 0.45, accent: 0.5, accents: 3 }),
      euclid("rim", 4, 10, 1, { velocity: 0.5, probability: 0.8, seed: 21 }),
    ],
  ),
]);

/** The pattern named `name` (case-insensitive), if any. */
export function findPattern(name: string): DrumPattern | undefined {
  const key = String(name)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return DRUM_PATTERNS.find((entry) => entry.name === key);
}

/**
 * A library pattern's rows, for a kit track's `rhythm`:
 *
 * ```ts
 * track({ name: "drums", instrument: "kit", kit: "lofi", rhythm: pattern("boom-bap") })
 * ```
 *
 * Spread it to change or add rows: `[...pattern("house"), euclid("rim", 5, 16)]`.
 * Rows with the same voice must not repeat, so drop the original first.
 */
export function pattern(name: string): readonly RhythmSpec[] {
  const found = findPattern(name);
  if (!found)
    throw new DawgSdkError(
      `unknown drum pattern "${String(name).slice(0, 40)}" (${DRUM_PATTERNS.map((entry) => entry.name).join(" ")})`,
    );
  return found.rows;
}

// ---------------------------------------------------------------------------
// Sampler

/** One sample voice. A bare string is `{ src }`. */
export type SampleSpec = Readonly<{
  /**
   * Audio file: track-relative (`samples/kick.wav`) or project-relative
   * (`tracks/x/samples/kick.wav`), or a pack sound
   * `pack:<pack>/<sound>[:<n>]` such as `pack:tidal-drum-machines/RolandTR909_bd:0`
   * (fetched once into the cache; see `/pack`).
   */
  src: string;
  /** Pack sounds: content hash dawg pinned when the sound was first used. */
  sha256?: string;
  /** Pack sounds: the pinned HTTPS file. */
  url?: string;
  /** Pack sounds: the pack's license, recorded for credits. */
  license?: string;
  /** Pitch the file plays at, keyed mode only; default C4. */
  root?: Pitch;
  /** Start fraction 0..1 of the file, like Strudel `begin`. */
  begin?: number;
  /** End fraction 0..1 of the file, like Strudel `end`. */
  end?: number;
  /** Linear gain 0..2. */
  gain?: number;
  /** Playback rate, like Strudel `speed`; negative reverses. */
  speed?: number;
  /** Sustain by looping `begin..end`. */
  loop?: boolean;
  /** Choke group, like Strudel `cut`: a new hit stops the previous one in the group. */
  choke?: string;
  /** Looped part, like Strudel `loopBegin`/`loopb` (fraction, ≥ begin). */
  loopBegin?: number;
  /** Alias of `loopBegin` (Strudel `loopb`). */
  loopb?: number;
  /** Looped part end, like Strudel `loopEnd`/`loope` (fraction, ≤ end). */
  loopEnd?: number;
  /** Alias of `loopEnd` (Strudel `loope`). */
  loope?: number;
  /** Like Strudel `clip`: the voice lasts note length × clip (0 < clip ≤ 16), cutting the sample. */
  clip?: number;
  /** Alias of `clip` (Strudel `legato`). */
  legato?: number;
  /** Like Tidal `unit`: `"r"` rate (default), `"c"` speed in cycles (bars), `"s"` speed in seconds. */
  unit?: "r" | "c" | "s";
  /** Like Strudel `fit`: the window lasts exactly the note's length. */
  fit?: boolean;
  /** Like Strudel `loopAt(n)`: the window lasts n bars (stored as `speed: 1/n, unit: "c"`). */
  loopAt?: number;
  /** Like Tidal `accelerate`: rate ramps by this × the start rate over the voice (−8..8). */
  accelerate?: number;
  /** Like Tidal `squiz`: pitch-raise ratio per zero-crossing cycle (1..32). */
  squiz?: number;
  /** The file's own tempo (20..400, SDK 1.20.0): the window follows the song's tempo map. */
  bpm?: number;
  /** How a fitted window changes time (SDK 1.20.0): `"repitch"` (tape), `"beats"` (onset slices), `"tones"` (keeps pitch). */
  fitmode?: "repitch" | "beats" | "tones";
  /** Window length in beats (SDK 1.20.0); `fit` wins over `bpm`, `bpm` over `len`. */
  len?: number;
}>;

/** Result of `sampler()`; pass it as a track's `instrument`. */
export type SamplerSpec = Readonly<{
  kind: "sampler";
  voices: Readonly<Record<string, SampleSpec>>;
  /** `oneshot` (default): voices are hits. `keyed`: voices are resampled across the keyboard from `root`. */
  mode: "oneshot" | "keyed";
}>;

/** Options for `sampler()`. */
export type SamplerOptions = Readonly<{ mode?: "oneshot" | "keyed" }>;

/**
 * A sample instrument. Voice names are `[A-Za-z][A-Za-z0-9_]*`, at most 64.
 *
 * ```ts
 * instrument: sampler({ kick: "samples/kick.wav", snare: "samples/sd.wav" })
 * instrument: sampler({ vox: { src: "samples/vox.wav", root: "C4" } }, { mode: "keyed" })
 * ```
 *
 * One-shot voices are played with `hit("kick", 0)`; keyed voices with `note()`.
 */
export function sampler(
  voices: Readonly<Record<string, string | SampleSpec>>,
  options: SamplerOptions = {},
): SamplerSpec {
  if (!isRecord(voices)) throw new DawgSdkError("sampler needs a voice map");
  const names = Object.keys(voices);
  if (names.length === 0 || names.length > 64)
    throw new DawgSdkError("sampler needs 1..64 voices");
  const mode = options.mode ?? "oneshot";
  if (mode !== "oneshot" && mode !== "keyed")
    throw new DawgSdkError('sampler mode must be "oneshot" or "keyed"');
  const out: Record<string, SampleSpec> = {};
  for (const name of names.sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.length > 32)
      throw new DawgSdkError(
        `sampler voice "${name}" must be a short identifier`,
      );
    out[name] = sampleSpec(voices[name]!, name);
  }
  return Object.freeze({ kind: "sampler", voices: Object.freeze(out), mode });
}

/** Instrument name that selects a track's wavetable oscillator. */
export const WAVETABLE_INSTRUMENT = "wavetable";

/** Strudel's `warpmode` names. */
export type WarpMode =
  "none" | "asym" | "bendp" | "bendm" | "bendmp" | "sync" | "quant";

/** Wavetable parameters, with Strudel's names. Omitted means default. */
export type WavetableParams = Readonly<{
  /** Position 0..1 (default 0). */
  wt?: number;
  /** Position envelope amount -1..1 and its ADSR (seconds, sustain 0..1). */
  wtenv?: number;
  wtattack?: number;
  wtdecay?: number;
  wtsustain?: number;
  wtrelease?: number;
  /** Position LFO rate (Hz) and depth 0..1. */
  wtrate?: number;
  wtdepth?: number;
  /** Phase warp amount 0..1 and mode. */
  warp?: number;
  warpmode?: WarpMode;
  /** Start phase randomness 0..1 (seeded per note). */
  wtphaserand?: number;
}>;

/** Result of `wavetable()`; pass it as a track's `instrument`. */
export type WavetableSpec = Readonly<
  { kind: "wavetable"; table: SampleSpec } & WavetableParams
>;

const WAVETABLE_KEYS = Object.freeze([
  "wt",
  "wtenv",
  "wtattack",
  "wtdecay",
  "wtsustain",
  "wtrelease",
  "wtrate",
  "wtdepth",
  "warp",
  "wtphaserand",
] as const);

/**
 * A wavetable instrument. `table` is a built-in (`basic`, `pwm`,
 * `formant`, `harmonics`), a Strudel `wt_` sound (`wt_digital:2` plays
 * `pack:uzu-wavetables/wt_digital:2`), any `pack:` ref, a project WAV
 * (`./wavetables/vox.wav`, relative to the track's directory, as the agent's
 * make_wavetable writes it), or a pinned `{ src, sha256, url }` that dawg
 * writes back after resolving it.
 *
 * ```ts
 * instrument: wavetable("basic", { wt: 0.4 })
 * instrument: wavetable("./wavetables/vox.wav", { wtenv: 0.5 })
 * instrument: wavetable("wt_vgame:3", { wtenv: 0.6, wtdecay: 0.4, warp: 0.3, warpmode: "bendp" })
 * ```
 */
export function wavetable(
  table: string | SampleSpec,
  params: WavetableParams = {},
): WavetableSpec {
  if (!isRecord(params))
    throw new DawgSdkError("wavetable params must be an object");
  const spec = typeof table === "string" ? { src: table } : table;
  if (!isRecord(spec) || typeof spec.src !== "string" || spec.src.length === 0)
    throw new DawgSdkError("wavetable needs a table name");
  let src = spec.src.trim();
  if (/\.wav$/i.test(src) && !src.startsWith("pack:")) {
    // A project table (make_wavetable writes tracks/<slug>/wavetables/x.wav);
    // `./wavetables/x.wav` is relative to the track's directory.
    if (
      src.includes("..") ||
      src.includes(":") ||
      src.startsWith("/") ||
      src.includes("\\")
    )
      throw new DawgSdkError(
        `wavetable file "${src.slice(0, 60)}" must be a project-relative path without ".."`,
      );
  } else if (!src.includes(":") || /^wt_[A-Za-z0-9_]+:[0-9]+$/.test(src))
    src = src.startsWith("wt_")
      ? `pack:uzu-wavetables/${src}`
      : `builtin:${src.toLowerCase()}`;
  else if (!/^(?:pack|builtin):/.test(src))
    throw new DawgSdkError(
      `wavetable table "${src.slice(0, 40)}" must be a built-in, wt_<set>:<n>, pack:<pack>/<sound> or a .wav file`,
    );
  const out: Record<string, unknown> = {
    kind: "wavetable",
    table: Object.freeze(
      src.startsWith("builtin:") ? { src } : { ...spec, src },
    ),
  };
  for (const key of Object.keys(params)) {
    const value = (params as Record<string, unknown>)[key];
    if (key === "warpmode") {
      if (typeof value !== "string")
        throw new DawgSdkError("wavetable warpmode must be a string");
      out.warpmode = value;
    } else if ((WAVETABLE_KEYS as readonly string[]).includes(key))
      out[key] = finite(value, `wavetable ${key}`);
    else
      throw new DawgSdkError(
        `wavetable has no parameter "${key}" (${WAVETABLE_KEYS.join(" ")} warpmode)`,
      );
  }
  return Object.freeze(out) as WavetableSpec;
}

/** Instrument name of the 0.6 string engine (`Track.string`). */
export const STRING_INSTRUMENT = "string";

/**
 * String engine settings (SDK 1.20.0): a `preset` (`nylon`, `steel`,
 * `electric`, `jangle`, `ebass`, `slap`, `upright`, `sitar`, `tanpura`,
 * `harpsichord`, `lute`, `oud`, `setar`, `tar`, `santur`, `dulcimer`, `koto`,
 * `harp`, `banjo`, `tres`, `requinto`) plus any parameter to override
 * (`ring`, `bright`, `damp`, `pos`, `mute`, `buzz`, `body`, `sym`, ...).
 * dawg validates names and ranges; see **Strings** in DAWG.md.
 */
export type StringInput = Readonly<
  { preset?: string } & Record<string, number | string | undefined>
>;

/** Result of `stringed()`; pass it as a track's `instrument`. */
export type StringSpec = Readonly<{ kind: "string" } & StringInput>;

/**
 * A plucked string instrument (SDK 1.20.0): a preset and overrides.
 *
 * instrument: stringed("nylon")
 * instrument: stringed("sitar", { buzz: 0.8, sym: 0.5 })
 */
export function stringed(
  preset = "nylon",
  params: Readonly<Record<string, number | string>> = {},
): StringSpec {
  if (typeof preset !== "string" || preset.length === 0)
    throw new DawgSdkError("stringed needs a preset name");
  if (!isRecord(params))
    throw new DawgSdkError("stringed params must be an object");
  const out: Record<string, number | string> = { kind: "string", preset };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || key === "kind" || key === "preset") continue;
    out[key] =
      typeof value === "string" ? value : finite(value, `string ${key}`);
  }
  return Object.freeze(out) as StringSpec;
}

/**
 * `count` equal slices of one file as voices `prefix0 … prefixN-1`, for
 * chopped breaks: `sampler(slices("samples/break.wav", 8, "brk"))`, then
 * `hit("brk3", 1.5)`.
 */
export function slices(
  src: string | SampleSpec,
  count: number,
  prefix = "slice",
): Record<string, SampleSpec> {
  if (!Number.isInteger(count) || count < 1 || count > 64)
    throw new DawgSdkError("slices count must be an integer 1..64");
  const base = sampleSpec(src, prefix);
  const begin = base.begin ?? 0;
  const end = base.end ?? 1;
  const span = (end - begin) / count;
  const voices: Record<string, SampleSpec> = {};
  for (let index = 0; index < count; index += 1) {
    voices[`${prefix}${index}`] = Object.freeze({
      ...base,
      begin: round(begin + index * span),
      end: round(index === count - 1 ? end : begin + (index + 1) * span),
    });
  }
  return voices;
}

function sampleSpec(value: string | SampleSpec, name: string): SampleSpec {
  const spec = typeof value === "string" ? { src: value } : value;
  if (!isRecord(spec) || typeof spec.src !== "string" || spec.src.length === 0)
    throw new DawgSdkError(`sampler voice ${name} needs a src path`);
  const out: {
    src: string;
    sha256?: string;
    url?: string;
    license?: string;
    root?: number;
    begin?: number;
    end?: number;
    gain?: number;
    speed?: number;
    loop?: boolean;
    choke?: string;
    loopBegin?: number;
    loopEnd?: number;
    clip?: number;
    unit?: "r" | "c" | "s";
    fit?: boolean;
    accelerate?: number;
    squiz?: number;
    bpm?: number;
    fitmode?: "repitch" | "beats" | "tones";
    len?: number;
  } = { src: spec.src };
  if (spec.src.startsWith("pack:")) {
    if (spec.sha256 !== undefined)
      out.sha256 = text(spec.sha256, `${name} sha256`);
    if (spec.url !== undefined) out.url = text(spec.url, `${name} url`);
    if (spec.license !== undefined)
      out.license = text(spec.license, `${name} license`);
  }
  if (spec.root !== undefined) out.root = midi(spec.root);
  if (spec.begin !== undefined) out.begin = unit(spec.begin, `${name} begin`);
  if (spec.end !== undefined) out.end = unit(spec.end, `${name} end`);
  if (spec.gain !== undefined) out.gain = finite(spec.gain, `${name} gain`);
  if (spec.speed !== undefined) out.speed = finite(spec.speed, `${name} speed`);
  if (spec.loop !== undefined) {
    if (typeof spec.loop !== "boolean")
      throw new DawgSdkError(`${name} loop must be boolean`);
    out.loop = spec.loop;
  }
  if (spec.choke !== undefined) {
    if (typeof spec.choke !== "string")
      throw new DawgSdkError(`${name} choke must be a group name`);
    out.choke = spec.choke;
  }
  const loopBegin = spec.loopBegin ?? spec.loopb;
  if (loopBegin !== undefined)
    out.loopBegin = unit(loopBegin, `${name} loopBegin`);
  const loopEnd = spec.loopEnd ?? spec.loope;
  if (loopEnd !== undefined) out.loopEnd = unit(loopEnd, `${name} loopEnd`);
  const clip = spec.clip ?? spec.legato;
  if (clip !== undefined) out.clip = finite(clip, `${name} clip`);
  if (spec.unit !== undefined) {
    if (spec.unit !== "r" && spec.unit !== "c" && spec.unit !== "s")
      throw new DawgSdkError(`${name} unit must be "r", "c" or "s"`);
    out.unit = spec.unit;
  }
  if (spec.loopAt !== undefined) {
    const bars = finite(spec.loopAt, `${name} loopAt`);
    if (bars <= 0) throw new DawgSdkError(`${name} loopAt must be positive`);
    out.speed = (out.speed ?? 1) / bars;
    out.unit = "c";
  }
  if (spec.fit !== undefined) {
    if (typeof spec.fit !== "boolean")
      throw new DawgSdkError(`${name} fit must be boolean`);
    out.fit = spec.fit;
  }
  if (spec.accelerate !== undefined)
    out.accelerate = finite(spec.accelerate, `${name} accelerate`);
  if (spec.squiz !== undefined) out.squiz = finite(spec.squiz, `${name} squiz`);
  if (spec.bpm !== undefined) out.bpm = finite(spec.bpm, `${name} bpm`);
  if (spec.fitmode !== undefined) {
    if (
      spec.fitmode !== "repitch" &&
      spec.fitmode !== "beats" &&
      spec.fitmode !== "tones"
    )
      throw new DawgSdkError(
        `${name} fitmode must be "repitch", "beats" or "tones"`,
      );
    out.fitmode = spec.fitmode;
  }
  if (spec.len !== undefined) out.len = finite(spec.len, `${name} len`);
  return Object.freeze(out);
}

/**
 * One sample file with options (SDK 1.20.0), for `sampler({ brk: ... })`:
 * `sample("samples/break.wav", { bpm: 174, fitmode: "beats" })` plays a
 * 174 BPM break in time with the song, cut at its hits.
 */
export function sample(
  src: string,
  options: Omit<SampleSpec, "src"> = {},
): SampleSpec {
  if (typeof src !== "string" || src.length === 0)
    throw new DawgSdkError("sample() needs a src path");
  return Object.freeze({ ...options, src });
}

// ---------------------------------------------------------------------------
// Tracks

/** `[beat, value]` control point for `automation`. */
export type Point = readonly [beat: number, value: number];

/** Automation lanes in beats. Each lane replaces the stored lane entirely. */
export type AutomationInput = Readonly<{
  /** 0..1 */
  volume?: readonly Point[];
  /** -1..1 */
  pan?: readonly Point[];
  /** Filter cutoff in Hz, 20..20000 (needs `filter`). */
  filter?: readonly Point[];
  /** 0..1 (needs `filter`). */
  resonance?: readonly Point[];
  /** 0..0.9 (needs `delay`). */
  delayFeedback?: readonly Point[];
  /** 0..1 (needs `delay`). */
  delayMix?: readonly Point[];
  /**
   * Effect parameter lanes keyed `<effect>-<param>`, e.g.
   * `"autofilter-cutoff"`, `"distort-drive"`, `"reverb-mix"` (needs the effect).
   */
  fx?: Readonly<Record<string, readonly Point[]>>;
  /** Wavetable position 0..1 (needs `wavetable()`). */
  wt?: readonly Point[];
}>;

/** One effect's parameters; omitted ones take dawg's defaults. */
export type EffectParams = Readonly<Record<string, number | string | boolean>>;

/**
 * Insert effects by name, rendered in the fixed chain order
 * filter → djf → autofilter → vowel → crush → distort → tremolo →
 * compressor → pan → phaser → chorus → leslie → postgain → delay → reverb.
 * Keys here: djf, autofilter, vowel, crush, distort, tremolo, compressor,
 * phaser, chorus, leslie, postgain, plus the mix-bus keys `orbit`
 * (`{ orbit: 2 }`, SDK 1.9.0) and `duck` (`{ orbit: 2, depth: 0.85 }`:
 * this track's onsets duck every other track on that orbit). See
 * docs/project-format.md for every parameter, its range and its Strudel name.
 */
export type FxInput = Readonly<Record<string, EffectParams>>;

/**
 * Synth voice parameters by Strudel name; only the ones given are stored
 * and the rest take dawg's defaults. Lanes go under `automation.fx` as
 * `"synth-<param>"` (e.g. `"synth-lpf"`), read at each note's onset.
 * Every parameter, range and default: **Synth** in DAWG.md.
 */
export type SynthInput = Readonly<{
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  gain?: number;
  /** Pink noise mixed into the oscillator, 0..1. */
  noise?: number;
  /** Crackle impulse density. */
  density?: number;
  /** Unison voices (supersaw defaults to 5). */
  unison?: number;
  /** Unison detune spread in semitones. */
  detune?: number;
  /** Stereo spread of the unison voices, 0..1. */
  spread?: number;
  /** Pulse width 0..1 (`pulse`). */
  pw?: number;
  pwrate?: number;
  pwsweep?: number;
  /** Vibrato rate (Hz) and depth (semitones). */
  vib?: number;
  vibmod?: number;
  /** Pitch envelope depth (semitones) and shape. */
  penv?: number;
  pattack?: number;
  pdecay?: number;
  psustain?: number;
  prelease?: number;
  pcurve?: number;
  panchor?: number;
  lpf?: number;
  lpq?: number;
  lpenv?: number;
  hpf?: number;
  hpq?: number;
  hpenv?: number;
  bpf?: number;
  bpq?: number;
  bpenv?: number;
  /** `12db`, `24db` or `ladder`. */
  ftype?: string;
  /** FM index and harmonicity ratio; `fm2`…`fm8` add operators. */
  fm?: number;
  fmh?: number;
  fmattack?: number;
  fmdecay?: number;
  fmsustain?: number;
  fmrelease?: number;
  /** `lin` or `exp`. */
  fmenv?: string;
  /** `sine`, `sawtooth`, `square` or `triangle`. */
  fmwave?: string;
  /** Harmonic amplitudes for `user` (or any basic waveform). */
  partials?: readonly number[];
  phases?: readonly number[];
  /** ZzFX controls for `z_*` sounds (units: DAWG.md "Synth"). */
  zrand?: number;
  curve?: number;
  slide?: number;
  deltaSlide?: number;
  pitchJump?: number;
  pitchJumpTime?: number;
  lfo?: number;
  zmod?: number;
  zcrush?: number;
  zdelay?: number;
  tremolo?: number;
  /** Any other Strudel synth parameter, e.g. `lpattack`, `fmh3`. */
  [param: string]: number | string | boolean | readonly number[] | undefined;
}>;

/** Input to `track()`. Omitted fields keep dawg's defaults. */
export type TrackInput = Readonly<{
  /** Stable id dawg assigned; defaults to the slug of `name`. Keep it when editing. */
  id?: string;
  /** Shown in the header; its slug names `tracks/<slug>/`. */
  name: string;
  /**
   * Synth voice (`sine`, `piano`, `pluck`, `bass`, `saw`, `square`,
   * `triangle`, and Strudel's `sawtooth`, `supersaw`, `pulse`, `user`,
   * `white`, `pink`, `brown`, `crackle`, and the ZzFX sounds `z_sine`,
   * `z_triangle`, `z_sawtooth`, `z_square`, `z_tan`, `z_noise`), `kit` for drums,
   * `sampler(...)` or `wavetable(...)`. Default `sine`.
   */
  instrument?: string | SamplerSpec | WavetableSpec | StringSpec;
  /**
   * Synthesized drum kit for an `instrument: "kit"` track: `syn808`,
   * `syn909`, `acoustic`, `lofi`, `electro` or `trap`. Omit for the default
   * voices.
   */
  kit?: string;
  /**
   * The track's own clock against the song (SDK 1.14.0): `rate` 1.5 plays
   * three beats in two, `phase` starts it that many beats later, `cycle`
   * repeats its first `cycle` beats (a 3-beat cycle over 4/4 is polymeter).
   * `{ cycle: 3, rate: 13 / 12 }` drifts against a twin and realigns, the
   * tape phasing of Reich's Come Out; `phasing()` works the rate out for
   * you, and `stepPhasing()` gives Piano Phase's shift and hold.
   */
  time?: TrackTimeInput;
  /**
   * This track's tuning over the song's (SDK 1.16.0): a library name such
   * as `"pelog"` or `{ edo, ratios, cents, scl, kbm, ref, root, map }`.
   * `{ ref: 432 }` alone keeps the song's table at another pitch.
   */
  tuning?: TuningInput | null;
  /** Synth voice parameters, Strudel names (`{ attack: 0.01, lpf: 800 }`). */
  synth?: SynthInput;
  /**
   * String engine (SDK 1.20.0) for an `instrument: "string"` track, or use
   * `instrument: stringed("sitar", {...})` or a preset word (`"nylon"`).
   */
  string?: StringInput | null;
  muted?: boolean;
  /** When any track is soloed only soloed tracks play. */
  solo?: boolean;
  /** 0..1, default 1. */
  volume?: number;
  /** -1 (left) .. 1 (right), default 0. */
  pan?: number;
  /** Filter (low-pass unless `type`); `null` or omitted means none. */
  filter?: FilterInput | null;
  /** Tempo-synced delay send in beats. */
  delay?: DelayInput | null;
  /** Stereo reverb send. */
  reverb?: ReverbInput | null;
  /** Insert effects by name (`{ distort: { drive: 3 }, chorus: {} }`). */
  fx?: FxInput;
  automation?: AutomationInput;
  /**
   * Glide between notes (SDK 1.15.0): seconds (`glide: 0.08`, TB-303 style
   * legato) or `{ time, mode }`. Mode `legato` glides only into a note that
   * overlaps the previous one and does not retrigger it; `mono` always
   * glides and retriggers; `poly` glides every voice of a chord from the
   * matching voice of the previous one.
   */
  glide?: number | Readonly<{ time?: number; mode?: GlideMode }>;
  /** Sustain pedal changes as `[beat, "down" | "half" | "up"]` (SDK 1.15.0). */
  pedal?: readonly (readonly [number, PedalState])[];
  /**
   * Velocity response (SDK 1.15.0): `soft` (quiet notes louder), `hard`
   * (needs a firm touch), `fixed` (every note at 0.8, like an organ) or
   * `{ curve: "fixed", fixed: 0.6 }`. Default `linear`.
   */
  velocityCurve?:
    VelocityCurveName | Readonly<{ curve: VelocityCurveName; fixed?: number }>;
  /**
   * Seeded humanize applied when dawg renders, so the notes stay as written
   * (SDK 1.15.0): `timing` ms either side, `velocity` and `length` in
   * percent, `seed` (default 1) picks another take.
   */
  humanize?: Readonly<{
    timing?: number;
    velocity?: number;
    length?: number;
    seed?: number;
  }>;
  /** `note()`/`seq()` for pitched tracks, `hit()`/`hits()` for kits and one-shot samplers. */
  notes?: readonly (NoteSpec | HitSpec)[];
  /**
   * Generated voices, one row per voice: `euclid()`/`grid()`. dawg expands
   * them into hits when the song loads; a row owns its voice, so `notes`
   * on the same voice are replaced.
   */
  rhythm?: readonly RhythmSpec[];
}>;

export type FilterInput = Readonly<{
  cutoff: number;
  resonance?: number;
  /** `lpf` (default), `hpf` or `bpf`. */
  type?: "lpf" | "hpf" | "bpf";
  /** Slope: `12db` (default), `24db` or `ladder`. */
  ftype?: "12db" | "24db" | "ladder";
}>;

export type DelayInput = Readonly<{
  beats: number;
  feedback?: number;
  mix?: number;
  /** Seconds; overrides `beats` when set (Strudel `delaytime`). */
  time?: number;
  /** Repeats alternate left/right. */
  pingpong?: boolean;
  /** Low-pass on the repeats, Hz. */
  highcut?: number;
}>;

export type ReverbInput = Readonly<{
  mix: number;
  size?: number;
  /** Decay to -60 dB in seconds (Strudel `roomfade`). */
  fade?: number;
  /** Low-pass on the input, Hz (Strudel `roomlp`). */
  lowpass?: number;
  /** Damping toward this Hz as the tail decays (Strudel `roomdim`). */
  dim?: number;
  /** Seconds before the tail. */
  predelay?: number;
  /**
   * Convolution reverb (Strudel `iresponse`/`ir`): `"room"`, `"hall"`,
   * `"plate"` (generated), a pack sound `pack:<pack>/<sound>[:<n>]` or a
   * track-relative audio file. `size`, `fade` and `dim` then do nothing.
   */
  ir?:
    | string
    | Readonly<{
        src: string;
        sha256?: string;
        url?: string;
        license?: string;
      }>;
}>;

/** `track({ time })`: every field optional; absent follows the song. */
export type TrackTimeInput = Readonly<{
  /** Tempo ratio against the song, 0.125..8 (1 = in step). */
  rate?: number;
  /** Beats the track's pattern starts late (negative: early); it wraps. */
  phase?: number;
  /** Beats of the track that repeat, default the whole song loop. */
  cycle?: number;
  /**
   * Stepped phasing (SDK 1.19.0), as in Reich's Piano Phase: hold `hold`
   * cycles in step, then move `shift` beats ahead over `drift` cycles, and
   * repeat. Needs `cycle`; replaces `rate`. `stepPhasing()` builds it.
   */
  steps?: Readonly<{ shift: number; hold: number; drift: number }>;
}>;

/** Frozen track built by `track()`; `song()` consumes it. Beats, not ticks. */
export type TrackSpec = Readonly<{
  kind: "track";
  id: string;
  name: string;
  slug: string;
  instrument: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  filter: Readonly<
    { cutoff: number; resonance: number } & Partial<FilterInput>
  > | null;
  delay: Readonly<
    { beats: number; feedback: number; mix: number } & Partial<DelayInput>
  > | null;
  reverb: Readonly<{ mix: number; size: number } & Partial<ReverbInput>> | null;
  fx: FxInput | null;
  synth: SynthInput | null;
  sampler: SamplerSpec | null;
  wavetable: WavetableSpec | null;
  /** String engine settings (SDK 1.20.0); present only when set. */
  string?: StringInput;
  automation: Readonly<Required<AutomationInput>>;
  /** Every hit resolved to its pitch slot. */
  notes: readonly NoteSpec[];
  /** Rhythm rows in order (voice names as written). */
  rhythm: readonly RhythmSpec[];
  kit: string | null;
  /** Present only when `track({ time })` set something. */
  time?: TrackTimeInput;
  /** Performance (SDK 1.15.0); present only when set. */
  glide?: Readonly<{ time: number; mode: GlideMode }>;
  pedal?: readonly (readonly [number, PedalState])[];
  velocityCurve?: Readonly<{
    curve: Exclude<VelocityCurveName, "linear">;
    fixed?: number;
  }>;
  humanize?: Readonly<{
    timing?: number;
    velocity?: number;
    length?: number;
    seed: number;
  }>;
  tuning: ScoreTuning | null;
}>;

export type GlideMode = "legato" | "mono" | "poly";
export type PedalState = "down" | "half" | "up";
export type VelocityCurveName = "linear" | "soft" | "hard" | "fixed";

const DEFAULT_GLIDE_SECONDS = 0.06;
const DEFAULT_FIXED_VELOCITY = 0.8;

/** Normalizes `track()` performance options; dawg validates the ranges. */
function trackPerformance(
  input: TrackInput,
  name: string,
): Partial<Pick<TrackSpec, "glide" | "pedal" | "velocityCurve" | "humanize">> {
  const out: {
    glide?: TrackSpec["glide"];
    pedal?: TrackSpec["pedal"];
    velocityCurve?: TrackSpec["velocityCurve"];
    humanize?: TrackSpec["humanize"];
  } = {};
  if (input.glide !== undefined) {
    const raw =
      typeof input.glide === "number" ? { time: input.glide } : input.glide;
    if (!isRecord(raw))
      throw new DawgSdkError(
        `track ${name}: glide must be seconds or { time, mode }`,
      );
    const mode = raw.mode ?? "legato";
    if (!["legato", "mono", "poly"].includes(mode))
      throw new DawgSdkError(
        `track ${name}: glide mode must be legato, mono or poly`,
      );
    out.glide = Object.freeze({
      time: finite(raw.time ?? DEFAULT_GLIDE_SECONDS, `${name} glide time`),
      mode,
    });
  }
  if (input.pedal !== undefined) {
    if (!Array.isArray(input.pedal) || input.pedal.length > 1024)
      throw new DawgSdkError(
        `track ${name}: pedal must be at most 1024 [beat, "down" | "half" | "up"] events`,
      );
    if (input.pedal.length > 0)
      out.pedal = Object.freeze(
        input.pedal.map((event: unknown, index: number) => {
          if (
            !Array.isArray(event) ||
            event.length !== 2 ||
            !["down", "half", "up"].includes(event[1] as string)
          )
            throw new DawgSdkError(
              `track ${name}: pedal[${index}] must be [beat, "down" | "half" | "up"]`,
            );
          return Object.freeze([
            beat(event[0], `${name} pedal[${index}] beat`),
            event[1] as PedalState,
          ] as const);
        }),
      );
  }
  if (input.velocityCurve !== undefined) {
    const raw =
      typeof input.velocityCurve === "string"
        ? { curve: input.velocityCurve }
        : input.velocityCurve;
    if (
      !isRecord(raw) ||
      !["linear", "soft", "hard", "fixed"].includes(raw.curve as string)
    )
      throw new DawgSdkError(
        `track ${name}: velocityCurve must be linear, soft, hard or fixed`,
      );
    if (raw.curve === "fixed")
      out.velocityCurve = Object.freeze({
        curve: "fixed",
        fixed: unit(
          raw.fixed ?? DEFAULT_FIXED_VELOCITY,
          `${name} velocityCurve fixed`,
        ),
      });
    else if (raw.curve !== "linear")
      out.velocityCurve = Object.freeze({ curve: raw.curve });
  }
  if (input.humanize !== undefined) {
    if (!isRecord(input.humanize))
      throw new DawgSdkError(
        `track ${name}: humanize must be { timing, velocity, length, seed }`,
      );
    const amount = (key: "timing" | "velocity" | "length") => {
      const value = input.humanize![key];
      return value === undefined ? 0 : finite(value, `${name} humanize ${key}`);
    };
    const timing = amount("timing");
    const velocity = amount("velocity");
    const length = amount("length");
    const seed = input.humanize.seed ?? 1;
    if (!Number.isInteger(seed) || seed < 0)
      throw new DawgSdkError(
        `track ${name}: humanize seed must be an integer ≥ 0`,
      );
    if (timing !== 0 || velocity !== 0 || length !== 0)
      out.humanize = Object.freeze({
        ...(timing !== 0 ? { timing } : {}),
        ...(velocity !== 0 ? { velocity } : {}),
        ...(length !== 0 ? { length } : {}),
        seed,
      });
  }
  return out;
}

/**
 * A raw ZzFX parameter array (Strudel `zzfx([...])`, ZzFX's own layout:
 * volume, randomness, frequency, attack, sustain, release, shape,
 * shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
 * noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo,
 * filter) as a `z_*` instrument and synth parameters to spread into a
 * track. Empty slots take ZzFX's defaults; frequency and sustain time come
 * from each note. `filter` > 0 is a high-pass in Hz, < 0 a low-pass.
 *
 * ```ts
 * track({ name: "blip", ...zzfx([, , , 0.01, , 0.15, 2, , 5]), notes })
 * ```
 */
export function zzfx(
  values: readonly (number | null | undefined)[],
): Readonly<{ instrument: string; synth: SynthInput }> {
  if (!Array.isArray(values) || values.length > ZZFX_LAYOUT.length)
    throw new DawgSdkError(
      `zzfx takes an array of at most ${ZZFX_LAYOUT.length} numbers`,
    );
  const synth: Record<string, number> = {
    zrand: 0.05,
    attack: 0,
    release: 0.1,
  };
  let instrument = "z_sine";
  ZZFX_LAYOUT.forEach((name, index) => {
    const value: unknown = values[index];
    if (name === null || value === undefined || value === null) return;
    const n = finite(value, `zzfx[${index}]`);
    if (name === "shape")
      instrument = ZZFX_SHAPES[Math.max(0, Math.min(5, Math.round(n)))]!;
    else if (name === "filter") {
      if (n !== 0) synth[n > 0 ? "hpf" : "lpf"] = Math.abs(n);
    } else synth[name] = n;
  });
  return Object.freeze({ instrument, synth: Object.freeze(synth) });
}

const ZZFX_LAYOUT = Object.freeze([
  "gain",
  "zrand",
  null,
  "attack",
  null,
  "release",
  "shape",
  "curve",
  "slide",
  "deltaSlide",
  "pitchJump",
  "pitchJumpTime",
  "lfo",
  "noise",
  "zmod",
  "zcrush",
  "zdelay",
  "sustain",
  "decay",
  "tremolo",
  "filter",
] as const);

const ZZFX_SHAPES = Object.freeze([
  "z_sine",
  "z_triangle",
  "z_sawtooth",
  "z_tan",
  "z_noise",
  "z_square",
] as const);

/**
 * Build a track. Hits are resolved to pitches here: GM numbers on a kit,
 * voice slots (36, 37, … in voice-name order) on a one-shot sampler.
 * Sample paths without a `tracks/` prefix are made project-relative under
 * this track's `tracks/<slug>/`.
 */
export function track(input: TrackInput): TrackSpec {
  if (!isRecord(input)) throw new DawgSdkError("track() needs an object");
  if (typeof input.name !== "string" || input.name.trim().length === 0)
    throw new DawgSdkError("track name must be a non-empty string");
  if (input.name.length > 96)
    throw new DawgSdkError("track name must be at most 96 characters");
  const name = input.name;
  const slug = slugify(name);
  const id = input.id ?? slug;
  if (typeof id !== "string" || id.length === 0 || id.length > 64)
    throw new DawgSdkError(`track ${name}: id must be 1..64 characters`);
  const rawInstrument = input.instrument ?? "sine";
  const samplerSpec =
    isRecord(rawInstrument) && rawInstrument.kind === "sampler"
      ? localizeSampler(rawInstrument as SamplerSpec, slug)
      : null;
  const wavetableSpec =
    isRecord(rawInstrument) && rawInstrument.kind === "wavetable"
      ? localizeWavetable(rawInstrument as WavetableSpec, slug)
      : null;
  const stringFromInstrument =
    isRecord(rawInstrument) && rawInstrument.kind === "string"
      ? stringInput(rawInstrument, name)
      : null;
  const word =
    typeof rawInstrument === "string"
      ? resolveInstrumentWord(rawInstrument)
      : undefined;
  const instrument = samplerSpec
    ? SAMPLER_INSTRUMENT
    : wavetableSpec
      ? WAVETABLE_INSTRUMENT
      : stringFromInstrument
        ? STRING_INSTRUMENT
        : typeof rawInstrument === "string"
          ? (word?.instrument ?? rawInstrument)
          : undefined;
  if (
    instrument === undefined ||
    instrument.length === 0 ||
    instrument.length > 64
  )
    throw new DawgSdkError(
      `track ${name}: instrument must be a voice name, "kit", sampler(...), wavetable(...) or stringed(...)`,
    );
  if (instrument === SAMPLER_INSTRUMENT && !samplerSpec)
    throw new DawgSdkError(
      `track ${name}: use instrument: sampler({...}) for a sampler track`,
    );
  const slots = samplerSpec ? voiceSlots(samplerSpec) : undefined;
  const kit = KIT_INSTRUMENTS.includes(instrument.trim().toLowerCase());
  const notes = (input.notes ?? []).map((item, index) => {
    if (!isRecord(item) || (item.kind !== "note" && item.kind !== "hit"))
      throw new DawgSdkError(
        `track ${name}: notes[${index}] must come from note(), seq(), hit() or hits()`,
      );
    if (item.kind === "note") return item as NoteSpec;
    const spec = item as HitSpec;
    const pitch = kit
      ? DRUM_PITCHES[
          DRUM_ALIASES[spec.voice.trim().toLowerCase()] ??
            (undefined as unknown as DrumVoice)
        ]
      : slots?.get(spec.voice);
    if (pitch === undefined)
      throw new DawgSdkError(
        kit
          ? `track ${name}: unknown drum voice "${spec.voice}" (kick snare clap rim tom hat openhat)`
          : slots
            ? `track ${name}: unknown sampler voice "${spec.voice}" (${[...slots.keys()].join(" ")})`
            : `track ${name}: hit("${spec.voice}") needs instrument "kit" or sampler(...)`,
      );
    const { kind: _kind, voice: _voice, ...rest } = spec;
    return Object.freeze({ ...rest, kind: "note" as const, pitch });
  });
  if (notes.length > 4096)
    throw new DawgSdkError(`track ${name}: at most 4096 notes`);
  const rhythm = input.rhythm ?? [];
  if (!Array.isArray(rhythm) || rhythm.length > 16)
    throw new DawgSdkError(`track ${name}: rhythm must be at most 16 rows`);
  rhythm.forEach((row, index) => {
    if (!isRecord(row) || row.kind !== "rhythm")
      throw new DawgSdkError(
        `track ${name}: rhythm[${index}] must come from euclid() or grid()`,
      );
  });
  const drumKit = input.kit ?? null;
  if (
    drumKit !== null &&
    (typeof drumKit !== "string" || drumKit.trim().length === 0 || !kit)
  )
    throw new DawgSdkError(
      `track ${name}: kit needs instrument "kit" and a kit name`,
    );
  const automation = input.automation ?? {};
  if (!isRecord(automation))
    throw new DawgSdkError(`track ${name}: automation must be an object`);
  const lane = (
    key: Exclude<keyof AutomationInput, "fx">,
  ): readonly Point[] => {
    const points = (automation as Record<string, unknown>)[key];
    if (points === undefined) return Object.freeze([]);
    if (!Array.isArray(points) || points.length > 256)
      throw new DawgSdkError(
        `track ${name}: automation.${key} must be an array of at most 256 [beat, value] points`,
      );
    return Object.freeze(
      points.map((point: unknown, index: number): Point => {
        if (!Array.isArray(point) || point.length !== 2)
          throw new DawgSdkError(
            `track ${name}: automation.${key}[${index}] must be [beat, value]`,
          );
        return Object.freeze([
          beat(point[0], `automation.${key}[${index}] beat`),
          finite(point[1], `automation.${key}[${index}] value`),
        ] as const);
      }),
    );
  };
  for (const key of Object.keys(automation))
    if (!AUTOMATION_KEYS.includes(key as keyof AutomationInput))
      throw new DawgSdkError(
        `track ${name}: unknown automation lane "${key}" (${AUTOMATION_KEYS.join(" ")})`,
      );
  const filter =
    input.filter === undefined || input.filter === null
      ? null
      : Object.freeze({
          cutoff: finite(input.filter.cutoff, `${name} filter.cutoff`),
          resonance: finite(
            input.filter.resonance ?? 0,
            `${name} filter.resonance`,
          ),
          ...extras(input.filter, ["type", "ftype"], `${name} filter`),
        });
  const delay =
    input.delay === undefined || input.delay === null
      ? null
      : Object.freeze({
          beats: finite(input.delay.beats, `${name} delay.beats`),
          feedback: finite(
            input.delay.feedback ?? 0.3,
            `${name} delay.feedback`,
          ),
          mix: finite(input.delay.mix ?? 0.35, `${name} delay.mix`),
          ...extras(
            input.delay,
            ["time", "pingpong", "highcut"],
            `${name} delay`,
          ),
        });
  const reverb =
    input.reverb === undefined || input.reverb === null
      ? null
      : Object.freeze({
          mix: finite(input.reverb.mix, `${name} reverb.mix`),
          size: finite(input.reverb.size ?? 0.5, `${name} reverb.size`),
          ...extras(
            input.reverb,
            ["fade", "lowpass", "dim", "predelay"],
            `${name} reverb`,
          ),
          ...(input.reverb.ir === undefined
            ? {}
            : { ir: reverbIr(input.reverb.ir, name, slug) }),
        });
  const fx = fxInput(input.fx, name);
  const synth = synthInput(input.synth, name);
  // A string preset word (`"nylon"`) turns the engine on with its preset.
  const string =
    stringInput(input.string, name) ??
    stringFromInstrument ??
    (word?.field === "string" && word.preset
      ? Object.freeze({ preset: word.preset })
      : null);
  return Object.freeze({
    kind: "track",
    id,
    name,
    slug,
    instrument,
    muted: bool(input.muted ?? false, `${name} muted`),
    solo: bool(input.solo ?? false, `${name} solo`),
    volume: finite(input.volume ?? 1, `${name} volume`),
    pan: finite(input.pan ?? 0, `${name} pan`),
    filter,
    delay,
    reverb,
    fx,
    synth,
    sampler: samplerSpec,
    wavetable: wavetableSpec,
    ...(string ? { string } : {}),
    automation: Object.freeze({
      volume: lane("volume"),
      pan: lane("pan"),
      filter: lane("filter"),
      resonance: lane("resonance"),
      delayFeedback: lane("delayFeedback"),
      delayMix: lane("delayMix"),
      fx: fxLanes(automation.fx, name),
      wt: lane("wt"),
    }),
    notes: Object.freeze(notes),
    rhythm: Object.freeze([...rhythm]),
    kit: drumKit === null ? null : drumKit.trim(),
    ...trackTime(input.time, name),
    ...trackPerformance(input, name),
    tuning: tuningSpec(input.tuning, `track ${name}`),
  });
}

function trackTime(input: unknown, name: string): { time?: TrackTimeInput } {
  if (input === undefined || input === null) return {};
  if (!isRecord(input))
    throw new DawgSdkError(`track ${name}: time must be an object`);
  for (const key of Object.keys(input))
    if (key !== "rate" && key !== "phase" && key !== "cycle" && key !== "steps")
      throw new DawgSdkError(
        `track ${name}: time takes rate, phase, cycle and steps, not ${key}`,
      );
  const out: {
    rate?: number;
    phase?: number;
    cycle?: number;
    steps?: { shift: number; hold: number; drift: number };
  } = {};
  if (input.rate !== undefined) {
    const rate = finite(input.rate, `track ${name} time.rate`);
    if (rate < 0.125 || rate > 8)
      throw new DawgSdkError(`track ${name}: time.rate must be 0.125..8`);
    if (rate !== 1) out.rate = rate;
  }
  if (input.phase !== undefined) {
    const phase = finite(input.phase, `track ${name} time.phase`);
    if (phase !== 0) out.phase = phase;
  }
  if (input.cycle !== undefined) {
    const cycle = finite(input.cycle, `track ${name} time.cycle`);
    if (cycle <= 0)
      throw new DawgSdkError(`track ${name}: time.cycle must be > 0 beats`);
    out.cycle = cycle;
  }
  if (input.steps !== undefined) {
    if (!isRecord(input.steps))
      throw new DawgSdkError(`track ${name}: time.steps must be an object`);
    if (out.cycle === undefined)
      throw new DawgSdkError(`track ${name}: time.steps needs a cycle`);
    if (out.rate !== undefined)
      throw new DawgSdkError(
        `track ${name}: time takes rate or steps, not both`,
      );
    out.steps = phaseSteps(input.steps, out.cycle, `track ${name} time.steps`);
  }
  return Object.keys(out).length > 0 ? { time: Object.freeze(out) } : {};
}

function phaseSteps(
  input: Record<string, unknown>,
  cycle: number,
  label: string,
): Readonly<{ shift: number; hold: number; drift: number }> {
  const shift = positive(input.shift, `${label}.shift`);
  if (shift > cycle)
    throw new DawgSdkError(`${label}.shift must be at most the cycle`);
  const hold = finite(input.hold, `${label}.hold`);
  if (!Number.isInteger(hold) || hold < 0 || hold > 64)
    throw new DawgSdkError(`${label}.hold must be a whole 0..64 cycles`);
  const drift = finite(input.drift, `${label}.drift`);
  if (!Number.isInteger(drift) || drift < 1 || drift > 64)
    throw new DawgSdkError(`${label}.drift must be a whole 1..64 cycles`);
  return Object.freeze({ shift, hold, drift });
}

const AUTOMATION_KEYS: readonly (keyof AutomationInput)[] = Object.freeze([
  "volume",
  "pan",
  "filter",
  "resonance",
  "delayFeedback",
  "delayMix",
  "fx",
  "wt",
]);

type EffectValue = number | string | boolean;

function effectValue(value: unknown, label: string): EffectValue {
  if (typeof value === "string" || typeof value === "boolean") return value;
  return finite(value, label);
}

/** The optional effect fields that are set; dawg validates their ranges. */
function extras(
  input: object,
  keys: readonly string[],
  label: string,
): Record<string, EffectValue> {
  const out: Record<string, EffectValue> = {};
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = effectValue(value, `${label}.${key}`);
  }
  return out;
}

function fxInput(input: unknown, name: string): FxInput | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input))
    throw new DawgSdkError(`track ${name}: fx must be an object of effects`);
  const out: Record<string, EffectParams> = {};
  for (const [effect, params] of Object.entries(input)) {
    if (!isRecord(params))
      throw new DawgSdkError(`track ${name}: fx.${effect} must be an object`);
    const values: Record<string, EffectValue> = {};
    for (const [key, value] of Object.entries(params))
      values[key] = effectValue(value, `${name} fx.${effect}.${key}`);
    out[effect] = Object.freeze(values);
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : null;
}

function stringInput(input: unknown, name: string): StringInput | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input))
    throw new DawgSdkError(`track ${name}: string must be an object`);
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "kind") continue;
    out[key] =
      typeof value === "string"
        ? value
        : finite(value, `${name} string.${key}`);
  }
  return Object.freeze(out);
}

function synthInput(input: unknown, name: string): SynthInput | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input))
    throw new DawgSdkError(`track ${name}: synth must be an object`);
  const out: Record<string, EffectValue | readonly number[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value)
      ? Object.freeze(
          value.map((n, index) => finite(n, `${name} synth.${key}[${index}]`)),
        )
      : effectValue(value, `${name} synth.${key}`);
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : null;
}

function fxLanes(
  input: unknown,
  name: string,
): Readonly<Record<string, readonly Point[]>> {
  if (input === undefined) return Object.freeze({});
  if (!isRecord(input))
    throw new DawgSdkError(`track ${name}: automation.fx must be an object`);
  const out: Record<string, readonly Point[]> = {};
  for (const [key, points] of Object.entries(input)) {
    if (!Array.isArray(points) || points.length > 256)
      throw new DawgSdkError(
        `track ${name}: automation.fx["${key}"] must be an array of at most 256 [beat, value] points`,
      );
    out[key] = Object.freeze(
      points.map((point: unknown, index: number): Point => {
        if (!Array.isArray(point) || point.length !== 2)
          throw new DawgSdkError(
            `track ${name}: automation.fx["${key}"][${index}] must be [beat, value]`,
          );
        return Object.freeze([
          beat(point[0], `automation.fx["${key}"][${index}] beat`),
          finite(point[1], `automation.fx["${key}"][${index}] value`),
        ] as const);
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * Directory name for a track: lowercase, spaces and runs of punctuation
 * become one `-` (`"Keys 2"` → `keys-2`); empty input becomes `track`.
 * Same rule as dawg's `trackSlug`, copied so this file stays standalone.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "track";
}

/** Pitch slot for each one-shot voice, in voice-name order from 36. */
export function voiceSlots(spec: SamplerSpec): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  if (spec.mode !== "oneshot") return slots;
  Object.keys(spec.voices)
    .sort()
    .forEach((voice, index) => slots.set(voice, SAMPLER_FIRST_SLOT + index));
  return slots;
}

/** `reverb.ir`: built-in names stay bare; files become project-relative. */
function reverbIr(
  value: unknown,
  name: string,
  slug: string,
):
  | string
  | Readonly<{ src: string; sha256?: string; url?: string; license?: string }> {
  const spec = typeof value === "string" ? { src: value } : value;
  if (!isRecord(spec) || typeof spec.src !== "string" || spec.src.length === 0)
    throw new DawgSdkError(`track ${name}: reverb.ir needs a src`);
  const src = spec.src.trim().replace(/^\.\//, "");
  if (src.startsWith("pack:")) {
    const ref = sampleSpec(spec as SampleSpec, `${name} reverb.ir`);
    return Object.freeze({
      src: ref.src,
      ...(ref.sha256 ? { sha256: ref.sha256 } : {}),
      ...(ref.url ? { url: ref.url } : {}),
      ...(ref.license ? { license: ref.license } : {}),
    });
  }
  if (src.startsWith("builtin:") || !/[./]/.test(src)) return src;
  return src.startsWith("tracks/") ? src : `tracks/${slug}/${src}`;
}

/** `./wavetables/x.wav` → `tracks/<slug>/wavetables/x.wav`, like sampler files. */
function localizeWavetable(spec: WavetableSpec, slug: string): WavetableSpec {
  const src = spec.table.src;
  if (!/\.wav$/i.test(src) || src.startsWith("pack:")) return spec;
  const bare = src.replace(/^\.\//, "");
  return Object.freeze({
    ...spec,
    table: Object.freeze({
      ...spec.table,
      src: bare.startsWith("tracks/") ? bare : `tracks/${slug}/${bare}`,
    }),
  });
}

function localizeSampler(spec: SamplerSpec, slug: string): SamplerSpec {
  const voices: Record<string, SampleSpec> = {};
  for (const [name, voice] of Object.entries(spec.voices)) {
    const src = voice.src.replace(/^\.\//, "");
    voices[name] = Object.freeze({
      ...voice,
      src:
        src.startsWith("tracks/") || src.startsWith("pack:")
          ? src
          : `tracks/${slug}/${src}`,
    });
  }
  return Object.freeze({ ...spec, voices: Object.freeze(voices) });
}

// ---------------------------------------------------------------------------
// Song

/** Input to `song()`. */
export type SongInput = Readonly<{
  /** BPM 20..300, default 120. */
  tempo?: number;
  /**
   * `[beatsPerBar, noteValue]` or just `beatsPerBar`; default `[4, 4]`.
   * A note value other than 4 is stored as a meter change at bar 1, so
   * `[6, 8]` is six eighths (three quarter-note beats) per bar.
   */
  meter?: readonly [number, number] | number;
  /** Loop length in bars, 1..256, default 4. */
  bars?: number;
  /**
   * Free text such as `"A minor"`, or null. A scale name after the tonic
   * picks a scale: `"D dorian"`, `"E hijaz"`, `"C yaman"`, `"C messiaen-3"`.
   */
  key?: string | null;
  /**
   * Song tuning (SDK 1.16.0), default 12-TET at A4 = 440 Hz: a library name
   * (`"19-edo"`, `"just"`, `"pelog"`, `"yaman"`) or `{ edo, ratios, cents,
   * scl, kbm, ref, root, map }`. See `TuningInput`.
   */
  tuning?: TuningInput | null;
  /** Integer ticks per beat, default 480. Leave it alone unless you know why. */
  ticksPerBeat?: number;
  /**
   * Tempo changes, meter changes and fermatas (SDK 1.14.0), in any order:
   * `tempo()`, `ramp()`, `rit()`, `accel()`, `fermata()` and `meter()`.
   * `tempo` above stays the opening tempo and `meter` the opening meter.
   * `rit()` and `accel()` return two marks; list them as they come.
   */
  time?: readonly (TimeMark | readonly TimeMark[])[];
  /** Tracks in score order; each from `track()`. */
  tracks: readonly TrackSpec[];
  /** Master chain and loudness target after every track and orbit bus (SDK 1.17.0); omit for none. */
  master?: MasterInput;
  /**
   * Named bar ranges (SDK 1.18.0): `{ name: "chorus", startBar: 8, bars: 8 }`,
   * optionally with `mute: ["pad"]` and `vary: { lead: { transpose: 12 } }`.
   */
  sections?: readonly SongSection[];
  /**
   * The order sections play, with repeats (SDK 1.18.0): `"intro verse
   * chorus*2 outro"`, or `["intro", { section: "chorus", repeat: 2 }]`.
   * Absent plays the bars straight through.
   */
  form?: string | readonly (string | SongFormEntry)[];
  /** The section playback loops (SDK 1.18.0); export ignores it. */
  loopSection?: string;
}>;

/** A song section (SDK 1.18.0); bars are 0-based like beats. */
export type SongSection = Readonly<{
  /** `intro`, `verse`, `chorus 2`, `A`: 1..32 characters, unique ignoring case. */
  name: string;
  /** First bar, 0-based. */
  startBar: number;
  /** Length in bars, at least 1. */
  bars: number;
  /** Track ids silent in this section. */
  mute?: readonly string[];
  /** Per-track changes in this section: semitones and a velocity multiplier. */
  vary?: Readonly<
    Record<string, Readonly<{ transpose?: number; gain?: number }>>
  >;
}>;

/** One step of the song form (SDK 1.18.0). */
export type SongFormEntry = Readonly<{ section: string; repeat?: number }>;

/**
 * The song master (SDK 1.17.0), processed in the fixed order
 * eq → glue → tape → width → limiter after the tracks and orbit buses are
 * summed. Each unit present is on; `{}` takes every default. `target` is
 * an integrated loudness in LUFS (ITU-R BS.1770-4), -40..-3: renders drive
 * the limiter (or, without one, a clean gain) to reach it. Streaming is
 * -14, club -8, loud hyperpop or gabber -6, classical -20, broadcast -23.
 * The SDK takes LUFS numbers only: a target name such as `master target
 * club` in the prompt also sets a limiter preset, so write that unit out.
 * DAWG.md "Master and loudness" lists every parameter with its range.
 *
 * ```ts
 * master: { glue: { ratio: 2 }, limiter: { ceiling: -1 }, target: -14 }
 * ```
 */
export type MasterInput = Readonly<{
  /** `low`/`high` shelves and `bell1`/`bell2` gains in dB, with `…freq` and `…q`. */
  eq?: EffectParams;
  /** Bus compressor: threshold, ratio, attack, release (ms), knee, makeup, mix, hpf. */
  glue?: EffectParams;
  /** Saturation: drive (dB), bias, tone (Hz), mix. */
  tape?: EffectParams;
  /** Stereo width 0..2 (1 unchanged) and `mono` bass below this many Hz. */
  width?: EffectParams;
  /** True-peak limiter: ceiling (dBTP), gain, release, lookahead (ms), truepeak. */
  limiter?: EffectParams;
  /** Integrated loudness target in LUFS (a negative number, -40..-3). */
  target?: number;
}>;

/** A stored note: integer ticks; expression fields only when set. */
export type ScoreNote = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  articulation?: Articulation;
  glide?: number;
  bend?: readonly Readonly<{ at: number; cents: number }>[];
  vibrato?: Readonly<{ rate: number; depth: number; delay?: number }>;
  humanize?: Readonly<{ timing?: number; velocity?: number; length?: number }>;
  /** Static cents offset (SDK 1.16.0); absent is 0. */
  cents?: number;
}>;

/** A stored automation point: integer tick. */
export type ScorePoint = Readonly<{ tick: number; value: number }>;

/** A stored sample reference (project-relative `src`, MIDI `root`). */
export type ScoreSampleRef = Readonly<{
  src: string;
  sha256?: string;
  url?: string;
  license?: string;
  root?: number;
  begin?: number;
  end?: number;
  gain?: number;
  speed?: number;
  loop?: boolean;
  choke?: string;
  loopBegin?: number;
  loopEnd?: number;
  clip?: number;
  unit?: "r" | "c" | "s";
  fit?: boolean;
  accelerate?: number;
  squiz?: number;
  bpm?: number;
  fitmode?: "repitch" | "beats" | "tones";
  len?: number;
}>;

/** A stored track; optional fields are present only when set. */
export type ScoreTrack = Readonly<{
  id: string;
  name: string;
  instrument: string;
  muted: boolean;
  volume: number;
  pan: number;
  volumeAutomation: readonly ScorePoint[];
  panAutomation: readonly ScorePoint[];
  solo?: boolean;
  filter?: TrackSpec["filter"] & object;
  delay?: TrackSpec["delay"] & object;
  filterAutomation?: readonly ScorePoint[];
  resonanceAutomation?: readonly ScorePoint[];
  delayFeedbackAutomation?: readonly ScorePoint[];
  delayMixAutomation?: readonly ScorePoint[];
  reverb?: TrackSpec["reverb"] & object;
  fx?: FxInput;
  fxAutomation?: Readonly<Record<string, readonly ScorePoint[]>>;
  synth?: SynthInput;
  sampler?: Readonly<{
    voices: Readonly<Record<string, ScoreSampleRef>>;
    mode: "oneshot" | "keyed";
  }>;
  /** Rhythm rows without `kind`; dawg validates and expands them. */
  rhythm?: readonly Readonly<Record<string, unknown>>[];
  /** Synth kit name; dawg validates it. */
  kit?: string;
  /** `rate`, plus `phase` and `cycle` in ticks. */
  time?: Readonly<{
    rate?: number;
    phase?: number;
    cycle?: number;
    steps?: Readonly<{ shift: number; hold: number; drift: number }>;
  }>;
  /** Track tuning; dawg validates it (SDK 1.16.0). */
  tuning?: ScoreTuning;
  wavetable?: Readonly<{ table: ScoreSampleRef } & WavetableParams>;
  wtAutomation?: readonly ScorePoint[];
  /** String engine settings; dawg validates them (SDK 1.20.0). */
  string?: StringInput;
  glide?: TrackSpec["glide"];
  pedal?: readonly Readonly<{ tick: number; state: PedalState }>[];
  velocityCurve?: TrackSpec["velocityCurve"];
  humanize?: TrackSpec["humanize"];
}>;

/**
 * What `song()` returns and `song.ts` default-exports: a `track.loop/v1`
 * document in integer ticks, ready for dawg to validate and diff against
 * the session.
 */
export type Song = Readonly<{
  format: "track.loop/v1";
  version: 1;
  tempoBpm: number;
  beatsPerBar: number;
  bars: number;
  ticksPerBeat: number;
  key: string | null;
  /** Present only when `song({ time })` has marks. */
  time?: ScoreTime;
  /** Present only when the song sets one (SDK 1.16.0). */
  tuning?: ScoreTuning;
  tracks: readonly ScoreTrack[];
  notes: readonly ScoreNote[];
  master?: MasterInput;
  /** Present only when the song has sections (SDK 1.18.0). */
  sections?: readonly SongSection[];
  /** Present only when the song has a form (SDK 1.18.0). */
  form?: readonly SongFormEntry[];
  /** Present only when a section loops (SDK 1.18.0). */
  loopSection?: string;
}>;

/** A stored song `time`: ticks, and 0-based bar indexes. */
export type ScoreTime = Readonly<{
  tempo?: readonly Readonly<{
    tick: number;
    bpm: number;
    ramp?: "linear" | "exp";
  }>[];
  meter?: readonly Readonly<{
    bar: number;
    beatsPerBar: number;
    beatUnit?: number;
  }>[];
  fermatas?: readonly Readonly<{ tick: number; beats: number }>[];
}>;

const MASTER_KEYS = ["eq", "glue", "tape", "width", "limiter", "target"];

/** Shape checks only; dawg validates every value when it loads the song. */
function masterData(input: unknown): MasterInput | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) throw new DawgSdkError("song master must be an object");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!MASTER_KEYS.includes(key))
      throw new DawgSdkError(
        `song master has no "${key}"; use ${MASTER_KEYS.join(", ")}`,
      );
    if (key === "target") {
      if (typeof value === "string")
        throw new DawgSdkError(
          `song master target takes LUFS, e.g. target: -14 (streaming), -8 (club, with limiter: { release: 60, lookahead: 2 }), -6 (loud, with limiter: { release: 20, lookahead: 1 }); got "${value}"`,
        );
      out.target = finite(value as number, "song master target");
      continue;
    }
    if (!isRecord(value))
      throw new DawgSdkError(`song master ${key} must be an object`);
    out[key] = Object.freeze({ ...value });
  }
  return Object.keys(out).length > 0
    ? (Object.freeze(out) as MasterInput)
    : undefined;
}

/** `"intro verse chorus*2"` (comma separated when a name has a space). */
function parseSongForm(
  form: NonNullable<SongInput["form"]>,
): readonly SongFormEntry[] {
  const items: (string | SongFormEntry)[] =
    typeof form === "string"
      ? (form.includes(",") ? form.split(",") : form.trim().split(/\s+/u))
          .map((item) => item.trim())
          .filter((item) => item !== "")
      : Array.isArray(form)
        ? [...form]
        : (() => {
            throw new DawgSdkError(
              "song form must be a string or an array of section names",
            );
          })();
  return Object.freeze(
    items.map((item, index) => {
      let entry: unknown = item;
      if (typeof item === "string") {
        const match = /^(.*?)\s*(?:\*|\bx|×)\s*(\d+)$/iu.exec(item);
        entry =
          match && match[1]!.length > 0
            ? { section: match[1]!, repeat: Number(match[2]) }
            : { section: item };
      }
      if (!isRecord(entry) || typeof entry.section !== "string")
        throw new DawgSdkError(
          `song form[${index}] must be a section name or { section, repeat }`,
        );
      const repeat = entry.repeat ?? 1;
      if (
        !Number.isInteger(repeat) ||
        (repeat as number) < 1 ||
        (repeat as number) > 16
      )
        throw new DawgSdkError(`song form[${index}] repeat must be 1..16`);
      return Object.freeze(
        repeat === 1
          ? { section: entry.section }
          : { section: entry.section, repeat: repeat as number },
      );
    }),
  );
}

function songSections(
  sections: NonNullable<SongInput["sections"]>,
): readonly SongSection[] {
  if (!Array.isArray(sections))
    throw new DawgSdkError("song sections must be an array");
  if (sections.length > 64) throw new DawgSdkError("song has over 64 sections");
  return Object.freeze(
    sections.map((section, index) => {
      const where = `song sections[${index}]`;
      if (!isRecord(section) || typeof section.name !== "string")
        throw new DawgSdkError(`${where} needs a name`);
      const stored: Record<string, unknown> = {
        name: section.name,
        startBar: finite(section.startBar, `${where}.startBar`),
        bars: finite(section.bars, `${where}.bars`),
      };
      if (section.mute !== undefined) {
        if (
          !Array.isArray(section.mute) ||
          section.mute.some((id) => typeof id !== "string")
        )
          throw new DawgSdkError(`${where}.mute must be track ids`);
        if (section.mute.length > 0)
          stored.mute = Object.freeze([...section.mute]);
      }
      if (section.vary !== undefined) {
        if (!isRecord(section.vary))
          throw new DawgSdkError(`${where}.vary must be an object`);
        const vary = Object.entries(section.vary);
        if (vary.length > 0)
          stored.vary = Object.freeze(
            Object.fromEntries(
              vary.map(([id, change]) => {
                if (!isRecord(change))
                  throw new DawgSdkError(
                    `${where}.vary.${id} must be an object`,
                  );
                const out: Record<string, number> = {};
                if (change.transpose !== undefined)
                  out.transpose = finite(
                    change.transpose,
                    `${where}.vary.${id}.transpose`,
                  );
                if (change.gain !== undefined)
                  out.gain = finite(change.gain, `${where}.vary.${id}.gain`);
                return [id, Object.freeze(out)];
              }),
            ),
          );
      }
      return Object.freeze(stored) as SongSection;
    }),
  );
}

/**
 * Assemble the song. Beats become ticks (`Math.round(beat * ticksPerBeat)`,
 * lengths at least one tick), and every note gets a deterministic id from
 * its track and content, so two evaluations of the same files agree.
 */
export function song(input: SongInput): Song {
  if (!isRecord(input)) throw new DawgSdkError("song() needs an object");
  const tempoBpm = finite(input.tempo ?? 120, "song tempo");
  const meter = input.meter ?? 4;
  const beatsPerBar = Array.isArray(meter)
    ? finite(meter[0], "song meter[0]")
    : finite(meter as number, "song meter");
  const beatUnit = Array.isArray(meter) ? finite(meter[1], "song meter[1]") : 4;
  if (![1, 2, 4, 8, 16, 32].includes(beatUnit))
    throw new DawgSdkError(
      "song meter note value must be 1, 2, 4, 8, 16 or 32",
    );
  const bars = finite(input.bars ?? 4, "song bars");
  const ticksPerBeat = input.ticksPerBeat ?? DEFAULT_TICKS_PER_BEAT;
  if (
    !Number.isInteger(ticksPerBeat) ||
    ticksPerBeat < 1 ||
    ticksPerBeat > 4096
  )
    throw new DawgSdkError("song ticksPerBeat must be an integer 1..4096");
  const key = input.key ?? null;
  if (key !== null && typeof key !== "string")
    throw new DawgSdkError("song key must be a string or null");
  const songTuning = tuningSpec(input.tuning, "song");
  const master = masterData(input.master);
  if (!Array.isArray(input.tracks))
    throw new DawgSdkError("song tracks must be an array of track()");
  if (input.tracks.length > 64)
    throw new DawgSdkError("song has over 64 tracks");
  const ticks = (beats: number) => Math.round(beats * ticksPerBeat);
  const points = (lane: readonly Point[]): readonly ScorePoint[] =>
    Object.freeze(
      lane.map(([at, value]) => Object.freeze({ tick: ticks(at), value })),
    );
  const seen = new Set<string>();
  const tracks: ScoreTrack[] = [];
  const notes: ScoreNote[] = [];
  input.tracks.forEach((spec, index) => {
    if (!isRecord(spec) || spec.kind !== "track")
      throw new DawgSdkError(`song tracks[${index}] must come from track()`);
    const t = spec as TrackSpec;
    if (seen.has(t.id))
      throw new DawgSdkError(`song has two tracks with id "${t.id}"`);
    seen.add(t.id);
    const filterAutomation = points(t.automation.filter);
    const resonanceAutomation = points(t.automation.resonance);
    const delayFeedbackAutomation = points(t.automation.delayFeedback);
    const delayMixAutomation = points(t.automation.delayMix);
    const wtAutomation = points(t.automation.wt ?? []);
    const stored: Record<string, unknown> = {
      id: t.id,
      name: t.name,
      instrument: t.instrument,
      muted: t.muted,
      volume: t.volume,
      pan: t.pan,
      volumeAutomation: points(t.automation.volume),
      panAutomation: points(t.automation.pan),
    };
    if (t.solo) stored.solo = true;
    if (t.filter) stored.filter = t.filter;
    if (t.delay) stored.delay = t.delay;
    if (filterAutomation.length > 0) stored.filterAutomation = filterAutomation;
    if (resonanceAutomation.length > 0)
      stored.resonanceAutomation = resonanceAutomation;
    if (delayFeedbackAutomation.length > 0)
      stored.delayFeedbackAutomation = delayFeedbackAutomation;
    if (delayMixAutomation.length > 0)
      stored.delayMixAutomation = delayMixAutomation;
    if (t.reverb) stored.reverb = t.reverb;
    if (t.fx) stored.fx = t.fx;
    if (t.synth) stored.synth = t.synth;
    const fxLaneEntries = Object.entries(t.automation.fx ?? {})
      .map(([key, lane]) => [key, points(lane)] as const)
      .filter(([, lane]) => lane.length > 0);
    if (fxLaneEntries.length > 0)
      stored.fxAutomation = Object.freeze(Object.fromEntries(fxLaneEntries));
    if (t.wavetable) {
      const { kind: _kind, ...fields } = t.wavetable;
      stored.wavetable = Object.freeze(fields);
    }
    if (wtAutomation.length > 0) stored.wtAutomation = wtAutomation;
    if (t.sampler)
      stored.sampler = Object.freeze({
        voices: t.sampler.voices,
        mode: t.sampler.mode,
      });
    if (t.kit) stored.kit = t.kit;
    if (t.time) {
      const time: Record<string, unknown> = {};
      if (t.time.rate !== undefined) time.rate = t.time.rate;
      if (t.time.phase !== undefined) {
        const phase = ticks(t.time.phase);
        if (phase !== 0) time.phase = phase;
      }
      if (t.time.cycle !== undefined)
        time.cycle = Math.max(1, ticks(t.time.cycle));
      if (t.time.steps)
        time.steps = Object.freeze({
          ...t.time.steps,
          shift: Math.max(1, ticks(t.time.steps.shift)),
        });
      if (Object.keys(time).length > 0) stored.time = Object.freeze(time);
    }
    if (t.glide) stored.glide = t.glide;
    if (t.pedal && t.pedal.length > 0) {
      // One event per tick (the last wins), in tick order, as dawg stores it.
      const byTick = new Map<number, PedalState>();
      for (const [at, state] of t.pedal) byTick.set(ticks(at), state);
      stored.pedal = Object.freeze(
        [...byTick.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([tick, state]) => Object.freeze({ tick, state })),
      );
    }
    if (t.velocityCurve) stored.velocityCurve = t.velocityCurve;
    if (t.humanize) stored.humanize = t.humanize;
    if (t.tuning) stored.tuning = t.tuning;
    if (t.string) stored.string = t.string;
    if (t.rhythm && t.rhythm.length > 0)
      stored.rhythm = Object.freeze(
        t.rhythm.map((row) => {
          const { kind: _kind, ...fields } = row;
          return Object.freeze(fields);
        }),
      );
    tracks.push(Object.freeze(stored) as ScoreTrack);
    const ids = new Set<string>();
    for (const n of t.notes) {
      const startTick = ticks(n.start);
      const durationTicks = Math.max(1, ticks(n.length));
      let id = "";
      for (let occurrence = 0; ; occurrence += 1) {
        id = `n-${hash64(`${t.id}|${n.pitch}|${startTick}|${durationTicks}|${n.velocity}|${occurrence}`)}`;
        if (!ids.has(id)) break;
      }
      ids.add(id);
      notes.push(
        Object.freeze({
          id,
          trackId: t.id,
          startTick,
          durationTicks,
          pitch: n.pitch,
          velocity: n.velocity,
          ...(n.articulation ? { articulation: n.articulation } : {}),
          ...(n.glide !== undefined ? { glide: n.glide } : {}),
          ...(n.bend
            ? {
                bend: Object.freeze(
                  [...n.bend]
                    .sort((a, b) => a[0] - b[0])
                    .map(([at, cents]) => Object.freeze({ at, cents })),
                ),
              }
            : {}),
          ...(n.vibrato ? { vibrato: n.vibrato } : {}),
          ...(n.humanize ? { humanize: n.humanize } : {}),
          ...(n.cents ? { cents: n.cents } : {}),
        }),
      );
    }
  });
  const arrangement: {
    sections?: readonly SongSection[];
    form?: readonly SongFormEntry[];
    loopSection?: string;
  } = {};
  if (input.sections !== undefined) {
    const sections = songSections(input.sections);
    if (sections.length > 0) arrangement.sections = sections;
  }
  if (input.form !== undefined) {
    const form = parseSongForm(input.form);
    if (form.length > 0) arrangement.form = form;
  }
  if (input.loopSection !== undefined) {
    if (typeof input.loopSection !== "string")
      throw new DawgSdkError("song loopSection must be a section name");
    arrangement.loopSection = input.loopSection;
  }
  return Object.freeze({
    format: "track.loop/v1",
    version: 1,
    tempoBpm,
    beatsPerBar,
    bars,
    ticksPerBeat,
    key,
    ...songTime(
      input.time,
      tempoBpm,
      ticks,
      beatsPerBar,
      ticksPerBeat,
      beatUnit,
      bars,
    ),
    ...(songTuning ? { tuning: songTuning } : {}),
    tracks: Object.freeze(tracks),
    notes: Object.freeze(notes),
    ...(master ? { master } : {}),
    ...arrangement,
  });
}

// ---------------------------------------------------------------------------
// Time (SDK 1.14.0)

/** One entry of `song({ time })`; build them with the helpers below. */
export type TimeMark =
  | Readonly<{
      kind: "tempo";
      /** Beat the change lands on. */
      at: number;
      /** Absent: keep the tempo in effect there, so a ramp can start from it. */
      bpm?: number;
      /** Glide into `bpm` from the previous mark instead of stepping. */
      ramp?: "linear" | "exp";
      /** Set by `rit()`/`accel()`: the direction `song()` checks. */
      gradual?: "rit" | "accel";
      /**
       * Set by `aTempo()` (the tempo before the last rit/accel) and
       * `tempoPrimo()` (the song's opening tempo) instead of `bpm`.
       */
      back?: "a-tempo" | "primo";
    }>
  | Readonly<{
      kind: "meter";
      /** Beat of the bar line where the meter starts. */
      at: number;
      beatsPerBar: number;
      beatUnit: number;
    }>
  | Readonly<{
      kind: "fermata";
      at: number;
      /** Extra beats the held beat lasts. */
      beats: number;
    }>;

/** `ramp()` curves: `linear` adds the same BPM each beat, `exp` the same ratio. */
export type TempoCurve = "linear" | "exp";

/**
 * Tempo change at beat `at`: `tempo(32, 140)`. Omit `bpm` to pin the tempo
 * in effect there, the start of a ramp.
 */
export function tempo(at: number, bpm?: number): TimeMark {
  const start = beat(at, "tempo() at");
  if (start <= 0)
    throw new DawgSdkError("tempo() at must be > 0; song({ tempo }) is beat 0");
  if (bpm === undefined) return Object.freeze({ kind: "tempo", at: start });
  return Object.freeze({ kind: "tempo", at: start, bpm: songBpm(bpm) });
}

/**
 * `a tempo` at beat `at` (SDK 1.19.0): step back to the tempo in effect
 * before the last `rit()`/`accel()` (or ramp) ending before `at`.
 */
export function aTempo(at: number): TimeMark {
  const start = beat(at, "aTempo() at");
  if (start <= 0) throw new DawgSdkError("aTempo() at must be > 0");
  return Object.freeze({ kind: "tempo", at: start, back: "a-tempo" });
}

/** `tempo primo` at beat `at` (SDK 1.19.0): step back to `song({ tempo })`. */
export function tempoPrimo(at: number): TimeMark {
  const start = beat(at, "tempoPrimo() at");
  if (start <= 0) throw new DawgSdkError("tempoPrimo() at must be > 0");
  return Object.freeze({ kind: "tempo", at: start, back: "primo" });
}

/**
 * Glide from the previous tempo mark (or the song's opening tempo) to `bpm`
 * at beat `at`: `ramp(64, 90)`. `exp` changes by the same ratio each beat.
 */
export function ramp(
  at: number,
  bpm: number,
  curve: TempoCurve = "linear",
): TimeMark {
  const end = beat(at, "ramp() at");
  if (end <= 0) throw new DawgSdkError("ramp() at must be > 0");
  return Object.freeze({
    kind: "tempo",
    at: end,
    bpm: songBpm(bpm),
    ramp: tempoCurve(curve, "ramp()"),
  });
}

/**
 * Ritardando: slow from the tempo at beat `at` to `bpm` over `beats` beats,
 * `rit(48, 16, 80)`. Same as `[tempo(at), ramp(at + beats, bpm, curve)]`.
 */
export function rit(
  at: number,
  beats: number,
  bpm: number,
  curve: TempoCurve = "linear",
): readonly TimeMark[] {
  return gradual("rit", at, beats, bpm, curve);
}

/** Accelerando: like `rit()`, toward a faster `bpm`. */
export function accel(
  at: number,
  beats: number,
  bpm: number,
  curve: TempoCurve = "linear",
): readonly TimeMark[] {
  return gradual("accel", at, beats, bpm, curve);
}

function gradual(
  direction: "rit" | "accel",
  at: number,
  beats: number,
  bpm: number,
  curve: TempoCurve,
): readonly TimeMark[] {
  const label = `${direction}()`;
  const start = beat(at, `${label} at`);
  const length = positive(beats, `${label} beats`);
  const target = songBpm(bpm);
  const shape = tempoCurve(curve, label);
  const marks: TimeMark[] = [];
  if (start > 0) marks.push(Object.freeze({ kind: "tempo", at: start }));
  marks.push(
    Object.freeze({
      kind: "tempo",
      at: start + length,
      bpm: target,
      ramp: shape,
      gradual: direction,
    }),
  );
  return Object.freeze(marks);
}

/** Fermata: the beat at `at` lasts `beats` extra beats (default 2). */
export function fermata(at: number, beats = 2): TimeMark {
  const hold = positive(beats, "fermata() beats");
  if (hold > 64) throw new DawgSdkError("fermata() beats must be at most 64");
  return Object.freeze({
    kind: "fermata",
    at: beat(at, "fermata() at"),
    beats: hold,
  });
}

/**
 * Meter change on the bar line at beat `at`: `meter(16, [7, 8])` or
 * `meter(16, 3)` (quarter-note beats). It lasts until the next one.
 */
export function meter(
  at: number,
  value: readonly [number, number] | number,
): TimeMark {
  const start = beat(at, "meter() at");
  const [beatsPerBar, beatUnit] = Array.isArray(value)
    ? [value[0], value[1]]
    : [value as number, 4];
  if (
    typeof beatsPerBar !== "number" ||
    !Number.isInteger(beatsPerBar) ||
    beatsPerBar < 1 ||
    beatsPerBar > 16
  )
    throw new DawgSdkError("meter() beats per bar must be an integer 1..16");
  if (![1, 2, 4, 8, 16, 32].includes(beatUnit as number))
    throw new DawgSdkError("meter() note value must be 1, 2, 4, 8, 16 or 32");
  return Object.freeze({
    kind: "meter",
    at: start,
    beatsPerBar,
    beatUnit: beatUnit as number,
  });
}

/**
 * Track time for continuous phasing, the tape drift of Reich's It's Gonna
 * Rain and Come Out: the track's first `cycle` beats repeat a little fast,
 * gaining `cycles` whole cycles every `over` beats, so it drifts away from
 * an identical track and lines up again. `over` should divide the song
 * loop. `track({ ..., time: phasing(3, 48) })`. For Piano Phase's
 * shift-and-hold, use `stepPhasing()`.
 */
export function phasing(
  cycle: number,
  over: number,
  cycles = 1,
): TrackTimeInput {
  const length = positive(cycle, "phasing() cycle");
  const span = positive(over, "phasing() over");
  const gain = finite(cycles, "phasing() cycles");
  const repeats = span / length;
  const rate = (repeats + gain) / repeats;
  if (!(rate >= 0.125 && rate <= 8))
    throw new DawgSdkError("phasing() needs a rate between 0.125 and 8");
  return Object.freeze({ cycle: length, rate });
}

/**
 * Stepped phasing (SDK 1.19.0), as in Reich's Piano Phase: the track's first `cycle`
 * beats hold in step with a twin for `hold` cycles, then move `shift`
 * beats ahead over `drift` cycles, and repeat until a whole cycle ahead.
 * `track({ ..., time: stepPhasing(3, { hold: 8 }) })`.
 */
export function stepPhasing(
  cycle: number,
  options: Readonly<{ shift?: number; hold?: number; drift?: number }> = {},
): TrackTimeInput {
  const length = positive(cycle, "stepPhasing() cycle");
  const steps = phaseSteps(
    { shift: 0.25, hold: 8, drift: 2, ...options },
    length,
    "stepPhasing()",
  );
  return Object.freeze({ cycle: length, steps });
}

function songBpm(value: unknown): number {
  const bpm = finite(value, "tempo bpm");
  if (bpm < 20 || bpm > 300)
    throw new DawgSdkError("tempo bpm must be 20..300");
  return bpm;
}

function tempoCurve(value: unknown, label: string): TempoCurve {
  if (value !== "linear" && value !== "exp")
    throw new DawgSdkError(`${label} curve must be "linear" or "exp"`);
  return value;
}

/** Same as `TIME_LIMITS.maxFermataSeconds` in core/tempo.ts. */
const MAX_FERMATA_SECONDS = 16.777;

/** Tempo at `tick` through resolved tempo events (ramps glide into theirs). */
function bpmAtTick(
  tempo: readonly { tick: number; bpm: number; ramp?: TempoCurve }[],
  start: number,
  tick: number,
): number {
  let from = { tick: 0, bpm: start };
  for (const event of tempo) {
    if (event.tick <= tick) {
      from = event;
      continue;
    }
    if (!event.ramp) break;
    const t = (tick - from.tick) / (event.tick - from.tick);
    return event.ramp === "exp"
      ? from.bpm * Math.pow(event.bpm / from.bpm, t)
      : from.bpm + (event.bpm - from.bpm) * t;
  }
  return from.bpm;
}

/** Resolves `song({ time })` marks into the stored ticks and bar indexes. */
function songTime(
  input: unknown,
  tempoBpm: number,
  ticks: (beats: number) => number,
  beatsPerBar: number,
  ticksPerBeat: number,
  beatUnit = 4,
  bars = Infinity,
): { time?: ScoreTime } {
  if ((input === undefined || input === null) && beatUnit === 4) return {};
  input ??= [];
  if (!Array.isArray(input))
    throw new DawgSdkError("song time must be an array of time marks");
  const marks: TimeMark[] = [];
  for (const [index, entry] of (input as unknown[]).entries()) {
    for (const mark of Array.isArray(entry) ? entry : [entry]) {
      if (
        !isRecord(mark) ||
        (mark.kind !== "tempo" &&
          mark.kind !== "meter" &&
          mark.kind !== "fermata")
      )
        throw new DawgSdkError(
          `song time[${index}] must come from tempo(), ramp(), rit(), accel(), fermata() or meter()`,
        );
      marks.push(mark as TimeMark);
    }
  }
  // Tempo: sort by tick, resolve pins against their neighbours.
  type Event = {
    tick: number;
    bpm?: number;
    ramp?: TempoCurve;
    back?: "a-tempo" | "primo";
  };
  const byTick = new Map<number, Event>();
  for (const mark of marks) {
    if (mark.kind !== "tempo") continue;
    const tick = ticks(mark.at);
    const previous = byTick.get(tick);
    const sets = (e: { bpm?: number; back?: unknown }) =>
      e.bpm !== undefined || e.back !== undefined;
    if (previous && sets(previous) && sets(mark)) {
      // A rit or ramp ending where a tempo change starts (`rit(18, 6, 52)`
      // with `aTempo(24)`): the ramp lands a tick early, then the step.
      const ramped = previous.ramp ? previous : mark.ramp ? mark : undefined;
      const other = ramped === previous ? mark : previous;
      if (ramped && !other.ramp && tick > 1 && !byTick.has(tick - 1)) {
        byTick.set(tick - 1, {
          tick: tick - 1,
          ...(ramped.bpm !== undefined ? { bpm: ramped.bpm } : {}),
          ramp: ramped.ramp!,
        });
        byTick.set(tick, {
          tick,
          ...(other.bpm !== undefined ? { bpm: other.bpm } : {}),
          ...(other.back ? { back: other.back } : {}),
        });
        continue;
      }
      throw new DawgSdkError(
        `song time has two tempo changes at beat ${mark.at}; move one, or end a rit() where the next tempo starts`,
      );
    }
    // A pin and a change on the same beat: the change wins.
    if (previous && !sets(mark)) continue;
    byTick.set(tick, {
      tick,
      ...(mark.bpm !== undefined ? { bpm: mark.bpm } : {}),
      ...(mark.ramp ? { ramp: mark.ramp } : {}),
      ...(mark.back ? { back: mark.back } : {}),
    });
  }
  const events = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  const tempo: { tick: number; bpm: number; ramp?: TempoCurve }[] = [];
  events.forEach((event, index) => {
    if (event.back) {
      let bpm = tempoBpm;
      if (event.back === "a-tempo") {
        let last = -1;
        tempo.forEach((e, i) => {
          if (e.ramp !== undefined) last = i;
        });
        if (last < 0)
          throw new DawgSdkError(
            `aTempo() at beat ${event.tick / ticksPerBeat} has no rit() or accel() before it`,
          );
        bpm = last > 0 ? tempo[last - 1]!.bpm : tempoBpm;
      }
      tempo.push(Object.freeze({ tick: event.tick, bpm }));
      return;
    }
    if (event.bpm !== undefined) {
      // rit() and accel() check their direction against the tempo they
      // start from, as the prompt's `rit` and `accel` do.
      const mark = marks.find(
        (m) => m.kind === "tempo" && ticks(m.at) === event.tick && m.gradual,
      ) as Extract<TimeMark, { kind: "tempo" }> | undefined;
      if (mark?.gradual) {
        const from = tempo[tempo.length - 1]?.bpm ?? tempoBpm;
        if (mark.gradual === "rit" && event.bpm > from)
          throw new DawgSdkError(
            `rit() target ${event.bpm} BPM is faster than ${from}; use accel()`,
          );
        if (mark.gradual === "accel" && event.bpm < from)
          throw new DawgSdkError(
            `accel() target ${event.bpm} BPM is slower than ${from}; use rit()`,
          );
      }
      tempo.push(
        Object.freeze({
          tick: event.tick,
          bpm: event.bpm,
          ...(event.ramp ? { ramp: event.ramp } : {}),
        }),
      );
      return;
    }
    // A pin holds the tempo of the marks before it, and the next ramp
    // starts from it. Without a ramp after it, it changes nothing.
    const after = events
      .slice(index + 1)
      .find((e) => e.bpm !== undefined || e.back !== undefined);
    if (!after?.ramp) return;
    const before = tempo[tempo.length - 1]?.bpm ?? tempoBpm;
    tempo.push(Object.freeze({ tick: event.tick, bpm: before }));
  });
  // Meter: beats to bar indexes, checking each lands on a bar line.
  const meters = marks
    .filter((mark) => mark.kind === "meter")
    .sort((a, b) => a.at - b.at);
  // `song({ meter: [6, 8] })`: the song meter's note value as a bar-1 change.
  if (beatUnit !== 4 && !meters.some((mark) => ticks(mark.at) === 0))
    meters.unshift({ kind: "meter", at: 0, beatsPerBar, beatUnit });
  const meterOut: { bar: number; beatsPerBar: number; beatUnit?: number }[] =
    [];
  let barTick = 0;
  let barIndex = 0;
  let barLength = beatsPerBar * ticksPerBeat;
  for (const mark of meters) {
    const tick = ticks(mark.at);
    const bars = (tick - barTick) / barLength;
    if (!Number.isInteger(bars) || bars < 0)
      throw new DawgSdkError(`meter() at beat ${mark.at} is not on a bar line`);
    if (meterOut.length > 0 && bars === 0)
      throw new DawgSdkError(`song time has two meters at beat ${mark.at}`);
    barIndex += bars;
    barTick = tick;
    barLength = (mark.beatsPerBar * ticksPerBeat * 4) / mark.beatUnit;
    meterOut.push(
      Object.freeze({
        bar: barIndex,
        beatsPerBar: mark.beatsPerBar,
        ...(mark.beatUnit !== 4 ? { beatUnit: mark.beatUnit } : {}),
      }),
    );
  }
  const fermatas = marks
    .filter((mark) => mark.kind === "fermata")
    .map((mark) => Object.freeze({ tick: ticks(mark.at), beats: mark.beats }))
    .sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < fermatas.length; i += 1)
    if (fermatas[i]!.tick === fermatas[i - 1]!.tick)
      throw new DawgSdkError("song time has two fermatas on one beat");
  // Marks past the song end are never heard; the prompt refuses them too.
  if (Number.isFinite(bars)) {
    let end = 0;
    let fromBar = 0;
    let length = beatsPerBar * ticksPerBeat;
    for (const change of meterOut) {
      if (change.bar >= bars) break;
      end += (change.bar - fromBar) * length;
      fromBar = change.bar;
      length = (change.beatsPerBar * ticksPerBeat * 4) / (change.beatUnit ?? 4);
    }
    end += (bars - fromBar) * length;
    const beatOf = (tick: number) => tick / ticksPerBeat;
    // A ramp to the final barline (`rit()` over the last bars) lands on
    // the last tick, the tempo the song ends at.
    tempo.forEach((event, index) => {
      if (
        event.tick === end &&
        event.ramp &&
        end - 1 > (tempo[index - 1]?.tick ?? 0)
      )
        tempo[index] = Object.freeze({ ...event, tick: end - 1 });
    });
    for (const event of tempo)
      if (event.tick >= end)
        throw new DawgSdkError(
          `tempo at beat ${beatOf(event.tick)} is past the song end (${beatOf(end)} beats); add bars`,
        );
    for (const change of meterOut)
      if (change.bar >= bars)
        throw new DawgSdkError(
          `meter() at bar ${change.bar + 1} is past the song end (${bars} bars); add bars`,
        );
    for (const hold of fermatas)
      if (hold.tick >= end)
        throw new DawgSdkError(
          `fermata() at beat ${beatOf(hold.tick)} is past the song end (${beatOf(end)} beats); add bars`,
        );
  }
  // A fermata may hold its beat at most as long as a MIDI file can write.
  // The held beat is the meter's felt beat (a dotted quarter in 6/8), as
  // core/tempo.ts fermataSpan has it.
  const feltBeats = (tick: number): number => {
    let at = 0;
    let fromBar = 0;
    let meter = { beatsPerBar, beatUnit: 4 };
    let length = beatsPerBar * ticksPerBeat;
    for (const change of meterOut) {
      const start = at + (change.bar - fromBar) * length;
      if (start > tick) break;
      at = start;
      fromBar = change.bar;
      meter = {
        beatsPerBar: change.beatsPerBar,
        beatUnit: change.beatUnit ?? 4,
      };
      length = (meter.beatsPerBar * ticksPerBeat * 4) / meter.beatUnit;
    }
    if (meterOut.length === 0) return 1;
    const unit = 4 / meter.beatUnit;
    const compound =
      meter.beatUnit >= 8 &&
      meter.beatsPerBar > 3 &&
      meter.beatsPerBar % 3 === 0;
    return Math.max(1, compound ? unit * 3 : unit);
  };
  for (const hold of fermatas) {
    const bpm = bpmAtTick(tempo, tempoBpm, hold.tick);
    const held = ((1 + hold.beats) * feltBeats(hold.tick) * 60) / bpm;
    if (held > MAX_FERMATA_SECONDS + 1e-9)
      throw new DawgSdkError(
        `fermata() at beat ${hold.tick / ticksPerBeat} holds ${held.toFixed(1)} s; at most ${MAX_FERMATA_SECONDS} s (MIDI tempo limit), so use fewer beats or a faster tempo`,
      );
  }
  const time: Record<string, unknown> = {};
  if (tempo.length > 0) time.tempo = Object.freeze(tempo);
  if (meterOut.length > 0) time.meter = Object.freeze(meterOut);
  if (fermatas.length > 0) time.fermatas = Object.freeze(fermatas);
  return Object.keys(time).length > 0
    ? { time: Object.freeze(time) as ScoreTime }
    : {};
}

// Tuning (SDK 1.16.0)

/**
 * A tuning for `song({ tuning })` or `track({ tuning })`: a library name or
 * an object with at most one table source (`edo`, `ratios`, `cents` or
 * `scl`). Library names: `12-tet`, `19-edo`, `24-edo`, `31-edo`,
 * `pythagorean`, `just` (5-limit), `7-limit`, `well-tuned-piano`, `pelog`,
 * `slendro`, `nyamaropa`, `shruti`, maqam and dastgah sets (`bayati`,
 * `rast`, `saba`, `shur`, `homayoun`, `chahargah`) and raga intonations
 * (`yaman`, `bhairav`, `kafi`, `todi`, …); `dawg` lists them with
 * `/tuning list`. dawg checks every value when the song loads.
 */
export type TuningInput =
  | string
  | Readonly<{
      /** A library tuning, or a label for the table given here. */
      name?: string;
      /** Equal divisions of the octave, 1..128. */
      edo?: number;
      /** Ratios for degrees 1..n, the last the period: `["9/8", "5/4", "2/1"]`. */
      ratios?: readonly (string | number)[];
      /** Cents for degrees 1..n, the last the period: `[240, 480, 720, 960, 1200]`. */
      cents?: readonly number[];
      /** A Scala `.scl` file in the project, e.g. `"tunings/slendro.scl"`. */
      scl?: string;
      /** A Scala `.kbm` keyboard mapping in the project; it sets its own root and A4. */
      kbm?: string;
      /** A4 in Hz, 220..880, default 440. */
      ref?: number;
      /** Key of degree 0, `"D4"` or 62; default the song key's tonic in octave 4. */
      root?: Pitch;
      /** `linear` (default): one key per step. `nearest`: every key plays the step nearest its 12-TET pitch. */
      map?: "linear" | "nearest";
    }>;

/** A stored tuning: `root` is a MIDI number, `ratios` are strings. */
export type ScoreTuning = Readonly<{
  name?: string;
  edo?: number;
  ratios?: readonly string[];
  cents?: readonly number[];
  scl?: string;
  kbm?: string;
  ref?: number;
  root?: number;
  map?: "linear" | "nearest";
}>;

const TUNING_FIELDS: readonly string[] = Object.freeze([
  "name",
  "edo",
  "ratios",
  "cents",
  "scl",
  "kbm",
  "ref",
  "root",
  "map",
]);

/** Checks a tuning's shape; dawg validates the values when the song loads. */
function tuningSpec(
  input: TuningInput | null | undefined,
  where: string,
): ScoreTuning | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") {
    if (input.trim() === "")
      throw new DawgSdkError(`${where} tuning must be a name or an object`);
    return Object.freeze({ name: input.trim() });
  }
  if (!isRecord(input))
    throw new DawgSdkError(`${where} tuning must be a name or an object`);
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (!TUNING_FIELDS.includes(field))
      throw new DawgSdkError(
        `${where} tuning has an unknown field "${field}" (use ${TUNING_FIELDS.join(", ")})`,
      );
    if (value === undefined || value === null) continue;
    if (field === "root") out.root = midi(value as Pitch);
    else if (field === "ratios" || field === "cents") {
      if (!Array.isArray(value))
        throw new DawgSdkError(`${where} tuning ${field} must be a list`);
      out[field] = Object.freeze(
        field === "ratios" ? value.map((ratio) => String(ratio)) : [...value],
      );
    } else out[field] = value;
  }
  const sources = ["edo", "ratios", "cents", "scl"].filter(
    (field) => out[field] !== undefined,
  );
  if (sources.length > 1)
    throw new DawgSdkError(
      `${where} tuning has ${sources.join(" and ")}; give one table`,
    );
  return Object.freeze(out as ScoreTuning);
}

// ---------------------------------------------------------------------------
// Chords

/** Options shared by `chord()` and `progression()`. */
export type ChordOptions = Readonly<{
  /** Voicing dial: each step moves the lowest note up an octave (negative: the highest down), -12..12. */
  voicing?: number;
  /** `close` (default), `open` (drop 2) or `wide` (drop 2 and 4). */
  spread?: "close" | "open" | "wide";
  /** `block` (default), `strum-up`, `strum-down`, `arp-up`, `arp-down`, `arp-updown`, `arp-random`, `harp`, `slop`, `pattern` (SDK 1.7.0). */
  perform?:
    | "block"
    | "strum-up"
    | "strum-down"
    | "arp-up"
    | "arp-down"
    | "arp-updown"
    | "arp-random"
    | "harp"
    | "slop"
    | "pattern";
  /**
   * With `perform: "pattern"`: a rhythm pattern by name or 1-based number
   * (SDK 1.7.0): `eighths`, `sixteenths`, `offbeat`, `pop`, `charleston`,
   * `bossa`, `skank`, `gallop`, `half-time`, `tresillo`, `oom-pah`, `roll`,
   * `pick`. Default 1.
   */
  pattern?: string | number;
  /** Arpeggio step in beats, default 0.25. */
  rate?: number;
  /** Arpeggio/harp octaves 1..4, default 1. */
  octaves?: number;
  /** Strum gap between voices in beats, default 1/32. */
  strum?: number;
  /** Seed for `arp-random`, default 0. */
  seed?: number;
  /** Velocity, default 0.8. */
  vel?: number;
  /** Lowest root position: the root lands at or above this pitch, default C4. */
  anchor?: Pitch;
  /** `chords` (default), `bass` (root or slash bass in octave 2, one per chord) or `both`. */
  part?: "chords" | "bass" | "both";
  /**
   * Orchid bass mode (SDK 1.7.0; overrides `part`): `off` (chords only),
   * `chords` and `single` (chords plus root or slash bass), `unison`
   * (chords plus the chord's root, ignoring a slash) or `solo` (bass only).
   */
  bass?: "off" | "chords" | "unison" | "single" | "solo";
}>;

/** Options for `progression()`. */
export type ProgressionOptions = ChordOptions &
  Readonly<{
    /** Key the numerals read in: `"C major"`, `"a minor"`, `"F# dorian"`; default C major. */
    key?: string;
    /** Beat of the first chord, default 0. */
    from?: number;
    /** Beats per chord, default 4. */
    each?: number;
    /** Voice-lead each chord to the inversion nearest the previous, default true. */
    lead?: boolean;
  }>;

/**
 * One chord from a symbol (`"Cm7"`, `"F#dim"`, `"Bbmaj9"`, `"G7sus4"`,
 * `"C/E"`) as notes from `start` for `length` beats.
 *
 * ```ts
 * notes: [...chord("Am7", 0, 4), ...chord("D9", 4, 4, { perform: "strum-up" })]
 * ```
 */
export function chord(
  symbol: string,
  start = 0,
  length = 4,
  options: ChordOptions = {},
): readonly NoteSpec[] {
  if (typeof symbol !== "string" || parseChord(symbol) === undefined)
    throw new DawgSdkError(`unknown chord symbol ${JSON.stringify(symbol)}`);
  return progression([symbol], {
    ...options,
    from: start,
    each: length,
    lead: false,
  });
}

/**
 * A voice-led progression: roman numerals in `key` (`"ii7"`, `"V"`,
 * `"bVII"`, `"V/V"`) or chord symbols, as an array or a space-separated
 * string, one chord per `each` beats from `from`. Each chord takes the
 * inversion nearest the previous one, so common tones hold. Same input,
 * same notes; dawg's play mode and agent tools use the same engine.
 *
 * ```ts
 * notes: progression("ii7 V7 Imaj7 Imaj7", { key: "C major", perform: "arp-up", rate: 0.5 })
 * notes: progression(["i", "VI", "III", "VII"], { key: "a minor", part: "bass" })
 * ```
 */
export function progression(
  chords: string | readonly string[],
  options: ProgressionOptions = {},
): readonly NoteSpec[] {
  const symbols =
    typeof chords === "string" ? chords.trim().split(/\s+/) : [...chords];
  if (symbols.length === 0 || symbols.length > 256 || symbols[0] === "")
    throw new DawgSdkError("progression needs 1..256 chords");
  const key = parseKey(options.key ?? "C major");
  if (!key)
    throw new DawgSdkError(`unknown key ${JSON.stringify(options.key)}`);
  const parsed = symbols.map((symbol) => {
    const value =
      typeof symbol === "string" ? resolveChord(key, symbol) : undefined;
    if (!value)
      throw new DawgSdkError(
        `unknown chord ${JSON.stringify(symbol)} (roman numeral or symbol)`,
      );
    return value;
  });
  const from = beat(options.from ?? 0, "progression from");
  const each = positive(options.each ?? 4, "progression each");
  const vel = unit(options.vel ?? DEFAULT_VELOCITY, "chord vel");
  const voicing = finite(options.voicing ?? 0, "chord voicing");
  const spread = options.spread ?? "close";
  if (!(SPREADS as readonly string[]).includes(spread))
    throw new DawgSdkError('chord spread must be "close", "open" or "wide"');
  const mode = options.perform ?? "block";
  if (!(PERFORM_MODES as readonly string[]).includes(mode))
    throw new DawgSdkError(`unknown chord perform ${JSON.stringify(mode)}`);
  if (
    options.bass !== undefined &&
    !(BASS_MODES as readonly string[]).includes(options.bass)
  )
    throw new DawgSdkError(
      `chord bass must be one of ${BASS_MODES.map((m) => JSON.stringify(m)).join(", ")}`,
    );
  if (options.pattern !== undefined && !findChordPattern(options.pattern))
    throw new DawgSdkError(
      `unknown chord pattern ${JSON.stringify(options.pattern)} (1..${CHORD_PATTERNS.length} or ${CHORD_PATTERNS.map((p) => p.name).join(", ")})`,
    );
  const part =
    options.bass === undefined
      ? (options.part ?? "chords")
      : options.bass === "off"
        ? "chords"
        : options.bass === "solo"
          ? "bass"
          : "both";
  if (part !== "chords" && part !== "bass" && part !== "both")
    throw new DawgSdkError('chord part must be "chords", "bass" or "both"');
  const rendered = renderProgression({
    key,
    chords: parsed,
    beatsPerChord: each,
    start: from,
    inversion: voicing,
    spread,
    bass: part !== "chords",
    ...(options.bass === "unison" ? { bassMode: "unison" as const } : {}),
    lead: options.lead ?? true,
    anchor: midi(options.anchor ?? 60),
    perform: {
      mode,
      rate: positive(options.rate ?? DEFAULT_ARP_RATE, "chord rate"),
      octaves: finite(options.octaves ?? 1, "chord octaves"),
      ...(options.strum !== undefined
        ? { strum: beat(options.strum, "chord strum") }
        : {}),
      seed: finite(options.seed ?? 0, "chord seed"),
      ...(options.pattern !== undefined ? { pattern: options.pattern } : {}),
      velocity: vel,
    },
  });
  const out = [
    ...(part === "bass" ? [] : rendered.notes),
    ...(part === "chords" ? [] : rendered.bass),
  ];
  if (out.length > 4096)
    throw new DawgSdkError("progression would produce over 4096 notes");
  return Object.freeze(
    out.map((n) => note(n.pitch, round(n.start), n.length, n.velocity)),
  );
}

// BEGIN instrument words: generated from core/instruments.ts by core/sdk/sync-instruments.ts
/** What an instrument word stores on a track. */
type InstrumentWord = Readonly<{
  /** The `Track.instrument` value. */
  instrument: string;
  /** The optional Track field the engine reads (created with defaults). */
  field?: string;
  /** A preset of that engine to apply. */
  preset?: string;
  /** An insert-effect preset to apply with it (rig aliases). */
  fx?: string;
}>;

/** A word and what it means. */
type InstrumentWordRow = Readonly<{ word: string }> & InstrumentWord;

/**
 * Words that keep their pre-0.6 meaning forever: they resolve to
 * themselves, whatever rows the lanes add.
 */
const LEGACY_WORDS: readonly string[] = Object.freeze([
  "piano",
  "pluck",
  "bass",
  "saw",
  "square",
  "triangle",
  "marimba",
  "wind",
  "cello",
  "contrabass",
  "ebass",
  "sitar",
  "organ",
  "strings",
  "bell",
  "keys",
  "lead",
]);

/** 0.6 instrument words; each lane appends its own block. */
const INSTRUMENT_WORDS: readonly InstrumentWordRow[] = Object.freeze([
  // strings (f06-strings): plucked presets of the string engine. Legacy
  // sitar/ebass keep today's voice (`string preset sitar` reaches the
  // engine), jangle is the rig alias (the guitar lane maps its 12string to the
  // preset; `string jangle` reaches it) and
  // upright is the keys lane's piano (doublebass reaches the preset).
  { word: "nylon", instrument: "string", field: "string", preset: "nylon" },
  { word: "steel", instrument: "string", field: "string", preset: "steel" },
  {
    word: "electric",
    instrument: "string",
    field: "string",
    preset: "electric",
  },
  { word: "slap", instrument: "string", field: "string", preset: "slap" },
  { word: "motown", instrument: "string", field: "string", preset: "motown" },
  { word: "tanpura", instrument: "string", field: "string", preset: "tanpura" },
  {
    word: "harpsichord",
    instrument: "string",
    field: "string",
    preset: "harpsichord",
  },
  { word: "lute", instrument: "string", field: "string", preset: "lute" },
  { word: "oud", instrument: "string", field: "string", preset: "oud" },
  { word: "setar", instrument: "string", field: "string", preset: "setar" },
  { word: "tar", instrument: "string", field: "string", preset: "tar" },
  { word: "santur", instrument: "string", field: "string", preset: "santur" },
  {
    word: "dulcimer",
    instrument: "string",
    field: "string",
    preset: "dulcimer",
  },
  { word: "koto", instrument: "string", field: "string", preset: "koto" },
  { word: "harp", instrument: "string", field: "string", preset: "harp" },
  { word: "banjo", instrument: "string", field: "string", preset: "banjo" },
  { word: "tres", instrument: "string", field: "string", preset: "tres" },
  {
    word: "requinto",
    instrument: "string",
    field: "string",
    preset: "requinto",
  },
  { word: "acoustic", instrument: "string", field: "string", preset: "steel" },
  { word: "classical", instrument: "string", field: "string", preset: "nylon" },
  {
    word: "bassguitar",
    instrument: "string",
    field: "string",
    preset: "ebass",
  },
  { word: "fender", instrument: "string", field: "string", preset: "ebass" },
  {
    word: "doublebass",
    instrument: "string",
    field: "string",
    preset: "upright",
  },
  {
    word: "cembalo",
    instrument: "string",
    field: "string",
    preset: "harpsichord",
  },
  {
    word: "hammered",
    instrument: "string",
    field: "string",
    preset: "dulcimer",
  },
  { word: "sehtar", instrument: "string", field: "string", preset: "setar" },
]);

/**
 * What an instrument word means: a legacy word is itself, a row word is its
 * row, anything else is undefined (callers keep the word as typed).
 */
function resolveInstrumentWord(word: string): InstrumentWord | undefined {
  if (LEGACY_WORDS.includes(word)) return Object.freeze({ instrument: word });
  const row = INSTRUMENT_WORDS.find((entry) => entry.word === word);
  if (!row) return undefined;
  const { word: _word, ...meaning } = row;
  return Object.freeze(meaning);
}

/** The `Track.instrument` value a word stores (the word itself if unknown). */
function instrumentForWord(word: string): string {
  return resolveInstrumentWord(word)?.instrument ?? word;
}
// END instrument words

// BEGIN chord engine: generated from core/chords.ts by core/sdk/sync-chords.ts
// ---------------------------------------------------------------------------
// Vocabulary

/** The four Orchid chord-type buttons. */
const CHORD_TYPES = ["dim", "min", "maj", "sus"] as const;
type ChordType = (typeof CHORD_TYPES)[number];

/** The four Orchid extension buttons. */
const EXTENSIONS = ["6", "m7", "M7", "9"] as const;
type Extension = (typeof EXTENSIONS)[number];

/** Triad qualities: the four buttons plus dawg's two-button combinations. */
const QUALITIES = [
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
type Quality = (typeof QUALITIES)[number];

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
const COMBINED_TYPES: Readonly<Record<string, Quality>> = Object.freeze({
  "dim+sus": "5",
  "maj+sus": "aug",
  "min+sus": "madd4",
  "dim+min": "mb6",
  "dim+maj": "b6",
  "maj+min": "7#9",
});

/** Quality for a set of held chord-type buttons, or undefined for none. */
function qualityOf(types: Iterable<ChordType>): Quality | undefined {
  const held = [...new Set(types)].sort();
  if (held.length === 0) return undefined;
  if (held.length === 1) return held[0] === "sus" ? "sus4" : held[0]!;
  return COMBINED_TYPES[held.slice(0, 2).join("+")] ?? "maj";
}

/** A chord: root pitch class, triad quality, extensions, optional bass. */
type Chord = Readonly<{
  /** 0..11, C = 0. */
  root: number;
  quality: Quality;
  extensions: readonly Extension[];
  /** Slash bass pitch class, when not the root. */
  bass?: number | undefined;
}>;

function makeChord(
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
function chordIntervals(chord: Chord): number[] {
  const set = new Set(QUALITY_INTERVALS[chord.quality]);
  for (const ext of chord.extensions) set.add(EXTENSION_INTERVAL[ext]);
  // m7 and M7 together keep both; 6 with m7 on a dim triad is the dim7's bb7.
  return [...set].sort((a, b) => a - b);
}

/** Pitch classes of the chord (bass excluded), root first. */
function chordPitchClasses(chord: Chord): number[] {
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
function noteName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!;
}

const SECRET_SUFFIX: Readonly<Partial<Record<Quality, string>>> = Object.freeze(
  { madd4: "m(add4)", mb6: "m(b6)", b6: "(b6)", "7#9": "7#9" },
);

/** Chord symbol suffix: `m7`, `maj9`, `7sus4`, `dim7`, `m7b5`, `6/9`. */
function chordSuffix(chord: Chord): string {
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
function chordName(chord: Chord, flats = false): string {
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
function parsePitchClass(text: string): number | undefined {
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
function parseChord(symbol: string): Chord | undefined {
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

const MODES = Object.freeze({
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
type ModeName = keyof typeof MODES;
const MODE_NAMES = Object.keys(MODES) as ModeName[];

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

type ScaleFamily =
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
type ScaleInfo = Readonly<{
  steps: readonly number[];
  mode: ModeName;
  family: ScaleFamily;
  intonation?: readonly number[];
  aliases?: readonly string[];
}>;

const SCALES = Object.freeze({
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
type ScaleName = keyof typeof SCALES;
const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

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
function scaleNamed(text: string): ScaleName | undefined {
  const word = text.trim().toLowerCase().replace(/\s+/g, " ");
  return SCALE_ALIASES[word] ?? SCALE_ALIASES[word.replace(/ /g, "-")];
}

/**
 * A key: a tonic and the seven-note `mode` the chord engine uses, plus the
 * library `scale` when the key names one (`D bayati`, `C yaman`).
 */
type Key = Readonly<{
  tonic: number;
  mode: ModeName;
  scale?: ScaleName;
}>;

/**
 * Parse a key: `C`, `c major`, `Am`, `a minor`, `F# dorian`, `Eb mixo`,
 * `D bayati`, `C messiaen-3`. Accepts the `<note> <mode>` form
 * `core/key.ts` writes.
 */
function parseKey(text: string | null | undefined): Key | undefined {
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
function scaleSteps(key: Key): number[] {
  return [...(key.scale ? SCALES[key.scale].steps : MODES[key.mode])];
}

/** True when names in the key read better with flats (F, Bb, Eb, d minor…). */
function keyUsesFlats(key: Key): boolean {
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
function keyName(key: Key): string {
  return `${noteName(key.tonic, keyUsesFlats(key))} ${key.scale ?? key.mode}`;
}

/** Pitch classes of the key's scale, tonic first. */
function scaleOf(key: Key): number[] {
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
function diatonicChord(key: Key, degree: number, sevenths = false): Chord {
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
function diatonicChords(key: Key, sevenths = false): Chord[] {
  return Array.from({ length: 7 }, (_, degree) =>
    diatonicChord(key, degree, sevenths),
  );
}

/** Scale degree (0-based) of a pitch class, or undefined when not in key. */
function degreeOf(key: Key, pc: number): number | undefined {
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
function keyModeChord(
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
function manualChord(
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
function romanOf(key: Key, chord: Chord): string {
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
function parseRoman(key: Key, text: string): Chord | undefined {
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
const VOICING_RANGE = Object.freeze({ low: 48, high: 79 });
/** Voicing dial: Orchid-style rotation steps, -12..12. */
const MAX_VOICING_STEP = 12;
const SPREADS = ["close", "open", "wide"] as const;
type Spread = (typeof SPREADS)[number];

type VoicingOptions = Readonly<{
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
function rotate(pitches: readonly number[], steps: number): number[] {
  const notes = [...pitches].sort((a, b) => a - b);
  if (notes.length === 0) return notes;
  for (let i = 0; i < Math.abs(Math.trunc(steps)); i += 1) {
    if (steps > 0) notes.push(notes.shift()! + 12);
    else notes.unshift(notes.pop()! - 12);
  }
  return notes;
}

function rootPosition(chord: Chord, anchor = 60): number[] {
  const rootPitch = anchor + mod12(chord.root - anchor);
  return chordIntervals(chord).map((step) => rootPitch + step);
}

/** Open voicings: `open` drops the second voice from the top an octave
 * (drop 2); `wide` also drops the fourth from the top (drop 2+4). */
function applySpread(pitches: readonly number[], spread: Spread): number[] {
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
function movement(a: readonly number[], b: readonly number[]): number {
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
function voiceChord(chord: Chord, options: VoicingOptions = {}): number[] {
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
function bassNote(chord: Chord, low = 36): number {
  return low + mod12((chord.bass ?? chord.root) - low);
}

/**
 * Orchid's bass behaviours (manual 10.2 and the "How to use Bass" article),
 * plus `off`. Labels in BASS_MODE_TEXT; `chords` is Orchid's default
 * "Chords Only".
 */
const BASS_MODES = ["off", "chords", "unison", "single", "solo"] as const;
type BassMode = (typeof BASS_MODES)[number];

const BASS_MODE_TEXT: Readonly<Record<BassMode, string>> = {
  off: "no bass",
  chords: "bass root under chords only",
  unison: "bass doubles single notes; root under chords",
  single: "single notes play bass only; chords play treble and root",
  solo: "bass only: the treble is muted, even for chords",
};

/** What one key press sounds once the bass mode has routed it. */
type BassRoute = Readonly<{
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
function routeBass(
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

function parseBassMode(value: string | undefined): BassMode | undefined {
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

const PERFORM_MODES = [
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
type PerformMode = (typeof PERFORM_MODES)[number];

type PerformOptions = Readonly<{
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

type PerformedNote = Readonly<{
  pitch: number;
  /** Beats. */
  start: number;
  length: number;
  velocity: number;
}>;

const DEFAULT_ARP_RATE = 0.25;
const DEFAULT_STRUM = 1 / 32;
const DEFAULT_SLOP = 0.5;
/** Latest a slopped voice can land, in beats, at slop 1. */
const MAX_SLOP = 1 / 8;

// ---------------------------------------------------------------------------
// Patterns

/**
 * One hit of a chord pattern. `voices` picks chord tones by index, low to
 * high: `all`, `upper` (all but the lowest), or a list where an index past
 * the top wraps an octave up (index 3 of a triad is the root +12) and a
 * negative index counts down from the top (-1 is the highest voice).
 */
type PatternHit = Readonly<{
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

type ChordPattern = Readonly<{
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
const CHORD_PATTERNS: readonly ChordPattern[] = Object.freeze([
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
function findChordPattern(
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
function perform(
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
type ProgressionPreset = Readonly<{
  name: string;
  mode: "major" | "minor" | "dorian" | "mixolydian";
  numerals: readonly string[];
  /** Use diatonic sevenths. */
  sevenths?: boolean;
  description: string;
}>;

const PROGRESSION_PRESETS: readonly ProgressionPreset[] = Object.freeze([
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

const PROGRESSION_STYLES = ["pop", "jazz", "modal", "classical"] as const;
type ProgressionStyle = (typeof PROGRESSION_STYLES)[number];

/**
 * Functional-harmony transition weights between scale degrees (0 = I),
 * per style. Tonic (I, vi, iii) moves to predominant (IV, ii), which moves
 * to dominant (V, vii°), which resolves to tonic; pop adds the plagal and
 * vi–IV moves, jazz favours the cycle of fifths, modal keeps to the tonic
 * and its neighbours.
 */
const TRANSITIONS: Readonly<
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
function mulberry32(seed: number): () => number {
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

function findPreset(name: string): ProgressionPreset | undefined {
  const wanted = name.trim().toLowerCase();
  return PROGRESSION_PRESETS.find((preset) => preset.name === wanted);
}

/** The next degree the graph favours most after `degree` (no randomness). */
function likelyNext(degree: number, style: ProgressionStyle = "pop"): number {
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
function suggestNext(
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
function presetChords(key: Key, preset: ProgressionPreset): Chord[] {
  return preset.numerals.map((numeral) => {
    const chord = parseRoman(key, numeral);
    if (!chord) throw new Error(`bad preset numeral ${numeral}`);
    if (!preset.sevenths || chord.extensions.length > 0) return chord;
    const withSeventh = parseRoman(key, `${numeral}7`);
    return withSeventh ?? chord;
  });
}

type ProgressionRequest = Readonly<{
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
function generateProgression(request: ProgressionRequest): Chord[] {
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
type VoicedChord = Readonly<{
  name: string;
  roman: string;
  pitches: readonly number[];
  bass?: number | undefined;
}>;

/** Voice a progression with minimal movement chord to chord. */
function voiceProgression(
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
function resolveChord(key: Key, text: string): Chord | undefined {
  return parseRoman(key, text) ?? parseChord(text);
}

type RenderOptions = Readonly<{
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

type RenderedProgression = Readonly<{
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
function renderProgression(options: RenderOptions): RenderedProgression {
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
// END chord engine

// ---------------------------------------------------------------------------
// Internals

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new DawgSdkError(`${label} must be a finite number`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024)
    throw new DawgSdkError(`${label} must be a short string`);
  return value;
}

function beat(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number < 0) throw new DawgSdkError(`${label} must be ≥ 0 beats`);
  return number;
}

function positive(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number <= 0) throw new DawgSdkError(`${label} must be > 0`);
  return number;
}

function unit(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number < 0 || number > 1)
    throw new DawgSdkError(`${label} must be between 0 and 1`);
  return number;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new DawgSdkError(`${label} must be true or false`);
  return value;
}

/** Rounds away floating-point noise from repeated addition (1e-9 beats). */
function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** 64-bit FNV-1a over UTF-16 code units as 16 hex characters (two 32-bit lanes). */
function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((code * 31 + index) & 0xffff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
