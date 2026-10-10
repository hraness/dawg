/**
 * Tunings end to end: the menu's Project › tuning & scale sets the song
 * tuning and scale with keys alone, and both land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Composition = { tuning?: { name?: string }; key?: string };

/** The newest composition record under `.dawg/`. */
async function composition(cwd: string): Promise<Composition | undefined> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Lock directories and presence files can vanish mid-walk.
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as { composition?: Composition };
    if (parsed.composition) return parsed.composition;
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
  "real PTY: menu sets the song tuning and scale",
  async () => {
    const t = await launch(100, 30, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/chords and key");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("menu › Chords and key"),
        "chords and key",
      );
      await t.send("/tuning");
      await t.until(() => t.vt.text().includes("› tuning"), "row");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("Chords and key › tuning"),
        "tuning submenu",
      );
      expect(t.vt.text()).toContain("list scales");
      // Enter on the tuning row opens the library; `/` filters it.
      await t.send("\r");
      await t.until(() => t.vt.text().includes("31-edo"), "tuning list");
      await t.send("/19-edo");
      await t.send("\r");
      await waitFor(
        async () => (await composition(t.cwd))?.tuning?.name === "19-edo",
        "19-edo in session",
      );
      // Esc clears the filter and backs out to the submenu.
      for (let i = 0; i < 2; i++) await t.send("\u001b");
      await t.until(() => t.vt.text().includes("19-edo"), "tuning shown");
      await t.send("/scale");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("harmonic-minor"), "scale list");
      await t.send("/hijaz");
      await t.send("\r");
      await waitFor(
        async () => /hijaz/.test((await composition(t.cwd))?.key ?? ""),
        "hijaz in session",
      );
      for (let i = 0; i < 6; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
