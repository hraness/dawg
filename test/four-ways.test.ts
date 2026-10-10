/**
 * Four doors to every feature (design §1.3 and §7 E3): a typed command, a
 * ctrl-k menu node, an agent path (a tool, or a command the agent can type
 * with show-me) and the SDK (a song or track field the printer writes and
 * sync reads back, or a documented CLI pointer).
 *
 * Each row names its doors concretely. A door that does not exist yet is a
 * `gap` with the reason; the test fails if a listed gap starts working, so
 * the list stays honest and shrinks as features land.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_TOOLS } from "../src/agent/tools.ts";
import * as sdk from "../core/sdk/v1.ts";
import { commandParses } from "../src/commands/parses.ts";
import {
  accepts,
  demoScore,
  nodeCommands,
  read,
  resolveMenuPath,
  walkAll,
} from "./consistency-lib.ts";

type Feature = Readonly<{
  feature: string;
  /** The canonical command, as /help teaches it. */
  command: string;
  /** A ctrl-k path, or a verb some walked node runs (`verb:tempo`). */
  menu: string;
  /** Agent tool names; the command parsing locally counts as well. */
  tools: readonly string[];
  /** `song.x` / `track.x` fields, `sdk:fn` exports, or `cli:dawg …`. */
  sdk: readonly string[];
  /** For a row with an agent gap: a tool whose name matches closes it. */
  agentWords?: RegExp;
  /** Doors that are missing today: "menu", "agent", "sdk", with why. */
  gap?: Readonly<Partial<Record<"menu" | "agent" | "sdk", string>>>;
}>;

export const FEATURES: readonly Feature[] = [
  {
    feature: "notes",
    command: "add C4 at 0",
    menu: "verb:add",
    tools: ["add_notes", "remove_notes", "update_notes"],
    sdk: ["sdk:note", "sdk:seq"],
    gap: { menu: "notes are typed or played; ctrl-k has no note entry" },
  },
  {
    feature: "tracks",
    command: "/track add bass",
    menu: "Arrange › tracks",
    tools: ["create_track"],
    sdk: ["song.tracks", "sdk:track"],
  },
  {
    feature: "instruments",
    command: "instrument saw",
    menu: "Sound › instrument",
    tools: ["set_instrument"],
    sdk: ["track.instrument"],
  },
  {
    feature: "presets",
    command: "synth preset pad",
    menu: "Sound › preset",
    tools: ["set_synth"],
    sdk: ["track.synth"],
  },
  {
    feature: "effects",
    command: "fx reverb on",
    menu: "Effects",
    tools: ["set_fx", "set_effects"],
    sdk: ["track.fx", "track.reverb"],
  },
  {
    feature: "voice",
    command: "sing aah",
    menu: "Sound › Voice",
    tools: ["set_sing", "set_lyrics", "autotune_vocal", "set_formant"],
    sdk: ["track.sing", "sdk:lyrics", "sdk:autotune"],
  },
  {
    feature: "rhythm",
    command: "euclid hat 7 16",
    menu: "Rhythm",
    tools: ["set_rhythm", "apply_drum_pattern", "set_drum_kit"],
    sdk: ["sdk:euclid", "sdk:pattern", "track.kit"],
  },
  {
    feature: "chords and key",
    command: "key A dorian",
    menu: "Chords",
    tools: ["write_chords", "suggest_progression", "set_scale"],
    sdk: ["song.key", "sdk:progression", "sdk:chord"],
  },
  {
    feature: "tuning",
    command: "tuning edo 19",
    menu: "Chords and key › tuning",
    tools: ["set_tuning"],
    sdk: ["song.tuning", "track.tuning"],
  },
  {
    feature: "mix",
    command: "volume 0.8",
    menu: "Mix › volume",
    tools: ["set_mix", "set_master"],
    sdk: ["track.volume", "track.pan", "song.master"],
  },
  {
    feature: "automation",
    command: "automate volume at 0 0.5",
    menu: "Mix › automation",
    tools: ["set_automation"],
    sdk: ["track.automation"],
  },
  {
    feature: "sections",
    command: "form intro verse chorus*2 outro",
    menu: "Arrange › form",
    tools: ["edit_section", "set_form", "list_sections"],
    sdk: ["song.sections", "song.form"],
  },
  {
    feature: "style",
    command: "style deep-house",
    menu: "Arrange › style",
    tools: ["apply_style", "list_styles", "style_info"],
    sdk: ["song.style", "sdk:style"],
  },
  {
    feature: "tempo and meter",
    command: "tempo 120",
    menu: "Project › tempo",
    tools: ["set_tempo", "set_time"],
    sdk: ["song.tempo", "song.meter", "sdk:rit"],
  },
  {
    feature: "loop",
    command: "bars 8",
    menu: "Project › loop length",
    tools: ["extend_loop"],
    sdk: ["song.bars", "song.loopSection"],
  },
  {
    feature: "loop range",
    command: "loop 5-6",
    menu: "Arrange › range › loop bars",
    tools: ["edit_range"],
    sdk: ["song.loop"],
  },
  {
    feature: "range edits",
    command: "copy saw 1-2 to 3 x2",
    menu: "Arrange › range › copy bars",
    tools: ["edit_range"],
    sdk: ["sdk:bars", "sdk:place", "sdk:reversed", "sdk:insertBars"],
  },
  {
    feature: "bars insert",
    command: "bars insert 2 at 3",
    menu: "Arrange › range › insert bars",
    tools: ["edit_range"],
    sdk: ["sdk:insertBars"],
  },
  {
    feature: "export",
    command: "/export loop.track.json",
    menu: "Project › export",
    tools: [],
    agentWords: /export|render|bounce/,
    sdk: ["cli:dawg render"],
  },
  {
    feature: "sessions",
    command: "/sessions",
    menu: "Project › session",
    tools: [],
    agentWords: /session|fork|resume/,
    sdk: ["cli:dawg sessions"],
    gap: {
      agent: "the agent works inside one session by design",
    },
  },
  {
    feature: "model",
    command: "/model fast",
    menu: "Project › agent › model",
    tools: [],
    agentWords: /model/,
    sdk: ["cli:/model"],
    gap: {
      agent: "the agent does not pick its own model",
    },
  },
  {
    feature: "show-me",
    command: "/showme on",
    menu: "Project › agent › show me",
    tools: [],
    agentWords: /show.?me/,
    sdk: ["cli:/showme"],
    gap: { agent: "show-me is the agent's own display; it has no tool" },
  },
  {
    feature: "play mode",
    command: "/play on",
    // `play` in ctrl-k is the transport (§8.2): a play-mode row must run
    // `/play`, so the verb door is checked with the slash.
    menu: "verb:/play",
    tools: [],
    agentWords: /play.?mode|keyboard/,
    sdk: ["cli:Ctrl-P"],
    gap: {
      menu: "ctrl-k shows play-mode settings but has no row that enters it",
      agent: "the agent does not enter play mode; `transport` is play/pause",
    },
  },
  {
    feature: "tape",
    command: "/tape on",
    menu: "Arrange › tape",
    tools: [],
    agentWords: /tape/,
    sdk: ["cli:Ctrl-T"],
    gap: {
      agent:
        "TAPE is a screen; the agent edits ranges with edit_range, the commands TAPE echoes",
    },
  },
  {
    feature: "rig",
    command: "rig crunch",
    menu: "Effects › Guitar rig",
    tools: ["set_rig"],
    sdk: ["sdk:rig", "track.fx"],
  },
];

const walked = walkAll().flatMap((entry) => entry.walked);
const verbs = new Set<string>();
for (const { node } of walked)
  for (const command of nodeCommands(node)) {
    const word = command.split(/\s/)[0]!;
    verbs.add(word.replace(/^\//, ""));
    // A slash verb also counts under `verb:/x`, for rows where the bare
    // word means something else (`play` vs `/play`).
    if (word.startsWith("/")) verbs.add(word);
  }
const toolNames = new Set(AGENT_TOOLS.map((tool) => tool.name));
const v1 = read("core/sdk/v1.ts");
const printer = read("core/sdk/print.ts");
const docs = read("DAWG.md");

/** The field names of `export type <name> = Readonly<{ … }>` in the SDK. */
function inputFields(name: string): Set<string> {
  const start = v1.indexOf(`export type ${name} = Readonly<{`);
  const end = v1.indexOf("\n}>;", start);
  const body = v1.slice(start, end);
  return new Set([...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!));
}
const songFields = inputFields("SongInput");
const trackFields = inputFields("TrackInput");

function menuDoor(menu: string): boolean {
  if (menu.startsWith("verb:")) return verbs.has(menu.slice(5));
  return resolveMenuPath(menu.split(" › ")) !== undefined;
}

/**
 * The agent reaches a feature through an advertised tool, or by typing the
 * command through show-me, which runs only lines `commandParses` accepts
 * (window commands such as `/model` never reach it).
 */
function agentDoor(row: Feature): boolean {
  if (row.tools.length > 0 && row.tools.every((t) => toolNames.has(t)))
    return true;
  if (row.agentWords && [...toolNames].some((t) => row.agentWords!.test(t)))
    return true;
  return commandParses(row.command, demoScore());
}

function sdkDoor(ref: string): boolean {
  const [kind, name] = [
    ref.slice(0, ref.indexOf(":")),
    ref.slice(ref.indexOf(":") + 1),
  ];
  if (ref.startsWith("song.")) {
    const field = ref.slice(5);
    return songFields.has(field) && printer.includes(field);
  }
  if (ref.startsWith("track.")) {
    const field = ref.slice(6);
    return trackFields.has(field) && printer.includes(field);
  }
  if (kind === "sdk")
    return typeof (sdk as Record<string, unknown>)[name] === "function";
  if (kind === "cli") return docs.includes(name);
  return false;
}

describe("four doors to every feature", () => {
  test("the table covers the design's feature list", () => {
    expect(FEATURES.map((row) => row.feature)).toEqual([
      "notes",
      "tracks",
      "instruments",
      "presets",
      "effects",
      "voice",
      "rhythm",
      "chords and key",
      "tuning",
      "mix",
      "automation",
      "sections",
      "style",
      "tempo and meter",
      "loop",
      "loop range",
      "range edits",
      "bars insert",
      "export",
      "sessions",
      "model",
      "show-me",
      "play mode",
      "tape",
      "rig",
    ]);
  });

  for (const row of FEATURES) {
    describe(row.feature, () => {
      test("typed: the canonical command runs locally", () => {
        expect(accepts(row.command), row.command).toBe(true);
      });

      test("menu: a ctrl-k node", () => {
        const open = menuDoor(row.menu);
        if (row.gap?.menu)
          expect(open, `gap listed: ${row.gap.menu}`).toBe(false);
        else expect(open, row.menu).toBe(true);
      });

      test("agent: a tool, or the command typed through show-me", () => {
        const door = agentDoor(row);
        if (row.gap?.agent) {
          expect(door, `gap listed: ${row.gap.agent}`).toBe(false);
          return;
        }
        // Any tool named must exist; with none, show-me types the command.
        for (const tool of row.tools)
          expect(toolNames.has(tool), tool).toBe(true);
        expect(door, row.command).toBe(true);
      });

      test("SDK: a field the printer writes, an export, or a CLI pointer", () => {
        expect(row.sdk.length).toBeGreaterThan(0);
        for (const ref of row.sdk) expect(sdkDoor(ref), ref).toBe(true);
      });
    });
  }
});
