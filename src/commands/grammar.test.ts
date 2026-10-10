import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  isExactInstrument,
  unknownInstrumentMessage,
} from "../audio/instrument-check.ts";
import { AGENT_TOOLS, chatTools, findAgentTool } from "../agent/tools.ts";
import { renderToolCatalog } from "../agent/xcb-agent.ts";
import {
  canonicalWindowForm,
  candidates,
  friendlyCoreError,
  knownVerbs,
  nearest,
  noNote,
  noTrack,
  parseExportCommand,
  parseLoopCommand,
  RANGES,
  usageError,
  usageLine,
  workspaceRelative,
} from "./grammar.ts";
import { parseFxCommand, unknownFxMessage } from "./fx.ts";
import { HELP_SECTIONS, USAGE } from "./help.ts";
import { commandParses, parseCommand } from "./parses.ts";

const score = createScore({
  tracks: [
    { id: "lead", name: "lead", instrument: "sawtooth" },
    { id: "drums", name: "drums", instrument: "kit" },
  ],
  sections: [{ name: "verse", startBar: 0, bars: 4 }],
});

describe("slash and bare are one command", () => {
  const lines = [
    "formant 3",
    "fx reverb on",
    "euclid hat 7 16",
    "tempo 128",
    "section rm verse",
    "rig jangle",
    "pattern house",
    "kit 808",
    "export a.wav",
    "loop 1-4",
  ];
  for (const line of lines)
    test(line, () => {
      expect(commandParses(line, score)).toBe(true);
      expect(commandParses(`/${line}`, score)).toBe(true);
    });

  test("every help and usage verb parses bare and slashed alike", () => {
    const verbs = new Set([
      ...HELP_SECTIONS.filter((section) => section.group !== "keys").flatMap(
        (section) =>
          section.entries.map(
            (entry) => entry.command.replace(/^\//, "").split(/[\s|[]/)[0]!,
          ),
      ),
      ...Object.keys(USAGE),
    ]);
    let checked = 0;
    for (const verb of verbs) {
      if (!/^[a-z][\w-]*$/i.test(verb)) continue;
      expect([verb, commandParses(verb, score)]).toEqual([
        verb,
        commandParses(`/${verb}`, score),
      ]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("aliases parse as their canonical form", () => {
  const pairs: [string, string][] = [
    ["groove house", "pattern house"],
    ["section rm verse", "section remove verse"],
    ["section delete verse", "section remove verse"],
    ["synth filter 800", "synth lpf 800"],
    ["bpm 120", "tempo 120"],
    ["render a.wav", "export a.wav"],
    ["fx ls", "fx list"],
  ];
  for (const [alias, canonical] of pairs)
    test(`${alias} == ${canonical}`, () => {
      const a = parseCommand(alias, score);
      const b = parseCommand(canonical, score);
      expect(b).toBeDefined();
      expect(a?.value).toEqual(b?.value);
    });

  test("window aliases rewrite to the slash form submit runs", () => {
    expect(candidates("chords idiom jazz")).toContain("/chords style jazz");
    expect(candidates("genre house")).toContain("/style house");
    expect(candidates("synth cutoff 800")).toContain("synth lpf 800");
  });

  test("model key and models are canonical window forms", () => {
    expect(canonicalWindowForm("model key")).toBe("/login");
    expect(canonicalWindowForm("/model key openrouter")).toBe(
      "/login openrouter",
    );
    expect(canonicalWindowForm("models")).toBe("/model");
    expect(canonicalWindowForm("voice")).toBe("/help voice");
    expect(canonicalWindowForm("tempo 120")).toBeUndefined();
  });

  test("candidates never include the line itself", () => {
    expect(candidates("fx reverb on")).not.toContain("fx reverb on");
    expect(candidates("/fx reverb on")).toContain("fx reverb on");
  });
});

describe("export and loop", () => {
  test("export forms", () => {
    expect(parseExportCommand("export a.wav")).toEqual({
      path: "a.wav",
      format: "wav",
      stems: false,
    });
    expect(parseExportCommand("/export mix.wav stems")?.stems).toBe(true);
    expect(parseExportCommand("export a.mid stems")).toBeUndefined();
    expect(parseExportCommand("export song.track.json")?.format).toBe("json");
  });
  test("agent export paths stay in the workspace", () => {
    expect(workspaceRelative("out/a.wav")).toBe(true);
    expect(workspaceRelative("../a.wav")).toBe(false);
    expect(workspaceRelative("/tmp/a.wav")).toBe(false);
    expect(workspaceRelative("~/a.wav")).toBe(false);
  });
  test("loop forms", () => {
    expect(parseLoopCommand("loop 1-4")).toEqual({
      type: "loop-bars",
      from: 1,
      to: 4,
    });
    expect(parseLoopCommand("/loop off")).toEqual({ type: "loop-off" });
    expect(parseLoopCommand("loop")).toEqual({ type: "loop-show" });
    expect(parseLoopCommand("loop verse")).toEqual({
      type: "loop-section",
      name: "verse",
    });
    expect(parseLoopCommand("loop 4-1")).toBeUndefined();
  });
});

describe("nearest", () => {
  test("one matcher for every vocabulary", () => {
    expect(nearest("sawtoth", ["sawtooth", "square"])).toBe("sawtooth");
    expect(nearest("revreb", ["reverb", "delay"])).toBe("reverb");
    expect(nearest("reverb", ["reverb"])).toBeUndefined();
    expect(nearest("xyzzy", ["reverb"])).toBeUndefined();
    expect(nearest("hta", ["hat"])).toBe("hat");
  });
  test("effects and instruments use the same matcher", () => {
    expect(unknownFxMessage("fx zz")).not.toContain("did you mean");
    expect(unknownFxMessage("fx dela mix 0.3")).toContain(
      "did you mean delay?",
    );
    expect(unknownInstrumentMessage("sawtoth")).toContain(
      "did you mean sawtooth?",
    );
    expect(unknownInstrumentMessage("zz")).not.toContain("did you mean");
  });
  test("fx list, ls and presets are the fx read", () => {
    for (const word of ["list", "ls", "presets"]) {
      expect(parseFxCommand(`fx ${word}`)).toEqual({ type: "fx-list" });
      expect(unknownFxMessage(`fx ${word}`)).toBeUndefined();
    }
  });
  test("known verbs include the canonical forms", () => {
    for (const verb of ["groove", "rig", "loop", "export", "fx", "tempo"])
      expect(knownVerbs().has(verb)).toBe(true);
  });
});

describe("refusals", () => {
  test("instrument writes take exact words only", () => {
    expect(isExactInstrument("sawtooth")).toBe(true);
    expect(isExactInstrument("grand")).toBe(true);
    expect(isExactInstrument("kit")).toBe(true);
    expect(isExactInstrument("sawtoth")).toBe(false);
    expect(unknownInstrumentMessage("sawtoth")).toBe(
      "instrument sawtoth · did you mean sawtooth? · instrument list",
    );
  });
  test("missing notes and tracks", () => {
    expect(noNote("n1")).toBe("no note n1 · notes lists them");
    expect(noTrack("bass")).toBe("no track bass · tracks lists them");
  });
});

describe("usageError", () => {
  test("one template", () => {
    expect(usageError("tempo 900", RANGES.tempo!)).toBe(
      "tempo 900 · tempo takes 20…300 BPM · tempo 128",
    );
    expect(usageLine("usage · tempo <bpm>")).toBe("usage · tempo <bpm>");
  });
  test("no raw core keys", () => {
    const card = friendlyCoreError(
      "tempo 900",
      "tempoBpm must be between 20 and 300",
    );
    expect(card).toBe("tempo 900 · tempo takes 20…300 BPM · tempo 128");
    expect(card).not.toContain("tempoBpm");
    expect(friendlyCoreError("x", "something else")).toBeUndefined();
  });
});

describe("agent tool dedupe", () => {
  const hidden = ["set_effects", "vocode", "add_drums"];
  test("duplicates stay callable but unadvertised", () => {
    const advertised = chatTools().map((tool) => tool.function.name);
    const catalog = renderToolCatalog();
    for (const name of hidden) {
      expect(findAgentTool(name)).toBeDefined();
      expect(advertised).not.toContain(name);
      expect(catalog).not.toContain(`- ${name}:`);
    }
    for (const name of ["set_fx", "set_vocoder", "set_rhythm"])
      expect(advertised).toContain(name);
  });
  test("their descriptions point to the canonical tool", () => {
    const describe = (name: string) =>
      AGENT_TOOLS.find((tool) => tool.name === name)!.description;
    expect(describe("set_effects")).toContain("set_fx");
    expect(describe("vocode")).toContain("set_vocoder");
    expect(describe("add_drums")).toContain("set_rhythm");
  });
});

describe("export", () => {
  test("a listing word is never a file name", () => {
    expect(parseExportCommand("export list")).toBeUndefined();
    expect(parseExportCommand("/export ls")).toBeUndefined();
    expect(parseExportCommand("export a.wav")).toEqual({
      path: "a.wav",
      format: "wav",
      stems: false,
    });
  });
});
