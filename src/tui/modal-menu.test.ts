import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyModalCommand, parseModalCommand } from "../commands/modal.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";
const UP = "\u001b[A";
const RIGHT = "\u001b[C";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
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
  const parsed = parseModalCommand(command);
  if (!parsed) throw new Error(`not a modal command: ${command}`);
  const result = applyModalCommand(value, "keys", parsed);
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

describe("Sound › mallets", () => {
  test("instruments lists the group and enter plays a preset", () => {
    const menu = new EditMenu();
    const ctx = context(score());
    menu.show(ctx, "sounds");
    select(menu, ctx, "mallets");
    menu.key("\r", ctx);
    const labels = menu.view(ctx).items.map((row) => row.label);
    // 12 core presets, the 0.6.1 bells and drums, then the Gamelan group.
    expect(labels.length).toBe(19);
    expect(labels[0]).toStartWith("marimba");
    expect(labels.at(-1)).toStartWith("Gamelan");
    select(menu, ctx, "vibes");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "modal vibes",
    });
  });

  test("Parameters shows preset, mallet and ring rows that run modal commands", () => {
    const value = run(score(), "modal marimba");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((label) => label.startsWith("preset"))).toBe(true);
    expect(labels.some((label) => label.startsWith("mallet"))).toBe(true);
    select(menu, ctx, "ring");
    const result = menu.key(RIGHT, ctx);
    expect(result.type).toBe("run");
    if (result.type !== "run") return;
    expect(result.command).toMatch(/^modal ring \d/);
    const next = run(value, result.command);
    expect(next.tracks[0]!.modal!.ring).toBeGreaterThan(1.6);
  });
});
