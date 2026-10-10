/**
 * The SDK's patch node factories are typed from `NODE_SPECS`
 * (core/patch-nodes.ts), but the vendored SDK is one file with no imports.
 * This script generates the table and its types as
 * `core/sdk/patch-nodes.gen.ts` and splices the same block into
 * `core/sdk/v1.ts` between two marker lines. Run
 * `bun scripts/gen-patch-sdk.ts` after changing a node spec;
 * `core/sdk/patch-nodes-gen.test.ts` fails while either copy is stale.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format } from "prettier";
import type { ParamSpec } from "../core/params.ts";
import {
  BOUNDARY_SPECS,
  NODE_SPECS,
  type NodeSpec,
  type PortSpec,
} from "../core/patch-nodes.ts";

export const BEGIN_MARKER =
  "// BEGIN patch nodes: generated from core/patch-nodes.ts by scripts/gen-patch-sdk.ts";
export const END_MARKER = "// END patch nodes";

const ROOT = join(import.meta.dir, "..");
export const GEN_PATH = join(ROOT, "core", "sdk", "patch-nodes.gen.ts");
export const SDK_PATH = join(ROOT, "core", "sdk", "v1.ts");

const GEN_HEADER = `/**
 * Patch node types for the SDK, generated from NODE_SPECS
 * (core/patch-nodes.ts) by scripts/gen-patch-sdk.ts. Do not edit: the same
 * block is spliced into core/sdk/v1.ts, which stays a single vendored file.
 */
`;

function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function comment(text: string): string {
  return `/** ${text.replace(/\*\//g, "* /")} */`;
}

function range(spec: ParamSpec): string {
  if (spec.kind === "number") {
    const unit = spec.unit ? ` ${spec.unit}` : "";
    return `${spec.min}..${spec.max}${unit}, default ${spec.default}`;
  }
  if (spec.kind === "enum") return `default "${spec.default}"`;
  return `default ${spec.default}`;
}

function paramType(spec: ParamSpec): string {
  if (spec.kind === "number") return "number";
  if (spec.kind === "boolean") return "boolean";
  // An engine that plays any instrument word lists no values.
  if (spec.values.length === 0) return "string";
  return spec.values.map((value) => JSON.stringify(value)).join(" | ");
}

/** `n` notes, `a` audio, `c` control, `ca` control that also takes audio. */
function portCode(port: PortSpec): string {
  if (port.kind === "notes") return "n";
  if (port.kind === "audio") return "a";
  return port.audioRate ? "ca" : "c";
}

function nodeType(spec: NodeSpec): string {
  const params = Object.entries(spec.params).map(([name, param]) => {
    const port = spec.inputs.find((input) => input.name === name);
    const doc = port?.doc ?? param.doc;
    return `${comment(`${doc} (${range(param)})`)}\n${key(name)}?: ${paramType(param)};`;
  });
  if (spec.engine)
    params.push(
      `${comment("engine settings, as the track field holds them")}\nsettings?: Readonly<Record<string, unknown>>;`,
    );
  const inputs = spec.inputs.map(
    (port) => `${comment(port.doc)}\n${key(port.name)}: "${portCode(port)}";`,
  );
  const outputs = spec.outputs.map(
    (port) => `${comment(port.doc)}\n${key(port.name)}: "${portCode(port)}";`,
  );
  const main = spec.outputs[0] ? portCode(spec.outputs[0]) : "none";
  return `${comment(spec.doc)}\n${key(spec.type)}: {\nmain: "${main === "ca" ? "c" : main}";\nparams: {\n${params.join("\n")}\n};\ninputs: {\n${inputs.join("\n")}\n};\noutputs: {\n${outputs.join("\n")}\n};\n};`;
}

/**
 * Runtime table: per type, its rate, param names in canonical order, inputs
 * `[name, code, min, max, default]`, outputs `[name, code]` (bipolar control
 * outputs add `-1, 1`) and an engine's track fields.
 */
function nodeRow(spec: NodeSpec): string {
  const inputs = spec.inputs.map((port) => {
    const s = port.spec;
    return s
      ? `[${JSON.stringify(port.name)}, "${portCode(port)}", ${s.min}, ${s.max}, ${s.default}]`
      : `[${JSON.stringify(port.name)}, "${portCode(port)}"]`;
  });
  // A control output documented as `-1..1` is bipolar: `.range()` maps from -1.
  const outputs = spec.outputs.map((port) =>
    port.kind === "control" && port.doc.startsWith("-1..1")
      ? `[${JSON.stringify(port.name)}, "c", -1, 1]`
      : `[${JSON.stringify(port.name)}, "${portCode(port)}"]`,
  );
  const params = Object.keys(spec.params).map((name) => JSON.stringify(name));
  const engine = spec.engine
    ? `, engine: [${spec.engine.fields.map((field) => JSON.stringify(field)).join(", ")}]`
    : "";
  return `${key(spec.type)}: { rate: "${spec.rate}", params: [${params.join(", ")}], inputs: [${inputs.join(", ")}], outputs: [${outputs.join(", ")}]${engine} },`;
}

/** The generated block, markers included, unformatted. */
export function patchNodesBlock(): string {
  const specs = Object.values(NODE_SPECS);
  const boundary = Object.values(BOUNDARY_SPECS);
  return [
    BEGIN_MARKER,
    "",
    "/** Port codes: `n` notes, `a` audio, `c` control, `ca` control that also takes audio. */",
    'export type PatchPortCode = "n" | "a" | "c" | "ca";',
    "",
    "/** Every patch node type: its main output's port code, settings, input ports and output ports (NODE_SPECS). */",
    "export type PatchNodeTable = {",
    ...specs.map(nodeType),
    "};",
    "",
    "/** The boundary nodes every patch has: `in`, `out`, `voice` and `song`. */",
    "export type PatchBoundaryTable = {",
    ...boundary.map(nodeType),
    "};",
    "",
    "type PatchPortRow = readonly [string, PatchPortCode, number?, number?, number?];",
    "",
    "/** Ports by node type, for wiring and checks at run time. */",
    "export const PATCH_NODE_PORTS: Readonly<Record<string, Readonly<{ rate: string; params: readonly string[]; inputs: readonly PatchPortRow[]; outputs: readonly PatchPortRow[]; engine?: readonly string[] }>>> = {",
    ...[...specs, ...boundary].map(nodeRow),
    "};",
    "",
    END_MARKER,
  ].join("\n");
}

async function formatted(source: string): Promise<string> {
  return format(source, { parser: "typescript", filepath: "x.ts" });
}

/** The generated module's full text. */
export async function generatedModule(): Promise<string> {
  return formatted(`${GEN_HEADER}\n${patchNodesBlock()}\n`);
}

/** `v1.ts` with the generated block spliced in (or replaced). */
export async function syncedSdk(sdk: string): Promise<string> {
  const block = (await formatted(patchNodesBlock())).trimEnd();
  const start = sdk.indexOf(BEGIN_MARKER);
  const end = sdk.indexOf(END_MARKER);
  if (start < 0 || end < start)
    throw new Error(`v1.ts has no ${BEGIN_MARKER} … ${END_MARKER} block`);
  return `${sdk.slice(0, start)}${block}${sdk.slice(end + END_MARKER.length)}`;
}

if (import.meta.main) {
  const sdk = await readFile(SDK_PATH, "utf8");
  const next = await syncedSdk(sdk);
  const gen = await generatedModule();
  let current = "";
  try {
    current = await readFile(GEN_PATH, "utf8");
  } catch {
    // first run
  }
  if (next !== sdk) await writeFile(SDK_PATH, next);
  if (gen !== current) await writeFile(GEN_PATH, gen);
  console.log(
    next === sdk && gen === current
      ? "patch node types up to date"
      : "patch node types updated",
  );
}
