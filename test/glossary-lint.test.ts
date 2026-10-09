/**
 * Glossary lint (design §2, §8.2 and §7 E2, E7): the words dawg retired, and
 * British spellings, appear in no user-facing string: help, menu labels and
 * help text, guides, DAWG.md, README, docs, and the prose literals of core/,
 * tui/, src/commands, src/tui, src/agent and src/main.ts (receipts, hints,
 * --help, tool descriptions). Alias tables (`const X_ALIASES = …`) and code
 * lines that say "alias" are exempt, because the old words stay typeable; in
 * Markdown only the backticked tokens of an alias sentence are exempt.
 *
 * British spellings are at zero. Retired phrases are held at an exact count
 * per source, a ratchet that only moves down as the owning lanes merge.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { HELP_SECTIONS, USAGE } from "../src/commands/help.ts";
import { RIG_PRESETS } from "../core/fx.ts";
import { guideFiles, read, walkAll } from "./consistency-lib.ts";

/** British spelling → American (design §2 house style). */
export const SPELLING: Readonly<Record<string, string>> = {
  centre: "center",
  centred: "centered",
  centres: "centers",
  colour: "color",
  colours: "colors",
  coloured: "colored",
  behaviour: "behavior",
  behaviours: "behaviors",
  modelled: "modeled",
  modelling: "modeling",
  cancelled: "canceled",
  cancelling: "canceling",
  analyse: "analyze",
  analysed: "analyzed",
  analysing: "analyzing",
  labelled: "labeled",
  labelling: "labeling",
  levelled: "leveled",
  travelling: "traveling",
  towards: "toward",
  normalise: "normalize",
  normalised: "normalized",
  synthesise: "synthesize",
  synthesised: "synthesized",
  recognise: "recognize",
  recognised: "recognized",
  organise: "organize",
  favourite: "favorite",
  licence: "license",
  grey: "gray",
  programme: "program",
  catalogue: "catalog",
  optimise: "optimize",
  customise: "customize",
  visualise: "visualize",
  harmonise: "harmonize",
  summarise: "summarize",
};

/**
 * Retired phrases (design §2 and §8.2): label → pattern and replacement.
 * Patterns respect context, so `ctrl-p play mode` passes while the hint
 * `ctrl-p play` counts, and `/login` typed as an alias in an alias table or
 * an alias sentence stays exempt.
 */
export const LOSERS: Readonly<
  Record<string, Readonly<{ pattern: RegExp; use: string }>>
> = {
  "browse sounds": { pattern: /\bbrowse sounds\b/gi, use: "instruments" },
  "use a sound": { pattern: /\buse a sound\b/gi, use: "use a sample" },
  "drum voice": { pattern: /\bdrum voices?\b/gi, use: "drum" },
  "drum kit": { pattern: /\bdrum kits?\b/gi, use: "kit" },
  "drum pattern": { pattern: /\bdrum patterns?\b/gi, use: "groove" },
  temperament: { pattern: /\btemperaments?\b/gi, use: "tuning" },
  STEER: { pattern: /\bSTEER\b/g, use: "now" },
  QUEUE: { pattern: /\bQUEUE\b/g, use: "next" },
  login: { pattern: /\blog ?in\b/gi, use: "model key" },
  "sign in": { pattern: /\bsign[- ]in\b/gi, use: "model key" },
  "ctrl-p play": {
    pattern: /\bctrl-p play\b(?! mode)/gi,
    use: "ctrl-p play mode",
  },
  "keys mode": { pattern: /\bkeys mode\b/gi, use: "play mode" },
  genre: { pattern: /\bgenres?\b/gi, use: "style" },
  // Waveform, duty and LFO cycles are fine; the playback loop is not a cycle.
  cycle: {
    pattern: /\b(?:track cycle|cycle (?:region|mode|length|on|off|range))\b/gi,
    use: "loop",
  },
  region: {
    pattern: /\b(?:loop|playback|cycle|song) regions?\b/gi,
    use: "loop or section",
  },
  segment: {
    pattern: /\b(?:song|arrangement|form) segments?\b/gi,
    use: "section",
  },
  "arrangement order": { pattern: /\barrangement order\b/gi, use: "form" },
  patch: {
    pattern: /\b(?:patch|program) (?:change|name)s?\b/gi,
    use: "preset",
  },
  assistant: { pattern: /\b(?:AI|assistant|chatbot|bot)\b/g, use: "agent" },
  "track <rig>": {
    pattern: new RegExp(
      `\\btrack (?:${Object.keys(RIG_PRESETS).join("|")})\\b`,
      "gi",
    ),
    use: "rig <preset>",
  },
};

const spellingPattern = new RegExp(
  `\\b(${Object.keys(SPELLING).join("|")})\\b`,
  "i",
);

function loserCount(text: string, loser: string): number {
  return [...text.matchAll(LOSERS[loser]!.pattern)].length;
}

/** The string literals of a TypeScript file, with their line numbers. */
export function literals(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      for (const ch of source.slice(i, end)) if (ch === "\n") line++;
      i = end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const start = line;
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") {
          text += source[j + 1];
          j += 2;
          continue;
        }
        if (source[j] === "\n") line++;
        text += source[j];
        j++;
      }
      out.push({ line: start, text });
      i = j + 1;
    } else i++;
  }
  return out;
}

/** Lines of `source` inside a `const X_ALIASES` table, or saying "alias". */
function exemptLines(source: string): Set<number> {
  const exempt = new Set<number>();
  const lines = source.split("\n");
  let depth = 0;
  lines.forEach((text, index) => {
    if (/const [A-Z_]*ALIAS[A-Z_]*\b/.test(text)) depth = Math.max(depth, 1);
    if (depth > 0) {
      exempt.add(index + 1);
      depth += (text.match(/[{[(]/g) ?? []).length;
      depth -= (text.match(/[}\])]/g) ?? []).length;
      if (depth <= 1 && /[}\]);]\s*;?\s*$/.test(text)) depth = 0;
    }
    if (/alias/i.test(text)) exempt.add(index + 1);
  });
  return exempt;
}

type Source = { name: string; strings: string[] };

function markdownSources(): Source[] {
  const files = [
    ...guideFiles().map((file) => file.path),
    "DAWG.md",
    "README.md",
    ...readdirSync(`${import.meta.dir}/../docs`)
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`),
  ];
  return files.map((name) => ({ name, strings: markdownStrings(read(name)) }));
}

/**
 * The prose of a Markdown file. A table row that names an alias is dropped
 * whole (it is the alias table); in a paragraph that says "alias" only the
 * backticked tokens go, so the rest of the paragraph is still checked.
 */
export function markdownStrings(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    if (!/alias/i.test(line)) return [line];
    if (/^\s*\|/.test(line)) return [];
    return [line.replace(/`[^`]*`/g, "``")];
  });
}

/** Non-test TypeScript files under `dir`, recursively, repo-relative. */
function tsFiles(dir: string): string[] {
  return readdirSync(`${import.meta.dir}/../${dir}`, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => `${dir}/${name}`)
    .sort();
}

/**
 * Every string a person or the agent reads: core receipts and errors, the
 * TUI and its hints, the window commands and --help in src/main.ts, and the
 * agent's tool descriptions.
 */
export const CODE_DIRS = [
  "core",
  "tui",
  "src/commands",
  "src/tui",
  "src/agent",
];

function codeSources(): Source[] {
  const files = [
    ...CODE_DIRS.flatMap(tsFiles),
    "src/main.ts",
    "src/audio/autotune.ts",
  ];
  return files.map((name) => {
    const source = read(name);
    const exempt = exemptLines(source);
    return {
      name,
      // A literal with no space is an identifier or a wire value
      // (`"cancelled"` from a provider, a `phasercentre` alias key), not prose.
      strings: literals(source)
        .filter((literal) => !exempt.has(literal.line))
        .map((literal) => literal.text)
        .filter((text) => /\s/.test(text.trim())),
    };
  });
}

function menuSource(): Source {
  const strings = new Set<string>();
  for (const { walked } of walkAll())
    for (const { node } of walked) {
      strings.add(node.label);
      if ("help" in node && typeof node.help === "string")
        strings.add(node.help);
      if ("detail" in node && typeof node.detail === "string")
        strings.add(node.detail);
    }
  return { name: "menu", strings: [...strings] };
}

function helpSource(): Source {
  const strings: string[] = [...Object.values(USAGE)];
  for (const section of HELP_SECTIONS)
    for (const entry of section.entries)
      strings.push(entry.command, entry.summary);
  return { name: "help", strings };
}

const SOURCES: Source[] = [
  helpSource(),
  menuSource(),
  ...markdownSources(),
  ...codeSources(),
];

/**
 * Exact counts of retired phrases per source (design §2, §8.2, E7). The
 * renames belong to other lanes: the menu lane (PR #139: instruments, kits,
 * grooves), the feel lane (PR #140: hints, now/next pills), the grammar lane
 * (PR #141: loop, `rig <preset>`, `model key`) and the language lane (PR #142:
 * docs, guides, help). Each count must equal its ceiling, so a rename that
 * lands forces the number down here and a regression cannot creep back up.
 * The target is an empty table.
 */
const LOSER_CEILINGS: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {
  help: {
    "drum voice": 1,
    "drum kit": 1,
    login: 2,
    "sign in": 1,
    cycle: 2,
    "track <rig>": 1,
  },
  menu: {
    "browse sounds": 1,
    "use a sound": 1,
    "drum voice": 1,
    "drum kit": 2,
    "drum pattern": 1,
    cycle: 1,
  },
  "guides/providers.md": { login: 2, assistant: 1 },
  "guides/rhythm.md": { "drum kit": 1 },
  "guides/sounds.md": { "browse sounds": 2 },
  "guides/tempo.md": { cycle: 1 },
  "guides/web-search.md": { assistant: 1 },
  "DAWG.md": {
    "browse sounds": 14,
    "use a sound": 1,
    "drum voice": 1,
    "drum kit": 6,
    "drum pattern": 3,
    temperament: 1,
    STEER: 1,
    QUEUE: 2,
    login: 8,
    "ctrl-p play": 1,
    genre: 1,
    cycle: 1,
    region: 1,
    assistant: 3,
    "track <rig>": 5,
  },
  "README.md": {
    "drum voice": 1,
    STEER: 3,
    QUEUE: 2,
    login: 10,
    "sign in": 2,
    assistant: 2,
  },
  "docs/publishing.md": { login: 1 },
  "docs/show-me.md": { login: 1 },
  "docs/model-eval.md": { genre: 1, assistant: 2 },
  "docs/project-format.md": { "sign in": 1 },
  "core/fx.ts": { cycle: 1 },
  "core/sdk/v1.ts": { "drum voice": 1, "drum pattern": 1 },
  "core/styles/africa-mena-southasia.ts": { "drum pattern": 1 },
  "core/styles/americas.ts": { "drum kit": 1 },
  "core/styles/electronic.ts": { genre: 1 },
  "core/styles/pop.ts": { genre: 1 },
  "core/tuning.ts": { temperament: 1 },
  "tui/app.ts": { login: 1 },
  "tui/highway.ts": { "ctrl-p play": 1 },
  "src/commands/help.ts": {
    "drum voice": 1,
    "drum kit": 2,
    login: 2,
    "sign in": 1,
    cycle: 2,
    "track <rig>": 1,
  },
  "src/commands/modal.ts": { "browse sounds": 1 },
  "src/commands/time.ts": { cycle: 1 },
  "src/tui/menu-time.ts": { cycle: 2 },
  "src/tui/menu.ts": {
    "browse sounds": 1,
    "use a sound": 1,
    "drum voice": 1,
    "drum kit": 2,
    "drum pattern": 1,
  },
  "src/agent/agent.ts": { genre: 1 },
  "src/agent/command-agent.ts": { genre: 1 },
  "src/agent/drum-tools.ts": { "drum kit": 1, "drum pattern": 1, genre: 1 },
  "src/agent/gateway.ts": { login: 2, assistant: 3 },
  "src/agent/pack-tools.ts": { "drum kit": 1 },
  "src/agent/provider.ts": { login: 5, assistant: 1 },
  "src/agent/show-me.ts": { "drum voice": 1, login: 1, "sign in": 1 },
  "src/agent/tools.ts": { "drum voice": 1, "drum kit": 1 },
  "src/agent/usage.ts": { login: 1 },
  "src/agent/xcb-agent.ts": { genre: 1 },
  "src/agent/xcb.ts": { login: 1 },
  "src/main.ts": { "drum kit": 1, "drum pattern": 1, login: 7, "sign in": 2 },
};

describe("glossary lint", () => {
  test("the sources are not empty", () => {
    for (const source of SOURCES)
      if (!source.name.endsWith(".ts"))
        expect(source.strings.length, source.name).toBeGreaterThan(0);
    for (const name of ["src/main.ts", "core/keys.ts", "src/agent/tools.ts"])
      expect(
        SOURCES.find((source) => source.name === name)?.strings.length,
        name,
      ).toBeGreaterThan(0);
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  test("no British spelling in a user-facing string", () => {
    const hits: string[] = [];
    for (const source of SOURCES)
      for (const text of source.strings) {
        const match = text.match(spellingPattern);
        if (match)
          hits.push(
            `${source.name}: ${match[0]} → ${SPELLING[match[0].toLowerCase()]} :: ${text.slice(0, 90)}`,
          );
      }
    expect(hits).toEqual([]);
  });

  test("retired phrases match their ceiling exactly (a ratchet)", () => {
    const over: string[] = [];
    const counts: Record<string, Record<string, number>> = {};
    for (const source of SOURCES)
      for (const loser of Object.keys(LOSERS)) {
        const count = source.strings.reduce(
          (sum, text) => sum + loserCount(text, loser),
          0,
        );
        const ceiling = LOSER_CEILINGS[source.name]?.[loser] ?? 0;
        if (count > 0) (counts[source.name] ??= {})[loser] = count;
        if (count !== ceiling)
          over.push(
            `${source.name}: "${loser}" ×${count} (ceiling ${ceiling}) → ${LOSERS[loser]!.use}` +
              (count < ceiling ? " · lower the ceiling" : ""),
          );
      }
    if (process.env.GLOSSARY_COUNTS)
      console.log(JSON.stringify(counts, null, 2));
    expect(over).toEqual([]);
  });

  test("the spelling map and losers name real replacements", () => {
    for (const [british, american] of Object.entries(SPELLING))
      expect(american, british).not.toBe(british);
    for (const { use } of Object.values(LOSERS))
      expect(use.length).toBeGreaterThan(0);
  });

  test("every ceiling names a real source and loser", () => {
    const names = new Set(SOURCES.map((source) => source.name));
    for (const [name, table] of Object.entries(LOSER_CEILINGS)) {
      expect(names.has(name), name).toBe(true);
      for (const loser of Object.keys(table))
        expect(Object.keys(LOSERS), `${name}: ${loser}`).toContain(loser);
    }
  });

  test("a paragraph that says alias still checks its prose", () => {
    expect(
      markdownStrings("`browse` is an alias; browse sounds in the menu"),
    ).toEqual(["`` is an alias; browse sounds in the menu"]);
    expect(markdownStrings("| `drum kit` | alias |")).toEqual([]);
  });
});
