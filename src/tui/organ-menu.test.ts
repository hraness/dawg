import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyKeysCommand, parseKeysCommand } from "../commands/keys.ts";
import { isStageable } from "./audition.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";
const UP = "\u001b[A";
const LEFT = "\u001b[D";
const RIGHT = "\u001b[C";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "keys", name: "keys", instrument: "organ" }],
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

describe("Sound › organs (f061-organ)", () => {
  test("instruments › keys › organs plays an organ preset", () => {
    const menu = new EditMenu();
    const ctx = context(score());
    menu.show(ctx, "sounds");
    select(menu, ctx, "keys");
    menu.key("\r", ctx);
    select(menu, ctx, "organs");
    menu.key("\r", ctx);
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.length).toBe(10);
    expect(labels[0]).toStartWith("tonewheel");
    select(menu, ctx, "gospel");
    expect(menu.key("\r", ctx)).toEqual({ type: "run", command: "gospel" });
  });

  test("Parameters › drawbars pulls one bar and keeps the rest", () => {
    const value = run(score(), "gospel");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((label) => label.startsWith("rotary"))).toBe(true);
    expect(labels.some((label) => label.startsWith("hardness"))).toBe(false);
    select(menu, ctx, "drawbars");
    menu.key("\r", ctx);
    select(menu, ctx, "1'");
    const down = menu.key(LEFT, ctx);
    expect(down).toEqual({ type: "run", command: "keys drawbars 888800007" });
    expect(
      run(value, (down as { command: string }).command).tracks[0]!.keys,
    ).toEqual({ preset: "gospel", drawbars: "888800007" });
  });

  test("Parameters › stops toggles a stop; Registers edits combo", () => {
    const pipe = run(score(), "pipe");
    let menu = new EditMenu();
    let ctx = context(pipe);
    menu.show(ctx, "parameters");
    select(menu, ctx, "stops");
    menu.key("\r", ctx);
    select(menu, ctx, "trumpet8");
    const toggled = menu.key("\r", ctx);
    expect(toggled.type).toBe("run");
    const command = (toggled as { command: string }).command;
    expect(command).toMatch(/^keys stops .*trumpet8/);
    expect(run(pipe, command).tracks[0]!.keys!.stops).toContain("trumpet8");

    const combo = run(score(), "combo");
    menu = new EditMenu();
    ctx = context(combo);
    menu.show(ctx, "parameters");
    select(menu, ctx, "registers");
    menu.key("\r", ctx);
    select(menu, ctx, "16'");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "keys registers 18800",
    });
  });
});

describe("organ menu review fixes", () => {
  test("automation shows the lanes the family reads", () => {
    for (const [word, mine, other] of [
      ["gospel", "keys rotary", "keys hardness"],
      ["grand", "keys hardness", "keys rotary"],
    ] as const) {
      const menu = new EditMenu();
      const ctx = context(run(score(), word));
      menu.show(ctx, "automation");
      const labels = menu.view(ctx).items.map((row) => row.label);
      expect(labels.some((label) => label.startsWith(mine))).toBe(true);
      expect(labels.some((label) => label.startsWith(other))).toBe(false);
    }
  });

  test("x on one drawbar resets that bar only", () => {
    const value = run(score(), "tonewheel 888800007");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    select(menu, ctx, "drawbars");
    menu.key("\r", ctx);
    select(menu, ctx, "1'");
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "keys drawbars 888800000",
    });
  });

  test("organ words stage while auditioning", () => {
    for (const word of [
      "gospel",
      "pipe flutes",
      "tonewheel 888800008",
      "rotary fast",
      "hammond",
    ])
      expect(isStageable(word)).toBe(true);
    expect(isStageable("rotary fast at 16")).toBe(false);
    expect(isStageable("pipe presets")).toBe(false);
  });
});
