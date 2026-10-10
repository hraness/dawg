/**
 * The TAPE painter (op1-ux §8.3): ruler with playhead and loop brackets,
 * sections, one row per track, the pane gutter marks and the footer, at
 * 80 columns and wider, and every cue kept under mono and ASCII.
 */
import { describe, expect, test } from "bun:test";
import { HitMap } from "./hits.ts";
import type { KnobSlot, KnobSlots } from "./knobs.ts";
import { CellBuffer } from "./screen.ts";
import { paintTape, tapeFirstCell, type TapeView } from "./tape.ts";
import { getTheme } from "./theme.ts";

function slot(label: string): KnobSlot {
  return { label, text: "1", position: 0.5, turn: () => undefined };
}
const knobs: KnobSlots = [
  slot("playhead"),
  slot("loop"),
  slot("tempo"),
  slot("volume"),
];

function view(cells = 16, extra: Partial<TapeView> = {}): TapeView {
  const bars = Math.ceil(cells / 2);
  return {
    bars,
    cellBars: Array.from({ length: cells }, (_, i) => Math.floor(i / 2)),
    playheadCell: 2,
    loop: { startBar: 2, bars: 2 },
    sections: [
      { name: "build", startBar: 0, bars: Math.floor(bars / 2) },
      {
        name: "drop",
        startBar: Math.floor(bars / 2),
        bars: bars - Math.floor(bars / 2),
      },
    ],
    tempo: [],
    rows: [
      {
        id: "drums",
        name: "drums",
        muted: false,
        levels: Array(cells).fill(8),
        marks: "C●",
      },
      {
        id: "bass",
        name: "bass",
        muted: false,
        levels: Array(cells).fill(2),
        marks: "B",
      },
      {
        id: "pad",
        name: "pad",
        muted: true,
        levels: Array(cells).fill(0),
        marks: "",
      },
    ],
    focused: 1,
    range: "range: bass · bars 3–4 (loop)",
    clipboard: "clipboard: bass · 2 bars",
    knobs,
    selected: 0,
    hint: "c copy · x cut · v paste · \\ loop · ? keys",
    ...extra,
  };
}

function paint(
  width: number,
  height: number,
  value: TapeView,
  options: { theme?: "default" | "mono"; unicode?: boolean } = {},
) {
  const buffer = new CellBuffer(width, height);
  const hits = new HitMap();
  const layout = paintTape(buffer, { x: 0, y: 0, width, height }, value, {
    theme: getTheme(options.theme ?? "default"),
    unicode: options.unicode ?? true,
    hits,
  });
  return { buffer, hits, layout, lines: buffer.lines() };
}

describe("paintTape", () => {
  for (const width of [80, 120, 160]) {
    test(`ruler, loop, rows and footer fit at ${width} columns`, () => {
      const { lines, layout } = paint(width, 16, view(16));
      expect(lines[0]).toContain("▼");
      expect(lines[0]).toContain("[");
      expect(lines[0]).toContain("]");
      expect(lines[1]).toContain("build");
      expect(lines[1]).toContain("drop");
      const rows = lines.slice(layout.rowsY, layout.rowsY + 3);
      expect(rows[0]).toContain("drums");
      expect(rows[0]).toContain("C●");
      expect(rows[1]).toContain("›bass");
      expect(rows[1]).toContain(" B");
      expect(lines.some((line) => line.includes("range: bass"))).toBe(true);
      expect(lines.some((line) => line.includes("clipboard: bass"))).toBe(true);
      expect(lines.at(-1)).toContain("c copy");
      for (const line of lines) expect(line.length).toBe(width);
    });
  }

  test("the playhead on a loop bracket keeps it, reversed", () => {
    const { buffer, layout, lines } = paint(
      80,
      16,
      view(16, { playheadCell: 4 }),
    );
    expect(lines[0]).toContain("[");
    expect(lines[0]).not.toContain("▼");
    const at = lines[0]!.indexOf("[");
    expect(buffer.get(at, layout.rulerY)!.style?.reverse).toBe(true);
    // An empty cell draws the column; a note under it is reversed.
    expect(lines[layout.rowsY + 2]![at]).toBe("│");
    expect(buffer.get(at, layout.rowsY)!.style?.reverse).toBe(true);
  });

  test("a long song pages so the playhead stays in view", () => {
    const long = view(200, { playheadCell: 150 });
    const first = tapeFirstCell(long, 60);
    expect(first).toBeLessThanOrEqual(150);
    expect(first + 60).toBeGreaterThan(150);
    const { lines, layout } = paint(80, 16, long);
    expect(layout.firstCell).toBeGreaterThan(0);
    expect(lines[0]).toContain("▼");
  });

  test("mono keeps every glyph; ASCII spells them", () => {
    const mono = paint(80, 16, view(), { theme: "mono" });
    expect(mono.lines[0]).toContain("▼");
    expect(mono.lines.join("\n")).toContain("C●");
    const ascii = paint(80, 16, view(), { unicode: false });
    const text = ascii.lines.join("\n");
    expect(text).toContain("v");
    expect(text).toContain(">bass");
    expect(text).toContain("C*");
    expect(text).not.toMatch(/[▼▀›●█▁]/);
  });

  test("hits: the ruler, each row and the clipboard chip", () => {
    const { hits, layout } = paint(80, 16, view());
    expect(hits.at(20, layout.rulerY)?.target).toMatchObject({
      kind: "tape-ruler",
    });
    expect(hits.at(20, layout.rowsY + 1)?.target).toMatchObject({
      kind: "tape-row",
      row: 1,
    });
  });

  test("a short pane still draws the ruler and the focused row", () => {
    const { lines } = paint(80, 6, view());
    expect(lines[0]).toContain("▼");
    expect(lines.join("\n")).toContain("bass");
  });

  for (const count of [7, 12])
    test(`${count} tracks at 80x24: the focused row stays on screen`, () => {
      const rows = Array.from({ length: count }, (_, i) => ({
        id: `t${i + 1}`,
        name: `t${i + 1}`,
        muted: false,
        levels: Array(16).fill(i % 9),
        marks: "",
      }));
      const focused = count - 1;
      const { lines, layout } = paint(80, 24, view(16, { rows, focused }));
      const text = lines.join("\n");
      expect(text).toContain(`›t${count}`);
      expect(layout.rowCount).toBeLessThanOrEqual(count);
      // Past 9 the number key column is blank (1-9 pick tracks).
      if (count > 9) expect(text).toMatch(/^ {2}›t12/m);
      else expect(text).toContain(" 7›t7");
    });

  test("an unrolled form ghosts its repeats `░`, ASCII `~`, mono too", () => {
    // verse (bars 0-1) then chorus (bars 2-3) twice: the second pass ghosts.
    const per = (bars: number[]) => bars.flatMap((bar) => [bar, bar, bar, bar]);
    const cellBars = per([0, 1, 2, 3, 2, 3]);
    const unrolled = view(24, {
      bars: 4,
      cellBars,
      playheadCell: 23,
      loop: undefined,
      sections: [
        { name: "verse", startBar: 0, bars: 2 },
        { name: "chorus ×2", startBar: 2, bars: 2 },
      ],
      ghosts: [...Array(16).fill(false), ...Array(8).fill(true)],
      passes: [...Array(8).fill(0), ...Array(8).fill(1), ...Array(8).fill(2)],
      passNames: ["verse", "chorus ×2", "chorus ×2"],
      rows: [
        {
          id: "a",
          name: "a",
          muted: false,
          levels: Array(24).fill(5),
          marks: "",
        },
      ],
      focused: 0,
    });
    for (const theme of ["default", "mono"] as const) {
      const { lines, layout } = paint(80, 12, unrolled, { theme });
      const row = lines[layout.rowsY]!.slice(9, 33);
      expect(row.slice(0, 16)).toBe("▅".repeat(16));
      expect(row.slice(16, 23)).toBe("░".repeat(7));
      const sect = lines[1]!.slice(9, 33);
      expect(sect.startsWith("verse")).toBe(true);
      expect(sect.slice(8)).toStartWith("chorus");
      // The ghost pass keeps a leading `░`, then its label, then `░`s.
      expect(sect.slice(16)).toBe("░chorus ×2".slice(0, 8));
    }
    const ascii = paint(80, 12, unrolled, { unicode: false });
    expect(ascii.lines[ascii.layout.rowsY]!.slice(25, 32)).toBe("~".repeat(7));
    expect(ascii.lines.join("\n")).not.toMatch(/[░▀▅]/);
  });
});

describe("TAPE delight (op1-ux §9.1, §9.3)", () => {
  test("the reel sits in the ruler gutter", () => {
    const { lines } = paint(80, 16, view(16, { reel: "◓" }));
    expect(lines[0]!.slice(0, 9)).toContain("◓");
    expect(lines[0]!.slice(0, 9)).toContain("bar");
  });

  test("a loop flash changes shape, not only colour (mono too)", () => {
    // Four cells a bar, so the loop's fill shows between its bar numbers.
    const wide = (extra: Partial<TapeView>) =>
      view(32, {
        cellBars: Array.from({ length: 32 }, (_, i) => Math.floor(i / 4)),
        bars: 8,
        rows: view(32).rows.map((row) => ({
          ...row,
          levels: Array(32).fill(2),
        })),
        ...extra,
      });
    for (const theme of ["default", "mono"] as const) {
      const still = paint(80, 16, wide({ playheadCell: 0 }), { theme });
      const flash = paint(80, 16, wide({ playheadCell: 0, loopFlash: true }), {
        theme,
      });
      expect(still.lines[0]).toContain("═");
      expect(still.lines[0]).not.toContain("━");
      expect(flash.lines[0]).toContain("━");
      const at = flash.lines[0]!.indexOf("[");
      expect(flash.buffer.get(at, 0)!.style?.reverse).toBe(true);
      expect(still.buffer.get(at, 0)!.style?.reverse).toBeFalsy();
    }
    const ascii = paint(80, 16, wide({ playheadCell: 0, loopFlash: true }), {
      unicode: false,
    });
    expect(ascii.lines[0]).toContain("#");
    expect(ascii.lines[0]).not.toMatch(/[━═]/);
  });
});
