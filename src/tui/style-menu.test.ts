import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { generateStyle, styleScore } from "../../core/styles/generate.ts";
import { parseStyleCommand } from "../commands/style.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";

function context(score = createScore()): MenuContext {
  return {
    score,
    trackId: score.tracks[0]?.id ?? "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function select(menu: EditMenu, ctx: MenuContext, label: string): void {
  const rows = menu.view(ctx).items;
  const target = rows.findIndex((row) => row.label.startsWith(label));
  expect(target).toBeGreaterThanOrEqual(0);
  for (let i = menu.view(ctx).index; i < target; i++) menu.key(DOWN, ctx);
}

describe("Arrange › style browser", () => {
  test("/menu style opens it; families lead to leaves whose rows run /style", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "style");
    expect(menu.view(ctx).title).toBe("≡ Arrange › style");
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((label) => label.startsWith("find"))).toBe(true);
    expect(labels.some((label) => label.startsWith("Electronic"))).toBe(true);
    select(menu, ctx, "Electronic");
    menu.key("\r", ctx);
    select(menu, ctx, "Electronic");
    menu.key("\r", ctx);
    const rows = menu.view(ctx).items.map((row) => row.label);
    expect(rows[0]).toStartWith("make 4 bars");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "/style electronic 4",
    });
  });

  test("every menu command parses as a style command", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "style");
    // Walk the first branch at every level down to a leaf.
    for (let depth = 0; depth < 8; depth++) {
      const rows = menu.view(ctx).items;
      const branch = rows.findIndex(
        (row, index) =>
          index > 0 && !row.label.startsWith("make") && row.label !== "about",
      );
      for (const row of rows.filter((row) => row.label.startsWith("make"))) {
        expect(row.label).toMatch(/^make \d+ bars/);
      }
      if (branch < 0) break;
      for (let i = menu.view(ctx).index; i < branch; i++) menu.key(DOWN, ctx);
      const result = menu.key("\r", ctx);
      if (result.type === "run") {
        expect(parseStyleCommand(result.command)).toBeDefined();
        break;
      }
    }
  });

  test("again appears once the song has a style", () => {
    const song = styleScore(generateStyle("deep-house", { bars: 2, seed: 4 }));
    const menu = new EditMenu();
    const ctx = context(song);
    menu.show(ctx, "style");
    expect(menu.view(ctx).items[0]!.label).toStartWith("again");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "/style again",
    });
  });
});
