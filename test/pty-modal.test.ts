/**
 * Modal mallets end to end in a real PTY, offline: `modal vibes` turns the
 * focused track into a modal track, a parameter lands in the document, the
 * ctrl-k Sound › browse sounds › Mallets and bells group switches preset,
 * and play mode records notes onto it through the live path.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    modal?: { preset?: string; ring?: number };
  }[];
  notes?: { trackId: string; pitch: number }[];
};

/** The newest composition record under `.dawg/`. */
async function composition(cwd: string): Promise<Doc> {
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
  let best: { revision: number; doc: Doc } | undefined;
  for (const path of found) {
    const parsed = JSON.parse(
      await readFile(path, "utf8").catch(() => "{}"),
    ) as {
      revision?: number;
      composition?: Doc;
    };
    if (!parsed.composition?.tracks) continue;
    const revision = parsed.revision ?? 0;
    if (!best || revision >= best.revision)
      best = { revision, doc: parsed.composition };
  }
  return best?.doc ?? {};
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

const lead = async (cwd: string) =>
  (await composition(cwd)).tracks?.find((track) => track.id === "lead");

test.skipIf(!supported)(
  "real PTY: modal vibes, a ring override, the Mallets menu and play mode",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/count-in 0\r");
      await t.until(() => t.vt.text().includes("count-in · 0 bars"), "count");
      await t.send("modal vibes\r");
      await t.until(
        () => t.vt.text().includes("modal · preset vibes"),
        "preset receipt",
      );
      await t.send("modal ring 3\r");
      await t.until(() => t.vt.text().includes("ring 3"), "ring receipt");
      await waitFor(
        async () => (await lead(t.cwd))?.modal?.ring === 3,
        "ring in session",
      );
      const track = await lead(t.cwd);
      expect(track?.instrument).toBe("modal");
      expect(track?.modal).toEqual({ preset: "vibes", ring: 3 });

      // ctrl-k → Sound › browse sounds › Mallets and bells → gong.
      await t.send("/menu sounds\r");
      await t.until(() => t.vt.text().includes("mallets and bells"), "group");
      await t.send("/mallets");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("rosewood bars"), "preset list");
      await t.send("/gong");
      await t.send("\r");
      await waitFor(
        async () => (await lead(t.cwd))?.modal?.preset === "gong",
        "gong in session",
      );
      for (let i = 0; i < 6 && t.vt.text().includes("╭─ menu"); i++) {
        await t.send("\u001b");
        await Bun.sleep(150);
      }
      await t.until(() => !t.vt.text().includes("╭─ menu"), "menu closed");

      // Play mode on the modal track: arm, play a key, stop.
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      if (t.vt.text().includes("AUTO")) {
        await t.send("q");
        await t.until(() => t.vt.text().includes("MANUAL"), "manual");
      }
      await t.send("r");
      await t.until(() => t.vt.text().includes("rec armed"), "armed");
      await t.send(" ");
      await t.until(() => t.vt.text().includes("REC"), "recording");
      await t.send("a");
      await Bun.sleep(250);
      await t.send(" ");
      await waitFor(
        async () =>
          ((await composition(t.cwd)).notes ?? []).some(
            (note) => note.trackId === "lead",
          ),
        "recorded note",
      );
      expect(t.vt.text()).not.toContain("error");
      await t.send("\u001b");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  60_000,
);
