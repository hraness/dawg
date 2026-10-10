/**
 * Wavetable tracks end to end in a real PTY, offline: `/wt pwm` turns the
 * focused track into a wavetable track (a built-in table, no fetch), the
 * position and warp commands land in the document, and play mode records
 * notes onto it through the same live path the other instruments use.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    wavetable?: { table: { src: string }; wt?: number; warpmode?: string };
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
  "real PTY: /wt picks a built-in table, shapes it, and play mode records onto it",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/count-in 0\r");
      await t.until(
        () => t.vt.text().includes("count-in · 0 bars"),
        "count-in",
      );
      await t.send("/wt pwm\r");
      await t.until(
        () => t.vt.text().includes("wavetable · pwm"),
        "table receipt",
      );
      await t.send("/wt 0.6\r");
      await t.until(() => t.vt.text().includes("wt · 0.6"), "position");
      await t.send("/warpmode sync\r");
      await t.until(() => t.vt.text().includes("warpmode · sync"), "warp");

      let doc = await composition(t.cwd);
      const lead = doc.tracks?.find((track) => track.id === "lead");
      expect(lead?.instrument).toBe("wavetable");
      expect(lead?.wavetable).toEqual({
        table: { src: "builtin:pwm" },
        wt: 0.6,
        warpmode: "sync",
      });

      // Play mode on the wavetable track: arm, play two keys, stop.
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      // A pitched wavetable track defaults to auto chords; q plays single notes.
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
      doc = await composition(t.cwd);
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
  20_000,
);
