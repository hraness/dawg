import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyTimeCommand, parseTimeCommand } from "../commands/time.ts";
import { EditMenu, MENU_SECTIONS, type MenuContext } from "./menu.ts";

const DOWN = "\u001b[B";
const UP = "\u001b[A";
const LEFT = "\u001b[D";
const RIGHT = "\u001b[C";
const ESC = "\u001b";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 8,
    tracks: [
      { id: "keys", name: "keys", instrument: "piano" },
      { id: "bass", name: "bass", instrument: "bass" },
    ],
    notes: [],
  });
}

function context(value = score()): MenuContext {
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

/** Apply a menu command the way the prompt does. */
function run(value: TrackScore, command: string, trackId = "keys") {
  const parsed = parseTimeCommand(command);
  if (!parsed) throw new Error(`not a time command: ${command}`);
  const result = applyTimeCommand(value, trackId, parsed);
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
  expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toStartWith(label);
}

function type(menu: EditMenu, ctx: MenuContext, text: string) {
  menu.key("\r", ctx);
  for (const ch of text) menu.key(ch, ctx);
  return menu.key("\r", ctx);
}

describe("Project › Tempo and meter", () => {
  test("/menu tempo opens it under Project; the row summarises the map", () => {
    expect(MENU_SECTIONS).toContain("tempo");
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "tempo");
    expect(menu.view(ctx).title).toBe("menu › Project › tempo and meter");
    menu.show(ctx, "project");
    select(menu, ctx, "tempo and meter");
    const row = menu.view(ctx).items[menu.view(ctx).index]!;
    expect(row.label).toContain("120 BPM");
    expect(row.label).toContain("4/4");
  });

  test("song length names the written end tempo, not a fermata's hold", () => {
    const value = run(
      run(score(), "rit 2 bars to 50 at bar 3"),
      "fermata at end 2",
    );
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "tempo");
    const labels = menu.view(ctx).items.map((item) => item.label);
    expect(labels.find((label) => label.includes("song length"))).toMatch(
      /ends at 50 BPM · 1 fermata/,
    );
  });

  test("typed rows add tempo changes, rit., fermatas and meter changes", () => {
    const menu = new EditMenu();
    let ctx = context();
    menu.show(ctx, "tempo");
    select(menu, ctx, "add tempo change");
    expect(type(menu, ctx, "90 at bar 5 ramp")).toEqual({
      type: "run",
      command: "tempo 90 at bar 5 ramp",
    });
    select(menu, ctx, "ritardando");
    // An empty rit. closes the song with the default ratio.
    expect(type(menu, ctx, "")).toEqual({ type: "run", command: "rit" });
    select(menu, ctx, "add fermata");
    expect(type(menu, ctx, "at 31 2")).toEqual({
      type: "run",
      command: "fermata at 31 2",
    });
    select(menu, ctx, "add meter change");
    expect(type(menu, ctx, "7/8 at bar 3")).toEqual({
      type: "run",
      command: "meter 7/8 at bar 3",
    });
    // Text that does not parse runs nothing.
    select(menu, ctx, "add tempo change");
    expect(type(menu, ctx, "fast please")).toEqual({ type: "handled" });

    let next = run(ctx.score, "tempo 90 at bar 5 ramp");
    next = run(next, "fermata at 27 2");
    // A meter change after bar 5 keeps the tempo change on its bar line.
    next = run(next, "meter 7/8 at bar 7");
    ctx = context(next);
    const labels = menu.view(ctx).items.map((row) => row.label);
    for (const label of [
      "tempo @ bar 5",
      "glide @ bar 5",
      "fermata @ 27",
      "meter @ bar 7",
      "clear tempo changes",
    ])
      expect(labels.some((row) => row.startsWith(label))).toBe(true);
  });

  test("left/right nudge a tempo event; the glide choice cycles; x removes", () => {
    const menu = new EditMenu();
    const ctx = context(run(score(), "tempo 90 at bar 5 ramp"));
    menu.show(ctx, "tempo");
    select(menu, ctx, "tempo @ bar 5");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "tempo 91 at 16 ramp",
    });
    expect(menu.key(LEFT, ctx)).toEqual({
      type: "run",
      command: "tempo 89 at 16 ramp",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "tempo remove 16",
    });
    select(menu, ctx, "glide @ bar 5");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "tempo 90 at 16 exp",
    });
  });

  test("meter changes and fermatas nudge and reset in place", () => {
    const menu = new EditMenu();
    let value = run(score(), "meter 7/8 at bar 3");
    value = run(value, "fermata at 27 2");
    const ctx = context(value);
    menu.show(ctx, "tempo");
    select(menu, ctx, "meter @ bar 3");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "meter 8/8 at bar 3",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "meter remove bar 3",
    });
    select(menu, ctx, "fermata @ 27");
    expect(menu.key(LEFT, ctx)).toEqual({
      type: "run",
      command: "fermata at 27 1.75",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "fermata remove 27",
    });
  });

  test("the focused track's time: rate, phase, loop and phasing", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "tempo");
    select(menu, ctx, "keys time");
    expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toContain(
      "follows the song",
    );
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe(
      "menu › Project › tempo and meter › keys time",
    );
    select(menu, ctx, "rate");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "track rate 1.01",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "track rate off",
    });
    select(menu, ctx, "phase");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "track phase 0.25",
    });
    select(menu, ctx, "loop");
    // Off until nudged: the first nudge starts at one bar.
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "track loop 4",
    });
    select(menu, ctx, "phasing");
    expect(type(menu, ctx, "3")).toEqual({
      type: "run",
      command: "track phasing 3",
    });
    select(menu, ctx, "stepped phasing");
    expect(type(menu, ctx, "3 hold 8")).toEqual({
      type: "run",
      command: "track phasing 3 hold 8",
    });
    select(menu, ctx, "follow the song");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "track time off",
    });
    menu.key(ESC, ctx);
    expect(menu.view(ctx).title).toBe("menu › Project › tempo and meter");
  });

  test("every row's command parses as a time command", () => {
    let value = run(score(), "tempo 90 at bar 5 ramp");
    value = run(value, "fermata at 27 2");
    value = run(value, "meter 7/8 at bar 3");
    value = run(value, "track rate 1.5");
    const menu = new EditMenu();
    const ctx = context(value);
    menu.show(ctx, "tempo");
    const rows = menu.view(ctx).items.length;
    const commands: string[] = [];
    for (let i = 0; i < rows; i++) {
      const command = menu.view(ctx).note.match(/›\s*(\S.*)$/)?.[1];
      // `tempo 120` and `meter 4` are the existing edit commands.
      if (command && !/^(tempo|meter) \d+$/.test(command))
        commands.push(command);
      menu.key(DOWN, ctx);
    }
    expect(commands.length).toBeGreaterThan(6);
    for (const command of commands)
      expect(parseTimeCommand(command)).toBeDefined();
  });
});
