/**
 * Auditioning in the rhythm editor and the chord settings, end to end:
 * while the loop plays (Space) a change stages instead of committing, `a`
 * flips A/B, Esc reverts with no revision written, and Enter keeps the
 * staged changes as one revision that one undo takes back. With the loop
 * off both screens commit at once, as before (test/pty-euclid.test.ts).
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  revision: number;
  key: string | null;
  tracks: {
    id: string;
    instrument: string;
    rhythm?: { voice: string; pulses?: number }[];
  }[];
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
  let best: Doc = { revision: -1, key: null, tracks: [] };
  for (const path of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      revision?: number;
      composition?: { tracks?: Doc["tracks"]; key?: string | null };
    };
    if (
      parsed.composition?.tracks &&
      typeof parsed.revision === "number" &&
      parsed.revision > best.revision
    )
      best = {
        revision: parsed.revision,
        key: parsed.composition.key ?? null,
        tracks: parsed.composition.tracks,
      };
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
  "real PTY: /euclid stages while looping, A/B, Esc reverts, Enter keeps one step",
  async () => {
    const t = await launch(80, 24, {});
    const screen = () => t.vt.text();
    const pulses = async () =>
      (await latest(t.cwd)).tracks
        .find((track) => track.id === "drums")
        ?.rhythm?.find((row) => row.voice === "kick")?.pulses ?? 4;
    try {
      await t.until(() => screen().includes(" NOW "), "prompt");
      await t.send("/track drums\r");
      await t.until(() => screen().includes("drums"), "drums track");
      await t.send("instrument kit\r");
      await waitFor(
        async () =>
          (await latest(t.cwd)).tracks.find((track) => track.id === "drums")
            ?.instrument === "kit",
        "kit instrument",
      );
      await t.send("/euclid\r");
      await t.until(() => screen().includes("rhythm ›"), "editor");
      // Loop off: Enter adds the kick row at once, as before.
      await t.send("\r");
      await waitFor(
        async () => (await latest(t.cwd)).revision === 3,
        "kick row committed",
      );
      expect(await pulses()).toBe(4);
      const committed = await latest(t.cwd);

      // Space loops the track; the footer speaks the audition grammar.
      await t.send(" ");
      await t.until(() => screen().includes("♪ solo"), "auditioning");
      expect(screen()).toContain("space stop");

      // Two nudges stage: the row shows staged ← committed; nothing lands.
      await t.send(RIGHT);
      await t.until(() => screen().includes("E(5,16) ← E(4,16)"), "nudge 1");
      await t.send(RIGHT);
      await t.until(() => screen().includes("E(6,16) ← E(4,16)"), "nudge 2");
      expect(screen()).toContain("● rhythm");
      expect(screen()).toContain("B staged 2");
      expect(screen()).toContain("enter keep");
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);

      // A/B: the committed rhythm, then the staged one again.
      await t.send("a");
      await t.until(() => screen().includes("A committed"), "A");
      await t.send("a");
      await t.until(() => screen().includes("B staged 2"), "B");

      // Esc reverts: no revision, the editor stays open.
      await t.send("\u001b");
      await t.until(() => !screen().includes(" ← "), "reverted");
      expect(screen()).toContain("rhythm ›");
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);
      expect(await pulses()).toBe(4);

      // Again, and Enter keeps both nudges as ONE revision.
      await t.send(RIGHT);
      await t.until(() => screen().includes("E(5,16) ← E(4,16)"), "again 1");
      await t.send(RIGHT);
      await t.until(() => screen().includes("E(6,16) ← E(4,16)"), "again 2");
      await t.send("\r");
      await t.until(() => screen().includes("one undo step"), "kept");
      await waitFor(async () => (await pulses()) === 6, "kept in session");
      expect((await latest(t.cwd)).revision).toBe(committed.revision + 1);

      // Esc closes the editor (and stops the loop); one undo takes both back.
      await t.send("\u001b");
      await t.until(() => !screen().includes("rhythm ›"), "editor closed");
      await t.send("\u001a");
      await waitFor(async () => (await pulses()) === 4, "undone");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);

test.skipIf(!supported)(
  "real PTY: chord settings stage while looping, Esc reverts, Enter keeps one step",
  async () => {
    const t = await launch(80, 24, {});
    const screen = () => t.vt.text();
    try {
      await t.until(() => screen().includes(" NOW "), "prompt");
      await t.send("/menu chords\r");
      await t.until(() => screen().includes("menu › Chords"), "chords");
      const committed = await latest(t.cwd);

      // Space loops a progression played with the chord settings.
      await t.send(" ");
      await t.until(() => screen().includes("♪ solo"), "auditioning");

      // Voicing stages (window state): staged ← committed in the row.
      await t.send("jjj");
      await t.until(() => /› voicing/.test(screen()), "voicing row");
      await t.send(RIGHT);
      await t.until(() => screen().includes("+1 ← 0"), "voicing staged");
      expect(screen()).toContain("● menu");
      expect(screen()).toContain("B staged 1");
      await t.send("a");
      await t.until(() => screen().includes("A committed"), "A");
      await t.send("a");
      await t.until(() => screen().includes("B staged 1"), "B");

      // Esc reverts it; nothing was written.
      await t.send("\u001b");
      await t.until(() => !screen().includes(" ← "), "reverted");
      expect(screen()).toContain("menu › Chords");
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);

      // Stage the key tonic (a score edit) and the voicing, then keep both.
      await t.send("kk");
      await t.until(() => /› key tonic/.test(screen()), "key tonic row");
      await t.send(RIGHT);
      await t.until(() => screen().includes("B staged 1"), "key staged");
      await t.send("jj");
      await t.send(RIGHT);
      await t.until(() => screen().includes("B staged 2"), "both staged");
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);
      const staged = screen();
      await t.send("\r");
      await t.until(() => screen().includes("one undo step"), "kept");
      await waitFor(
        async () => (await latest(t.cwd)).revision === committed.revision + 1,
        "one revision",
      );
      const key = (await latest(t.cwd)).key;
      expect(key).not.toBe(committed.key);
      expect(screen()).toContain("voicing");
      expect(staged).toContain("+1 ← 0");
      expect(screen()).not.toContain("●");

      // Close the menu; one undo takes the key back.
      for (let i = 0; i < 4 && screen().includes("╭─ menu"); i += 1) {
        await t.send("\u001b");
        await Bun.sleep(120);
      }
      await t.until(() => !screen().includes("╭─ menu"), "menu closed");
      await t.send("\u001a");
      await waitFor(
        async () => (await latest(t.cwd)).key === committed.key,
        "undone",
      );
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
