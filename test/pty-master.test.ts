/**
 * The song master end to end in a real PTY, offline: `/master streaming`
 * sets a loudness target, the ctrl-k menu (Mix › master) turns
 * the glue compressor on with keys alone, and both land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Master = {
  target?: number;
  glue?: Record<string, number>;
  limiter?: Record<string, number | boolean>;
};

/** The master in the newest composition record under `.dawg/`. */
async function sessionMaster(cwd: string): Promise<Master | undefined> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    // A session lock directory can vanish between listing and reading it.
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const text = await readFile(path, "utf8");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      composition?: { tracks?: unknown[]; master?: Master };
    };
    if (parsed.composition?.tracks) return parsed.composition.master;
  }
  return undefined;
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
  "real PTY: /master sets a target and the menu turns the glue compressor on",
  async () => {
    const t = await launch(110, 30, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/master streaming\r");
      await waitFor(
        async () => (await sessionMaster(t.cwd))?.target === -14,
        "target in session",
      );
      expect((await sessionMaster(t.cwd))?.limiter).toBeDefined();

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/mix");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Mix"), "mix");
      await t.send("/master");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Mix › master"), "master menu");
      expect(t.vt.text()).toContain("streaming");
      await t.send("/glue");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("› glue"), "glue menu");
      // `on` is the first row: Enter flips it.
      await t.send("\r");
      await waitFor(
        async () => (await sessionMaster(t.cwd))?.glue !== undefined,
        "glue in session",
      );
      // The ratio typed as digits in its fader drawer: Enter stages the
      // value, Enter again keeps it.
      await t.send("/ratio");
      await t.send("\r");
      await t.send("4");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("change staged"),
        "staged ratio",
      );
      await t.send("\r");
      await waitFor(
        async () => (await sessionMaster(t.cwd))?.glue?.ratio === 4,
        "ratio in session",
      );

      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
