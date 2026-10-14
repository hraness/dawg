import type { PickerItem } from "../../tui/app.ts";
import { BUNDLED_SAMPLES } from "../../core/bundled-samples.ts";
import { INSTRUMENT_WORDS, LEGACY_WORDS } from "../../core/instruments.ts";
import { PRESETS } from "../../core/presets/index.ts";
import { AVAILABLE_INSTRUMENTS } from "../audio/wav.ts";
import { GM_INSTRUMENTS } from "../audio/packs.ts";
import { commandVocabulary } from "./completion.ts";
import {
  MENU_SECTIONS,
  menuPath,
  rootNodes,
  type MenuContext,
  type MenuNode,
} from "./menu.ts";
import { TOPICS, TOPIC_SUMMARY } from "../lang/glossary.ts";

export type JumpChoice =
  { kind: "navigate"; command: string } | { kind: "insert"; command: string };

const instrumentWords = [
  ...new Set([
    ...AVAILABLE_INSTRUMENTS,
    ...LEGACY_WORDS,
    ...INSTRUMENT_WORDS.map((entry) => entry.word),
  ]),
];

/** Catalog browsers contain actions, not controls. Avoid opening them just to
 * index parameters; in particular, never scan project sample/table folders. */
const catalogMenus = new Set([
  "browse",
  "samples",
  "instruments",
  "demos",
  "style",
  "patterns",
  "kits",
  "help",
  "session",
  "export",
  "resample",
  "agent",
  "audio",
]);

function parameterItems(context: MenuContext): PickerItem[] {
  const items: PickerItem[] = [];
  const seen = new Set<string>();
  const queue: { nodes: readonly MenuNode[]; path: string[] }[] = [
    {
      nodes: rootNodes(context).filter(
        (node) =>
          node.kind === "menu" &&
          ["sound", "voice", "effects", "chords", "mix", "project"].includes(
            node.id,
          ),
      ),
      path: [],
    },
  ];
  let visited = 0;
  // Score limits bound tracks; these guards also bound future menu expansion.
  for (
    let at = 0;
    at < queue.length && visited < 4096 && items.length < 768;
    at++
  ) {
    const { nodes, path } = queue[at]!;
    for (const node of nodes) {
      if (++visited > 4096 || items.length >= 768) break;
      if (node.kind === "menu") {
        if (
          path.length < 6 &&
          !catalogMenus.has(node.id) &&
          !node.id.startsWith("wt-")
        )
          queue.push({
            nodes: node.build(context),
            path: [...path, node.label],
          });
        continue;
      }
      let command: string | undefined;
      let value: string | undefined;
      if (node.kind === "number") {
        const current = node.value ?? node.start ?? node.min;
        command = node.command(current);
        value = node.format(current);
      } else if (node.kind === "choice") {
        const current = node.options.includes(node.value)
          ? node.value
          : node.options[0];
        if (current !== undefined) {
          command = node.command(current);
          value = current;
        }
      } else if (node.kind === "toggle") {
        command = node.command(node.value);
        value = node.value ? "on" : "off";
      }
      if (!command || command.length > 256 || seen.has(command)) continue;
      seen.add(command);
      items.push({
        label: `Parameter · ${[...path, node.label].join(" › ")}`,
        detail: `insert · ${command} · ${value}${node.help ? ` · ${node.help}` : ""}`,
        value: JSON.stringify({ kind: "insert", command } satisfies JumpChoice),
      });
    }
  }
  return items;
}

/** Every result explains whether it opens a location or prepares a command. */
export function jumpItems(context: MenuContext): PickerItem[] {
  // Menu trees may offer project-local tables. Jump indexes the in-memory
  // catalog only; the corresponding browser remains available as a location.
  const { projectRoot: _projectRoot, ...localContext } = context;
  const item = (
    label: string,
    detail: string,
    choice: JumpChoice,
  ): PickerItem => ({ label, detail, value: JSON.stringify(choice) });
  const destinations = [
    ["Back to previous location", "/back"],
    ["Home / command prompt", "/home"],
    ["Play keyboard", "/play on"],
    ["Tape arrangement", "/tape on"],
    ["Patch cables", "/patch on"],
    ["Menu", "/menu"],
    ["Knobs", "/knobs"],
    ["Mix tracks", "/mix"],
    ["Euclidean rhythm", "/euclid"],
    ["Presets", "/presets"],
    ["Tracks", "/tracks"],
    ["Guides", "/guide"],
    ["Help", "/help"],
    ["Transcript", "/log"],
    ["Project history", "/history"],
  ] as const;
  return [
    ...destinations.map(([label, command]) =>
      item(label, `open · ${command}`, { kind: "navigate", command }),
    ),
    ...MENU_SECTIONS.filter((section) => section !== "keys").map((section) =>
      item(
        `Menu · ${section}`,
        `open · ${menuPath(section, localContext) ?? section}`,
        { kind: "navigate", command: `/menu ${section}` },
      ),
    ),
    ...context.score.tracks.map((track) =>
      item(
        `Track · ${track.name || track.id}`,
        `focus · ${track.id} · ${track.instrument}`,
        { kind: "navigate", command: `/track ${track.id}` },
      ),
    ),
    ...context.score.sections.map((section) =>
      item(
        `Scene · ${section.name}`,
        `seek · section · bars ${section.startBar + 1}–${section.startBar + section.bars}`,
        { kind: "navigate", command: `/section jump ${section.name}` },
      ),
    ),
    ...instrumentWords.map((word) =>
      item(
        `Sound · ${word}`,
        "insert · instrument on focused track · enter command to apply",
        { kind: "insert", command: `/instrument ${word}` },
      ),
    ),
    ...GM_INSTRUMENTS.map((word) =>
      item(
        `Sound · ${word.replace(/^gm_/, "").replace(/_/g, " ")} · GM`,
        "insert · General MIDI sample pack · may need download when applied",
        { kind: "insert", command: `/pack use gm/${word}` },
      ),
    ),
    ...BUNDLED_SAMPLES.map((sample) =>
      item(
        `Sample · ${sample.title}`,
        `insert · ${sample.id} · ${sample.description} · ${sample.tags.join(" ")}`,
        { kind: "insert", command: `/sample use ${sample.id}` },
      ),
    ),
    ...PRESETS.map((preset) =>
      item(`Preset · ${preset.name}`, `insert · ${preset.desc}`, {
        kind: "insert",
        command: `/preset ${preset.name}`,
      }),
    ),
    ...parameterItems(localContext),
    ...TOPICS.map((topic) =>
      item(`Guide · ${topic}`, TOPIC_SUMMARY[topic], {
        kind: "navigate",
        command: `/guide ${topic}`,
      }),
    ),
    ...commandVocabulary().map((command) =>
      item(
        `Command · ${command.label}`,
        `insert · ${command.detail ?? command.note ?? "add arguments then enter"}`,
        { kind: "insert", command: command.value },
      ),
    ),
  ];
}

export function parseJumpChoice(value: string): JumpChoice | undefined {
  try {
    const choice: unknown = JSON.parse(value);
    if (
      !choice ||
      typeof choice !== "object" ||
      !("kind" in choice) ||
      !("command" in choice)
    )
      return undefined;
    if (
      (choice.kind !== "navigate" && choice.kind !== "insert") ||
      typeof choice.command !== "string" ||
      choice.command.length > 256
    )
      return undefined;
    return { kind: choice.kind, command: choice.command };
  } catch {
    return undefined;
  }
}
