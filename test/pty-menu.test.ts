/**
 * The edit menu end to end: Ctrl-K opens it, keys alone change an effect
 * parameter and add an automation point, and both land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionTrack = {
  id: string;
  filter?: { cutoff: number; resonance: number };
  filterAutomation?: { tick: number; value: number }[];
};

/** Tracks in the newest composition record under `.dawg/`. */
async function sessionTracks(cwd: string): Promise<SessionTrack[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const text = await readFile(path, "utf8");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      composition?: { tracks?: SessionTrack[] };
    };
    if (parsed.composition?.tracks) return parsed.composition.tracks;
  }
  return [];
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
  "real PTY: menu changes a filter cutoff and an automation point",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Transport"), "menu root");
      expect(t.vt.text()).toContain("Automation");

      // Effects › Filter › cutoff, typed as digits.
      await t.send("jj");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Effects"), "effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("› Filter"), "filter");
      // Every row shows its command, and `/` filters the list.
      await t.send("/cutoff");
      await t.until(() => t.vt.text().includes("Filter · /cutoff"), "filtered");
      await t.send("\r");
      for (const key of "1200") await t.send(key);
      await t.until(() => t.vt.text().includes("1200"), "typed value");
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.filter?.cutoff === 1200,
        "filter in session",
      );

      // Back out to the root with Esc, then Automation › filter cutoff.
      await t.send("\u001b");
      await t.send("\u001b");
      await t.until(
        () => t.vt.text().includes("Parameters"),
        "back at the root",
      );
      // The root remembers Effects; `/` jumps to Automation by name.
      await t.send("/automation");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("menu › Automation"),
        "automation",
      );
      await t.send("/cutoff");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("add points"), "lane menu");
      await t.send("/add");
      await t.send("\r");
      for (const key of "2:800") await t.send(key);
      await t.send("\r");
      await waitFor(async () => {
        const points = (await bass())?.filterAutomation ?? [];
        return points.length === 1 && points[0]!.value === 800;
      }, "automation in session");
      // The new point is listed with its beat and value.
      await t.until(() => t.vt.text().includes("beat 2"), "point row");

      // Esc closes the menu; the prompt takes text again.
      for (let i = 0; i < 3; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
      await t.send("abc");
      await t.until(() => t.vt.text().includes("abc"), "typing");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
