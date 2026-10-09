/**
 * `/track rm` (here by its alias `remove`) in a real PTY, offline: removing a vocoder's source
 * track drops the carrier's `vocoder.src` instead of leaving a stale
 * reference that `dawg check` would reject.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: { id: string; vocoder?: { src?: string } }[];
};

async function composition(cwd: string): Promise<Doc> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
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
    const parsed = JSON.parse(
      await readFile(path, "utf8").catch(() => "{}"),
    ) as { composition?: Doc };
    if (parsed.composition?.tracks) return parsed.composition;
  }
  return {};
}

test.skipIf(!supported)(
  "real PTY: /track remove (alias of rm) drops a vocoder src",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "pad"]);
    const tracks = async () => (await composition(t.cwd)).tracks ?? [];
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/track vox\r");
      await t.until(() => t.vt.text().includes("vox"), "vox");
      await t.send("/track pad\r");
      await t.send("/vocoder src vox\r");
      for (
        let i = 0;
        i < 30 &&
        (await tracks()).find((x) => x.id === "pad")?.vocoder?.src !== "vox";
        i++
      )
        await Bun.sleep(100);
      expect((await tracks()).find((x) => x.id === "pad")?.vocoder?.src).toBe(
        "vox",
      );
      await t.send("/track remove vox\r");
      await t.until(() => t.vt.text().includes("removed vox"), "removed");
      expect(t.vt.text()).toContain("dropped references on pad");
      for (
        let i = 0;
        i < 30 && (await tracks()).some((x) => x.id === "vox");
        i++
      )
        await Bun.sleep(100);
      const after = await tracks();
      expect(after.map((x) => x.id)).not.toContain("vox");
      expect(after.find((x) => x.id === "pad")?.vocoder?.src).toBeUndefined();
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
