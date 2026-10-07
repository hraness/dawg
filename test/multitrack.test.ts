import { expect, test } from "bun:test";
import { CellBuffer } from "../tui/screen.ts";
import {
  MAX_LAYER_NOTES,
  paintHighway,
  type TrackScoreSnapshot,
} from "../tui/highway.ts";
import { highwayLayers } from "../tui/layers.ts";
import { effectiveTheme, type TerminalCapabilities } from "../tui/theme.ts";
import { TuiApp } from "../tui/app.ts";
import { drumSnapshotFields } from "../tui/drums.ts";

const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};
const theme = effectiveTheme("default", TRUECOLOR);

const tracks = [
  { id: "lead", name: "lead", instrument: "saw", muted: false },
  { id: "bass", name: "bass", instrument: "sine", muted: false },
  { id: "drums", name: "drums", instrument: "kit", muted: false },
  { id: "pad", name: "pad", instrument: "square", muted: true },
];
const notes = [
  {
    trackId: "lead",
    startTick: 480,
    durationTicks: 240,
    pitch: 72,
    velocity: 0.9,
  },
  {
    trackId: "bass",
    startTick: 960,
    durationTicks: 480,
    pitch: 48,
    velocity: 0.9,
  },
  {
    trackId: "drums",
    startTick: 0,
    durationTicks: 120,
    pitch: 36,
    velocity: 1,
  },
  {
    trackId: "drums",
    startTick: 1440,
    durationTicks: 120,
    pitch: 38,
    velocity: 1,
  },
  { trackId: "pad", startTick: 0, durationTicks: 1920, pitch: 60, velocity: 1 },
];

function leadSnapshot(view: "all" | "focus"): TrackScoreSnapshot {
  return {
    trackId: "lead",
    trackName: "lead",
    bpm: 120,
    beatsPerBar: 4,
    loopBeats: 8,
    playing: false,
    notes: [{ startBeat: 1, durationBeats: 0.5, pitch: 72, velocity: 0.9 }],
    layers:
      view === "all" ? highwayLayers(tracks, notes, 480, "lead") : undefined,
  };
}

function paint(score: TrackScoreSnapshot, beat = 0) {
  const buffer = new CellBuffer(80, 20, theme.roles.canvas);
  const layout = paintHighway(
    buffer,
    { x: 0, y: 0, width: 80, height: 20 },
    score,
    beat,
    { theme, capabilities: TRUECOLOR },
  );
  return { buffer, layout };
}

function noteCells(buffer: CellBuffer, hitRow: number) {
  const cells: { x: number; y: number; fg: string }[] = [];
  for (let y = 0; y < hitRow; y += 1)
    for (let x = 3; x < buffer.width; x += 1) {
      const cell = buffer.get(x, y)!;
      if (/[░▒▓█┃╻]/.test(cell.ch) && cell.style?.fg)
        cells.push({ x, y, fg: JSON.stringify(cell.style.fg) });
    }
  return cells;
}

test("layers skip the focused and muted tracks and follow solo", () => {
  const layers = highwayLayers(tracks, notes, 480, "lead");
  expect(layers.map((layer) => layer.trackId)).toEqual(["bass", "drums"]);
  const drums = layers.find((layer) => layer.trackId === "drums")!;
  expect(drums.projection?.kind).toBe("drum");
  expect(drums.notes.every((note) => note.lane !== undefined)).toBe(true);
  const soloed = highwayLayers(
    tracks.map((track) =>
      track.id === "drums" ? { ...track, solo: true } : track,
    ),
    notes,
    480,
    "lead",
  );
  expect(soloed.map((layer) => layer.trackId)).toEqual(["drums"]);
});

test("all view overlays other tracks in their own dimmed accents", () => {
  const focus = paint(leadSnapshot("focus"));
  const all = paint(leadSnapshot("all"));
  const focusCells = noteCells(focus.buffer, focus.layout.hitRow);
  const allCells = noteCells(all.buffer, all.layout.hitRow);
  expect(allCells.length).toBeGreaterThan(focusCells.length);
  const focusColors = new Set(focusCells.map((cell) => cell.fg));
  const extra = new Set(
    allCells.map((cell) => cell.fg).filter((fg) => !focusColors.has(fg)),
  );
  // Bass and drums each bring their own accent.
  expect(extra.size).toBeGreaterThanOrEqual(2);
  // Overlays are darker than the focused track's notes.
  const luminance = (fg: string) => {
    const { r, g, b } = JSON.parse(fg) as { r: number; g: number; b: number };
    return r + g + b;
  };
  const brightestFocus = Math.max(...[...focusColors].map(luminance));
  for (const fg of extra) expect(luminance(fg)).toBeLessThan(brightestFocus);
  // The focused lead is still drawn at full strength (the pitch axis widens
  // to fit the bass, so its column moves but its color does not).
  const allColors = new Set(allCells.map((cell) => cell.fg));
  for (const fg of focusColors) expect(allColors.has(fg)).toBe(true);
  // Melodic overlays share the pitch axis: the bass sits left of the lead.
  const bassAccent = [...extra];
  const leadX = Math.min(
    ...allCells
      .filter((cell) => focusColors.has(cell.fg))
      .map((cell) => cell.x),
  );
  expect(
    allCells.some((cell) => bassAccent.includes(cell.fg) && cell.x < leadX),
  ).toBe(true);
});

test("a drum focus keeps its voice lanes and legend with melodic overlays", () => {
  const drumNotes = [
    { startBeat: 0.5, pitch: 36, velocity: 1 },
    { startBeat: 1, pitch: 38, velocity: 1 },
  ];
  const score: TrackScoreSnapshot = {
    trackId: "drums",
    bpm: 120,
    loopBeats: 8,
    notes: drumNotes,
    ...drumSnapshotFields("kit", drumNotes),
    layers: highwayLayers(tracks, notes, 480, "drums"),
  };
  const { buffer, layout } = paint(score);
  expect(layout.laneCount).toBe(score.laneCount!);
  const legend = buffer.lines()[layout.legendRow!]!;
  for (const label of ["kick", "snare"]) expect(legend).toContain(label);
  expect(noteCells(buffer, layout.hitRow).length).toBeGreaterThan(0);
});

test("overlaid notes are bounded", () => {
  const many = Array.from({ length: MAX_LAYER_NOTES + 500 }, (_, index) => ({
    trackId: "bass",
    startTick: index,
    durationTicks: 1,
    pitch: 40,
    velocity: 0.5,
  }));
  const layers = highwayLayers(tracks, many, 480, "lead");
  const total = layers.reduce((sum, layer) => sum + layer.notes.length, 0);
  expect(total).toBe(MAX_LAYER_NOTES);
});

test("/view toggles focus and all", () => {
  const app = new TuiApp({
    io: { write: () => {}, columns: () => 80, rows: () => 24 },
    capabilities: TRUECOLOR,
  });
  expect(app.highwayView).toBe("all");
  expect(app.command("/view focus")).toContain("focus");
  expect(app.highwayView).toBe("focus");
  expect(app.command("/view")).toContain("all");
  expect(app.highwayView).toBe("all");
  expect(app.command("/view nope")).toContain("/view focus | all");
});
