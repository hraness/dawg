/**
 * Range commands end to end: `loop 5-6` sets the loop range (no section on
 * the strip), copy tiles bars, `bars insert` grows the song and shifts
 * sections, and the ctrl-k Arrange › range page steps the loop.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionScore = {
  bars: number;
  tracks: { id: string }[];
  notes: { trackId: string; startTick: number; pitch: number }[];
  sections?: { name: string; startBar: number; bars: number }[];
  loop?: { startBar: number; bars: number } | null;
};

/** The newest composition record under `.dawg/`. */
async function session(cwd: string): Promise<SessionScore | undefined> {
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
  "real PTY: loop range, copy x2, bars insert and the range menu",
  async () => {
    const t = await launch(110, 34, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("bars 8\r");
      await t.send("add C4 at 0\r");
      await waitFor(
        async () => (await session(t.cwd))?.notes.length === 1,
        "one note",
      );

      // The loop range is not a section.
      await t.send("loop 5-6\r");
      await waitFor(
        async () => (await session(t.cwd))?.loop?.startBar === 4,
        "loop range in session",
      );
      expect((await session(t.cwd))?.sections ?? []).toEqual([]);
      expect(t.vt.text()).not.toContain("▏loop");

      // copy bar 1 to bar 3, twice.
      await t.send("copy 1 to 3 x2\r");
      await waitFor(
        async () => (await session(t.cwd))?.notes.length === 3,
        "copied notes",
      );
      const ticks = (await session(t.cwd))!.notes
        .map((note) => note.startTick)
        .sort((a, b) => a - b);
      expect(ticks).toEqual([0, 2 * 1920, 3 * 1920]);

      // bars insert shifts the section and the loop range.
      await t.send("section chorus 5-8\r");
      await t.send("bars insert 2 at 2\r");
      await waitFor(
        async () => (await session(t.cwd))?.bars === 10,
        "ten bars",
      );
      const grown = (await session(t.cwd))!;
      expect(grown.sections?.[0]).toMatchObject({ startBar: 6, bars: 4 });
      expect(grown.loop).toEqual({ startBar: 6, bars: 2 });

      // ctrl-k → Arrange → range → loop next.
      await t.send("/menu arrange\r");
      await t.until(() => t.vt.text().includes("menu › Arrange"), "Arrange");
      await t.send("/range");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("menu › Arrange › range"),
        "range page",
      );
      expect(t.vt.text()).toContain("loop bars");
      await t.send("/loop next");
      await t.send("\r");
      await waitFor(
        async () => (await session(t.cwd))?.loop?.startBar === 8,
        "loop stepped",
      );
      const menuOpen = () => t.vt.text().includes("╭─ menu");
      for (let i = 0; i < 8 && menuOpen(); i++) {
        await t.send("\u001b");
        await Bun.sleep(150);
      }
      await t.until(() => !menuOpen(), "menu closed");
      await t.send("loop off\r");
      await waitFor(async () => !(await session(t.cwd))?.loop, "loop off");

      // Each command is one undo step: loop off, loop next, bars insert.
      await t.send("\u001a");
      await waitFor(
        async () => (await session(t.cwd))?.loop?.startBar === 8,
        "undo loop off",
      );
      await t.send("\u001a");
      await waitFor(
        async () => (await session(t.cwd))?.loop?.startBar === 6,
        "undo loop next",
      );
      await t.send("\u001a");
      await waitFor(
        async () => (await session(t.cwd))?.bars === 8,
        "undo bars insert",
      );
      const undone = (await session(t.cwd))!;
      expect(undone.sections?.[0]).toMatchObject({ startBar: 4 });
      expect(undone.loop).toEqual({ startBar: 4, bars: 2 });
      expect(undone.notes.length).toBe(3);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
