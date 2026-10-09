/**
 * `master measure` in a real PTY: the worker measures the song and the
 * result replaces the spinner.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: master measure resolves to a loudness line",
  async () => {
    const t = await launch(140, 30, {});
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("tempo 138\r");
      await t.send("add C4 at 0 for 2\r");
      await t.send("master target -8\r");
      await t.send("master measure\r");
      await t.until(
        () => t.vt.text().includes("master measure ·"),
        "loudness line",
      );
      expect(t.vt.text()).not.toContain("measuring");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
