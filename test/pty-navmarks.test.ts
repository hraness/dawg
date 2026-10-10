/**
 * The docs' marks in TUI navigation, end to end at 80x24: the Ctrl-K
 * breadcrumb leads with the guides' menu mark (`≡ Project › audio`) and
 * /help marks each group by kind (`› start here`, `→ topics`). The symbols
 * carry the meaning under NO_COLOR; in color each takes its role.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

type Run = Awaited<ReturnType<typeof launch>>;

/** The picker's top border, e.g. `╭─ ≡ Project › audio ─…╮`. */
const menuTitle = (t: Run) =>
  t.vt.lines().find((line) => line.includes("╭─ ≡ ")) ?? "";

/** The cell holding `glyph` on the first row containing `text`. */
function cellOf(t: Run, text: string, glyph: string) {
  const lines = t.vt.lines();
  const y = lines.findIndex((line) => line.includes(text));
  if (y < 0) return undefined;
  const row = t.vt.cells[y]!;
  const x = row.findIndex((cell) => cell.ch === glyph);
  return x < 0 ? undefined : row[x];
}

async function walk(t: Run) {
  await t.until(() => t.vt.text().includes(" NOW "), "prompt");
  await t.send("\u000b");
  await t.until(() => menuTitle(t).includes("╭─ ≡ menu ─"), "menu root");
  await t.type("\u001b", "close the menu");
  await t.type("/menu project\r", "open Project");
  await t.until(() => menuTitle(t).includes("≡ Project"), "Project");
  expect(t.vt.wrapsSinceClear).toBe(0);
}

async function help(t: Run) {
  await t.type("\u001b\u001b", "close the menu");
  await t.until(() => !menuTitle(t), "menu closed");
  await t.type("/help\r", "help");
  await t.until(() => t.vt.text().includes("› start here"), "help");
  expect(t.vt.text()).toContain("→ topics · help <topic>");
  expect(t.vt.text()).not.toContain("│ ── ");
}

test.skipIf(!supported)(
  "real PTY 80x24 NO_COLOR: breadcrumb and /help marks carry the meaning",
  async () => {
    const t = await launch(80, 24, { NO_COLOR: "1" });
    try {
      await walk(t);
      expect(cellOf(t, "╭─ ≡ ", "≡")?.style.fg).toBeUndefined();
      await help(t);
      expect(cellOf(t, "› start here", "›")?.style.fg).toBeUndefined();
      expect(t.proc.exitCode).toBeNull();
    } finally {
      t.proc.kill();
    }
  },
);

test.skipIf(!supported)(
  "real PTY 80x24 color: the menu mark and /help marks take their roles",
  async () => {
    const t = await launch(80, 24, {});
    try {
      await walk(t);
      const mark = cellOf(t, "╭─ ≡ ", "≡");
      expect(mark?.style.fg).toBeDefined();
      expect(mark?.style.bold).toBe(true);
      await help(t);
      const start = cellOf(t, "› start here", "›")?.style;
      const topics = cellOf(t, "→ topics", "→")?.style;
      expect(start?.fg).toBeDefined();
      expect(topics?.fg).toBeDefined();
      expect(topics?.fg).not.toEqual(start?.fg);
      expect(t.proc.exitCode).toBeNull();
    } finally {
      t.proc.kill();
    }
  },
);
