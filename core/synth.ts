/**
 * The synth voice: per-track sound parameters stored under `track.synth`.
 *
 * Parameter names are Strudel's (superdough's) wherever one exists, and each
 * spec lists the Strudel aliases that mean it; the mapping table is in
 * DAWG.md "Synth". The DSP is dawg's own (clean-room, from public
 * documentation and standard DSP literature), in `src/audio/synth/`.
 *
 * Unlike `track.fx`, only the parameters a document sets are stored:
 * Strudel semantics, where an unset control takes its default. A track
 * with no `synth` and a legacy instrument name (sine, saw, square,
 * triangle, piano, pluck, bass) renders exactly as before this module.
 *
 * Values are per track; a `synth-<param>` automation lane is read at each
 * note's onset, as Strudel reads a patterned control once per event.
 */
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** Oscillator sounds of the synth voice, Strudel names first. */
export const SYNTH_SOUNDS = Object.freeze([
  "sine",
  "sawtooth",
  "square",
  "triangle",
  "supersaw",
  "pulse",
  "user",
  "white",
  "pink",
  "brown",
  "crackle",
  "z_sine",
  "z_triangle",
  "z_sawtooth",
  "z_square",
  "z_tan",
  "z_noise",
] as const);

/** dawg's original voices, kept byte-identical while `synth` is unset. */
export const LEGACY_SOUNDS = Object.freeze([
  "sine",
  "piano",
  "pluck",
  "bass",
  "saw",
  "square",
  "triangle",
] as const);

/** Strudel spellings accepted for an instrument, mapped to the stored name. */
export const SOUND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  sin: "sine",
  tri: "triangle",
  sqr: "square",
  supersaw: "supersaw",
  pulse: "pulse",
  noise: "white",
  whitenoise: "white",
  pinknoise: "pink",
  brownnoise: "brown",
});

/** Number of FM operators (`fm`, `fm2` … `fm8`), as in Strudel. */
export const FM_OPERATORS = 8;

const FM_WAVES = ["sine", "sawtooth", "square", "triangle"] as const;
const FILTER_SLOPES = ["12db", "24db", "ladder"] as const;

const seconds = (
  fallback: number,
  doc: string,
  strudel: readonly string[],
  max = 10,
): NumberParam => ({
  kind: "number",
  min: 0,
  max,
  default: fallback,
  step: 0.01,
  unit: "s",
  automate: true,
  doc,
  strudel,
});
const level = (
  fallback: number,
  doc: string,
  strudel: readonly string[],
): NumberParam => ({
  kind: "number",
  min: 0,
  max: 1,
  default: fallback,
  step: 0.05,
  automate: true,
  doc,
  strudel,
});
const hz = (
  fallback: number,
  doc: string,
  strudel: readonly string[],
): NumberParam => ({
  kind: "number",
  min: 20,
  max: 20_000,
  default: fallback,
  step: "log",
  unit: "Hz",
  automate: true,
  doc,
  strudel,
});
const q = (strudel: readonly string[]): NumberParam => ({
  kind: "number",
  min: 0,
  max: 50,
  default: 1,
  step: 0.5,
  automate: true,
  doc: "resonance as filter Q (0..50; 0.7 is flat, higher rings)",
  strudel,
});

function filterParams(
  prefix: "lp" | "hp" | "bp",
  name: string,
  aliases: readonly string[],
  qAliases: readonly string[],
): Record<string, ParamSpec> {
  const f = prefix === "lp" ? "lpf" : prefix === "hp" ? "hpf" : "bpf";
  const qName = `${prefix}q`;
  return {
    [f]: hz(
      prefix === "lp" ? 2000 : prefix === "hp" ? 200 : 1000,
      `per-note ${name} cutoff; unset is no ${name}`,
      [f, ...aliases],
    ),
    [qName]: q([qName, ...qAliases]),
    [`${prefix}env`]: {
      kind: "number",
      min: -10,
      max: 10,
      default: 0,
      step: 0.25,
      unit: "oct",
      automate: true,
      doc: `${name} envelope depth in octaves above (below, negative) the cutoff`,
      strudel: [`${prefix}env`, `${prefix}e`],
    },
    [`${prefix}attack`]: seconds(0.005, `${name} envelope attack`, [
      `${prefix}attack`,
      `${prefix}a`,
    ]),
    [`${prefix}decay`]: seconds(0.15, `${name} envelope decay`, [
      `${prefix}decay`,
      `${prefix}d`,
    ]),
    [`${prefix}sustain`]: level(0, `${name} envelope sustain level`, [
      `${prefix}sustain`,
      `${prefix}s`,
    ]),
    [`${prefix}release`]: seconds(0.1, `${name} envelope release`, [
      `${prefix}release`,
      `${prefix}r`,
    ]),
  };
}

function fmParams(): Record<string, ParamSpec> {
  const out: Record<string, ParamSpec> = {};
  for (let op = 1; op <= FM_OPERATORS; op += 1) {
    const n = op === 1 ? "" : String(op);
    const who = op === 1 ? "FM" : `FM ${op}`;
    out[`fm${n}`] = {
      kind: "number",
      min: 0,
      max: 64,
      default: 0,
      step: 0.25,
      automate: true,
      doc: `${who} modulation index (peak deviation ÷ modulator frequency); 0 is off`,
      strudel: op === 1 ? ["fm", "fmi"] : [`fm${n}`, `fmi${n}`],
    };
    out[`fmh${n}`] = {
      kind: "number",
      min: 0,
      max: 32,
      default: 1,
      step: 0.01,
      automate: true,
      doc: `${who} harmonicity: modulator ÷ carrier frequency (integers sound harmonic)`,
      strudel: [`fmh${n}`],
    };
    out[`fmattack${n}`] = seconds(0, `${who} envelope attack`, [
      `fmattack${n}`,
      `fmatt${n}`,
    ]);
    out[`fmdecay${n}`] = seconds(0, `${who} envelope decay`, [
      `fmdecay${n}`,
      `fmdec${n}`,
    ]);
    out[`fmsustain${n}`] = level(1, `${who} envelope sustain level`, [
      `fmsustain${n}`,
      `fmsus${n}`,
    ]);
    out[`fmrelease${n}`] = seconds(0, `${who} envelope release`, [
      `fmrelease${n}`,
      `fmrel${n}`,
    ]);
    out[`fmenv${n}`] = {
      kind: "enum",
      values: ["lin", "exp"],
      default: "lin",
      doc: `${who} envelope curve`,
      strudel: [`fmenv${n}`, `fme${n}`],
    };
    out[`fmwave${n}`] = {
      kind: "enum",
      values: FM_WAVES,
      default: "sine",
      doc: `${who} modulator waveform`,
      strudel: [`fmwave${n}`],
    };
  }
  return out;
}

/**
 * Every synth parameter, in display order. Groups: amplitude envelope,
 * oscillator, noise, unison, pulse width, vibrato, pitch envelope,
 * per-note filters with envelopes, FM operators.
 */
export const SYNTH_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze({
  attack: seconds(0.003, "amplitude attack: onset to peak", ["attack", "att"]),
  decay: seconds(0.05, "amplitude decay: peak to sustain level", [
    "decay",
    "dec",
  ]),
  sustain: level(1, "amplitude sustain level held until note-off", [
    "sustain",
    "sus",
  ]),
  release: seconds(0.05, "amplitude release after note-off", [
    "release",
    "rel",
  ]),
  gain: {
    kind: "number",
    min: 0,
    max: 4,
    default: 1,
    step: 0.05,
    automate: true,
    doc: "voice gain before the effects chain (track volume follows the chain)",
    strudel: ["gain"],
  },
  noise: level(
    0,
    "pink noise mixed into the oscillator (z_* sounds: phase jitter)",
    ["noise"],
  ),
  density: level(0.03, "crackle density (impulses ≈ density·1000/s)", [
    "density",
  ]),
  unison: {
    kind: "number",
    min: 1,
    max: 16,
    default: 1,
    step: 1,
    integer: true,
    doc: "stacked oscillator voices (supersaw defaults to 5)",
    strudel: ["unison"],
  },
  detune: {
    kind: "number",
    min: 0,
    max: 12,
    default: 0.2,
    step: 0.05,
    unit: "st",
    automate: true,
    doc: "total pitch spread of the unison voices in semitones",
    strudel: ["detune"],
  },
  spread: level(0.6, "stereo spread of the unison voices", ["spread"]),
  pw: level(0.5, "pulse width (pulse sound)", ["pw"]),
  pwrate: {
    kind: "number",
    min: 0,
    max: 40,
    default: 1,
    step: 0.1,
    unit: "Hz",
    automate: true,
    doc: "pulse-width LFO rate (triangle)",
    strudel: ["pwrate"],
  },
  pwsweep: level(0, "pulse-width LFO depth", ["pwsweep"]),
  vib: {
    kind: "number",
    min: 0,
    max: 64,
    default: 0,
    step: 0.25,
    unit: "Hz",
    automate: true,
    doc: "vibrato rate; 0 is off",
    strudel: ["vib", "vibrato", "v"],
  },
  vibmod: {
    kind: "number",
    min: 0,
    max: 24,
    default: 0.5,
    step: 0.05,
    unit: "st",
    automate: true,
    doc: "vibrato depth in semitones",
    strudel: ["vibmod", "vmod"],
  },
  penv: {
    kind: "number",
    min: -48,
    max: 48,
    default: 0,
    step: 1,
    unit: "st",
    automate: true,
    doc: "pitch envelope depth in semitones (negative inverts); 0 is off",
    strudel: ["penv"],
  },
  pattack: seconds(0.2, "pitch envelope attack", ["pattack", "patt"]),
  pdecay: seconds(0, "pitch envelope decay", ["pdecay", "pdec"]),
  psustain: level(1, "pitch envelope sustain level", ["psustain", "psus"]),
  prelease: seconds(0, "pitch envelope release", ["prelease", "prel"]),
  pcurve: {
    kind: "number",
    min: 0,
    max: 1,
    default: 0,
    step: 1,
    integer: true,
    doc: "pitch envelope curve: 0 linear, 1 exponential (kicks)",
    strudel: ["pcurve"],
  },
  panchor: {
    kind: "number",
    min: 0,
    max: 1,
    default: 0,
    step: 0.05,
    doc: "pitch envelope anchor: 0 sweeps note→note+penv, 1 note−penv→note (defaults to psustain when unset)",
    strudel: ["panchor"],
  },
  ...filterParams("lp", "low-pass", ["cutoff", "ctf", "lp"], ["resonance"]),
  ...filterParams("hp", "high-pass", ["hcutoff", "hp"], ["hresonance"]),
  ...filterParams("bp", "band-pass", ["bandf", "bp"], ["bandq"]),
  ftype: {
    kind: "enum",
    values: FILTER_SLOPES,
    default: "12db",
    doc: "per-note filter slope: 12db, 24db, ladder (low-pass only)",
    strudel: ["ftype"],
  },
  fanchor: level(
    0,
    "filter envelope anchor: 0 sweeps up from the cutoff, 1 down to it",
    ["fanchor"],
  ),
  ...fmParams(),
  // ZzFX controls (z_* sounds only; src/audio/synth/zzfx.ts).
  zrand: level(0, "z_*: random pitch offset per note, ± fraction", ["zrand"]),
  curve: {
    kind: "number",
    min: 0,
    max: 3,
    default: 1,
    step: 0.1,
    automate: true,
    doc: "z_*: wave shape exponent (0 squares the wave off, >1 thins it)",
    strudel: ["curve"],
  },
  slide: {
    kind: "number",
    min: -20,
    max: 20,
    default: 0,
    step: 0.1,
    automate: true,
    doc: "z_*: pitch slide, 500·slide Hz per second",
    strudel: ["slide"],
  },
  deltaSlide: {
    kind: "number",
    min: -20,
    max: 20,
    default: 0,
    step: 0.1,
    automate: true,
    doc: "z_*: slide acceleration, 500·deltaSlide Hz per second²",
    strudel: ["deltaSlide", "deltaslide"],
  },
  pitchJump: {
    kind: "number",
    min: -2000,
    max: 2000,
    default: 0,
    step: 10,
    unit: "Hz",
    automate: true,
    doc: "z_*: pitch change applied after pitchJumpTime",
    strudel: ["pitchJump", "pitchjump"],
  },
  pitchJumpTime: seconds(0, "z_*: time before pitchJump applies (0: never)", [
    "pitchJumpTime",
    "pitchjumptime",
  ]),
  lfo: seconds(
    0,
    "z_*: repeat period: restarts slide and pitchJump, sets the tremolo period",
    ["lfo"],
  ),
  zmod: {
    kind: "number",
    min: 0,
    max: 1000,
    default: 0,
    step: 1,
    unit: "Hz",
    automate: true,
    doc: "z_*: frequency-modulation speed (±50 % depth)",
    strudel: ["zmod"],
  },
  zcrush: level(0, "z_*: sample-hold bit crush, 0..1", ["zcrush"]),
  zdelay: seconds(
    0,
    "z_*: one echo this many seconds later, half level",
    ["zdelay"],
    1,
  ),
  tremolo: level(0, "z_*: volume modulation amount at the lfo period", [
    "tremolo",
  ]),
});

/** Additive harmonics (`partials`, `phases`): arrays, not knobs. */
export const SYNTH_LISTS = Object.freeze({
  partials: {
    doc: "amplitude of each harmonic, fundamental first (sound `user`, or any oscillator)",
    min: -1,
    max: 1,
  },
  phases: {
    doc: "start phase of each harmonic in cycles 0..1",
    min: 0,
    max: 1,
  },
} as const);

export type SynthListName = keyof typeof SYNTH_LISTS;

/** A track's synth parameters: numbers/enums by name plus optional lists. */
export type TrackSynth = Readonly<
  Record<string, number | string | boolean | readonly number[]>
>;

/** Most entries `partials`/`phases` may hold. */
export const MAX_PARTIALS = 64;

/** The basic menu rows, shown before "advanced". */
export const SYNTH_SIMPLE = Object.freeze([
  "attack",
  "decay",
  "sustain",
  "release",
  "lpf",
  "lpq",
  "lpenv",
  "detune",
  "vib",
  "fm",
]);

/** Menu grouping of the advanced parameters. */
export const SYNTH_GROUPS: readonly Readonly<{
  id: string;
  label: string;
  params: readonly string[];
}>[] = Object.freeze([
  {
    id: "amp",
    label: "amplitude",
    params: ["attack", "decay", "sustain", "release", "gain"],
  },
  {
    id: "osc",
    label: "oscillator",
    params: [
      "noise",
      "density",
      "unison",
      "detune",
      "spread",
      "pw",
      "pwrate",
      "pwsweep",
    ],
  },
  { id: "vib", label: "vibrato", params: ["vib", "vibmod"] },
  {
    id: "pitch",
    label: "pitch envelope",
    params: [
      "penv",
      "pattack",
      "pdecay",
      "psustain",
      "prelease",
      "pcurve",
      "panchor",
    ],
  },
  ...(["lp", "hp", "bp"] as const).map((prefix) => ({
    id: prefix,
    label:
      prefix === "lp"
        ? "low-pass filter"
        : prefix === "hp"
          ? "high-pass filter"
          : "band-pass filter",
    params: [
      prefix === "lp" ? "lpf" : prefix === "hp" ? "hpf" : "bpf",
      `${prefix}q`,
      `${prefix}env`,
      `${prefix}attack`,
      `${prefix}decay`,
      `${prefix}sustain`,
      `${prefix}release`,
      ...(prefix === "lp" ? ["ftype", "fanchor"] : []),
    ],
  })),
  ...Array.from({ length: FM_OPERATORS }, (_, index) => {
    const n = index === 0 ? "" : String(index + 1);
    return {
      id: `fm${n || 1}`,
      label: index === 0 ? "FM" : `FM ${index + 1}`,
      params: [
        `fm${n}`,
        `fmh${n}`,
        `fmattack${n}`,
        `fmdecay${n}`,
        `fmsustain${n}`,
        `fmrelease${n}`,
        `fmenv${n}`,
        `fmwave${n}`,
      ],
    };
  }),
  {
    id: "zzfx",
    label: "ZzFX (z_* sounds)",
    params: [
      "zrand",
      "curve",
      "slide",
      "deltaSlide",
      "pitchJump",
      "pitchJumpTime",
      "lfo",
      "zmod",
      "zcrush",
      "zdelay",
      "tremolo",
    ],
  },
]);

export function isSynthParam(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYNTH_PARAMS, name);
}

export function isSynthList(name: string): name is SynthListName {
  return Object.prototype.hasOwnProperty.call(SYNTH_LISTS, name);
}

/** Spec name for a parameter typed as its name or any Strudel alias. */
export function synthParamName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (isSynthParam(lower) || isSynthList(lower)) return lower;
  for (const [key, spec] of Object.entries(SYNTH_PARAMS))
    if (spec.strudel?.some((alias) => alias.toLowerCase() === lower))
      return key;
  return undefined;
}

/** Synth parameters with a `synth-<param>` lane (read at note onsets). */
export const SYNTH_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(SYNTH_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

/**
 * Validates `track.synth`: known names only, numbers in range, lists of at
 * most MAX_PARTIALS finite numbers. Keys come back in spec order (lists
 * last) so equal documents print equally; `{}` and `null` mean none.
 */
export function normalizeSynth(input: unknown): TrackSynth | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track synth must be an object or null");
  const scalars: Record<string, unknown> = {};
  const lists: Record<string, readonly number[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (isSynthList(key)) {
      lists[key] = normalizeList(key, value);
      continue;
    }
    if (!isSynthParam(key))
      throw new FxValidationError(
        `synth has no parameter "${key}"${suggest(key)}`,
      );
    scalars[key] = value;
  }
  const values = normalizeParams(SYNTH_PARAMS, scalars, "synth", false);
  const out: Record<string, number | string | boolean | readonly number[]> = {
    ...values,
  };
  for (const name of Object.keys(SYNTH_LISTS))
    if (lists[name]) out[name] = lists[name];
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

function suggest(key: string): string {
  const name = synthParamName(key);
  return name && name !== key ? ` (did you mean "${name}"?)` : "";
}

function normalizeList(name: SynthListName, value: unknown): readonly number[] {
  const { min, max } = SYNTH_LISTS[name];
  if (!Array.isArray(value))
    throw new FxValidationError(`synth ${name} must be an array of numbers`);
  if (value.length === 0 || value.length > MAX_PARTIALS)
    throw new FxValidationError(
      `synth ${name} holds 1 to ${MAX_PARTIALS} numbers`,
    );
  for (const item of value)
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      item < min ||
      item > max
    )
      throw new FxValidationError(
        `synth ${name} entries must be numbers between ${min} and ${max}`,
      );
  return Object.freeze([...(value as number[])]);
}

/** A stored value, or the spec default. */
export function synthValue(
  synth: TrackSynth | undefined,
  name: string,
): number | string | boolean {
  const value = synth?.[name];
  if (value !== undefined && !Array.isArray(value))
    return value as number | string | boolean;
  return SYNTH_PARAMS[name]!.default;
}

/**
 * Named starting points (`synth preset <name>`): an instrument plus the
 * parameters that make the sound. Loading one replaces `synth`.
 */
export const SYNTH_PRESETS: Readonly<
  Record<
    string,
    Readonly<{ instrument: string; doc: string; synth: TrackSynth }>
  >
> = Object.freeze({
  pad: {
    instrument: "supersaw",
    doc: "slow, wide detuned saws through a soft low-pass",
    synth: {
      attack: 0.6,
      decay: 0.5,
      sustain: 0.8,
      release: 1.2,
      unison: 6,
      detune: 0.25,
      spread: 0.8,
      lpf: 1800,
      lpq: 0.8,
      gain: 0.7,
    },
  },
  lead: {
    instrument: "sawtooth",
    doc: "bright saw with a short filter blip and delayed vibrato feel",
    synth: {
      attack: 0.005,
      decay: 0.2,
      sustain: 0.7,
      release: 0.12,
      lpf: 1400,
      lpq: 4,
      lpenv: 2.5,
      lpdecay: 0.25,
      lpsustain: 0.3,
      vib: 5.5,
      vibmod: 0.15,
      unison: 2,
      detune: 0.08,
    },
  },
  pluck: {
    instrument: "pulse",
    doc: "short percussive pulse with a fast filter envelope",
    synth: {
      attack: 0.001,
      decay: 0.25,
      sustain: 0,
      release: 0.1,
      pw: 0.35,
      lpf: 600,
      lpq: 2,
      lpenv: 4,
      lpdecay: 0.12,
      lpsustain: 0,
    },
  },
  bass: {
    instrument: "sawtooth",
    doc: "round saw bass, 24 dB low-pass with a little bite",
    synth: {
      attack: 0.002,
      decay: 0.3,
      sustain: 0.6,
      release: 0.06,
      lpf: 300,
      lpq: 2,
      lpenv: 2,
      lpdecay: 0.15,
      lpsustain: 0.1,
      ftype: "24db",
    },
  },
  sub: {
    instrument: "sine",
    doc: "clean sine sub with a tiny pitch drop on each note",
    synth: {
      attack: 0.004,
      sustain: 1,
      release: 0.08,
      penv: 3,
      pattack: 0,
      pdecay: 0.04,
      psustain: 0,
      panchor: 0,
    },
  },
  acid: {
    instrument: "sawtooth",
    doc: "ladder low-pass with high resonance and a snappy envelope",
    synth: {
      attack: 0.002,
      decay: 0.2,
      sustain: 0.5,
      release: 0.05,
      lpf: 400,
      lpq: 18,
      lpenv: 3.5,
      lpdecay: 0.18,
      lpsustain: 0,
      ftype: "ladder",
    },
  },
  keys: {
    instrument: "sine",
    doc: "electric-piano style 1:1 FM with a decaying modulator",
    synth: {
      attack: 0.002,
      decay: 1.2,
      sustain: 0.25,
      release: 0.3,
      fm: 2.2,
      fmh: 1,
      fmdecay: 0.6,
      fmsustain: 0.1,
      fm2: 0.4,
      fmh2: 14,
      fmdecay2: 0.05,
      fmsustain2: 0,
    },
  },
  bell: {
    instrument: "sine",
    doc: "inharmonic FM bell with a long ring",
    synth: {
      attack: 0.001,
      decay: 2.5,
      sustain: 0,
      release: 1.5,
      fm: 4,
      fmh: 3.5,
      fmdecay: 1.8,
      fmsustain: 0,
    },
  },
  organ: {
    instrument: "user",
    doc: "drawbar-style additive organ with a gentle vibrato",
    synth: {
      attack: 0.01,
      sustain: 1,
      release: 0.08,
      vib: 6,
      vibmod: 0.08,
      partials: [1, 0.8, 0.6, 0.5, 0, 0.35, 0, 0.3],
    },
  },
  strings: {
    instrument: "supersaw",
    doc: "softer ensemble: slow attack, gentle vibrato, darker filter",
    synth: {
      attack: 0.35,
      decay: 0.3,
      sustain: 0.85,
      release: 0.8,
      unison: 4,
      detune: 0.15,
      spread: 0.7,
      lpf: 2500,
      vib: 5,
      vibmod: 0.1,
      gain: 0.75,
    },
  },
  brass: {
    instrument: "sawtooth",
    doc: "filter swell on attack like a brass section",
    synth: {
      attack: 0.06,
      decay: 0.3,
      sustain: 0.8,
      release: 0.15,
      lpf: 700,
      lpq: 1.5,
      lpenv: 2.5,
      lpattack: 0.08,
      lpdecay: 0.4,
      lpsustain: 0.5,
      unison: 2,
      detune: 0.1,
    },
  },
  wind: {
    instrument: "pink",
    doc: "breathy band-passed noise that swells and fades",
    synth: {
      attack: 0.4,
      sustain: 1,
      release: 0.6,
      gain: 2.5,
      bpf: 900,
      bpq: 2,
      bpenv: 1,
      bpattack: 0.5,
      bpsustain: 0.5,
    },
  },
  chip: {
    instrument: "pulse",
    doc: "8-bit square lead with slow pulse-width motion",
    synth: {
      attack: 0.001,
      sustain: 0.8,
      release: 0.03,
      pw: 0.25,
      pwrate: 0.8,
      pwsweep: 0.2,
    },
  },
  zap: {
    instrument: "z_square",
    doc: "ZzFX laser zap: a square that dives in pitch",
    synth: {
      attack: 0.001,
      decay: 0.12,
      sustain: 0.2,
      release: 0.08,
      slide: -4,
      curve: 0.6,
    },
  },
});

export function isSynthPreset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYNTH_PRESETS, name);
}
