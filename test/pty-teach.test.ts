/**
 * The op1-ux teaching doors at 80x24 in a real PTY (design Lane E): /help
 * arrange is one screen of range lines, /help panes the pane verbs, and
 * /guide tape and /guide panes open their pages. Offline, so nothing here
 * needs an agent.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

const ESC = "\u001b";
const OFFLINE = { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" };

test.skipIf(!supported)(
  "real PTY: /help arrange, /help panes, /guide tape and /guide panes",
  async () => {
    const t = await launch(80, 24, OFFLINE, ["--track", "main"]);
    await t.until(
      () => t.vt.lines().some((line) => line.startsWith("╭─")),
      "prompt",
    );
    const door = async (line: string, words: string[]) => {
      await t.send(`${line}\r`);
      await t.until(
        () => words.every((word) => t.vt.text().includes(word)),
        line,
      );
      expect(t.vt.text()).not.toMatch(/\bunknown\b|no help topic|no guide/i);
      // Esc steps back from a guide to its parent, then closes.
      for (
        let tries = 0;
        tries < 4 && /^\s+╭─/m.test(t.vt.text());
        tries += 1
      ) {
        await t.send(ESC);
        await Bun.sleep(150);
      }
    };
    await door("/help arrange", ["loop 5-6", "copy bass 5-6 to 7"]);
    await door("/help panes", ["pin · unpin", "follow"]);
    await door("/guide tape", [
      "Ctrl-T shows every track",
      "copy drums 9-16 to 17",
    ]);
    await door("/guide panes", ["pane tape"]);
    t.terminal.write("\u0003");
    await Promise.race([t.proc.exited, Bun.sleep(5000)]);
    t.proc.kill();
    t.terminal.close();
  },
  30_000,
);
