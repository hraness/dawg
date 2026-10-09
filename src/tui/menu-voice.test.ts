import { describe, expect, test } from "bun:test";
import { AUTOMATION_PARAMETERS, createScore } from "../../core/score.ts";
import { rootNodes, type MenuContext, type MenuNode } from "./menu.ts";
import { voiceGroup } from "./menu-voice.ts";

function context(): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
      notes: [],
    }),
    trackId: "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/4", "1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function open(nodes: MenuNode[], id: string, ctx: MenuContext): MenuNode[] {
  const node = nodes.find((n) => n.kind === "menu" && n.id === id);
  if (!node || node.kind !== "menu") throw new Error(`no menu ${id}`);
  return node.build(ctx);
}

const labels = (nodes: MenuNode[]) => nodes.map((node) => node.label);

describe("0.7 voice menu groups", () => {
  test("hidden while empty; Effects > Voice holds the formant; Voices mounts once", () => {
    const ctx = context();
    const root = rootNodes(ctx);
    // Seven top-level sections, unchanged.
    expect(root).toHaveLength(7);
    const sound = open(root, "sound", ctx);
    const effects = open(root, "effects", ctx);
    const browse = open(sound, "browse", ctx);
    expect(labels(sound)).not.toContain("Voice");
    // The formant lane fills Effects > Voice.
    expect(labels(effects)).toContain("Voice");
    expect(labels(open(effects, "voice", ctx))).toContain("Formant");
    // The sing lane fills browse sounds › Voices (Choir, Solo, Throat).
    expect(labels(browse).filter((label) => label === "Voices")).toHaveLength(
      1,
    );
    expect(labels(sound).slice(-2)).toEqual(["performance", "browse sounds"]);
  });

  test("a group with rows mounts once as a sub-menu", () => {
    const ctx = context();
    const row: MenuNode = {
      kind: "action",
      label: "Clips",
      command: "/clip",
      help: "audio clips",
    };
    const group = voiceGroup("voice", "Voice", "help", () => [row], ctx);
    expect(group).toHaveLength(1);
    expect(group[0]!.kind).toBe("menu");
    expect(group[0]!.label).toBe("Voice");
    if (group[0]!.kind === "menu")
      expect(labels(group[0]!.build(ctx))).toEqual(["Clips"]);
    expect(voiceGroup("voice", "Voice", "help", () => [], ctx)).toEqual([]);
  });

  test("Formant rows: on, preset, shift, mix; the vowel gains to and morph", () => {
    const ctx = context();
    const effects = open(rootNodes(ctx), "effects", ctx);
    const formant = open(open(effects, "voice", ctx), "formant", ctx);
    expect(labels(formant)).toEqual([
      "on",
      "preset",
      "shift",
      "mix",
      "advanced",
    ]);
    const shift = formant.find((node) => node.label === "shift")!;
    expect(shift.kind === "number" && shift.command(-4)).toBe(
      "fx formant shift -4",
    );
    // Not duplicated under more effects.
    expect(labels(open(effects, "more effects", ctx))).not.toContain("Formant");
    const vowel = open(open(effects, "more effects", ctx), "vowel", ctx);
    expect(labels(vowel)).toEqual(
      expect.arrayContaining(["vowel", "mix", "to", "morph"]),
    );
    const to = vowel.find((node) => node.label === "to")!;
    expect(to.kind === "choice" && to.command("o")).toBe("/vowel to o");
  });

  test("Mix & automation offers the formant and vowel-morph lanes", () => {
    expect(AUTOMATION_PARAMETERS).toEqual(
      expect.arrayContaining(["formant-shift", "formant-mix", "vowel-morph"]),
    );
  });
});
