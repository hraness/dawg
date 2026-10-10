/**
 * Arrangement prompt commands (0.5): song sections, the form, and the
 * build, drop and fill generators (core/sections.ts). Bars are numbered
 * from 1 here, as a DAW's ruler shows them; the score stores them from 0.
 *
 *   section                              list sections, the form and the loop
 *   section [mark] <name> <a>-<b> | <a>   mark bars a..b (re-marks an existing one)
 *   section add [<name>] [<n> bars]       a new section after the last one
 *   section dup <name> [as <new>]         copy it (and its bars) right after
 *   section move <name> to <bar> | left | right | before <x> | after <x>
 *   section rename <name> to <new>        (also `section rename <name> <new>`)
 *   section delete <name>                 remove it and its bars (ripple)
 *   section unmark <name>                 remove the marker; the music stays
 *   section mute|unmute <name> [<track>…] (the focused track by default)
 *   section vary <name> [<track>] [+12|-5] [gain 0.8] | off
 *   section reset <name>                  clear its mutes and variations
 *   section loop <name> | off             loop it in playback
 *   section jump <name>                   move the playhead to it
 *   form | form <a> <b>*2 … | form off | form bake
 *   build [into <section> | <section> | <a>-<b>] [<n> bars] [riser] [roll] [sweep] [uplifter]
 *   drop [<section> | at <bar>] [cut <beats>] [no impact]
 *   fill [<section> | at <bar>] [toms|roll|kick] [<n> beats] [no crash]
 *                                        (into the section: on the beats before it)
 *
 * Commands that do not match this grammar return undefined, so prose such
 * as `build a bigger chorus` or `drop the bass` still reaches the agent.
 */
import {
  ScoreValidationError,
  type Section,
  type TrackScore,
} from "../../core/score.ts";
import { nearest } from "./nearest.ts";
import {
  addSection,
  arrangedBars,
  arrangedStartBar,
  deleteSection,
  duplicateSection,
  joinSection,
  splitSection,
  DROP_CUT_MIN,
  FILL_STYLES,
  findSection,
  flattenForm,
  formatForm,
  generateBuild,
  generateDrop,
  generateFill,
  loopSection,
  moveSection,
  parseForm,
  renameSection,
  resetSection,
  resizeSection,
  setSectionMute,
  setSectionVariation,
  shiftSection,
  unmarkSection,
  withForm,
  type BuildOptions,
  type DropOptions,
  type FillOptions,
  type FillStyle,
} from "../../core/sections.ts";

export type SectionCommand =
  | { type: "section-list" }
  | { type: "section-mark"; name: string; startBar: number; bars: number }
  | { type: "section-add"; name?: string; bars?: number }
  | { type: "section-dup"; name: string; as?: string }
  | {
      type: "section-move";
      name: string;
      to:
        | { bar: number }
        | { step: -1 | 1 }
        | { before: string }
        | { after: string };
    }
  | { type: "section-rename"; name: string; to: string }
  | { type: "section-delete"; name: string }
  | { type: "section-unmark"; name: string }
  | {
      type: "section-mute";
      name: string;
      tracks: readonly string[];
      muted: boolean;
    }
  | {
      type: "section-vary";
      name: string;
      track?: string;
      transpose?: number;
      gain?: number;
      off?: boolean;
    }
  | { type: "section-reset"; name: string }
  | { type: "section-loop"; name?: string }
  | { type: "section-jump"; name: string }
  | { type: "section-split"; name: string; atBar: number }
  | { type: "section-join"; name: string; force: boolean }
  | { type: "form-show" }
  | { type: "form-set"; text: string }
  | { type: "form-bake" }
  | { type: "build"; options: BuildOptions }
  | { type: "drop"; options: DropOptions }
  | { type: "fill"; options: FillOptions }
  /** A known subcommand naming no section: answered locally, never sent on. */
  | { type: "section-unknown"; sub: string; name: string };

export type ArrangeResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
  /** `section jump`: the arranged beat the playhead moves to. */
  seekBeat?: number;
}>;

const VERBS = new Set(["section", "sections", "form", "build", "drop", "fill"]);
const SUBCOMMANDS = new Set([
  "add",
  "new",
  "dup",
  "duplicate",
  "copy",
  "move",
  "rename",
  "delete",
  "remove",
  "unmark",
  "mute",
  "unmute",
  "vary",
  "reset",
  "loop",
  "jump",
  "go",
  "split",
  "join",
]);

/** `3-6` or `3..6` or `3` → 0-based start and length (1-based inclusive in). */
function parseBars(word: string): { startBar: number; bars: number } | null {
  const match = /^(\d{1,4})(?:(?:-|\.\.|–)(\d{1,4}))?$/u.exec(word);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from < 1 || to < from) return null;
  return { startBar: from - 1, bars: to - from + 1 };
}

/** A section name from `words` (names may contain spaces), case-folded. */
function sectionName(
  score: TrackScore,
  words: readonly string[],
): string | undefined {
  if (words.length === 0) return undefined;
  return findSection(score, words.join(" "))?.name;
}

/**
 * Split `words` into a known section name prefix and the rest; the longest
 * matching prefix wins (`chorus 2 mute` → `chorus 2`, `mute`).
 */
function leadingSection(
  score: TrackScore,
  words: readonly string[],
): { name: string; rest: readonly string[] } | undefined {
  for (let length = words.length; length >= 1; length -= 1) {
    const name = sectionName(score, words.slice(0, length));
    if (name) return { name, rest: words.slice(length) };
  }
  return undefined;
}

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _'.-]{0,31}$/u;

/** A usable section name: not a bar range, which would read as one. */
const NAME = {
  test: (name: string): boolean =>
    NAME_PATTERN.test(name) && parseBars(name.toLowerCase()) === null,
};

export function parseSectionCommand(
  prompt: string,
  score: TrackScore,
): SectionCommand | undefined {
  if (prompt.length > 512) return undefined;
  const words = prompt.trim().replace(/^\//, "").split(/\s+/u);
  const verb = words[0]?.toLowerCase();
  if (!verb || !VERBS.has(verb)) return undefined;
  const rest = words.slice(1);
  const lower = rest.map((word) => word.toLowerCase());
  if (verb === "form") return parseFormWords(score, rest, lower);
  if (verb === "build") return parseBuild(score, lower);
  if (verb === "drop") return parseDrop(score, lower);
  if (verb === "fill") return parseFill(score, lower);
  if (rest.length === 0) return { type: "section-list" };
  const sub = lower[0]!;
  if (SUBCOMMANDS.has(sub))
    return (
      parseSub(score, sub, rest.slice(1)) ??
      unknownSection(score, sub, rest.slice(1))
    );
  // section [mark] <name> <a>-<b>: mark (or re-mark) bars.
  const marked = sub === "mark" ? rest.slice(1) : rest;
  const range = parseBars(marked[marked.length - 1]!.toLowerCase());
  const name = marked.slice(0, -1).join(" ");
  if (range && marked.length >= 2 && NAME.test(name))
    return { type: "section-mark", name, ...range };
  return undefined;
}

/**
 * `section <sub> <name…>` whose leading words name no section: a typo such
 * as `section loop chrous` gets a local error instead of reaching the agent.
 */
function unknownSection(
  score: TrackScore,
  sub: string,
  words: readonly string[],
): SectionCommand | undefined {
  if (sub === "add" || sub === "new" || words.length === 0) return undefined;
  const named = words[0]?.toLowerCase() === "to" ? words.slice(1) : words;
  if (named.length === 0) return undefined;
  if (leadingSection(score, named)) return undefined;
  // Loop, jump and the one-word edits take the whole rest as the name;
  // the others name the section first, then their own words.
  const whole = new Set([
    "loop",
    "jump",
    "go",
    "delete",
    "remove",
    "unmark",
    "reset",
  ]);
  const stop = named.findIndex((word) => /^(to|as)$/iu.test(word));
  const name = whole.has(sub)
    ? named.join(" ")
    : sub === "rename" && stop > 0
      ? named.slice(0, stop).join(" ")
      : named[0]!;
  return { type: "section-unknown", sub, name };
}

/** `no section named chrous (sections: …) · did you mean chorus?` */
function unknownSectionMessage(score: TrackScore, name: string): string {
  const match = nearest(
    name,
    score.sections.map((section) => section.name),
  );
  const list =
    score.sections.length > 0
      ? ` (sections: ${score.sections.map((s) => s.name).join(", ")})`
      : " (no sections yet: section verse 1-8 marks one)";
  const near = match ? ` · did you mean ${match}?` : "";
  return `section · no section named ${name}${list}${near}`;
}

function parseSub(
  score: TrackScore,
  sub: string,
  words: readonly string[],
): SectionCommand | undefined {
  const lower = words.map((word) => word.toLowerCase());
  if (sub === "add" || sub === "new") {
    let bars: number | undefined;
    let nameWords = [...words];
    const barsAt = lower.findIndex((word) => /^bars?$/u.test(word));
    if (barsAt > 0 && /^\d{1,3}$/u.test(lower[barsAt - 1]!)) {
      bars = Number(lower[barsAt - 1]);
      nameWords = words.slice(0, barsAt - 1);
    } else if (/^\d{1,3}$/u.test(lower[lower.length - 1] ?? "")) {
      bars = Number(lower[lower.length - 1]);
      nameWords = words.slice(0, -1);
    }
    if (bars !== undefined && bars < 1) return undefined;
    const name = nameWords.join(" ");
    if (name !== "" && !NAME.test(name)) return undefined;
    return {
      type: "section-add",
      ...(name ? { name } : {}),
      ...(bars !== undefined ? { bars } : {}),
    };
  }
  if (sub === "loop") {
    if (words.length === 0) return undefined;
    if (lower.length === 1 && (lower[0] === "off" || lower[0] === "none"))
      return { type: "section-loop" };
    const name = sectionName(score, words);
    return name ? { type: "section-loop", name } : undefined;
  }
  if (sub === "jump" || sub === "go") {
    const name = sectionName(score, words[0] === "to" ? words.slice(1) : words);
    return name ? { type: "section-jump", name } : undefined;
  }
  if (sub === "rename") {
    const toAt = lower.indexOf("to");
    if (toAt > 0) {
      const name = sectionName(score, words.slice(0, toAt));
      const to = words.slice(toAt + 1).join(" ");
      return name && NAME.test(to)
        ? { type: "section-rename", name, to }
        : undefined;
    }
    const lead = leadingSection(score, words);
    const to = lead?.rest.join(" ") ?? "";
    return lead && NAME.test(to)
      ? { type: "section-rename", name: lead.name, to }
      : undefined;
  }
  const lead = leadingSection(score, words);
  if (!lead) return undefined;
  const tail = lead.rest.map((word) => word.toLowerCase());
  switch (sub) {
    case "dup":
    case "duplicate":
    case "copy": {
      if (tail.length === 0) return { type: "section-dup", name: lead.name };
      const as = lead.rest.slice(1).join(" ");
      return tail[0] === "as" && NAME.test(as)
        ? { type: "section-dup", name: lead.name, as }
        : undefined;
    }
    case "move": {
      const where = tail[0] === "to" ? tail.slice(1) : tail;
      if (where.length === 1 && (where[0] === "left" || where[0] === "earlier"))
        return { type: "section-move", name: lead.name, to: { step: -1 } };
      if (where.length === 1 && (where[0] === "right" || where[0] === "later"))
        return { type: "section-move", name: lead.name, to: { step: 1 } };
      if (where.length === 2 && where[0] === "bar") where.shift();
      if (where.length === 1 && /^\d{1,4}$/u.test(where[0]!)) {
        const bar = Number(where[0]);
        return bar >= 1
          ? { type: "section-move", name: lead.name, to: { bar: bar - 1 } }
          : undefined;
      }
      if (where[0] === "before" || where[0] === "after") {
        const other = sectionName(
          score,
          lead.rest.slice(tail.length - where.length + 1),
        );
        if (!other) return undefined;
        return {
          type: "section-move",
          name: lead.name,
          to: where[0] === "before" ? { before: other } : { after: other },
        };
      }
      return undefined;
    }
    case "delete":
    case "remove":
      return tail.length === 0
        ? { type: "section-delete", name: lead.name }
        : undefined;
    case "unmark":
      return tail.length === 0
        ? { type: "section-unmark", name: lead.name }
        : undefined;
    case "reset":
      return tail.length === 0
        ? { type: "section-reset", name: lead.name }
        : undefined;
    case "mute":
    case "unmute":
      return {
        type: "section-mute",
        name: lead.name,
        tracks: lead.rest,
        muted: sub === "mute",
      };
    case "vary":
      return parseVary(lead.name, lead.rest);
    case "split": {
      // section split verse at 5 (1-based bar)
      const where = tail[0] === "at" ? tail.slice(1) : tail;
      if (where.length === 2 && where[0] === "bar") where.shift();
      if (where.length !== 1 || !/^\d{1,4}$/u.test(where[0]!)) return undefined;
      const bar = Number(where[0]);
      return bar >= 1
        ? { type: "section-split", name: lead.name, atBar: bar - 1 }
        : undefined;
    }
    case "join":
      if (tail.length === 0)
        return { type: "section-join", name: lead.name, force: false };
      return tail.length === 1 && tail[0] === "force"
        ? { type: "section-join", name: lead.name, force: true }
        : undefined;
    default:
      return undefined;
  }
}

function parseVary(
  name: string,
  words: readonly string[],
): SectionCommand | undefined {
  const out: {
    type: "section-vary";
    name: string;
    track?: string;
    transpose?: number;
    gain?: number;
    off?: boolean;
  } = { type: "section-vary", name };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const lower = word.toLowerCase();
    if (lower === "off" || lower === "reset") out.off = true;
    else if (/^[+-]\d{1,2}$/u.test(lower)) out.transpose = Number(lower);
    else if (lower === "transpose" || lower === "octave") {
      const value = words[index + 1];
      if (
        lower === "octave" &&
        (value === undefined || !/^[+-]?\d$/u.test(value))
      ) {
        out.transpose = 12;
        continue;
      }
      if (value === undefined || !/^[+-]?\d{1,2}$/u.test(value))
        return undefined;
      out.transpose = Number(value) * (lower === "octave" ? 12 : 1);
      index += 1;
    } else if (lower === "gain" || lower === "velocity") {
      const value = Number(words[index + 1]);
      if (!Number.isFinite(value)) return undefined;
      out.gain = value;
      index += 1;
    } else if (out.track === undefined) out.track = word;
    else return undefined;
  }
  if (!out.off && out.transpose === undefined && out.gain === undefined)
    return undefined;
  return out;
}

function parseFormWords(
  score: TrackScore,
  words: readonly string[],
  lower: readonly string[],
): SectionCommand | undefined {
  if (words.length === 0) return { type: "form-show" };
  if (
    lower.length === 1 &&
    (lower[0] === "bake" || lower[0] === "flatten" || lower[0] === "print")
  )
    return { type: "form-bake" };
  if (lower.length === 1 && (lower[0] === "off" || lower[0] === "none"))
    return { type: "form-set", text: "" };
  const text = words.join(" ");
  // Prose (`form a catchy hook`) names no section at all: leave it to the
  // agent. A form naming at least one section is a form; a typo in it gets
  // the "no section named" error.
  const items = text.includes(",") ? text.split(",") : words;
  const names = items.some((item) =>
    findSection(score, item.trim().replace(/\s*(?:\*|x|×)\s*\d+$/iu, "")),
  );
  return names ? { type: "form-set", text } : undefined;
}

/** A range: a section name, `a-b` bars, or `at <bar>`; the rest is options. */
function parseTarget(
  score: TrackScore,
  words: readonly string[],
): {
  section?: string;
  /** The section came after `into` (or `at`/`in`): lead into it. */
  into?: boolean;
  range?: { startBar: number; bars: number };
  rest: string[];
} {
  const rest = [...words];
  for (let index = 0; index < rest.length; index += 1) {
    if (
      rest[index] === "at" ||
      rest[index] === "into" ||
      rest[index] === "in"
    ) {
      const tail = rest.slice(index + 1);
      const range =
        tail[0] === "bar" ? parseBars(tail[1] ?? "") : parseBars(tail[0] ?? "");
      if (range) {
        rest.splice(index, tail[0] === "bar" ? 3 : 2);
        return { range, rest };
      }
      const lead = leadingSection(score, tail);
      if (lead) {
        rest.splice(index, tail.length - lead.rest.length + 1);
        return { section: lead.name, into: true, rest };
      }
      continue;
    }
    const range = parseBars(rest[index]!);
    if (
      range &&
      rest[index + 1] !== "beats" &&
      rest[index + 1] !== "beat" &&
      rest[index + 1] !== "bars" &&
      rest[index + 1] !== "bar" &&
      rest[index - 1] !== "cut"
    ) {
      rest.splice(index, 1);
      return { range, rest };
    }
    const lead = leadingSection(score, rest.slice(index));
    if (lead) {
      rest.splice(index, rest.length - index - lead.rest.length);
      return { section: lead.name, rest };
    }
  }
  return { rest };
}

const BUILD_PARTS = ["riser", "roll", "sweep", "uplifter"] as const;

function parseBuild(
  score: TrackScore,
  words: readonly string[],
): SectionCommand | undefined {
  const target = parseTarget(score, words);
  const parts = new Set<string>();
  let bars: number | undefined;
  const rest = target.rest;
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index]!;
    if (/^\d{1,3}$/u.test(word) && /^bars?$/u.test(rest[index + 1] ?? "")) {
      bars = Number(word);
      if (bars < 1) return undefined;
      index += 1;
      continue;
    }
    const part = word.replace(/s$/u, "");
    if (!(BUILD_PARTS as readonly string[]).includes(part)) return undefined;
    parts.add(part);
  }
  const options: Record<string, unknown> = {};
  if (target.section)
    options[target.into ? "into" : "section"] = target.section;
  if (target.range) Object.assign(options, target.range);
  if (bars !== undefined) options.bars = bars;
  if (parts.size > 0)
    for (const part of BUILD_PARTS) options[part] = parts.has(part);
  return { type: "build", options: options as BuildOptions };
}

function parseDrop(
  score: TrackScore,
  words: readonly string[],
): SectionCommand | undefined {
  const target = parseTarget(score, words);
  const options: {
    section?: string;
    bar?: number;
    cut?: number;
    impact?: boolean;
  } = {};
  if (target.section) options.section = target.section;
  if (target.range) options.bar = target.range.startBar;
  const rest = target.rest;
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index]!;
    if (word === "cut") {
      const value = Number(rest[index + 1]);
      if (!Number.isFinite(value) || value < DROP_CUT_MIN) return undefined;
      options.cut = value;
      index += rest[index + 2]?.startsWith("beat") ? 2 : 1;
    } else if (
      word === "nocut" ||
      (word === "no" && rest[index + 1] === "cut")
    ) {
      options.cut = 0;
      if (word === "no") index += 1;
    } else if (word === "no" && rest[index + 1] === "impact") {
      options.impact = false;
      index += 1;
    } else if (word === "impact") options.impact = true;
    else return undefined;
  }
  return { type: "drop", options };
}

function parseFill(
  score: TrackScore,
  words: readonly string[],
): SectionCommand | undefined {
  const target = parseTarget(score, words);
  const options: {
    section?: string;
    bar?: number;
    beats?: number;
    style?: FillStyle;
    crash?: boolean;
  } = {};
  if (target.section) options.section = target.section;
  // `fill at 9`: the fill leads into bar 9.
  if (target.range) options.bar = target.range.startBar;
  const rest = target.rest;
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index]!;
    if ((FILL_STYLES as readonly string[]).includes(word))
      options.style = word as FillStyle;
    else if (
      /^\d(\.\d+)?$/u.test(word) &&
      /^beats?$/u.test(rest[index + 1] ?? "")
    ) {
      options.beats = Number(word);
      index += 1;
    } else if (word === "no" && rest[index + 1] === "crash") {
      options.crash = false;
      index += 1;
    } else if (word === "crash") options.crash = true;
    else return undefined;
  }
  return { type: "fill", options };
}

/** `verse 1–8` (1-based inclusive). */
export function barsLabel(section: Pick<Section, "startBar" | "bars">): string {
  const from = section.startBar + 1;
  const to = section.startBar + section.bars;
  return from === to ? `bar ${from}` : `bars ${from}–${to}`;
}

function describeSection(score: TrackScore, section: Section): string {
  const parts = [`${section.name} ${barsLabel(section)}`];
  if (section.mute && section.mute.length > 0)
    parts.push(`mutes ${section.mute.join(" ")}`);
  for (const [track, vary] of Object.entries(section.vary ?? {})) {
    const bits: string[] = [];
    if (vary.transpose)
      bits.push(`${vary.transpose > 0 ? "+" : ""}${vary.transpose}`);
    if (vary.gain !== undefined && vary.gain !== 1)
      bits.push(`gain ${vary.gain}`);
    if (bits.length > 0) parts.push(`${track} ${bits.join(" ")}`);
  }
  if (score.loopSection === section.name) parts.push("looping");
  return parts.join(" · ");
}

/** One line for the activity log: sections, the form and the loop. */
export function describeArrangement(score: TrackScore): string {
  if (score.sections.length === 0)
    return "no sections · section verse 1-8 marks bars 1–8 · section add chorus 8";
  const sections = score.sections
    .map((section) => describeSection(score, section))
    .join(" | ");
  const form =
    score.form.length > 0
      ? ` · form ${formatForm(score.form)} (${arrangedBars(score)} bars)`
      : "";
  return `sections · ${sections}${form}`;
}

function trackIdFor(score: TrackScore, word: string): string | undefined {
  const key = word.toLowerCase();
  return (
    score.tracks.find((track) => track.id.toLowerCase() === key)?.id ??
    score.tracks.find((track) => track.name.toLowerCase() === key)?.id
  );
}

function changed(
  score: TrackScore,
  next: TrackScore,
  message: string,
  kind = "score.sections",
): ArrangeResult {
  return {
    ok: true,
    message,
    next,
    kind,
    payload: {
      sections: next.sections,
      form: next.form,
      ...(next.loopSection ? { loopSection: next.loopSection } : {}),
      ...(next.bars !== score.bars ? { bars: next.bars } : {}),
    },
  };
}

export function applySectionCommand(
  score: TrackScore,
  trackId: string,
  command: SectionCommand,
): ArrangeResult {
  try {
    return applyUnchecked(score, trackId, command);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return {
        ok: false,
        message: `${command.type.split("-")[0]} · ${error.message}`,
      };
    throw error;
  }
}

function applyUnchecked(
  score: TrackScore,
  trackId: string,
  command: SectionCommand,
): ArrangeResult {
  switch (command.type) {
    case "section-unknown":
      return { ok: false, message: unknownSectionMessage(score, command.name) };
    case "section-list":
      return { ok: true, message: describeArrangement(score) };
    case "section-mark": {
      const existing = findSection(score, command.name);
      const next = existing
        ? resizeSection(score, existing.name, command)
        : addSection(score, command);
      const section = findSection(next, command.name)!;
      return changed(
        score,
        next,
        `section · ${section.name} ${barsLabel(section)}`,
      );
    }
    case "section-add": {
      const next = addSection(score, {
        ...(command.name ? { name: command.name } : {}),
        ...(command.bars ? { bars: command.bars } : {}),
      });
      const section = next.sections.find(
        (candidate) => !findSection(score, candidate.name),
      )!;
      return changed(
        score,
        next,
        `section · added ${section.name} ${barsLabel(section)}${next.bars > score.bars ? ` · song now ${next.bars} bars` : ""}`,
      );
    }
    case "section-split": {
      const next = splitSection(score, command.name, command.atBar);
      const half = next.sections.find(
        (candidate) => !findSection(score, candidate.name),
      );
      return changed(
        score,
        next,
        `section · ${command.name} split at bar ${command.atBar + 1}${half ? ` · ${half.name} ${barsLabel(half)}` : ""}`,
      );
    }
    case "section-join": {
      const section = findSection(score, command.name)!;
      const next = joinSection(score, command.name, { force: command.force });
      const joined = findSection(next, section.name);
      return changed(
        score,
        next,
        `section · joined into ${section.name}${joined ? ` ${barsLabel(joined)}` : ""}`,
      );
    }
    case "section-dup": {
      const next = duplicateSection(score, command.name, {
        ...(command.as ? { as: command.as } : {}),
      });
      const copy = next.sections.find(
        (candidate) => !findSection(score, candidate.name),
      );
      return changed(
        score,
        next,
        `section · ${command.name} copied${copy ? ` as ${copy.name} ${barsLabel(copy)}` : ""}`,
      );
    }
    case "section-move": {
      const to = command.to;
      let next: TrackScore;
      if ("step" in to) next = shiftSection(score, command.name, to.step);
      else if ("bar" in to) next = moveSection(score, command.name, to.bar);
      else {
        const other = findSection(
          score,
          "before" in to ? to.before : to.after,
        )!;
        const section = findSection(score, command.name)!;
        let bar = "before" in to ? other.startBar : other.startBar + other.bars;
        // Removing the moved bars first shifts later targets left.
        if (bar > section.startBar) bar -= section.bars;
        next = moveSection(score, command.name, bar);
      }
      const moved = findSection(next, command.name)!;
      return changed(
        score,
        next,
        `section · ${moved.name} now ${barsLabel(moved)}`,
      );
    }
    case "section-rename": {
      const next = renameSection(score, command.name, command.to);
      return changed(
        score,
        next,
        `section · ${command.name} renamed ${command.to}`,
      );
    }
    case "section-delete": {
      const section = findSection(score, command.name)!;
      const next = deleteSection(score, command.name);
      return changed(
        score,
        next,
        `section · deleted ${section.name} and ${barsLabel(section)} · song now ${next.bars} bars`,
      );
    }
    case "section-unmark": {
      const next = unmarkSection(score, command.name);
      return changed(
        score,
        next,
        `section · unmarked ${command.name}; the music stays`,
      );
    }
    case "section-mute": {
      const words = command.tracks.length > 0 ? command.tracks : [trackId];
      let next = score;
      const names: string[] = [];
      for (const word of words) {
        const id = trackIdFor(score, word);
        if (!id) return { ok: false, message: `section · no track ${word}` };
        next = setSectionMute(next, command.name, id, command.muted);
        names.push(id);
      }
      return changed(
        score,
        next,
        `section · ${command.name} ${command.muted ? "mutes" : "unmutes"} ${names.join(" ")}`,
      );
    }
    case "section-vary": {
      const id = command.track ? trackIdFor(score, command.track) : trackId;
      if (!id)
        return { ok: false, message: `section · no track ${command.track}` };
      const variation = command.off
        ? undefined
        : {
            ...(command.transpose !== undefined
              ? { transpose: command.transpose }
              : {}),
            ...(command.gain !== undefined ? { gain: command.gain } : {}),
          };
      const next = setSectionVariation(score, command.name, id, variation);
      return changed(
        score,
        next,
        `section · ${command.name} ${id} ${variation ? describeVary(variation) : "as written"}`,
      );
    }
    case "section-reset": {
      const next = resetSection(score, command.name);
      return changed(score, next, `section · ${command.name} plays as written`);
    }
    case "section-loop": {
      const next = loopSection(score, command.name);
      const section = command.name
        ? findSection(next, command.name)
        : undefined;
      return changed(
        score,
        next,
        section
          ? `section · looping ${section.name} ${barsLabel(section)}`
          : "section · loop off · playing the song",
      );
    }
    case "section-jump": {
      const section = findSection(score, command.name)!;
      if (score.loopSection !== undefined) {
        // Looping another section: the loop follows the jump.
        const next =
          score.loopSection === section.name
            ? score
            : loopSection(score, section.name);
        return {
          ...(next === score
            ? {
                ok: true,
                message: `section · ${section.name} · bar ${section.startBar + 1}`,
              }
            : changed(
                score,
                next,
                `section · looping ${section.name} ${barsLabel(section)}`,
              )),
          seekBeat: 0,
        };
      }
      const bar = arrangedStartBar(score, section);
      return {
        ok: true,
        message: `section · ${section.name} · bar ${bar + 1}`,
        seekBeat: bar * score.beatsPerBar,
      };
    }
    case "form-show":
      return {
        ok: true,
        message:
          score.form.length > 0
            ? `form · ${formatForm(score.form)} · ${arrangedBars(score)} bars`
            : `form · none (plays straight through) · form ${
                score.sections
                  .map((s) => s.name)
                  .slice(0, 3)
                  .join(" ") || "verse chorus verse"
              }`,
      };
    case "form-set": {
      const next = withForm(score, parseForm(score, command.text));
      return changed(
        score,
        next,
        next.form.length > 0
          ? `form · ${formatForm(next.form)} · ${arrangedBars(next)} bars`
          : "form · off · plays straight through",
      );
    }
    case "form-bake": {
      if (score.form.length === 0)
        return {
          ok: false,
          message: "form · no form to bake · form verse chorus verse",
        };
      const next = flattenForm(score);
      return changed(score, next, `form · baked into ${next.bars} bars`);
    }
    case "build": {
      const result = generateBuild(score, command.options);
      return changed(
        score,
        result.score,
        `build · ${result.summary}`,
        "score.build",
      );
    }
    case "drop": {
      const result = generateDrop(score, command.options);
      return changed(
        score,
        result.score,
        `drop · ${result.summary}`,
        "score.drop",
      );
    }
    case "fill": {
      const result = generateFill(score, command.options);
      return changed(
        score,
        result.score,
        `fill · ${result.summary}`,
        "score.fill",
      );
    }
  }
}

function describeVary(vary: { transpose?: number; gain?: number }): string {
  const bits: string[] = [];
  if (vary.transpose !== undefined)
    bits.push(`${vary.transpose > 0 ? "+" : ""}${vary.transpose} st`);
  if (vary.gain !== undefined) bits.push(`gain ${vary.gain}`);
  return bits.join(" ");
}

/**
 * `loop 2-3`: the loop range (score.loop, op1-ux §4), never a section. A
 * range past the song's end is refused; a looped section stops looping.
 */
export function loopSpan(
  score: TrackScore,
  from: number,
  to: number,
):
  | Readonly<{ ok: true; next: TrackScore; message: string }>
  | Readonly<{ ok: false; message: string }> {
  const bars = from === to ? `${from}` : `${from}-${to}`;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)
    return { ok: false, message: `loop ${bars} · bars run low-high from 1` };
  if (to > score.bars)
    return {
      ok: false,
      message: `loop ${bars} · the song has ${score.bars} bars · bars ${to} lengthens it`,
    };
  const next = score.withLoop({ startBar: from - 1, bars: to - from + 1 });
  return {
    ok: true,
    next,
    message: `loop · bars ${from === to ? from : `${from}–${to}`} · loop off plays the song`,
  };
}
