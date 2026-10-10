/**
 * Large terminals (DAWG.md "Terminal sizes"): data views use the
 * space, text panels hold a reading measure with the song drawn beside
 * them, and nothing stretches a glyph past legibility.
 */
import { expect, test } from "bun:test";
import {
  SIDE_MIN_WIDTH,
  TEXT_MEASURE,
  TuiApp,
  panelRect,
  type AppView,
} from "../tui/app.ts";
import {
  ASIDE_MIN_WIDTH,
  DRAWER_MEASURE,
  asideWidth,
  drawerLayout,
  type DrawerView,
} from "../tui/drawer.ts";
import {
  MAX_LANE_WIDTH,
  MAX_PITCH_SPAN,
  MAX_ROWS_PER_BEAT,
  highwayLayout,
  pitchProjection,
  pitchSpanFor,
  type TrackScoreSnapshot,
} from "../tui/highway.ts";
import { KNOB_CELL_MAX, paintKnobStrip } from "../tui/knobs.ts";
import { CellBuffer } from "../tui/screen.ts";
import { getTheme } from "../tui/theme.ts";
import { VirtualTerminal } from "./vt.ts";

const score: TrackScoreSnapshot = {
  trackName: "bass",
  trackId: "bass",
  sessionId: "7f3a91c2-0000",
  revision: 3,
  bpm: 120,
  key: "Am",
  playing: false,
  loopBeats: 8,
  beatsPerBar: 4,
  notes: [
    { startBeat: 0, pitch: 45, velocity: 0.9, durationBeats: 0.5 },
    { startBeat: 2, pitch: 52, velocity: 0.8, durationBeats: 1.5 },
    { startBeat: 4, pitch: 45, velocity: 1, durationBeats: 2 },
  ],
};

function app(cols: number, rows: number) {
  const vt = new VirtualTerminal(cols, rows);
  const tui = new TuiApp({
    io: {
      write: (data: string) => vt.write(data),
      columns: () => cols,
      rows: () => rows,
    },
    capabilities: { colorDepth: "none", unicode: true },
    clock: () => 10_000,
  });
  const render = () => {
    tui.render(
      { score, beat: 0, model: "sol-6.1", sync: "synced" } as AppView,
      { force: true },
    );
    return vt.lines();
  };
  return { tui, vt, render };
}

test("a text panel holds a 100-column measure, left-aligned", () => {
  expect(panelRect(80)).toEqual({ left: 2, boxWidth: 76 });
  expect(panelRect(104)).toEqual({ left: 2, boxWidth: 100 });
  expect(panelRect(500)).toEqual({ left: 2, boxWidth: TEXT_MEASURE + 4 });
  // Below the minimum width the panel runs edge to edge.
  expect(panelRect(40)).toEqual({ left: 0, boxWidth: 40 });
});

test("help on a wide terminal: capped panel, the song beside it", () => {
  const { tui, render } = app(240, 50);
  tui.openText(
    "help",
    Array.from({ length: 80 }, (_, i) => `command ${i} · what it does`),
  );
  const lines = render();
  const top = lines.find((line) => line.includes("help"))!;
  const right = top.lastIndexOf("╮");
  expect(right).toBe(panelRect(240).left + panelRect(240).boxWidth - 1);
  // The highway draws in the free columns right of the panel.
  expect(240 - (right + 2)).toBeGreaterThanOrEqual(SIDE_MIN_WIDTH);
  expect(lines.some((line) => line.slice(right + 2).includes("─"))).toBe(true);
});

test("help on a terminal just past the measure: no sliver beside it", () => {
  const { tui, render } = app(120, 40);
  tui.openText("help", ["one", "two"]);
  const lines = render();
  const top = lines.find((line) => line.includes("help"))!;
  const right = top.lastIndexOf("╮");
  // 120 - 106 leaves under SIDE_MIN_WIDTH: the margin stays empty.
  for (const line of lines.slice(2, 20))
    expect(line.slice(right + 1).trim()).toBe("");
});

test("highway lanes stop growing and show more pitches instead", () => {
  expect(pitchSpanFor(80)).toBe(12);
  expect(pitchSpanFor(200)).toBe(19);
  expect(pitchSpanFor(500)).toBe(MAX_PITCH_SPAN);
  const projection = pitchProjection(score.notes, pitchSpanFor(500));
  const wide = highwayLayout(
    { x: 0, y: 0, width: 500, height: 120 },
    projection,
    undefined,
  );
  expect(wide.laneWidth).toBeLessThanOrEqual(MAX_LANE_WIDTH);
  // The unused width is split either side, so the lanes sit centred.
  const used = wide.laneWidth * projection.laneCount;
  expect(wide.laneLeft).toBe(wide.gutter + Math.floor((497 - used) / 2));
  expect(wide.laneLeft).toBeGreaterThan(wide.gutter);
});

test("a tall highway looks further ahead instead of stretching beats", () => {
  const projection = pitchProjection(score.notes, 12);
  const tall = highwayLayout(
    { x: 0, y: 0, width: 120, height: 140 },
    projection,
  );
  expect(tall.rowsPerBeat).toBeLessThan(MAX_ROWS_PER_BEAT + 1);
  // So the hit row sees more beats coming than a short highway does.
  const short = highwayLayout(
    { x: 0, y: 0, width: 120, height: 30 },
    projection,
  );
  expect(tall.hitRow / tall.rowsPerBeat).toBeGreaterThan(
    short.hitRow / short.rowsPerBeat,
  );
});

const knobs: DrawerView = {
  title: "≡ Mix",
  focus: 0,
  dirty: false,
  hint: "↑↓ knob · ←→ turn · tab all",
  fields: [
    {
      kind: "number",
      label: "volume",
      text: "0.0 dB",
      position: 1,
      minText: "0",
      maxText: "1",
      knob: 0,
    },
  ],
  aside: [
    { label: "volume", text: "0.0 dB", knob: 0 },
    { label: "pan", text: "center" },
    { label: "width", text: "1" },
  ],
};

test("a wide drawer lists every param beside the knobs", () => {
  expect(asideWidth(80)).toBe(0);
  expect(asideWidth(4 + DRAWER_MEASURE + 3 + ASIDE_MIN_WIDTH)).toBe(
    ASIDE_MIN_WIDTH,
  );
  expect(asideWidth(500)).toBe(48);
  const { tui, render } = app(200, 50);
  tui.drawer = knobs;
  const lines = render().join("\n");
  expect(lines).toContain("all params · tab");
  expect(lines).toContain("width");
  // The rows stop at the drawer measure, so the bar is not 190 wide.
  const bar = render().find((line) => line.includes("[+]"))!;
  expect(bar.indexOf("[+]")).toBeLessThanOrEqual(2 + DRAWER_MEASURE);
});

test("a narrow drawer keeps the list behind Tab", () => {
  const { tui, render } = app(100, 30);
  tui.drawer = knobs;
  expect(render().join("\n")).not.toContain("all params · tab");
  expect(drawerLayout(knobs, { y: 0, height: 20 }, 100).height).toBe(4);
});

test("the knob strip stops stretching its gauges", () => {
  const buffer = new CellBuffer(500, 1);
  const used = paintKnobStrip(
    buffer,
    0,
    0,
    500,
    [
      { label: "tempo", text: "120", position: 0.5, turn: () => undefined },
      { label: "volume", text: "0 dB", position: 1, turn: () => undefined },
      undefined,
      undefined,
    ],
    0,
    { theme: getTheme("default"), unicode: true },
  );
  expect(used).toBe(KNOB_CELL_MAX * 4);
  let row = "";
  for (let x = 0; x < 500; x += 1) row += buffer.get(x, 0)!.ch;
  expect(row.slice(KNOB_CELL_MAX * 4).trim()).toBe("");
});
