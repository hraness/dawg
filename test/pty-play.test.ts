/**
 * Play mode end to end: Ctrl-P enters, keys record into the focused track
 * through the session, Esc leaves and normal typing works again.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

/** Every note in the newest session record under `.dawg/`. */
async function sessionNotes(
  cwd: string,
): Promise<{ trackId: string; pitch: number; startTick: number }[]> {
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
      composition?: {
        notes?: { trackId: string; pitch: number; startTick: number }[];
      };
    };
    if (parsed.composition?.notes) return parsed.composition.notes;
  }
  return [];
}

test.skipIf(!supported)(
  "real PTY: play mode header, record a pass, leave with Esc",
  async () => {
    const t = await launch(100, 28, {});
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/count-in 0\r");
      await t.until(
        () => t.vt.text().includes("count-in · 0 bars"),
        "count-in",
      );

      await t.send("\u0010");
      // Bass sits an octave low; the strip shows the keys.
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      expect(t.vt.text()).toContain("C2–F3");
      expect(t.vt.text()).toContain("A C2");

      // Octave and velocity keys update the header in place.
      await t.send("x");
      await t.until(() => t.vt.text().includes("C3–F4"), "octave up");
      await t.send("z");
      await t.until(() => t.vt.text().includes("C2–F3"), "octave down");
      await t.send("c");
      await t.until(() => t.vt.text().includes("vel 84"), "velocity");

      // Arm, start, play two notes, stop: one recorded pass.
      await t.send("r");
      await t.until(() => t.vt.text().includes("rec armed"), "armed");
      await t.send(" ");
      await t.until(() => t.vt.text().includes("REC"), "recording");
      await t.send("a");
      await Bun.sleep(300);
      await t.send("g");
      await Bun.sleep(200);
      await t.send(" ");
      await t.until(
        () => t.vt.text().includes("recorded 2 notes"),
        "record receipt",
      );
      const notes = (await sessionNotes(t.cwd)).filter(
        (note) => note.trackId === "bass",
      );
      expect(notes.map((note) => note.pitch).sort()).toEqual([36, 43]);

      // Esc leaves; letters type into the prompt again.
      await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("PLAY "), "left play");
      await t.send("asdf");
      await t.until(() => t.vt.text().includes("asdf"), "typing");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  20_000,
);
