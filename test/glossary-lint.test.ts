/**
 * Glossary lint (design §2 and §7 E2): the words dawg retired, and British
 * spellings, appear in no user-facing string — help, menu labels and help
 * text, guides, DAWG.md, docs and the receipts in src/commands. Alias tables
 * (`const X_ALIASES = …`) and lines that say "alias" are exempt, because the
 * old words stay typeable.
 *
 * British spellings are at zero. Retired phrases whose replacement belongs to
 * the menu and language lanes ("browse sounds" → instruments, "drum kits" →
 * kits) are held by a ceiling per source: the count may fall, never rise.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { HELP_SECTIONS, USAGE } from "../src/commands/help.ts";
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

/** Retired phrases (design §2) and what replaces them. */
export const LOSERS: Readonly<Record<string, string>> = {
  "browse sounds": "instruments",
  "use a sound": "use a sample",
  "drum voice": "drum",
  "drum kit": "kit",
  "drum kits": "kits",
  "drum pattern": "groove",
  "drum patterns": "grooves",
  temperament: "tuning",
  STEER: "NOW",
  QUEUE: "NEXT",
};

const spellingPattern = new RegExp(
  `\\b(${Object.keys(SPELLING).join("|")})\\b`,
  "i",
);

function loserCount(text: string, loser: string): number {
  const flags = loser === loser.toUpperCase() ? "g" : "gi";
  return [...text.matchAll(new RegExp(`\\b${loser}\\b`, flags))].length;
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
  return files.map((name) => ({
    name,
    strings: read(name)
      .split("\n")
      .filter((line) => !/alias/i.test(line)),
  }));
}

function codeSources(): Source[] {
  const files = [
    ...readdirSync(`${import.meta.dir}/../src/commands`)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => `src/commands/${name}`),
    ...readdirSync(`${import.meta.dir}/../src/tui`)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => `src/tui/${name}`),
  ];
  return files.map((name) => {
    const source = read(name);
    const exempt = exemptLines(source);
    return {
      name,
      strings: literals(source)
        .filter((literal) => !exempt.has(literal.line))
        .map((literal) => literal.text),
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
 * Ceilings for retired phrases the menu and language lanes rename (design
 * §4a "instruments (was browse sounds)", "kits (was drum kits)", §5 NOW and
 * NEXT pills). Lower a number when a rename lands; it may never rise.
 */
const LOSER_CEILINGS: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {
  help: { "drum voice": 1, "drum kit": 1 },
  menu: {
    "browse sounds": 1,
    "use a sound": 1,
    "drum voice": 1,
    "drum kits": 2,
    "drum patterns": 1,
  },
  "guides/rhythm.md": { "drum kit": 1 },
  "guides/sounds.md": { "browse sounds": 2 },
  "DAWG.md": {
    "browse sounds": 12,
    "use a sound": 1,
    "drum kit": 1,
    "drum kits": 4,
    "drum patterns": 3,
    temperament: 1,
    STEER: 1,
    QUEUE: 2,
  },
  "README.md": { "drum kit": 1, STEER: 3, QUEUE: 2 },
  "docs/project-format.md": { "drum patterns": 1 },
  "src/commands/help.ts": { "drum voice": 1, "drum kit": 2 },
  "src/commands/modal.ts": { "browse sounds": 1 },
  "src/tui/menu.ts": {
    "browse sounds": 1,
    "use a sound": 1,
    "drum voice": 1,
    "drum kits": 2,
    "drum patterns": 1,
  },
};

describe("glossary lint", () => {
  test("the sources are not empty", () => {
    for (const source of SOURCES)
      expect(source.strings.length, source.name).toBeGreaterThan(0);
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

  test("retired phrases stay at or under their ceiling", () => {
    const over: string[] = [];
    const counts: Record<string, Record<string, number>> = {};
    for (const source of SOURCES)
      for (const loser of Object.keys(LOSERS)) {
        const count = source.strings.reduce(
          (sum, text) => sum + loserCount(text, loser),
          0,
        );
        if (count === 0) continue;
        (counts[source.name] ??= {})[loser] = count;
        const ceiling = LOSER_CEILINGS[source.name]?.[loser] ?? 0;
        if (count > ceiling)
          over.push(
            `${source.name}: "${loser}" ×${count} (ceiling ${ceiling}) → ${LOSERS[loser]}`,
          );
      }
    if (process.env.GLOSSARY_COUNTS)
      console.log(JSON.stringify(counts, null, 2));
    expect(over).toEqual([]);
  });

  test("the spelling map and losers name real replacements", () => {
    for (const [british, american] of Object.entries(SPELLING))
      expect(american, british).not.toBe(british);
    for (const replacement of Object.values(LOSERS))
      expect(replacement.length).toBeGreaterThan(0);
  });
});
