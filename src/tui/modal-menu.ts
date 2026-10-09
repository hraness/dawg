/**
 * Ctrl-k menu rows for modal percussion (0.6): the "Mallets and bells"
 * group under Sound › browse sounds, and the MODAL_PARAMS rows under
 * Sound › Parameters on a modal track. Every row runs a `modal …` command.
 */
import type { EnumParam, NumberParam } from "../../core/params.ts";
import {
  GAMELAN_PRESETS,
  MODAL_INSTRUMENT,
  MODAL_MALLET_NAMES,
  MODAL_PARAMS,
  MODAL_PRESETS,
  MODAL_PRESET_NAMES,
  MODAL_SIMPLE,
  modalSettings,
  type ModalPresetName,
} from "../../core/resonators.ts";
import type { Track } from "../../core/score.ts";
import { num, specStep, type MenuNode } from "./menu.ts";

/** Sound › browse sounds › Mallets and bells: one row per preset. */
export function malletsMenu(): MenuNode {
  return {
    kind: "menu",
    id: "mallets",
    label: "Mallets and bells",
    detail: `${MODAL_PRESET_NAMES.length} modal presets · marimba, vibes, gong …`,
    help: "struck bars, bells and bowls on the modal resonator engine",
    build: () => [
      // The core presets keep their rows (gong too); the gamelan bronzes
      // added in 0.6.1 sit in their own sub-group.
      ...MODAL_PRESET_NAMES.filter(
        (name) => name === "gong" || !GAMELAN_PRESETS.includes(name),
      ).map(presetRow),
      gamelanMenu(),
    ],
  };
}

function presetRow(name: ModalPresetName): MenuNode {
  return {
    kind: "action",
    label: `${name}  ${MODAL_PRESETS[name].doc}`,
    command: `modal ${name}`,
    help: MODAL_PRESETS[name].styles,
  };
}

/**
 * Mallets and bells › Gamelan (f061-gamelan-winds): the Javanese and
 * Balinese bronzes. `modal gamelan` points here.
 */
export function gamelanMenu(): MenuNode {
  return {
    kind: "menu",
    id: "gamelan",
    label: "Gamelan",
    detail: `${GAMELAN_PRESETS.length} bronzes · saron, gangsa (ombak), gong …`,
    help: "Javanese and Balinese gamelan; pair two gangsa tracks with modal pair, tune with tuning slendro or pelog",
    build: () => GAMELAN_PRESETS.map(presetRow),
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
    command: (v) => `modal ${name} ${num(v)}`,
    reset: `modal ${name} off`,
    help: `${spec.doc} · preset ${num(fallback)} · x resets`,
  };
}

/** Sound › Parameters rows on a modal track. */
export function modalParameterNodes(track: Track): MenuNode[] {
  if (track.instrument !== MODAL_INSTRUMENT) return [];
  const modal = track.modal;
  const preset = MODAL_PRESETS[modal?.preset ?? "marimba"].settings;
  const resolved = modalSettings(modal) as Readonly<
    Record<string, number | string>
  >;
  const row = (name: string): MenuNode | undefined => {
    const spec = MODAL_PARAMS[name]!;
    if (name === "mallet")
      return {
        kind: "choice",
        label: "mallet",
        value: modal?.mallet ?? "preset",
        options: ["preset", ...MODAL_MALLET_NAMES],
        command: (option) =>
          option === "preset" ? "modal mallet off" : `modal mallet ${option}`,
        help: (spec as EnumParam).doc,
      };
    if (spec.kind !== "number") return undefined;
    return numberRow(
      name,
      spec,
      Number(resolved[name]),
      Number(preset[name as keyof typeof preset]),
    );
  };
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "preset",
      value: modal?.preset ?? "marimba",
      options: MODAL_PRESET_NAMES,
      command: (option) => `modal preset ${option}`,
      help: "the instrument: mode table, mallet and ring",
    },
  ];
  for (const name of MODAL_SIMPLE) {
    const node = row(name);
    if (node) nodes.push(node);
  }
  const rest = Object.keys(MODAL_PARAMS).filter(
    (name) => !(MODAL_SIMPLE as readonly string[]).includes(name),
  );
  nodes.push({
    kind: "menu",
    id: "modal:advanced",
    label: "advanced",
    detail: `motor, ombak, buzz, click, strike glide, gain`,
    help: "every modal parameter",
    build: () => rest.flatMap((name) => row(name) ?? []),
  });
  if (modal && Object.keys(modal).some((key) => key !== "preset"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      command: "modal reset",
      help: "clear overrides, keep the preset",
    });
  return nodes;
}
