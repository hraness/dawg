/**
 * The drum pattern library and kit picker end to end in a real PTY:
 * `/pattern` opens the picker, typing filters it, Enter puts the pattern
 * on the focused track as rhythm rows (moving the tempo into range), and
 * a bare `/kit` lists synth and sample kits in one picker.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionScore = {
  tempoBpm: number;
  tracks: {
    id: string;
    instrument: string;
    kit?: string;
    rhythm?: { voice: string }[];
  }[];
  notes: { trackId: string }[];
};

/** The newest composition record under `.dawg/`. */
async function session(cwd: string): Promise<SessionScore | undefined> {
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
  let best: { revision: number; score: SessionScore } | undefined;
  for (const path of found) {
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
  "real PTY: /pattern picks boom-bap, /kit sets a synth kit, bare /kit lists both kinds",
  async () => {
    const t = await launch(110, 34, {});
    const drums = async () =>
      (await session(t.cwd))?.tracks.find((track) => track.id === "drums");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/track drums\r");
      await t.until(() => t.vt.text().includes("drums"), "drums track");

      await t.send("/pattern\r");
      await t.until(() => t.vt.text().includes("─ grooves ─"), "picker");
      expect(t.vt.text()).toContain("House four-on-the-floor");
      // `/` filters, as in every picker; the footer says so.
      expect(t.vt.text()).toContain("/ filter");
      await t.send("/boom");
      await t.until(() => t.vt.text().includes("grooves · /boom"), "filtered");
      await t.send("\r");
      await waitFor(
        async () => (await drums())?.rhythm?.length === 3,
        "boom-bap rows in session",
      );
      const applied = (await session(t.cwd))!;
      expect(applied.tempoBpm).toBe(90);
      expect((await drums())!.instrument).toBe("kit");
      expect((await drums())!.rhythm!.map((row) => row.voice)).toEqual([
        "kick",
        "snare",
        "hat",
      ]);
      expect(applied.notes.some((note) => note.trackId === "drums")).toBe(true);
      await t.until(() => t.vt.text().includes("pattern boom-bap"), "receipt");

      await t.send("/kit lofi\r");
      await waitFor(async () => (await drums())?.kit === "lofi", "lofi kit");

      await t.send("/kit\r");
      await t.until(() => t.vt.text().includes("808 (synth)"), "kit picker");
      expect(t.vt.text()).toContain("Default (synth)");
      await t.send("\u001b");
      await t.until(
        () => !t.vt.text().includes("808 (synth)"),
        "kit picker closed",
      );
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
