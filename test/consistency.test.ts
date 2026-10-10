/**
 * The consistency gate (design §7 E1): what the menu, the help, the guides
 * and DAWG.md tell a person to type is what the prompt bar runs.
 *
 * - every menu action and value command, over a tree walk of a song with a
 *   saw, a piano, drums, an organ, a singing voice, strings and a sampler;
 * - every concrete HELP_SECTIONS entry and USAGE example, typed bare and
 *   with a slash;
 * - every alias in the parser alias tables against its canonical form;
 * - every `Ctrl-K › …` path in guides, DAWG.md, help and show-me;
 * - every topic id in /help, /guide and /menu.
 *
 * Gaps another lane closes are listed in KNOWN_* ratchets: the test fails
 * when a listed gap starts working, so each list only shrinks.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listGuides } from "../guides/index.ts";
import { parseEditCommand, parseLane } from "../src/commands/edit.ts";
import {
  EFFECT_ALIASES,
  parseFxCommand,
  parseEffectName,
} from "../src/commands/fx.ts";
import { HELP_SECTIONS, helpTopicLines, USAGE } from "../src/commands/help.ts";
import { LANE_ALIASES } from "../src/commands/music.ts";
import {
  MENU_SECTIONS,
  MENU_SHOWN_SECTIONS,
  SECTION_ALIASES,
} from "../src/tui/menu.ts";
import { GuideBrowser } from "../tui/guide.ts";
import {
  accepts,
  demoScore,
  guideFiles,
  menuPathsIn,
  nodeCommands,
  read,
  resolveMenuPath,
  ROOT,
  TOPIC_IDS,
  walkAll,
} from "./consistency-lib.ts";

/**
 * Help and usage examples one spelling of which the prompt bar does not
 * run (the slash is optional everywhere). Empty; an entry fails the
 * suite once it parses.
 */
const KNOWN_SLASH_GAPS: readonly string[] = [];

/**
 * Doors that do not open a topic, as `door id`. Empty; an entry fails
 * the suite once the door opens.
 */
const KNOWN_TOPIC_GAPS: readonly string[] = [];

/**
 * Typed aliases a menu row must not run (design §2, §3): the row runs the
 * canonical word. `track <alias>` covers the second word of a track row.
 */
const CANONICAL_VERBS: Readonly<Record<string, string>> = {
  rm: "remove",
  delete: "remove",
  ls: "list",
  presets: "list",
  scale: "key",
  pattern: "groove",
  cycle: "loop",
};

/**
 * Menu rows that run an alias verb instead of the canonical word.
 * Empty; an entry fails the suite once the canonical form parses.
 */
const KNOWN_ALIAS_ROWS: readonly string[] = [];

/** A trailing `(note)` is commentary, not part of the command. */
const stripNote = (text: string) => text.replace(/\s*\([^)]*\)\s*$/, "").trim();

/**
 * A line a person could type as written: no placeholders (`<n>`, `[a|b]`,
 * `…`), no key chords, no ranges (`0-8`).
 */
const concrete = (text: string) =>
  text.length > 0 && !/[<>[\]|…›]|ctrl-|\.\.\.|\d-\d/i.test(text);

/** Every concrete line help and usage show, each in its written form. */
function helpExamples(): string[] {
  const out = new Set<string>();
  for (const section of HELP_SECTIONS) {
    if (section.group === "keys") continue;
    for (const entry of section.entries)
      for (const part of entry.command.split(" · ")) {
        const line = stripNote(part);
        if (concrete(line)) out.add(line);
      }
  }
  for (const [verb, usage] of Object.entries(USAGE))
    for (const part of usage.split(" · ").slice(1)) {
      const line = stripNote(part);
      const head = line.replace(/^\//, "").split(/\s/)[0]!;
      // Only examples of a command (`tempo 120`), not prose after a dot.
      if (!concrete(line) || (head !== verb && !(head in USAGE))) continue;
      out.add(line);
    }
  return [...out].sort();
}

describe("menu commands parse", () => {
  const walks = walkAll();

  test("the walk covers every instrument and thousands of rows", () => {
    expect(walks.length).toBe(7);
    for (const { track, walked } of walks)
      expect(walked.length, track).toBeGreaterThan(200);
  });

  test("every action, toggle, choice, value and reset runs locally", () => {
    const bad = new Map<string, string>();
    let count = 0;
    for (const { track, walked } of walks)
      for (const { path, node } of walked)
        for (const command of nodeCommands(node)) {
          count += 1;
          if (!accepts(command))
            bad.set(command, `${track}: ctrl-k › ${path.join(" › ")}`);
        }
    expect(count).toBeGreaterThan(10_000);
    expect(
      [...bad].map(([command, where]) => `${command}  ← ${where}`),
    ).toEqual([]);
  });

  test("every row runs the canonical verb, not a typed alias", () => {
    // alias key (`scale`, `track cycle`) → a command and its canonical form
    const aliasRows = new Map<string, { command: string; canonical: string }>();
    for (const { walked } of walks)
      for (const { node } of walked)
        for (const command of nodeCommands(node)) {
          const words = command.replace(/^\//, "").split(/\s+/);
          const at = words[0] === "track" ? 1 : 0;
          const canonical = CANONICAL_VERBS[words[at]!.toLowerCase()];
          if (!canonical) continue;
          const key = at ? `track ${words[1]}` : words[0]!;
          const rewritten = [...words];
          rewritten[at] = canonical;
          if (!aliasRows.has(key))
            aliasRows.set(key, {
              command,
              canonical: `${command.startsWith("/") ? "/" : ""}${rewritten.join(" ")}`,
            });
        }
    // A canonical form that parses means the row must flip now.
    const flippable = [...aliasRows]
      .filter(([, row]) => accepts(row.canonical))
      .map(([key, row]) => `${key}: ${row.command} → ${row.canonical}`);
    expect(flippable).toEqual([]);
    expect([...aliasRows.keys()].sort()).toEqual([...KNOWN_ALIAS_ROWS].sort());
  });
});

describe("window commands check their arguments", () => {
  test("nonsense arguments are refused, so the walks above prove arguments", () => {
    for (const line of [
      "/menu nonsense",
      "/help nonsense",
      "/guide nonsense",
      "/model banana",
      "/showme maybe",
      "/audio sideways",
      "/audio out",
      "/sessions x y z",
      "/theme plaid",
      "/view sideways",
      "/grid 1/7",
      "/euclid trombone",
      "/try banana",
      "/click loud",
      "/menu genre-x",
    ])
      expect(accepts(line), line).toBe(false);
  });

  test("real arguments are accepted", () => {
    for (const line of [
      "/menu mix",
      "/help all",
      "/model fast",
      "/showme quiet",
      "/audio",
      "/audio out default",
      "/audio in Built-in Microphone",
      "/audio test",
      "/sessions",
      "/theme mono",
      "/view focus",
      "/grid 1/16",
      "/euclid hat",
      "/try fx reverb mix 0.6",
      "/click 50%",
      "/track remove saw",
      "/export song.wav",
    ])
      expect(accepts(line), line).toBe(true);
  });

  test("/menu lists only one name per root; aliases stay accepted", () => {
    expect(read("src/main.ts")).toContain("menuUsage(");
    for (const name of MENU_SHOWN_SECTIONS)
      expect(MENU_SECTIONS as readonly string[]).toContain(name);
    expect(MENU_SHOWN_SECTIONS as readonly string[]).not.toContain("genre");
  });
});

describe("help and usage examples parse bare and slashed", () => {
  const examples = helpExamples();
  const failing = new Set<string>();
  for (const line of examples) {
    const bare = line.replace(/^\//, "");
    for (const form of [bare, `/${bare}`])
      if (!accepts(form)) failing.add(form);
  }

  test("examples exist", () => {
    expect(examples.length).toBeGreaterThan(80);
  });

  test("every example runs in both spellings, except the known gaps", () => {
    const known = new Set(KNOWN_SLASH_GAPS);
    expect([...failing].filter((form) => !known.has(form)).sort()).toEqual([]);
  });

  test("each known gap still fails (delete it from the list once fixed)", () => {
    expect(KNOWN_SLASH_GAPS.filter((form) => !failing.has(form))).toEqual([]);
  });

  test("the written form of every example runs", () => {
    // The spelling help shows is the one that must work today.
    expect(examples.filter((line) => !accepts(line))).toEqual([]);
  });
});

describe("aliases parse like their canonical form", () => {
  test("effect aliases: fx <alias> on is fx <effect> on", () => {
    const entries = Object.entries(EFFECT_ALIASES);
    expect(entries.length).toBeGreaterThan(20);
    for (const [alias, effect] of entries) {
      expect(parseEffectName(alias), alias).toBe(effect);
      expect(parseFxCommand(`fx ${alias} on`), alias).toEqual(
        parseFxCommand(`fx ${effect} on`),
      );
    }
  });

  test("automation lane aliases: automate <alias> is automate <lane>", () => {
    for (const [alias, lane] of Object.entries(LANE_ALIASES)) {
      expect(parseLane(alias), alias).toBe(lane);
      expect(parseEditCommand(`automate ${alias} remove 4`), alias).toEqual(
        parseEditCommand(`automate ${lane} remove 4`),
      );
    }
  });

  test("lanes are typed in any case", () => {
    expect(parseLane("SYNTH-PITCHJUMP")).toBe("synth-pitchJump");
    expect(parseLane("Volume")).toBe("volume");
  });

  test("menu section aliases open a real section", () => {
    for (const [alias, path] of Object.entries(SECTION_ALIASES)) {
      expect(resolveMenuPath(path), alias).toBeDefined();
      expect(MENU_SECTIONS as readonly string[], alias).toContain(
        alias as (typeof MENU_SECTIONS)[number],
      );
    }
  });

  test("help topic aliases open the same page as their canonical id", () => {
    const all = helpTopicLines("all");
    for (const alias of ["commands", "reference"])
      expect(helpTopicLines(alias), alias).toEqual(all);
    const arrange = helpTopicLines("arrange");
    for (const alias of ["arrangement", "sections"])
      expect(helpTopicLines(alias), alias).toEqual(arrange);
  });

  test("guide aliases, when the table exists, open their canonical guide", async () => {
    const source = read("tui/guide.ts");
    const guideModule = (await import("../tui/guide.ts")) as Record<
      string,
      unknown
    >;
    if (!/\bGUIDE_ALIASES\b/.test(source)) return;
    // The table must be exported so this suite can walk it.
    const aliases = guideModule.GUIDE_ALIASES as
      Readonly<Record<string, string>> | undefined;
    expect(aliases, "export GUIDE_ALIASES from tui/guide.ts").toBeDefined();
    const guides = listGuides();
    for (const [alias, target] of Object.entries(aliases!)) {
      const byAlias = new GuideBrowser(guides);
      const byId = new GuideBrowser(guides);
      expect(byAlias.open(alias), alias).toBe(true);
      expect(byId.open(target), target).toBe(true);
      expect(byAlias.page, alias).toBe(byId.page);
    }
  });

  test("grammar.ts word tables: every alias parses like the canonical word", async () => {
    const grammar = (await import("../src/commands/grammar.ts")) as {
      REMOVE_WORDS?: readonly string[];
      LIST_WORDS?: readonly string[];
    };
    expect(
      grammar.REMOVE_WORDS,
      "grammar.ts exports REMOVE_WORDS",
    ).toBeDefined();
    expect(grammar.LIST_WORDS, "grammar.ts exports LIST_WORDS").toBeDefined();
    const score = demoScore();
    const [remove, ...removeAliases] = grammar.REMOVE_WORDS!;
    expect(remove).toBe("remove");
    for (const word of removeAliases)
      expect(accepts(`/track ${word} saw`, score), word).toBe(
        accepts(`/track ${remove} saw`, score),
      );
    const [list, ...listAliases] = grammar.LIST_WORDS!;
    expect(list).toBe("list");
    for (const word of listAliases)
      for (const noun of ["synth", "fx", "master"])
        expect(accepts(`${noun} ${word}`, score), `${noun} ${word}`).toBe(
          accepts(`${noun} ${list}`, score),
        );
  });
});

/**
 * Ctrl-K paths the docs write (design §4a) that do not resolve. Empty;
 * an entry fails the suite once it resolves.
 */
const KNOWN_MENU_PATH_GAPS: readonly string[] = [];

/**
 * `/menu <word>`s the docs use that /menu does not take. Empty.
 */
const KNOWN_MENU_WORD_GAPS: readonly string[] = [];

describe("Ctrl-K paths in the docs resolve", () => {
  const sources = [
    ...guideFiles(),
    { path: "DAWG.md", text: read("DAWG.md") },
    { path: "src/commands/help.ts", text: read("src/commands/help.ts") },
    { path: "src/agent/show-me.ts", text: read("src/agent/show-me.ts") },
    ...["show-me.md", "project-format.md"].map((name) => ({
      path: `docs/${name}`,
      text: read(`docs/${name}`),
    })),
  ];

  test("every written path reaches a menu row", () => {
    const missing: string[] = [];
    let count = 0;
    for (const { path, text } of sources)
      for (const segments of menuPathsIn(text)) {
        count += 1;
        if (!resolveMenuPath(segments))
          missing.push(`${path}: Ctrl-K › ${segments.join(" › ")}`);
      }
    expect(count).toBeGreaterThan(20);
    const known = new Set(KNOWN_MENU_PATH_GAPS);
    expect(missing.filter((path) => !known.has(path))).toEqual([]);
    // The ratchet: a path that now resolves must leave the list.
    expect(
      KNOWN_MENU_PATH_GAPS.filter((path) => !missing.includes(path)),
    ).toEqual([]);
  });

  test("show-me's own pointers resolve for the commands it names", async () => {
    const { menuPathFor } = await import("../src/agent/show-me.ts");
    const commands = [
      "volume 0.7",
      "pan -0.2",
      "fx reverb mix 0.4",
      "fx delay on",
      "synth cutoff 800",
      "tempo 120",
      "euclid kick 3 8",
      "master preset loud",
      "section verse bars 1-4",
      "form verse chorus",
    ];
    for (const command of commands) {
      const pointer = menuPathFor(command);
      expect(pointer, command).toBeDefined();
      const [segments] = menuPathsIn(pointer ?? "");
      expect(segments, command).toBeDefined();
      expect(resolveMenuPath(segments!), pointer).toBeDefined();
    }
  });
});

describe("every topic id opens in /help, /guide and /menu", () => {
  const guides = listGuides();
  const opens = (door: string, id: string): boolean => {
    if (door === "help") return helpTopicLines(id) !== undefined;
    if (door === "guide") return new GuideBrowser(guides).open(id);
    return (MENU_SECTIONS as readonly string[]).includes(id);
  };
  const failing = TOPIC_IDS.flatMap((id) =>
    ["help", "guide", "menu"]
      .filter((door) => !opens(door, id))
      .map((door) => `${door} ${id}`),
  );

  test("every door opens, except the known gaps", () => {
    const known = new Set(KNOWN_TOPIC_GAPS);
    expect(failing.filter((gap) => !known.has(gap))).toEqual([]);
  });

  test("each known gap still fails (delete it from the list once fixed)", () => {
    expect(KNOWN_TOPIC_GAPS.filter((gap) => !failing.includes(gap))).toEqual(
      [],
    );
  });

  test("every guide id opens its own page", () => {
    for (const guide of guides) {
      const browser = new GuideBrowser(guides);
      expect(browser.open(guide.id), guide.id).toBe(true);
      expect(browser.page).toBe(guide.id);
    }
  });

  test("every help topic it lists renders", () => {
    for (const topic of ["all", ...TOPIC_IDS])
      if (!KNOWN_TOPIC_GAPS.includes(`help ${topic}`))
        expect(helpTopicLines(topic)?.length, topic).toBeGreaterThan(0);
  });
});

describe("every documented /menu <section> opens", () => {
  test("each /menu word in guides, DAWG.md, help and the TUI is accepted", () => {
    const sources = [
      ...guideFiles().map((file) => file.text),
      read("DAWG.md"),
      read("src/commands/help.ts"),
      read("src/main.ts"),
    ];
    const words = new Set<string>();
    for (const text of sources)
      for (const match of text.matchAll(/\/menu ([a-z]+)\b/g))
        words.add(match[1]!);
    expect(words.size).toBeGreaterThan(5);
    for (const word of KNOWN_MENU_WORD_GAPS) {
      expect(words.has(word), `/menu ${word} still written`).toBe(true);
      expect(MENU_SECTIONS as readonly string[]).not.toContain(word);
      words.delete(word);
    }
    for (const word of words)
      expect(MENU_SECTIONS as readonly string[], `/menu ${word}`).toContain(
        word as (typeof MENU_SECTIONS)[number],
      );
  });

  test("every MENU_SECTIONS name walks to a section", () => {
    for (const name of MENU_SECTIONS) {
      const path = SECTION_ALIASES[name];
      expect(path, name).toBeDefined();
      expect(resolveMenuPath(path!), name).toBeDefined();
    }
  });
});
