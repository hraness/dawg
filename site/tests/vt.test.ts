/**
 * The hero replays public/demo/highway.cast through app/highway/vt.ts. This
 * test replays the same recording through the repo's own test terminal
 * (test/vt.ts, the one the TUI's frame tests assert against) and requires both
 * to show the same characters and styles on every frame.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { VirtualTerminal, type VtStyle } from "../../test/vt.ts";
import {
  frameAt,
  parseCast,
  Screen,
  type CellStyle,
} from "../app/highway/vt.ts";

const cast = parseCast(
  readFileSync(resolve(import.meta.dir, "../public/demo/highway.cast"), "utf8"),
);

function key(style: VtStyle | CellStyle): string {
  return [
    style.fg ?? "",
    style.bg ?? "",
    style.bold ? "b" : "",
    style.dim ? "d" : "",
    style.italic ? "i" : "",
    style.reverse ? "r" : "",
  ].join("|");
}

describe("highway cast", () => {
  test("is an 80x24 recording of a few hundred frames", () => {
    expect(cast.header).toMatchObject({ width: 80, height: 24 });
    expect(cast.frames.length).toBeGreaterThan(200);
    for (let i = 1; i < cast.frames.length; i += 1)
      expect(cast.frames[i]!.time).toBeGreaterThanOrEqual(
        cast.frames[i - 1]!.time,
      );
  });

  test("the player's terminal matches the repo's test terminal on every frame", () => {
    const ours = new Screen(80, 24);
    const theirs = new VirtualTerminal(80, 24);
    for (const [index, frame] of cast.frames.entries()) {
      ours.write(frame.data);
      theirs.write(frame.data);
      expect({ index, lines: ours.lines() }).toEqual({
        index,
        lines: theirs.lines(),
      });
      for (let y = 0; y < 24; y += 1)
        for (let x = 0; x < 80; x += 1) {
          const a = key(ours.cells[y]![x]!.style);
          const b = key(theirs.cell(x, y).style);
          if (a !== b)
            expect({ index, x, y, style: a }).toEqual({
              index,
              x,
              y,
              style: b,
            });
        }
    }
  });

  test("shows the agent writing parts onto the highway", () => {
    const screen = new Screen(80, 24);
    for (const frame of cast.frames) screen.write(frame.data);
    const text = screen.lines().join("\n");
    expect(text).toContain("✓ keys reverb 0.3");
    expect(text).toContain("opus-5.5 · gateway");
    expect(text).toMatch(/[▒▓█]/u);
  });

  test("frameAt finds the frame on screen at a time", () => {
    expect(frameAt(cast.frames, -1)).toBe(-1);
    expect(frameAt(cast.frames, 0)).toBe(0);
    expect(frameAt(cast.frames, 1e9)).toBe(cast.frames.length - 1);
  });
});
