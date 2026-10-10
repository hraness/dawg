/**
 * The patcher's node library (`NODE_SPECS`): every node type's ports, port
 * kinds, ranges, rate and cost, declared once. Validation (core/patch.ts),
 * the compiler and runner (src/audio/patch), the SDK factories, printing,
 * diffs, the TUI and the agent tool schema all read this one table, the way
 * `FX_CHAIN` drives the effects.
 *
 * The `fx.*` and `engine.*` nodes are generated from the existing parameter
 * tables (`FX_SPECS`, `TRACK_EFFECT_SPECS`, each engine's `*_LANE_PARAMS`),
 * never written by hand, so a new effect parameter is a new port for free.
 * The small set of new modules (oscillators, filters, envelopes, modulators,
 * math, logic, mix) is written out below.
 */
import {
  effectSpec,
  FX_CHAIN,
  type EffectName,
  type NumberParam,
  type ParamSpec,
} from "./fx.ts";
import { GRANULAR_LANE_PARAMS } from "./granular.ts";
import { KEYS_FAMILIES, KEYS_LANE_PARAMS } from "./keys.ts";
import { MODAL_LANE_PARAMS } from "./resonators.ts";
import { SING_LANE_PARAMS } from "./sing.ts";
import { STRING_LANE_PARAMS } from "./strings.ts";
import { SYNTH_LANE_PARAMS } from "./synth.ts";
import { WIND_LANE_PARAMS } from "./winds.ts";

export type PortKind = "audio" | "notes" | "control";

export type PortSpec = Readonly<{
  name: string;
  kind: PortKind;
  /**
   * Control inputs: range, default and doc. Cables into the port are summed,
   * scaled by their `amount`, added to the node's static value and clamped
   * to this range.
   */
  spec?: NumberParam;
  /** Audio cables into this control port modulate at audio rate (FM, AM). */
  audioRate?: boolean;
  /** The runner smooths this control between blocks (a cutoff, a gain). */
  smooth?: boolean;
  doc: string;
  aliases?: readonly string[];
}>;

/** How a node renders: per 32-sample block, or over the whole buffer. */
export type NodeProcess = "block" | "buffer";

export type NodeFamily =
  | "source"
  | "engine"
  | "filter"
  | "envelope"
  | "modulator"
  | "math"
  | "logic"
  | "effect"
  | "mix";

/**
 * Engine nodes keep their settings in the Track fields they already use
 * (`modal`, `string`, `synth`, …), stored whole under the node's `settings`
 * param and validated by that field's own normalizer.
 */
export type EngineBinding = Readonly<{
  /** Track fields the engine reads its settings from. */
  fields: readonly string[];
  /** The `Track.instrument` values this engine plays (empty: any word). */
  instruments: readonly string[];
}>;

export type NodeSpec = Readonly<{
  type: string;
  family: NodeFamily;
  doc: string;
  inputs: readonly PortSpec[];
  outputs: readonly PortSpec[];
  /**
   * Static settings. A number param that shares its name with a control
   * input is that input's base: set (or mapped by a macro), cables add to
   * it; left at its default, it applies only while nothing is wired (a
   * wired port starts from 0). The rest (enums, booleans) are fixed.
   */
  params: Readonly<Record<string, ParamSpec>>;
  /**
   * `voice`: always per voice (a voice source); `global`: always once per
   * track (an engine, a stereo effect); `any`: inferred from what feeds it.
   */
  rate: "voice" | "global" | "any";
  process: NodeProcess;
  /** Rough cost in multiply-adds per sample, for the voice-cap estimate. */
  cost: number;
  engine?: EngineBinding;
  aliases?: readonly string[];
}>;

const num = (
  min: number,
  max: number,
  value: number,
  doc: string,
  extra: Partial<NumberParam> = {},
): NumberParam =>
  Object.freeze({
    kind: "number" as const,
    min,
    max,
    default: value,
    step: (max - min) / 100,
    doc,
    ...extra,
  });

const audioIn = (name: string, doc: string, extra: Partial<PortSpec> = {}) =>
  Object.freeze({ name, kind: "audio" as const, doc, ...extra });
const audioOut = (name = "out", doc = "audio out") =>
  Object.freeze({ name, kind: "audio" as const, doc });
const controlOut = (doc: string, name = "out") =>
  Object.freeze({ name, kind: "control" as const, doc });
const controlIn = (
  name: string,
  spec: NumberParam,
  extra: Partial<PortSpec> = {},
): PortSpec =>
  Object.freeze({
    name,
    kind: "control" as const,
    spec,
    doc: spec.doc,
    ...extra,
  });

/** The control inputs' static values as params (same name, same spec). */
function paramsOf(
  inputs: readonly PortSpec[],
  extra: Readonly<Record<string, ParamSpec>> = {},
): Readonly<Record<string, ParamSpec>> {
  const out: Record<string, ParamSpec> = { ...extra };
  for (const port of inputs) if (port.spec) out[port.name] = port.spec;
  return Object.freeze(out);
}

type Hand = Omit<NodeSpec, "params" | "process" | "rate"> &
  Partial<Pick<NodeSpec, "process" | "rate">> & {
    settings?: Readonly<Record<string, ParamSpec>>;
  };

function node(spec: Hand): NodeSpec {
  const { settings, ...rest } = spec;
  return Object.freeze({
    rate: "any" as const,
    process: "block" as const,
    ...rest,
    inputs: Object.freeze([...spec.inputs]),
    outputs: Object.freeze([...spec.outputs]),
    params: paramsOf(spec.inputs, settings),
  });
}

const enumParam = (values: readonly string[], value: string, doc: string) =>
  Object.freeze({ kind: "enum" as const, values, default: value, doc });

const HZ = { unit: "Hz", step: "log" as const };
const SEC = { unit: "s" };
const pitch = (value = 440) =>
  num(
    0,
    20_000,
    value,
    "frequency in Hz (wire voice.pitch to play the note)",
    HZ,
  );
const cutoff = (value = 1000) =>
  num(20, 20_000, value, "cutoff frequency in Hz", HZ);
const binary = (name: string, doc: string) =>
  node({
    type: name,
    family: name === "gt" || name === "lt" ? "logic" : "math",
    doc,
    inputs: [
      controlIn("a", num(-1e6, 1e6, 0, "first operand")),
      controlIn("b", num(-1e6, 1e6, name === "mul" ? 1 : 0, "second operand")),
    ],
    outputs: [controlOut("result")],
    cost: 1,
  });
const unary = (name: string, doc: string, family: NodeFamily = "math") =>
  node({
    type: name,
    family,
    doc,
    inputs: [controlIn("in", num(-1e6, 1e6, 0, "input"))],
    outputs: [controlOut("result")],
    cost: name === "pitch2hz" || name === "db2gain" ? 8 : 1,
  });

/** The hand-written modules (the runner implements each in src/audio/patch). */
const HAND_NODES: readonly NodeSpec[] = [
  node({
    type: "osc",
    family: "source",
    doc: "oscillator: sine, saw, square, triangle or pulse, with linear FM",
    inputs: [
      controlIn("pitch", pitch(), { audioRate: true }),
      controlIn(
        "detune",
        num(-1200, 1200, 0, "detune in cents", { unit: "ct" }),
      ),
      controlIn("pw", num(0.01, 0.99, 0.5, "pulse width (pulse wave)"), {
        smooth: true,
      }),
      audioIn("fm", "linear FM: Hz added to the pitch, at audio rate", {
        audioRate: true,
      }),
      controlIn("level", num(0, 4, 1, "output level"), { smooth: true }),
    ],
    outputs: [audioOut()],
    settings: {
      wave: enumParam(
        ["sine", "saw", "square", "tri", "pulse"],
        "saw",
        "waveform (saw, square and pulse are band-limited with PolyBLEP)",
      ),
    },
    cost: 12,
  }),
  node({
    type: "noise",
    family: "source",
    doc: "seeded noise: white, pink or brown",
    inputs: [
      controlIn("level", num(0, 4, 1, "output level"), { smooth: true }),
    ],
    outputs: [audioOut()],
    settings: {
      color: enumParam(["white", "pink", "brown"], "white", "noise color"),
    },
    cost: 6,
  }),
  node({
    type: "svf",
    family: "filter",
    doc: "state-variable filter (TPT): low, high, band or notch",
    inputs: [
      audioIn("in", "audio in"),
      controlIn("cutoff", cutoff(), { smooth: true }),
      controlIn("q", num(0, 1, 0.5, "resonance 0..1"), { smooth: true }),
    ],
    outputs: [audioOut()],
    settings: {
      mode: enumParam(["lp", "hp", "bp", "notch"], "lp", "filter response"),
    },
    cost: 14,
  }),
  node({
    type: "onepole",
    family: "filter",
    doc: "one-pole low- or high-pass (6 dB/oct)",
    inputs: [
      audioIn("in", "audio in"),
      controlIn("cutoff", cutoff(), { smooth: true }),
    ],
    outputs: [audioOut()],
    settings: { mode: enumParam(["lp", "hp"], "lp", "filter response") },
    cost: 4,
  }),
  node({
    type: "adsr",
    family: "envelope",
    doc: "attack, decay, sustain, release envelope 0..1, opened by a gate",
    inputs: [
      controlIn(
        "gate",
        num(0, 1, 0, "gate: above 0.5 opens (wire voice.gate)"),
      ),
      controlIn("attack", num(0, 10, 0.01, "attack time", SEC)),
      controlIn("decay", num(0, 10, 0.1, "decay time", SEC)),
      controlIn("sustain", num(0, 1, 0.7, "sustain level")),
      controlIn("release", num(0, 10, 0.2, "release time", SEC)),
    ],
    outputs: [controlOut("envelope 0..1")],
    cost: 4,
  }),
  node({
    type: "ar",
    family: "envelope",
    doc: "attack-release envelope 0..1 that follows a gate",
    inputs: [
      controlIn("gate", num(0, 1, 0, "gate: above 0.5 opens")),
      controlIn("attack", num(0, 10, 0.01, "attack time", SEC)),
      controlIn("release", num(0, 10, 0.2, "release time", SEC)),
    ],
    outputs: [controlOut("envelope 0..1")],
    cost: 3,
  }),
  node({
    type: "slew",
    family: "envelope",
    doc: "slew limiter: glides a control toward its input",
    inputs: [
      controlIn("in", num(-1e6, 1e6, 0, "input")),
      controlIn("rise", num(0, 10, 0.05, "time to rise by one unit", SEC)),
      controlIn("fall", num(0, 10, 0.05, "time to fall by one unit", SEC)),
    ],
    outputs: [controlOut("slewed value")],
    cost: 2,
  }),
  node({
    type: "follow",
    family: "envelope",
    doc: "envelope follower: the level of an audio signal as a control",
    inputs: [
      audioIn("in", "audio to follow"),
      controlIn("attack", num(0.0001, 1, 0.005, "attack time", SEC)),
      controlIn("release", num(0.001, 4, 0.1, "release time", SEC)),
    ],
    outputs: [controlOut("level 0..1")],
    cost: 3,
  }),
  node({
    type: "lfo",
    family: "modulator",
    doc: "low-frequency oscillator -1..1, free in Hz or synced to beats",
    inputs: [
      controlIn("rate", num(0, 100, 1, "rate in Hz (when sync is 0)", HZ)),
      controlIn("phase", num(0, 1, 0, "phase offset in cycles")),
      controlIn("depth", num(0, 1, 1, "output depth")),
    ],
    outputs: [controlOut("-1..1")],
    settings: {
      shape: enumParam(
        ["sine", "tri", "square", "saw", "ramp", "random"],
        "sine",
        "wave shape (random is seeded sample-and-hold per cycle)",
      ),
      sync: num(0, 64, 0, "period in beats; 0 follows rate", {
        unit: "beats",
        step: 0.25,
      }),
    },
    cost: 3,
  }),
  node({
    type: "sh",
    family: "modulator",
    doc: "sample and hold: latches its input when the trigger rises",
    inputs: [
      controlIn("in", num(-1e6, 1e6, 0, "value to sample")),
      controlIn("trig", num(0, 1, 0, "trigger: a rise through 0.5 samples")),
    ],
    outputs: [controlOut("held value")],
    cost: 1,
  }),
  node({
    type: "random",
    family: "modulator",
    doc: "seeded random value 0..1, drawn per note or per block",
    inputs: [],
    outputs: [controlOut("0..1")],
    settings: {
      per: enumParam(["note", "block"], "note", "when a new value is drawn"),
    },
    cost: 1,
  }),
  node({
    type: "const",
    family: "math",
    doc: "a constant control value",
    inputs: [],
    outputs: [controlOut("the value")],
    settings: { value: num(-1e6, 1e6, 0, "the value") },
    cost: 0,
  }),
  binary("add", "a + b"),
  binary("mul", "a × b"),
  binary("min", "the smaller of a and b"),
  binary("max", "the larger of a and b"),
  binary("gt", "1 when a > b, else 0"),
  binary("lt", "1 when a < b, else 0"),
  unary("abs", "|in|"),
  unary("not", "1 when in < 0.5, else 0", "logic"),
  unary("pitch2hz", "MIDI note number to Hz (12-TET, A4 = 440)"),
  unary("db2gain", "decibels to linear gain"),
  node({
    type: "scale",
    family: "math",
    doc: "maps in from [inmin, inmax] to [min, max], linear or exponential",
    inputs: [
      controlIn("in", num(-1e6, 1e6, 0, "input")),
      controlIn("inmin", num(-1e6, 1e6, -1, "input range low")),
      controlIn("inmax", num(-1e6, 1e6, 1, "input range high")),
      controlIn("min", num(-1e6, 1e6, 0, "output range low")),
      controlIn("max", num(-1e6, 1e6, 1, "output range high")),
    ],
    outputs: [controlOut("mapped value")],
    settings: {
      curve: enumParam(["lin", "exp"], "lin", "lin or exp (exp needs min > 0)"),
    },
    cost: 3,
  }),
  node({
    type: "clamp",
    family: "math",
    doc: "limits in to [min, max]",
    inputs: [
      controlIn("in", num(-1e6, 1e6, 0, "input")),
      controlIn("min", num(-1e6, 1e6, 0, "low limit")),
      controlIn("max", num(-1e6, 1e6, 1, "high limit")),
    ],
    outputs: [controlOut("clamped value")],
    cost: 1,
  }),
  node({
    type: "clock",
    family: "logic",
    doc: "tempo-synced gate: high for the first half of each cycle",
    inputs: [controlIn("width", num(0.01, 0.99, 0.5, "high fraction"))],
    outputs: [controlOut("gate 0/1")],
    settings: {
      beats: num(0.0625, 64, 1, "period in beats", {
        unit: "beats",
        step: 0.25,
      }),
    },
    rate: "global",
    cost: 1,
  }),
  node({
    type: "vca",
    family: "mix",
    doc: "amplifier: audio times gain (wire an envelope to gain)",
    inputs: [
      audioIn("in", "audio in"),
      controlIn("gain", num(0, 4, 1, "gain"), { audioRate: true }),
    ],
    outputs: [audioOut()],
    cost: 1,
  }),
  node({
    type: "mix",
    family: "mix",
    doc: "four-input audio mixer with a level per input",
    inputs: [
      audioIn("a", "input a"),
      audioIn("b", "input b"),
      audioIn("c", "input c"),
      audioIn("d", "input d"),
      controlIn("la", num(0, 4, 1, "level of a"), { smooth: true }),
      controlIn("lb", num(0, 4, 1, "level of b"), { smooth: true }),
      controlIn("lc", num(0, 4, 1, "level of c"), { smooth: true }),
      controlIn("ld", num(0, 4, 1, "level of d"), { smooth: true }),
    ],
    outputs: [audioOut()],
    cost: 4,
  }),
  node({
    type: "xfade",
    family: "mix",
    doc: "equal-gain crossfade from a (x = 0) to b (x = 1)",
    inputs: [
      audioIn("a", "input a"),
      audioIn("b", "input b"),
      controlIn("x", num(0, 1, 0.5, "crossfade position"), { smooth: true }),
    ],
    outputs: [audioOut()],
    cost: 2,
  }),
  node({
    type: "pan",
    family: "mix",
    doc: "equal-power pan of a mono signal to left and right",
    inputs: [
      audioIn("in", "audio in"),
      controlIn("pan", num(-1, 1, 0, "-1 left .. 1 right"), { smooth: true }),
    ],
    outputs: [audioOut("left", "left out"), audioOut("right", "right out")],
    cost: 3,
  }),
  node({
    type: "voicesum",
    family: "mix",
    doc: "explicit voice sum: every voice's input, summed once for the track",
    inputs: [audioIn("in", "per-voice audio")],
    outputs: [audioOut()],
    rate: "global",
    cost: 1,
  }),
];

/** Number params become control inputs; the rest stay node settings. */
function splitParams(params: Readonly<Record<string, ParamSpec>>): {
  controls: PortSpec[];
  settings: Record<string, ParamSpec>;
} {
  const controls: PortSpec[] = [];
  const settings: Record<string, ParamSpec> = {};
  for (const [name, spec] of Object.entries(params)) {
    if (spec.kind === "number")
      controls.push(controlIn(name, spec, { smooth: true }));
    else settings[name] = spec;
  }
  return { controls, settings };
}

/** Where the track chain turns stereo; stages after it take left and right. */
const PAN_STAGE = FX_CHAIN.indexOf("pan");
/** Mix-level stages (bus routing, sidechain duck) are not nodes. */
const MIX_STAGES: ReadonlySet<string> = new Set(["orbit", "duck"]);

/** Effect stages that turn the track stereo or run on the stereo pair. */
export function isStereoStage(stage: string): boolean {
  return FX_CHAIN.indexOf(stage as (typeof FX_CHAIN)[number]) > PAN_STAGE;
}

/** `fx.<stage>` for every `FX_CHAIN` effect, generated from its spec. */
const FX_NODES: readonly NodeSpec[] = FX_CHAIN.filter(
  (stage) => stage !== "pan" && !MIX_STAGES.has(stage),
).map((stage) => {
  const spec = effectSpec(stage as EffectName);
  const { controls, settings } = splitParams(spec.params);
  const stereo = isStereoStage(stage);
  return node({
    type: `fx.${stage}`,
    family: "effect",
    doc: spec.doc,
    inputs: stereo
      ? [audioIn("left", "left in"), audioIn("right", "right in"), ...controls]
      : [audioIn("in", "audio in"), ...controls],
    outputs: stereo
      ? [audioOut("left", "left out"), audioOut("right", "right out")]
      : [audioOut()],
    settings,
    // The chain stages run over a whole buffer with their own state, so an
    // effect node renders once per track after the voices are summed.
    rate: "global",
    process: "buffer",
    cost: 40,
  });
});

const ENGINE_TABLES: readonly Readonly<{
  type: string;
  doc: string;
  lanes: readonly Readonly<{ param: string; spec: NumberParam }>[];
  binding: EngineBinding;
  cost: number;
}>[] = [
  {
    type: "engine.synth",
    doc: "the whole synth voice (oscillators, FM, unison, filters, envelopes), samplers and wavetables included",
    lanes: SYNTH_LANE_PARAMS,
    binding: { fields: ["synth", "wavetable", "sampler"], instruments: [] },
    cost: 120,
  },
  {
    type: "engine.modal",
    doc: "modal resonators: mallets, bars, bells and plates",
    lanes: MODAL_LANE_PARAMS,
    binding: { fields: ["modal"], instruments: ["modal"] },
    cost: 200,
  },
  {
    type: "engine.string",
    doc: "physically modeled plucked and bowed strings",
    lanes: STRING_LANE_PARAMS,
    binding: { fields: ["string"], instruments: ["string"] },
    cost: 160,
  },
  {
    type: "engine.wind",
    doc: "physically modeled winds and brass",
    lanes: WIND_LANE_PARAMS,
    binding: { fields: ["wind"], instruments: ["wind"] },
    cost: 160,
  },
  {
    type: "engine.sing",
    doc: "the singing voice (lyrics, formants, choir)",
    lanes: SING_LANE_PARAMS,
    binding: { fields: ["sing"], instruments: ["sing"] },
    cost: 400,
  },
  {
    type: "engine.granular",
    doc: "granular player over a sample or the track's own source",
    lanes: GRANULAR_LANE_PARAMS,
    binding: { fields: ["granular"], instruments: ["granular"] },
    cost: 300,
  },
  {
    type: "engine.keys",
    doc: "modeled pianos, electric keys and organs",
    lanes: KEYS_LANE_PARAMS,
    binding: {
      fields: ["keys"],
      instruments: [...KEYS_FAMILIES],
    },
    cost: 250,
  },
];

/**
 * `engine.<name>`: an existing engine as one big node. It plays the patch's
 * notes itself (rate global) and its control inputs are the engine's
 * automatable parameters, read at each note onset.
 */
const ENGINE_NODES: readonly NodeSpec[] = ENGINE_TABLES.map((table) =>
  node({
    type: table.type,
    family: "engine",
    doc: table.doc,
    inputs: [
      Object.freeze({
        name: "notes",
        kind: "notes" as const,
        doc: "the notes to play (wire in.notes)",
      }),
      ...table.lanes.map(({ param, spec }) => controlIn(param, spec)),
    ],
    outputs: [
      audioOut("out", "audio out (left when stereo)"),
      audioOut("right", "right out (equals out for a mono engine)"),
    ],
    settings: {
      instrument: Object.freeze({
        kind: "enum" as const,
        values: table.binding.instruments,
        default: table.binding.instruments[0] ?? "",
        doc: "which instrument of this engine plays",
      }),
    },
    rate: "global",
    process: "buffer",
    engine: Object.freeze({
      fields: Object.freeze([...table.binding.fields]),
      instruments: Object.freeze([...table.binding.instruments]),
    }),
    cost: table.cost,
  }),
);

/** Every node type by name, in family order. */
export const NODE_SPECS: Readonly<Record<string, NodeSpec>> = Object.freeze(
  Object.fromEntries(
    [...HAND_NODES, ...ENGINE_NODES, ...FX_NODES].map((spec) => [
      spec.type,
      spec,
    ]),
  ),
);

export const NODE_TYPES: readonly string[] = Object.freeze(
  Object.keys(NODE_SPECS),
);

/**
 * The implicit boundary nodes every patch has (FL Patcher's "From/To FL
 * Studio"): `in` and `out` at the track, `voice` per voice and `song` for
 * global time. Their ids are reserved.
 */
export const BOUNDARY_SPECS: Readonly<Record<string, NodeSpec>> = Object.freeze(
  {
    in: node({
      type: "in",
      family: "mix",
      doc: "the patch's inputs from the track",
      inputs: [],
      outputs: [
        Object.freeze({
          name: "notes",
          kind: "notes" as const,
          doc: "the track's notes (instrument)",
        }),
        audioOut("audio", "the track's audio (effect patch)"),
        audioOut("right", "the track's right channel (stereo effect patch)"),
        audioOut("side", "the sidechain track's audio (patch `side`)"),
      ],
      rate: "global",
      cost: 0,
    }),
    out: node({
      type: "out",
      family: "mix",
      doc: "the patch's output to the track",
      inputs: [
        audioIn("audio", "audio out (mono, or left when right is wired)"),
        audioIn("right", "right channel; unwired, audio plays on both"),
      ],
      outputs: [],
      rate: "global",
      cost: 0,
    }),
    voice: node({
      type: "voice",
      family: "source",
      doc: "per-voice sources, one set per playing note",
      inputs: [],
      outputs: [
        controlOut("the note's frequency in Hz (tuned, with glide)", "pitch"),
        controlOut("the note's MIDI number", "note"),
        controlOut("1 while the note is held, then 0", "gate"),
        controlOut("velocity 0..1", "velocity"),
        controlOut("phase 0..1 per cycle of the note's pitch", "phase"),
        controlOut("seeded random 0..1, fixed for the note", "random"),
        controlOut("voice slot index", "index"),
        controlOut("seconds since the note began", "age"),
      ],
      rate: "voice",
      cost: 1,
    }),
    song: node({
      type: "song",
      family: "source",
      doc: "global time and the track's automation",
      inputs: [],
      outputs: [
        controlOut("song position in beats", "beat"),
        controlOut("position in the bar 0..1", "bar.phase"),
        controlOut("tempo in BPM", "tempo"),
      ],
      rate: "global",
      cost: 0,
    }),
  },
);

export const BOUNDARY_IDS: readonly string[] = Object.freeze(
  Object.keys(BOUNDARY_SPECS),
);

/** The spec for a node type (`osc`, `fx.reverb`, …), undefined when unknown. */
export function nodeSpec(type: string): NodeSpec | undefined {
  return Object.prototype.hasOwnProperty.call(NODE_SPECS, type)
    ? NODE_SPECS[type]
    : undefined;
}

/** A port of a spec by name (inputs first), undefined when absent. */
export function findPort(
  spec: NodeSpec,
  name: string,
  dir: "in" | "out",
): PortSpec | undefined {
  return (dir === "in" ? spec.inputs : spec.outputs).find(
    (port) => port.name === name,
  );
}
