/**
 * One language end to end at 80x24: the topic ids open the same subject in
 * /guide and /help, and an unknown topic answers with a did-you-mean.
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

type Pty = Awaited<ReturnType<typeof launch>>;

/** Esc until the overlay showing `marker` closes (a guide page steps back
 * to the tree first). */
async function closeOverlay(t: Pty, marker: string): Promise<void> {
  for (let i = 0; i < 4 && t.vt.text().includes(marker); i++) {
    // A lone Esc waits out the escape-sequence timeout before it counts.
    await Bun.sleep(150);
    await t.send("\u001b");
    await Bun.sleep(300);
  }
  await t.until(() => !t.vt.text().includes(marker), `${marker} closed`);
}

test.skipIf(!supported)(
  "real PTY 80x24: /guide voice, /help voice, /guide agent, /help nonsense",
  async () => {
    const t = await launch(80, 24, {}, ["--track", "lead"]);
    try {
      await t.until(() => /STEER|NOW/.test(t.vt.text()), "prompt");

      await t.send("/guide voice\r");
      await t.until(() => t.vt.text().includes("Type it yourself"), "voice");
      expect(t.vt.text()).toContain("Voice");
      expect(t.vt.text()).toContain("Ask");
      await closeOverlay(t, "╭─ guide");

      await t.send("/help voice\r");
      await t.until(() => t.vt.text().includes("── voice"), "help voice");
      expect(t.vt.text()).toContain("help · voice");
      await t.send("\u001b[F"); // End: the footer names the other doors
      await t.until(
        () => t.vt.text().includes("guide voice · menu voice"),
        "help voice footer",
      );
      await closeOverlay(t, "╭─ help");

      await t.send("/guide agent\r");
      await t.until(() => t.vt.text().includes("Type it yourself"), "agent");
      expect(t.vt.text()).toContain("show-me");
      await closeOverlay(t, "╭─ guide");

      await t.send("/help vioce\r");
      await t.until(
        () => t.vt.text().includes("no topic vioce · did you mean voice"),
        "did you mean",
      );
      await t.send("/help nonsense\r");
      await t.until(
        () => t.vt.text().includes("no topic nonsense"),
        "unknown topic",
      );
      expect(t.vt.text()).toContain("/help");
      expect(t.vt.text()).not.toContain("error");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test("dawg --help lists Display options, model key and no login", async () => {
  const proc = Bun.spawn(
    ["bun", new URL("../src/main.ts", import.meta.url).pathname, "--help"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, DAWG_AI: "0" } },
  );
  const text = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(text).toContain("Display options:");
  expect(text).not.toContain("Usage flags");
  expect(text).toContain("dawg model key");
  expect(text).not.toMatch(/\blogin\b/);
  expect(text).not.toMatch(/sign in/i);
}, 30_000);
