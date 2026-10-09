import { expect, test } from "bun:test";
import { CellBuffer } from "./screen.ts";
import {
  paintHighway,
  tracePointAt,
  type PitchTracePoint,
  type TrackScoreSnapshot,
} from "./highway.ts";
import { effectiveTheme, type TerminalCapabilities } from "./theme.ts";

const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};
const theme = effectiveTheme("default", TRUECOLOR);

function paint(score: TrackScoreSnapshot, lookaheadBeats = 8) {
  const buffer = new CellBuffer(60, 30, theme.roles.canvas);
  const layout = paintHighway(
    buffer,
    { x: 0, y: 0, width: 60, height: 30 },
    score,
    0,
    { theme, capabilities: TRUECOLOR, lookaheadBeats },
  );
  const dots: { x: number; y: number; warn: boolean }[] = [];
  for (let y = 0; y < layout.hitRow; y += 1)
    for (let x = layout.gutter; x < 60; x += 1) {
      const cell = buffer.get(x, y)!;
      if (cell.ch === "·")
        dots.push({
          x,
          y,
          warn: cell.style?.fg === theme.roles.warning.fg,
        });
    }
  return { dots, layout };
}

// A held A4 a beat long at 2..3, sung 30 cents sharp from beat 4.
const trace: PitchTracePoint[] = [];
for (let b = 2; b < 6; b += 1 / 32)
  trace.push({ beat: b, pitch: b < 4 ? 69 : 69.3 });
const base: TrackScoreSnapshot = {
  notes: [{ startBeat: 2, durationBeats: 1, pitch: 69 }],
  loopBeats: 16,
};

test("tracePointAt finds the nearest point within half a row", () => {
  expect(tracePointAt(trace, 2.01, 0.05)?.beat).toBe(2);
  expect(tracePointAt(trace, 1.5, 0.1)).toBeUndefined();
  expect(tracePointAt(trace, 7, 0.1)).toBeUndefined();
});

test("the trace draws a dot line, warning only where it is off pitch", () => {
  const without = paint(base);
  const { dots } = paint({ ...base, pitchTrace: trace });
  // the plain highway already has muted rule dots; the trace adds its own
  const added = dots.filter(
    (dot) => !without.dots.some((d) => d.x === dot.x && d.y === dot.y),
  );
  expect(added.length).toBeGreaterThan(5);
  const warn = added.filter((dot) => dot.warn);
  expect(warn.length).toBeGreaterThan(3);
  // the sharp dots sit right of the in-tune ones in the same lane
  const inTune = added.filter((dot) => !dot.warn).map((dot) => dot.x);
  expect(Math.min(...warn.map((dot) => dot.x))).toBeGreaterThan(
    Math.max(...inTune) - 1,
  );
  // later beats are higher up the highway
  expect(Math.max(...warn.map((d) => d.y))).toBeLessThan(
    Math.min(...added.filter((d) => !d.warn).map((d) => d.y)) + 1,
  );
});

test("rows wider than a beat hide the trace", () => {
  const wide = paint({ ...base, pitchTrace: trace }, 64);
  const plain = paint(base, 64);
  expect(wide.dots).toEqual(plain.dots);
});
