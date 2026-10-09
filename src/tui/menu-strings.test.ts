import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { STRING_PRESET_NAMES } from "../../core/strings.ts";
import { isStageable } from "./audition.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";

function context(string?: Record<string, unknown>): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [
        string
          ? { id: "gtr", name: "gtr", instrument: "string", string }
          : { id: "gtr", name: "gtr", instrument: "pluck" },
      ],
      notes: [],
    } as never),
    trackId: "gtr",
    playing: false,
    grid: "1/16",
    grids: ["1/4", "1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function select(menu: EditMenu, ctx: MenuContext, label: string): void {
  const rows = menu.view(ctx).items;
  const target = rows.findIndex((row) => row.label.startsWith(label));
  expect(target).toBeGreaterThanOrEqual(0);
  const now = menu.view(ctx).index;
  for (let i = now; i < target; i++) menu.key(DOWN, ctx);
  for (let i = now; i > target; i--) menu.key(UP, ctx);
  expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toStartWith(label);
}

describe("strings in the ctrl-k menu", () => {
  test("Sound > browse sounds > Strings lists every plucked preset", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    select(menu, ctx, "Sound");
    menu.key("\r", ctx);
    select(menu, ctx, "browse sounds");
    menu.key("\r", ctx);
    select(menu, ctx, "Strings");
    menu.key("\r", ctx);
    const labels = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(labels).toEqual([...STRING_PRESET_NAMES]);
    select(menu, ctx, "sitar");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "string sitar",
    });
  });

  test("Sound shows the preset and string params on a string track", () => {
    const menu = new EditMenu();
    const ctx = context({ preset: "koto" });
    menu.show(ctx);
    select(menu, ctx, "Sound");
    menu.key("\r", ctx);
    const labels = menu
      .view(ctx)
      .items.map((row) => row.label.slice(0, 16).trim());
    expect(labels.slice(0, 3)).toEqual(["instrument", "preset", "ring s"]);
    expect(labels).toContain("buzz");
    expect(labels).not.toContain("attack");
    select(menu, ctx, "preset");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: `string preset ${STRING_PRESET_NAMES[STRING_PRESET_NAMES.indexOf("koto") + 1]}`,
    });
    select(menu, ctx, "buzz");
    expect(menu.key(RIGHT, ctx)).toMatchObject({ type: "run" });
    expect((menu.key(RIGHT, ctx) as { command: string }).command).toMatch(
      /^string buzz /,
    );
    select(menu, ctx, "advanced");
    menu.key("\r", ctx);
    const all = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(all).toContain("exciter");
    expect(all).toContain("stiff");
  });

  test("string commands stage in the audition loop; listings do not", () => {
    expect(isStageable("string sitar")).toBe(true);
    expect(isStageable("string buzz 0.4")).toBe(true);
    expect(isStageable("string presets")).toBe(false);
  });
});
