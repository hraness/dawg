import { describe, expect, test } from "bun:test";
import { arrangeStripCells, arrangeStripText } from "./arrange-strip.ts";

const view = {
  bars: 16,
  sections: [
    { name: "verse", startBar: 0, bars: 8 },
    { name: "chorus", startBar: 8, bars: 4 },
  ],
};

describe("arrangement strip", () => {
  test("blocks follow bars, names start each block, gaps are rules", () => {
    expect(arrangeStripText(view, 32)).toBe("▏verse          ▏chorus ────────");
  });

  test("the playhead is a caret over its bar", () => {
    const cells = arrangeStripCells({ ...view, playheadBar: 9 }, 16);
    const at = cells.findIndex((cell) => cell.playhead);
    expect(at).toBe(9);
    expect(cells[at]!.section).toBe(1);
    expect(arrangeStripText({ ...view, playheadBar: 9 }, 16)).toContain("▼");
  });

  test("short blocks truncate and ASCII terminals get plain glyphs", () => {
    const text = arrangeStripText(view, 8, false);
    expect(text).toHaveLength(8);
    expect(text).not.toMatch(/[▏─…]/u);
    expect(text.endsWith("--")).toBe(true);
  });

  test("a later marker wins where sections overlap", () => {
    const cells = arrangeStripCells(
      {
        bars: 8,
        sections: [
          { name: "A", startBar: 0, bars: 8 },
          { name: "B", startBar: 4, bars: 2 },
        ],
      },
      8,
    );
    expect(cells.map((cell) => cell.section)).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
  });
});
