/**
 * Arrangement end to end: prompt commands mark sections, the arrangement
 * strip shows them over the timeline, the ctrl-k Arrange section loops one
 * with enter, and the form lands in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionScore = {
  tracks: { id: string }[];
  sections?: { name: string; startBar: number; bars: number }[];
  form?: { section: string; repeat?: number }[];
  loopSection?: string;
};

/** The newest composition record under `.dawg/`. */
async function session(cwd: string): Promise<SessionScore | undefined> {
  const found: { path: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Lock directories and presence files can vanish mid-walk.
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push({ path });
    }
  };
  await walk(join(cwd, ".dawg"));
  let best: { revision: number; score: SessionScore } | undefined;
  for (const { path } of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      revision?: number;
      composition?: SessionScore;
    };
    if (!parsed.composition?.tracks) continue;
    const revision = parsed.revision ?? 0;
    if (!best || revision >= best.revision)
      best = { revision, score: parsed.composition };
  }
  return best?.score;
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test.skipIf(!supported)(
  "real PTY: sections show on the strip and the Arrange menu loops one",
  async () => {
    const t = await launch(110, 34, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("bars 8\r");
      await t.send("section verse 1-4\r");
      await t.send("section chorus 5-8\r");
      await waitFor(
        async () => (await session(t.cwd))?.sections?.length === 2,
        "two sections in session",
      );
      // The strip names both blocks over the timeline.
      await t.until(
        () => /[▼▏]verse/u.test(t.vt.text()) && t.vt.text().includes("▏chorus"),
        "arrangement strip",
      );

      await t.send("form verse*2 chorus\r");
      await waitFor(
        async () => (await session(t.cwd))?.form?.[0]?.repeat === 2,
        "form in session",
      );

      // ctrl-k → Arrange → sections → chorus → loop.
      await t.send("/menu arrange\r");
      await t.until(() => t.vt.text().includes("≡ Arrange"), "Arrange");
      expect(t.vt.text()).toContain("verse");
      expect(t.vt.text()).toContain("chorus");
      await t.send("/sections");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("≡ Arrange › sections"),
        "sections page",
      );
      await t.send("/chorus");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("≡ Arrange › sections › chorus"),
        "chorus page",
      );
      await t.send("/loop");
      await t.send("\r");
      await waitFor(
        async () => (await session(t.cwd))?.loopSection === "chorus",
        "chorus looped",
      );
      // Esc goes back one level at a time until the menu closes.
      const menuOpen = () => t.vt.text().includes("≡ ");
      for (let i = 0; i < 8 && menuOpen(); i++) {
        await t.send("\u001b");
        await Bun.sleep(150);
      }
      await t.until(() => !menuOpen(), "menu closed");
      await t.send("section loop off\r");
      await waitFor(
        async () => (await session(t.cwd))?.loopSection === undefined,
        "loop off",
      );
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
