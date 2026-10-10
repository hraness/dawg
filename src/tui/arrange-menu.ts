/**
 * The ctrl-k menu's Arrange section (0.5): song sections, the form, and
 * build/drop/fill generators. Every row runs a `section …`, `form …`,
 * `build …`, `drop …` or `fill …` prompt command (src/commands/arrange.ts),
 * so the menu, the prompt and the agent tools share one code path.
 */
import type { Section } from "../../core/score.ts";
import { formatForm } from "../../core/sections.ts";
import { barsLabel } from "../commands/arrange.ts";
import { rangeLabel } from "../../core/range.ts";
import type { MenuContext, MenuNode } from "./menu.ts";
import { styleMenuDetail, styleMenuNodes } from "./style-menu.ts";

/** `3 sections · form A×2 B · loop chorus`, or how to start. */
export function arrangeDetail(context: MenuContext): string {
  const score = context.score;
  if (score.sections.length === 0) return "no sections · mark bars";
  const count = score.sections.length;
  const parts = [`${count} section${count === 1 ? "" : "s"}`];
  if (score.form.length) parts.push(`form ${formatForm(score.form)}`);
  if (score.loopSection) parts.push(`loop ${score.loopSection}`);
  return parts.join(" · ");
}

/** `loop 5–6 · 16 bars`, or the song length alone. */
export function rangeDetail(context: MenuContext): string {
  const score = context.score;
  const bars = `${score.bars} bar${score.bars === 1 ? "" : "s"}`;
  return score.loop ? `loop ${rangeLabel(score.loop)} · ${bars}` : bars;
}

/** A bar range typed as `5-6` or `5`: kept as typed, else undefined. */
function barsText(text: string): string | undefined {
  const value = text.trim().replace(/\s*(?:–|\.\.)\s*/u, "-");
  return /^\d{1,4}(?:-\d{1,4})?$/u.test(value) ? value : undefined;
}

/**
 * Arrange › range (op1-ux §6.4): each row runs the typed range command on
 * the focused track, so the menu, the prompt and the agent share one path.
 */
export function rangeNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  const track = context.trackId;
  const nodes: MenuNode[] = [
    {
      kind: "entry",
      label: "loop bars",
      value: score.loop ? rangeLabel(score.loop) : "the song",
      placeholder: "bars, e.g. 5-6",
      example: "loop 5-6",
      help: "loop these bars in playback; empty plays the song",
      command: (text) => {
        if (!text.trim()) return "loop off";
        const bars = barsText(text);
        return bars ? `loop ${bars}` : undefined;
      },
    },
  ];
  if (score.loop)
    nodes.push(
      {
        kind: "action",
        label: "loop next",
        command: "loop next",
        help: "step the loop one length later",
      },
      {
        kind: "action",
        label: "loop prev",
        command: "loop prev",
        help: "step the loop one length earlier",
      },
    );
  nodes.push(
    {
      kind: "entry",
      label: "copy bars",
      value: "",
      placeholder: "bars to bar, e.g. 5-6 to 7 x2",
      example: `copy ${track} 5-6 to 7 x2`,
      help: "copy this track's bars; x2 tiles, insert shifts later music",
      command: (text) =>
        text.trim() ? `copy ${track} ${text.trim()}` : undefined,
    },
    {
      kind: "entry",
      label: "move bars",
      value: "",
      placeholder: "bars to bar, e.g. 5-6 to 9",
      example: `move ${track} 5-6 to 9`,
      help: "move this track's bars; the source empties",
      command: (text) =>
        text.trim() ? `move ${track} ${text.trim()}` : undefined,
    },
    {
      kind: "entry",
      label: "clear bars",
      value: "",
      placeholder: "bars, e.g. 5-6",
      example: `clear ${track} 5-6`,
      help: "empty this track's bars; the bars stay",
      command: (text) => {
        const bars = barsText(text);
        return bars ? `clear ${track} ${bars}` : undefined;
      },
    },
    {
      kind: "entry",
      label: "reverse bars",
      value: "",
      placeholder: "bars, e.g. 5-6",
      example: `reverse ${track} 5-6`,
      help: "mirror this track's bars in time",
      command: (text) => {
        const bars = barsText(text);
        return bars ? `reverse ${track} ${bars}` : undefined;
      },
    },
    {
      kind: "entry",
      label: "paste at",
      value: "",
      placeholder: "a bar, e.g. 9",
      example: "paste at 9",
      help: "lay the clipboard down (copy bars without `to` fills it)",
      command: (text) =>
        /^\d{1,4}$/u.test(text.trim()) ? `paste at ${text.trim()}` : undefined,
    },
    {
      kind: "entry",
      label: "insert bars",
      value: "",
      placeholder: "count at bar, e.g. 2 at 3",
      example: "bars insert 2 at 3",
      help: "add empty bars; later sections, clips, automation and tempo move right",
      command: (text) =>
        /^\d{1,3}\s+at\s+\d{1,4}$/u.test(text.trim())
          ? `bars insert ${text.trim().replace(/\s+/gu, " ")}`
          : undefined,
    },
    {
      kind: "entry",
      label: "remove bars",
      value: "",
      placeholder: "bars, e.g. 5-6",
      example: "bars remove 5-6",
      help: "cut the bars out; later music moves left",
      command: (text) => {
        const bars = barsText(text);
        return bars ? `bars remove ${bars}` : undefined;
      },
    },
    {
      kind: "entry",
      label: "jump",
      value: "",
      placeholder: "bar or bar.beat, e.g. 5.3",
      example: "jump 5.3",
      help: "move the playhead",
      command: (text) =>
        /^\d{1,4}(?:\.\d{1,2})?$/u.test(text.trim())
          ? `jump ${text.trim()}`
          : undefined,
    },
  );
  return nodes;
}

/**
 * Arrange's rows after tracks (§4a): sections (each section, mark bars,
 * add section), then form and the style browser.
 */
export function arrangeNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  const count = score.sections.length;
  const nodes: MenuNode[] = [
    {
      kind: "menu",
      id: "sections",
      label: "sections",
      detail:
        count === 0
          ? "none yet · mark bars"
          : `${count} · ${score.sections.map((section) => section.name).join(", ")}`,
      help: "mark bars, add a section, then loop, jump, mute or vary one",
      build: sectionListNodes,
    },
  ];
  if (score.sections.length > 0) {
    nodes.push({
      kind: "entry",
      label: "form",
      value: score.form.length ? formatForm(score.form) : "bars in order",
      placeholder: "sections in play order, e.g. intro verse chorus*2 outro",
      example: "form intro verse chorus*2 outro",
      help: "the order playback and export follow; empty clears it",
      command: (text) => (text.trim() ? `form ${text.trim()}` : "form off"),
    });
    if (score.form.length)
      nodes.push({
        kind: "action",
        label: "print form to tape",
        command: "form bake",
        help: "write the form out as plain bars, then clear it",
      });
    if (score.loopSection)
      nodes.push({
        kind: "action",
        label: `stop looping ${score.loopSection}`,
        command: "section loop off",
        help: "play the whole song (or form) again",
      });
  }
  nodes.push({
    kind: "menu",
    id: "range",
    label: "range",
    detail: rangeDetail(context),
    help: "loop bars, copy, move, clear, paste or reverse them, insert or remove bars",
    build: rangeNodes,
  });
  // The style browser: a whole song from a style (src/tui/style-menu.ts).
  nodes.push({
    kind: "menu",
    id: "style",
    label: "style",
    detail: styleMenuDetail(context),
    help: "make a whole song from a style: the style tree, find and blend",
    build: styleMenuNodes,
  });
  return nodes;
}

function sectionDetail(context: MenuContext, section: Section): string {
  const parts = [barsLabel(section)];
  if (context.score.loopSection === section.name) parts.push("looping");
  if (section.mute?.length) parts.push(`mutes ${section.mute.join(" ")}`);
  const varied = Object.keys(section.vary ?? {});
  if (varied.length) parts.push(`varies ${varied.join(" ")}`);
  return parts.join(" · ");
}

function sectionNodes(context: MenuContext, name: string): MenuNode[] {
  const score = context.score;
  const section = score.sections.find((entry) => entry.name === name);
  if (!section)
    return [{ kind: "info", label: "gone", value: `${name} was removed` }];
  const looping = score.loopSection === name;
  const track = context.trackId;
  const vary = section.vary?.[track];
  const mutes: MenuNode[] = score.tracks.map((entry) => ({
    kind: "toggle",
    label: `mute ${entry.id}`,
    value: section.mute?.includes(entry.id) ?? false,
    help: `silence ${entry.name} in this section only`,
    command: (on) => `section ${on ? "mute" : "unmute"} ${name} ${entry.id}`,
  }));
  return [
    {
      kind: "action",
      label: looping ? "stop looping" : "loop",
      command: looping ? "section loop off" : `section loop ${name}`,
      help: "loop this section in playback (export still plays the song)",
    },
    {
      kind: "action",
      label: "jump here",
      command: `section jump ${name}`,
      help: "move the playhead to its first bar",
    },
    ...mutes,
    {
      kind: "number",
      label: `transpose ${track}`,
      help: "shift the focused track here, in semitones (x resets)",
      // As written is +0, so the first nudge already moves a semitone.
      value: vary?.transpose ?? 0,
      min: -24,
      max: 24,
      step: (value, direction) =>
        Math.max(-24, Math.min(24, Math.round(value) + direction)),
      format: (value) => `${value > 0 ? "+" : ""}${Math.round(value)} st`,
      command: (value) => {
        const rounded = Math.round(value);
        return `section vary ${name} ${track} ${rounded < 0 ? "" : "+"}${rounded}`;
      },
      reset: `section vary ${name} ${track} off`,
    },
    {
      kind: "number",
      label: `gain ${track}`,
      help: "scale the focused track's velocity here (x resets)",
      value: vary?.gain ?? 1,
      min: 0,
      max: 2,
      step: (value, direction) =>
        Math.max(
          0,
          Math.min(2, Math.round((value + 0.1 * direction) * 10) / 10),
        ),
      format: (value) => `×${value.toFixed(1)}`,
      command: (value) =>
        `section vary ${name} ${track} gain ${(Math.round(value * 10) / 10).toString()}`,
      reset: `section vary ${name} ${track} off`,
    },
    {
      kind: "menu",
      id: `section:${name}:build`,
      label: "build",
      detail: section.startBar > 0 ? "into it or over it" : "over it",
      help: "riser, snare roll, filter sweep and uplifter",
      build: () => buildNodes(section),
    },
    ...(section.startBar > 0
      ? ([
          {
            kind: "menu",
            id: `section:${name}:drop`,
            label: "drop",
            detail: "cut and impact",
            help: "a pre-drop cut before it and an impact on its downbeat",
            build: () => dropNodes(section),
          },
          {
            kind: "menu",
            id: `section:${name}:fill`,
            label: "fill",
            detail: "toms, roll or kick",
            help: "a drum fill on the beats before it and a crash on its downbeat",
            build: () => fillNodes(section),
          },
        ] satisfies MenuNode[])
      : []),
    {
      kind: "action",
      label: "duplicate",
      command: `section dup ${name}`,
      help: "copy it and its bars right after it",
    },
    {
      kind: "entry",
      label: "duplicate as",
      value: "",
      placeholder: "the copy's name",
      example: `section dup ${name} as ${name} 2`,
      help: "copy it and its bars right after it, under a new name",
      command: (text) =>
        text.trim() ? `section dup ${name} as ${text.trim()}` : undefined,
    },
    {
      kind: "entry",
      label: "move to",
      value: "",
      placeholder: "a bar, or before/after a section, e.g. 17 or after chorus",
      example: `section move ${name} to 17`,
      help: "move it and its bars; later sections make room",
      command: (text) => {
        const trimmed = text.trim();
        if (/^\d{1,4}$/u.test(trimmed))
          return `section move ${name} to ${trimmed}`;
        return /^(before|after)\s+\S/u.test(trimmed)
          ? `section move ${name} ${trimmed}`
          : undefined;
      },
    },
    {
      kind: "action",
      label: "move left",
      command: `section move ${name} left`,
      help: "swap it with the section before (its bars move too)",
    },
    {
      kind: "action",
      label: "move right",
      command: `section move ${name} right`,
      help: "swap it with the section after (its bars move too)",
    },
    {
      kind: "entry",
      label: "rename",
      value: name,
      placeholder: "new name",
      example: `section rename ${name} to hook`,
      help: "the form and the loop follow the new name",
      command: (text) =>
        text.trim() ? `section rename ${name} to ${text.trim()}` : undefined,
    },
    {
      kind: "action",
      label: "clear mutes and variations",
      command: `section reset ${name}`,
      help: "every track plays as written here",
    },
    {
      kind: "action",
      label: "unmark",
      command: `section unmark ${name}`,
      help: "remove the marker; the music stays",
    },
    {
      kind: "action",
      label: "delete with its bars",
      command: `section delete ${name}`,
      help: "remove it and its bars; later bars move up",
    },
  ];
}

/** Build rows: into the section (the bars before it) or over it. */
export function buildNodes(section: Section): MenuNode[] {
  const name = section.name;
  const nodes: MenuNode[] = [];
  if (section.startBar > 0) {
    const bars = Math.min(4, section.startBar);
    nodes.push({
      kind: "action",
      label: `into it (${bars} bar${bars === 1 ? "" : "s"} before)`,
      command: `build into ${name}`,
      help: `riser, snare roll, filter sweep and uplifter over bars ${section.startBar - bars + 1}–${section.startBar}, landing on its downbeat`,
    });
  }
  nodes.push(
    {
      kind: "action",
      label: "over it",
      command: `build ${name}`,
      help: "riser, snare roll, filter sweep and uplifter over this section, landing on the bar after",
    },
    {
      kind: "entry",
      label: "custom",
      value: "",
      placeholder:
        "bars and layers, e.g. 8 bars riser sweep (layers: riser roll sweep uplifter)",
      example: `build into ${name} 8 bars riser sweep`,
      help: "choose the length and which layers play",
      command: (text) => {
        const words = text.trim().toLowerCase().split(/\s+/u).filter(Boolean);
        const ok = words.every(
          (word, index) =>
            /^(riser|roll|sweep|uplifter)s?$/u.test(word) ||
            (/^\d{1,3}$/u.test(word) &&
              /^bars?$/u.test(words[index + 1] ?? "")) ||
            (/^bars?$/u.test(word) &&
              /^\d{1,3}$/u.test(words[index - 1] ?? "")),
        );
        if (!ok) return undefined;
        const target = section.startBar > 0 ? `into ${name}` : name;
        return `build ${target} ${words.join(" ")}`.trim();
      },
    },
  );
  return nodes;
}

/** Drop rows: cut length and the impact. */
export function dropNodes(section: Section): MenuNode[] {
  const name = section.name;
  return [
    {
      kind: "action",
      label: "cut 1 beat and impact",
      command: `drop ${name}`,
      help: "a one-beat cut before it and an impact on its downbeat",
    },
    {
      kind: "action",
      label: "cut 2 beats and impact",
      command: `drop ${name} cut 2`,
      help: "a two-beat cut before it and an impact on its downbeat",
    },
    {
      kind: "action",
      label: "impact only",
      command: `drop ${name} no cut`,
      help: "an impact on its downbeat, no cut",
    },
    {
      kind: "action",
      label: "cut only",
      command: `drop ${name} no impact`,
      help: "a one-beat cut before it, no impact",
    },
    {
      kind: "entry",
      label: "custom",
      value: "",
      placeholder: "cut beats and impact, e.g. cut 4 no impact",
      example: `drop ${name} cut 4 no impact`,
      help: "cut 0 up to two bars of beats; no impact skips the hit",
      command: (text) =>
        /^(cut\s+\d+(\.\d+)?|no\s+cut|no\s+impact|impact|\s)*$/iu.test(
          text.trim(),
        )
          ? `drop ${name} ${text.trim()}`.trim()
          : undefined,
    },
  ];
}

/** Fill rows: a style each, plus length and crash. */
export function fillNodes(section: Section): MenuNode[] {
  const name = section.name;
  return [
    {
      kind: "action",
      label: "toms",
      command: `fill ${name} toms`,
      help: "snare into high, mid and low toms on the beat before it, crash on its downbeat",
    },
    {
      kind: "action",
      label: "snare roll",
      command: `fill ${name} roll`,
      help: "snare 16ths on the beat before it, crash on its downbeat",
    },
    {
      kind: "action",
      label: "kick and snare",
      command: `fill ${name} kick`,
      help: "kick and snare 16ths on the beat before it, crash on its downbeat",
    },
    {
      kind: "entry",
      label: "custom",
      value: "",
      placeholder: "style, beats and crash, e.g. toms 2 beats no crash",
      example: `fill ${name} toms 2 beats no crash`,
      help: "styles toms, roll, kick; half a beat up to two bars",
      command: (text) =>
        /^(toms|roll|kick|\d+(\.\d+)?\s+beats?|no\s+crash|crash|\s)*$/iu.test(
          text.trim(),
        )
          ? `fill ${name} ${text.trim()}`.trim()
          : undefined,
    },
  ];
}

/** Arrange › sections: one row per section, then mark bars and add section. */
function sectionListNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  const nodes: MenuNode[] = score.sections.map((section) => ({
    kind: "menu",
    id: `section:${section.name}`,
    label: section.name,
    detail: sectionDetail(context, section),
    help: "loop, jump, mute, vary, move, rename, transitions",
    build: (next) => sectionNodes(next, section.name),
  }));
  nodes.push(
    {
      kind: "entry",
      label: "mark bars",
      value: "",
      placeholder: "name and bars, e.g. verse 1-8",
      example: "section verse 1-8",
      help: "name a bar range; re-marking a name moves its marker",
      command: (text) => {
        const trimmed = text.trim();
        return /\S\s+\d{1,4}(?:[-–]\d{1,4})?$/u.test(trimmed)
          ? `section ${trimmed}`
          : undefined;
      },
    },
    {
      kind: "entry",
      label: "add section",
      value: "",
      placeholder: "name and bars, e.g. chorus 8 (empty: next name, 8 bars)",
      example: "section add chorus 8",
      help: "a new section after the last one (extends the song)",
      command: (text) => `section add ${text.trim()}`.trim(),
    },
  );
  return nodes;
}
