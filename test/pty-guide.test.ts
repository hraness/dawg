/**
 * The guide pages in a real 80x24 PTY: a guide splits into pages that fit
 * the pane, n and p turn them and step to the next guide, and the marks
 * (✦ Ask, › Type it yourself, → Next, ✓ Tip) carry the section kind with
 * NO_COLOR as well as in colour, where the mark takes its theme role.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

type Run = Awaited<ReturnType<typeof launch>>;

/** The guide pane's title row, e.g. `guide · Arrange › TAPE · 1/2`. */
const title = (t: Run) =>
  t.vt
    .text()
    .split("\n")
    .find((line) => line.includes("─ guide · ")) ?? "";

/** The cell holding `mark` at the start of a pane row. */
function markCell(t: Run, mark: string) {
  for (const row of t.vt.cells)
    for (let x = 0; x < row.length - 2; x += 1)
      if (row[x]!.ch === "│" && row[x + 2]?.ch === mark) return row[x + 2]!;
  return undefined;
}

async function openTape(t: Run) {
  await t.until(() => t.vt.text().includes(" NOW "), "prompt");
  await t.send("/guide tape");
  await t.send("\r");
  await t.until(() => title(t).includes("TAPE"), "tape guide");
}

test.skipIf(!supported)(
  "real PTY 80x24 NO_COLOR: guide pages turn with n/p; marks carry meaning",
  async () => {
    const t = await launch(80, 24, { NO_COLOR: "1" });
    try {
      await openTape(t);
      expect(title(t)).toContain("· 1/2");
      expect(t.vt.text()).toContain("✦ Ask");
      expect(t.vt.text()).toContain("› Type it yourself");
      expect(t.vt.text()).toMatch(/n next/);
      expect(t.vt.wrapsSinceClear).toBe(0);
      // NO_COLOR: no foreground colour anywhere on the mark.
      expect(markCell(t, "✦")?.style.fg).toBeUndefined();
      await t.send("n");
      await t.until(() => title(t).includes("· 2/2"), "page 2");
      expect(t.vt.text()).toContain("→ Next");
      expect(t.vt.text()).toContain("✓ Tip:");
      expect(t.vt.text()).toMatch(/n next: \S/);
      await t.send("p");
      await t.until(() => title(t).includes("· 1/2"), "back to page 1");
      await t.send("p");
      await t.until(() => !title(t).includes("TAPE"), "previous guide");
      expect(title(t)).toMatch(/· 2\/2|guide · [^·]+$/);
      expect(t.proc.exitCode).toBeNull();
    } finally {
      t.proc.kill();
    }
  },
);

test.skipIf(!supported)(
  "real PTY 80x24 colour: a section mark takes its role's colour",
  async () => {
    const t = await launch(80, 24, {});
    try {
      await openTape(t);
      const ask = markCell(t, "✦");
      expect(ask?.style.fg).toBeDefined();
      expect(ask?.style.bold).toBe(true);
    } finally {
      t.proc.kill();
    }
  },
);
