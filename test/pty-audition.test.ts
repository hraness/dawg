/**
 * Auditioning end to end: Space loops the focused track in the menu, nudges
 * stage instead of committing, `a` flips A/B, Esc reverts with the score
 * unchanged, and Enter keeps every staged nudge as one revision that one
 * undo takes back.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  revision: number;
  tracks: { id: string; reverb?: { mix?: number } }[];
};

/** The newest composition record under `.dawg/`. */
async function latest(cwd: string): Promise<Doc> {
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
  let best: Doc = { revision: -1, tracks: [] };
  for (const path of found) {
    const parsed = JSON.parse(
      await readFile(path, "utf8").catch(() => "{}"),
    ) as {
      revision?: number;
      composition?: { tracks?: Doc["tracks"] };
    };
    if (
      parsed.composition?.tracks &&
      typeof parsed.revision === "number" &&
      parsed.revision > best.revision
    )
      best = { revision: parsed.revision, tracks: parsed.composition.tracks };
  }
  return best;
}

const RIGHT = "\u001b[C";

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
  "real PTY: audition in the menu, A/B, Esc reverts, Enter keeps one step",
  async () => {
    const t = await launch(80, 24, {});
    const screen = () => t.vt.text();
    const mix = async () =>
      (await latest(t.cwd)).tracks.find((track) => track.id === "bass")?.reverb
        ?.mix;
    try {
      await t.until(() => screen().includes("STEER"), "prompt");
      await t.send("\u000b");
      await t.until(() => screen().includes("Project"), "menu root");
      await t.send("j");
      await t.send("\r");
      await t.until(() => screen().includes("menu › Effects"), "effects");
      await t.send("/reverb");
      await t.until(() => screen().includes("/reverb"), "filtered");
      await t.send("\r");
      await t.until(() => screen().includes("› Reverb"), "reverb");
      // Switch the reverb on (a plain commit: nothing is auditioning yet).
      await t.send("\r");
      await t.until(() => screen().includes("reset to defaults"), "reverb on");
      await waitFor(async () => (await mix()) === 0.3, "reverb committed");
      const committed = await latest(t.cwd);

      // Down to mix, Space: the loop starts and the title says so.
      await t.send("jjj");
      await t.until(() => /› mix +0\.3/.test(screen()), "mix row");
      await t.send(" ");
      await t.until(() => screen().includes("♪ solo"), "auditioning");
      expect(screen()).toContain("space stop");

      // Two nudges stage: the row shows staged ← committed; nothing lands.
      await t.send(RIGHT);
      await t.until(() => screen().includes("0.35 ← 0.3"), "first nudge");
      await t.send(RIGHT);
      await t.until(() => screen().includes("0.4 ← 0.3"), "second nudge");
      expect(screen()).toContain("● menu");
      expect(screen()).toContain("B staged 2");
      expect(screen()).toContain("enter keep");
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);

      // A/B: the committed sound, then the staged one again.
      await t.send("a");
      await t.until(() => screen().includes("A committed"), "A");
      await t.send("a");
      await t.until(() => screen().includes("B staged 2"), "B");

      // Esc reverts: the row is back and no revision was written.
      await t.send("\u001b");
      await t.until(() => /› mix +0\.3 /.test(screen()), "reverted");
      expect(screen()).not.toContain(" ← ");
      expect(screen()).toContain("› Reverb");
      await Bun.sleep(150);
      const after = await latest(t.cwd);
      expect(after.revision).toBe(committed.revision);
      expect(await mix()).toBe(0.3);

      // Again, and Enter keeps both nudges as ONE revision.
      await t.send(RIGHT);
      await t.until(() => screen().includes("0.35 ← 0.3"), "nudge again");
      await t.send(RIGHT);
      await t.until(() => screen().includes("0.4 ← 0.3"), "nudge again 2");
      await t.send("\r");
      await t.until(() => screen().includes("one undo step"), "kept");
      await waitFor(async () => (await mix()) === 0.4, "kept in session");
      expect((await latest(t.cwd)).revision).toBe(committed.revision + 1);
      expect(screen()).not.toContain("●");

      // One undo takes both nudges back.
      for (let i = 0; i < 4 && screen().includes("╭─ menu"); i += 1) {
        await t.send("\u001b");
        await Bun.sleep(120);
      }
      await t.until(() => !screen().includes("╭─ menu"), "menu closed");
      await t.send("\u001a");
      await waitFor(async () => (await mix()) === 0.3, "undone");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
