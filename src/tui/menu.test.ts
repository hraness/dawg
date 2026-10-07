import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyEditCommand, parseEditCommand } from "../commands/edit.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const LEFT = "\u001b[D";
const RIGHT = "\u001b[C";
const ESC = "\u001b";

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      { id: "keys", name: "keys", instrument: "piano" },
      { id: "bass", name: "bass", instrument: "bass", volume: 0.6 },
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

/** Move to the row whose label starts with `label`. */
function select(menu: EditMenu, ctx: MenuContext, label: string): void {
  const rows = menu.view(ctx).items;
  const target = rows.findIndex((row) => row.label.startsWith(label));
  expect(target).toBeGreaterThanOrEqual(0);
  const now = menu.view(ctx).index;
  for (let i = now; i < target; i++) menu.key(DOWN, ctx);
  for (let i = now; i > target; i--) menu.key(UP, ctx);
  expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toStartWith(label);
}

describe("edit menu", () => {
  test("root lists the sections and the rhythm editor with current values", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    const labels = menu.view(ctx).items.map((row) => row.label.split(" ")[0]);
    expect(labels).toEqual([
      "Track",
      "Parameters",
      "Effects",
      "Automation",
      "Mix",
      "Sounds",
      "Rhythm",
      "Transport",
      "Chords",
    ]);
    expect(menu.view(ctx).items[7]!.label).toContain("120 BPM");
    expect(menu.view(ctx).items[8]!.label).toContain("manual");
  });

  test("Chords edits play-mode chord settings and the song key", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "chords");
    expect(menu.view(ctx).title).toBe("menu › Chords");
    select(menu, ctx, "mode");
    expect(menu.key(LEFT, ctx)).toEqual({
      type: "run",
      command: "/chords auto",
    });
    select(menu, ctx, "key mode");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "key C minor",
    });
    select(menu, ctx, "voicing");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "/chords voicing 1",
    });
    select(menu, ctx, "bass");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "/chords bass on",
    });
    select(menu, ctx, "perform");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "/chords perform strum-up",
    });
  });

  test("Enter opens, Esc backs out one level, Esc at the root closes", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    select(menu, ctx, "Effects");
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe("menu › Effects");
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe("menu › Effects › Filter");
    expect(menu.key(ESC, ctx)).toEqual({ type: "handled" });
    expect(menu.key(ESC, ctx)).toEqual({ type: "handled" });
    expect(menu.key(ESC, ctx)).toEqual({ type: "close" });
  });

  test("nudges run the command the row shows, with the field's step", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "track");
    select(menu, ctx, "volume");
    const row = menu.view(ctx).items[menu.view(ctx).index]!;
    expect(row.label).toContain("1");
    expect(row.detail).toBe("volume 1");
    // Clamped at the top of the range; down steps by 0.05.
    expect(menu.key(RIGHT, ctx)).toEqual({ type: "handled" });
    expect(menu.key("-", ctx)).toEqual({ type: "run", command: "volume 0.95" });
    select(menu, ctx, "pan");
    expect(menu.key("l", ctx)).toEqual({ type: "run", command: "pan 0.1" });
    select(menu, ctx, "mute");
    expect(menu.key("\r", ctx)).toEqual({ type: "run", command: "mute" });
  });

  test("typed digits set a value; out-of-range input runs nothing", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "transport");
    select(menu, ctx, "tempo");
    menu.key("9", ctx);
    menu.key("5", ctx);
    expect(menu.view(ctx).title).toContain("tempo BPM: 95");
    expect(menu.key("\r", ctx)).toEqual({ type: "run", command: "tempo 95" });
    menu.key("9", ctx);
    menu.key("9", ctx);
    menu.key("9", ctx);
    expect(menu.key("\r", ctx)).toEqual({ type: "handled" });
    select(menu, ctx, "beats per bar");
    expect(menu.key(LEFT, ctx)).toEqual({ type: "run", command: "meter 3" });
  });

  test("an effect that is off turns on with its first nudge", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "effects");
    menu.key("\r", ctx); // Filter
    select(menu, ctx, "cutoff");
    expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toContain("off");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "fx filter cutoff 2000",
    });
    const on = score().toJSON();
    const filtered = createScore({
      ...on,
      tracks: (on.tracks ?? []).map((track) =>
        track.id === "keys"
          ? { ...track, filter: { cutoff: 2000, resonance: 0.2 } }
          : track,
      ),
    });
    const next = context(filtered);
    expect(menu.key(RIGHT, next)).toEqual({
      type: "run",
      command: "fx filter cutoff 2245",
    });
    select(menu, next, "resonance");
    expect(menu.key(RIGHT, next)).toEqual({
      type: "run",
      command: "fx filter resonance 0.25",
    });
  });

  test("choices open a list; ←/→ cycle without opening", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "track");
    select(menu, ctx, "instrument");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "instrument pluck",
    });
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe("menu › Track › instrument");
    select(menu, ctx, "saw");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "instrument saw",
    });
  });

  test("automation: add points, ramp, nudge and delete a point", () => {
    const menu = new EditMenu();
    let ctx = context();
    menu.show(ctx, "automation");
    select(menu, ctx, "filter cutoff");
    menu.key("\r", ctx);
    select(menu, ctx, "add points");
    menu.key("\r", ctx);
    for (const ch of "2:800") menu.key(ch, ctx);
    const add = menu.key("\r", ctx);
    expect(add).toEqual({
      type: "run",
      command: "automate filter points 2:800",
    });
    select(menu, ctx, "ramp");
    menu.key("\r", ctx);
    for (const ch of "0:200 4:8000") menu.key(ch, ctx);
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "automate filter points 0:200 4:8000",
    });

    // Apply both through the edit grammar, then edit the point row.
    let value = score();
    for (const command of [
      "automate filter points 2:800",
      "automate filter points 0:200 4:8000",
    ]) {
      const result = applyEditCommand(
        value,
        "keys",
        parseEditCommand(command)!,
      );
      expect(result.ok).toBe(true);
      value = result.next!;
    }
    expect(value.tracks[0]!.filterAutomation).toHaveLength(3);
    ctx = context(value);
    select(menu, ctx, "beat 2");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "automate filter points 2:1000",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "automate filter remove 2",
    });
    select(menu, ctx, "clear lane");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "clear filter automation",
    });
  });

  test("/ filters the current list; Esc clears the filter first", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "transport");
    menu.key("/", ctx);
    for (const ch of "grid") menu.key(ch, ctx);
    const rows = menu.view(ctx).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toStartWith("grid");
    expect(rows[0]!.detail).toBe("/grid 1/16");
    expect(menu.view(ctx).title).toContain("/grid");
    menu.key(ESC, ctx);
    expect(menu.view(ctx).items.length).toBeGreaterThan(1);
    expect(menu.view(ctx).title).toBe("menu › Transport");
  });

  test("mix focuses another track before editing it", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "mix");
    select(menu, ctx, "bass");
    expect(menu.key("\r", ctx)).toEqual({
      type: "run",
      command: "/track bass",
    });
  });

  test("Ctrl-C and redraw pass through to the app", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    expect(menu.key("\u0003", ctx)).toEqual({ type: "pass" });
  });
});

describe("edit commands", () => {
  test("parse names, meter, points and removal; reject bad input", () => {
    expect(parseEditCommand("track name Lead Line")).toEqual({
      type: "track-name",
      name: "Lead Line",
    });
    expect(parseEditCommand("meter 3")).toEqual({
      type: "meter",
      beatsPerBar: 3,
    });
    expect(parseEditCommand("meter 0")).toBeUndefined();
    expect(parseEditCommand("automate pan points 0:-1 4:1")).toEqual({
      type: "automation-points",
      parameter: "pan",
      points: [
        { beat: 0, value: -1 },
        { beat: 4, value: 1 },
      ],
    });
    expect(parseEditCommand("automate cutoff points 0:5")).toBeUndefined();
    expect(parseEditCommand("automate wobble points 0:1")).toBeUndefined();
    expect(parseEditCommand("automate volume remove 2")).toEqual({
      type: "automation-remove",
      parameter: "volume",
      beat: 2,
    });
    expect(parseEditCommand("name the track after my dog")).toBeUndefined();
  });

  test("each command is one operation on the focused track", () => {
    const base = score();
    const renamed = applyEditCommand(base, "keys", {
      type: "track-name",
      name: "Rhodes",
    });
    expect(renamed.next!.tracks[0]!.name).toBe("Rhodes");
    expect(renamed.kind).toBe("score.track");
    const meter = applyEditCommand(base, "keys", {
      type: "meter",
      beatsPerBar: 3,
    });
    expect(meter.next!.beatsPerBar).toBe(3);
    const missing = applyEditCommand(base, "keys", {
      type: "automation-remove",
      parameter: "volume",
      beat: 1,
    });
    expect(missing.ok).toBe(false);
  });
});

describe("key command", () => {
  test("key sets, normalises and clears the song key in one operation", () => {
    expect(parseEditCommand("key a minor")).toEqual({
      type: "key",
      key: "A minor",
    });
    expect(parseEditCommand("/key Bb dorian")).toEqual({
      type: "key",
      key: "Bb dorian",
    });
    expect(parseEditCommand("key none")).toEqual({ type: "key", key: null });
    expect(parseEditCommand("key H major")).toBeUndefined();
    const set = applyEditCommand(score(), "keys", parseEditCommand("key Am")!);
    expect(set.next!.key).toBe("A minor");
    expect(set.kind).toBe("score.key");
  });
});
