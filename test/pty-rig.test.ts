/**
 * The guitar rig end to end in a real PTY, offline: `/rig crunch` writes the
 * stomp, head and cab stages onto the focused track, `/head gain 7` edits one
 * stage, `/fx amp` points at the head without changing `amp`, and the ctrl-k
 * menu (Effects › Guitar rig) loads a rig preset.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Fx = Record<string, Record<string, unknown>>;

/** The focused track's fx in the newest composition record under `.dawg/`. */
async function trackFx(cwd: string, id: string): Promise<Fx | undefined> {
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
      composition?: { tracks?: { id: string; fx?: Fx }[] };
    };
    const track = parsed.composition?.tracks?.find((t) => t.id === id);
    if (track) return track.fx;
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
  "real PTY: /rig loads a rig, stages edit, and the menu steps rig presets",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "gtr"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/rig crunch\r");
      await t.until(() => t.vt.text().includes("rig crunch ·"), "receipt");
      await waitFor(
        async () => (await trackFx(t.cwd, "gtr"))?.head?.type === "crunch",
        "crunch head in session",
      );
      const fx = (await trackFx(t.cwd, "gtr"))!;
      expect(fx.cab).toBeDefined();

      await t.send("/head gain 7\r");
      await waitFor(
        async () => (await trackFx(t.cwd, "gtr"))?.head?.gain === 7,
        "head gain in session",
      );

      await t.send("/fx amp\r");
      await t.until(() => t.vt.text().includes("guitar amp"), "amp hint");

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Effects"), "effects");
      await t.send("/guitar");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("Effects › guitar rig"),
        "guitar rig menu",
      );
      expect(t.vt.text()).toContain("amp head");
      expect(t.vt.text()).toContain("speaker cabinet");
      // An edited stage leaves no named rig ("—"): right loads the first.
      expect(t.vt.text()).toContain("rig              —");
      await t.send("\u001b[C");
      await waitFor(
        async () => (await trackFx(t.cwd, "gtr"))?.head?.type === "clean",
        "clean rig in session",
      );
      expect(t.vt.text()).not.toContain("error");
      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
