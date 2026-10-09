/**
 * Granular end to end in a real PTY, offline: `grain cloud` turns the
 * focused synth track into a grain cloud of its own sound, a parameter
 * override lands in the document, the ctrl-k Granular group switches
 * presets, and play mode records onto it through the live path.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    granular?: Record<string, number | string | boolean>;
  }[];
  notes?: { trackId: string; pitch: number }[];
};

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
  for (const path of found) {
    const parsed = JSON.parse(
      await readFile(path, "utf8").catch(() => "{}"),
    ) as {
      composition?: Doc;
    };
    if (parsed.composition?.tracks) return parsed.composition;
  }
  return {};
}

test.skipIf(!supported)(
  "real PTY: grain presets, a parameter, the Granular menu and play mode",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    const lead = async () =>
      (await composition(t.cwd)).tracks?.find((track) => track.id === "lead");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/count-in 0\r");
      await t.until(
        () => t.vt.text().includes("count-in · 0 bars"),
        "count-in",
      );
      await t.send("grain cloud\r");
      await t.until(() => t.vt.text().includes("grain · cloud"), "preset");
      await t.send("grain scan 0.5\r");
      await t.until(() => t.vt.text().includes("scan 0.5"), "param");
      expect(await lead()).toMatchObject({
        instrument: "granular",
        granular: { preset: "cloud", scan: 0.5 },
      });

      // ctrl-k > Sound > browse sounds > Granular > swarm.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Sound"), "sound");
      await t.send("/browse");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Granular"), "browse");
      await t.send("/Granular");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("swarm"), "granular group");
      await t.send("/swarm");
      await t.send("\r");
      for (
        let i = 0;
        i < 20 && (await lead())?.granular?.preset !== "swarm";
        i++
      )
        await Bun.sleep(100);
      // A preset replaces the overrides; the lead's own synth stays the source.
      expect((await lead())?.granular?.preset).toBe("swarm");
      expect((await lead())?.granular?.scan).toBeUndefined();
      for (let i = 0; i < 6; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");

      // Play mode on the granular track: arm, play two keys, stop.
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      await t.send("q");
      await t.until(() => t.vt.text().includes("MANUAL"), "manual");
      await t.send("r");
      await t.until(() => t.vt.text().includes("rec armed"), "armed");
      await t.send(" ");
      await t.until(() => t.vt.text().includes("REC"), "recording");
      await t.send("a");
      await Bun.sleep(300);
      await t.send("d");
      await Bun.sleep(200);
      await t.send(" ");
      await t.until(
        () => t.vt.text().includes("recorded 2 notes"),
        "record receipt",
      );
      const doc = await composition(t.cwd);
      expect(
        (doc.notes ?? []).filter((note) => note.trackId === "lead"),
      ).toHaveLength(2);
      expect(t.vt.text()).not.toContain("error");
      await t.send("\u001b");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
