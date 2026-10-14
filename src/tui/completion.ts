/** Command discovery is local, bounded, and never executes a suggestion. */
import { HELP_SECTIONS } from "../commands/help.ts";
import { PRESETS } from "../../core/presets/index.ts";
import { GROOVE_STARTERS } from "../../core/styles/starters.ts";
import { DEMOS } from "../../core/demos/index.ts";
import { BUNDLED_SAMPLES } from "../../core/bundled-samples.ts";
import { MODE_NAMES, SCALE_NAMES, PERFORM_MODES } from "../../core/chords.ts";
import { STYLE_TREE } from "../../core/styles/index.ts";
import { TOPICS, TOPIC_SUMMARY } from "../lang/glossary.ts";
import { fuzzyScore } from "../../tui/search.ts";
import type { PickerItem } from "../../tui/app.ts";

const commands: PickerItem[] = [];
const seen = new Set<string>();
for (const section of HELP_SECTIONS) {
  for (const entry of section.entries) {
    // Separate command alternatives, but never mistake enum values for verbs.
    const heads = entry.command.split(/\s+\|\s+/u).slice(0, 1);
    for (const head of heads) {
      const token = head.split(/\s/u)[0] ?? "";
      for (const name of token.split("|")) {
        if (!/^\/?[a-z][a-z0-9-]*$/u.test(name) || seen.has(name)) continue;
        seen.add(name);
        commands.push({
          label: name,
          value: name,
          detail: entry.summary,
          note: entry.command,
          topic: section.group.split(" · ")[0],
        });
      }
    }
  }
}
for (const name of [
  "preset",
  "combo",
  "pipe",
  "/menu",
  "/help",
  "/guide",
  "/play",
  "/presets",
  "/styles",
]) {
  if (!seen.has(name))
    commands.push({ label: name, value: name, topic: "project" });
}

export interface CompletionContext {
  tracks: readonly { id: string; name: string }[];
  sections: readonly { name: string }[];
}

/** Jump searches the complete command vocabulary; choosing inserts, never runs. */
export function commandVocabulary(): readonly PickerItem[] {
  return commands;
}

export function commandCompletions(
  text: string,
  context: CompletionContext,
): PickerItem[] {
  if (!text || text.length > 256 || text.includes("\n")) return [];
  const input = text.replace(/^\//u, "");
  const match = input.match(/^(\S+)\s+(.*)$/u);
  let query = input;
  let choices = commands.filter(
    (item) =>
      !(
        text.startsWith("/") &&
        !item.value.startsWith("/") &&
        seen.has(`/${item.value}`)
      ),
  );
  if (match) {
    const verb = match[1]!.toLowerCase();
    query = match[2]!;
    const prefix = `${text.startsWith("/") ? "/" : ""}${verb} `;
    const item = (
      name: string,
      detail = "",
      topic = "project",
    ): PickerItem => ({
      label: name,
      value: prefix + name,
      detail,
      topic,
    });
    if (["menu", "guide", "help"].includes(verb))
      choices = TOPICS.map((name) => item(name, TOPIC_SUMMARY[name], name));
    else if (["demo", "demos"].includes(verb)) {
      const action = query.match(/^(info|load)\s+(.*)$/u);
      if (action) query = action[2]!;
      choices = DEMOS.map((demo) => ({
        ...item(
          demo.title,
          `${demo.id} · ${demo.style} · ${demo.features.join(" ")}`,
          "arrange",
        ),
        value: `${prefix}${action ? action[1] + " " : ""}${demo.id}`,
      }));
    } else if (["sample", "samples"].includes(verb)) {
      const action = query.match(/^(use|preview|chop|library|search)\s+(.*)$/u);
      if (action) {
        query = action[2]!;
        choices = BUNDLED_SAMPLES.map((sample) => ({
          ...item(
            sample.title,
            `${sample.id} · ${sample.description} · ${sample.tags.join(" ")}`,
            "sound",
          ),
          value: `${prefix}${action[1]} ${sample.id}${action[1] === "chop" ? " 4" : ""}`,
        }));
      } else
        choices = ["library", "preview", "use", "chop"].map((action) =>
          item(
            action,
            action === "library"
              ? "browse original offline samples"
              : `sample ${action} <id>`,
            "sound",
          ),
        );
    } else if (["style", "styles"].includes(verb))
      choices = [
        ...GROOVE_STARTERS.map((s) => ({
          ...item(s.title, `${s.id} · ${s.detail} · ${s.touchstone}`, "rhythm"),
          value: prefix + s.id,
        })),
        ...[...STYLE_TREE.values()]
          .filter((s) => !GROOVE_STARTERS.some((g) => g.id === s.id))
          .map((s) =>
            item(s.id, `${s.title} · ${s.aliases.join(" ")}`, "rhythm"),
          ),
      ];
    else if (verb === "preset")
      choices = PRESETS.map((p) => item(p.name, p.desc, "sound"));
    else if (["track", "focus", "mute", "solo"].includes(verb))
      choices = context.tracks.map((t) => item(t.id, t.name, "mix"));
    else if (verb === "chords")
      choices = [
        "off",
        "auto",
        "manual",
        ...PERFORM_MODES.map((mode) => `perform ${mode}`),
        "bass off",
      ].map((s) =>
        item(s, s === "off" ? "single notes" : "chord play", "chords"),
      );
    else if (["key", "scale"].includes(verb)) {
      const tonic = query.match(/^([a-g](?:#|b)?)\s+/iu);
      if (tonic) {
        query = query.slice(tonic[0].length);
        choices = [...new Set([...MODE_NAMES, ...SCALE_NAMES])].map((mode) => ({
          ...item(mode, "single-note scale", "chords"),
          value: `${prefix}${tonic[1]} ${mode}`,
        }));
      } else
        choices = [
          "C",
          "C#",
          "D",
          "Eb",
          "E",
          "F",
          "F#",
          "G",
          "Ab",
          "A",
          "Bb",
          "B",
        ].map((n) => item(n, "tonic · then choose a scale", "chords"));
    } else if (verb === "play" && text.startsWith("/"))
      choices = ["on", "off", "degrees", "chromatic"].map((s) =>
        item(s, "QWERTY keyboard", "keys"),
      );
    else if (verb === "section" && /^(jump|loop)\s/u.test(query)) {
      const action = query.split(" ")[0]!;
      query = query.slice(action.length + 1);
      choices = context.sections.map((s) => ({
        ...item(s.name, "scene", "arrange"),
        value: `${prefix}${action} ${s.name}`,
      }));
    } else return [];
  }
  return choices
    .map((item, index) => ({
      item,
      index,
      rank: query.trim()
        ? fuzzyScore(query, item.label.replace(/^\//u, ""), item.detail ?? "")
        : 1,
    }))
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, 32)
    .map(({ item }) => ({
      ...item,
      value:
        !match && text.startsWith("/") && !item.value.startsWith("/")
          ? `/${item.value}`
          : item.value,
    }));
}
