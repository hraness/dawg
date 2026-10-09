/**
 * 0.7 formant lane in a real PTY, offline: `/formant -4` commits, `/vowel a
 * o` morphs, and ctrl-k reaches Effects > Voice > Formant where right
 * arrow nudges the shift.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: /formant, /vowel and Effects > Voice > Formant",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/formant -4\r");
      await t.until(
        () => t.vt.text().includes("formant · shift -4"),
        "formant set",
      );
      await t.send("/vowel a o\r");
      await t.until(() => t.vt.text().includes("vowel · vowel a"), "vowel");
      await t.send("/formant o\r");
      await t.until(
        () => t.vt.text().includes("the vowel filter is `vowel`"),
        "hint",
      );

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Effects"), "effects");
      await t.send("/Voice");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Formant"), "voice group");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("shift"), "formant rows");
      expect(t.vt.text()).toContain("-4 st");
      for (let i = 0; i < 5; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
      expect(t.vt.text()).not.toContain("error");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
