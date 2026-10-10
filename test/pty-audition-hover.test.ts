/**
 * Hovering a list on the audition loop: in the menu's wavetable list each
 * move plays the highlighted table on the loop without committing; Esc
 * leaves with the score unchanged; Enter chooses and keep commits once.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Track = { id: string; wavetable?: { table?: { src?: string } } };
type Doc = { revision: number; tracks: Track[] };

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
      composition?: { tracks?: Track[] };
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

/** Screens kept for the docs: DAWG_PTY_CAPTURE=1 prints them. */
const capture: { hover?: string; picker?: string; tried?: string } = {};

test.skipIf(!supported)(
  "real PTY: hover through wavetables on the audition loop",
  async () => {
    const t = await launch(80, 24, {});
    const screen = () => t.vt.text();
    try {
      await t.until(() => screen().includes(" NOW "), "prompt");
      await t.send("wt basic\r");
      await t.until(() => screen().includes("wavetable"), "wavetable set");
      const src = async () =>
        (await latest(t.cwd)).tracks.find((track) => track.id === "bass")
          ?.wavetable?.table?.src;
      await waitFor(async () => (await src()) === "builtin:basic", "basic");
      const committed = await latest(t.cwd);

      await t.send("/menu sound\r");
      await t.until(() => screen().includes("≡ Sound"), "sound");
      await t.send("j");
      await t.send("\r");
      await t.until(() => screen().includes("≡ Sound › table"), "tables");
      // Space loops; moving now hears each table on the loop.
      await t.send(" ");
      await t.until(() => screen().includes("♪ solo"), "auditioning");
      await t.send("j");
      await t.until(() => screen().includes("B staged 1"), "hover 1");
      await t.send("jj");
      await t.until(() => screen().includes("B staged 1"), "hover 3");
      // Hovers replace each other: still one staged change, nothing written.
      expect(screen()).not.toContain("staged 2");
      capture.hover = screen();
      await Bun.sleep(150);
      expect((await latest(t.cwd)).revision).toBe(committed.revision);

      // Esc leaves the list and drops the hover.
      await t.send("\u001b");
      await t.until(() => /› table +basic/.test(screen()), "left list");
      await t.until(() => !screen().includes("B staged"), "hover dropped");
      expect((await latest(t.cwd)).revision).toBe(committed.revision);

      // Back in, move, Enter chooses; Esc out; Enter on a value keeps.
      await t.send("\r");
      await t.until(() => screen().includes("≡ Sound › table"), "tables 2");
      await t.send("jj");
      await t.until(() => screen().includes("B staged 1"), "hover again");
      const chosen = screen().match(/› (\S+) {2}/)?.[1];
      await t.send("\r");
      await t.send("\u001b");
      await t.until(() => /› table +/.test(screen()), "back to sound");
      expect(screen()).toContain("B staged 1");
      await t.send("j");
      await t.send("\r");
      await t.until(() => screen().includes("one undo step"), "kept");
      await waitFor(
        async () => (await src()) !== "builtin:basic",
        "table committed",
      );
      expect((await latest(t.cwd)).revision).toBe(committed.revision + 1);
      expect(await src()).toContain(chosen ?? "?");
      if (process.env.DAWG_PTY_CAPTURE) console.log(capture.hover);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);

test.skipIf(!supported)(
  "real PTY: /kit hovers on the loop; /try stages, A/B, Enter keeps once",
  async () => {
    const t = await launch(80, 24, {});
    const screen = () => t.vt.text();
    try {
      await t.until(() => screen().includes(" NOW "), "prompt");
      await t.send("/kit\r");
      // The title row can arrive before the footer row of the same frame.
      await t.until(
        () => screen().includes("─ kits ─") && screen().includes("space loop"),
        "kit picker with its loop hint",
      );
      await t.send(" ");
      await t.until(() => screen().includes("♪ solo"), "auditioning");
      await t.until(() => screen().includes("B staged 1"), "first hover");
      await t.send("j");
      await t.send("j");
      await t.until(() => screen().includes("B staged 1"), "hover");
      expect(screen()).not.toContain("staged 2");
      capture.picker = screen();
      const before = await latest(t.cwd);
      await t.send("\u001b");
      await t.until(() => !screen().includes("─ kits ─"), "closed");
      await Bun.sleep(200);
      expect((await latest(t.cwd)).revision).toBe(before.revision);

      await t.send("/try fx reverb mix 0.6\r");
      await t.until(() => screen().includes("try · fx reverb mix 0.6"), "try");
      await t.until(() => screen().includes("B staged 1"), "staged");
      await t.send("a");
      await t.until(() => screen().includes("A committed"), "A");
      await t.send("a");
      await t.until(() => screen().includes("B staged 1"), "B");
      capture.tried = screen();
      expect((await latest(t.cwd)).revision).toBe(before.revision);
      await t.send("\r");
      await waitFor(async () => {
        const doc = (await latest(t.cwd)) as unknown as {
          tracks: { id: string; reverb?: { mix?: number } }[];
        };
        return doc.tracks.find((tr) => tr.id === "bass")?.reverb?.mix === 0.6;
      }, "try kept");
      expect((await latest(t.cwd)).revision).toBe(before.revision + 1);
      if (process.env.DAWG_PTY_CAPTURE)
        console.log(`${capture.picker}\n${capture.tried}`);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
