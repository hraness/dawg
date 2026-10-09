/**
 * 0.7 pitch lane in a real PTY, offline: three notes on the lead are
 * resampled to a sampler voice, `/vocal pitch` reports their median and
 * range, the trace turns on, Sound > Voice > Pitch shows the detected key,
 * and `/vocal notes` adds a guide-notes track with the same pitches.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: { id: string }[];
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

async function waitFor(cwd: string, ok: (doc: Doc) => boolean): Promise<Doc> {
  const deadline = Date.now() + 5000;
  let doc: Doc = {};
  while (Date.now() < deadline) {
    doc = await composition(cwd);
    if (ok(doc)) return doc;
    await Bun.sleep(50);
  }
  return doc;
}

test.skipIf(!supported)(
  "real PTY: /vocal pitch, trace, Sound > Voice > Pitch and /vocal notes",
  async () => {
    const t = await launch(110, 34, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("add C4 at 0 for 2\r");
      await Bun.sleep(300);
      await t.send("add E4 at 2 for 2\r");
      await Bun.sleep(300);
      await t.send("add G4 at 4 for 3\r");
      await Bun.sleep(300);
      await t.send("resample lead as stem\r");
      await waitFor(t.cwd, (d) =>
        Boolean(d.tracks?.some((track) => track.id === "stem")),
      );
      await t.send("/vocal pitch trace on\r");
      await t.until(() => t.vt.text().includes("trace · on"), "pitch report");
      expect(t.vt.text()).toMatch(/median [CDEFG]#?4/);
      expect(t.vt.text()).toMatch(/range C4[^\n]* to G4/);

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Sound"), "sound");
      await t.send("/Pitch");
      await t.until(
        () => /Voice\s+[^\n]*Pitch/.test(t.vt.text()),
        "voice group",
      );
      for (let i = 0; i < 6 && !/› Voice\s/.test(t.vt.text()); i++) {
        await t.send("\u001b[B");
        await Bun.sleep(100);
      }
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("menu › Sound › Voice"),
        "voice",
      );
      expect(t.vt.text()).toMatch(/Pitch\s+[a-g]#? (major|minor) · E4/);
      // Clips and Lyrics (clips lane) sit above Pitch in Sound › Voice.
      for (let i = 0; i < 6 && !/› Pitch\s/.test(t.vt.text()); i++) {
        await t.send("\u001b[B");
        await Bun.sleep(100);
      }
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Make notes"), "pitch rows");
      expect(t.vt.text()).toContain("Make notes");
      for (let i = 0; i < 5; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");

      await t.send("/vocal notes\r");
      const doc = await waitFor(t.cwd, (d) =>
        Boolean(d.tracks?.some((track) => track.id === "stem-notes")),
      );
      const pitches = (doc.notes ?? [])
        .filter((note) => note.trackId === "stem-notes")
        .map((note) => note.pitch);
      expect(pitches).toEqual([60, 64, 67]);
      expect(t.vt.text()).not.toContain("error");
    } finally {
      await t.send("\u0003");
      await Promise.race([t.proc.exited, Bun.sleep(5000)]);
      t.proc.kill();
      t.terminal.close();
    }
  },
  40_000,
);
