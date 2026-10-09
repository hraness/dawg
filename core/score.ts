/**
 * The small, JSON-safe score model shared by the dawg daemon and clients.
 *
 * Score time is expressed in integer ticks. A loop uses `ticksPerBeat` ticks
 * per beat; keeping this unit explicit means a transport can change tempo
 * without rewriting the score.
 */

import { normalizeRhythmRow, RHYTHM_LIMITS, type RhythmRow } from "./euclid.ts";
import { isDrumInstrument } from "./drums.ts";
import { synthKit, SYNTH_KIT_NAMES } from "./kits.ts";

export type { RhythmRow } from "./euclid.ts";
import {
  FX_LANES,
  FxValidationError,
  normalizeFx,
  normalizeParams,
  TRACK_EFFECT_SPECS,
  type FxLane,
  type TrackFx,
} from "./fx.ts";
import { normalizeSynth, type TrackSynth } from "./synth.ts";
import {
  checkSongTime,
  normalizeSongTime,
  normalizeTrackTime,
  TimeValidationError,
  type SongTime,
  type TrackTime,
  withMeterChange,
} from "./tempo.ts";
import {
  ExpressionValidationError,
  normalizeNoteExpression,
  normalizeTrackPerformance,
  type NoteExpression,
  type NoteExpressionPatch,
  type TrackPerformance,
} from "./expression.ts";
import {
  normalizeNoteCents,
  normalizeTuning,
  TuningError,
  type Tuning,
} from "./tuning.ts";

export type { Tuning } from "./tuning.ts";
import { normalizeMaster, type SongMaster } from "./master.ts";

export const SCORE_VERSION = 1 as const;
export const DEFAULT_TICKS_PER_BEAT = 480 as const;

export const SCORE_LIMITS = Object.freeze({
  maxTracks: 64,
  maxNotes: 4096,
  maxIdLength: 64,
  maxNameLength: 96,
  maxInstrumentLength: 64,
  maxAutomationPoints: 256,
  maxVolume: 1,
  maxTempoBpm: 300,
  minTempoBpm: 20,
  maxBars: 256,
  /** Song sections (0.5): named bar ranges and the form that orders them. */
  maxSections: 64,
  maxSectionNameLength: 32,
  maxFormEntries: 128,
  maxFormRepeat: 16,
  maxSectionTranspose: 24,
  maxSectionGain: 2,
  maxBeatsPerBar: 16,
  maxTicksPerBeat: 4096,
  maxTick: 1_000_000,
  minFilterCutoff: 20,
  maxFilterCutoff: 20_000,
  maxFilterResonance: 1,
  minDelayBeats: 0.0625,
  maxDelayBeats: 4,
  maxDelayFeedback: 0.9,
  maxDelayMix: 1,
  maxReverbMix: 1,
  minReverbSize: 0,
  maxReverbSize: 1,
  /** Automation lanes kept in `fxAutomation` per track. */
  maxFxLanes: 64,
  /** Sampler voices per track (score v2, `sampler` field). */
  maxSamplerVoices: 64,
  maxSamplerVoiceNameLength: 32,
  maxSamplePathLength: 256,
  maxSampleUrlLength: 1024,
  maxSampleGain: 2,
  /** |speed| bound; negative speeds play in reverse. */
  maxSampleSpeed: 8,
  maxChokeGroupLength: 32,
  /** Sampler `clip`/`legato` factor bound. */
  maxSampleClip: 16,
  /** |accelerate| bound. */
  maxSampleAccelerate: 8,
  /** Sampler `squiz` ratio bound. */
  maxSampleSquiz: 32,
  /** Per sample file, enforced by the decoder and the import tool. */
  maxSampleFileBytes: 50 * 1024 * 1024,
  maxSampleSeconds: 600,
  /**
   * In-memory decoded-sample budget. The disk caps (`.dawg/assets`, pack
   * downloads) live in `src/audio/cache.ts` and follow
   * `DAWG_ASSETS_CACHE_MAX` / `DAWG_PACKS_CACHE_MAX`.
   */
  maxSampleCacheBytes: 512 * 1024 * 1024,
} as const);

/** Instrument name that selects a track's `wavetable` oscillator. */
export const WAVETABLE_INSTRUMENT = "wavetable" as const;

/**
 * Warp modes (Strudel's documented `warpmode` names). Each bends the read
 * phase of the table; see `src/audio/wavetable.ts` for the exact maps.
 */
export const WARP_MODES = Object.freeze([
  "none",
  "asym",
  "bendp",
  "bendm",
  "bendmp",
  "sync",
  "quant",
] as const);
export type WarpMode = (typeof WARP_MODES)[number];

/** Prefix of a table generated in code (`builtin:basic`). */
export const BUILTIN_TABLE_PREFIX = "builtin:" as const;

/**
 * A track's wavetable oscillator, with Strudel's parameter names. Every
 * field but `table` is omitted at its default.
 */
export type TrackWavetable = Readonly<{
  /**
   * `builtin:<name>`, a pinned pack sound (`pack:uzu-wavetables/wt_digital:1`)
   * or a project WAV (`tracks/<slug>/wavetables/vox.wav`, sha256-pinned).
   */
  table: SampleRef;
  /** Position in the table, 0..1 (default 0). */
  wt?: number;
  /** Position envelope amount, -1..1 (default 0 = off). */
  wtenv?: number;
  /** Position envelope times in seconds and sustain level 0..1. */
  wtattack?: number;
  wtdecay?: number;
  wtsustain?: number;
  wtrelease?: number;
  /** Position LFO rate in Hz (0..50) and depth 0..1 (default 0 = off). */
  wtrate?: number;
  wtdepth?: number;
  /** Warp amount 0..1 and mode (default none). */
  warp?: number;
  warpmode?: WarpMode;
  /** Randomness of each note's start phase, 0..1 (seeded by the note). */
  wtphaserand?: number;
}>;

/** Strudel parameter name → [min, max, default] for wavetable numbers. */
export const WAVETABLE_PARAMS = Object.freeze({
  wt: [0, 1, 0],
  wtenv: [-1, 1, 0],
  wtattack: [0, 10, 0.01],
  wtdecay: [0, 10, 0.1],
  wtsustain: [0, 1, 1],
  wtrelease: [0, 10, 0.1],
  wtrate: [0, 50, 0],
  wtdepth: [0, 1, 0],
  warp: [0, 1, 0],
  wtphaserand: [0, 1, 0],
} as const satisfies Record<string, readonly [number, number, number]>);
export type WavetableParam = keyof typeof WAVETABLE_PARAMS;

const BUILTIN_TABLE = /^builtin:[a-z][a-z0-9_-]{0,31}$/;

/**
 * A project wavetable file: a project-relative `.wav` path (dawg writes them
 * to `tracks/<slug>/wavetables/<name>.wav`).
 */
export function isLocalTableSrc(src: string): boolean {
  return (
    !src.startsWith(PACK_PREFIX) &&
    !src.startsWith(BUILTIN_TABLE_PREFIX) &&
    /\.wav$/i.test(src) &&
    isSafeRelativePath(src)
  );
}

export function isWavetableInstrument(instrument: string | undefined): boolean {
  return (
    typeof instrument === "string" &&
    instrument.trim().toLowerCase() === WAVETABLE_INSTRUMENT
  );
}

/** The table a wavetable track plays: its own, else the built-in `basic`. */
export function wavetableOf(track: Track): TrackWavetable {
  return track.wavetable ?? DEFAULT_WAVETABLE;
}

export const DEFAULT_WAVETABLE: TrackWavetable = Object.freeze({
  table: Object.freeze({ src: `${BUILTIN_TABLE_PREFIX}basic` }),
});

export function normalizeWavetable(input: unknown): TrackWavetable | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track wavetable must be an object or null",
      "invalid-track",
    );
  const table = input.table;
  let ref: SampleRef;
  if (
    isRecord(table) &&
    typeof table.src === "string" &&
    table.src.startsWith(BUILTIN_TABLE_PREFIX)
  ) {
    if (!BUILTIN_TABLE.test(table.src) || Object.keys(table).length !== 1)
      throw new ScoreValidationError(
        "wavetable table builtin:<name> takes no other fields",
        "invalid-track",
      );
    ref = Object.freeze({ src: table.src });
  } else {
    ref = normalizeSampleRef(table, "wavetable table");
    if (!isPackRef(ref.src) && !isLocalTableSrc(ref.src))
      throw new ScoreValidationError(
        "wavetable table must be builtin:<name>, pack:<pack>/<sound>[:<n>] or a project .wav path",
        "invalid-track",
      );
  }
  const out: Record<string, unknown> = { table: ref };
  for (const name of Object.keys(WAVETABLE_PARAMS) as WavetableParam[]) {
    const value = input[name];
    if (value === undefined) continue;
    const [min, max, fallback] = WAVETABLE_PARAMS[name];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new ScoreValidationError(
        `wavetable ${name} must be a number ${min}..${max}`,
        "invalid-track",
      );
    const clamped = Math.max(min, Math.min(max, value));
    if (clamped !== fallback) out[name] = clamped;
  }
  if (input.warpmode !== undefined) {
    if (!WARP_MODES.includes(input.warpmode as WarpMode))
      throw new ScoreValidationError(
        `wavetable warpmode must be one of ${WARP_MODES.join(", ")}`,
        "invalid-track",
      );
    if (input.warpmode !== "none") out.warpmode = input.warpmode;
  }
  for (const key of Object.keys(input))
    if (
      key !== "table" &&
      key !== "warpmode" &&
      !Object.prototype.hasOwnProperty.call(WAVETABLE_PARAMS, key)
    )
      throw new ScoreValidationError(
        `wavetable has an unknown field ${key.slice(0, 32)}`,
        "invalid-track",
      );
  return Object.freeze(out) as TrackWavetable;
}

/** Instrument name that selects a track's `sampler`. */
export const SAMPLER_INSTRUMENT = "sampler" as const;

/** First pitch slot assigned to one-shot sampler voices (GM kick). */
export const SAMPLER_FIRST_SLOT = 36;

export class ScoreValidationError extends Error {
  readonly code:
    | "invalid-score"
    | "invalid-note"
    | "invalid-track"
    | "duplicate-note"
    | "duplicate-track"
    | "score-limit";

  constructor(
    message: string,
    code: ScoreValidationError["code"] = "invalid-score",
  ) {
    super(message);
    this.name = "ScoreValidationError";
    this.code = code;
  }
}

export type Track = Readonly<{
  id: string;
  name: string;
  instrument: string;
  muted: boolean;
  volume: number;
  pan: number;
  /** Volume control points in score ticks, sorted by tick. */
  volumeAutomation: readonly AutomationPoint[];
  /** Pan control points in score ticks, sorted by tick. */
  panAutomation: readonly AutomationPoint[];
  /**
   * Optional fields below are omitted when at their default so documents
   * written before they existed encode byte-for-byte the same.
   */
  /** When any track is soloed, only soloed (unmuted) tracks are audible. */
  solo?: boolean;
  /** Low-pass filter applied to the track before its delay send. */
  filter?: TrackFilter;
  /** Tempo-synced feedback delay send, mixed after the filter. */
  delay?: TrackDelay;
  /** Filter cutoff (Hz) control points in score ticks, sorted by tick. */
  filterAutomation?: readonly AutomationPoint[];
  /** Filter resonance (0..1) control points; overrides the static resonance. */
  resonanceAutomation?: readonly AutomationPoint[];
  /** Delay feedback (0..0.9) control points; overrides the static feedback. */
  delayFeedbackAutomation?: readonly AutomationPoint[];
  /** Delay wet mix (0..1) control points; overrides the static mix. */
  delayMixAutomation?: readonly AutomationPoint[];
  /** Algorithmic stereo reverb send, mixed after the delay. */
  reverb?: TrackReverb;
  /**
   * Optional: insert effects by name (`core/fx.ts`), each with every
   * parameter stored. Rendered in `FX_CHAIN` order.
   */
  fx?: TrackFx;
  /** Optional: automation for `fx` parameters, keyed `<effect>-<param>`. */
  fxAutomation?: Readonly<Partial<Record<FxLane, readonly AutomationPoint[]>>>;
  /**
   * Optional: synth voice parameters (`core/synth.ts`), Strudel names.
   * Only the parameters a document sets are stored; lanes are
   * `fxAutomation["synth-<param>"]`, read at note onsets.
   */
  synth?: TrackSynth;
  /**
   * Wavetable oscillator settings (Strudel names). Used when `instrument`
   * is `"wavetable"`; kept when the instrument changes so switching back
   * restores them. Absent means the built-in `basic` table at position 0.
   */
  wavetable?: TrackWavetable;
  /** Wavetable position (`wt`, 0..1) control points; overrides the static `wt`. */
  wtAutomation?: readonly AutomationPoint[];
  /**
   * Score v2: sample voices; present exactly when `instrument` is
   * `"sampler"`. Documents without it decode unchanged.
   */
  sampler?: Sampler;
  /**
   * Generated drum rows (Euclidean or grid, see `core/euclid.ts`). The notes
   * they generate are stored as ordinary notes; the rows are the editable
   * source for those voices. Absent when empty.
   */
  rhythm?: readonly RhythmRow[];
  /**
   * Synthesized drum kit for an `instrument: "kit"` track (`syn808`,
   * `lofi`, … see `core/kits.ts`). Absent plays the default voices.
   */
  kit?: string;
  /**
   * Track time against the song (`core/tempo.ts`): `rate` (tempo ratio),
   * `phase` (ticks the pattern shifts later) and `cycle` (track ticks per
   * repetition) for polytempo, polymeter and phasing. Absent follows the
   * song.
   */
  time?: TrackTime;
  /**
   * Tuning for this track (`core/tuning.ts`): its own table, or just a
   * `ref`/`root` over the song tuning. Absent follows the song tuning.
   */
  tuning?: Tuning;
}> &
  /**
   * Performance (`core/expression.ts`): glide default, sustain pedal
   * events, velocity curve and seeded humanize, all applied at render.
   */
  TrackPerformance;

/**
 * A track's sample voices (Strudel-aligned). In `oneshot` mode every voice is
 * a drum-like hit addressed by the pitch slot `samplerVoiceSlots` assigns
 * (36, 37, … in voice-name order); in `keyed` mode notes are ordinary pitches
 * and a voice is resampled from its `root`.
 */
export type Sampler = Readonly<{
  voices: Readonly<Record<string, SampleRef>>;
  mode: "oneshot" | "keyed";
}>;

export type SampleRef = Readonly<{
  /**
   * Project-relative path, normally `tracks/<slug>/samples/<file>`, or a
   * pack sound `pack:<pack>/<sound>[:<n>]` (`pack:tidal-drum-machines/RolandTR909_bd:0`).
   */
  src: string;
  /** Content hash (64 hex) when known; the decoded cache is keyed by it. */
  sha256?: string;
  /** Pack sounds: the pinned HTTPS file the sound resolved to. */
  url?: string;
  /** Pack sounds: the pack's license (SPDX id or `none stated`). */
  license?: string;
  /** MIDI note the file plays at in keyed mode, default 60. */
  root?: number;
  /** Start fraction 0..1 of the file. */
  begin?: number;
  /** End fraction 0..1 of the file, greater than `begin`. */
  end?: number;
  /** Linear gain 0..2. */
  gain?: number;
  /** Playback rate; negative reverses. |speed| ≤ 8, never 0. */
  speed?: number;
  /** Sustain by looping begin..end. */
  loop?: boolean;
  /** Choke group: a new hit in the group stops the previous one. */
  choke?: string;
  /**
   * Optional (Strudel `loopBegin`/`loopb`, `loopEnd`/`loope`): the looped
   * part of the window, fractions of the file with
   * begin ≤ loopBegin < loopEnd ≤ end. Playback starts at `begin`.
   */
  loopBegin?: number;
  loopEnd?: number;
  /**
   * Optional (Strudel `clip`/`legato`): the voice lasts the note's length
   * times this, cutting the sample off; a oneshot voice otherwise plays
   * the whole window. 0 < clip ≤ 16.
   */
  clip?: number;
  /**
   * Optional (Strudel/Tidal `unit`): how `speed` reads. `r` (default) is a
   * rate; `c`: the window lasts 1/|speed| cycles (a cycle is one bar);
   * `s`: the window lasts |speed| seconds. Negative still reverses.
   */
  unit?: SampleUnit;
  /** Optional (Strudel `fit`): the window lasts exactly the note's length. */
  fit?: boolean;
  /**
   * Optional (Tidal/Strudel `accelerate`): the rate ramps linearly by this
   * many times the starting rate over the voice (−8..8; −1 slows to a stop).
   */
  accelerate?: number;
  /**
   * Optional (Tidal/Strudel `squiz`): raise the pitch by this ratio inside
   * each zero-crossing cycle, repeating the cycle to keep the length
   * (1 is off, up to 32).
   */
  squiz?: number;
}>;

/** Sample `unit`: rate, cycles (bars) or seconds. */
export type SampleUnit = "r" | "c" | "s";
export const SAMPLE_UNITS: readonly SampleUnit[] = Object.freeze([
  "r",
  "c",
  "s",
]);

export type TrackReverb = Readonly<{
  /** Wet level added to the dry signal, 0..1. */
  mix: number;
  /** Room size 0..1: longer comb feedback and a darker, longer tail. */
  size: number;
  /** Optional: decay time to -60 dB in seconds; overrides the size-derived decay. */
  fade?: number;
  /** Optional: low-pass on the reverb input, Hz. */
  lowpass?: number;
  /** Optional: the tail darkens toward this frequency (Hz) as it decays. */
  dim?: number;
  /** Optional: seconds before the tail starts. */
  predelay?: number;
  /**
   * Optional (Strudel `iresponse`/`ir`): convolve with this impulse instead
   * of the algorithmic tail. `builtin:room|hall|plate`, a pinned pack sound
   * or a project file; `size`, `fade` and `dim` then do nothing.
   */
  ir?: SampleRef;
}>;

/** Generated impulse responses `reverb.ir` can name as `builtin:<name>`. */
export const REVERB_IR_BUILTINS = Object.freeze(["room", "hall", "plate"]);

/**
 * Validates `reverb.ir`: a string or `{ src, … }`. Bare built-in names and
 * `builtin:<name>` become `{ src: "builtin:<name>" }`; anything else is a
 * sample reference (pack sound or project-relative file).
 */
export function normalizeReverbIr(input: unknown): SampleRef {
  const ref = typeof input === "string" ? { src: input } : input;
  if (isRecord(ref) && typeof ref.src === "string") {
    const bare = REVERB_IR_BUILTINS.includes(ref.src);
    if (bare || ref.src.startsWith(BUILTIN_TABLE_PREFIX)) {
      const name = bare ? ref.src : ref.src.slice(BUILTIN_TABLE_PREFIX.length);
      if (!REVERB_IR_BUILTINS.includes(name) || Object.keys(ref).length !== 1)
        throw new ScoreValidationError(
          `track reverb ir builtin must be one of ${REVERB_IR_BUILTINS.map((n) => `builtin:${n}`).join(", ")} with no other fields`,
          "invalid-track",
        );
      return Object.freeze({ src: `${BUILTIN_TABLE_PREFIX}${name}` });
    }
  }
  return normalizeSampleRef(ref, "reverb ir");
}

export type TrackFilter = Readonly<{
  /** Cutoff frequency in Hz, 20..20000. */
  cutoff: number;
  /** Resonance 0..1, mapped to a bounded biquad Q. */
  resonance: number;
  /** Optional: filter type; absent is the original low-pass. */
  type?: "lpf" | "hpf" | "bpf";
  /** Optional: slope; absent is the original 12 dB/oct biquad. */
  ftype?: "12db" | "24db" | "ladder";
}>;

export type TrackDelay = Readonly<{
  /** Delay time in beats, 0.0625..4, so echoes follow the tempo. */
  beats: number;
  /** Fraction of each echo fed back, 0..0.9. */
  feedback: number;
  /** Wet level added to the dry signal, 0..1. */
  mix: number;
  /** Optional: delay time in seconds; 0/absent follows `beats`. */
  time?: number;
  /** Optional: repeats alternate left/right; absent is the original cross-fed stereo. */
  pingpong?: boolean;
  /** Optional: low-pass (Hz) inside the feedback loop. */
  highcut?: number;
}>;

/** The lanes stored in their own track fields (`AUTOMATION_LANES`). */
export type TrackAutomationParameter =
  | "volume"
  | "pan"
  | "filter"
  | "resonance"
  | "delay-feedback"
  | "delay-mix"
  | "wt";

/** Every automation lane: the track-field lanes plus `fx` lanes. */
export type AutomationParameter = TrackAutomationParameter | FxLane;

/** Track field and value range for every automation lane. */
export const AUTOMATION_LANES: Readonly<
  Record<
    TrackAutomationParameter,
    Readonly<{
      field:
        | "volumeAutomation"
        | "panAutomation"
        | "filterAutomation"
        | "resonanceAutomation"
        | "delayFeedbackAutomation"
        | "delayMixAutomation"
        | "wtAutomation";
      min: number;
      max: number;
    }>
  >
> = Object.freeze({
  volume: { field: "volumeAutomation", min: 0, max: SCORE_LIMITS.maxVolume },
  pan: { field: "panAutomation", min: -1, max: 1 },
  filter: {
    field: "filterAutomation",
    min: SCORE_LIMITS.minFilterCutoff,
    max: SCORE_LIMITS.maxFilterCutoff,
  },
  resonance: {
    field: "resonanceAutomation",
    min: 0,
    max: SCORE_LIMITS.maxFilterResonance,
  },
  "delay-feedback": {
    field: "delayFeedbackAutomation",
    min: 0,
    max: SCORE_LIMITS.maxDelayFeedback,
  },
  "delay-mix": {
    field: "delayMixAutomation",
    min: 0,
    max: SCORE_LIMITS.maxDelayMix,
  },
  wt: { field: "wtAutomation", min: 0, max: 1 },
});

const FX_LANE_RANGES: ReadonlyMap<
  string,
  Readonly<{ min: number; max: number }>
> = new Map(
  FX_LANES.map(({ lane, spec }) => [lane, { min: spec.min, max: spec.max }]),
);

export function isTrackAutomationParameter(
  value: unknown,
): value is TrackAutomationParameter {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(AUTOMATION_LANES, value)
  );
}

export function isAutomationParameter(
  value: unknown,
): value is AutomationParameter {
  return (
    isTrackAutomationParameter(value) ||
    (typeof value === "string" && FX_LANE_RANGES.has(value))
  );
}

/** Every automation lane name, track-field lanes first. */
export const AUTOMATION_PARAMETERS: readonly AutomationParameter[] =
  Object.freeze([
    ...(Object.keys(AUTOMATION_LANES) as TrackAutomationParameter[]),
    ...FX_LANES.map(({ lane }) => lane),
  ]);

/** Value range of any lane. */
export function automationRange(
  parameter: AutomationParameter,
): Readonly<{ min: number; max: number }> {
  if (isTrackAutomationParameter(parameter)) {
    const { min, max } = AUTOMATION_LANES[parameter];
    return { min, max };
  }
  const range = FX_LANE_RANGES.get(parameter);
  if (!range)
    throw new ScoreValidationError(
      `unknown automation parameter: ${String(parameter)}`,
      "invalid-track",
    );
  return range;
}

/** A track's points on any lane (empty when it has none). */
export function automationPoints(
  track: Track | undefined,
  parameter: AutomationParameter,
): readonly AutomationPoint[] {
  if (!track) return [];
  if (isTrackAutomationParameter(parameter))
    return track[AUTOMATION_LANES[parameter].field] ?? [];
  return track.fxAutomation?.[parameter as FxLane] ?? [];
}

/** Track fields that score operations may patch; `null` clears an effect. */
export type TrackPatch = Readonly<
  Partial<
    Pick<
      Track,
      | "name"
      | "instrument"
      | "muted"
      | "volume"
      | "pan"
      | "volumeAutomation"
      | "panAutomation"
      | "solo"
      | "filterAutomation"
      | "resonanceAutomation"
      | "delayFeedbackAutomation"
      | "delayMixAutomation"
      | "wtAutomation"
    >
  > & {
    filter?: TrackFilter | null;
    delay?: TrackDelay | null;
    reverb?: TrackReverb | null;
    sampler?: Sampler | null;
    rhythm?: readonly RhythmRow[] | null;
    kit?: string | null;
    fx?: TrackFx | null;
    fxAutomation?: Track["fxAutomation"] | null;
    synth?: TrackSynth | null;
    wavetable?: TrackWavetable | null;
    time?: TrackTime | null;
    glide?: Track["glide"] | null;
    pedal?: Track["pedal"] | null;
    velocityCurve?: Track["velocityCurve"] | null;
    humanize?: Track["humanize"] | null;
    tuning?: Tuning | null;
  }
>;

export type AutomationPoint = Readonly<{
  tick: number;
  value: number;
}>;

/**
 * A note's start and duration are integer ticks, never floating-point beats.
 * Expression fields (`articulation`, `glide`, `bend`, `vibrato`, see
 * `core/expression.ts`) are optional and absent when unused.
 */
export type Note = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  /** Static offset from the tuned pitch in cents (±1200); absent is 0. */
  cents?: number;
}> &
  NoteExpression;

export type TrackInput = Readonly<
  Omit<
    Partial<Track>,
    | "filter"
    | "delay"
    | "reverb"
    | "sampler"
    | "rhythm"
    | "kit"
    | "fx"
    | "fxAutomation"
    | "synth"
    | "wavetable"
    | "time"
    | "glide"
    | "pedal"
    | "velocityCurve"
    | "humanize"
    | "tuning"
  > &
    Pick<Track, "id"> & {
      filter?: TrackFilter | null;
      delay?: TrackDelay | null;
      reverb?: TrackReverb | null;
      sampler?: Sampler | null;
      rhythm?: readonly RhythmRow[] | null;
      kit?: string | null;
      fx?: TrackFx | null;
      fxAutomation?: Track["fxAutomation"] | null;
      synth?: TrackSynth | null;
      wavetable?: TrackWavetable | null;
      time?: TrackTime | null;
      glide?: Track["glide"] | number | null;
      pedal?: Track["pedal"] | null;
      velocityCurve?: Track["velocityCurve"] | string | null;
      humanize?: Track["humanize"] | null;
      tuning?: Tuning | null;
    }
>;

/**
 * Input accepts `start`/`duration` as a convenience for callers that use the
 * short names. Encoded and stored notes always use the explicit tick names.
 */
export type NoteInput = Readonly<{
  id: string;
  trackId: string;
  startTick?: number;
  durationTicks?: number;
  start?: number;
  duration?: number;
  pitch: number;
  velocity: number;
  cents?: number;
}> &
  NoteExpressionPatch;

/** A per-track change inside a section: semitones and a velocity gain. */
export type SectionVariation = Readonly<{
  /** Semitones, -24..24; drum and one-shot sampler tracks ignore it. */
  transpose?: number;
  /** Velocity multiplier 0..2 (1 leaves it alone). */
  gain?: number;
}>;

/**
 * A named bar range of the song (0.5). Sections may overlap: two sections
 * over the same bars with different mutes or variations are two versions
 * of that music. `mute` and `vary` name track ids; unknown ids are ignored.
 */
export type Section = Readonly<{
  /** Unique (ignoring case), 1..32 characters: `intro`, `chorus 2`, `A`. */
  name: string;
  /** First bar, 0-based. */
  startBar: number;
  /** Length in bars, at least 1. */
  bars: number;
  /** Tracks silent in this section. */
  mute?: readonly string[];
  /** Per-track variations in this section. */
  vary?: Readonly<Record<string, SectionVariation>>;
}>;

/** One step of the song form: a section by name, played `repeat` times. */
export type FormEntry = Readonly<{
  section: string;
  /** 1..16, default 1. */
  repeat?: number;
}>;

export type TrackScoreData = Readonly<{
  tempoBpm?: number;
  beatsPerBar?: number;
  bars?: number;
  ticksPerBeat?: number;
  key?: string | null;
  /**
   * Tempo map, meter changes and fermatas (`core/tempo.ts`). Absent keeps
   * `tempoBpm` and `beatsPerBar` for the whole song.
   */
  time?: SongTime | null;
  /** Song tuning (`core/tuning.ts`); absent is 12-TET at A4 = 440 Hz. */
  tuning?: Tuning | null;
  tracks?: readonly TrackInput[];
  notes?: readonly NoteInput[];
  /** Song master chain and loudness target (core/master.ts); absent is off. */
  master?: SongMaster | null;
  /** Song sections (0.5); absent or empty means none. */
  sections?: readonly Section[];
  /** Song form (0.5): the order sections play in; absent plays the score straight through. */
  form?: readonly FormEntry[];
  /**
   * The section playback loops (0.5), like a DAW's loop brace; absent plays
   * the song (or its form). A name that matches no section is dropped.
   */
  loopSection?: string | null;
}>;

/** Canonical immutable score. Use `addNote`/`removeNote` to create a revision. */
export class TrackScore {
  readonly version = SCORE_VERSION;
  readonly tempoBpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly ticksPerBeat: number;
  readonly key: string | null;
  /** Tempo map, meters and fermatas; absent when the song has none. */
  declare readonly time?: SongTime;
  readonly tuning: Tuning | undefined;
  readonly tracks: readonly Track[];
  readonly notes: readonly Note[];
  /** Absent (not undefined-valued) without a master, so 0.4 scores are unchanged. */
  declare readonly master?: SongMaster;
  /** Song sections in bar order; empty when the song has none. */
  readonly sections: readonly Section[];
  /** Song form; empty plays the score straight through. */
  readonly form: readonly FormEntry[];
  /** The section playback loops; undefined plays the song. */
  readonly loopSection: string | undefined;

  constructor(data: TrackScoreData = {}) {
    const tempoBpm = data.tempoBpm ?? 120;
    const beatsPerBar = data.beatsPerBar ?? 4;
    const bars = data.bars ?? 4;
    const ticksPerBeat = data.ticksPerBeat ?? DEFAULT_TICKS_PER_BEAT;
    const key = data.key ?? null;
    if (
      !Number.isFinite(tempoBpm) ||
      tempoBpm < SCORE_LIMITS.minTempoBpm ||
      tempoBpm > SCORE_LIMITS.maxTempoBpm
    ) {
      throw new ScoreValidationError(
        `tempoBpm must be between ${SCORE_LIMITS.minTempoBpm} and ${SCORE_LIMITS.maxTempoBpm}`,
        "invalid-score",
      );
    }
    if (
      !Number.isInteger(beatsPerBar) ||
      beatsPerBar < 1 ||
      beatsPerBar > SCORE_LIMITS.maxBeatsPerBar
    ) {
      throw new ScoreValidationError(
        `beatsPerBar must be an integer between 1 and ${SCORE_LIMITS.maxBeatsPerBar}`,
        "invalid-score",
      );
    }
    if (!Number.isInteger(bars) || bars < 1 || bars > SCORE_LIMITS.maxBars) {
      throw new ScoreValidationError(
        `bars must be an integer between 1 and ${SCORE_LIMITS.maxBars}`,
        "invalid-score",
      );
    }
    if (
      !Number.isInteger(ticksPerBeat) ||
      ticksPerBeat < 1 ||
      ticksPerBeat > SCORE_LIMITS.maxTicksPerBeat
    ) {
      throw new ScoreValidationError(
        `ticksPerBeat must be an integer between 1 and ${SCORE_LIMITS.maxTicksPerBeat}`,
        "invalid-score",
      );
    }
    if (
      key !== null &&
      (typeof key !== "string" || key.length > SCORE_LIMITS.maxNameLength)
    ) {
      throw new ScoreValidationError(
        "key must be null or a short string",
        "invalid-score",
      );
    }
    const time = timeOrThrow(() => {
      const normalized = normalizeSongTime(data.time);
      checkSongTime(normalized, ticksPerBeat, { tempoBpm, beatsPerBar, bars });
      return normalized;
    });
    const tuning = tuningOrThrow(
      () => normalizeTuning(data.tuning, "song tuning"),
      "invalid-score",
    );
    const tracks = normalizeTracks(data.tracks ?? []);
    const notes = normalizeNotes(data.notes ?? []);
    this.tuning = tuning;
    let master: SongMaster | undefined;
    try {
      master = normalizeMaster(data.master);
    } catch (error) {
      if (error instanceof FxValidationError)
        throw new ScoreValidationError(error.message, "invalid-score");
      throw error;
    }
    if (master) this.master = master;
    const sections = normalizeSections(data.sections ?? []);
    const form = normalizeForm(data.form ?? [], sections);
    // Sections count bars in one meter; meter changes would move them.
    if (
      sections.length > 0 &&
      time?.meter?.some((change, index) => index > 0 || change.bar > 0)
    )
      throw new ScoreValidationError(
        "sections need one meter: remove the meter changes (time.meter) or the sections",
        "invalid-score",
      );
    this.tempoBpm = tempoBpm;
    this.beatsPerBar = beatsPerBar;
    this.bars = bars;
    this.ticksPerBeat = ticksPerBeat;
    this.key = key;
    if (time) this.time = time;
    this.tracks = freezeArray(tracks);
    this.notes = freezeArray(notes);
    this.sections = freezeArray(sections);
    this.form = freezeArray(form);
    this.loopSection = normalizeLoopSection(data.loopSection, sections);
    Object.freeze(this);
  }

  addNote(note: NoteInput): TrackScore {
    return addNote(this, note);
  }

  removeNote(noteId: string): TrackScore {
    return removeNote(this, noteId);
  }

  withTracks(tracks: readonly TrackInput[]): TrackScore {
    return new TrackScore({ ...this.toJSON(), tracks });
  }

  withTempo(tempoBpm: number): TrackScore {
    return new TrackScore({ ...this.toJSON(), tempoBpm });
  }

  /**
   * Replace the sections and the form (both validated together). The loop
   * section is kept while a section of that name remains.
   */
  withSections(
    sections: readonly Section[],
    form: readonly FormEntry[] = [],
    loopSection: string | null | undefined = this.loopSection,
  ): TrackScore {
    return new TrackScore({
      ...this.toJSON(),
      sections,
      form,
      loopSection: loopSection ?? null,
    });
  }

  /** Resize the loop without discarding notes or automation outside its bounds. */
  withBars(bars: number): TrackScore {
    return new TrackScore({ ...this.toJSON(), bars });
  }

  withKey(key: string | null): TrackScore {
    return new TrackScore({ ...this.toJSON(), key });
  }

  /** Set or clear (null) the song tuning. */
  withTuning(tuning: Tuning | null): TrackScore {
    return new TrackScore({ ...this.toJSON(), tuning });
  }

  /**
   * Change the meter; ticks are per beat, so notes keep their positions.
   * Beats per bar is the song meter, so a meter change at bar 1
   * (`time.meter` bar 0) is dropped rather than left overriding it.
   */
  withMeter(beatsPerBar: number): TrackScore {
    const time = this.time?.meter?.some((change) => change.bar === 0)
      ? withMeterChange(this.time, 0, null)
      : this.time;
    return new TrackScore({
      ...this.toJSON(),
      beatsPerBar,
      time: time ?? null,
    });
  }

  /** Replace the tempo map, meter changes and fermatas; null clears them. */
  withTime(time: SongTime | null | undefined): TrackScore {
    return new TrackScore({ ...this.toJSON(), time: time ?? null });
  }

  /** Replace the song master; `null` removes it (bypass). */
  withMaster(master: SongMaster | null): TrackScore {
    return new TrackScore({ ...this.toJSON(), master });
  }

  toJSON(): TrackScoreData & { version: typeof SCORE_VERSION } {
    return {
      version: SCORE_VERSION,
      tempoBpm: this.tempoBpm,
      beatsPerBar: this.beatsPerBar,
      bars: this.bars,
      ticksPerBeat: this.ticksPerBeat,
      key: this.key,
      ...(this.time ? { time: this.time } : {}),
      ...(this.tuning ? { tuning: this.tuning } : {}),
      tracks: this.tracks,
      notes: this.notes,
      ...(this.master ? { master: this.master } : {}),
      ...(this.sections.length > 0 ? { sections: this.sections } : {}),
      ...(this.form.length > 0 ? { form: this.form } : {}),
      ...(this.loopSection === undefined
        ? {}
        : { loopSection: this.loopSection }),
    };
  }
}

export function createScore(data: TrackScoreData = {}): TrackScore {
  return new TrackScore(data);
}

export function emptyScore(): TrackScore {
  return new TrackScore();
}

export function addTrack(score: TrackScore, input: TrackInput): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("addTrack requires a TrackScore");
  return score.withTracks([...score.tracks, input]);
}

export function addNote(score: TrackScore, input: NoteInput): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("addNote requires a TrackScore");
  const note = normalizeNote(input);
  if (score.notes.some((candidate) => candidate.id === note.id)) {
    throw new ScoreValidationError(
      `note id already exists: ${note.id}`,
      "duplicate-note",
    );
  }
  if (score.notes.length >= SCORE_LIMITS.maxNotes) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxNotes} notes`,
      "score-limit",
    );
  }
  return new TrackScore({ ...score.toJSON(), notes: [...score.notes, note] });
}

export function removeNote(score: TrackScore, noteId: string): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("removeNote requires a TrackScore");
  if (
    typeof noteId !== "string" ||
    noteId.length === 0 ||
    noteId.length > SCORE_LIMITS.maxIdLength
  ) {
    throw new ScoreValidationError(
      "noteId must be a non-empty short string",
      "invalid-note",
    );
  }
  if (!score.notes.some((note) => note.id === noteId)) return score;
  return new TrackScore({
    ...score.toJSON(),
    notes: score.notes.filter((note) => note.id !== noteId),
  });
}

/**
 * A note edit: timing, pitch and velocity, plus the expression fields
 * (`null` clears one).
 */
export type NotePatch = Readonly<
  Partial<
    Pick<Note, "startTick" | "durationTicks" | "pitch" | "velocity" | "cents">
  >
> &
  NoteExpressionPatch;

export function updateNote(
  score: TrackScore,
  noteId: string,
  patch: NotePatch,
): TrackScore {
  const current = score.notes.find((note) => note.id === noteId);
  if (!current) return score;
  return new TrackScore({
    ...score.toJSON(),
    notes: score.notes.map((note) =>
      note.id === noteId ? { ...note, ...patch } : note,
    ),
  });
}

export function clearTrack(score: TrackScore, trackId: string): TrackScore {
  if (!score.notes.some((note) => note.trackId === trackId)) return score;
  return new TrackScore({
    ...score.toJSON(),
    notes: score.notes.filter((note) => note.trackId !== trackId),
  });
}

export function updateTrack(
  score: TrackScore,
  trackId: string,
  patch: TrackPatch,
): TrackScore {
  if (!score.tracks.some((track) => track.id === trackId)) return score;
  return score.withTracks(
    score.tracks.map((track) =>
      track.id === trackId ? { ...track, ...patch } : track,
    ),
  );
}

/** Removes a track and every note on it; unknown ids are a no-op. */
export function removeTrack(score: TrackScore, trackId: string): TrackScore {
  if (!score.tracks.some((track) => track.id === trackId)) return score;
  return new TrackScore({
    ...score.toJSON(),
    tracks: score.tracks.filter((track) => track.id !== trackId),
    notes: score.notes.filter((note) => note.trackId !== trackId),
  });
}

/** Moves a track to position `index` (clamped) in score order. */
export function moveTrack(
  score: TrackScore,
  trackId: string,
  index: number,
): TrackScore {
  const from = score.tracks.findIndex((track) => track.id === trackId);
  if (from < 0 || !Number.isInteger(index))
    throw new ScoreValidationError(
      "moveTrack needs an existing track and an integer index",
      "invalid-track",
    );
  const to = Math.max(0, Math.min(score.tracks.length - 1, index));
  if (from === to) return score;
  const tracks = [...score.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved!);
  return score.withTracks(tracks);
}

export function isSamplerInstrument(instrument: string | undefined): boolean {
  return (
    typeof instrument === "string" &&
    instrument.trim().toLowerCase() === SAMPLER_INSTRUMENT
  );
}

/**
 * One-shot voices are addressed by pitch slots so the drum-lane projection
 * and note tools keep working: voice names sorted by code point, slots from
 * `SAMPLER_FIRST_SLOT` upward. Keyed samplers have no slots.
 */
export function samplerVoiceSlots(
  sampler: Sampler,
): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  if (sampler.mode !== "oneshot") return slots;
  const names = Object.keys(sampler.voices).sort(compareCodePoints);
  names.forEach((name, index) => slots.set(name, SAMPLER_FIRST_SLOT + index));
  return slots;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function setVolumeAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { volumeAutomation: points });
}

export function setPanAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { panAutomation: points });
}

export function setFilterAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { filterAutomation: points });
}

/** Replace any automation lane by parameter name. */
export function setTrackAutomation(
  score: TrackScore,
  trackId: string,
  parameter: AutomationParameter,
  points: readonly AutomationPoint[],
): TrackScore {
  if (!isAutomationParameter(parameter))
    throw new ScoreValidationError(
      `unknown automation parameter: ${String(parameter)}`,
      "invalid-track",
    );
  if (isTrackAutomationParameter(parameter))
    return updateTrack(score, trackId, {
      [AUTOMATION_LANES[parameter].field]: points,
    });
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return score;
  const lanes: Partial<Record<FxLane, readonly AutomationPoint[]>> = {
    ...track.fxAutomation,
  };
  if (points.length > 0) lanes[parameter] = points;
  else delete lanes[parameter];
  return updateTrack(score, trackId, { fxAutomation: lanes });
}

/** Mute always silences a track; any solo silences every unsoloed track. */
export function isTrackAudible(score: TrackScore, trackId: string): boolean {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (track?.muted) return false;
  const soloing = score.tracks.some((candidate) => candidate.solo === true);
  return !soloing || track?.solo === true;
}

export type ScoreOperation =
  | Readonly<{
      type: "addTrack";
      track: TrackInput;
    }>
  | Readonly<{
      type: "addNote";
      note: NoteInput;
    }>
  | Readonly<{
      type: "removeNote";
      noteId: string;
    }>
  | Readonly<{
      type: "updateNote";
      noteId: string;
      patch: NotePatch;
    }>
  | Readonly<{
      type: "setTempo";
      tempoBpm: number;
    }>
  | Readonly<{
      type: "setBars";
      bars: number;
    }>
  | Readonly<{
      type: "updateTrack";
      trackId: string;
      patch: TrackPatch;
    }>
  | Readonly<{
      type: "setAutomation";
      trackId: string;
      parameter: AutomationParameter;
      points: readonly AutomationPoint[];
    }>
  | Readonly<{
      type: "clearTrack";
      trackId: string;
    }>
  | Readonly<{
      type: "removeTrack";
      trackId: string;
    }>
  | Readonly<{
      type: "moveTrack";
      trackId: string;
      index: number;
    }>
  | Readonly<{
      type: "setKey";
      key: string | null;
    }>
  | Readonly<{
      type: "setMeter";
      beatsPerBar: number;
    }>
  | Readonly<{
      /** Replaces the song's tempo map, meter changes and fermatas. */
      type: "setTime";
      time: SongTime | null;
    }>
  | Readonly<{
      type: "setTuning";
      tuning: Tuning | null;
    }>
  | Readonly<{
      type: "setMaster";
      master: SongMaster | null;
    }>
  | Readonly<{
      type: "setSections";
      sections: readonly Section[];
      form: readonly FormEntry[];
      /** The looped section; absent or null plays the song. */
      loopSection?: string | null;
    }>;

export function applyScoreOperation(
  score: TrackScore,
  operation: ScoreOperation,
): TrackScore {
  if (operation.type === "removeTrack")
    return removeTrack(score, operation.trackId);
  if (operation.type === "moveTrack")
    return moveTrack(score, operation.trackId, operation.index);
  if (operation.type === "setKey") return score.withKey(operation.key);
  if (operation.type === "setMeter")
    return score.withMeter(operation.beatsPerBar);
  if (operation.type === "setTime") return score.withTime(operation.time);
  if (operation.type === "setTuning") return score.withTuning(operation.tuning);
  if (operation.type === "setMaster") return score.withMaster(operation.master);
  if (operation.type === "setSections")
    return score.withSections(
      operation.sections,
      operation.form,
      operation.loopSection ?? null,
    );
  if (operation.type === "addTrack") return addTrack(score, operation.track);
  if (operation.type === "addNote") return addNote(score, operation.note);
  if (operation.type === "removeNote")
    return removeNote(score, operation.noteId);
  if (operation.type === "updateNote")
    return updateNote(score, operation.noteId, operation.patch);
  if (operation.type === "setTempo") return score.withTempo(operation.tempoBpm);
  if (operation.type === "setBars") return score.withBars(operation.bars);
  if (operation.type === "updateTrack")
    return updateTrack(score, operation.trackId, operation.patch);
  if (operation.type === "setAutomation")
    return setTrackAutomation(
      score,
      operation.trackId,
      operation.parameter,
      operation.points,
    );
  if (operation.type === "clearTrack")
    return clearTrack(score, operation.trackId);
  return assertNever(operation);
}

export function scoreFromJSON(value: unknown): TrackScore {
  if (!isRecord(value))
    throw new ScoreValidationError("score must be an object");
  const version = value.version;
  if (version !== undefined && version !== SCORE_VERSION) {
    const displayedVersion =
      typeof version === "string" ||
      typeof version === "number" ||
      typeof version === "boolean" ||
      typeof version === "bigint"
        ? String(version)
        : "[object]";
    throw new ScoreValidationError(
      `unsupported score version: ${displayedVersion}`,
    );
  }
  const data: {
    tempoBpm?: number;
    beatsPerBar?: number;
    bars?: number;
    ticksPerBeat?: number;
    key?: string | null;
    time?: SongTime | null;
    tuning?: Tuning | null;
    tracks: readonly TrackInput[];
    notes: readonly NoteInput[];
    master?: SongMaster;
    sections?: readonly Section[];
    form?: readonly FormEntry[];
    loopSection?: string | null;
  } = {
    tracks: optionalArray(value.tracks).map(parseTrack),
    notes: optionalArray(value.notes).map(parseNote),
  };
  const tempoBpm = optionalNumber(value.tempoBpm);
  const beatsPerBar = optionalNumber(value.beatsPerBar);
  const bars = optionalNumber(value.bars);
  const ticksPerBeat = optionalNumber(value.ticksPerBeat);
  const key = optionalNullableString(value.key);
  if (tempoBpm !== undefined) data.tempoBpm = tempoBpm;
  if (beatsPerBar !== undefined) data.beatsPerBar = beatsPerBar;
  if (bars !== undefined) data.bars = bars;
  if (ticksPerBeat !== undefined) data.ticksPerBeat = ticksPerBeat;
  if (key !== undefined) data.key = key;
  if (value.time !== undefined && value.time !== null)
    data.time = value.time as SongTime;
  if (value.tuning !== undefined) data.tuning = value.tuning as Tuning | null;
  // Validated by the constructor (core/master.ts normalizeMaster).
  if (value.master !== undefined && value.master !== null)
    data.master = value.master as SongMaster;
  // Shapes are checked by the constructor (normalizeSections, normalizeForm).
  if (value.sections !== undefined)
    data.sections = optionalArray(value.sections) as readonly Section[];
  if (value.form !== undefined)
    data.form = optionalArray(value.form) as readonly FormEntry[];
  // The constructor checks the type and drops a name matching no section.
  if (value.loopSection !== undefined)
    data.loopSection = value.loopSection as string | null;
  return new TrackScore(data);
}

/** Section names: printable text without control characters, trimmed. */
const SECTION_NAME = /^[^\u0000-\u001f\u007f]+$/u;

function normalizeSections(inputs: readonly unknown[]): Section[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxSections)
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxSections} sections`,
      "score-limit",
    );
  const seen = new Set<string>();
  const sections = inputs.map((input, index): Section => {
    if (!isRecord(input))
      throw new ScoreValidationError(`section ${index} must be an object`);
    const name =
      typeof input.name === "string"
        ? input.name.trim().replace(/\s+/gu, " ")
        : "";
    if (
      name.length === 0 ||
      name.length > SCORE_LIMITS.maxSectionNameLength ||
      !SECTION_NAME.test(name)
    )
      throw new ScoreValidationError(
        `section ${index} needs a name of 1..${SCORE_LIMITS.maxSectionNameLength} characters`,
      );
    const folded = name.toLowerCase();
    if (seen.has(folded))
      throw new ScoreValidationError(`duplicate section name: ${name}`);
    seen.add(folded);
    const startBar = input.startBar;
    const bars = input.bars;
    if (
      typeof startBar !== "number" ||
      !Number.isInteger(startBar) ||
      startBar < 0 ||
      startBar >= SCORE_LIMITS.maxBars
    )
      throw new ScoreValidationError(
        `section ${name} startBar must be an integer 0..${SCORE_LIMITS.maxBars - 1}`,
      );
    if (
      typeof bars !== "number" ||
      !Number.isInteger(bars) ||
      bars < 1 ||
      startBar + bars > SCORE_LIMITS.maxBars
    )
      throw new ScoreValidationError(
        `section ${name} bars must be an integer 1..${SCORE_LIMITS.maxBars - startBar}`,
      );
    const out: { -readonly [K in keyof Section]: Section[K] } = {
      name,
      startBar,
      bars,
    };
    if (input.mute !== undefined) {
      if (
        !Array.isArray(input.mute) ||
        input.mute.length > SCORE_LIMITS.maxTracks ||
        input.mute.some((id) => typeof id !== "string" || id.length === 0)
      )
        throw new ScoreValidationError(
          `section ${name} mute must be a list of track ids`,
        );
      const mute = [...new Set(input.mute as string[])];
      if (mute.length > 0) out.mute = freezeArray(mute);
    }
    if (input.vary !== undefined) {
      if (!isRecord(input.vary))
        throw new ScoreValidationError(
          `section ${name} vary must map track ids to variations`,
        );
      const entries = Object.entries(input.vary);
      if (entries.length > SCORE_LIMITS.maxTracks)
        throw new ScoreValidationError(
          `section ${name} vary has too many tracks`,
        );
      const vary: Record<string, SectionVariation> = {};
      for (const [trackId, raw] of entries.sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        if (!isRecord(raw) || trackId.length === 0)
          throw new ScoreValidationError(
            `section ${name} vary.${trackId} must be an object`,
          );
        const variation: { transpose?: number; gain?: number } = {};
        if (raw.transpose !== undefined) {
          const t = raw.transpose;
          if (
            typeof t !== "number" ||
            !Number.isInteger(t) ||
            Math.abs(t) > SCORE_LIMITS.maxSectionTranspose
          )
            throw new ScoreValidationError(
              `section ${name} vary.${trackId}.transpose must be an integer -${SCORE_LIMITS.maxSectionTranspose}..${SCORE_LIMITS.maxSectionTranspose}`,
            );
          if (t !== 0) variation.transpose = t;
        }
        if (raw.gain !== undefined) {
          const g = raw.gain;
          if (
            typeof g !== "number" ||
            !Number.isFinite(g) ||
            g < 0 ||
            g > SCORE_LIMITS.maxSectionGain
          )
            throw new ScoreValidationError(
              `section ${name} vary.${trackId}.gain must be 0..${SCORE_LIMITS.maxSectionGain}`,
            );
          if (g !== 1) variation.gain = g;
        }
        if (Object.keys(variation).length > 0)
          vary[trackId] = Object.freeze(variation);
      }
      if (Object.keys(vary).length > 0) out.vary = Object.freeze(vary);
    }
    return Object.freeze(out);
  });
  // Bar order; sections that start together keep the order they were given.
  return sections
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) => a.section.startBar - b.section.startBar || a.index - b.index,
    )
    .map(({ section }) => section);
}

function normalizeLoopSection(
  value: unknown,
  sections: readonly Section[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new ScoreValidationError(
      "loopSection must be a section name or null",
      "invalid-score",
    );
  const key = value.trim().replace(/\s+/gu, " ").toLowerCase();
  return sections.find((section) => section.name.toLowerCase() === key)?.name;
}

function normalizeForm(
  inputs: readonly unknown[],
  sections: readonly Section[],
): FormEntry[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxFormEntries)
    throw new ScoreValidationError(
      `form cannot contain more than ${SCORE_LIMITS.maxFormEntries} entries`,
      "score-limit",
    );
  const byName = new Map(
    sections.map((section) => [section.name.toLowerCase(), section] as const),
  );
  return inputs.map((input, index): FormEntry => {
    const record = typeof input === "string" ? { section: input } : input;
    if (!isRecord(record) || typeof record.section !== "string")
      throw new ScoreValidationError(`form entry ${index} must name a section`);
    const section = byName.get(record.section.trim().toLowerCase());
    if (!section)
      throw new ScoreValidationError(
        `form entry ${index} names an unknown section: ${record.section}`,
      );
    const repeat = record.repeat ?? 1;
    if (
      typeof repeat !== "number" ||
      !Number.isInteger(repeat) ||
      repeat < 1 ||
      repeat > SCORE_LIMITS.maxFormRepeat
    )
      throw new ScoreValidationError(
        `form entry ${index} repeat must be an integer 1..${SCORE_LIMITS.maxFormRepeat}`,
      );
    return Object.freeze(
      repeat === 1
        ? { section: section.name }
        : { section: section.name, repeat },
    );
  });
}

function normalizeTracks(inputs: readonly unknown[]): Track[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxTracks) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxTracks} tracks`,
      "score-limit",
    );
  }
  const seen = new Set<string>();
  return inputs.map((input) => {
    const track = normalizeTrack(input);
    if (seen.has(track.id))
      throw new ScoreValidationError(
        `track id already exists: ${track.id}`,
        "duplicate-track",
      );
    seen.add(track.id);
    return track;
  });
}

function normalizeTrack(input: unknown): Track {
  if (!isRecord(input))
    throw new ScoreValidationError("track must be an object", "invalid-track");
  const id = boundedString(
    input.id,
    "track id",
    SCORE_LIMITS.maxIdLength,
    "invalid-track",
  );
  const name = boundedString(
    input.name ?? id,
    "track name",
    SCORE_LIMITS.maxNameLength,
    "invalid-track",
  );
  const instrument = boundedString(
    input.instrument ?? "sine",
    "instrument",
    SCORE_LIMITS.maxInstrumentLength,
    "invalid-track",
  );
  const muted = input.muted ?? false;
  if (typeof muted !== "boolean")
    throw new ScoreValidationError(
      "track muted must be boolean",
      "invalid-track",
    );
  const volume = input.volume ?? 1;
  const pan = input.pan ?? 0;
  if (
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    throw new ScoreValidationError(
      "track volume must be between 0 and 1",
      "invalid-track",
    );
  if (typeof pan !== "number" || !Number.isFinite(pan) || pan < -1 || pan > 1)
    throw new ScoreValidationError(
      "track pan must be between -1 and 1",
      "invalid-track",
    );
  const volumeAutomation = normalizeAutomation(
    input.volumeAutomation,
    "volumeAutomation",
    0,
    SCORE_LIMITS.maxVolume,
  );
  const panAutomation = normalizeAutomation(
    input.panAutomation,
    "panAutomation",
    -1,
    1,
  );
  const solo = input.solo ?? false;
  if (typeof solo !== "boolean")
    throw new ScoreValidationError(
      "track solo must be boolean",
      "invalid-track",
    );
  const filter = normalizeFilter(input.filter);
  const delay = normalizeDelay(input.delay);
  const filterAutomation = normalizeAutomation(
    input.filterAutomation,
    "filterAutomation",
    SCORE_LIMITS.minFilterCutoff,
    SCORE_LIMITS.maxFilterCutoff,
  );
  const lane = (parameter: TrackAutomationParameter) => {
    const { field, min, max } = AUTOMATION_LANES[parameter];
    return normalizeAutomation(input[field], field, min, max);
  };
  const resonanceAutomation = lane("resonance");
  const delayFeedbackAutomation = lane("delay-feedback");
  const delayMixAutomation = lane("delay-mix");
  const wtAutomation = lane("wt");
  const reverb = normalizeReverb(input.reverb);
  const fx = fxOrThrow(() => normalizeFx(input.fx));
  const fxAutomation = normalizeFxAutomation(input.fxAutomation);
  const synth = fxOrThrow(() => normalizeSynth(input.synth));
  const wavetable = normalizeWavetable(input.wavetable);
  const sampler = normalizeSampler(input.sampler);
  const rhythm = normalizeRhythm(input.rhythm, id);
  const time = timeOrThrow(
    () => normalizeTrackTime(input.time, `track ${id} time`),
    "invalid-track",
  );
  let performance: TrackPerformance;
  try {
    performance = normalizeTrackPerformance(input, SCORE_LIMITS.maxTick);
  } catch (error) {
    if (error instanceof ExpressionValidationError)
      throw new ScoreValidationError(
        `track ${id} ${error.message}`,
        "invalid-track",
      );
    throw error;
  }
  const tuning = tuningOrThrow(
    () => normalizeTuning(input.tuning, `track ${id} tuning`),
    "invalid-track",
  );
  let kit: string | undefined;
  if (input.kit !== undefined && input.kit !== null) {
    const found =
      typeof input.kit === "string" ? synthKit(input.kit) : undefined;
    if (!found)
      throw new ScoreValidationError(
        `track ${id} kit must be one of ${SYNTH_KIT_NAMES.join(", ")}`,
        "invalid-track",
      );
    if (!isDrumInstrument(instrument))
      throw new ScoreValidationError(
        `track ${id} has a kit but its instrument is "${instrument}"`,
        "invalid-track",
      );
    kit = found.name;
  }
  if (isSamplerInstrument(instrument) && !sampler)
    throw new ScoreValidationError(
      `track ${id} instrument "sampler" needs a sampler`,
      "invalid-track",
    );
  if (sampler && !isSamplerInstrument(instrument))
    throw new ScoreValidationError(
      `track ${id} has a sampler but its instrument is "${instrument}"`,
      "invalid-track",
    );
  return Object.freeze({
    id,
    name,
    instrument,
    muted,
    volume,
    pan,
    volumeAutomation,
    panAutomation,
    ...(solo ? { solo } : {}),
    ...(filter ? { filter } : {}),
    ...(delay ? { delay } : {}),
    ...(filterAutomation.length > 0 ? { filterAutomation } : {}),
    ...(resonanceAutomation.length > 0 ? { resonanceAutomation } : {}),
    ...(delayFeedbackAutomation.length > 0 ? { delayFeedbackAutomation } : {}),
    ...(delayMixAutomation.length > 0 ? { delayMixAutomation } : {}),
    ...(reverb ? { reverb } : {}),
    ...(fx ? { fx } : {}),
    ...(fxAutomation ? { fxAutomation } : {}),
    ...(synth ? { synth } : {}),
    ...(wavetable ? { wavetable } : {}),
    ...(wtAutomation.length > 0 ? { wtAutomation } : {}),
    ...(sampler ? { sampler } : {}),
    ...(rhythm ? { rhythm } : {}),
    ...(kit ? { kit } : {}),
    ...(time ? { time } : {}),
    ...performance,
    ...(tuning ? { tuning } : {}),
  });
}

export function normalizeRhythm(
  input: unknown,
  trackId: string,
): readonly RhythmRow[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input) || input.length > RHYTHM_LIMITS.maxRows)
    throw new ScoreValidationError(
      `track ${trackId} rhythm must be an array of at most ${RHYTHM_LIMITS.maxRows} rows`,
      "invalid-track",
    );
  if (input.length === 0) return undefined;
  const rows = input.map((row: unknown, index) => {
    try {
      return normalizeRhythmRow(row, `track ${trackId} rhythm[${index}]`);
    } catch (error) {
      throw new ScoreValidationError(
        error instanceof Error ? error.message : String(error),
        "invalid-track",
      );
    }
  });
  const voices = new Set(rows.map((row) => row.voice));
  if (voices.size !== rows.length)
    throw new ScoreValidationError(
      `track ${trackId} rhythm has two rows for one voice`,
      "invalid-track",
    );
  return Object.freeze(rows);
}

function timeOrThrow<T>(
  run: () => T,
  code: ScoreValidationError["code"] = "invalid-score",
): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof TimeValidationError)
      throw new ScoreValidationError(error.message, code);
    throw error;
  }
}

function tuningOrThrow<T>(run: () => T, code: ScoreValidationError["code"]): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof TuningError)
      throw new ScoreValidationError(error.message, code);
    throw error;
  }
}

function fxOrThrow<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof FxValidationError)
      throw new ScoreValidationError(error.message, "invalid-track");
    throw error;
  }
}

/** Validates `fxAutomation`; empty lanes are dropped, keys in lane order. */
function normalizeFxAutomation(
  input: unknown,
): Track["fxAutomation"] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track fxAutomation must be an object",
      "invalid-track",
    );
  const keys = Object.keys(input);
  if (keys.length > SCORE_LIMITS.maxFxLanes)
    throw new ScoreValidationError(
      `track fxAutomation holds at most ${SCORE_LIMITS.maxFxLanes} lanes`,
      "score-limit",
    );
  for (const key of keys)
    if (!FX_LANE_RANGES.has(key))
      throw new ScoreValidationError(
        `unknown fx automation lane "${key}"`,
        "invalid-track",
      );
  const out: Partial<Record<FxLane, readonly AutomationPoint[]>> = {};
  for (const { lane, spec } of FX_LANES) {
    if (input[lane] === undefined) continue;
    const points = normalizeAutomation(
      input[lane],
      `fxAutomation ${lane}`,
      spec.min,
      spec.max,
    );
    if (points.length > 0) out[lane] = points;
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

/** The optional parameters of a track effect; absent keys stay absent. */
function trackEffectExtras(
  name: keyof typeof TRACK_EFFECT_SPECS,
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const params = TRACK_EFFECT_SPECS[name].params as Record<
    string,
    Parameters<typeof normalizeParams>[0][string]
  >;
  const subset: Record<string, Parameters<typeof normalizeParams>[0][string]> =
    {};
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    subset[key] = params[key]!;
    if (input[key] !== undefined) values[key] = input[key];
  }
  return {
    ...fxOrThrow(() => normalizeParams(subset, values, `track ${name}`)),
  };
}

const VOICE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Validates a `Sampler` from unknown; `undefined`/`null` means none. */
export function normalizeSampler(input: unknown): Sampler | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track sampler must be an object or null",
      "invalid-track",
    );
  const mode = input.mode ?? "oneshot";
  if (mode !== "oneshot" && mode !== "keyed")
    throw new ScoreValidationError(
      'sampler mode must be "oneshot" or "keyed"',
      "invalid-track",
    );
  if (!isRecord(input.voices))
    throw new ScoreValidationError(
      "sampler voices must be an object of name → sample",
      "invalid-track",
    );
  const names = Object.keys(input.voices);
  if (names.length === 0 || names.length > SCORE_LIMITS.maxSamplerVoices)
    throw new ScoreValidationError(
      `sampler must have between 1 and ${SCORE_LIMITS.maxSamplerVoices} voices`,
      "score-limit",
    );
  const voices: Record<string, SampleRef> = {};
  for (const name of names.sort(compareCodePoints)) {
    if (
      name.length > SCORE_LIMITS.maxSamplerVoiceNameLength ||
      !VOICE_NAME.test(name)
    )
      throw new ScoreValidationError(
        `sampler voice name "${name.slice(0, 40)}" must match ${VOICE_NAME.source} and be at most ${SCORE_LIMITS.maxSamplerVoiceNameLength} characters`,
        "invalid-track",
      );
    voices[name] = normalizeSampleRef(input.voices[name], name);
  }
  return Object.freeze({ voices: Object.freeze(voices), mode });
}

export function normalizeSampleRef(input: unknown, name: string): SampleRef {
  const label = `sampler voice ${name}`;
  if (!isRecord(input))
    throw new ScoreValidationError(
      `${label} must be an object`,
      "invalid-track",
    );
  const src = input.src;
  const packRef = typeof src === "string" && src.startsWith(PACK_PREFIX);
  if (
    typeof src !== "string" ||
    src.length === 0 ||
    src.length > SCORE_LIMITS.maxSamplePathLength ||
    (packRef ? !isPackRef(src) : !isSafeRelativePath(src))
  )
    throw new ScoreValidationError(
      packRef
        ? `${label} src must be pack:<pack>/<sound>[:<n>], at most ${SCORE_LIMITS.maxSamplePathLength} characters`
        : `${label} src must be a project-relative path without "..", at most ${SCORE_LIMITS.maxSamplePathLength} characters`,
      "invalid-track",
    );
  const ref: {
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
    unit?: SampleUnit;
    fit?: boolean;
    accelerate?: number;
    squiz?: number;
  } = { src };
  if (input.sha256 !== undefined) {
    if (typeof input.sha256 !== "string" || !SHA256_HEX.test(input.sha256))
      throw new ScoreValidationError(
        `${label} sha256 must be 64 lowercase hex characters`,
        "invalid-track",
      );
    ref.sha256 = input.sha256;
  }
  if (input.url !== undefined) {
    if (!packRef || !isPinnedSampleUrl(input.url))
      throw new ScoreValidationError(
        `${label} url must be an https URL without credentials, at most ${SCORE_LIMITS.maxSampleUrlLength} characters, on a pack: sound`,
        "invalid-track",
      );
    ref.url = input.url;
  }
  if (input.license !== undefined) {
    if (
      typeof input.license !== "string" ||
      !/^[\x20-\x7e]{1,64}$/.test(input.license)
    )
      throw new ScoreValidationError(
        `${label} license must be a short label such as CC0-1.0`,
        "invalid-track",
      );
    ref.license = input.license;
  }
  if (input.root !== undefined) {
    if (
      typeof input.root !== "number" ||
      !Number.isInteger(input.root) ||
      input.root < 0 ||
      input.root > 127
    )
      throw new ScoreValidationError(
        `${label} root must be a MIDI integer between 0 and 127`,
        "invalid-track",
      );
    ref.root = input.root;
  }
  const begin = input.begin === undefined ? 0 : input.begin;
  const end = input.end === undefined ? 1 : input.end;
  if (
    typeof begin !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    begin < 0 ||
    end > 1 ||
    begin >= end
  )
    throw new ScoreValidationError(
      `${label} begin/end must be fractions with 0 ≤ begin < end ≤ 1`,
      "invalid-track",
    );
  if (input.begin !== undefined) ref.begin = begin;
  if (input.end !== undefined) ref.end = end;
  if (input.gain !== undefined)
    ref.gain = boundedNumber(
      input.gain,
      `${label} gain`,
      0,
      SCORE_LIMITS.maxSampleGain,
    );
  if (input.speed !== undefined) {
    const speed = boundedNumber(
      input.speed,
      `${label} speed`,
      -SCORE_LIMITS.maxSampleSpeed,
      SCORE_LIMITS.maxSampleSpeed,
    );
    if (speed === 0)
      throw new ScoreValidationError(
        `${label} speed cannot be 0`,
        "invalid-track",
      );
    ref.speed = speed;
  }
  if (input.loop !== undefined) {
    if (typeof input.loop !== "boolean")
      throw new ScoreValidationError(
        `${label} loop must be boolean`,
        "invalid-track",
      );
    ref.loop = input.loop;
  }
  if (input.choke !== undefined) {
    if (
      typeof input.choke !== "string" ||
      input.choke.length === 0 ||
      input.choke.length > SCORE_LIMITS.maxChokeGroupLength ||
      !VOICE_NAME.test(input.choke)
    )
      throw new ScoreValidationError(
        `${label} choke must be a short group name`,
        "invalid-track",
      );
    ref.choke = input.choke;
  }
  if (input.loopBegin !== undefined || input.loopEnd !== undefined) {
    const loopBegin = input.loopBegin === undefined ? begin : input.loopBegin;
    const loopEnd = input.loopEnd === undefined ? end : input.loopEnd;
    if (
      typeof loopBegin !== "number" ||
      typeof loopEnd !== "number" ||
      !Number.isFinite(loopBegin) ||
      !Number.isFinite(loopEnd) ||
      loopBegin < begin ||
      loopEnd > end ||
      loopBegin >= loopEnd
    )
      throw new ScoreValidationError(
        `${label} loopBegin/loopEnd must be fractions with begin ≤ loopBegin < loopEnd ≤ end`,
        "invalid-track",
      );
    if (input.loopBegin !== undefined) ref.loopBegin = loopBegin;
    if (input.loopEnd !== undefined) ref.loopEnd = loopEnd;
  }
  if (input.clip !== undefined) {
    const clip = boundedNumber(
      input.clip,
      `${label} clip`,
      0,
      SCORE_LIMITS.maxSampleClip,
    );
    if (clip === 0)
      throw new ScoreValidationError(
        `${label} clip must be greater than 0`,
        "invalid-track",
      );
    ref.clip = clip;
  }
  if (input.unit !== undefined) {
    if (!SAMPLE_UNITS.includes(input.unit as SampleUnit))
      throw new ScoreValidationError(
        `${label} unit must be "r", "c" or "s"`,
        "invalid-track",
      );
    ref.unit = input.unit as SampleUnit;
  }
  if (input.fit !== undefined) {
    if (typeof input.fit !== "boolean")
      throw new ScoreValidationError(
        `${label} fit must be boolean`,
        "invalid-track",
      );
    ref.fit = input.fit;
  }
  if (input.accelerate !== undefined)
    ref.accelerate = boundedNumber(
      input.accelerate,
      `${label} accelerate`,
      -SCORE_LIMITS.maxSampleAccelerate,
      SCORE_LIMITS.maxSampleAccelerate,
    );
  if (input.squiz !== undefined)
    ref.squiz = boundedNumber(
      input.squiz,
      `${label} squiz`,
      1,
      SCORE_LIMITS.maxSampleSquiz,
    );
  return Object.freeze(ref);
}

/** Prefix of a pack sound reference in `SampleRef.src`. */
export const PACK_PREFIX = "pack:";

/**
 * `pack:<pack>/<sound>[:<n>]`: pack is a lowercase slug, sound a manifest
 * key, `n` an index (wrapping, like Strudel `s("bd:3")`) or a note name for
 * pitched packs (`pack:gm/gm_piano:C4`).
 */
const PACK_REF =
  /^pack:([a-z0-9][a-z0-9._-]{0,63})\/([A-Za-z0-9][A-Za-z0-9_.~+-]{0,127})(?::([0-9]{1,4}|[A-Ga-g](?:#|s|b)?-?[0-9]))?$/;

export type PackRef = Readonly<{
  pack: string;
  sound: string;
  /** Index into the sound's files (wraps), or a note-zone name. */
  n: number | string;
}>;

export function isPackRef(src: string): boolean {
  return PACK_REF.test(src);
}

/** Splits `pack:<pack>/<sound>[:<n>]`; undefined for anything else. */
export function parsePackRef(src: string): PackRef | undefined {
  const match = PACK_REF.exec(src);
  if (!match) return undefined;
  const n = match[3];
  return Object.freeze({
    pack: match[1]!,
    sound: match[2]!,
    n: n === undefined ? 0 : /^[0-9]+$/.test(n) ? Number(n) : n,
  });
}

export function formatPackRef(ref: PackRef): string {
  return `${PACK_PREFIX}${ref.pack}/${ref.sound}${ref.n === 0 ? "" : `:${ref.n}`}`;
}

/** HTTPS (or loopback HTTP), no credentials, bounded: the URLs a score may pin. */
export function isPinnedSampleUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SCORE_LIMITS.maxSampleUrlLength ||
    /[\u0000-\u0020]/.test(value)
  )
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  // Plain HTTP only to loopback (local fixture servers); fetches still refuse
  // it unless the pack store allows loopback.
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  );
}

/** Relative, forward-slash, no empty/dot segments, no control characters. */
function isSafeRelativePath(path: string): boolean {
  if (path.startsWith("/") || /[\\\u0000-\u001f]/.test(path)) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function normalizeReverb(input: unknown): TrackReverb | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track reverb must be an object or null",
      "invalid-track",
    );
  const mix = boundedNumber(
    input.mix,
    "track reverb mix",
    0,
    SCORE_LIMITS.maxReverbMix,
  );
  const size = boundedNumber(
    input.size ?? 0.5,
    "track reverb size",
    SCORE_LIMITS.minReverbSize,
    SCORE_LIMITS.maxReverbSize,
  );
  const extras = trackEffectExtras("reverb", input, [
    "fade",
    "lowpass",
    "dim",
    "predelay",
  ]);
  const ir =
    input.ir === undefined || input.ir === null
      ? undefined
      : normalizeReverbIr(input.ir);
  return Object.freeze({ mix, size, ...extras, ...(ir ? { ir } : {}) });
}

export function normalizeFilter(input: unknown): TrackFilter | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track filter must be an object or null",
      "invalid-track",
    );
  const cutoff = boundedNumber(
    input.cutoff,
    "track filter cutoff",
    SCORE_LIMITS.minFilterCutoff,
    SCORE_LIMITS.maxFilterCutoff,
  );
  const resonance = boundedNumber(
    input.resonance ?? 0,
    "track filter resonance",
    0,
    SCORE_LIMITS.maxFilterResonance,
  );
  const extras = trackEffectExtras("filter", input, ["type", "ftype"]);
  if (extras.ftype === "12db") delete extras.ftype;
  // `lpf` is the original filter; store it as absent so v1 documents and
  // explicit `lpf` encode the same.
  if (extras.type === "lpf") delete extras.type;
  return Object.freeze({ cutoff, resonance, ...extras });
}

export function normalizeDelay(input: unknown): TrackDelay | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track delay must be an object or null",
      "invalid-track",
    );
  const beats = boundedNumber(
    input.beats,
    "track delay beats",
    SCORE_LIMITS.minDelayBeats,
    SCORE_LIMITS.maxDelayBeats,
  );
  const feedback = boundedNumber(
    input.feedback ?? 0.3,
    "track delay feedback",
    0,
    SCORE_LIMITS.maxDelayFeedback,
  );
  const mix = boundedNumber(
    input.mix ?? 0.35,
    "track delay mix",
    0,
    SCORE_LIMITS.maxDelayMix,
  );
  const extras = trackEffectExtras("delay", input, [
    "time",
    "pingpong",
    "highcut",
  ]);
  if (extras.time === 0) delete extras.time;
  return Object.freeze({ beats, feedback, mix, ...extras });
}

function boundedNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ScoreValidationError(
      `${label} must be between ${min} and ${max}`,
      "invalid-track",
    );
  return value;
}

function normalizeAutomation(
  input: unknown,
  label: string,
  minValue: number,
  maxValue: number,
): readonly AutomationPoint[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > SCORE_LIMITS.maxAutomationPoints)
    throw new ScoreValidationError(
      `${label} must contain at most ${SCORE_LIMITS.maxAutomationPoints} points`,
      "score-limit",
    );
  const points = input.map((candidate) => {
    if (!isRecord(candidate))
      throw new ScoreValidationError(
        `${label} point must be an object`,
        "invalid-track",
      );
    const tick = candidate.tick;
    const value = candidate.value;
    if (
      typeof tick !== "number" ||
      !Number.isInteger(tick) ||
      tick < 0 ||
      tick > SCORE_LIMITS.maxTick
    )
      throw new ScoreValidationError(
        `${label} point tick must be an integer between 0 and ${SCORE_LIMITS.maxTick}`,
        "invalid-track",
      );
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minValue ||
      value > maxValue
    )
      throw new ScoreValidationError(
        `${label} point value must be between ${minValue} and ${maxValue}`,
        "invalid-track",
      );
    return Object.freeze({ tick, value });
  });
  points.sort((a, b) => a.tick - b.tick);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]!.tick === points[index - 1]!.tick)
      throw new ScoreValidationError(
        `${label} points cannot share a tick`,
        "invalid-track",
      );
  }
  return freezeArray(points);
}

function normalizeNotes(inputs: readonly unknown[]): Note[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxNotes) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxNotes} notes`,
      "score-limit",
    );
  }
  const seen = new Set<string>();
  const notes = inputs.map((input) => {
    const note = normalizeNote(input);
    if (seen.has(note.id))
      throw new ScoreValidationError(
        `note id already exists: ${note.id}`,
        "duplicate-note",
      );
    seen.add(note.id);
    return note;
  });
  return notes.sort(compareNotes);
}

function normalizeNote(input: unknown): Note {
  if (!isRecord(input))
    throw new ScoreValidationError("note must be an object", "invalid-note");
  const id = boundedString(
    input.id,
    "note id",
    SCORE_LIMITS.maxIdLength,
    "invalid-note",
  );
  const trackId = boundedString(
    input.trackId,
    "note trackId",
    SCORE_LIMITS.maxIdLength,
    "invalid-note",
  );
  const startTick = input.startTick ?? input.start;
  const durationTicks = input.durationTicks ?? input.duration;
  if (
    typeof startTick !== "number" ||
    !Number.isInteger(startTick) ||
    startTick < 0 ||
    startTick > SCORE_LIMITS.maxTick
  ) {
    throw new ScoreValidationError(
      `note ${id} startTick must be an integer between 0 and ${SCORE_LIMITS.maxTick}`,
      "invalid-note",
    );
  }
  if (
    typeof durationTicks !== "number" ||
    !Number.isInteger(durationTicks) ||
    durationTicks < 1 ||
    durationTicks > SCORE_LIMITS.maxTick
  ) {
    throw new ScoreValidationError(
      `note ${id} durationTicks must be an integer between 1 and ${SCORE_LIMITS.maxTick}`,
      "invalid-note",
    );
  }
  const pitch = input.pitch;
  if (
    typeof pitch !== "number" ||
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127
  ) {
    throw new ScoreValidationError(
      `note ${id} pitch must be a MIDI integer between 0 and 127`,
      "invalid-note",
    );
  }
  if (
    typeof input.velocity !== "number" ||
    !Number.isFinite(input.velocity) ||
    input.velocity < 0 ||
    input.velocity > 1
  ) {
    throw new ScoreValidationError(
      `note ${id} velocity must be between 0 and 1`,
      "invalid-note",
    );
  }
  let expression: NoteExpression;
  try {
    expression = normalizeNoteExpression(input);
  } catch (error) {
    if (error instanceof ExpressionValidationError)
      throw new ScoreValidationError(
        `note ${id} ${error.message}`,
        "invalid-note",
      );
    throw error;
  }
  const cents = tuningOrThrow(
    () => normalizeNoteCents(input.cents, `note ${id}`),
    "invalid-note",
  );
  return Object.freeze({
    id,
    trackId,
    startTick,
    durationTicks,
    pitch,
    velocity: input.velocity,
    ...expression,
    ...(cents !== undefined ? { cents } : {}),
  });
}

function parseTrack(value: unknown): TrackInput {
  if (!isRecord(value))
    throw new ScoreValidationError("track must be an object", "invalid-track");
  return value as unknown as TrackInput;
}

function parseNote(value: unknown): NoteInput {
  if (!isRecord(value))
    throw new ScoreValidationError("note must be an object", "invalid-note");
  return value as unknown as NoteInput;
}

function compareNotes(a: Note, b: Note): number {
  return (
    a.startTick - b.startTick ||
    a.trackId.localeCompare(b.trackId) ||
    a.pitch - b.pitch ||
    a.id.localeCompare(b.id)
  );
}

function boundedString(
  value: unknown,
  label: string,
  max: number,
  code: ScoreValidationError["code"],
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ScoreValidationError(
      `${label} must be a non-empty string of at most ${max} characters`,
      code,
    );
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : typeof value === "number"
      ? value
      : Number.NaN;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined || value === null || typeof value === "string")
    return value;
  return "\u0000invalid";
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new ScoreValidationError("array field is malformed");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function assertNever(value: never): never {
  throw new ScoreValidationError(
    `unsupported score operation: ${String(value)}`,
  );
}
