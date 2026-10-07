/**
 * The track effects chain: one table that drives validation, the SDK,
 * printing, diffs, the `/menu`, the `fx` prompt command and the agent tools.
 *
 * Parameter names follow Strudel's where one exists (documented in
 * DAWG.md "Effects"); the DSP is dawg's own (clean-room, from public
 * documentation and standard DSP literature), in `src/audio/effects/`.
 *
 * `filter`, `delay` and `reverb` predate this table and keep their own
 * track fields (`track.filter`, `track.delay`, `track.reverb`) and lanes so
 * existing documents decode and render unchanged; every other effect lives
 * under `track.fx.<name>` with every parameter stored once enabled.
 */

import { SYNTH_LANE_PARAMS } from "./synth.ts";
import {
  FxValidationError,
  normalizeParam,
  normalizeParams,
  isRecord,
  type BooleanParam,
  type EnumParam,
  type FxValues,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

export {
  FxValidationError,
  normalizeParam,
  normalizeParams,
  type BooleanParam,
  type EnumParam,
  type FxValues,
  type NumberParam,
  type ParamSpec,
};

/**
 * Fixed processing order; mono stages run before pan, stereo after. The
 * last two act at the mix rather than inside the track: `orbit` names the
 * bus the track plays on and `duck` lowers another orbit at each note.
 */
export const FX_CHAIN = Object.freeze([
  "filter",
  "djf",
  "autofilter",
  "vowel",
  "crush",
  "distort",
  "tremolo",
  "compressor",
  "pan",
  "phaser",
  "chorus",
  "leslie",
  "postgain",
  "delay",
  "reverb",
  "orbit",
  "duck",
] as const);

export type EffectSpec = Readonly<{
  label: string;
  doc: string;
  /** Parameters in display order; the first `simple` are the menu's top level. */
  params: Readonly<Record<string, ParamSpec>>;
  simple: readonly string[];
  /** One-line Strudel equivalent, for the mapping table. */
  strudel: string;
}>;

/** Highest orbit number (`orbit`, `duck.orbit`). */
export const MAX_ORBIT = 16;

const LFO_SHAPES = ["sine", "tri", "square", "saw", "ramp", "random"] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

const rate = (fallback: number, strudel?: readonly string[]): NumberParam => ({
  kind: "number",
  min: 0.01,
  max: 40,
  default: fallback,
  step: 0.1,
  unit: "Hz",
  automate: true,
  doc: "LFO rate in Hz (used when sync is 0)",
  ...(strudel ? { strudel } : {}),
});
const sync = (fallback: number, strudel?: readonly string[]): NumberParam => ({
  kind: "number",
  min: 0,
  max: 64,
  default: fallback,
  step: 0.25,
  unit: "beats",
  doc: "LFO cycle length in beats (tempo-synced); 0 uses rate in Hz",
  ...(strudel ? { strudel } : {}),
});
const mix = (fallback: number, strudel?: readonly string[]): NumberParam => ({
  kind: "number",
  min: 0,
  max: 1,
  default: fallback,
  step: 0.05,
  automate: true,
  doc: "wet/dry balance 0..1",
  ...(strudel ? { strudel } : {}),
});

/**
 * Effects stored under `track.fx`. Every number is bounded; enabling an
 * effect stores all of its parameters so a document says exactly what plays.
 */
export const FX_SPECS = Object.freeze({
  autofilter: {
    label: "auto filter",
    doc: "filter whose cutoff an LFO sweeps around a centre, optionally opened by the input level",
    simple: ["type", "cutoff", "depth", "sync", "shape"],
    strudel:
      "none built in (Strudel fakes it with lpf(sine.range(..)).seg(n)); names follow lpf/lpq",
    params: {
      type: {
        kind: "enum",
        values: ["lpf", "hpf", "bpf"],
        default: "lpf",
        doc: "filter type",
        strudel: ["ftype-like: lpf/hpf/bpf"],
      },
      cutoff: {
        kind: "number",
        min: 20,
        max: 20_000,
        default: 1200,
        step: "log",
        unit: "Hz",
        automate: true,
        doc: "centre cutoff",
        strudel: ["lpf", "cutoff"],
      },
      resonance: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.3,
        step: 0.05,
        automate: true,
        doc: "resonance 0..1 (Q 0.707..8)",
        strudel: ["lpq", "resonance"],
      },
      depth: {
        kind: "number",
        min: 0,
        max: 6,
        default: 2,
        step: 0.25,
        unit: "oct",
        automate: true,
        doc: "sweep width in octaves around the centre",
      },
      sync: sync(4),
      rate: rate(0.5),
      shape: {
        kind: "enum",
        values: LFO_SHAPES,
        default: "sine",
        doc: "LFO shape; random is sample-and-hold, one step per cycle",
      },
      phase: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0,
        step: 0.05,
        doc: "LFO start phase in cycles",
      },
      follow: {
        kind: "number",
        min: -6,
        max: 6,
        default: 0,
        step: 0.25,
        unit: "oct",
        automate: true,
        doc: "envelope follower: octaves the cutoff moves at full input level",
        strudel: ["lpenv (per note, see synth)"],
      },
    },
  },
  djf: {
    label: "dj filter",
    doc: "one-knob filter: below 0.5 low-pass, above 0.5 high-pass, 0.5 open",
    simple: ["value"],
    strudel: "djf(0..1)",
    params: {
      value: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.5,
        step: 0.02,
        automate: true,
        doc: "0 dark … 0.5 open … 1 thin",
        strudel: ["djf"],
      },
    },
  },
  vowel: {
    label: "vowel",
    doc: "formant filter bank: five band-passes per vowel",
    simple: ["vowel", "mix"],
    strudel: "vowel(a|e|i|o|u)",
    params: {
      vowel: {
        kind: "enum",
        values: [
          "a",
          "e",
          "i",
          "o",
          "u",
          "ae",
          "aa",
          "oe",
          "ue",
          "y",
          "uh",
          "un",
          "en",
          "an",
          "on",
        ],
        default: "a",
        doc: "vowel formants (a e i o u plus the extended set)",
        strudel: ["vowel"],
      },
      mix: mix(1),
    },
  },
  crush: {
    label: "bitcrush",
    doc: "bit-depth and sample-rate reduction",
    simple: ["bits", "coarse", "mix"],
    strudel: "crush(bits) coarse(factor)",
    params: {
      bits: {
        kind: "number",
        min: 1,
        max: 16,
        default: 8,
        step: 0.5,
        automate: true,
        doc: "bit depth: 1 heavy .. 16 nearly clean",
        strudel: ["crush"],
      },
      coarse: {
        kind: "number",
        min: 1,
        max: 64,
        default: 1,
        step: 1,
        integer: true,
        doc: "sample-and-hold factor: 1 off, 2 half rate, 3 a third…",
        strudel: ["coarse"],
      },
      mix: mix(1),
    },
  },
  distort: {
    label: "distortion",
    doc: "waveshaper with drive, post-tone and automatic gain compensation",
    simple: ["drive", "tone", "mix"],
    strudel: 'distort("amount:postgain:type"), shape(amount)',
    params: {
      drive: {
        kind: "number",
        min: 0,
        max: 10,
        default: 2,
        step: 0.25,
        automate: true,
        doc: "drive 0..10 (Strudel distort amount)",
        strudel: ["distort", "dist"],
      },
      type: {
        kind: "enum",
        values: [
          "soft",
          "hard",
          "cubic",
          "diode",
          "asym",
          "fold",
          "sinefold",
          "chebyshev",
          "scurve",
          "shape",
        ],
        default: "soft",
        doc: "curve: soft (tanh), hard clip, cubic, diode, asym, fold, sinefold, chebyshev, scurve, shape (Strudel shape's curve)",
        strudel: ["distort type (3rd field)", "shape → type shape"],
      },
      tone: {
        kind: "number",
        min: 200,
        max: 20_000,
        default: 8000,
        step: "log",
        unit: "Hz",
        automate: true,
        doc: "low-pass after the shaper; tames fizz",
      },
      mix: mix(1),
      postgain: {
        kind: "number",
        min: 0,
        max: 2,
        default: 1,
        step: 0.05,
        doc: "linear gain after compensation (Strudel distort postgain)",
        strudel: ["distort postgain"],
      },
    },
  },
  tremolo: {
    label: "tremolo",
    doc: "volume modulation",
    simple: ["sync", "depth", "shape"],
    strudel:
      "tremolosync/tremolodepth/tremoloshape/tremoloskew/tremolophase (am)",
    params: {
      sync: sync(0.5, ["tremolosync", "tremsync"]),
      rate: rate(4, ["tremolo"]),
      depth: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.5,
        step: 0.05,
        automate: true,
        doc: "how far the level dips, 0..1",
        strudel: ["tremolodepth", "tremdepth"],
      },
      shape: {
        kind: "enum",
        values: LFO_SHAPES.filter((shape) => shape !== "random"),
        default: "sine",
        doc: "LFO shape",
        strudel: ["tremoloshape", "tremshape"],
      },
      skew: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.5,
        step: 0.05,
        doc: "where in the cycle the peak falls (0.5 symmetric)",
        strudel: ["tremoloskew", "tremskew"],
      },
      phase: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0,
        step: 0.05,
        doc: "start phase in cycles",
        strudel: ["tremolophase", "tremphase"],
      },
    },
  },
  compressor: {
    label: "compressor",
    doc: "feed-forward RMS-ish compressor with soft knee and make-up gain",
    simple: ["threshold", "ratio", "makeup"],
    strudel: 'compressor("threshold:ratio:knee:attack:release")',
    params: {
      threshold: {
        kind: "number",
        min: -60,
        max: 0,
        default: -18,
        step: 1,
        unit: "dB",
        automate: true,
        doc: "level where compression starts",
        strudel: ["compressor threshold"],
      },
      ratio: {
        kind: "number",
        min: 1,
        max: 20,
        default: 4,
        step: 0.5,
        doc: "input:output above threshold",
        strudel: ["compressorRatio"],
      },
      knee: {
        kind: "number",
        min: 0,
        max: 24,
        default: 6,
        step: 1,
        unit: "dB",
        doc: "soft-knee width",
        strudel: ["compressorKnee"],
      },
      attack: {
        kind: "number",
        min: 0.0001,
        max: 1,
        default: 0.01,
        step: 0.005,
        unit: "s",
        doc: "attack time",
        strudel: ["compressorAttack"],
      },
      release: {
        kind: "number",
        min: 0.01,
        max: 2,
        default: 0.15,
        step: 0.05,
        unit: "s",
        doc: "release time",
        strudel: ["compressorRelease"],
      },
      makeup: {
        kind: "number",
        min: 0,
        max: 24,
        default: 5,
        step: 0.5,
        unit: "dB",
        automate: true,
        doc: "gain after compression",
      },
    },
  },
  phaser: {
    label: "phaser",
    doc: "four-stage all-pass phaser",
    simple: ["rate", "depth"],
    strudel: "phaser/phaserdepth/phasercenter/phasersweep",
    params: {
      rate: rate(0.5, ["phaser", "ph"]),
      sync: sync(0),
      depth: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.75,
        step: 0.05,
        automate: true,
        doc: "notch depth (wet amount)",
        strudel: ["phaserdepth", "phd", "phasdp"],
      },
      center: {
        kind: "number",
        min: 100,
        max: 10_000,
        default: 1000,
        step: "log",
        unit: "Hz",
        doc: "sweep centre",
        strudel: ["phasercenter", "phc"],
      },
      sweep: {
        kind: "number",
        min: 0,
        max: 8000,
        default: 2000,
        step: 100,
        unit: "Hz",
        doc: "sweep range",
        strudel: ["phasersweep", "phs"],
      },
    },
  },
  chorus: {
    label: "chorus",
    doc: "stereo chorus: two modulated delay taps in quadrature",
    simple: ["rate", "depth", "mix"],
    strudel:
      "none in superdough (SuperDirt has no chorus either); standard parameters",
    params: {
      rate: rate(0.8),
      depth: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.4,
        step: 0.05,
        automate: true,
        doc: "modulation depth (0..1 → 0..6 ms)",
      },
      mix: mix(0.5),
    },
  },
  leslie: {
    label: "leslie",
    doc: "rotary speaker: Doppler vibrato plus left/right amplitude rotation",
    simple: ["mix", "rate"],
    strudel: "leslie(wet) lrate(Hz) lsize(0..1)",
    params: {
      mix: mix(1, ["leslie"]),
      rate: {
        ...rate(6.7, ["lrate"]),
        doc: "rotation in Hz: 6.7 fast, 0.7 slow",
      },
      size: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.5,
        step: 0.05,
        doc: "cabinet size: Doppler (pitch warble) amount",
        strudel: ["lsize"],
      },
    },
  },
  postgain: {
    label: "post gain",
    doc: "linear gain after every insert, before the delay and reverb sends",
    simple: ["gain"],
    strudel: "postgain(gain)",
    params: {
      gain: {
        kind: "number",
        min: 0,
        max: 4,
        default: 1,
        step: 0.05,
        automate: true,
        doc: "linear gain 0..4",
        strudel: ["postgain", "post"],
      },
    },
  },
  orbit: {
    label: "orbit",
    doc: "the bus this track plays on (1 when off); another track's duck targets it",
    simple: ["orbit"],
    strudel: "orbit(n)",
    params: {
      orbit: {
        kind: "number",
        min: 1,
        max: MAX_ORBIT,
        default: 2,
        step: 1,
        integer: true,
        doc: "orbit number; tracks without this effect are on orbit 1",
        strudel: ["orbit", "o"],
      },
    },
  },
  duck: {
    label: "duck",
    doc: "sidechain ducking: each note of this track dips the target orbit, then it recovers",
    simple: ["orbit", "depth", "attack"],
    strudel: "duckorbit(n) duckdepth(0..1) duckattack(s)",
    params: {
      orbit: {
        kind: "number",
        min: 1,
        max: MAX_ORBIT,
        default: 1,
        step: 1,
        integer: true,
        doc: "target orbit to duck (never this track itself)",
        strudel: ["duckorbit", "duck"],
      },
      depth: {
        kind: "number",
        min: 0,
        max: 1,
        default: 1,
        step: 0.05,
        doc: "how far the target dips: 1 to silence, 0 not at all",
        strudel: ["duckdepth"],
      },
      attack: {
        kind: "number",
        min: 0.001,
        max: 4,
        default: 0.1,
        step: 0.01,
        unit: "s",
        doc: "time the target takes to come back to full level",
        strudel: ["duckattack", "duckatt", "datt"],
      },
      onset: {
        kind: "number",
        min: 0,
        max: 0.5,
        default: 0.003,
        step: 0.001,
        unit: "s",
        doc: "time the dip takes to reach full depth",
        strudel: ["duckonset"],
      },
    },
  },
} satisfies Record<string, EffectSpec>);

/**
 * The three effects that predate `track.fx` and keep their own track fields.
 * Parameters marked `optional` are new: absent, the effect renders exactly
 * as it did before they existed. `lane` names the legacy automation lane.
 */
export const TRACK_EFFECT_SPECS = Object.freeze({
  filter: {
    label: "filter",
    doc: "resonant biquad: low-pass, high-pass or band-pass",
    simple: ["type", "cutoff", "resonance"],
    strudel: "lpf/hpf/bpf (cutoff, hcutoff, bandf) with lpq/hpq/bpq and ftype",
    params: {
      type: {
        kind: "enum",
        values: ["lpf", "hpf", "bpf"],
        default: "lpf",
        optional: true,
        doc: "lpf low-pass (default), hpf high-pass, bpf band-pass",
        strudel: ["lpf", "hpf", "bpf"],
      },
      ftype: {
        kind: "enum",
        values: ["12db", "24db", "ladder"],
        default: "12db",
        optional: true,
        doc: "slope: 12db biquad (default), 24db two biquads, ladder 4-pole (low-pass only)",
        strudel: ["ftype"],
      },
      cutoff: {
        kind: "number",
        min: 20,
        max: 20_000,
        default: 2000,
        step: "log",
        unit: "Hz",
        automate: true,
        doc: "cutoff (lpf/hpf) or centre (bpf) frequency",
        strudel: [
          "lpf",
          "cutoff",
          "ctf",
          "lp",
          "hpf",
          "hcutoff",
          "bpf",
          "bandf",
        ],
      },
      resonance: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0,
        step: 0.05,
        automate: true,
        doc: "resonance 0..1 (Q 0.707..8)",
        strudel: ["lpq", "resonance", "hpq", "hresonance", "bpq", "bandq"],
      },
    },
  },
  delay: {
    label: "delay",
    doc: "tempo-synced stereo delay send; ping-pong with a high-cut on the repeats by default",
    simple: ["beats", "feedback", "mix"],
    strudel: 'delay("level:time:feedback"), delaytime, delayfeedback',
    params: {
      beats: {
        kind: "number",
        min: 0.0625,
        max: 4,
        default: 0.75,
        step: 0.0625,
        unit: "beats",
        doc: "delay time in beats (0.75 = dotted eighth)",
        strudel: ["delaytime (seconds = beats·60/bpm)"],
      },
      feedback: {
        kind: "number",
        min: 0,
        max: 0.9,
        default: 0.35,
        step: 0.05,
        automate: true,
        doc: "fraction of each echo fed back",
        strudel: ["delayfeedback", "delayfb", "dfb"],
      },
      mix: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.25,
        step: 0.05,
        automate: true,
        doc: "wet level",
        strudel: ["delay"],
      },
      time: {
        kind: "number",
        min: 0,
        max: 4,
        default: 0,
        step: 0.01,
        unit: "s",
        optional: true,
        doc: "delay time in seconds; 0 or absent uses beats",
        strudel: ["delaytime", "delayt", "dt"],
      },
      pingpong: {
        kind: "boolean",
        default: true,
        optional: true,
        doc: "repeats alternate left/right (absent: the original cross-fed stereo)",
      },
      highcut: {
        kind: "number",
        min: 500,
        max: 20_000,
        default: 5000,
        step: "log",
        unit: "Hz",
        optional: true,
        doc: "low-pass inside the feedback loop so repeats darken",
      },
    },
  },
  reverb: {
    label: "reverb",
    doc: "algorithmic stereo reverb send (eight combs, four allpasses per side)",
    simple: ["mix", "size"],
    strudel: 'room("level:size"), roomsize, roomfade, roomlp, roomdim',
    params: {
      mix: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.3,
        step: 0.05,
        automate: true,
        doc: "wet level",
        strudel: ["room"],
      },
      size: {
        kind: "number",
        min: 0,
        max: 1,
        default: 0.5,
        step: 0.05,
        doc: "room size (Strudel roomsize 0..10 = size·10)",
        strudel: ["roomsize", "rsize", "sz", "size"],
      },
      fade: {
        kind: "number",
        min: 0.1,
        max: 20,
        default: 2,
        step: 0.1,
        unit: "s",
        optional: true,
        doc: "decay time to -60 dB; overrides the size-derived decay",
        strudel: ["roomfade", "rfade"],
      },
      lowpass: {
        kind: "number",
        min: 200,
        max: 20_000,
        default: 8000,
        step: "log",
        unit: "Hz",
        optional: true,
        doc: "low-pass on the reverb input",
        strudel: ["roomlp", "rlp"],
      },
      dim: {
        kind: "number",
        min: 200,
        max: 20_000,
        default: 3000,
        step: "log",
        unit: "Hz",
        optional: true,
        doc: "damping: the tail darkens toward this frequency as it decays",
        strudel: ["roomdim", "rdim"],
      },
      predelay: {
        kind: "number",
        min: 0,
        max: 0.5,
        default: 0.02,
        step: 0.005,
        unit: "s",
        optional: true,
        doc: "gap before the tail starts",
      },
    },
  },
} satisfies Record<string, EffectSpec>);

export type TrackEffectName = keyof typeof TRACK_EFFECT_SPECS;
export const TRACK_EFFECT_NAMES = Object.freeze(
  Object.keys(TRACK_EFFECT_SPECS) as TrackEffectName[],
);

/** Every effect the `fx` grammar and the menu address, in chain order. */
export type EffectName = TrackEffectName | FxName;
export const EFFECT_NAMES: readonly EffectName[] = Object.freeze(
  FX_CHAIN.filter((stage): stage is EffectName => stage !== "pan"),
);

/**
 * The core set, in chain order: the effects the menu and brief lead with.
 * The rest (dj filter, vowel, bitcrush, phaser, leslie, post gain) are
 * there for Strudel parity.
 */
export const CORE_EFFECTS: readonly EffectName[] = Object.freeze([
  "filter",
  "autofilter",
  "distort",
  "tremolo",
  "compressor",
  "chorus",
  "delay",
  "reverb",
] as const);

export function isEffectName(value: unknown): value is EffectName {
  return (
    typeof value === "string" &&
    (EFFECT_NAMES as readonly string[]).includes(value)
  );
}

export function effectSpec(name: EffectName): EffectSpec {
  return (
    name in TRACK_EFFECT_SPECS
      ? TRACK_EFFECT_SPECS[name as TrackEffectName]
      : FX_SPECS[name as FxName]
  ) as EffectSpec;
}

/** Legacy automation lanes for track-effect parameters. */
export const TRACK_EFFECT_LANES: Readonly<Record<string, string>> =
  Object.freeze({
    "filter-cutoff": "filter",
    "filter-resonance": "resonance",
    "delay-feedback": "delay-feedback",
    "delay-mix": "delay-mix",
  });

export type FxName = keyof typeof FX_SPECS;
/** `fx` effect names in chain order. */
export const FX_NAMES = Object.freeze(
  FX_CHAIN.filter((stage): stage is FxName =>
    Object.prototype.hasOwnProperty.call(FX_SPECS, stage),
  ),
);

/** One enabled effect's stored parameters. */
/** `track.fx`: only enabled effects appear. */
export type TrackFx = Readonly<Partial<Record<FxName, FxValues>>>;

export function isFxName(value: unknown): value is FxName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FX_SPECS, value)
  );
}

export function fxSpec(name: FxName): EffectSpec {
  return FX_SPECS[name] as EffectSpec;
}

/** Thrown by the normalizers; the score wraps it in its own error type. */
/** Validates `track.fx`; `undefined`/`null`/`{}` means none. */
export function normalizeFx(input: unknown): TrackFx | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track fx must be an object or null");
  const out: Partial<Record<FxName, FxValues>> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!isFxName(name))
      throw new FxValidationError(
        `unknown effect "${name}" (effects: ${FX_NAMES.join(", ")})`,
      );
    if (value === undefined || value === null) continue;
    out[name] = normalizeParams(fxSpec(name).params, value, `fx ${name}`);
  }
  // Canonical key order (chain order) so equal documents print equally.
  const ordered: Partial<Record<FxName, FxValues>> = {};
  for (const name of FX_NAMES) if (out[name]) ordered[name] = out[name];
  return Object.keys(ordered).length > 0 ? Object.freeze(ordered) : undefined;
}

/** Automation lane name of an `fx` parameter, e.g. `distort-drive`. */
export type FxLane = `${FxName | "reverb" | "synth"}-${string}`;

/** Every automatable `fx` parameter as `{ lane, effect, param, spec }`. */
export const FX_LANES: readonly Readonly<{
  lane: FxLane;
  effect: FxName | "reverb" | "synth";
  param: string;
  spec: NumberParam;
}>[] = Object.freeze([
  ...[...FX_NAMES, "reverb" as const].flatMap((effect) =>
    Object.entries(effectSpec(effect).params)
      .filter(
        (entry): entry is [string, NumberParam] =>
          entry[1].kind === "number" && entry[1].automate === true,
      )
      .map(([param, spec]) =>
        Object.freeze({
          lane: `${effect}-${param}` as FxLane,
          effect,
          param,
          spec,
        }),
      ),
  ),
  // Synth voice parameters (core/synth.ts), read at each note's onset.
  ...SYNTH_LANE_PARAMS.map(({ param, spec }) =>
    Object.freeze({
      lane: `synth-${param}` as FxLane,
      effect: "synth" as const,
      param,
      spec,
    }),
  ),
]);

/**
 * Named starting points, shown first in the menu (`fx <effect> preset
 * <name>`). A preset is applied over the effect's defaults, so every
 * parameter it leaves out takes its default.
 */
export const FX_PRESETS: Readonly<
  Partial<Record<EffectName, Readonly<Record<string, FxValues>>>>
> = Object.freeze({
  filter: {
    warm: { type: "lpf", cutoff: 1800, resonance: 0.1 },
    dark: { type: "lpf", cutoff: 600, resonance: 0.2 },
    acid: { type: "lpf", ftype: "ladder", cutoff: 900, resonance: 0.7 },
    thin: { type: "hpf", cutoff: 400, resonance: 0.1 },
    telephone: { type: "bpf", cutoff: 1500, resonance: 0.5 },
  },
  djf: { dark: { value: 0.3 }, thin: { value: 0.7 } },
  autofilter: {
    "slow-sweep": { sync: 8, depth: 2.5, shape: "sine", cutoff: 1000 },
    wobble: { sync: 0.5, depth: 2, shape: "sine", cutoff: 600, resonance: 0.5 },
    "s&h": {
      sync: 0.25,
      depth: 2,
      shape: "random",
      cutoff: 1500,
      resonance: 0.4,
    },
    "hpf-rise": { type: "hpf", sync: 16, depth: 3, shape: "saw", cutoff: 400 },
    "env-follow": {
      sync: 0,
      rate: 0.01,
      depth: 0,
      follow: 3,
      cutoff: 400,
      resonance: 0.4,
    },
  },
  vowel: { a: { vowel: "a" }, o: { vowel: "o" }, ee: { vowel: "i" } },
  crush: {
    "8-bit": { bits: 8, coarse: 1 },
    lofi: { bits: 6, coarse: 4, mix: 0.7 },
    destroy: { bits: 3, coarse: 8 },
  },
  distort: {
    warm: { drive: 1.5, type: "soft", tone: 6000, mix: 1 },
    crunch: { drive: 4, type: "cubic", tone: 5000 },
    fuzz: { drive: 7, type: "hard", tone: 3500 },
    fold: { drive: 5, type: "fold", tone: 7000, mix: 0.7 },
    shape: { drive: 5, type: "shape", tone: 9000 },
  },
  tremolo: {
    gentle: { sync: 1, depth: 0.3, shape: "sine" },
    "eighth-chop": { sync: 0.5, depth: 0.9, shape: "square" },
    pulse: { sync: 0.25, depth: 0.6, shape: "tri" },
  },
  compressor: {
    gentle: { threshold: -18, ratio: 2, attack: 0.02, release: 0.2, makeup: 3 },
    punch: { threshold: -20, ratio: 4, attack: 0.03, release: 0.1, makeup: 6 },
    squash: {
      threshold: -30,
      ratio: 10,
      attack: 0.002,
      release: 0.08,
      makeup: 12,
    },
  },
  phaser: { slow: { rate: 0.2, depth: 0.7 }, fast: { rate: 2, depth: 0.8 } },
  chorus: {
    subtle: { rate: 0.6, depth: 0.25, mix: 0.35 },
    wide: { rate: 0.8, depth: 0.5, mix: 0.5 },
    seasick: { rate: 3, depth: 0.9, mix: 0.6 },
  },
  leslie: { fast: { rate: 6.7, mix: 1 }, slow: { rate: 0.7, mix: 1 } },
  delay: {
    "ping-pong": {
      beats: 0.75,
      feedback: 0.35,
      mix: 0.25,
      pingpong: true,
      highcut: 5000,
    },
    "dotted-eighth": {
      beats: 0.75,
      feedback: 0.4,
      mix: 0.3,
      pingpong: false,
      highcut: 6000,
    },
    slapback: {
      beats: 0.25,
      feedback: 0.1,
      mix: 0.25,
      pingpong: false,
      highcut: 8000,
    },
    dub: {
      beats: 1.5,
      feedback: 0.6,
      mix: 0.35,
      pingpong: true,
      highcut: 2500,
    },
  },
  reverb: {
    room: { mix: 0.2, size: 0.3, predelay: 0.01, dim: 6000 },
    hall: { mix: 0.3, size: 0.8, fade: 3.5, predelay: 0.03, dim: 4000 },
    plate: { mix: 0.25, size: 0.6, fade: 2, predelay: 0, dim: 9000 },
    ambient: {
      mix: 0.5,
      size: 1,
      fade: 8,
      predelay: 0.05,
      lowpass: 5000,
      dim: 2500,
    },
  },
  duck: {
    pump: { orbit: 2, depth: 0.85, attack: 0.25 },
    subtle: { orbit: 2, depth: 0.4, attack: 0.12 },
    gate: { orbit: 2, depth: 1, attack: 0.05 },
  },
} satisfies Partial<Record<EffectName, Record<string, FxValues>>>);

export function effectPresetNames(effect: EffectName): readonly string[] {
  return Object.keys(FX_PRESETS[effect] ?? {});
}
