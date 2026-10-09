/**
 * Feel end to end at 80x24: the empty hint names play mode, one window's own
 * edits never say "synced", playing keeps the highway's row count and never
 * puts a hint over the ruler, play mode on a kit labels keys by drum, and a
 * /style receipt fits the row.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

const OFFLINE = { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" };

/** Index of the ruler row (the transport glyph at column 1). */
function rulerRow(lines: string[]): number {
  return lines.findIndex((line) => /^ [⏸▶] [━─]/.test(line));
}

test.skipIf(!supported)(
  "real PTY: hints, own edits, playback rows, drum play mode, /style receipt",
  async () => {
    const t = await launch(80, 24, OFFLINE);
    try {
      await t.until(() => t.vt.text().includes("commands only"), "prompt");
      await t.until(
        () =>
          t.vt.text().includes("bass · empty · space play · ctrl-p play mode"),
        "empty hint",
      );
      expect(t.vt.text()).not.toContain("ctrl-p play ·");

      // One window: its own edits never draw "synced".
      await t.send("add C3 at 0\r");
      await t.until(() => t.vt.text().includes("✓ added"), "add receipt");
      await t.send("add E3 at 1\r");
      await t.until(() => t.vt.text().includes("rev 2"), "second edit");
      await Bun.sleep(600);
      expect(t.vt.text()).not.toContain("synced ·");

      // Playing keeps the highway's rows and draws no hint over the ruler.
      const paused = t.vt.lines();
      const pausedRuler = rulerRow(paused);
      expect(pausedRuler).toBeGreaterThan(0);
      await t.send(" ");
      await t.until(() => t.vt.text().includes("▶ 120 BPM"), "playing");
      await Bun.sleep(300);
      const playing = t.vt.lines();
      const playingRuler = playing.findIndex((line) => /^ ↻ ═/.test(line));
      expect(playingRuler).toBeGreaterThan(0);
      expect(playing.length).toBe(paused.length);
      expect(playing[playingRuler]).not.toMatch(/space|ctrl-/);
      await t.send(" ");
      await t.until(() => t.vt.text().includes("⏸ 120 BPM"), "stopped");

      // /style names the musical change and fits one 80-column row.
      await t.send("style lofi-hip-hop\r");
      await t.until(() => t.vt.text().includes("✓ lofi-hip-hop"), "style");
      const receipt = t.vt.lines().find((line) => line.includes("✓ lofi"))!;
      expect(receipt.length).toBeLessThanOrEqual(80);
      expect(receipt).toMatch(/BPM/);

      // Play mode on a kit: keys by drum, never C2.
      await t.send("/track drums\r");
      await t.send("instrument kit\r");
      await t.until(() => t.vt.text().includes("✓ track · drums"), "kit");
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY MODE"), "play mode");
      const text = t.vt.text();
      expect(text).toContain("A kick");
      expect(text).toContain("S snare");
      expect(text).toContain("play mode · drums · drums");
      expect(text).not.toMatch(/A C2\b/);
      await t.send("\u001b");
    } finally {
      t.terminal.write("\u0003");
      await Promise.race([t.proc.exited, Bun.sleep(5000)]);
      t.proc.kill();
      t.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: /motion off draws no glint on the ruler",
  async () => {
    const t = await launch(80, 24, OFFLINE);
    try {
      await t.until(() => t.vt.text().includes("commands only"), "prompt");
      await t.send("add C3 at 0\r");
      await t.until(() => t.vt.text().includes("✓ added"), "add");
      await t.send("/motion off\r");
      await Bun.sleep(300);
      await t.send(" ");
      // Sample the ruler across a few downbeats: no glint glyphs.
      for (let index = 0; index < 8; index += 1) {
        await Bun.sleep(120);
        expect(t.vt.text()).not.toMatch(/[✦✸]/);
      }
      await t.send(" ");
    } finally {
      t.terminal.write("\u0003");
      await Promise.race([t.proc.exited, Bun.sleep(5000)]);
      t.proc.kill();
      t.terminal.close();
    }
  },
  30_000,
);
