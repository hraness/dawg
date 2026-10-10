/**
 * The modular patcher's model: a patch is a small typed graph of nodes
 * (NODE_SPECS in core/patch-nodes.ts), cables between their ports and
 * macros that expose node controls as knobs. It lives in the score as plain
 * frozen data: an instrument (`track.instrument = "patch"` with
 * `track.patch`), effect stages (`track.fxPatch`) and a project library
 * (`score.patches`) that tracks reference by name.
 *
 * This module validates and canonicalises patches, infers each node's rate
 * (per voice or once per track), and finds feedback cycles with the edge the
 * runner delays by one block. It never renders; src/audio/patch does.
 *
 * Node and cable ids are collision-free (`newId` from core/ids.ts), so two
 * writers adding cables at once never fight over a name, and the score diff
 * emits node-, cable- and macro-level operations.
 */
import { newId } from "./ids.ts";
import { nearest } from "./nearest.ts";
import { FxValidationError, isRecord, normalizeParam } from "./params.ts";
import {
  BOUNDARY_SPECS,
  findPort,
  nodeSpec,
  NODE_SPECS,
  NODE_TYPES,
  type NodeSpec,
  type PortKind,
  type PortSpec,
} from "./patch-nodes.ts";

export type { PortKind } from "./patch-nodes.ts";

/** The `Track.instrument` value that plays the track's `patch`. */
export const PATCH_INSTRUMENT = "patch";

export const PATCH_LIMITS = Object.freeze({
  maxNodes: 64,
  maxCables: 128,
  maxMacros: 16,
  maxPatches: 32,
  /** `patch.<name>` nodes nest at most this deep below the top patch. */
  maxDepth: 3,
  maxVoices: 32,
  defaultVoices: 16,
  maxIdLength: 32,
  maxNameLength: 64,
  maxLabelLength: 48,
  maxFxPatches: 4,
});

/** Rate is inferred, never stored (Bitwig's poly/mono coloring). */
export type Rate = "voice" | "global";

/** A node param value: spec-checked scalars, or an engine's settings object. */
export type PatchParamValue =
  number | string | boolean | Readonly<Record<string, unknown>>;

export type PatchNode = Readonly<{
  /** Unique in the patch; `[a-z][a-z0-9-]*`, at most 32 characters. */
  id: string;
  /** A NODE_SPECS type (`osc`, `fx.reverb`, `engine.modal`) or `patch.<name>`. */
  type: string;
  params?: Readonly<Record<string, PatchParamValue>>;
  /** Forces a node that could run per voice to run once per track. */
  rate?: "global";
  label?: string;
}>;

export type PortRef = `${string}.${string}`;

export type Cable = Readonly<{
  id: string;
  from: PortRef;
  to: PortRef;
  /** Into a control port: an attenuverter -1..1 on the cord (absent is 1). */
  amount?: number;
}>;

export type MacroTarget = Readonly<{
  /** A control input or a number param (`vcf.cutoff`, `lfo1.sync`). */
  port: PortRef;
  /** The target's value at the macro's minimum; absent maps the macro range. */
  min?: number;
  max?: number;
}>;

export type Macro = Readonly<{
  id: string;
  label?: string;
  min: number;
  max: number;
  default: number;
  curve?: "lin" | "exp";
  to: readonly MacroTarget[];
}>;

export type PatchRole = "instrument" | "effect";

export type Patch = Readonly<{
  kind: "patch";
  role: PatchRole;
  name: string;
  nodes: readonly PatchNode[];
  cables: readonly Cable[];
  /** At most 16; `macros[0..3]` are the four knobs, in this order. */
  macros: readonly Macro[];
  /** Polyphony cap (default 16). */
  voices?: number;
  /** Sidechain track id read through `in.side` (an audio edge). */
  side?: string;
  /** Effect patches: `post` runs after pan on the stereo pair. */
  at?: "post";
  /** Provenance, e.g. `pack:dawg/acid-bass@3`. */
  from?: string;
}>;

/** A track that plays a library patch with its own knob settings. */
export type PatchRef = Readonly<{
  kind: "patch";
  ref: string;
  /** Macro values by id, in macro units (absent keeps each default). */
  macros?: Readonly<Record<string, number>>;
  /** This track's sidechain (library patches never name a track). */
  side?: string;
}>;

export type TrackPatchValue = Patch | PatchRef;

/**
 * A fresh node id for a node of `type` (`osc-k2a…`): collision-free across
 * writers (core/ids.ts), so two actors adding nodes at once never clash.
 */
export function newNodeId(type: string): string {
  const head =
    type
      .replace(/^(fx|engine|patch)\./, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+/, "")
      .slice(0, PATCH_LIMITS.maxIdLength - 12) || "node";
  return newId(head);
}

/** A fresh cable id (`c-k2a…`), collision-free like `newNodeId`. */
export function newCableId(): string {
  return newId("c");
}

export function isPatchRef(value: TrackPatchValue): value is PatchRef {
  return "ref" in value;
}

/** Thrown for an invalid patch; messages name `node.port`. */
export class PatchValidationError extends FxValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PatchValidationError";
  }
}

const ID = /^[a-z][a-z0-9-]*$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

function fail(message: string): never {
  throw new PatchValidationError(message);
}

function suggest(word: string, vocabulary: Iterable<string>): string {
  const match = nearest(word, vocabulary);
  return match ? ` (did you mean "${match}"?)` : "";
}

function checkId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > PATCH_LIMITS.maxIdLength ||
    !ID.test(value)
  )
    fail(
      `${label} must be [a-z][a-z0-9-]*, at most ${PATCH_LIMITS.maxIdLength} characters`,
    );
  return value;
}

export function checkPatchName(
  value: unknown,
  label = "the name of a patch",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PATCH_LIMITS.maxNameLength ||
    !NAME.test(value)
  )
    fail(
      `${label} must be lowercase letters, digits and dashes, at most ${PATCH_LIMITS.maxNameLength} characters`,
    );
  return value;
}

function checkLabel(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PATCH_LIMITS.maxLabelLength
  )
    fail(`${label} must be 1..${PATCH_LIMITS.maxLabelLength} characters`);
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(`${label} must be a finite number`);
  return value;
}

/** Splits `node.port` at the first dot (`song.bar.phase` → song, bar.phase). */
export function splitPort(ref: string): [string, string] {
  const dot = ref.indexOf(".");
  return dot < 0 ? [ref, ""] : [ref.slice(0, dot), ref.slice(dot + 1)];
}

/** The automation lane a macro records to (`patch-<macro>`), knob position 0..1. */
export function patchLane(macroId: string): `patch-${string}` {
  return `patch-${macroId}`;
}

export function isPatchLane(value: unknown): value is `patch-${string}` {
  return (
    typeof value === "string" &&
    value.startsWith("patch-") &&
    value.length - 6 <= PATCH_LIMITS.maxIdLength &&
    ID.test(value.slice(6))
  );
}

/** A macro's value at knob position `position` 0..1 (lin, or exp for a ratio). */
export function macroAt(macro: Macro, position: number): number {
  const p = Math.min(1, Math.max(0, position));
  return macro.curve === "exp"
    ? macro.min * Math.pow(macro.max / macro.min, p)
    : macro.min + (macro.max - macro.min) * p;
}

/** The knob position 0..1 of a macro value (inverse of `macroAt`). */
export function macroPosition(macro: Macro, value: number): number {
  const v = Math.min(macro.max, Math.max(macro.min, value));
  const p =
    macro.curve === "exp"
      ? Math.log(v / macro.min) / Math.log(macro.max / macro.min)
      : (v - macro.min) / (macro.max - macro.min);
  return Number.isFinite(p) ? p : 0;
}

/** The boundary and library-aware port table a patch's nodes expose. */
type Resolver = (type: string) => NodeSpec | undefined;

/** Ports of a nested `patch.<name>` node: its boundary plus its macros. */
export function nestedSpec(patch: Patch): NodeSpec {
  const audio = (name: string, doc: string): PortSpec => ({
    name,
    kind: "audio",
    doc,
  });
  const inputs: PortSpec[] =
    patch.role === "instrument"
      ? [{ name: "notes", kind: "notes", doc: "notes into the patch" }]
      : [audio("audio", "audio in"), audio("right", "right in")];
  if (patch.side !== undefined || patch.role === "effect")
    inputs.push(audio("side", "sidechain in"));
  for (const macro of patch.macros)
    inputs.push({
      name: macro.id,
      kind: "control",
      spec: {
        kind: "number",
        min: macro.min,
        max: macro.max,
        default: macro.default,
        step: (macro.max - macro.min) / 100,
        doc: macro.label ?? macro.id,
      },
      doc: macro.label ?? macro.id,
    });
  return {
    type: `patch.${patch.name}`,
    family: "mix",
    doc: `the project patch ${patch.name}`,
    inputs,
    outputs: [audio("audio", "audio out"), audio("right", "right out")],
    params: {},
    rate: "any",
    process: "block",
    cost: 0,
  };
}

export type PatchContext = Readonly<{
  /** Project patches by name, for `patch.<name>` nodes (and depth checks). */
  library?: Readonly<Record<string, Patch>>;
  /**
   * Validates an engine node's settings (Track-field values such as
   * `{ modal: {...} }`); core/score.ts supplies its field normalizers.
   */
  engineSettings?: (
    fields: readonly string[],
    settings: Readonly<Record<string, unknown>>,
    label: string,
  ) => Readonly<Record<string, unknown>>;
  label?: string;
}>;

function resolverFor(context: PatchContext): Resolver {
  return (type) => {
    const spec = nodeSpec(type);
    if (spec) return spec;
    if (type.startsWith("patch.")) {
      const sub = context.library?.[type.slice(6)];
      return sub ? nestedSpec(sub) : undefined;
    }
    return undefined;
  };
}

function normalizeNode(
  input: unknown,
  index: number,
  resolve: Resolver,
  context: PatchContext,
): PatchNode {
  if (!isRecord(input)) fail(`node ${index + 1} must be an object`);
  for (const key of Object.keys(input))
    if (!["id", "type", "params", "rate", "label"].includes(key))
      fail(`node ${index + 1} has no field "${key}"`);
  const id = checkId(input.id, `node ${index + 1} id`);
  if (Object.prototype.hasOwnProperty.call(BOUNDARY_SPECS, id))
    fail(`node id "${id}" is reserved for the patch boundary`);
  if (typeof input.type !== "string") fail(`node ${id} needs a type`);
  const type = input.type;
  const spec = resolve(type);
  if (!spec) {
    if (type.startsWith("patch."))
      fail(
        `node ${id}: no project patch "${type.slice(6)}"${suggest(type.slice(6), Object.keys(context.library ?? {}))}`,
      );
    fail(`node ${id}: unknown node type "${type}"${suggest(type, NODE_TYPES)}`);
  }
  const params = normalizeNodeParams(id, spec, input.params, context);
  const rate = input.rate;
  if (rate !== undefined && rate !== "global")
    fail(`node ${id} rate must be "global"`);
  if (rate === "global" && spec.rate === "voice")
    fail(`node ${id} (${type}) always runs per voice`);
  const label = checkLabel(input.label, `node ${id} label`);
  return Object.freeze({
    id,
    type,
    ...(params ? { params } : {}),
    ...(rate === "global" && spec.rate === "any"
      ? { rate: "global" as const }
      : {}),
    ...(label !== undefined ? { label } : {}),
  });
}

function normalizeNodeParams(
  id: string,
  spec: NodeSpec,
  input: unknown,
  context: PatchContext,
): Readonly<Record<string, PatchParamValue>> | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) fail(`node ${id} params must be an object`);
  const names = Object.keys(spec.params);
  const allowed = spec.engine ? [...names, "settings"] : names;
  for (const key of Object.keys(input))
    if (!allowed.includes(key))
      fail(
        `node ${id} (${spec.type}) has no param "${key}"${suggest(key, allowed)}`,
      );
  const out: Record<string, PatchParamValue> = {};
  for (const [name, param] of Object.entries(spec.params)) {
    const value = input[name];
    if (value === undefined) continue;
    // An engine that plays any instrument word (engine.synth: every synth
    // sound, legacy voice, drum kit, sampler or wavetable) takes a word.
    if (
      name === "instrument" &&
      spec.engine &&
      spec.engine.instruments.length === 0
    ) {
      if (
        typeof value !== "string" ||
        value.trim() === "" ||
        value.length > PATCH_LIMITS.maxNameLength
      )
        fail(
          `node ${id}.instrument must be an instrument word (at most ${PATCH_LIMITS.maxNameLength} characters)`,
        );
      out[name] = value.trim();
      continue;
    }
    try {
      out[name] = normalizeParam(param, value, `${id}.${name}`);
    } catch (error) {
      if (error instanceof FxValidationError) fail(error.message);
      throw error;
    }
  }
  if (spec.engine && input.settings !== undefined) {
    const settings = input.settings;
    if (!isRecord(settings)) fail(`node ${id} settings must be an object`);
    for (const key of Object.keys(settings))
      if (!spec.engine.fields.includes(key))
        fail(
          `node ${id} (${spec.type}) settings have no field "${key}"${suggest(key, spec.engine.fields)}`,
        );
    const checked = context.engineSettings
      ? context.engineSettings(spec.engine.fields, settings, `node ${id}`)
      : settings;
    if (Object.keys(checked).length > 0) out.settings = Object.freeze(checked);
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

type Endpoint = Readonly<{ node: string; port: PortSpec; spec: NodeSpec }>;

/** Looks up `node.port` among the patch's nodes and the boundary. */
function endpoint(
  ref: unknown,
  dir: "in" | "out",
  label: string,
  nodes: ReadonlyMap<string, NodeSpec>,
): Endpoint {
  if (typeof ref !== "string" || !ref.includes("."))
    fail(`${label} must name node.port`);
  const [id, name] = splitPort(ref);
  const spec = nodes.get(id) ?? BOUNDARY_SPECS[id];
  if (!spec || (BOUNDARY_SPECS[id] && nodes.has(id)))
    fail(
      `${label}: no node "${id}"${suggest(id, [...nodes.keys(), ...Object.keys(BOUNDARY_SPECS)])}`,
    );
  if (id === "song" && dir === "out" && name.startsWith("lane.")) {
    const lane = name.slice(5);
    if (!/^[a-z][a-z0-9-]*$/.test(lane))
      fail(`${label}: song.lane needs an automation lane name`);
    return {
      node: id,
      port: { name, kind: "control", doc: `the ${lane} lane` },
      spec,
    };
  }
  const port = findPort(spec, name, dir);
  if (!port) {
    const other = findPort(spec, name, dir === "in" ? "out" : "in");
    if (other)
      fail(
        `${label}: ${id}.${name} is an ${dir === "in" ? "output" : "input"}, not an ${dir === "in" ? "input" : "output"}`,
      );
    const names = (dir === "in" ? spec.inputs : spec.outputs).map(
      (candidate) => candidate.name,
    );
    fail(
      `${label}: no ${dir === "in" ? "input" : "output"} port "${name}" on ${id} (${spec.type})${suggest(name, names)}`,
    );
  }
  return { node: id, port, spec };
}

/** The §3.3 kind rules: undefined when legal, else the reason. */
export function cableKindError(
  from: PortKind,
  to: PortKind,
  toRef: string,
): string | undefined {
  if (from === "notes" && to !== "notes")
    return `notes cable into ${to} port ${toRef}: use a voice source (voice.note, voice.velocity)`;
  if (from !== "notes" && to === "notes")
    return `${from} cable into notes port ${toRef}: only notes flow into notes ports`;
  return undefined;
}

function normalizeCable(
  input: unknown,
  index: number,
  nodes: ReadonlyMap<string, NodeSpec>,
): Cable {
  if (!isRecord(input)) fail(`cable ${index + 1} must be an object`);
  for (const key of Object.keys(input))
    if (!["id", "from", "to", "amount"].includes(key))
      fail(`cable ${index + 1} has no field "${key}"`);
  const id = checkId(input.id, `cable ${index + 1} id`);
  const from = endpoint(input.from, "out", `cable ${id} from`, nodes);
  const to = endpoint(input.to, "in", `cable ${id} to`, nodes);
  const toRef = `${to.node}.${to.port.name}`;
  const kindError = cableKindError(from.port.kind, to.port.kind, toRef);
  if (kindError) fail(`cable ${id}: ${kindError}`);
  let amount: number | undefined;
  if (input.amount !== undefined) {
    if (to.port.kind !== "control")
      fail(
        `cable ${id}: amount only scales cables into control ports (${toRef} is ${to.port.kind})`,
      );
    amount = finite(input.amount, `cable ${id} amount`);
    if (amount < -1 || amount > 1) fail(`cable ${id} amount must be -1..1`);
  }
  return Object.freeze({
    id,
    from: `${from.node}.${from.port.name}` as PortRef,
    to: toRef as PortRef,
    ...(amount !== undefined && amount !== 1 ? { amount } : {}),
  });
}

/** A macro target's port: a control input or a number param of the node. */
function targetRange(
  ref: unknown,
  label: string,
  nodes: ReadonlyMap<string, NodeSpec>,
): Readonly<{ ref: PortRef; min: number; max: number }> {
  if (typeof ref !== "string" || !ref.includes("."))
    fail(`${label} must name node.port`);
  const [id, name] = splitPort(ref);
  const spec = nodes.get(id);
  if (!spec) fail(`${label}: no node "${id}"${suggest(id, [...nodes.keys()])}`);
  const port = findPort(spec, name, "in");
  if (port?.kind === "control" && port.spec)
    return { ref: ref as PortRef, min: port.spec.min, max: port.spec.max };
  const param = spec.params[name];
  if (param?.kind === "number")
    return { ref: ref as PortRef, min: param.min, max: param.max };
  const names = [
    ...spec.inputs.filter((p) => p.kind === "control").map((p) => p.name),
    ...Object.entries(spec.params)
      .filter(([, p]) => p.kind === "number")
      .map(([n]) => n),
  ];
  fail(
    `${label}: ${id}.${name} is not a control input or number param of ${spec.type}${suggest(name, names)}`,
  );
}

function normalizeMacro(
  input: unknown,
  index: number,
  nodes: ReadonlyMap<string, NodeSpec>,
): Macro {
  if (!isRecord(input)) fail(`macro ${index + 1} must be an object`);
  for (const key of Object.keys(input))
    if (!["id", "label", "min", "max", "default", "curve", "to"].includes(key))
      fail(`macro ${index + 1} has no field "${key}"`);
  const id = checkId(input.id, `macro ${index + 1} id`);
  const label = checkLabel(input.label, `macro ${id} label`);
  const min = finite(input.min ?? 0, `macro ${id} min`);
  const max = finite(input.max ?? 1, `macro ${id} max`);
  if (!(max > min)) fail(`macro ${id} max must be above min`);
  const curve = input.curve;
  if (curve !== undefined && curve !== "lin" && curve !== "exp")
    fail(`macro ${id} curve must be lin or exp`);
  if (curve === "exp" && min <= 0)
    fail(`macro ${id}: an exp curve needs min above 0`);
  // The default is clamped into the macro's own range.
  const value = Math.min(
    max,
    Math.max(min, finite(input.default ?? min, `macro ${id} default`)),
  );
  if (!Array.isArray(input.to)) fail(`macro ${id} to must be a list`);
  const seen = new Set<string>();
  const to = input.to.map((target: unknown, at: number): MacroTarget => {
    const where = `macro ${id} target ${at + 1}`;
    if (!isRecord(target)) fail(`${where} must be an object`);
    for (const key of Object.keys(target))
      if (!["port", "min", "max"].includes(key))
        fail(`${where} has no field "${key}"`);
    const range = targetRange(target.port, where, nodes);
    if (seen.has(range.ref)) fail(`macro ${id} targets ${range.ref} twice`);
    seen.add(range.ref);
    // Target ranges are clamped to what the port accepts.
    const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
    const lo =
      target.min === undefined
        ? undefined
        : clamp(finite(target.min, `${where} min`));
    const hi =
      target.max === undefined
        ? undefined
        : clamp(finite(target.max, `${where} max`));
    return Object.freeze({
      port: range.ref,
      ...(lo !== undefined ? { min: lo } : {}),
      ...(hi !== undefined ? { max: hi } : {}),
    });
  });
  return Object.freeze({
    id,
    ...(label !== undefined ? { label } : {}),
    min,
    max,
    default: value,
    ...(curve === "exp" ? { curve: "exp" as const } : {}),
    to: Object.freeze(to),
  });
}

/** Canonical cable order: by destination, then source, then id. */
export function compareCables(a: Cable, b: Cable): number {
  return a.to < b.to
    ? -1
    : a.to > b.to
      ? 1
      : a.from < b.from
        ? -1
        : a.from > b.from
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
}

/**
 * Validates and canonicalises a patch (throws PatchValidationError). Node
 * order is kept, cables are sorted, macros keep their order (the knobs),
 * absent optional fields stay absent.
 */
export function validatePatch(
  input: unknown,
  context: PatchContext = {},
): Patch {
  const where = context.label ?? "patch";
  if (!isRecord(input)) fail(`${where} must be an object`);
  for (const key of Object.keys(input))
    if (
      ![
        "kind",
        "role",
        "name",
        "nodes",
        "cables",
        "macros",
        "voices",
        "side",
        "at",
        "from",
      ].includes(key)
    )
      fail(`${where} has no field "${key}"`);
  if (input.kind !== "patch") fail(`${where} kind must be "patch"`);
  const role = input.role ?? "instrument";
  if (role !== "instrument" && role !== "effect")
    fail(`${where} role must be instrument or effect`);
  const name = checkPatchName(input.name, `${where} name`);
  const nodesIn = input.nodes ?? [];
  const cablesIn = input.cables ?? [];
  const macrosIn = input.macros ?? [];
  if (
    !Array.isArray(nodesIn) ||
    !Array.isArray(cablesIn) ||
    !Array.isArray(macrosIn)
  )
    fail(`${name}: nodes, cables and macros must be lists`);
  if (nodesIn.length > PATCH_LIMITS.maxNodes)
    fail(`${name} holds at most ${PATCH_LIMITS.maxNodes} nodes`);
  if (cablesIn.length > PATCH_LIMITS.maxCables)
    fail(`${name} holds at most ${PATCH_LIMITS.maxCables} cables`);
  if (macrosIn.length > PATCH_LIMITS.maxMacros)
    fail(`${name} holds at most ${PATCH_LIMITS.maxMacros} macros`);
  const resolve = resolverFor(context);
  const nodes = nodesIn.map((node: unknown, index: number) =>
    normalizeNode(node, index, resolve, context),
  );
  const specs = new Map<string, NodeSpec>();
  for (const node of nodes) {
    if (specs.has(node.id)) fail(`${name} has two nodes with id ${node.id}`);
    specs.set(node.id, resolve(node.type)!);
    if (role === "effect" && specs.get(node.id)!.family === "engine")
      fail(
        `node ${node.id}: an effect patch cannot hold an engine (${node.type})`,
      );
  }
  const cables = cablesIn.map((cable: unknown, index: number) =>
    normalizeCable(cable, index, specs),
  );
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const cable of cables) {
    if (ids.has(cable.id)) fail(`${name} has two cables with id ${cable.id}`);
    ids.add(cable.id);
    const pair = `${cable.from}>${cable.to}`;
    if (pairs.has(pair)) fail(`${cable.from} is already wired to ${cable.to}`);
    pairs.add(pair);
    const [source, port] = splitPort(cable.from);
    if (
      role === "effect" &&
      (source === "voice" || (source === "in" && port === "notes"))
    )
      fail(`cable ${cable.id}: an effect patch has no ${cable.from}`);
    if (
      role === "instrument" &&
      source === "in" &&
      (port === "audio" || port === "right")
    )
      fail(
        `cable ${cable.id}: an instrument patch has no ${cable.from} (use in.notes)`,
      );
  }
  cables.sort(compareCables);
  const macros = macrosIn.map((macro: unknown, index: number) =>
    normalizeMacro(macro, index, specs),
  );
  const macroIds = new Set<string>();
  for (const macro of macros) {
    if (macroIds.has(macro.id))
      fail(`${name} has two macros with id ${macro.id}`);
    macroIds.add(macro.id);
  }
  let voices: number | undefined;
  if (input.voices !== undefined) {
    voices = finite(input.voices, `${name} voices`);
    if (
      !Number.isInteger(voices) ||
      voices < 1 ||
      voices > PATCH_LIMITS.maxVoices
    )
      fail(`${name} voices must be an integer 1..${PATCH_LIMITS.maxVoices}`);
  }
  let side: string | undefined;
  if (input.side !== undefined) {
    if (typeof input.side !== "string" || input.side.length === 0)
      fail(`${name} side must name a track`);
    side = input.side;
  }
  if (input.at !== undefined && (input.at !== "post" || role !== "effect"))
    fail(`${name} at must be "post" (effect patches only)`);
  let from: string | undefined;
  if (input.from !== undefined) {
    if (
      typeof input.from !== "string" ||
      input.from.length === 0 ||
      input.from.length > 128
    )
      fail(`${name} from must be 1..128 characters`);
    from = input.from;
  }
  const patch: Patch = Object.freeze({
    kind: "patch" as const,
    role,
    name,
    nodes: Object.freeze(nodes),
    cables: Object.freeze(cables),
    macros: Object.freeze(macros),
    ...(voices !== undefined ? { voices } : {}),
    ...(side !== undefined ? { side } : {}),
    ...(input.at === "post" ? { at: "post" as const } : {}),
    ...(from !== undefined ? { from } : {}),
  });
  if (context.library) patchDepth(patch, context.library);
  return patch;
}

/** Validates a track's patch value: an inline patch or a library reference. */
export function validatePatchValue(
  input: unknown,
  context: PatchContext = {},
): TrackPatchValue {
  if (isRecord(input) && input.ref !== undefined) {
    for (const key of Object.keys(input))
      if (!["kind", "ref", "macros", "side"].includes(key))
        fail(`patch reference has no field "${key}"`);
    if (input.kind !== "patch") fail(`patch reference kind must be "patch"`);
    const ref = checkPatchName(input.ref, "patch reference");
    const target = context.library?.[ref];
    if (context.library && !target)
      fail(
        `no project patch "${ref}"${suggest(ref, Object.keys(context.library))}`,
      );
    let macros: Record<string, number> | undefined;
    if (input.macros !== undefined) {
      if (!isRecord(input.macros))
        fail(`patch ${ref} macros must be an object`);
      macros = {};
      const order = target
        ? target.macros.map((macro) => macro.id)
        : Object.keys(input.macros).sort();
      for (const key of Object.keys(input.macros))
        checkId(key, `patch ${ref} macro`);
      for (const key of order) {
        const value = input.macros[key];
        if (value === undefined) continue;
        const macro = target?.macros.find((candidate) => candidate.id === key);
        const n = finite(value, `patch ${ref} macro ${key}`);
        macros[key] = macro ? Math.min(macro.max, Math.max(macro.min, n)) : n;
      }
    }
    let side: string | undefined;
    if (input.side !== undefined) {
      if (typeof input.side !== "string" || input.side.length === 0)
        fail(`patch ${ref} side must name a track`);
      side = input.side;
    }
    return Object.freeze({
      kind: "patch" as const,
      ref,
      ...(macros && Object.keys(macros).length > 0
        ? { macros: Object.freeze(macros) }
        : {}),
      ...(side !== undefined ? { side } : {}),
    });
  }
  return validatePatch(input, context);
}

/** The patch a track value plays (a reference resolved through the library). */
export function resolvePatch(
  value: TrackPatchValue,
  library: Readonly<Record<string, Patch>> = {},
): Patch | undefined {
  return isPatchRef(value) ? library[value.ref] : value;
}

/**
 * How deep `patch.<name>` nodes nest below `patch` (0 without any). Throws
 * on a reference cycle or when deeper than PATCH_LIMITS.maxDepth.
 */
export function patchDepth(
  patch: Patch,
  library: Readonly<Record<string, Patch>>,
  stack: readonly string[] = [patch.name],
): number {
  let depth = 0;
  for (const node of patch.nodes) {
    if (!node.type.startsWith("patch.")) continue;
    const name = node.type.slice(6);
    if (stack.includes(name))
      fail(`patch ${[...stack, name].join(" -> ")} nests itself`);
    const sub = library[name];
    if (!sub) fail(`node ${node.id}: no project patch "${name}"`);
    depth = Math.max(depth, 1 + patchDepth(sub, library, [...stack, name]));
  }
  if (depth > PATCH_LIMITS.maxDepth)
    fail(
      `patch ${patch.name} nests ${depth} deep (at most ${PATCH_LIMITS.maxDepth})`,
    );
  return depth;
}

/** Node specs of a patch's own nodes and its boundary, by id. */
export function patchSpecs(
  patch: Patch,
  library: Readonly<Record<string, Patch>> = {},
): ReadonlyMap<string, NodeSpec> {
  const resolve = resolverFor({ library });
  const out = new Map<string, NodeSpec>(Object.entries(BOUNDARY_SPECS));
  for (const node of patch.nodes) {
    const spec = resolve(node.type);
    if (spec) out.set(node.id, spec);
  }
  return out;
}

export type RateAnalysis = Readonly<{
  /** Every node's rate, boundary nodes included. */
  rates: ReadonlyMap<string, Rate>;
  /** Cables from a voice node into a global node: summed over voices. */
  voiceSums: readonly string[];
  /** Cables from a global node into a voice node: one value fans out. */
  fanOuts: readonly string[];
}>;

/**
 * Bitwig-style rate coloring: a node runs per voice when it reads a voice
 * source or a voice node upstream, unless it (or its type) is global.
 * Monotone, so it settles in at most one pass per node, cycles included.
 */
export function inferRates(
  patch: Patch,
  library: Readonly<Record<string, Patch>> = {},
): RateAnalysis {
  const specs = patchSpecs(patch, library);
  const forced = new Set(
    patch.nodes.filter((node) => node.rate === "global").map((node) => node.id),
  );
  const rates = new Map<string, Rate>();
  for (const [id, spec] of specs)
    rates.set(id, spec.rate === "voice" ? "voice" : "global");
  const canVoice = (id: string) =>
    specs.get(id)?.rate === "any" && !forced.has(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cable of patch.cables) {
      const [from] = splitPort(cable.from);
      const [to] = splitPort(cable.to);
      if (
        rates.get(from) === "voice" &&
        rates.get(to) !== "voice" &&
        canVoice(to)
      ) {
        rates.set(to, "voice");
        changed = true;
      }
    }
  }
  const voiceSums: string[] = [];
  const fanOuts: string[] = [];
  for (const cable of patch.cables) {
    const from = rates.get(splitPort(cable.from)[0]);
    const to = rates.get(splitPort(cable.to)[0]);
    if (from === "voice" && to === "global") voiceSums.push(cable.id);
    if (from === "global" && to === "voice") fanOuts.push(cable.id);
  }
  return { rates, voiceSums, fanOuts };
}

export type CycleReport = Readonly<{
  /** Each feedback loop's nodes (a strongly connected component), sorted. */
  cycles: readonly (readonly string[])[];
  /**
   * The cables the runner delays by one 32-sample block so the rest of the
   * graph can be ordered: in each loop, the cable into its lowest node id
   * from inside the loop, lowest (to, from, id) first.
   */
  breaks: readonly string[];
}>;

/**
 * Feedback loops (Tarjan's strongly connected components) and the
 * deterministic edge each one is broken at. Breaking repeats until the
 * remaining graph is acyclic, so nested loops each get their own break.
 */
const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function findCycles(patch: Patch): CycleReport {
  const order = new Set(patch.nodes.map((node) => node.id));
  const cycles: string[][] = [];
  const breaks: string[] = [];
  let live = patch.cables.filter(
    (cable) =>
      order.has(splitPort(cable.from)[0]) && order.has(splitPort(cable.to)[0]),
  );
  for (let guard = 0; guard <= live.length; guard += 1) {
    const components = stronglyConnected(
      patch.nodes.map((n) => n.id),
      live,
    );
    const loops = components.filter(
      (component) =>
        component.length > 1 ||
        live.some(
          (cable) =>
            splitPort(cable.from)[0] === component[0] &&
            splitPort(cable.to)[0] === component[0],
        ),
    );
    if (loops.length === 0) break;
    const broken = new Set<string>();
    for (const loop of loops) {
      const members = new Set(loop);
      if (guard === 0) cycles.push([...loop].sort());
      // Content order, not list order, so reordering nodes in the input
      // never moves the break: the lowest node id, then the lowest
      // (to, from, id) cable into it from inside the loop.
      const head = [...loop].sort(compareText)[0]!;
      const edge = live
        .filter(
          (cable) =>
            splitPort(cable.to)[0] === head &&
            members.has(splitPort(cable.from)[0]),
        )
        .sort(
          (a, b) =>
            compareText(a.to, b.to) ||
            compareText(a.from, b.from) ||
            compareText(a.id, b.id),
        )[0]!;
      broken.add(edge.id);
      breaks.push(edge.id);
    }
    live = live.filter((cable) => !broken.has(cable.id));
  }
  cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  return { cycles, breaks: breaks.sort() };
}

function stronglyConnected(
  ids: readonly string[],
  cables: readonly Cable[],
): string[][] {
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const cable of cables)
    next.get(splitPort(cable.from)[0])?.push(splitPort(cable.to)[0]);
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const to of next.get(id) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(id, Math.min(low.get(id)!, low.get(to)!));
      } else if (onStack.has(to))
        low.set(id, Math.min(low.get(id)!, index.get(to)!));
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      out.push(component);
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return out;
}

/** Removes a node and every cable and macro target that touches it. */
export function withoutNode(patch: Patch, nodeId: string): Patch {
  const touches = (ref: string) => splitPort(ref)[0] === nodeId;
  return Object.freeze({
    ...patch,
    nodes: Object.freeze(patch.nodes.filter((node) => node.id !== nodeId)),
    cables: Object.freeze(
      patch.cables.filter(
        (cable) => !touches(cable.from) && !touches(cable.to),
      ),
    ),
    macros: Object.freeze(
      patch.macros.map((macro) =>
        macro.to.some((target) => touches(target.port))
          ? Object.freeze({
              ...macro,
              to: Object.freeze(
                macro.to.filter((target) => !touches(target.port)),
              ),
            })
          : macro,
      ),
    ),
  });
}

/** Drops cables and macro targets that no longer fit (not validated). */
function prune(patch: Patch, context: PatchContext): Patch {
  const specs = patchSpecs(patch, context.library);
  const fits = (ref: string, dir: "in" | "out"): boolean => {
    const [id, name] = splitPort(ref);
    const spec = specs.get(id);
    if (!spec) return false;
    if (dir === "out" && id === "song" && name.startsWith("lane.")) return true;
    return findPort(spec, name, dir) !== undefined;
  };
  const target = (ref: string): boolean => {
    const [id, name] = splitPort(ref);
    const spec = specs.get(id);
    if (!spec || BOUNDARY_SPECS[id]) return false;
    const port = findPort(spec, name, "in");
    return port?.kind === "control" || spec.params[name]?.kind === "number";
  };
  return {
    ...patch,
    cables: patch.cables.filter(
      (cable) => fits(cable.from, "out") && fits(cable.to, "in"),
    ),
    macros: patch.macros.map((macro) => ({
      ...macro,
      to: macro.to.filter((t) => target(t.port)),
    })),
  };
}

/**
 * One edit to a patch, the payload of the node-, cable- and macro-level
 * score operations. Each names one object by id, so two writers editing
 * different cables of one patch never collide under last-writer-wins.
 */
export type PatchEdit =
  | Readonly<{ kind: "node"; nodeId: string; node: PatchNode | null }>
  | Readonly<{ kind: "cable"; cableId: string; cable: Cable | null }>
  | Readonly<{
      kind: "macro";
      macroId: string;
      macro: Macro | null;
      /** Knob position to insert (or move) the macro to; absent keeps or appends. */
      index?: number;
    }>;

/**
 * Applies one edit and re-validates. Removing a node unplugs its cables and
 * macro targets; re-typing a node unplugs what no longer fits. A cable
 * whose node is gone (removed by a concurrent writer) is dropped rather
 * than rejected, so a replayed log never fails on an edit that lost a race.
 * Every other invalid edit throws PatchValidationError.
 */
export function applyPatchEdit(
  patch: Patch,
  edit: PatchEdit,
  context: PatchContext = {},
): Patch {
  if (edit.kind === "node") {
    if (edit.node === null) return withoutNode(patch, edit.nodeId);
    if (edit.node.id !== edit.nodeId)
      fail(`node edit ${edit.nodeId} carries node ${edit.node.id}`);
    const at = patch.nodes.findIndex((node) => node.id === edit.nodeId);
    const nodes =
      at < 0
        ? [...patch.nodes, edit.node]
        : patch.nodes.map((node, index) => (index === at ? edit.node! : node));
    const draft = { ...patch, nodes };
    // Check the node alone first so its own errors are reported as such.
    validatePatch({ ...draft, cables: [], macros: [] }, context);
    return validatePatch(prune(draft, context), context);
  }
  if (edit.kind === "cable") {
    const rest = patch.cables.filter((cable) => cable.id !== edit.cableId);
    if (edit.cable === null)
      return rest.length === patch.cables.length
        ? patch
        : Object.freeze({ ...patch, cables: Object.freeze(rest) });
    if (edit.cable.id !== edit.cableId)
      fail(`cable edit ${edit.cableId} carries cable ${edit.cable.id}`);
    const ids = new Set([
      ...patch.nodes.map((node) => node.id),
      ...Object.keys(BOUNDARY_SPECS),
    ]);
    if (
      typeof edit.cable.from === "string" &&
      typeof edit.cable.to === "string" &&
      (!ids.has(splitPort(edit.cable.from)[0]) ||
        !ids.has(splitPort(edit.cable.to)[0]))
    )
      return patch;
    return validatePatch({ ...patch, cables: [...rest, edit.cable] }, context);
  }
  const at = patch.macros.findIndex((macro) => macro.id === edit.macroId);
  const rest = patch.macros.filter((macro) => macro.id !== edit.macroId);
  if (edit.macro === null)
    return at < 0
      ? patch
      : Object.freeze({ ...patch, macros: Object.freeze(rest) });
  if (edit.macro.id !== edit.macroId)
    fail(`macro edit ${edit.macroId} carries macro ${edit.macro.id}`);
  const place =
    edit.index !== undefined
      ? Math.max(
          0,
          Math.min(rest.length, Math.trunc(finite(edit.index, "macro index"))),
        )
      : at < 0
        ? rest.length
        : at;
  const macros = [...rest];
  macros.splice(place, 0, edit.macro);
  return validatePatch({ ...patch, macros }, context);
}

/**
 * Validates the project library: names match their keys, `patch.<name>`
 * nodes resolve inside it, nesting stays within depth and never cycles.
 * Keys come back sorted.
 */
export function validateLibrary(
  input: unknown,
  context: Omit<PatchContext, "library" | "label"> = {},
): Readonly<Record<string, Patch>> {
  if (input === undefined || input === null) return Object.freeze({});
  if (!isRecord(input)) fail("score patches must be an object");
  const names = Object.keys(input).sort();
  if (names.length > PATCH_LIMITS.maxPatches)
    fail(`a project holds at most ${PATCH_LIMITS.maxPatches} patches`);
  const raw: Record<string, Record<string, unknown>> = {};
  for (const name of names) {
    checkPatchName(name, `project patch "${name}"`);
    const value = input[name];
    if (!isRecord(value)) fail(`project patch ${name} must be an object`);
    if (value.name !== undefined && value.name !== name)
      fail(`project patch ${name} is named ${String(value.name)}`);
    if (value.side !== undefined)
      fail(
        `project patch ${name}: side names a track, so set it on the track's patch`,
      );
    raw[name] = { ...value, name };
  }
  const done: Record<string, Patch> = {};
  const visit = (name: string, stack: readonly string[]): Patch => {
    if (done[name]) return done[name];
    if (stack.includes(name))
      fail(`patch ${[...stack, name].join(" -> ")} nests itself`);
    const value = raw[name]!;
    const nodes = Array.isArray(value.nodes) ? value.nodes : [];
    for (const node of nodes)
      if (
        isRecord(node) &&
        typeof node.type === "string" &&
        node.type.startsWith("patch.")
      ) {
        const sub = node.type.slice(6);
        if (raw[sub]) visit(sub, [...stack, name]);
      }
    done[name] = validatePatch(value, {
      ...context,
      library: done,
      label: `project patch ${name}`,
    });
    return done[name];
  };
  for (const name of names) visit(name, []);
  const out: Record<string, Patch> = {};
  for (const name of names) out[name] = done[name]!;
  return Object.freeze(out);
}

/**
 * Removes a library patch without breaking what used it: tracks that
 * referenced it get an inline copy (their macro settings become its
 * defaults) and `patch.<name>` nodes in other patches are removed.
 */
export function detachPatch(
  value: TrackPatchValue,
  name: string,
  removed: Patch,
): TrackPatchValue {
  if (isPatchRef(value)) {
    if (value.ref !== name) return value;
    return Object.freeze({
      ...removed,
      ...(value.side !== undefined ? { side: value.side } : {}),
      macros: Object.freeze(
        removed.macros.map((macro) =>
          value.macros?.[macro.id] === undefined
            ? macro
            : Object.freeze({ ...macro, default: value.macros[macro.id]! }),
        ),
      ),
    });
  }
  return withoutNested(value, name);
}

/** The patch without its `patch.<name>` nodes. */
export function withoutNested(patch: Patch, name: string): Patch {
  let out = patch;
  for (const node of patch.nodes)
    if (node.type === `patch.${name}`) out = withoutNode(out, node.id);
  return out;
}

/** Every sidechain track a track's patches read (`side`). */
export function patchSides(
  patch: TrackPatchValue | undefined,
  fx: readonly Patch[] | undefined,
): string[] {
  const out: string[] = [];
  if (patch?.side !== undefined) out.push(patch.side);
  for (const stage of fx ?? [])
    if (stage.side !== undefined) out.push(stage.side);
  return out;
}

/**
 * A track or library patch refitted after the library changed: cables and
 * macro targets on a nested patch's vanished macro are unplugged, and a
 * reference forgets macro values the library patch no longer has.
 */
export function refitPatchValue<T extends TrackPatchValue>(
  value: T,
  library: Readonly<Record<string, Patch>>,
): T {
  if (isPatchRef(value)) {
    const target = library[value.ref];
    if (!target || !value.macros) return value;
    const ids = new Set(target.macros.map((macro) => macro.id));
    const kept = Object.entries(value.macros).filter(([id]) => ids.has(id));
    if (kept.length === Object.keys(value.macros).length) return value;
    const { macros: _old, ...rest } = value;
    return Object.freeze({
      ...rest,
      ...(kept.length > 0
        ? { macros: Object.freeze(Object.fromEntries(kept)) }
        : {}),
    }) as T;
  }
  if (!value.nodes.some((node) => node.type.startsWith("patch."))) return value;
  return prune(value, { library }) as T;
}

/**
 * The edits that turn patch `a` into patch `b` (same target), or undefined
 * when only a whole-patch write can (role, voices, side or node order
 * changed, or an edit would not apply). Applying the edits in order with
 * `applyPatchEdit` gives a patch deep-equal to `b`.
 */
export function patchEdits(
  a: Patch,
  b: Patch,
  context: PatchContext = {},
): PatchEdit[] | undefined {
  const meta = (p: Patch) =>
    JSON.stringify([p.role, p.name, p.voices, p.side, p.at, p.from]);
  if (meta(a) !== meta(b)) return undefined;
  const bIds = new Set(b.nodes.map((node) => node.id));
  const kept = a.nodes
    .filter((node) => bIds.has(node.id))
    .map((node) => node.id);
  const aIds = new Set(kept);
  const order = [
    ...kept,
    ...b.nodes.filter((node) => !aIds.has(node.id)).map((node) => node.id),
  ];
  if (order.join(" ") !== b.nodes.map((node) => node.id).join(" "))
    return undefined;
  const edits: PatchEdit[] = [];
  let work = a;
  const apply = (edit: PatchEdit): void => {
    work = applyPatchEdit(work, edit, context);
    edits.push(edit);
  };
  try {
    for (const node of a.nodes)
      if (!bIds.has(node.id))
        apply({ kind: "node", nodeId: node.id, node: null });
    for (const node of b.nodes) {
      const current = work.nodes.find((candidate) => candidate.id === node.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(node))
        apply({ kind: "node", nodeId: node.id, node });
    }
    const bCables = new Map(b.cables.map((cable) => [cable.id, cable]));
    for (const cable of work.cables)
      if (!bCables.has(cable.id))
        apply({ kind: "cable", cableId: cable.id, cable: null });
    for (const cable of b.cables) {
      const current = work.cables.find(
        (candidate) => candidate.id === cable.id,
      );
      if (!current || JSON.stringify(current) !== JSON.stringify(cable))
        apply({ kind: "cable", cableId: cable.id, cable });
    }
    const bMacros = new Set(b.macros.map((macro) => macro.id));
    for (const macro of work.macros)
      if (!bMacros.has(macro.id))
        apply({ kind: "macro", macroId: macro.id, macro: null });
    b.macros.forEach((macro, index) => {
      const current = work.macros[index];
      if (!current || JSON.stringify(current) !== JSON.stringify(macro))
        apply({ kind: "macro", macroId: macro.id, macro, index });
    });
  } catch (error) {
    if (error instanceof FxValidationError) return undefined;
    throw error;
  }
  return JSON.stringify(work) === JSON.stringify(b) ? edits : undefined;
}

/** The Track fields `patchFromTrack` reads (the instrument word and its settings). */
export type WrappableTrack = Readonly<{ instrument: string }> &
  Readonly<Record<string, unknown>>;

/**
 * The engine node type that plays `instrument`: the engine whose binding
 * names the word and whose settings field the track carries, else
 * `engine.synth` (synth sounds, legacy voices, drum kits, samplers and
 * wavetables).
 */
export function engineTypeFor(track: WrappableTrack): string {
  for (const spec of Object.values(NODE_SPECS)) {
    const binding = spec.engine;
    if (!binding || binding.instruments.length === 0) continue;
    if (
      binding.instruments.includes(track.instrument) &&
      binding.fields.some((field) => isRecord(track[field]))
    )
      return spec.type;
  }
  return "engine.synth";
}

/**
 * "Convert instrument to patch" (design §9 step 1): a one-node instrument
 * patch that plays the track's instrument through its `engine.*` node,
 * with the track's settings fields copied into the node. Wired as
 * `in.notes → engine → out.audio / out.right`, it renders bit-identical
 * to the track (a mono engine's right output equals its left, and a patch
 * whose channels match plays mono). The track's stock effect chain stays
 * on the track. Fresh node and cable ids (core/ids.ts).
 */
export function patchFromTrack(track: WrappableTrack): Patch {
  const type = engineTypeFor(track);
  const spec = NODE_SPECS[type]!;
  const settings: Record<string, unknown> = {};
  for (const field of spec.engine!.fields)
    if (isRecord(track[field])) settings[field] = track[field];
  const id = newNodeId(type);
  const params: Record<string, PatchParamValue> = {
    instrument: track.instrument,
    ...(Object.keys(settings).length > 0
      ? { settings: settings as PatchParamValue }
      : {}),
  };
  const word = track.instrument
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, PATCH_LIMITS.maxNameLength);
  return {
    kind: "patch",
    role: "instrument",
    name: word || "instrument",
    nodes: [{ id, type, params }],
    cables: [
      { id: newCableId(), from: "in.notes", to: `${id}.notes` },
      { id: newCableId(), from: `${id}.out`, to: "out.audio" },
      { id: newCableId(), from: `${id}.right`, to: "out.right" },
    ],
    macros: [],
  };
}

/** Every Track field an engine node reads its settings from. */
const ENGINE_FIELDS: readonly string[] = [
  ...new Set(
    Object.values(NODE_SPECS).flatMap((spec) => spec.engine?.fields ?? []),
  ),
].sort();

/**
 * The track an `engine.*` node plays as: the patch track without its patch,
 * effect patches, clips or any engine settings field, then the node's
 * instrument word and settings. Everything else (performance, tuning,
 * automation lanes) carries over, so a wrapped instrument renders exactly
 * as it did on the track. A node naming "patch" plays a sine (a patch
 * never recurses through a word).
 */
export function engineTrack<T extends WrappableTrack>(
  track: T,
  node: Readonly<{ params?: Readonly<Record<string, unknown>> }>,
): T {
  const out: Record<string, unknown> = { ...track };
  delete out.patch;
  delete out.fxPatch;
  delete out.clips;
  for (const field of ENGINE_FIELDS) delete out[field];
  const word = node.params?.instrument;
  out.instrument =
    typeof word === "string" && word !== PATCH_INSTRUMENT ? word : "sine";
  const settings = node.params?.settings;
  if (isRecord(settings))
    for (const [field, value] of Object.entries(settings)) out[field] = value;
  return out as T;
}

/**
 * The engine tracks an instrument patch track plays (one per `engine.*`
 * node, nested patches included, in node order), for sample loading and
 * tails; `[track]` for every other track.
 */
export function engineTracks<T extends WrappableTrack>(
  track: T,
  library: Readonly<Record<string, Patch>> = {},
): T[] {
  const value = track.patch as TrackPatchValue | undefined;
  if (track.instrument !== PATCH_INSTRUMENT || !value) return [track];
  const out: T[] = [];
  const walk = (patch: Patch | undefined, depth: number) => {
    if (!patch || depth > PATCH_LIMITS.maxDepth) return;
    for (const node of patch.nodes) {
      if (node.type.startsWith("engine.")) out.push(engineTrack(track, node));
      else if (node.type.startsWith("patch."))
        walk(library[node.type.slice(6)], depth + 1);
    }
  };
  walk(resolvePatch(value, library), 0);
  return out;
}

/**
 * The tracks whose voices a render plays: each instrument patch track,
 * then the engine track of every `engine.*` node it holds (same id, so
 * sample loading, sampler tails and kits see the wrapped instrument);
 * every other track as is.
 */
export function soundingTracks<T extends WrappableTrack>(
  score: Readonly<{
    tracks: readonly T[];
    patches?: Readonly<Record<string, Patch>> | null;
  }>,
): readonly T[] {
  if (!score.tracks.some((track) => track.instrument === PATCH_INSTRUMENT))
    return score.tracks;
  return score.tracks.flatMap((track) =>
    track.instrument === PATCH_INSTRUMENT && track.patch
      ? [track, ...engineTracks(track, score.patches ?? {})]
      : [track],
  );
}

/**
 * "Convert instrument to patch" on a whole track: the same track playing
 * `patchFromTrack(track)` inline, its engine settings fields moved into
 * the patch's engine node. Every other field (effects, automation,
 * performance, tuning) stays on the track, so it renders bit-identical.
 */
export function convertToPatch<T extends WrappableTrack>(track: T): T {
  const patch = patchFromTrack(track);
  const out: Record<string, unknown> = { ...track };
  for (const field of ENGINE_FIELDS) delete out[field];
  out.instrument = PATCH_INSTRUMENT;
  out.patch = patch;
  return out as T;
}
