/**
 * Ctrl-k menu rows for the wind engine (0.6.1): the "Winds and brass" group
 * under Sound › instruments, and the WIND_PARAMS rows under Sound ›
 * Parameters on a wind-engine track. Every row runs a `wind …` command.
 */
import type { EnumParam, NumberParam } from "../../core/params.ts";
import type { Track } from "../../core/score.ts";
import {
  DEFAULT_WIND_PRESET,
  WIND_GROUPS,
  WIND_INSTRUMENT,
  WIND_PARAMS,
  WIND_PRESETS,
  WIND_PRESET_NAMES,
  WIND_SIMPLE,
  windSettings,
  type WindPresetName,
} from "../../core/winds.ts";
import { num, specStep, type MenuNode } from "./menu.ts";

function presetRow(name: WindPresetName): MenuNode {
  return {
    kind: "action",
    label: `${name.padEnd(13)} ${WIND_PRESETS[name].doc}`,
    command: `wind ${name}`,
    help: WIND_PRESETS[name].styles,
  };
}

/** Sound › instruments › winds and brass: flutes, reeds, brass. */
export function windsMenu(): MenuNode {
  return {
    kind: "menu",
    id: "winds",
    label: "winds and brass",
    detail: `${WIND_PRESET_NAMES.length} blown · flute, sax, trumpet …`,
    help: "breath-driven waveguides: flutes, reeds and brass; wind players 4 for a section",
    build: () =>
      WIND_GROUPS.map((group): MenuNode => ({
        kind: "menu",
        id: `winds:${group.label.toLowerCase()}`,
        label: group.label,
        detail: group.presets.slice(0, 3).join(", ") + " …",
        help: `${group.label.toLowerCase()} on the wind engine`,
        build: () => group.presets.map(presetRow),
      })),
  };
}

function numberRow(
  name: string,
  spec: NumberParam,
  value: number,
  fallback: number,
): MenuNode {
  return {
    kind: "number",
    label: name,
    value,
    min: spec.min,
    max: spec.max,
    step: specStep(spec),
    format: (v) => (spec.unit ? `${num(v)} ${spec.unit}` : num(v)),
    command: (v) => `wind ${name} ${num(v)}`,
    reset: `wind ${name} off`,
    help: `${spec.doc} · preset ${num(fallback)} · x resets`,
  };
}

/** Sound › Parameters rows on a wind-engine track. */
export function windParameterNodes(track: Track): MenuNode[] {
  if (track.instrument !== WIND_INSTRUMENT || !track.wind) return [];
  const wind = track.wind;
  const preset = WIND_PRESETS[wind.preset ?? DEFAULT_WIND_PRESET].settings;
  const resolved = windSettings(wind) as Readonly<
    Record<string, number | string | boolean>
  >;
  const fallback = preset as Readonly<
    Record<string, number | string | boolean>
  >;
  const row = (name: string): MenuNode | undefined => {
    const spec = WIND_PARAMS[name]!;
    const own = (wind as Record<string, unknown>)[name];
    if (spec.kind === "enum")
      return {
        kind: "choice",
        label: name,
        value: own === undefined ? "preset" : String(own),
        options: ["preset", ...(spec as EnumParam).values],
        command: (option) =>
          option === "preset" ? `wind ${name} unset` : `wind ${name} ${option}`,
        help: `${spec.doc} · preset ${String(fallback[name])}`,
      };
    if (spec.kind === "boolean")
      return {
        kind: "choice",
        label: name,
        value: own === undefined ? "preset" : own ? "on" : "off",
        options: ["preset", "on", "off"],
        command: (option) =>
          option === "preset" ? `wind ${name} unset` : `wind ${name} ${option}`,
        help: `${spec.doc} · preset ${fallback[name] ? "on" : "off"}`,
      };
    return numberRow(
      name,
      spec,
      Number(resolved[name]),
      Number(fallback[name]),
    );
  };
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "preset",
      value: wind.preset ?? DEFAULT_WIND_PRESET,
      options: WIND_PRESET_NAMES,
      command: (option) => `wind preset ${option}`,
      help: "the instrument: bore, exciter, range and mute",
    },
  ];
  for (const name of WIND_SIMPLE) {
    const node = row(name);
    if (node) nodes.push(node);
  }
  const rest = Object.keys(WIND_PARAMS).filter(
    (name) => !(WIND_SIMPLE as readonly string[]).includes(name),
  );
  nodes.push({
    kind: "menu",
    id: "wind:advanced",
    label: "advanced",
    detail: rest.join(", "),
    help: "every wind parameter",
    build: () => rest.flatMap((name) => row(name) ?? []),
  });
  if (Object.keys(wind).some((key) => key !== "preset"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      command: "wind reset",
      help: "clear overrides, keep the preset",
    });
  return nodes;
}
