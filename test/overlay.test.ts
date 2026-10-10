import { expect, test } from "bun:test";
import { logEntriesFor, TuiApp, type AppView } from "../tui/app.ts";
import type { TerminalCapabilities } from "../tui/theme.ts";
import { VirtualTerminal } from "./vt.ts";

const MONO: TerminalCapabilities = { colorDepth: "none", unicode: true };
const view: AppView = {
  score: { trackId: "bass", bpm: 120, notes: [] },
  beat: 0,
};

function harness(cols = 80, rows = 24) {
  const vt = new VirtualTerminal(cols, rows);
  let now = 1_000;
  const app = new TuiApp({
    io: {
      write: (data) => vt.write(data),
      columns: () => cols,
      rows: () => rows,
    },
    capabilities: MONO,
    clock: () => now,
  });
  return {
    app,
    vt,
    frame() {
      now += 50;
      app.render(view, { force: true });
      return vt.lines();
    },
  };
}

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const PGUP = "\u001b[5~";
const PGDN = "\u001b[6~";
const ESC = "\u001b";

test("transcript scrolls with arrows and PgUp/PgDn and pins to the end", () => {
  const h = harness();
  for (let index = 0; index < 60; index += 1)
    h.app.activity.pushNote(`entry ${String(index).padStart(2, "0")}`, "op");
  h.app.input("\u000f");
  let lines = h.frame();
  expect(lines.some((line) => line.includes("entry 59"))).toBe(true);
  expect(lines.some((line) => line.includes("entry 00"))).toBe(false);
  expect(h.app.input(UP).type).toBe("overlay");
  lines = h.frame();
  expect(lines.some((line) => line.includes("entry 59"))).toBe(false);
  expect(lines.some((line) => line.includes("entry 58"))).toBe(true);
  h.app.input(PGUP);
  h.app.input(PGUP);
  h.app.input(PGUP);
  h.app.input(PGUP);
  lines = h.frame();
  expect(lines.some((line) => line.includes("entry 00"))).toBe(true);
  // Scrolling past the top clamps there.
  h.app.input(UP);
  expect(h.frame().some((line) => line.includes("entry 00"))).toBe(true);
  h.app.input(PGDN);
  h.app.input(PGDN);
  h.app.input(PGDN);
  h.app.input(PGDN);
  h.app.input(PGDN);
  h.app.input(DOWN);
  lines = h.frame();
  expect(lines.some((line) => line.includes("entry 59"))).toBe(true);
  // Arrows never reach the prompt while the transcript is open.
  expect(h.app.prompt.snapshot.text).toBe("");
  h.app.input(ESC);
  expect(h.app.overlay).toBeUndefined();
});

test("/ cycles the transcript filter through requests, ops and errors", () => {
  const h = harness();
  h.app.activity.pushRequest("add a bass line");
  h.app.activity.pushCard("+4 notes", { tone: "success" });
  h.app.activity.pushError("error · boom");
  h.app.input("\u000f");
  const entries = h.app.activity.transcript;
  expect(logEntriesFor(entries, "requests").map((entry) => entry.text)).toEqual(
    ["add a bass line"],
  );
  expect(logEntriesFor(entries, "errors").map((entry) => entry.text)).toEqual([
    "error · boom",
  ]);
  const visible = (needle: string) =>
    h.frame().some((line) => line.includes(needle));
  expect(visible("you add a bass line") && visible("op  +4 notes")).toBe(true);
  h.app.input("/");
  expect(h.app.log.filter).toBe("requests");
  expect(visible("transcript · requests")).toBe(true);
  expect(visible("you add a bass line")).toBe(true);
  expect(visible("op  +4 notes")).toBe(false);
  h.app.input("/");
  expect(h.app.log.filter).toBe("ops");
  expect(visible("op  +4 notes")).toBe(true);
  expect(visible("ERR error · boom")).toBe(false);
  h.app.input("/");
  expect(h.app.log.filter).toBe("errors");
  expect(visible("ERR error · boom")).toBe(true);
  expect(visible("you add a bass line")).toBe(false);
  h.app.input("/");
  expect(h.app.log.filter).toBe("all");
  // "/" typed with the overlay closed still types into the prompt.
  h.app.input(ESC);
  h.app.input("/");
  expect(h.app.prompt.snapshot.text).toBe("/");
});

test("picker moves with arrows, picks with Enter, cancels with Esc", () => {
  const h = harness();
  h.app.openPicker({
    id: "resume",
    title: "resume a session",
    items: [
      { label: "night drive", value: "s1", detail: "rev 4" },
      { label: "dub sketch", value: "s2" },
      { label: "warehouse", value: "s3" },
    ],
  });
  let lines = h.frame();
  expect(lines.some((line) => line.includes("› night drive"))).toBe(true);
  expect(lines.some((line) => line.includes("rev 4"))).toBe(true);
  h.app.input(DOWN);
  h.app.input(DOWN);
  h.app.input(DOWN); // clamps at the last row
  h.app.input(UP);
  lines = h.frame();
  expect(lines.some((line) => line.includes("› dub sketch"))).toBe(true);
  expect(h.app.input("\r")).toEqual({
    type: "pick",
    picker: "resume",
    value: "s2",
  });
  expect(h.app.overlay).toBeUndefined();
  expect(h.app.prompt.snapshot.text).toBe("");

  h.app.openPicker({
    id: "resume",
    title: "resume",
    items: [{ label: "a", value: "a" }],
  });
  expect(h.app.input("x").type).toBe("overlay");
  expect(h.app.input(ESC)).toEqual({ type: "pick-cancel", picker: "resume" });
  expect(h.app.picker).toBeUndefined();
  expect(h.app.prompt.snapshot.text).toBe("");

  h.app.openPicker({
    id: "n",
    title: "n",
    items: [
      { label: "a", value: "a" },
      { label: "b", value: "b" },
    ],
  });
  // Digits never pick (rows are not numbered); j/k move like arrows.
  expect(h.app.input("2")).toEqual({ type: "overlay" });
  // Each move names the highlighted row (the live-preview hook).
  expect(h.app.input("j")).toEqual({
    type: "pick-move",
    picker: "n",
    value: "b",
  });
  expect(h.app.input("\r")).toEqual({ type: "pick", picker: "n", value: "b" });
  // `/` starts the filter, Esc clears it first, then closes.
  h.app.openPicker({
    id: "f",
    title: "f",
    filterable: true,
    items: [
      { label: "kick", value: "k" },
      { label: "snare", value: "s" },
    ],
  });
  expect(h.app.input("s").type).toBe("overlay");
  expect(h.app.picker?.items).toHaveLength(2);
  h.app.input("/");
  h.app.input("s");
  h.app.input("n");
  expect(h.app.picker?.items.map((item) => item.value)).toEqual(["s"]);
  expect(h.frame().some((line) => line.includes("f · /sn"))).toBe(true);
  expect(h.app.input(ESC)).toEqual({ type: "overlay" });
  expect(h.app.picker?.items).toHaveLength(2);
  expect(h.app.input(ESC)).toEqual({ type: "pick-cancel", picker: "f" });
  // An empty list never opens.
  h.app.openPicker({ id: "e", title: "e", items: [] });
  expect(h.app.overlay).toBeUndefined();
});

test("/guide opens the guide tree; → opens a guide; Esc steps back out", () => {
  const h = harness();
  expect(h.app.command("/guide")).toContain("guides");
  let lines = h.frame();
  expect(lines.some((line) => line.includes("Getting started"))).toBe(true);
  expect(lines.some((line) => line.includes("Using dawg"))).toBe(true);
  expect(h.app.input(DOWN).type).toBe("overlay");
  h.app.input("\u001b[C");
  lines = h.frame();
  expect(lines.some((line) => line.includes("Play mode"))).toBe(true);
  h.app.input(DOWN);
  h.app.input("\r");
  lines = h.frame();
  expect(lines.some((line) => line.includes("guide · Using dawg ›"))).toBe(
    true,
  );
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80);
  h.app.input(ESC);
  h.app.input(ESC);
  expect(h.app.ui.overlay).toBeUndefined();
  // A miss is a refusal (✗), the same tone as a /help miss.
  expect(h.app.command("/guide nonsense")).toEqual({
    ok: false,
    text: "no topic nonsense · /help",
  });
  expect(h.app.command("/guide vocie")).toEqual({
    ok: false,
    text: "no topic vocie · did you mean voice · /help",
  });
  expect(h.app.ui.overlay).toBeUndefined();
  h.app.command("/guide chords");
  lines = h.frame();
  expect(lines.some((line) => line.includes("chords auto"))).toBe(true);
});

/** An 80x24 app with the given capabilities (the menu and /help panels). */
function themed(capabilities: TerminalCapabilities, cols = 80, rows = 24) {
  const vt = new VirtualTerminal(cols, rows);
  const app = new TuiApp({
    io: {
      write: (data) => vt.write(data),
      columns: () => cols,
      rows: () => rows,
    },
    capabilities,
    clock: () => 1_000,
  });
  return {
    app,
    vt,
    frame() {
      app.render(view, { force: true });
      return vt.lines();
    },
    /** The cell holding `glyph` on the first row that contains `text`. */
    cell(text: string, glyph: string) {
      const y = vt.lines().findIndex((line) => line.includes(text));
      if (y < 0) return undefined;
      const x = [...vt.lines()[y]!].indexOf(glyph);
      return x < 0 ? undefined : vt.cells[y]![x];
    },
  };
}

const COLOR: TerminalCapabilities = { colorDepth: "truecolor", unicode: true };
const DUMB: TerminalCapabilities = {
  colorDepth: "none",
  unicode: false,
  attributes: false,
};

const menuPicker = (steps: string[], suffix?: string) => ({
  id: "menu",
  title: steps.join(" › "),
  crumbs: { steps, ...(suffix ? { suffix } : {}) },
  items: [{ label: "cutoff", value: "cutoff" }],
});

test("Ctrl-K breadcrumb: menu mark in its color, steps dim, current bold", () => {
  const h = themed(COLOR);
  h.app.openPicker(menuPicker(["Arrange", "zone"]));
  const lines = h.frame();
  expect(lines.some((line) => line.includes("╭─ ≡ Arrange › zone ─"))).toBe(
    true,
  );
  const mark = h.cell("≡ Arrange", "≡");
  expect(mark?.style.fg).toBeDefined();
  expect(mark?.style.bold).toBe(true);
  const here = h.cell("≡ Arrange", "z");
  const step = h.cell("≡ Arrange", "A");
  expect(step?.style.bold).toBeFalsy();
  expect(here?.style.bold).toBe(true);
  // The mark's color is not the current step's: the symbol leads.
  expect(mark?.style.fg).not.toEqual(here?.style.fg);
});

test("Ctrl-K breadcrumb under NO_COLOR and TERM=dumb keeps the symbols", () => {
  const mono = themed(MONO);
  mono.app.openPicker(menuPicker(["Effects", "Filter"]));
  expect(mono.frame().some((line) => line.includes("≡ Effects › Filter"))).toBe(
    true,
  );
  expect(mono.vt.cells.flat().every((cell) => !cell.style.fg)).toBe(true);
  const dumb = themed(DUMB);
  dumb.app.openPicker(menuPicker(["Effects", "Filter"]));
  expect(dumb.frame().some((line) => line.includes("= Effects > Filter"))).toBe(
    true,
  );
});

test("Ctrl-K breadcrumb folds inside the 60-column picker", () => {
  const h = themed(MONO, 60, 24);
  h.app.openPicker(
    menuPicker(
      ["Effects", "more effects", "sidechain duck"],
      " · ♪ solo · B staged 2 · 42 ms",
    ),
  );
  const top = h.frame().find((line) => line.includes("╭─ ≡ "))!;
  // The suffix keeps its room; the parents fold, the current step stays.
  expect(top).toContain("≡ … › sidechain duck · ♪ solo · B staged 2 · 42 ms");
  expect(top.trimEnd().endsWith("╮")).toBe(true);
  expect([...top.trimEnd()].length).toBeLessThanOrEqual(60);
});

test("/help headings take their group's mark and color", () => {
  const lines = [
    "── start here",
    "  /tape",
    "── agent · ask in words",
    "  ask",
    "── topics · help <topic>",
    "  effects",
  ];
  const marks = [
    { mark: "›", ascii: ">", role: "transport" as const },
    undefined,
    { mark: "✦", ascii: "*", role: "agent" as const },
    undefined,
    { mark: "→", ascii: "->", role: "borderFocus" as const },
    undefined,
  ];
  const color = themed(COLOR);
  color.app.openText("help", lines, marks);
  const text = color.frame().join("\n");
  expect(text).toContain("› start here");
  expect(text).toContain("✦ agent · ask in words");
  expect(text).toContain("→ topics · help <topic>");
  expect(text).not.toContain("│ ── ");
  const start = color.cell("› start here", "›")?.style.fg;
  const agent = color.cell("✦ agent", "✦")?.style.fg;
  expect(start).toBeDefined();
  expect(agent).toBeDefined();
  expect(agent).not.toEqual(start);

  const mono = themed(MONO);
  mono.app.openText("help", lines, marks);
  expect(mono.frame().join("\n")).toContain("✦ agent · ask in words");
  const dumb = themed(DUMB);
  dumb.app.openText("help", lines, marks);
  const plain = dumb.frame().join("\n");
  expect(plain).toContain("> start here");
  expect(plain).toContain("* agent · ask in words");
  expect(plain).toContain("-> topics · help <topic>");
});
