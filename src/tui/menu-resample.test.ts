import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";

function context(): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 4,
      tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
      notes: [],
      sections: [{ name: "verse", startBar: 0, bars: 2 }],
    }),
    trackId: "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function open(menu: EditMenu, ctx: MenuContext, label: string): void {
  const rows = menu.view(ctx).items;
  const target = rows.findIndex((row) => row.label.startsWith(label));
  expect(target).toBeGreaterThanOrEqual(0);
  for (let i = menu.view(ctx).index; i < target; i++) menu.key(DOWN, ctx);
}

describe("Project > Resample", () => {
  test("lists track, section, mix and master renders that run resample", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "project");
    open(menu, ctx, "resample");
    menu.key("\r", ctx);
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((l) => l.startsWith("lead → sampler"))).toBe(true);
    expect(labels.some((l) => l.startsWith("lead → granular"))).toBe(true);
    expect(labels.some((l) => l.startsWith("lead · section verse"))).toBe(true);
    expect(labels.some((l) => l.startsWith("master"))).toBe(true);
    open(menu, ctx, "lead → granular");
    expect(menu.key("\r", ctx)).toMatchObject({
      type: "run",
      command: "resample lead grain",
    });
  });
});
