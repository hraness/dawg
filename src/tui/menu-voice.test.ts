import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
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
  test("stay hidden while every lane's rows are empty", () => {
    const ctx = context();
    const root = rootNodes(ctx);
    // Seven top-level sections, unchanged.
    expect(root).toHaveLength(7);
    const sound = open(root, "sound", ctx);
    const effects = open(root, "effects", ctx);
    const browse = open(sound, "browse", ctx);
    expect(labels(sound)).not.toContain("Voice");
    expect(labels(effects)).not.toContain("Voice");
    expect(labels(browse)).not.toContain("Voices");
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
});
