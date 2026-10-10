/**
 * The too-small screen in a real PTY: it updates live while the terminal is
 * dragged, space still plays and stops, typing and menu keys are dropped so
 * the hidden UI keeps its state, q quits, and the real UI returns the moment
 * the terminal is big enough again. (A PTY cannot be resized to zero
 * columns; test/tui.test.ts covers that through the app's io.)
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

async function resize(
  t: Awaited<ReturnType<typeof launch>>,
  cols: number,
  rows: number,
) {
  t.vt.resize(Math.max(1, cols), Math.max(1, rows));
  t.terminal.resize(cols, rows);
  await Bun.sleep(120);
}

test.skipIf(!supported)(
  "real PTY: below 60x16 a live too-small screen; space plays; state survives",
  async () => {
    const t = await launch(80, 24, { NO_COLOR: "1" });
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b"); // Ctrl-K: the menu, two levels down
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/mix");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Mix"), "mix");
      await resize(t, 50, 14);
      await t.until(
        () => t.vt.text().includes("terminal too small · 50×14 · need ≥ 60×16"),
        "too-small screen",
      );
      expect(t.vt.text()).toContain("space play · q quit");
      // Live while dragging: the numbers follow every size.
      for (const [cols, rows] of [
        [45, 12],
        [30, 8],
        [20, 4],
        [8, 2],
        [1, 1],
        [59, 30],
      ] as const) {
        await resize(t, cols, rows);
        // 1x1 has room for an ellipsis only.
        const label = cols > 1 ? `${cols}×${rows}` : "…";
        await t.until(() => t.vt.text().includes(label), `${cols}x${rows}`);
        expect(t.proc.exitCode).toBeNull();
        expect(t.vt.wrapsSinceClear).toBe(0);
        expect(t.vt.scrollsSinceClear).toBe(0);
      }
      // Typing and menu keys are dropped; space toggles playback.
      await t.send("xyz\r\u001b");
      await t.send(" ");
      await t.until(
        () => t.vt.text().includes("space stop · q quit"),
        "playing",
      );
      await t.send(" ");
      await t.until(() => t.vt.text().includes("space play"), "stopped");
      expect(t.proc.exitCode).toBeNull();
      // Back above the minimum: the menu is where it was, nothing typed.
      await resize(t, 80, 24);
      await t.until(() => t.vt.text().includes("≡ Mix"), "real UI back");
      expect(t.vt.text()).not.toContain("too small");
      expect(t.vt.text()).not.toContain("xyz");
      await t.send("\u001b");
      await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
      // q quits from the too-small screen.
      await resize(t, 40, 10);
      await t.until(() => t.vt.text().includes("too small"), "small again");
      await t.send("q");
      await t.until(() => t.proc.exitCode !== null, "exit on q");
    } finally {
      t.proc.kill();
    }
  },
  30_000,
);
