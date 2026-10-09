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
import { listGuides } from "../guides/index.ts";
import { parseEditCommand, parseLane } from "../src/commands/edit.ts";
import {
  EFFECT_ALIASES,
  parseFxCommand,
  parseEffectName,
} from "../src/commands/fx.ts";
import { HELP_SECTIONS, helpTopicLines, USAGE } from "../src/commands/help.ts";
import { LANE_ALIASES } from "../src/commands/music.ts";
import { MENU_SECTIONS, SECTION_ALIASES } from "../src/tui/menu.ts";
import { GuideBrowser } from "../tui/guide.ts";
import {
  accepts,
  demoScore,
  guideFiles,
  menuPathsIn,
  nodeCommands,
  read,
  resolveMenuPath,
  walkAll,
} from "./consistency-lib.ts";

/**
 * Help and usage examples one spelling of which the prompt bar does not run
 * yet. The grammar lane (design A1, D1 in its notes: retry the other
 * spelling at the submit fallback) makes the slash optional everywhere;
 * delete each line as it starts to parse.
 */
const KNOWN_SLASH_GAPS: readonly string[] = [
  "/accel 8 bars to 174",
  "/accel 8 bars to 174 at bar 9",
  "/add C4 at 0",
  "/automate volume at 0 0.5",
  "/bars 8",
  "/bowed pressure 0.7",
  "/bowed violin",
  "/cents n3 -14",
  "/clav pickup bridge",
  "/clear",
  "/combo 08880",
  "/delay 0.75 0.4 0.3",
  "/delay off",
  "/epiano vibe 0.6",
  "/euclid hat 7 16",
  "/extend 4 bars",
  "/fermata at 31 2",
  "/fermata clear",
  "/fermata remove 31",
  "/filter 800 0.3",
  "/filter off",
  "/fx delay mix 0.3",
  "/grain cloud",
  "/grain pitch 12",
  "/grain sync 1/8.",
  "/hit kick at 0",
  "/keys hardness 0.3",
  "/keys stretch 0",
  "/keys sym 0.5",
  "/meter 3",
  "/meter clear",
  "/modal gangsa",
  "/modal ring 3",
  "/modal vibes",
  "/mute",
  "/pan -0.5",
  "/pattern kick every 1",
  "/pause",
  "/piano ballad",
  "/pipe principal8,octave4",
  "/rall 2 bars",
  "/reverb 0.3 0.6",
  "/reverb off",
  "/rit 4 bars to 80",
  "/rotary fast",
  "/rotary fast at 16",
  "/solo",
  "/string koto",
  "/synth lpf 1200",
  "/tempo 120",
  "/tempo clear",
  "/tempo map",
  "/tempo remove bar 9",
  "/tonewheel 888800008",
  "/unmute",
  "/unsolo",
  "/volume 0.8",
  "/wind flute",
  "/wind players 4",
  "/wind trumpet mute harmon",
  "/wurli trem 0.5",
  "bpm off",
  "click 50%",
  "formant -4",
  "formant 3 0.5",
  "guide chords",
  "kit syn909",
  "sample set brk fit on clip 1",
  "sessions",
  "status",
  "transcript",
  "try fx reverb mix 0.6",
  "vowel a o 0.5",
];

/** The ten topic ids (design §4): one id, three doors. */
export const TOPIC_IDS = [
  "sound",
  "voice",
  "effects",
  "rhythm",
  "chords",
  "mix",
  "arrange",
  "project",
  "keys",
  "agent",
] as const;

/**
 * Doors that do not open a topic yet, as `door id`. The language lane (D1,
 * D3, D4: help groups and guides for every id) and the menu lane (B1:
 * MENU_SECTIONS from every topic id) close them.
 */
const KNOWN_TOPIC_GAPS: readonly string[] = [
  "help sound",
  "help effects",
  "help rhythm",
  "help mix",
  "help project",
  "help agent",
  "guide voice",
  "guide arrange",
  "guide agent",
  "menu voice",
  "menu keys",
  "menu agent",
];

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

  test("grammar.ts aliases, once it exists, parse like their canonical form", async () => {
    const grammar = (await import("../src/commands/grammar.ts").catch(
      () => undefined,
    )) as
      | {
          canonicalize?: (
            line: string,
            parses: (line: string) => boolean,
          ) => string;
          ALIASES?: Readonly<Record<string, string>>;
        }
      | undefined;
    if (!grammar?.ALIASES || !grammar.canonicalize) return;
    const score = demoScore();
    for (const [alias, canonical] of Object.entries(grammar.ALIASES)) {
      const rewritten = grammar.canonicalize(alias, (line) =>
        accepts(line, score),
      );
      expect(rewritten, alias).toBe(
        grammar.canonicalize(canonical, (line) => accepts(line, score)),
      );
    }
  });
});

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
    expect(missing).toEqual([]);
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
      if (!pointer) continue;
      const [segments] = menuPathsIn(pointer);
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
