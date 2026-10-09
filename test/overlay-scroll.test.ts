/**
 * The help/text panel and the transcript clamp their scroll to the last full
 * page, the same bound the renderer uses: End (or Home on the transcript)
 * then one arrow press moves the view.  Every key a panel's `?` section
 * lists acts there, and help rows clip with an ellipsis at any width.
 */
import { expect, test } from "bun:test";
import { TuiApp, type AppView } from "../tui/app.ts";
import { KEYS } from "../tui/grammar.ts";
import { displayWidth } from "../tui/text.ts";
import type { TerminalCapabilities } from "../tui/theme.ts";
import {
  HELP_TOPICS,
  helpLines,
  helpTopicLines,
} from "../src/commands/help.ts";
import { VirtualTerminal } from "./vt.ts";

const MONO: TerminalCapabilities = { colorDepth: "none", unicode: true };
const view: AppView = {
  score: { trackId: "bass", bpm: 120, notes: [] },
  beat: 0,
};
const UP = "\u001b[A";
const DOWN = "\u001b[B";
const HOME = "\u001b[H";
const END = "\u001b[F";
const PGUP = "\u001b[5~";
const PGDN = "\u001b[6~";

function harness(cols: number, rows: number) {
  const vt = new VirtualTerminal(cols, rows);
  let now = 1_000;
  const app = new TuiApp({
    io: { write: (d) => vt.write(d), columns: () => cols, rows: () => rows },
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

/** The visible slice of numbered lines `L000`… on screen. */
function visible(lines: readonly string[]): number[] {
  const found: number[] = [];
  for (const line of lines)
    for (const match of line.matchAll(/L(\d{3})/g))
      found.push(Number(match[1]));
  return found;
}

/** Seeded LCG: the same sequence on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("text panel: End then ↑ moves the view on the first press", () => {
  const h = harness(80, 24);
  const lines = Array.from(
    { length: 34 },
    (_, i) => `L${String(i).padStart(3, "0")}`,
  );
  h.app.openText("help", lines);
  h.frame();
  h.app.input(END);
  const atEnd = visible(h.frame());
  expect(atEnd.at(-1)).toBe(33);
  h.app.input(UP);
  const after = visible(h.frame());
  expect(after.at(-1)).toBe(32);
  expect(after[0]).toBe(atEnd[0]! - 1);
});

test("transcript: Home then ↓ moves the view on the first press", () => {
  const h = harness(80, 24);
  for (let i = 0; i < 60; i += 1)
    h.app.activity.pushNote(`L${String(i).padStart(3, "0")}`, "op");
  h.app.input("\u000f");
  h.frame();
  h.app.input(HOME);
  const top = visible(h.frame());
  expect(top[0]).toBe(0);
  h.app.input(DOWN);
  expect(visible(h.frame())[0]).toBe(1);
});

test("property: every arrow press after any key sequence moves or is at a bound", () => {
  const random = lcg(0x5eed);
  const keys = [UP, DOWN, HOME, END, PGUP, PGDN];
  for (let round = 0; round < 30; round += 1) {
    const cols = 40 + Math.floor(random() * 120);
    const rows = 14 + Math.floor(random() * 50);
    const count = 1 + Math.floor(random() * 120);
    const h = harness(cols, rows);
    const log = random() < 0.5;
    if (log) {
      for (let i = 0; i < count; i += 1)
        h.app.activity.pushNote(`L${String(i).padStart(3, "0")}`, "op");
      h.app.input("\u000f");
    } else
      h.app.openText(
        "help",
        Array.from(
          { length: count },
          (_, i) => `L${String(i).padStart(3, "0")}`,
        ),
      );
    let before = visible(h.frame());
    for (let step = 0; step < 40; step += 1) {
      const key = keys[Math.floor(random() * keys.length)]!;
      h.app.input(key);
      const now = visible(h.frame());
      if (key === UP || key === DOWN) {
        const first = before[0]!;
        const atTop = first === 0;
        const atBottom = before.at(-1) === count - 1;
        const wantsUp = key === UP;
        if (wantsUp ? !atTop : !atBottom) {
          expect(now[0]).toBe(first + (wantsUp ? -1 : 1));
        } else expect(now).toEqual(before);
      }
      before = now;
    }
  }
});

test("each panel's listed keys act there; none types into the prompt", () => {
  const named: Record<string, string> = {
    "↑": UP,
    "↓": DOWN,
    pgup: PGUP,
    pgdn: PGDN,
    home: HOME,
    end: END,
  };
  for (const section of ["text", "log"] as const) {
    for (const group of KEYS[section])
      for (const [keys, action] of group.rows) {
        if (action !== "scroll" && action !== "page") continue;
        for (const name of keys.split(/\s+/).filter(Boolean)) {
          const sequence = named[name];
          expect(
            sequence,
            `${section}: "${name}" is not a scroll key`,
          ).toBeDefined();
          const h = harness(80, 24);
          if (section === "log") {
            for (let i = 0; i < 60; i += 1)
              h.app.activity.pushNote(`L${String(i).padStart(3, "0")}`, "op");
            h.app.input("\u000f");
          } else
            h.app.openText(
              "help",
              Array.from(
                { length: 60 },
                (_, i) => `L${String(i).padStart(3, "0")}`,
              ),
            );
          h.frame();
          // Start mid-panel so either direction can move.
          h.app.input(PGDN);
          if (section === "log") h.app.input(PGUP);
          h.app.input(PGUP);
          h.app.input(DOWN);
          h.app.input(DOWN);
          const before = visible(h.frame());
          expect(h.app.input(sequence!).type).toBe("overlay");
          expect(visible(h.frame())).not.toEqual(before);
        }
      }
  }
});

test("help rows clip with an ellipsis and never pass the width", () => {
  for (const width of [10, 22, 30, 42, 50, 72, 80, 120]) {
    const rows = [
      ...helpLines(width),
      ...(helpTopicLines(undefined, width) ?? []),
      ...HELP_TOPICS.flatMap((topic) => helpTopicLines(topic, width) ?? []),
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
      if (displayWidth(row) === width && width < 72)
        expect(row.endsWith("…") || row.trimEnd() === row).toBe(true);
    }
    if (width === 50) expect(rows.some((row) => row.endsWith("…"))).toBe(true);
  }
});
