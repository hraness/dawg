/**
 * The Euclidean rhythm editor end to end: `/euclid` opens it on a kit
 * track, keys alone add a row, change pulses and rotate, and each change
 * lands in the session as a generated rhythm row with its notes.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionRow = { voice: string; pulses?: number; rotate?: number };
type SessionScore = {
  tracks: { id: string; instrument: string; rhythm?: SessionRow[] }[];
  notes: { trackId: string; pitch: number; startTick: number }[];
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
  "real PTY: /euclid adds a kick row and changes pulses and rotate",
  async () => {
    const t = await launch(110, 34, {});
    const kickRow = async () =>
      (await session(t.cwd))?.tracks
        .find((track) => track.id === "drums")
        ?.rhythm?.find((row) => row.voice === "kick");
    const kickStarts = async () =>
      ((await session(t.cwd))?.notes ?? [])
        .filter((note) => note.trackId === "drums" && note.pitch === 36)
        .map((note) => note.startTick)
        .sort((a, b) => a - b);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/track drums\r");
      await t.until(() => t.vt.text().includes("drums"), "drums track");
      await t.send("instrument kit\r");
      await waitFor(
        async () =>
          (await session(t.cwd))?.tracks.find((track) => track.id === "drums")
            ?.instrument === "kit",
        "kit instrument",
      );
      await t.send("/euclid\r");
      await t.until(() => t.vt.text().includes("rhythm ›"), "editor");
      // Every drum voice has a lane; the empty kick lane offers E(4,16).
      expect(t.vt.text()).toContain("openhat".slice(0, 4));
      expect(t.vt.text()).toContain("enter adds E(4,16)");

      // Enter on the kick lane adds four on the floor.
      await t.send("\r");
      await waitFor(
        async () => (await kickRow())?.voice === "kick",
        "kick row in session",
      );
      await t.until(() => t.vt.text().includes("E(4,16)"), "row summary");
      // Four per bar, repeated over the four-bar loop.
      expect((await kickStarts()).length).toBe(16);

      // → raises pulses (the first parameter) to 5.
      await t.send("\u001b[C");
      await waitFor(async () => (await kickRow())?.pulses === 5, "pulses 5");
      await t.until(() => t.vt.text().includes("E(5,16)"), "E(5,16)");

      // Tab to steps, Tab to rotate; digits type 3.
      await t.send("\t");
      await t.send("\t");
      await t.until(() => t.vt.text().includes("rotate"), "rotate param");
      await t.send("3");
      await t.send("\r");
      await waitFor(async () => (await kickRow())?.rotate === 3, "rotate 3");
      await t.until(() => t.vt.text().includes("E(5,16,r3)"), "rotated");

      // Esc closes the editor; the prompt takes text again.
      await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("rhythm ›"), "editor closed");
      // Ctrl-Z undoes the rotate as one step.
      await t.send("\u001a");
      await waitFor(
        async () => (await kickRow())?.rotate === undefined,
        "rotate undone",
      );
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
