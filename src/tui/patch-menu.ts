/**
 * Ctrl-K rows for patches (patcher design §7.4): Sound › patch and
 * Effects › add effect patch. Every row runs one typed `patch …` line, so
 * the menu, the prompt, the agent and show-me share one grammar (f07 four
 * doors). Lane 6 adds the patch view rows (`edit patch`) beside these.
 */

import { isPatchRef } from "../../core/patch.ts";
import { BUILTIN_PATCH_NAMES } from "../../core/patches/index.ts";
import { parsePatchCommand } from "../commands/patch.ts";
import type { MenuContext, MenuNode } from "./menu.ts";

/** `patch <verb> <text>` when it parses, else undefined (the entry waits). */
function patchLine(verb: string, text: string): string | undefined {
  const rest = text.trim().replace(/\s+/g, " ");
  if (!rest) return undefined;
  const line = `patch ${verb} ${rest}`;
  return parsePatchCommand(line) ? line : undefined;
}

function entry(
  label: string,
  verb: string,
  placeholder: string,
  example: string,
  help: string,
): MenuNode {
  return {
    kind: "entry",
    label,
    value: "",
    placeholder,
    example: `patch ${verb} ${example}`,
    help,
    command: (text) => patchLine(verb, text),
  };
}

function patchRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!track) return [];
  const rows: MenuNode[] = [
    entry(
      "new patch",
      "new",
      "name [from <preset|instrument>], e.g. mine from acid-bass",
      "mine",
      "start a modular patch on this track",
    ),
    {
      kind: "choice",
      label: "load patch",
      value: "",
      options: BUILTIN_PATCH_NAMES,
      command: (name) => `patch load ${name}`,
      help: "play a built-in patch · or type patch load <name|github:…>",
    },
    {
      kind: "action",
      label: "convert to patch",
      command: "patch convert",
      help: `rebuild ${track.instrument} as an equivalent patch you can rewire`,
    },
  ];
  rows.push(
    entry(
      "add node",
      "add",
      "type [as id] [k=v …], e.g. svf as vcf cutoff=800",
      "osc as tone",
      "add a node · patch nodes lists the types",
    ),
    entry(
      "set node",
      "set",
      "id k=v …, e.g. vcf q=0.6",
      "tone wave=saw",
      "change a node's params",
    ),
    entry(
      "wire",
      "wire",
      "from.port to.port [amount], e.g. lfo.out vcf.cutoff 0.4",
      "tone.out out.audio",
      "connect an output to an input",
    ),
    entry(
      "unwire",
      "unwire",
      "from.port to.port",
      "tone.out out.audio",
      "remove a cable",
    ),
    entry(
      "map to knob",
      "macro",
      'id node.port[:min..max] … [label "…"]',
      "cutoff vcf.cutoff",
      "a macro: one knob that moves one or more ports",
    ),
    entry(
      "turn knob",
      "knob",
      "macro value, e.g. cutoff 900",
      "cutoff 900",
      "set a macro's value",
    ),
    entry(
      "node rate",
      "rate",
      "id global|voice, e.g. lfo global",
      "tone global",
      "run a node once per track or once per voice",
    ),
    entry("remove node", "rm", "id", "tone", "remove a node and its cables"),
    entry(
      "save patch",
      "save",
      "name [--user]",
      "mine",
      "copy this patch into the project library (--user: every project)",
    ),
    {
      kind: "action",
      label: "show as text",
      command: "patch show",
      help: "the patch as the lines that rebuild it",
    },
    {
      kind: "action",
      label: "list node types",
      command: "patch nodes",
      help: "every node type with its ports",
    },
  );
  rows.push({
    kind: "action",
    label: "detach",
    command: "patch detach",
    help:
      track.patch && isPatchRef(track.patch)
        ? `give this track its own copy of ${track.patch.ref}`
        : "give this track its own copy of a shared library patch",
  });
  return rows;
}

/** Sound › patch. */
export function patchMenuNode(context: MenuContext): MenuNode {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  const patch = track?.patch;
  const detail = !patch ? "off" : isPatchRef(patch) ? patch.ref : patch.name;
  return {
    kind: "menu",
    id: "patch",
    label: "patch",
    detail,
    help: "a modular patch: nodes, cables and knobs",
    build: patchRows,
  };
}

/** Effects › add effect patch. */
export function effectPatchMenuNode(): MenuNode {
  return {
    kind: "entry",
    label: "add effect patch",
    value: "",
    placeholder: "name [from <preset>], e.g. wobble",
    example: "patch new wobble effect",
    help: "a modular effect on this track · edit it with patch … --fx <name>",
    command: (text) => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return undefined;
      const [name, ...rest] = words;
      const line = `patch new ${name} effect${rest.length ? ` ${rest.join(" ")}` : ""}`;
      return parsePatchCommand(line) ? line : undefined;
    },
  };
}
