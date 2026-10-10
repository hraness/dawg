import { expect, test } from "bun:test";
import { ActivityFeed } from "../tui/activity.ts";
import {
  composeFrame,
  frameText,
  loudnessMeter,
  loudnessOffTarget,
  isTooSmall,
  MIN_HEIGHT,
  MIN_WIDTH,
  promptRowCap,
  tooSmallKey,
  tooSmallLines,
  TuiApp,
  type AppView,
  type TerminalIO,
} from "../tui/app.ts";
import { hitPhase, type TrackScoreSnapshot } from "../tui/highway.ts";
import { drumSnapshotFields } from "../tui/drums.ts";
import type { TerminalCapabilities } from "../tui/theme.ts";
import { VirtualTerminal } from "./vt.ts";

const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};
const MONO: TerminalCapabilities = { colorDepth: "none", unicode: true };
const DUMB: TerminalCapabilities = {
  colorDepth: "none",
  unicode: false,
  attributes: false,
};

const score: TrackScoreSnapshot = {
  trackName: "bass",
  trackId: "bass",
  sessionId: "7f3a91c2-0000",
  revision: 42,
  bpm: 120,
  key: "Am",
  playing: true,
  loopBeats: 8,
  beatsPerBar: 4,
  notes: [
    { startBeat: 0, pitch: 45, velocity: 0.9, durationBeats: 0.5 },
    { startBeat: 1, pitch: 48, velocity: 0.6, durationBeats: 0.25 },
    { startBeat: 2, pitch: 52, velocity: 0.8, durationBeats: 1.5 },
    { startBeat: 3.5, pitch: 57, velocity: 0.3, durationBeats: 0.25 },
    { startBeat: 4, pitch: 45, velocity: 1, durationBeats: 2 },
    { startBeat: 6, pitch: 55, velocity: 0.5, durationBeats: 0.5 },
  ],
};

interface Harness {
  app: TuiApp;
  vt: VirtualTerminal;
  io: TerminalIO & { size(cols: number, rows: number): void };
  setTime(ms: number): void;
  frame(beat: number, view?: Partial<AppView>): string;
  type(text: string): void;
}

function harness(
  cols: number,
  rows: number,
  capabilities: TerminalCapabilities = TRUECOLOR,
  reducedMotion = false,
): Harness {
  let now = 10_000;
  let size = { cols, rows };
  const vt = new VirtualTerminal(cols, rows);
  const io = {
    write: (data: string) => vt.write(data),
    columns: () => size.cols,
    rows: () => size.rows,
    size(c: number, r: number) {
      size = { cols: c, rows: r };
      vt.resize(c, r);
    },
  };
  const app = new TuiApp({
    io,
    capabilities,
    clock: () => now,
    reducedMotion,
  });
  return {
    app,
    vt,
    io,
    setTime: (ms) => {
      now = ms;
    },
    frame(beat, view = {}) {
      now += 50;
      return app.render(
        { score, beat, model: "sol-6.1", sync: "synced", ...view },
        { force: true },
      );
    },
    type(text) {
      for (const ch of Array.from(text)) app.input(ch);
    },
  };
}

function promptBox(vt: VirtualTerminal): { top: number; bottom: number } {
  const lines = vt.lines();
  const top = lines.findIndex((line) => /^[╭+]─?.*(NOW|NEXT)/.test(line));
  let bottom = lines.length - 1;
  return { top, bottom };
}

for (const cols of [60, 80, 120]) {
  test(`${cols} cols: header, highway, activity, prompt fill the screen`, () => {
    const h = harness(cols, 24);
    h.app.activity.pushCard("+8 bass notes", {
      tone: "success",
      baseRevision: 41,
      resultRevision: 42,
      hint: "ctrl-z undo",
    });
    h.frame(1.02);
    const lines = h.vt.lines();
    expect(lines[0]).toContain("bass");
    expect(lines[0]).toContain("120 BPM");
    expect(lines[0]).toContain("rev 42");
    expect(lines.some((line) => line.includes("+8 bass notes"))).toBe(true);
    if (cols >= 80)
      expect(
        lines.some((line) => line.includes("rev 41→42 · ctrl-z undo")),
      ).toBe(true);
    const { top } = promptBox(h.vt);
    expect(top).toBeGreaterThan(5);
    expect(lines[top]).toContain(" NOW ");
    // Every row is exactly `cols` cells wide: nothing overflows.
    expect(h.vt.cells.every((row) => row.length === cols)).toBe(true);
    // The prompt panel has a solid background across its full width.
    const bg = h.vt.cell(Math.floor(cols / 2), top + 1).style.bg;
    expect(bg).toMatch(/^rgb\(/);
    for (let x = 0; x < cols; x += 1)
      expect(h.vt.cell(x, top + 1).style.bg).toBe(bg);
  });
}

test("prompt wraps, grows 1→N rows, caps at 30% of the viewport, then scrolls", () => {
  const h = harness(60, 30);
  h.frame(0);
  const before = promptBox(h.vt).top;
  h.type(
    "one two three four five six seven eight nine ten eleven twelve thirteen",
  );
  h.frame(0);
  const grown = promptBox(h.vt).top;
  expect(grown).toBeLessThan(before);
  expect(h.app.frame!.promptRows).toBe(2);
  const lines = h.vt.lines();
  expect(lines[grown + 1]).toContain("› one two three");
  expect(lines[grown + 2]).toContain("thirteen");
  // Explicit newlines grow the panel until the cap.
  for (let i = 0; i < 12; i += 1) {
    h.app.input("\u001b[13;2u");
    h.type(`line ${i}`);
  }
  h.frame(0);
  expect(h.app.frame!.promptRows).toBe(promptRowCap(30));
  expect(promptRowCap(30)).toBe(8);
  const capped = h.vt.lines();
  // The cursor line stays visible and a scroll marker shows hidden rows.
  expect(capped.some((line) => line.includes("line 11"))).toBe(true);
  expect(capped.some((line) => line.includes("↑"))).toBe(true);
  expect(capped.join("\n")).toMatch(/\d+\/\d+/);
  // A short viewport caps lower (30% of 16 rows → 4).
  h.io.size(60, 16);
  h.app.invalidate();
  h.frame(0);
  expect(h.app.frame!.promptRows).toBe(4);
});

test("hit flash, burst, sustain beam, and ghost frames come from the beat", () => {
  expect(hitPhase(4, 6, 3.9, 120)).toBe("approach");
  expect(hitPhase(4, 6, 4.05, 120)).toBe("flash");
  expect(hitPhase(4, 6, 4.25, 120)).toBe("burst");
  expect(hitPhase(4, 6, 5, 120)).toBe("sustain");
  expect(hitPhase(4, 6, 6.2, 120)).toBe("ghost");
  expect(hitPhase(4, 6, 7, 120)).toBe("past");

  const h = harness(80, 24, MONO);
  h.frame(4.02);
  const flash = h.vt.lines();
  const hitRow = flash.findIndex((line) => line.startsWith(" ▶"));
  expect(hitRow).toBeGreaterThan(0);
  expect(flash[hitRow]).toContain("████");
  expect(flash[hitRow - 1]).toContain("✸");
  expect(flash[hitRow]).toContain("✦");

  h.frame(5);
  const sustain = h.vt.lines();
  expect(sustain[hitRow]).not.toContain("✸");
  // The beam continues above the hit line while the note sounds.
  expect(sustain.slice(1, hitRow).some((line) => line.includes("┃"))).toBe(
    true,
  );

  h.frame(6.2);
  const ghost = h.vt.lines();
  expect(ghost.slice(hitRow + 1).some((line) => line.includes("╎"))).toBe(true);
});

test("reduced motion keeps identical positions with static states", () => {
  const live = harness(80, 24, MONO);
  const calm = harness(80, 24, MONO, true);
  live.frame(4.02);
  calm.frame(4.02);
  const a = live.vt.lines();
  const b = calm.vt.lines();
  expect(b.length).toBe(a.length);
  const hitRow = a.findIndex((line) => line.startsWith(" ▶"));
  expect(b[hitRow]!.startsWith(" ▶")).toBe(true);
  expect(b[hitRow - 1]).not.toContain("✸");
  // Spinner is static in reduced motion.
  calm.app.activity.setSpinner("thinking");
  calm.frame(4.02);
  const first = calm.vt.text();
  calm.setTime(99_999);
  calm.frame(4.02);
  expect(calm.vt.text()).toBe(first);
});

test("mono and NO_COLOR/TERM=dumb fallbacks keep the same positions", () => {
  const color = harness(80, 24, TRUECOLOR);
  const mono = harness(80, 24, MONO);
  const dumb = harness(80, 24, DUMB);
  for (const h of [color, mono, dumb]) {
    h.type("make it swing");
    h.frame(2.5);
  }
  const shape = (lines: string[]) =>
    lines.map((line) => line.replace(/[^\s]/g, "x"));
  expect(shape(mono.vt.lines())).toEqual(shape(color.vt.lines()));
  // ASCII fallback: same layout, same occupied cells.
  expect(shape(dumb.vt.lines())).toEqual(shape(color.vt.lines()));
  expect(dumb.vt.text()).not.toMatch(/[╭│━┃]/);
  expect(dumb.vt.text()).toContain("+- NOW -");
  // No colors at all in mono; prompt is marked by attributes or glyphs.
  expect(
    mono.vt.cells.flat().every((cell) => !cell.style.fg && !cell.style.bg),
  ).toBe(true);
  expect(
    dumb.vt.cells.flat().every((cell) => Object.keys(cell.style).length === 0),
  ).toBe(true);
});

test("resize collapses the header, preserves the draft, and hints when too small", () => {
  const h = harness(120, 24);
  h.type("keep this draft across resizes please");
  h.frame(1);
  // The session id lives in the footer (design §13); the header has bar.beat.
  expect(h.vt.text()).toContain("session 7f3a91c2");
  expect(h.vt.lines()[0]).toMatch(/120 BPM · \d+\.\d/);
  h.io.size(60, 24);
  h.frame(1);
  const narrow = h.vt.lines();
  expect(narrow[0]).not.toContain("session");
  expect(narrow[0]).toContain("bass");
  expect(narrow[0]).toContain("rev 42");
  expect(narrow.join("\n")).toContain("keep this draft");
  h.io.size(20, 6);
  h.frame(1);
  expect(h.vt.text()).toContain("too small");
  h.io.size(80, 24);
  h.frame(1);
  expect(h.vt.text()).toContain("keep this draft across resizes please");
  expect(h.app.prompt.value).toBe("keep this draft across resizes please");
});

test("differential output rewrites only changed rows", () => {
  const h = harness(80, 24);
  const first = h.frame(1);
  expect(first).toContain("\u001b[2J");
  const idle = h.app.render(
    {
      score: { ...score, playing: false },
      beat: 1,
      model: "sol-6.1",
      sync: "synced",
    },
    { force: true },
  );
  void idle;
  const steady = h.app.render(
    {
      score: { ...score, playing: false },
      beat: 1,
      model: "sol-6.1",
      sync: "synced",
    },
    { force: true },
  );
  expect(steady).toBe("");
  h.type("a");
  h.app.render(
    {
      score: { ...score, playing: false },
      beat: 1,
      model: "sol-6.1",
      sync: "synced",
    },
    { force: true },
  );
  expect(h.app["writer"].lastRows).toBeLessThanOrEqual(3);
});

test("frame cap throttles renders to ~30 fps", () => {
  const h = harness(80, 24);
  h.setTime(0);
  expect(h.app.render({ score, beat: 0 })).not.toBe("");
  h.setTime(10);
  expect(h.app.render({ score, beat: 0.1 })).toBe("");
  h.setTime(40);
  expect(h.app.render({ score, beat: 0.2 })).not.toBe("");
});

test("keyboard replay: typing, Shift+Enter, paste, Ctrl+Q, undo, overlay, quit", () => {
  const h = harness(80, 24);
  h.type("add bass");
  expect(h.app.input("\u001b[13;2u").type).toBe("action");
  h.type("then drums");
  expect(h.app.prompt.value).toBe("add bass\nthen drums");
  const paste = h.app.input({ type: "paste", text: " and\nmore" });
  expect(paste.type).toBe("action");
  expect(h.app.prompt.value).toBe("add bass\nthen drums and\nmore");
  const toggle = h.app.input("\u0011");
  expect(toggle.type).toBe("action");
  expect(h.app.prompt.snapshot.mode).toBe("queue");
  h.frame(0);
  expect(h.vt.text()).toContain(" NEXT ");
  const submit = h.app.input("\r");
  expect(submit).toMatchObject({ type: "action", action: { kind: "queue" } });
  expect(h.app.input("\u001a")).toEqual({ type: "ui", command: "undo" });
  expect(h.app.input("\u0019")).toEqual({ type: "ui", command: "redo" });
  expect(h.app.input("\u000f")).toEqual({ type: "ui", command: "toggle-log" });
  h.app.activity.pushRequest("add bass");
  h.app.activity.pushError("tempo error · bpm must be 20..300");
  h.frame(0);
  expect(h.vt.text()).toContain("transcript");
  expect(h.vt.text()).toContain("ERR tempo error");
  h.app.input("\u001b");
  h.frame(0);
  expect(h.vt.text()).not.toContain("transcript ·");
  // Ordinary q types; Ctrl+C quits.
  h.app.input("q");
  expect(h.app.prompt.value).toContain("q");
  expect(h.app.input("\u0003")).toEqual({ type: "ui", command: "quit" });
});

test("errors render in the error role with a text marker", () => {
  const h = harness(80, 24);
  h.app.activity.pushError("agent error: gateway timeout");
  h.frame(0);
  const row = h.vt.findRow("agent error");
  expect(row).toBeGreaterThan(0);
  expect(h.vt.lines()[row]).toContain("✗ agent error");
  const x = h.vt.lines()[row]!.indexOf("agent");
  expect(h.vt.cell(x, row).style.fg).toMatch(/^rgb\(255/);
});

test("agent streaming events drive spinner, cards, and transcript", () => {
  const feed = new ActivityFeed({ clock: () => 0 });
  feed.applyAgentEvent({
    type: "start",
    prompt: "busier bass",
    model: "sol-6.1",
  });
  expect(feed.spinner?.label).toContain("sol-6.1");
  feed.applyAgentEvent({ type: "text-delta", text: "adding eighth notes" });
  expect(feed.streaming).toContain("eighth");
  feed.applyAgentEvent({
    type: "tool-applied",
    summary: "+8 bass notes",
    baseRevision: 41,
    resultRevision: 42,
    trackId: "bass",
  });
  feed.applyAgentEvent({ type: "tool-rejected", reason: "pitch out of range" });
  feed.applyAgentEvent({ type: "done" });
  expect(feed.spinner).toBeUndefined();
  const texts = feed.cards.map((card) => card.text);
  expect(texts).toContain("+8 bass notes");
  expect(feed.cards.some((card) => card.tone === "warning")).toBe(true);
  expect(feed.transcript.map((entry) => entry.kind)).toContain("op");
});

test("theme and motion commands switch rendering", () => {
  const h = harness(80, 24);
  expect(h.app.command("/theme high-contrast")).toBe("theme high-contrast");
  h.frame(0);
  expect(h.app.command("/theme mono")).toBe("theme mono");
  h.frame(0);
  expect(h.vt.cells.flat().every((cell) => !cell.style.fg)).toBe(true);
  expect(h.app.command("/theme nope")).toContain("unknown theme");
  expect(h.app.command("/motion off")).toBe("motion off");
  expect(h.app.reducedMotion).toBe(true);
  expect(h.app.command("/log")).toContain("transcript open");
  expect(h.app.command("tempo 90")).toBeUndefined();
});

test("drum tracks project one lane per voice with a legend", () => {
  const notes = [
    { startBeat: 0, pitch: 36, velocity: 1 },
    { startBeat: 1, pitch: 38, velocity: 0.8 },
    { startBeat: 0.5, pitch: 42, velocity: 0.5 },
  ];
  const drums: TrackScoreSnapshot = {
    ...score,
    trackName: "drums",
    trackId: "drums",
    notes,
    ...drumSnapshotFields("kit", notes),
  };
  const h = harness(80, 24, MONO);
  h.app.render({ score: drums, beat: 0.6 }, { force: true });
  const text = h.vt.text();
  for (const label of ["kick", "snare", "hat"]) expect(text).toContain(label);
});

test("composeFrame is deterministic for a fixed clock", () => {
  const ui = harness(80, 24).app.ui;
  const a = frameText(
    composeFrame({ score, beat: 3 }, ui, { width: 80, height: 24 }, 5),
  );
  const b = frameText(
    composeFrame({ score, beat: 3 }, ui, { width: 80, height: 24 }, 5),
  );
  expect(a).toBe(b);
});

test("header order is dawg · transport · bar.beat · loop · track ··· key · model · rev · pane · sync", () => {
  const h = harness(120, 24);
  h.frame(0, {
    sessionName: "night drive",
    windows: 3,
    pane: "B",
    sync: "synced",
    score: { ...score, loopRange: { startBar: 4, bars: 2 } },
  });
  const line = h.vt.lines()[0]!;
  const order = [
    "dawg",
    "▶ 120 BPM",
    "1.1",
    "↻ 5–6",
    "bass",
    "Am",
    "sol-6.1",
    "rev 42",
    "B ⧉3",
    "synced",
  ];
  const positions = order.map((segment) => line.indexOf(segment));
  expect(
    positions.every((position) => position >= 0),
    line,
  ).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  // The session name is in the footer now, not the header (design §13).
  expect(line).not.toContain("night drive");
  expect(h.vt.text()).toContain("night drive");
  // One window hides the count; a short id stands in for a missing name.
  h.frame(0, { sessionName: undefined, windows: 1 });
  expect(h.vt.lines()[0]).not.toContain("⧉");
  expect(h.vt.text()).toContain("session 7f3a91c2");
});

test("an empty track shows a start hint instead of lane and bar labels", () => {
  const h = harness(80, 24, MONO);
  const empty: TrackScoreSnapshot = { ...score, trackName: "main", notes: [] };
  h.app.render({ score: empty, beat: 0 }, { force: true });
  const text = h.vt.text();
  // Playing: the line says how to stop (tui/hints.ts).
  expect(text).toContain("main · empty · space stop · type a request");
  const hintAt = (lines: string[]) =>
    lines.findIndex((line) => line.includes("main · empty"));
  const playingRow = hintAt(h.vt.lines());
  const rowCount = h.vt.lines().length;
  // Its row is reserved: no rule shares it.
  expect(h.vt.lines()[playingRow]).not.toMatch(/[┈─]/);
  h.app.render(
    { score: { ...empty, playing: false }, beat: 0 },
    { force: true },
  );
  expect(h.vt.text()).toContain(
    "main · empty · space play · ctrl-p play mode · ctrl-k menu",
  );
  // Pausing keeps the same rows: the hint does not move.
  expect(hintAt(h.vt.lines())).toBe(playingRow);
  expect(h.vt.lines().length).toBe(rowCount);
  h.app.render({ score: empty, beat: 1 }, { force: true });
  expect(h.vt.lines()[playingRow]).not.toMatch(/[┈─]/);
  // No pitch legend row (C3 … C6) and no bar numbers in the gutter.
  expect(text.replace("add C4 at 0", "")).not.toMatch(/\bC[3-6]\b/);
  expect(h.vt.lines().some((line) => /^ *[12] /.test(line))).toBe(false);
  // The hit line and its transport marker stay.
  expect(h.vt.lines().some((line) => /[▶⏸] ━/.test(line))).toBe(true);
  const drums: TrackScoreSnapshot = {
    ...empty,
    trackName: "drums",
    trackId: "drums",
    ...drumSnapshotFields("kit", []),
  };
  h.app.render({ score: drums, beat: 0 }, { force: true });
  expect(h.vt.text()).toContain(
    "drums · empty · hit kick at 0 · space stop · type a request",
  );
  expect(h.vt.text()).not.toContain("snare");
});

test("text overlay shows titled lines, scrolls, closes on Esc and on submit", () => {
  const h = harness(80, 16, MONO);
  const lines = Array.from({ length: 30 }, (_, index) =>
    index % 10 === 0 ? `── group ${index / 10}` : `line ${index}`,
  );
  h.app.openText("help", lines);
  h.frame(0);
  let text = h.vt.text();
  expect(text).toContain(" help · 1-");
  expect(text).toContain("── group 0");
  expect(text).toContain("line 1");
  expect(text).not.toContain("line 29");
  h.app.input("\u001b[6~"); // PgDn: one full panel (9 rows at 16 rows)
  h.frame(0);
  expect(h.vt.text()).toContain(" help · 10-18/30");
  expect(h.vt.text()).toContain("line 9 ");
  expect(h.vt.text()).not.toContain("line 8 ");
  h.app.input("\u001b[F"); // End
  h.frame(0);
  expect(h.vt.text()).toContain("line 29");
  h.app.input("\u001b");
  h.frame(0);
  expect(h.vt.text()).not.toContain("line 29");
  expect(h.app.overlay).toBeUndefined();
  h.app.openText("tracks", ["* bass · sine"]);
  h.type("tempo 100");
  expect(h.app.overlay).toBe("text");
  h.app.input("\r");
  expect(h.app.overlay).toBeUndefined();
});

test("header shows the project types indicator beside sync", () => {
  const h = harness(120, 24);
  h.frame(0, { types: { ok: true, errors: 0 } });
  expect(h.vt.lines()[0]).toContain("types ✓");
  h.frame(0, { types: { ok: false, errors: 3 } });
  expect(h.vt.lines()[0]).toContain("types ✗ 3");
  h.frame(0, { types: undefined });
  expect(h.vt.lines()[0]).not.toContain("types");
});

test("header shows the master loudness meter while a master plays", () => {
  const h = harness(120, 24);
  h.frame(0, { loudness: { integrated: -14.04, truePeak: -1.23 } });
  expect(h.vt.lines()[0]).toContain("-14.0 LUFS · TP -1.2");
  h.frame(0, { loudness: undefined });
  expect(h.vt.lines()[0]).not.toContain("LUFS");
  expect(loudnessMeter({ integrated: -90, truePeak: -150 })).toBe(
    "-∞ LUFS · TP -∞",
  );
  expect(
    loudnessMeter({
      integrated: -13.2,
      truePeak: -1.4,
      target: -14,
      estimate: true,
    }),
  ).toBe("~-13.2 LUFS (-14) · TP -1.4");
  expect(
    loudnessOffTarget({ integrated: -13.2, truePeak: -2, target: -14 }),
  ).toBe(true);
  expect(
    loudnessOffTarget({ integrated: -14.2, truePeak: -2, target: -14 }),
  ).toBe(false);
  expect(loudnessOffTarget({ integrated: -9, truePeak: -2 })).toBe(false);
});

test("the minimum size is 60x16 and the too-small screen names both sizes", () => {
  expect([MIN_WIDTH, MIN_HEIGHT]).toEqual([60, 16]);
  expect(isTooSmall({ width: 80, height: 24 })).toBe(false);
  expect(isTooSmall({ width: 60, height: 16 })).toBe(false);
  expect(isTooSmall({ width: 59, height: 40 })).toBe(true);
  expect(isTooSmall({ width: 200, height: 15 })).toBe(true);
  expect(isTooSmall({ width: 0, height: 0 })).toBe(true);
  expect(isTooSmall({ width: NaN, height: 24 })).toBe(true);
  const h = harness(59, 20, MONO);
  h.frame(1);
  const lines = h.vt.lines();
  const at = lines.findIndex((line) => line.includes("terminal too small"));
  expect(lines[at]!.trim()).toBe("terminal too small · 59×20 · need ≥ 60×16");
  // Centred both ways, with the keys that still work two rows below.
  expect(at).toBe(Math.floor((20 - 3) / 2));
  const left = lines[at]!.length - lines[at]!.trimStart().length;
  const right = 59 - lines[at]!.trimEnd().length;
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(lines[at + 2]!.trim()).toBe("space stop · q quit");
  expect(h.vt.text()).not.toContain("NOW");
});

test("the too-small screen fits every size down to 1x1, ascii included", () => {
  for (const unicode of [true, false])
    for (let width = 1; width < 70; width += 1)
      for (let height = 1; height < 20; height += 1) {
        const lines = tooSmallLines({ width, height }, unicode, false);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.length).toBeLessThanOrEqual(height);
        if (width >= 5)
          for (const line of lines)
            expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
      }
  expect(tooSmallLines({ width: 30, height: 8 }, false, false)).toEqual([
    "terminal too small",
    "30x8 - need >= 60x16",
    "",
    "space play - q quit",
  ]);
  for (const [cols, rows] of [
    [1, 1],
    [2, 1],
    [1, 40],
    [300, 1],
  ] as const) {
    const h = harness(cols, rows, DUMB);
    expect(() => h.frame(1)).not.toThrow();
    expect(h.vt.cells.every((row) => row.length === cols)).toBe(true);
  }
});

test("a zero-size terminal draws nothing, then repaints in full", () => {
  const h = harness(80, 24, MONO);
  h.frame(1);
  h.io.size(0, 0);
  expect(h.frame(1)).toBe("");
  h.io.size(80, 24);
  const out = h.frame(1);
  expect(out).toContain("\u001b[2J");
  expect(h.vt.text()).toContain("NOW");
});

test("below the minimum only quit and play keys act", () => {
  expect(tooSmallKey("\u0003")).toBe("quit");
  expect(tooSmallKey("q")).toBe("quit");
  expect(tooSmallKey(" ")).toBe("play");
  for (const key of ["a", "\r", "\u001b", "\u000b", "\t", "?", "\u001b[A"])
    expect(tooSmallKey(key)).toBe("ignore");
});

test("shrinking below the minimum and back keeps the draft and the overlay", () => {
  const h = harness(80, 24, MONO);
  h.app.openText("help", ["one", "two", "three"]);
  h.type("a draft");
  h.frame(1);
  expect(h.vt.text()).toContain("help");
  h.io.size(40, 10);
  h.frame(1);
  expect(h.vt.text()).toContain("too small");
  expect(h.vt.text()).not.toContain("a draft");
  h.io.size(80, 24);
  h.frame(1);
  expect(h.vt.text()).toContain("help");
  expect(h.vt.text()).toContain("three");
  expect(h.app.prompt.value).toBe("a draft");
});
