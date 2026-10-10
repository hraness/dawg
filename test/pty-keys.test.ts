/**
 * The modelled piano end to end in a real PTY, offline: `piano felt` puts
 * the felt preset on the focused track, the ctrl-k menu (Sound's piano
 * rows) sets the hammer hardness with keys alone, and both land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Track = { instrument?: string; keys?: Record<string, unknown> };

/** The first track in the newest composition record under `.dawg/`. */
async function sessionTrack(cwd: string): Promise<Track | undefined> {
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
    const parsed = JSON.parse(text) as {
      composition?: { tracks?: Track[] };
    };
    if (parsed.composition?.tracks) return parsed.composition.tracks[0];
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
  "real PTY: piano felt loads the preset and the menu sets hardness",
  async () => {
    const t = await launch(110, 30, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("piano felt\r");
      await waitFor(async () => {
        const track = await sessionTrack(t.cwd);
        return track?.instrument === "felt" && track.keys?.preset === "felt";
      }, "felt piano in session");

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Sound"), "sound");
      // The simple piano rows sit in Sound itself (the full Sound › keys
      // page holds every parameter).
      expect(t.vt.text()).toContain("preset");
      await t.send("/hardness");
      await t.send("\r");
      await t.send("0.9");
      await t.send("\r");
      await t.send("\r");
      await waitFor(
        async () => (await sessionTrack(t.cwd))?.keys?.hardness === 0.9,
        "hardness in session",
      );
      expect((await sessionTrack(t.cwd))?.keys?.preset).toBe("felt");

      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
