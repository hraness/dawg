import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { rootNodes, type MenuContext, type MenuNode } from "./menu.ts";

function context(ids: string[]): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: ids.map((id) => ({ id, name: id, instrument: "saw" })),
      notes: [],
    }),
    trackId: ids[ids.length - 1]!,
    playing: false,
    grid: "1/16",
    grids: ["1/4", "1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function mix(ctx: MenuContext): MenuNode[] {
  const node = rootNodes(ctx).find((n) => n.kind === "menu" && n.id === "mix");
  if (!node || node.kind !== "menu") throw new Error("no mix menu");
  return node.build(ctx);
}

describe("Mix › position and remove track", () => {
  test("rows run /track move and /track remove on the focused track", () => {
    const rows = mix(context(["lead", "pad"]));
    const position = rows.find((n) => n.label === "position");
    const remove = rows.find((n) => n.label === "remove track");
    expect(position?.kind).toBe("entry");
    if (position?.kind !== "entry") return;
    expect(position.value).toBe("2 of 2");
    expect(position.command("1")).toBe("/track move pad 1");
    expect(position.command("top")).toBeUndefined();
    expect(remove?.kind === "action" && remove.command).toBe(
      "/track remove pad",
    );
  });

  test("a lone track has neither row", () => {
    const labels = mix(context(["lead"])).map((n) => n.label);
    expect(labels).not.toContain("position");
    expect(labels).not.toContain("remove track");
  });
});
