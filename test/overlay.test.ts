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
  expect(h.app.input("2")).toEqual({ type: "pick", picker: "n", value: "b" });
  // An empty list never opens.
  h.app.openPicker({ id: "e", title: "e", items: [] });
  expect(h.app.overlay).toBeUndefined();
});
