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
export const SDK_VERSION = "1.3.0";
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
}>;

/** A drum or sampler hit addressed by voice name; resolved to a pitch slot by `track()`. */
export type HitSpec = Readonly<{
  kind: "hit";
  voice: string;
  start: number;
  length: number;
  velocity: number;
}>;

/**
 * One note. `pitch` is a name or MIDI number, `start` and `length` are
 * beats, `velocity` defaults to 0.8.
 *
 * ```ts
 * note("A1", 0, 1)          // A1 on the downbeat for one beat
 * note("A1", 1.5, 0.5, 0.6) // off-beat eighth, softer
 * ```
 */
export function note(
  pitch: Pitch,
  start: number,
  length = 1,
  velocity = DEFAULT_VELOCITY,
): NoteSpec {
  return Object.freeze({
    kind: "note",
    pitch: midi(pitch),
    start: beat(start, "note start"),
    length: positive(length, "note length"),
    velocity: unit(velocity, "note velocity"),
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
 * to a sixteenth.
 */
export function hit(
  voice: string,
  start: number,
  velocity = DEFAULT_VELOCITY,
  length = DEFAULT_HIT_LENGTH,
): HitSpec {
  if (typeof voice !== "string" || voice.length === 0 || voice.length > 32)
    throw new DawgSdkError("hit voice must be a short name");
  return Object.freeze({
    kind: "hit",
    voice,
    start: beat(start, "hit start"),
    length: positive(length, "hit length"),
    velocity: unit(velocity, "hit velocity"),
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
  rotate?: number,
  options: RhythmOptions = {},
): RhythmSpec {
  if (isRecord(voice)) {
    const input = voice as RhythmOptions & { voice: string };
    return rhythmSpec(input.voice, input);
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
    out[name] = sample(voices[name]!, name);
  }
  return Object.freeze({ kind: "sampler", voices: Object.freeze(out), mode });
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
  const base = sample(src, prefix);
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

function sample(value: string | SampleSpec, name: string): SampleSpec {
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
  return Object.freeze(out);
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
}>;

/** Input to `track()`. Omitted fields keep dawg's defaults. */
export type TrackInput = Readonly<{
  /** Stable id dawg assigned; defaults to the slug of `name`. Keep it when editing. */
  id?: string;
  /** Shown in the header; its slug names `tracks/<slug>/`. */
  name: string;
  /**
   * Synth voice (`sine`, `piano`, `pluck`, `bass`, `saw`, `square`,
   * `triangle`), `kit` for drums, or `sampler(...)`. Default `sine`.
   */
  instrument?: string | SamplerSpec;
  muted?: boolean;
  /** When any track is soloed only soloed tracks play. */
  solo?: boolean;
  /** 0..1, default 1. */
  volume?: number;
  /** -1 (left) .. 1 (right), default 0. */
  pan?: number;
  /** Low-pass filter; `null` or omitted means none. */
  filter?: Readonly<{ cutoff: number; resonance?: number }> | null;
  /** Tempo-synced ping-pong delay send in beats. */
  delay?: Readonly<{ beats: number; feedback?: number; mix?: number }> | null;
  /** Stereo reverb send. */
  reverb?: Readonly<{ mix: number; size?: number }> | null;
  automation?: AutomationInput;
  /** `note()`/`seq()` for pitched tracks, `hit()`/`hits()` for kits and one-shot samplers. */
  notes?: readonly (NoteSpec | HitSpec)[];
  /**
   * Generated voices, one row per voice: `euclid()`/`grid()`. dawg expands
   * them into hits when the song loads; a row owns its voice, so `notes`
   * on the same voice are replaced.
   */
  rhythm?: readonly RhythmSpec[];
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
  filter: Readonly<{ cutoff: number; resonance: number }> | null;
  delay: Readonly<{ beats: number; feedback: number; mix: number }> | null;
  reverb: Readonly<{ mix: number; size: number }> | null;
  sampler: SamplerSpec | null;
  automation: Readonly<Required<AutomationInput>>;
  /** Every hit resolved to its pitch slot. */
  notes: readonly NoteSpec[];
  /** Rhythm rows in order (voice names as written). */
  rhythm: readonly RhythmSpec[];
}>;

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
  const instrument = samplerSpec
    ? SAMPLER_INSTRUMENT
    : typeof rawInstrument === "string"
      ? rawInstrument
      : undefined;
  if (
    instrument === undefined ||
    instrument.length === 0 ||
    instrument.length > 64
  )
    throw new DawgSdkError(
      `track ${name}: instrument must be a voice name, "kit" or sampler(...)`,
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
    return Object.freeze({
      kind: "note" as const,
      pitch,
      start: spec.start,
      length: spec.length,
      velocity: spec.velocity,
    });
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
  const automation = input.automation ?? {};
  if (!isRecord(automation))
    throw new DawgSdkError(`track ${name}: automation must be an object`);
  const lane = (key: keyof AutomationInput): readonly Point[] => {
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
        });
  const reverb =
    input.reverb === undefined || input.reverb === null
      ? null
      : Object.freeze({
          mix: finite(input.reverb.mix, `${name} reverb.mix`),
          size: finite(input.reverb.size ?? 0.5, `${name} reverb.size`),
        });
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
    sampler: samplerSpec,
    automation: Object.freeze({
      volume: lane("volume"),
      pan: lane("pan"),
      filter: lane("filter"),
      resonance: lane("resonance"),
      delayFeedback: lane("delayFeedback"),
      delayMix: lane("delayMix"),
    }),
    notes: Object.freeze(notes),
    rhythm: Object.freeze([...rhythm]),
  });
}

const AUTOMATION_KEYS: readonly (keyof AutomationInput)[] = Object.freeze([
  "volume",
  "pan",
  "filter",
  "resonance",
  "delayFeedback",
  "delayMix",
]);

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
  /** `[beatsPerBar, noteValue]` or just `beatsPerBar`; default `[4, 4]`. Only the numerator is stored. */
  meter?: readonly [number, number] | number;
  /** Loop length in bars, 1..256, default 4. */
  bars?: number;
  /** Free text such as `"A minor"`, or null. */
  key?: string | null;
  /** Integer ticks per beat, default 480. Leave it alone unless you know why. */
  ticksPerBeat?: number;
  /** Tracks in score order; each from `track()`. */
  tracks: readonly TrackSpec[];
}>;

/** A stored note: integer ticks. */
export type ScoreNote = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
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
  filter?: Readonly<{ cutoff: number; resonance: number }>;
  delay?: Readonly<{ beats: number; feedback: number; mix: number }>;
  filterAutomation?: readonly ScorePoint[];
  resonanceAutomation?: readonly ScorePoint[];
  delayFeedbackAutomation?: readonly ScorePoint[];
  delayMixAutomation?: readonly ScorePoint[];
  reverb?: Readonly<{ mix: number; size: number }>;
  sampler?: Readonly<{
    voices: Readonly<Record<string, ScoreSampleRef>>;
    mode: "oneshot" | "keyed";
  }>;
  /** Rhythm rows without `kind`; dawg validates and expands them. */
  rhythm?: readonly Readonly<Record<string, unknown>>[];
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
  tracks: readonly ScoreTrack[];
  notes: readonly ScoreNote[];
}>;

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
  if (Array.isArray(meter)) finite(meter[1], "song meter[1]");
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
    if (t.sampler)
      stored.sampler = Object.freeze({
        voices: t.sampler.voices,
        mode: t.sampler.mode,
      });
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
        }),
      );
    }
  });
  return Object.freeze({
    format: "track.loop/v1",
    version: 1,
    tempoBpm,
    beatsPerBar,
    bars,
    ticksPerBeat,
    key,
    tracks: Object.freeze(tracks),
    notes: Object.freeze(notes),
  });
}

// ---------------------------------------------------------------------------
// Chords

/** Options shared by `chord()` and `progression()`. */
export type ChordOptions = Readonly<{
  /** Voicing dial: each step moves the lowest note up an octave (negative: the highest down), -12..12. */
  voicing?: number;
  /** `close` (default), `open` (drop 2) or `wide` (drop 2 and 4). */
  spread?: "close" | "open" | "wide";
  /** `block` (default), `strum-up`, `strum-down`, `arp-up`, `arp-down`, `arp-updown`, `arp-random`, `harp`. */
  perform?:
    | "block"
    | "strum-up"
    | "strum-down"
    | "arp-up"
    | "arp-down"
    | "arp-updown"
    | "arp-random"
    | "harp";
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
  const part = options.part ?? "chords";
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
const QUALITIES = ["maj", "min", "dim", "sus4", "aug", "sus2", "5"] as const;
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
  });

const EXTENSION_INTERVAL: Readonly<Record<Extension, number>> = Object.freeze({
  "6": 9,
  m7: 10,
  M7: 11,
  "9": 14,
});

/**
 * dawg's resolution of two chord-type buttons held together (Orchid has
 * "secret chords" from button combinations; its table is not published).
 */
const COMBINED_TYPES: Readonly<Record<string, Quality>> = Object.freeze({
  "dim+maj": "aug",
  "maj+sus": "sus2",
  "maj+min": "5",
  "dim+min": "dim",
  "dim+sus": "sus2",
  "min+sus": "sus2",
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
  const ext = EXTENSIONS.filter((value) => new Set(extensions).has(value));
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
});

type Key = Readonly<{ tonic: number; mode: ModeName }>;

/**
 * Parse a key: `C`, `c major`, `Am`, `a minor`, `F# dorian`, `Eb mixo`.
 * Accepts the `<note> <mode>` form `core/key.ts` writes.
 */
function parseKey(text: string | null | undefined): Key | undefined {
  if (typeof text !== "string" || text.length > 40) return undefined;
  const match = text
    .trim()
    .match(/^([a-gA-G])(#|b|♯|♭)?\s*(m(?![a-z])|[a-zA-Z][a-zA-Z -]*)?$/);
  if (!match) return undefined;
  const tonic = parsePitchClass(`${match[1]}${match[2] ?? ""}`);
  const word = (match[3] ?? "").trim();
  const mode = MODE_ALIASES[word === "m" ? "m" : word.toLowerCase()];
  if (tonic === undefined || mode === undefined) return undefined;
  return Object.freeze({ tonic, mode });
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
  };
  const parent = mod12(key.tonic - parentOffset[key.mode]);
  return [5, 10, 3, 8, 1].includes(parent);
}

/** `C major`, `F# dorian`, `Bb minor`. */
function keyName(key: Key): string {
  return `${noteName(key.tonic, keyUsesFlats(key))} ${key.mode}`;
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
    chord.quality === "min" || chord.quality === "dim" || chord.quality === "5"
      ? true
      : false;
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
  /** Seed for arp-random. */
  seed?: number;
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

/**
 * Lay a voiced chord out in time over [start, start + length). Block holds
 * every voice; strums offset voices by `strum` beats and hold to the end;
 * arpeggios step one voice per `rate` beats across `octaves`, aligned to
 * multiples of `rate` from `start`; harp is an upward strum across the
 * octaves that rings to the end.
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
  voiced.forEach((chord, index) => {
    const at = start + index * span;
    notes.push(
      ...perform(chord.pitches, at, span, {
        ...options.perform,
        seed: (options.perform?.seed ?? 0) + index,
      }),
    );
    if (options.bass && chord.bass !== undefined)
      bass.push({
        pitch: chord.bass,
        start: round6(at),
        length: round6(span),
        velocity,
      });
  });
  return {
    voiced: options.bass
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
