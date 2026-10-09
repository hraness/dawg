import { describe, expect, test } from "bun:test";
import {
  paintChordLegend,
  paintPlayHeader,
  paintPlayStrip,
  playHeaderText,
  type PlayHeaderView,
} from "./play-strip.ts";
import { CellBuffer } from "./screen.ts";
import { displayWidth } from "./text.ts";
import { effectiveTheme } from "./theme.ts";

const theme = effectiveTheme("default", {
  colorDepth: "truecolor",
  unicode: true,
});

const keys = [
  { key: "a", label: "C3", black: false, lit: false },
  { key: "w", label: "C#3", black: true, lit: true },
  { key: "s", label: "D3", black: false, lit: true },
  { key: "e", label: "D#3", black: true, lit: false },
];

const view: PlayHeaderView = {
  range: "C3–F4",
  velocity: 100,
  armed: true,
  recording: true,
  replace: true,
  click: true,
  sustain: true,
  countIn: "count-in 3",
  beat: { index: 1, of: 4, flash: true },
  grid: "grid 1/16",
  chords: "AUTO C major",
  status: "octave C2 · more detail",
  keys,
};

function row(width: number, paint: (buffer: CellBuffer) => void): string {
  const buffer = new CellBuffer(width, 1, theme.roles.canvas);
  paint(buffer);
  return buffer.lines()[0]!;
}

describe("play header", () => {
  test("text lists every active part in order", () => {
    expect(playHeaderText(view)).toBe(
      "PLAY  C3–F4  ● REC replace  click  SUSTAIN  AUTO C major  count-in 3  octave C2 · more detail",
    );
    expect(
      playHeaderText({ ...view, recording: false, replace: false }, false),
    ).toContain("* rec armed");
    expect(
      playHeaderText({
        ...view,
        armed: false,
        click: false,
        sustain: false,
        chords: undefined,
        countIn: undefined,
        status: undefined,
      }),
    ).toBe("PLAY  C3–F4");
  });

  test("a wide row shows the beat, the whole status and the hint", () => {
    const text = row(160, (b) => paintPlayHeader(b, 0, 160, view, theme, true));
    expect(text).toContain(" PLAY ");
    expect(text).toContain("●···");
    expect(text).toContain("octave C2 · more detail");
    expect(text.trimEnd().endsWith("? keys · esc leave")).toBe(true);
  });

  test("status shrinks to its first clause, then disappears, never mid-word", () => {
    const quiet = {
      ...view,
      armed: false,
      click: false,
      sustain: false,
      chords: undefined,
      countIn: undefined,
      beat: undefined,
    };
    const mid = row(56, (b) => paintPlayHeader(b, 0, 56, quiet, theme, true));
    expect(mid).toContain("octave C2");
    expect(mid).not.toContain("more detail");
    const narrow = row(36, (b) =>
      paintPlayHeader(b, 0, 36, quiet, theme, true),
    );
    expect(narrow).not.toContain("octave");
  });

  test("ASCII terminals get plain beat glyphs and nothing overflows", () => {
    for (const width of [8, 20, 40, 72, 120]) {
      const text = row(width, (b) =>
        paintPlayHeader(
          b,
          0,
          width,
          { ...view, beat: { index: 3, of: 4, flash: false } },
          theme,
          false,
        ),
      );
      expect(displayWidth(text)).toBe(width);
      if (width >= 120) expect(text).toContain("..o.");
    }
  });
});

describe("play strip and chord legend", () => {
  test("keys print as KEY note until the row is full", () => {
    expect(
      row(40, (b) => paintPlayStrip(b, 0, 40, keys, theme)).trimEnd(),
    ).toBe(" A C3 W C#3 S D3 E D#3");
    expect(
      row(13, (b) => paintPlayStrip(b, 0, 13, keys, theme)).trimEnd(),
    ).toBe(" A C3 W C#3");
  });

  test("lit keys are reversed, unlit ones are not", () => {
    const buffer = new CellBuffer(40, 1, theme.roles.canvas);
    paintPlayStrip(buffer, 0, 40, keys, theme);
    expect(buffer.get(1, 0)!.style?.reverse).toBeFalsy();
    expect(buffer.get(6, 0)!.style?.reverse).toBe(true);
  });

  test("legend cells stop before the edge and latched ones are reversed", () => {
    const cells = [
      { key: "1", label: "dim", on: false },
      { key: "2", label: "min", on: true },
      { key: "9", label: "strum-up", on: false },
    ];
    const buffer = new CellBuffer(20, 1, theme.roles.canvas);
    paintChordLegend(buffer, 0, 20, cells, theme);
    expect(buffer.lines()[0]!.trimEnd()).toBe(" 1 dim  2 min");
    expect(buffer.get(3, 0)!.style?.reverse).toBeFalsy();
    expect(buffer.get(10, 0)!.style?.reverse).toBe(true);
  });
});
