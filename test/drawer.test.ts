/**
 * The fader drawer painted by the real frame composer: docked above the
 * prompt, the piano roll still visible above it, and click targets that
 * come from the same paint pass.
 */
import { expect, test } from "bun:test";
import { TuiApp, type AppView } from "../tui/app.ts";
import type { DrawerView } from "../tui/drawer.ts";
import type { TrackScoreSnapshot } from "../tui/highway.ts";
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

const filter: DrawerView = {
  title: "menu › Effects › Filter",
  focus: 1,
  dirty: true,
  status: "loop off · B staged 1",
  hint: "←→ adjust · ⇧←→ coarse · [ ] fine · ↑↓ param · 0-9 type · d default · enter keep · esc revert",
  fields: [
    {
      kind: "choice",
      label: "type",
      options: ["lpf", "hpf", "bpf"],
      index: 0,
    },
    {
      kind: "number",
      label: "cutoff",
      text: "1200 Hz",
      committed: "800 Hz",
      position: 0.62,
      committedPosition: 0.56,
      minText: "20 Hz",
      maxText: "20000 Hz",
    },
    {
      kind: "number",
      label: "resonance",
      text: "0.2",
      position: 0.2,
      minText: "0",
      maxText: "1",
    },
  ],
};

function paint(cols: number, rows: number, drawer: DrawerView | undefined) {
  const vt = new VirtualTerminal(cols, rows);
  const app = new TuiApp({
    io: {
      write: (data: string) => vt.write(data),
      columns: () => cols,
      rows: () => rows,
    },
    capabilities: { colorDepth: "none", unicode: true },
    clock: () => 10_000,
  });
  app.drawer = drawer;
  app.render({ score, beat: 0, model: "sol-6.1", sync: "synced" } as AppView, {
    force: true,
  });
  return { app, vt, lines: vt.lines() };
}

for (const [cols, rows] of [
  [80, 24],
  [120, 40],
] as const) {
  test(`${cols}×${rows}: the drawer docks above the prompt`, () => {
    const { app, lines } = paint(cols, rows, filter);
    const frame = app.frame!;
    const drawer = frame.drawer!;
    expect(drawer).toBeDefined();
    const prompt = lines.findIndex((line) => line.includes("STEER"));
    // Directly above the activity row and the prompt box.
    expect(drawer.top + drawer.height).toBeLessThanOrEqual(prompt);
    expect(drawer.top + drawer.height).toBeGreaterThanOrEqual(prompt - 2);
    // The piano roll keeps rows above it.
    expect(drawer.top).toBeGreaterThan(frame.layout.header + 2);
    const text = lines.join("\n");
    expect(text).toContain("cutoff");
    expect(text).toContain("1200 Hz ← 800 Hz");
    expect(text).toContain("20 Hz … 20000 Hz");
    expect(text).toContain("[−]");
    expect(text).toContain("[+]");
    expect(text).toContain("[keep] [revert]");
    expect(text).toContain("lpf");
    expect(
      lines.slice(drawer.top, drawer.top + drawer.height),
    ).toMatchSnapshot();
  });
}

test("many params collapse to one row per field, windowed on the focus", () => {
  const many: DrawerView = {
    ...filter,
    focus: 6,
    fields: [
      ...filter.fields,
      ...["attack", "decay", "sustain", "release"].map((label) => ({
        kind: "number" as const,
        label,
        text: "0.1",
        position: 0.1,
        minText: "0",
        maxText: "1",
      })),
    ],
  };
  // 3 fields fit with bars at 80×24 (half the roll stays above).
  expect(paint(80, 24, filter).app.frame!.drawer!.mode).toBe("full");
  const small = paint(80, 24, many);
  const drawer = small.app.frame!.drawer!;
  expect(drawer.mode).toBe("compact");
  // The focused field is in the window and the roll keeps rows above.
  expect(drawer.first + drawer.count).toBe(7);
  expect(small.lines.join("\n")).toContain("release");
  expect(drawer.top).toBeGreaterThan(small.app.frame!.layout.highway.y + 2);
  expect(paint(120, 40, many).app.frame!.drawer!.mode).toBe("full");
});

test("the 8-row minimum keeps a single borderless fader row", () => {
  const { app, lines } = paint(40, 8, filter);
  const drawer = app.frame!.drawer;
  expect(drawer?.mode).toBe("line");
  expect(lines[drawer!.top]).toContain("cutoff");
});

test("click targets come from the paint pass", () => {
  const { app, lines } = paint(120, 40, filter);
  const hits = app.frame!.hits;
  const find = (needle: string, from = 0) => {
    for (let y = from; y < lines.length; y += 1) {
      const x = lines[y]!.indexOf(needle);
      if (x >= 0) return { x, y };
    }
    throw new Error(`no ${needle}`);
  };
  const cutoff = find("cutoff");
  const minus = find("[−]", cutoff.y);
  expect(hits.at(minus.x + 1, minus.y)?.target).toEqual({
    kind: "fader-step",
    field: 1,
    direction: -1,
  });
  const plus = find("[+]", cutoff.y);
  expect(hits.at(plus.x + 1, plus.y)?.target).toMatchObject({
    kind: "fader-step",
    direction: 1,
  });
  const bar = hits.at(minus.x + 10, minus.y)?.target;
  expect(bar).toMatchObject({ kind: "fader-bar", field: 1 });
  const hpf = find("hpf");
  expect(hits.at(hpf.x, hpf.y)?.target).toEqual({
    kind: "fader-option",
    field: 0,
    option: 1,
  });
  const keep = find("[keep]");
  expect(hits.at(keep.x + 2, keep.y)?.target).toEqual({ kind: "fader-keep" });
  const revert = find("[revert]");
  expect(hits.at(revert.x + 2, revert.y)?.target).toEqual({
    kind: "fader-revert",
  });
  // Above the drawer the piano roll is the target.
  expect(hits.at(10, app.frame!.drawer!.top - 1)?.target).toEqual({
    kind: "highway",
  });
});

test("header pills are click targets", () => {
  const { app, lines } = paint(120, 40, undefined);
  const hits = app.frame!.hits;
  const bpm = lines[0]!.indexOf("120 BPM");
  expect(hits.at(bpm, 0)?.target).toEqual({ kind: "transport" });
  const model = lines[0]!.indexOf("sol-6.1");
  expect(hits.at(model, 0)?.target).toEqual({ kind: "model" });
});
