import { describe, expect, test } from "bun:test";
import { GRANULAR_PRESET_NAMES } from "../../core/granular.ts";
import { createScore } from "../../core/score.ts";
import {
  applyGranularCommand,
  parseGranularCommand,
} from "../commands/granular.ts";
import { isStageable } from "./audition.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";

function context(granular?: Record<string, unknown>): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [
        granular
          ? { id: "pad", name: "pad", instrument: "granular", granular }
          : { id: "pad", name: "pad", instrument: "pad" },
      ],
      notes: [],
    } as never),
    trackId: "pad",
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

function open(menu: EditMenu, ctx: MenuContext, ...path: string[]): void {
  menu.show(ctx);
  for (const label of path) {
    select(menu, ctx, label);
    menu.key("\r", ctx);
  }
}

describe("granular in the ctrl-k menu", () => {
  test("Sound > browse sounds > Granular lists every preset", () => {
    const menu = new EditMenu();
    const ctx = context();
    open(menu, ctx, "Sound", "browse sounds", "Granular");
    const labels = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(labels).toEqual([...GRANULAR_PRESET_NAMES]);
    select(menu, ctx, "swarm");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "grain swarm",
    });
  });

  test("a synth track shows Granular (convert) with grain on and presets", () => {
    const menu = new EditMenu();
    const ctx = context();
    open(menu, ctx, "Sound", "granular (convert)");
    const labels = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(labels[0]).toBe("grain");
    expect(labels).toContain("cloud");
    select(menu, ctx, "grain this sound");
    expect(menu.key("\r", ctx)).toEqual({ type: "run", command: "grain on" });
  });

  test("a granular track edits every parameter as a grain command", () => {
    const menu = new EditMenu();
    const ctx = context({ preset: "cloud" });
    open(menu, ctx, "Sound", "granular");
    const labels = menu.view(ctx).items.map((row) => row.label);
    for (const row of [
      "preset",
      "source",
      "position",
      "scan",
      "grain",
      "shimmer",
      "window",
      "freeze",
      "seed",
    ])
      expect(labels.some((label) => label.startsWith(row))).toBe(true);
    select(menu, ctx, "preset");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: `grain ${GRANULAR_PRESET_NAMES[GRANULAR_PRESET_NAMES.indexOf("cloud") + 1]}`,
    });
    select(menu, ctx, "scan");
    const scan = menu.key(RIGHT, ctx) as { type: string; command: string };
    expect(scan.type).toBe("run");
    expect(scan.command).toMatch(/^grain scan [0-9.-]+$/);
    // Every command the menu emits parses and applies.
    const parsed = parseGranularCommand(scan.command)!;
    expect(applyGranularCommand(ctx.score, "pad", parsed).ok).toBe(true);
    select(menu, ctx, "freeze");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "grain freeze on",
    });
  });

  test("every parameter row's command parses back as a grain set", () => {
    const menu = new EditMenu();
    const ctx = context({ preset: "cloud" });
    open(menu, ctx, "Sound", "granular");
    const count = menu.view(ctx).items.length;
    const seen: string[] = [];
    for (let i = 0; i < count; i += 1) {
      while (menu.view(ctx).index < i) menu.key(DOWN, ctx);
      const label = menu.view(ctx).items[i]!.label;
      if (label.startsWith("preset") || label.startsWith("source")) continue;
      const action = menu.key(RIGHT, ctx) as
        { type: string; command?: string } | undefined;
      if (action?.type !== "run" || !action.command) continue;
      const parsed = parseGranularCommand(action.command);
      expect(parsed?.type).toBe("grain-set");
      expect(applyGranularCommand(ctx.score, "pad", parsed!).ok).toBe(true);
      seen.push(action.command.split(" ")[1]!);
    }
    expect(seen).toContain("hold");
    expect(seen).toContain("repeat");
  });

  test("grain commands stage in the audition loop; listings do not", () => {
    expect(isStageable("grain cloud")).toBe(true);
    expect(isStageable("grain scan 0.2")).toBe(true);
    expect(isStageable("grain presets")).toBe(false);
    expect(isStageable("grain list")).toBe(false);
  });
});
