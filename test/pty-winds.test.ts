/**
 * Gamelan and winds end to end in a real PTY, offline: `wind trumpet` and a
 * breath override land in the document, the ctrl-k Sound › browse sounds ›
 * Winds and brass group switches preset, play mode records a note through
 * the live path, and the Mallets and bells › Gamelan group picks a bronze.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    modal?: { preset?: string; pair?: string };
    wind?: { preset?: string; breath?: number };
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
  "real PTY: wind trumpet, Winds and brass menu, play mode, Gamelan menu",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/count-in 0\r");
      await t.until(() => t.vt.text().includes("count-in · 0 bars"), "count");
      await t.send("wind trumpet\r");
      await t.until(
        () => t.vt.text().includes("wind · preset trumpet"),
        "preset receipt",
      );
      await t.send("wind breath 0.8\r");
      await t.until(() => t.vt.text().includes("breath 0.8"), "breath");
      await waitFor(
        async () => (await lead(t.cwd))?.wind?.breath === 0.8,
        "breath in session",
      );
      const track = await lead(t.cwd);
      expect(track?.instrument).toBe("wind");
      expect(track?.wind).toEqual({ preset: "trumpet", breath: 0.8 });

      // ctrl-k → Sound › browse sounds › Winds and brass › Flutes → flute.
      await t.send("/menu sounds\r");
      await t.until(() => t.vt.text().includes("Winds and brass"), "group");
      await t.send("/Winds");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Flutes"), "families");
      await t.send("/Flutes");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("concert flute"), "flutes");
      await t.send("/flute");
      await t.send("\r");
      await waitFor(
        async () => (await lead(t.cwd))?.wind?.preset === "flute",
        "flute in session",
      );
      for (let i = 0; i < 8 && t.vt.text().includes("╭─ menu"); i++) {
        await t.send("\u001b");
        await Bun.sleep(150);
      }
      await t.until(() => !t.vt.text().includes("╭─ menu"), "menu closed");

      // Play mode on the wind track: arm, play a key, stop.
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
      await t.until(() => t.vt.text().includes("STEER"), "prompt again");

      // ctrl-k → Sound › browse sounds › Mallets and bells › Gamelan → gangsa.
      await t.send("/menu sounds\r");
      await t.until(() => t.vt.text().includes("Mallets and bells"), "mallets");
      await t.send("/Mallets");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Gamelan"), "gamelan group");
      await t.send("/Gamelan");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Balinese"), "bronzes");
      await t.send("/gangsa");
      await t.send("\r");
      await waitFor(
        async () => (await lead(t.cwd))?.modal?.preset === "gangsa",
        "gangsa in session",
      );
      expect((await lead(t.cwd))?.instrument).toBe("modal");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  90_000,
);
