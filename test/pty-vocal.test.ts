/**
 * 0.7 Voice contract in a real PTY, offline: bare `/vocal` answers from the
 * verb table, `/help voice` shows the Voice section, and the ctrl-k menu
 * shows the voice groups once a lane fills them.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: /vocal, /help voice and the voice groups",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/vocal\r");
      await t.until(() => t.vt.text().includes("vocal <verb>:"), "vocal list");
      await t.until(() => t.vt.text().includes("/vocal import"), "vocal list");
      await t.send("/help voice\r");
      await t.until(() => t.vt.text().includes("── voice"), "help voice");
      expect(t.vt.text()).toContain("voice tools: lists every verb");
      await t.send("\u001b");

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Sound"), "sound");
      await t.until(() => t.vt.text().includes("browse sounds"), "rows");
      // Sound > Voice now carries the clips lane's Clips and Lyrics.
      expect(t.vt.text()).toContain("Voice");
      for (let i = 0; i < 3; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
      expect(t.vt.text()).not.toContain("error");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
