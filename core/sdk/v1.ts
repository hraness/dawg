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
export const SDK_VERSION = "1.1.0";
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
