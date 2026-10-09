import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyKeysCommand, parseKeysCommand } from "../commands/keys.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";
const UP = "\u001b[A";
const RIGHT = "\u001b[C";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "keys", name: "keys", instrument: "sine" }],
    notes: [],
  });
}

function context(value: TrackScore): MenuContext {
  return {
    score: value,
    trackId: "keys",
    playing: false,
    grid: "1/16",
    grids: ["1/4", "1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function run(value: TrackScore, command: string): TrackScore {
  const parsed = parseKeysCommand(command);
  if (!parsed) throw new Error(`not a keys command: ${command}`);
  const result = applyKeysCommand(value, "keys", parsed);
  if (!result.ok || !result.next) throw new Error(result.message);
  return result.next;
}

function select(menu: EditMenu, ctx: MenuContext, label: string): void {
  const rows = menu.view(ctx).items;
  const target = rows.findIndex((row) => row.label.startsWith(label));
  expect(target).toBeGreaterThanOrEqual(0);
  const now = menu.view(ctx).index;
  for (let i = now; i < target; i++) menu.key(DOWN, ctx);
  for (let i = now; i > target; i--) menu.key(UP, ctx);
}

describe("Sound › browse sounds › Keys › Electric", () => {
  test("the Keys group opens an Electric sub-group of presets", () => {
    const menu = new EditMenu();
    const ctx = context(score());
    menu.show(ctx, "sounds");
    select(menu, ctx, "Keys");
    menu.key("\r", ctx);
    const keys = menu.view(ctx).items.map((row) => row.label);
    expect(keys.some((label) => label.startsWith("grand"))).toBe(true);
    expect(keys.some((label) => label.startsWith("suitcase"))).toBe(false);
    select(menu, ctx, "Electric");
    menu.key("\r", ctx);
    const labels = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(labels).toEqual([
      "epiano",
      "suitcase",
      "dyno",
      "wurli",
      "clav",
      "funkclav",
    ]);
    select(menu, ctx, "suitcase");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "keys preset suitcase",
    });
  });
});

describe("Sound › Parameters for electric keys", () => {
  test("an epiano shows its family's rows and presets only", () => {
    const value = run(score(), "epiano");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    const labels = menu.view(ctx).items.map((row) => row.label);
    for (const row of ["preset", "bark", "bell", "tone", "vibe"])
      expect(labels.some((label) => label.startsWith(row))).toBe(true);
    expect(labels.some((label) => label.startsWith("felt"))).toBe(false);
    select(menu, ctx, "vibe");
    // The first press pins the effective value, the next one steps it.
    const pin = menu.key(RIGHT, ctx);
    if (pin.type !== "run") throw new Error("vibe did not run");
    expect(pin.command).toBe("keys vibe 0");
    const pinned = run(value, pin.command);
    const ctx2 = context(pinned);
    const result = menu.key(RIGHT, ctx2);
    if (result.type !== "run") throw new Error("vibe did not step");
    expect(result.command).toBe("keys vibe 0.05");
    expect(run(pinned, result.command).tracks[0]!.keys!.vibe).toBe(0.05);
  });

  test("a clav shows pickup as a choice", () => {
    const value = run(score(), "clav");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    select(menu, ctx, "pickup");
    const result = menu.key(RIGHT, ctx);
    expect(result.type).toBe("run");
    if (result.type !== "run") return;
    expect(result.command).toMatch(/^keys pickup (neck|bridge|both|out)$/);
  });
});
