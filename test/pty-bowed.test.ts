/**
 * Bowed strings end to end in a real PTY, offline (0.6.1): `bowed violin`
 * turns the focused track into a bowed string track, a bow parameter lands
 * in the document, ctrl-k Strings > Bowed switches presets, and play mode
 * records a slurred pair onto it through the live path.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";
import { budget } from "./perf.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    string?: Record<string, number | string>;
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
  "real PTY: bowed presets, a bow parameter, Strings > Bowed and play mode",
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
      await t.send("bowed violin\r");
      await t.until(() => t.vt.text().includes("string · violin"), "preset");
      await t.send("bowed pressure 0.7\r");
      await t.until(() => t.vt.text().includes("pressure 0.7"), "param");
      expect(await lead()).toMatchObject({
        instrument: "string",
        string: { preset: "violin", pressure: 0.7 },
      });

      // ctrl-k > Sound > browse sounds > Strings > Bowed > cellos.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Sound"), "sound");
      await t.send("/instruments");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("strings"), "browse");
      await t.send("/strings");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("koto"), "strings group");
      await t.send("/Bowed");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("cellos"), "bowed group");
      await t.send("/cellos");
      await t.send("\r");
      for (
        let i = 0;
        i < 20 && (await lead())?.string?.preset !== "cellos";
        i++
      )
        await Bun.sleep(100);
      expect((await lead())?.string).toEqual({ preset: "cellos" });
      for (let i = 0; i < 7; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");

      // Play mode on the bowed track: arm, play two overlapping keys, stop.
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      await t.send("q");
      await t.until(() => t.vt.text().includes("MANUAL"), "manual");
      await t.send("r");
      await t.until(() => t.vt.text().includes("rec armed"), "armed");
      await t.send(" ");
      await t.until(() => t.vt.text().includes("REC"), "recording");
      const started = performance.now();
      await t.send("a");
      await Bun.sleep(300);
      await t.send("d");
      await Bun.sleep(200);
      await t.send(" ");
      await t.until(
        () => t.vt.text().includes("recorded 2 notes"),
        "record receipt",
      );
      expect(performance.now() - started).toBeLessThan(budget(5_000));
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
