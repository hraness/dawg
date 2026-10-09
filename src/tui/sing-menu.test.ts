import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applySingCommand, parseSingCommand } from "../commands/sing.ts";
import { isStageable } from "./audition.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";
const UP = "\u001b[A";
const RIGHT = "\u001b[C";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
    notes: [
      {
        id: "n1",
        trackId: "keys",
        pitch: 57,
        startTick: 0,
        durationTicks: 96,
        velocity: 0.8,
      },
      {
        id: "n2",
        trackId: "keys",
        pitch: 60,
        startTick: 96,
        durationTicks: 96,
        velocity: 0.8,
      },
    ],
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
  const parsed = parseSingCommand(command);
  if (!parsed) throw new Error(`not a sing command: ${command}`);
  const result = applySingCommand(value, "keys", parsed);
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

describe("Sound › Voices (sing)", () => {
  test("browse sounds › Voices › Throat plays a throat preset", () => {
    const menu = new EditMenu();
    const ctx = context(score());
    menu.show(ctx, "sounds");
    select(menu, ctx, "Voices");
    menu.key("\r", ctx);
    const groups = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    // The clips lane's Vocal row comes first, then the sing groups.
    expect(groups).toEqual(["Vocal", "Choir", "Solo", "Throat"]);
    select(menu, ctx, "Throat");
    menu.key("\r", ctx);
    select(menu, ctx, "khoomei");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "sing khoomei",
    });
  });

  test("Parameters: sing rows, a Throat sub-menu, x resets", () => {
    const value = run(score(), "sing choir");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "parameters");
    const labels = menu.view(ctx).items.map((row) => row.label);
    for (const label of ["preset", "vowel", "voices", "Throat", "advanced"])
      expect(labels.some((row) => row.startsWith(label))).toBe(true);
    select(menu, ctx, "bright");
    const result = menu.key(RIGHT, ctx);
    expect(result.type).toBe("run");
    if (result.type !== "run") return;
    expect(result.command).toMatch(/^sing bright \d/);
    const next = run(value, result.command);
    expect(next.tracks[0]!.sing!.bright).toBeGreaterThan(0.5);
    expect(isStageable(result.command)).toBe(true);
    // The Throat sub-menu: drone turns throat mode on with a note name.
    select(menu, ctx, "Throat");
    menu.key("\r", ctx);
    select(menu, ctx, "drone");
    const drone = menu.key(RIGHT, ctx);
    expect(drone).toEqual({ type: "run", command: "sing drone D3" });
  });

  test("Performance › Vowels steps the notes' vowel", () => {
    const value = run(score(), "sing aah");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "performance");
    select(menu, ctx, "Vowels");
    menu.key("\r", ctx);
    select(menu, ctx, "vowel");
    const result = menu.key(RIGHT, ctx);
    expect(result).toEqual({ type: "run", command: "note vowel a" });
    expect(isStageable("note vowel a")).toBe(true);
    const next = run(value, "note vowel a");
    expect(next.notes.every((note) => note.vowel === "a")).toBe(true);
  });

  test("no Vowels row on a track that does not sing", () => {
    const menu = new EditMenu();
    const ctx = context(score());
    menu.show(ctx, "performance");
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((row) => row.startsWith("Vowels"))).toBe(false);
  });
});
