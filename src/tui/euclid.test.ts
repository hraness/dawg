import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { applyRhythmCommand, parseRhythmCommand } from "../commands/rhythm.ts";
import { EuclidEditor, ringText } from "./euclid.ts";

const RIGHT = "\u001b[C";
const LEFT = "\u001b[D";
const DOWN = "\u001b[B";
const UP = "\u001b[A";

function kit() {
  return createScore({ bars: 1, tracks: [{ id: "drums", instrument: "kit" }] });
}

/** Run an editor result through the prompt grammar like main.ts does. */
function run(score: ReturnType<typeof kit>, command: string) {
  const parsed = parseRhythmCommand(command);
  expect(parsed).toBeDefined();
  const result = applyRhythmCommand(score, "drums", parsed!);
  expect(result.ok).toBe(true);
  return result.next!;
}

describe("euclid editor", () => {
  test("lists one lane per drum voice and adds E(4,16) on enter", () => {
    const editor = new EuclidEditor();
    let score = kit();
    const ctx = () => ({ score, trackId: "drums" });
    editor.show(ctx());
    const view = editor.view(ctx());
    expect(view.items.map((item) => item.label.split(" ")[0])).toEqual([
      "kick",
      "snare",
      "clap",
      "rim",
      "tom",
      "hat",
      "open",
    ]);
    const added = editor.key("\r", ctx());
    expect(added).toEqual({
      type: "run",
      command: "euclid kick 4 16",
      audition: "kick",
    });
    score = run(score, "euclid kick 4 16");
    expect(editor.view(ctx()).items[0]!.label).toContain("x···x···x···x···");
  });

  test("nudges, tabs between parameters, types digits and wraps rotate", () => {
    const editor = new EuclidEditor();
    let score = run(kit(), "euclid hat 3 8");
    const ctx = () => ({ score, trackId: "drums" });
    editor.show(ctx(), "hat");
    expect(editor.selectedVoice(ctx())).toBe("hat");
    expect(editor.key(RIGHT, ctx())).toMatchObject({
      command: "euclid hat pulses 4",
    });
    expect(editor.key(LEFT, ctx())).toMatchObject({
      command: "euclid hat pulses 2",
    });
    editor.key("\t", ctx());
    editor.key("\t", ctx());
    expect(editor.selectedParam).toBe("rotate");
    // Rotate wraps backwards around the ring.
    expect(editor.key(LEFT, ctx())).toMatchObject({
      command: "euclid hat rotate 7",
    });
    editor.key("5", ctx());
    expect(editor.view(ctx()).title).toContain("rotate: 5");
    const typed = editor.key("\r", ctx());
    expect(typed).toMatchObject({ command: "euclid hat rotate 5" });
    score = run(score, "euclid hat rotate 5");
    expect(ringText(score.tracks[0]!.rhythm![0])).toBe("x··x·x··");
    // Division cycles through note values.
    editor.key("\t", ctx());
    expect(editor.key(RIGHT, ctx())).toMatchObject({
      command: "euclid hat division 1/8t",
    });
    // Shift-tab walks backwards and wraps past pulses to the last one.
    for (let i = 0; i < 4; i++) editor.key("\u001b[Z", ctx());
    expect(editor.selectedParam).toBe("nudge");
  });

  test("x removes a row, f freezes it, esc closes, other keys are swallowed", () => {
    const editor = new EuclidEditor();
    const score = run(kit(), "euclid snare 2 8 rotate 2");
    const ctx = { score, trackId: "drums" };
    editor.show(ctx);
    // Opens on the first voice that has a row.
    expect(editor.selectedVoice(ctx)).toBe("snare");
    expect(editor.key("x", ctx)).toEqual({
      type: "run",
      command: "euclid snare off",
    });
    expect(editor.key("f", ctx)).toEqual({
      type: "run",
      command: "euclid snare freeze",
    });
    expect(editor.key("q", ctx)).toEqual({ type: "handled" });
    expect(editor.key(" ", ctx)).toEqual({ type: "audition", voice: "snare" });
    // The blue knob has focus: → turns to the next drum row.
    editor.key(RIGHT, ctx);
    expect(editor.selectedVoice(ctx)).toBe("clap");
    expect(editor.key("x", ctx)).toEqual({ type: "handled" });
    expect(editor.key("\u0003", ctx)).toEqual({ type: "pass" });
    expect(editor.key("\u001b", ctx)).toEqual({ type: "close" });
  });

  test("four knobs: ● drum ▲ pulses ■ rotate ◆ velocity, ↑↓ pick, ←→ turn", () => {
    const editor = new EuclidEditor();
    const score = run(kit(), "euclid kick 4 16");
    const ctx = { score, trackId: "drums" };
    editor.show(ctx);
    expect(editor.selectedKnob).toBe(0);
    expect(editor.view(ctx).hint).toContain(
      "●›kick ▲ pulses 4 ■ rotate 0 ◆ velocity",
    );
    expect(editor.view(ctx).hint).toContain("↑↓ knob · ←→ turn");
    editor.key(RIGHT, ctx);
    expect(editor.selectedVoice(ctx)).toBe("snare");
    editor.key(LEFT, ctx);
    const turned: string[] = [];
    for (const field of ["pulses", "rotate", "velocity"]) {
      editor.key(DOWN, ctx);
      expect(editor.selectedParam).toBe(field);
      const result = editor.key(RIGHT, ctx);
      if (result.type === "run") turned.push(result.command);
    }
    expect(turned).toEqual([
      "euclid kick pulses 5",
      "euclid kick rotate 1",
      "euclid kick velocity 0.85",
    ]);
    // ↓ from orange wraps to blue; ↑ from blue to orange.
    editor.key(DOWN, ctx);
    expect(editor.selectedKnob).toBe(0);
    editor.key(UP, ctx);
    expect(editor.selectedParam).toBe("velocity");
    // Tab reaches fields no knob turns; ↓ comes back to blue.
    editor.key("\t", ctx);
    expect(editor.selectedKnob).toBeUndefined();
    editor.key(DOWN, ctx);
    expect(editor.selectedKnob).toBe(0);
  });

  test("a grid row's shape nudges back into a Euclidean row", () => {
    const editor = new EuclidEditor();
    const score = run(kit(), "grid kick x..x..x.");
    const ctx = { score, trackId: "drums" };
    editor.show(ctx, "kick");
    expect(editor.view(ctx).items[0]!.label).toContain("x··x··x·");
    expect(editor.key(RIGHT, ctx)).toMatchObject({
      command: "euclid kick 3 8",
    });
  });
});

describe("euclid editor while auditioning", () => {
  const audition = (committed: ReturnType<typeof kit>, dirty: boolean) => ({
    looping: true,
    dirty,
    committed,
    hint: " space stop · a A/B · c context · enter keep · esc revert · ? keys ",
    status: dirty ? "♪ solo · B staged 1" : "♪ solo",
  });

  test("space, a and c drive the loop; Enter keeps and Esc reverts staged edits", () => {
    const editor = new EuclidEditor();
    const committed = run(kit(), "euclid kick 4 16");
    const staged = run(committed, "euclid kick pulses 5");
    const clean = {
      score: committed,
      trackId: "drums",
      audition: audition(committed, false),
    };
    const dirty = {
      score: staged,
      trackId: "drums",
      audition: audition(committed, true),
    };
    editor.show(clean);
    editor.key(DOWN, clean);
    expect(editor.key(" ", clean)).toEqual({ type: "loop", key: "loop" });
    expect(editor.key("a", clean)).toEqual({ type: "loop", key: "ab" });
    expect(editor.key("c", clean)).toEqual({ type: "loop", key: "context" });
    // A nudge is still the command it stands for (main stages it).
    expect(editor.key(RIGHT, clean)).toMatchObject({
      type: "run",
      command: "euclid kick pulses 5",
    });
    expect(editor.key("\r", dirty)).toEqual({ type: "keep" });
    expect(editor.key("\u001b", dirty)).toEqual({ type: "revert" });
    expect(editor.key("\u001b", clean)).toEqual({ type: "close" });
  });

  test("the view marks staged rows and carries the loop status and grammar", () => {
    const editor = new EuclidEditor();
    const committed = run(kit(), "euclid kick 4 16");
    const staged = run(committed, "euclid kick pulses 5");
    const ctx = {
      score: staged,
      trackId: "drums",
      audition: audition(committed, true),
    };
    editor.show(ctx);
    const view = editor.view(ctx);
    expect(view.title.startsWith("● rhythm")).toBe(true);
    expect(view.title).toContain("B staged 1");
    expect(view.items[0]!.detail).toContain("E(5,16) ← E(4,16)");
    expect(view.items[1]!.detail).toBe("enter adds E(4,16)");
    expect(view.hint).toContain("enter keep");
  });
});
