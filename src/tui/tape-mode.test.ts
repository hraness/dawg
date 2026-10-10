/**
 * TAPE's keys and view model (op1-ux §6): every gesture maps to the typed
 * range command a person would write, the range follows core/range.ts
 * (loop, else section, else bar), and the view turns a score into cells.
 */
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { commandParses } from "../commands/parses.ts";
import {
  clipboardLabel,
  cutArmed,
  foldBase,
  focusCommand,
  formRepeat,
  rangeLine,
  tapeKey,
  tapeKnobs,
  typedRange,
  type TapeContext,
} from "./tape-mode.ts";
import { tapeCells, tapeView } from "./tape-view.ts";

const BAR = 4 * 480;

function song(
  loop?: { startBar: number; bars: number },
  form?: readonly { section: string; repeat?: number }[],
): TrackScore {
  return createScore({
    bars: 8,
    tracks: [
      { id: "drums", name: "drums", instrument: "kit" },
      { id: "bass", name: "bass", instrument: "saw" },
    ],
    notes: Array.from({ length: 4 }, (_, bar) => ({
      id: `b${bar + 1}`,
      trackId: "bass",
      pitch: 40,
      startTick: bar * BAR,
      durationTicks: 480,
      velocity: 0.8,
    })),
    sections: [
      { name: "verse", startBar: 0, bars: 4 },
      { name: "chorus", startBar: 4, bars: 4 },
    ],
    ...(loop ? { loop } : {}),
    ...(form ? { form } : {}),
  });
}

function context(extra: Partial<TapeContext> = {}): TapeContext {
  return { score: song(), trackId: "bass", beat: 17, ...extra };
}

function commands(action: ReturnType<typeof tapeKey>): readonly string[] {
  if (action.type === "run") return action.commands;
  if (action.type === "paste") return [action.command];
  return [];
}

describe("TAPE keys echo typed commands", () => {
  test("the range is the section under the playhead without a loop", () => {
    expect(rangeLine(context())).toBe("range: bass · bars 5–8 (chorus)");
    expect(commands(tapeKey(context(), "c"))).toEqual(["copy bass 5-8"]);
    expect(commands(tapeKey(context(), "C"))).toEqual(["copy all 5-8"]);
  });

  test("the loop range wins over the section (score.loop)", () => {
    const ctx = context({ score: song({ startBar: 4, bars: 2 }) });
    expect(rangeLine(ctx)).toBe("range: bass · bars 5–6 (loop)");
    expect(commands(tapeKey(ctx, "x"))).toEqual([
      "copy bass 5-6",
      "clear bass 5-6",
    ]);
    expect(tapeKey(ctx, "x")).toMatchObject({ cut: true });
    expect(commands(tapeKey(ctx, "\u007f"))).toEqual(["clear bass 5-6"]);
    expect(commands(tapeKey(ctx, "~"))).toEqual(["reverse bass 5-6"]);
  });

  test("paste needs a clipboard, folds into move after a cut", () => {
    expect(tapeKey(context(), "v")).toMatchObject({ type: "note" });
    const clipboard = { source: "bass", range: { startBar: 0, bars: 2 } };
    expect(tapeKey(context({ clipboard }), "v")).toEqual({
      type: "paste",
      command: "copy bass 1-2 to 5",
      end: 6,
    });
    expect(tapeKey(context({ clipboard }), "V")).toMatchObject({
      command: "copy bass 1-2 to 5 insert",
    });
    expect(tapeKey(context({ clipboard, cut: true }), "v")).toMatchObject({
      command: "move bass 1-2 to 5",
      fold: true,
    });
    // Stale or another track's clipboard pastes from the clipboard itself.
    expect(tapeKey(context({ clipboard, stale: true }), "v")).toMatchObject({
      command: "paste at 5",
    });
    expect(
      tapeKey(context({ clipboard, trackId: "drums" }), "v"),
    ).toMatchObject({ command: "paste at 5" });
  });

  test("loop keys: \\ loops the section, then off; brackets size it", () => {
    expect(commands(tapeKey(context(), "\\"))).toEqual(["loop chorus"]);
    const looped = context({ score: song({ startBar: 4, bars: 2 }) });
    expect(commands(tapeKey(looped, "\\"))).toEqual(["loop off"]);
    expect(commands(tapeKey(looped, ">"))).toEqual(["loop 7-8"]);
    expect(commands(tapeKey(looped, "<"))).toEqual(["loop 3-4"]);
    expect(commands(tapeKey(looped, "]"))).toEqual(["loop 5-7"]);
    expect(commands(tapeKey(looped, "["))).toEqual(["loop 5"]);
    expect(commands(tapeKey(looped, "{"))).toEqual(["loop 4-6"]);
    expect(commands(tapeKey(looped, "}"))).toEqual(["loop 6"]);
    const edge = context({ score: song({ startBar: 6, bars: 2 }) });
    expect(tapeKey(edge, ">")).toMatchObject({ type: "note" });
  });

  test("sections: , . jump, s S split and join", () => {
    expect(commands(tapeKey(context(), ","))).toEqual(["jump chorus"]);
    expect(commands(tapeKey(context({ beat: 2 }), "."))).toEqual([
      "jump chorus",
    ]);
    expect(tapeKey(context(), ".")).toMatchObject({ type: "note" });
    expect(commands(tapeKey(context({ beat: 25 }), "s"))).toEqual([
      "section split chorus at 7",
    ]);
    // In the chorus, `S` joins it onto the verse that ends where it starts
    // (undoing an `s`); in the verse, the verse joins with the next.
    expect(commands(tapeKey(context(), "S"))).toEqual(["section join verse"]);
    expect(commands(tapeKey(context({ beat: 2 }), "S"))).toEqual([
      "section join verse",
    ]);
  });

  test("number keys pick tracks, not knobs (§13)", () => {
    expect(tapeKey(context(), "1")).toEqual({ type: "focus", row: 0 });
    expect(tapeKey(context(), "\t")).toEqual({ type: "focus", row: 0 });
    expect(tapeKey(context(), "9")).toMatchObject({ type: "note" });
    expect(focusCommand(song(), 0)).toBe("track drums");
  });

  test("mute, solo, exit, zoom and pass-through", () => {
    expect(commands(tapeKey(context(), "h"))).toEqual(["mute bass"]);
    expect(commands(tapeKey(context(), "H"))).toEqual(["solo"]);
    expect(tapeKey(context(), "\u001b")).toEqual({ type: "exit" });
    expect(tapeKey(context(), "\u0014")).toEqual({ type: "exit" });
    expect(tapeKey(context(), "-")).toEqual({ type: "zoom", direction: -1 });
    expect(tapeKey(context(), "q")).toEqual({ type: "pass" });
  });

  test("every command a key echoes parses as typed", () => {
    const keys = "cCxX~\\<>[]{},.sShH".split("");
    const contexts = [
      context(),
      context({ beat: 2 }),
      context({ score: song({ startBar: 2, bars: 3 }) }),
      context({
        clipboard: { source: "bass", range: { startBar: 0, bars: 1 } },
      }),
    ];
    for (const ctx of contexts)
      for (const key of [...keys, "v", "V", "\u007f"])
        for (const command of commands(tapeKey(ctx, key)))
          expect(commandParses(command, ctx.score), command).toBe(true);
  });
});

describe("TAPE knobs", () => {
  const RIGHT = 1;
  test("playhead, loop, tempo and volume turn into typed commands", () => {
    const [playhead, loop, tempo, level] = tapeKnobs(context());
    expect(playhead!.text).toBe("5.2");
    expect(playhead!.turn(RIGHT, false)).toBe("jump 5.3");
    expect(playhead!.turn(-1, true)).toBe("jump 4");
    expect(loop!.text).toBe("off");
    expect(loop!.turn(RIGHT, false)).toBe("loop 5");
    expect(tempo!.turn(RIGHT, false)).toBe("tempo 121");
    expect(level!.turn(-1, false)).toMatch(/^volume bass 0\.\d+$/);
    for (const slot of [playhead, loop, tempo, level])
      expect(commandParses(slot!.turn(-1, false)!, song())).toBe(true);
  });
});

describe("TAPE view", () => {
  test("cells follow the zoom; density marks the notes", () => {
    const score = song({ startBar: 4, bars: 2 });
    expect(tapeCells(score, "bar").bars).toHaveLength(8);
    expect(tapeCells(score, "beat").bars).toHaveLength(32);
    const view = tapeView({
      ...context({ score }),
      zoom: "bar",
      selected: 0,
      marks: (id) => (id === "drums" ? "C●" : ""),
    });
    expect(view.loop).toEqual({ startBar: 4, bars: 2 });
    expect(view.playheadCell).toBe(4);
    expect(view.focused).toBe(1);
    const bass = view.rows[1]!;
    expect(bass.levels.slice(0, 4).every((level) => level > 0)).toBe(true);
    expect(bass.levels.slice(4).every((level) => level === 0)).toBe(true);
    expect(view.rows[0]!.marks).toBe("C●");
    expect(view.range).toBe("range: bass · bars 5–6 (loop)");
  });

  test("labels and the typed range", () => {
    expect(typedRange({ startBar: 4, bars: 1 })).toBe("5");
    expect(typedRange({ startBar: 4, bars: 2 })).toBe("5-6");
    expect(
      clipboardLabel(song(), {
        source: "all",
        range: { startBar: 0, bars: 2 },
      }),
    ).toBe("clipboard: all tracks · 2 bars");
  });
});

describe("cut then paste", () => {
  test("a loop-only change keeps the cut armed; the fold reads the old bars", () => {
    const before = song();
    const after = before.removeNote("b1");
    const moved = after.withLoop({ startBar: 4, bars: 2 });
    expect(cutArmed(after, after)).toBe(true);
    expect(cutArmed(after, moved)).toBe(true);
    expect(cutArmed(after, moved.withTempo(90))).toBe(false);
    expect(cutArmed(undefined, moved)).toBe(false);
    const base = foldBase(before, moved);
    expect(base.notes).toEqual(before.notes);
    expect(base.loop).toEqual({ startBar: 4, bars: 2 });
  });
});

describe("form on the tape", () => {
  const formed = (): TrackScore =>
    song(undefined, [{ section: "verse" }, { section: "chorus", repeat: 2 }]);

  test("editing a repeated section says it plays twice", () => {
    const score = formed();
    expect(formRepeat(score, 5)).toBe("edits chorus (plays 2×)");
    expect(formRepeat(score, 1)).toBeUndefined();
    expect(formRepeat(song(), 5)).toBeUndefined();
    expect(rangeLine(context({ score }))).toBe(
      "range: bass · bars 5–8 (chorus) · edits chorus (plays 2×)",
    );
  });

  test("the view unrolls the form; the second pass is a ghost of bars 5-8", () => {
    const score = formed();
    const base = { ...context({ score, beat: 17 }), zoom: "bar" as const };
    const view = tapeView({ ...base, selected: 0, marks: () => "" });
    expect(view.cellBars).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7]);
    expect(view.ghosts).toEqual([
      ...Array(8).fill(false),
      ...Array(4).fill(true),
    ]);
    expect(view.passNames).toEqual(["verse", "chorus ×2", "chorus ×2"]);
    // Without a transport beat the playhead sits on the first pass…
    expect(view.playheadCell).toBe(4);
    // …and on the second pass when the transport is there (beat 33 = bar 9).
    const later = tapeView({
      ...base,
      selected: 0,
      marks: () => "",
      transportBeat: 33,
    });
    expect(later.playheadCell).toBe(8);
  });

  test("bars the form never plays stay on the tape, after it", () => {
    const score = song(undefined, [{ section: "chorus", repeat: 2 }]);
    const view = tapeView({
      ...context({ score }),
      zoom: "bar",
      selected: 0,
      marks: () => "",
    });
    expect(view.cellBars).toEqual([4, 5, 6, 7, 4, 5, 6, 7, 0, 1, 2, 3]);
    expect(view.passes?.slice(-4)).toEqual([-1, -1, -1, -1]);
  });
});
