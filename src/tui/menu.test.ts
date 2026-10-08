import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyEditCommand, parseEditCommand } from "../commands/edit.ts";
import {
  applyExpressionCommand,
  parseExpressionCommand,
} from "../commands/expression.ts";
import { EditMenu, type MenuContext } from "./menu.ts";

function applyEdit(value: TrackScore, command: string): TrackScore {
  const result = applyExpressionCommand(
    value,
    "keys",
    parseExpressionCommand(command)!,
  );
  return result.next!;
}

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
  test("root lists six plain sections with a summary and a description", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    const labels = menu
      .view(ctx)
      .items.map((row) => row.label.slice(0, 16).trim());
    expect(labels).toEqual([
      "Sound",
      "Effects",
      "Rhythm",
      "Chords",
      "Mix & automation",
      "Project",
    ]);
    expect(menu.view(ctx).items[3]!.label).toContain("manual");
    expect(menu.view(ctx).items[5]!.label).toContain("120 BPM");
    // The focused row is described under the list.
    expect(menu.view(ctx).note).toContain("instrument");
  });

  test("old section names open where that content lives now", () => {
    const menu = new EditMenu();
    const ctx = context();
    for (const [section, title] of [
      ["parameters", "menu › Sound"],
      ["sounds", "menu › Sound › browse sounds"],
      ["track", "menu › Mix & automation"],
      ["automation", "menu › Mix & automation › automation"],
      ["transport", "menu › Project"],
    ] as const) {
      menu.show(ctx, section);
      expect(menu.view(ctx).title).toBe(title);
    }
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
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "/chords bass chords",
    });
    select(menu, ctx, "perform");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "/chords perform strum-up",
    });
    select(menu, ctx, "pattern");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "/chords pattern sixteenths",
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

  test("orbit and duck live under more effects and run fx commands", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    select(menu, ctx, "Effects");
    menu.key("\r", ctx);
    select(menu, ctx, "more effects");
    menu.key("\r", ctx);
    select(menu, ctx, "Duck");
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe("menu › Effects › more effects › Duck");
    const labels = menu.view(ctx).items.map((row) => row.label);
    expect(labels.some((label) => label.startsWith("orbit"))).toBe(true);
    expect(labels.some((label) => label.startsWith("depth"))).toBe(true);
    select(menu, ctx, "orbit");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "fx duck orbit 1",
    });
  });

  test("nudges run the command the row shows, with the field's step", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "mix");
    select(menu, ctx, "volume");
    const row = menu.view(ctx).items[menu.view(ctx).index]!;
    expect(row.label).toContain("1 · 0.0 dB");
    // The row hides command syntax; the note under the list teaches it.
    expect(row.detail).toBeUndefined();
    expect(menu.view(ctx).note).toEndWith("› volume 1");
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
    menu.show(ctx, "project");
    select(menu, ctx, "tempo");
    expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toContain(
      "120 BPM",
    );
    menu.key("9", ctx);
    menu.key("5", ctx);
    expect(menu.view(ctx).title).toContain("tempo: 95");
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

  test("Sound: instrument, synth preset, simple params, advanced, performance, browse", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx);
    select(menu, ctx, "Sound");
    menu.key("\r", ctx);
    const labels = menu
      .view(ctx)
      .items.map((row) => row.label.slice(0, 16).trim());
    expect(labels.slice(0, 3)).toEqual(["instrument", "preset", "attack"]);
    expect(labels.at(-3)).toBe("advanced");
    expect(labels.at(-2)).toBe("performance");
    expect(labels.at(-1)).toBe("browse sounds");
    select(menu, ctx, "attack");
    expect(menu.key(RIGHT, ctx)).toMatchObject({ type: "run" });
    // Plain label; the note names the prompt command.
    select(menu, ctx, "filter cutoff");
    expect(menu.view(ctx).note).toContain("› synth lpf 2000");
    expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toContain("off");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "synth lpf 2000",
    });
    select(menu, ctx, "advanced");
    menu.key("\r", ctx);
    const groups = menu.view(ctx).items.map((row) => row.label);
    expect(groups.some((label) => label.startsWith("FM 8"))).toBe(true);
    select(menu, ctx, "pitch envelope");
    menu.key("\r", ctx);
    select(menu, ctx, "penv");
    // Unset → the first nudge writes the default, as effects do.
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "synth penv 0",
    });
  });

  test("choices open a list; ←/→ cycle without opening", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "sound");
    select(menu, ctx, "instrument");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "instrument pluck",
    });
    menu.key("\r", ctx);
    expect(menu.view(ctx).title).toBe("menu › Sound › instrument");
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
    menu.show(ctx, "project");
    menu.key("/", ctx);
    for (const ch of "grid") menu.key(ch, ctx);
    const rows = menu.view(ctx).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toStartWith("grid");
    expect(menu.view(ctx).note).toEndWith("› /grid 1/16");
    expect(menu.view(ctx).title).toContain("/grid");
    menu.key(ESC, ctx);
    expect(menu.view(ctx).items.length).toBeGreaterThan(1);
    expect(menu.view(ctx).title).toBe("menu › Project");
  });

  test("mix focuses another track before editing it", () => {
    const menu = new EditMenu();
    const ctx = context();
    menu.show(ctx, "mix");
    select(menu, ctx, "all tracks");
    menu.key("\r", ctx);
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

describe("Sound › performance", () => {
  const played = createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
    notes: [0, 1].map((beat) => ({
      id: `n${beat}`,
      trackId: "keys",
      startTick: beat * 480,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    })),
  });

  function open(ctx: MenuContext): EditMenu {
    const menu = new EditMenu();
    menu.show(ctx, "performance");
    return menu;
  }

  test("opens by name and lists the performance rows", () => {
    const ctx = context(played);
    const menu = open(ctx);
    expect(menu.view(ctx).title).toContain("performance");
    const labels = menu.view(ctx).items.map((row) => row.label);
    for (const label of [
      "articulation",
      "glide (s)",
      "glide mode",
      "bend",
      "vibrato",
      "sustain pedal",
      "velocity curve",
      "humanize timing (ms)",
    ])
      expect(labels.some((row) => row.startsWith(label))).toBe(true);
  });

  test("rows run the prompt commands", () => {
    const ctx = context(played);
    const menu = open(ctx);
    select(menu, ctx, "articulation");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "art staccato",
    });
    select(menu, ctx, "glide (s)");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "glide 60ms",
    });
    select(menu, ctx, "glide mode");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "glide legato",
    });
    select(menu, ctx, "sustain pedal");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "pedal bars",
    });
    select(menu, ctx, "velocity curve");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "velcurve soft",
    });
    select(menu, ctx, "humanize timing");
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "humanize 8 0 0",
    });
  });

  test("set values show and x resets them", () => {
    const humanized = applyEdit(played, "humanize 10 5");
    const ctx = context(humanized);
    const menu = open(ctx);
    select(menu, ctx, "humanize timing");
    expect(menu.view(ctx).items[menu.view(ctx).index]!.label).toContain(
      "±10 ms",
    );
    expect(menu.key(RIGHT, ctx)).toEqual({
      type: "run",
      command: "humanize 11 5 0",
    });
    expect(menu.key("x", ctx)).toEqual({
      type: "run",
      command: "humanize off",
    });
    expect(
      menu.view(ctx).items.some((row) => row.label.startsWith("new take")),
    ).toBe(true);
  });
});

describe("auditioning in the menu", () => {
  const auditioning = (
    value: TrackScore,
    committed: TrackScore,
    dirty: boolean,
  ): MenuContext => ({
    ...context(value),
    audition: {
      looping: true,
      dirty,
      committed,
      hint: " space stop · a A/B · c context · enter keep · esc revert · ? keys ",
      status: dirty ? "♪ solo · B staged 1" : "♪ solo",
    },
  });

  test("Space, a and c reach the audition; a toggle row still switches on Space", () => {
    const menu = new EditMenu();
    const ctx = auditioning(score(), score(), false);
    menu.show(ctx, "mix");
    select(menu, ctx, "volume");
    expect(menu.key(" ", ctx)).toEqual({ type: "audition", key: "loop" });
    expect(menu.key("a", ctx)).toEqual({ type: "audition", key: "ab" });
    expect(menu.key("c", ctx)).toEqual({ type: "audition", key: "context" });
    // Nudges still run their command; the window decides to stage it.
    expect(menu.key("-", ctx)).toEqual({ type: "run", command: "volume 0.95" });
    select(menu, ctx, "mute");
    expect(menu.key(" ", ctx)).toEqual({ type: "run", command: "mute" });
    // Without an audition host the keys keep their old meaning.
    const plain = new EditMenu();
    plain.show(context(), "mix");
    expect(plain.key("a", context())).toEqual({ type: "handled" });
  });

  test("staged rows show staged ← committed; Enter keeps; Esc reverts first", () => {
    const committed = score();
    const staged = committed.withTracks(
      committed.tracks.map((track) =>
        track.id === "keys" ? { ...track, volume: 0.8 } : track,
      ),
    );
    const menu = new EditMenu();
    const ctx = auditioning(staged, committed, true);
    menu.show(ctx, "mix");
    select(menu, ctx, "volume");
    const view = menu.view(ctx);
    expect(view.items[view.index]!.label).toContain("0.8");
    expect(view.items[view.index]!.label).toContain(" ← 1");
    // Unchanged rows show one value.
    expect(
      view.items.find((row) => row.label.startsWith("pan"))!.label,
    ).not.toContain("←");
    expect(view.title).toStartWith("● ");
    expect(view.title).toContain("B staged 1");
    expect(view.hint).toContain("enter keep");
    expect(menu.key("\r", ctx)).toEqual({ type: "keep" });
    expect(menu.key(ESC, ctx)).toEqual({ type: "revert" });
    // Once reverted, Esc goes back as usual.
    const clean = auditioning(committed, committed, false);
    expect(menu.key(ESC, clean)).toEqual({ type: "handled" });
  });
});

describe("hovering lists in the menu", () => {
  const looping = (on: boolean): MenuContext => ({
    ...context(),
    audition: {
      looping: on,
      dirty: false,
      committed: score(),
      hint: "",
      status: on ? "♪ solo" : "",
    },
  });

  test("while looping, moving hears the row; Enter chooses; Esc and ← drop the hover", () => {
    const menu = new EditMenu();
    const ctx = looping(true);
    menu.show(ctx, "sound");
    select(menu, ctx, "browse sounds");
    expect(menu.key("\r", ctx)).toEqual({ type: "handled" });
    select(menu, ctx, "instruments");
    expect(menu.key("\r", ctx)).toEqual({ type: "handled" });
    const moved = menu.key(DOWN, ctx);
    expect(moved).toEqual({
      type: "hover",
      command: expect.stringMatching(/^\/pack use gm\//),
      key: "menu:instruments",
    });
    expect(menu.key("\r", ctx)).toMatchObject({
      type: "choose",
      key: "menu:instruments",
    });
    menu.key(DOWN, ctx);
    expect(menu.key(ESC, ctx)).toEqual({
      type: "unhover",
      key: "menu:instruments",
    });
    // Back in "browse sounds"; ← from a hovered list drops it as well.
    select(menu, ctx, "instruments");
    menu.key("\r", ctx);
    menu.key(DOWN, ctx);
    expect(menu.key(LEFT, ctx)).toEqual({
      type: "unhover",
      key: "menu:instruments",
    });
  });

  test("with the loop off, lists move and Enter runs as before", () => {
    const menu = new EditMenu();
    const ctx = looping(false);
    menu.show(ctx, "sound");
    select(menu, ctx, "browse sounds");
    menu.key("\r", ctx);
    select(menu, ctx, "instruments");
    menu.key("\r", ctx);
    expect(menu.key(DOWN, ctx)).toEqual({ type: "handled" });
    expect(menu.key("\r", ctx)).toMatchObject({ type: "run" });
    // Non-sound rows (pack info) never hover.
    const on = looping(true);
    const browse = new EditMenu();
    browse.show(on, "sound");
    select(browse, on, "browse sounds");
    browse.key("\r", on);
    select(browse, on, "sample packs");
    browse.key("\r", on);
    expect(browse.key(DOWN, on)).toEqual({ type: "handled" });
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
