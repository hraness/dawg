/**
 * Ctrl-k rows for patches (patcher design §7.4): Sound › patch on every
 * melodic or patch track, and one Effects › "<name> patch" group per effect
 * patch. Every row runs a typed command: `/patch` opens the patch view, a
 * node's number rows run `patch set <id> k=v`, the knobs run
 * `patch knob <macro> <value>`, and `--fx <name>` aims each at an effect
 * patch. The patch view's enter on a node opens its group here in the
 * fader drawer, so the drawer's keys, staging and keep/revert all apply.
 */
import type { NumberParam } from "../../core/params.ts";
import {
  isPatchRef,
  macroAt,
  macroPosition,
  PATCH_INSTRUMENT,
  patchSpecs,
  resolvePatch,
  type Macro,
  type Patch,
} from "../../core/patch.ts";
import type { Track, TrackScore } from "../../core/score.ts";
import { num, specStep, type MenuContext, type MenuNode } from "./menu.ts";

/** ` --fx <name>` for an effect patch, empty for the instrument patch. */
export function fxSuffix(fx: string | undefined): string {
  return fx === undefined ? "" : ` --fx ${fx}`;
}

/** The track's instrument patch (resolved through the library) or effect patch. */
export function trackPatch(
  score: TrackScore,
  track: Track,
  fx?: string,
): Patch | undefined {
  if (fx !== undefined) return track.fxPatch?.find((p) => p.name === fx);
  if (track.instrument !== PATCH_INSTRUMENT || !track.patch) return undefined;
  return resolvePatch(track.patch, score.patches);
}

/** A macro's value on this track: the ref's own setting, else its default. */
export function macroValue(track: Track, macro: Macro, fx?: string): number {
  const value =
    fx === undefined && track.patch && isPatchRef(track.patch)
      ? track.patch.macros?.[macro.id]
      : undefined;
  return value ?? macro.default;
}

/** A macro nudged along its knob travel (exp macros move by ratio). */
export function macroStep(
  macro: Macro,
): (value: number, direction: 1 | -1) => number {
  return (value, direction) => {
    const position = Math.min(
      1,
      Math.max(0, macroPosition(macro, value) + direction * 0.02),
    );
    return Number(macroAt(macro, position).toPrecision(4));
  };
}

/** One row per macro (in knob order): `patch knob <id> <value>`. */
export function macroNodes(
  track: Track,
  patch: Patch,
  fx?: string,
): MenuNode[] {
  return patch.macros.map((macro, index) => ({
    kind: "number",
    label: macro.label ?? macro.id,
    value: macroValue(track, macro, fx),
    min: Math.min(macro.min, macro.max),
    max: Math.max(macro.min, macro.max),
    step: macroStep(macro),
    format: (v) => num(v),
    command: (v) => `patch knob ${macro.id} ${num(v)}${fxSuffix(fx)}`,
    reset: `patch knob ${macro.id} ${num(macro.default)}${fxSuffix(fx)}`,
    help: `${index < 4 ? `knob ${index + 1} · ` : ""}${macro.to.map((t) => t.port).join(", ") || "no targets"} · x resets`,
  }));
}

/** A node's static settings: numbers and choices, each `patch set`. */
export function nodeParamNodes(
  patch: Patch,
  nodeId: string,
  fx?: string,
  library: Readonly<Record<string, Patch>> = {},
): MenuNode[] {
  const node = patch.nodes.find((n) => n.id === nodeId);
  const spec = patchSpecs(patch, library).get(nodeId);
  if (!node || !spec) return [];
  const rows: MenuNode[] = [];
  for (const [name, param] of Object.entries(spec.params)) {
    const value = node.params?.[name];
    const set = (text: string) =>
      `patch set ${nodeId} ${name}=${text}${fxSuffix(fx)}`;
    if (param.kind === "number") {
      const p: NumberParam = param;
      rows.push({
        kind: "number",
        label: name,
        value: typeof value === "number" ? value : p.default,
        min: p.min,
        max: p.max,
        step: specStep(p),
        format: (v) => (p.unit ? `${num(v)} ${p.unit}` : num(v)),
        command: (v) => set(num(v)),
        reset: set(num(p.default)),
        help: `${p.doc} · default ${num(p.default)} · x resets`,
      });
    } else if (param.kind === "enum")
      rows.push({
        kind: "choice",
        label: name,
        value: typeof value === "string" ? value : param.default,
        options: param.values,
        command: (option) => set(option),
        help: param.doc,
      });
    else
      rows.push({
        kind: "toggle",
        label: name,
        value: typeof value === "boolean" ? value : param.default,
        command: (on) => set(on ? "on" : "off"),
        help: param.doc,
      });
  }
  return rows;
}

/** The menu id of a node's group (the patch view's enter opens it). */
export function nodeMenuId(nodeId: string): string {
  return `patch:node:${nodeId}`;
}

function patchGroups(
  context: MenuContext,
  track: Track,
  patch: Patch,
  fx?: string,
): MenuNode[] {
  return [
    {
      kind: "action",
      label: fx === undefined ? "Edit patch" : "Edit effect patch",
      command: `/patch${fxSuffix(fx)}`,
      help: "the patch view: nodes, ports and the cable matrix",
    },
    {
      kind: "menu",
      id: "patch:knobs",
      label: "knobs",
      detail: patch.macros
        .slice(0, 4)
        .map((m) => m.label ?? m.id)
        .join(" · "),
      help: "the patch's macros; the first four are the four knobs",
      build: () => macroNodes(track, patch, fx),
    },
    {
      kind: "menu",
      id: "patch:nodes",
      label: "nodes",
      detail: `${patch.nodes.length} node${patch.nodes.length === 1 ? "" : "s"}`,
      help: "every node's settings · patch set <id> k=v",
      build: () =>
        patch.nodes.map((node): MenuNode => ({
          kind: "menu",
          id: nodeMenuId(node.id),
          label: node.id,
          detail: node.type,
          help: `${node.type} settings`,
          build: () =>
            nodeParamNodes(patch, node.id, fx, context.score.patches),
        })),
    },
  ];
}

/** Sound › patch on the focused track. */
export function patchMenuNode(
  context: MenuContext,
  track: Track | undefined,
): MenuNode[] {
  if (!track) return [];
  const patch = trackPatch(context.score, track);
  if (!patch)
    return [
      {
        kind: "menu",
        id: "patch",
        label: "patch",
        detail: "not a patch · /patch previews it as one",
        help: "modular patches: nodes, cables and four knobs",
        build: () => [
          {
            kind: "action",
            label: "Edit patch",
            command: "/patch",
            help: "the patch view (a preview until the track is a patch)",
          },
        ],
      },
    ];
  return [
    {
      kind: "menu",
      id: "patch",
      label: "patch",
      detail: `${patch.name} · ${patch.nodes.length} nodes`,
      help: "modular patches: nodes, cables and four knobs",
      build: (inner) => patchGroups(inner, track, patch),
    },
  ];
}

/** Effects › "<name> patch", one group per effect patch on the track. */
export function effectPatchMenuNodes(
  context: MenuContext,
  track: Track | undefined,
): MenuNode[] {
  return (track?.fxPatch ?? []).map((patch) => ({
    kind: "menu",
    id: `patch:fx:${patch.name}`,
    label: `${patch.name} patch`,
    detail: `effect patch · ${patch.nodes.length} nodes`,
    help: "an effect patch at the chain's patch stage",
    build: (inner) => patchGroups(inner, track!, patch, patch.name),
  }));
}
