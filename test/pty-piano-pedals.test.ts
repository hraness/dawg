/**
 * The 0.6.1 keys-electric lane end to end in a real PTY, offline: `epiano
 * preset suitcase` loads the electric piano, `piano felt` and the typed
 * `pedal sost` set a sostenuto lane, and the ctrl-k menu's Sound ›
 * performance Soft pedal row sets una corda with keys alone.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type PedalEvent = { tick: number; state: string };
type Track = {
  instrument?: string;
  keys?: Record<string, unknown>;
  softPedal?: PedalEvent[];
  sostenuto?: PedalEvent[];
};

/** The first track in the newest composition record under `.dawg/`. */
async function sessionTrack(cwd: string): Promise<Track | undefined> {
  const found: { path: string; mtime: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Lock directories and presence files can vanish mid-walk.
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json"))
        found.push({ path, mtime: (await Bun.file(path).stat()).mtimeMs });
    }
  };
  await walk(join(cwd, ".dawg"));
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { path } of found) {
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
  "real PTY: epiano suitcase, then piano pedals typed and from the menu",
  async () => {
    const t = await launch(110, 30, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("epiano preset suitcase\r");
      await waitFor(async () => {
        const track = await sessionTrack(t.cwd);
        return (
          track?.instrument === "epiano" && track.keys?.preset === "suitcase"
        );
      }, "suitcase in session");

      await t.send("piano felt\r");
      await waitFor(
        async () => (await sessionTrack(t.cwd))?.instrument === "felt",
        "felt piano in session",
      );
      await t.send("pedal sost 0-2\r");
      await waitFor(
        async () => (await sessionTrack(t.cwd))?.sostenuto?.length === 2,
        "sostenuto in session",
      );

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Sound"), "sound");
      await t.send("/performance");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("soft pedal"), "pedal rows");
      expect(t.vt.text()).toContain("sostenuto");
      await t.send("/soft pedal");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("bars"), "soft options");
      await t.send("/bars");
      await t.send("\r");
      await waitFor(
        async () =>
          (await sessionTrack(t.cwd))?.softPedal?.[0]?.state === "down",
        "soft pedal in session",
      );
      expect((await sessionTrack(t.cwd))?.sostenuto?.length).toBe(2);

      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
