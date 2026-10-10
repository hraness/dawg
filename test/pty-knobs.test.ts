/**
 * The four knobs end to end in a real PTY (design §4 idea 6, §8): bare
 * `volume` opens the fader drawer on its knob page, ↑↓ picks a knob, ←→
 * turns it, Tab pages to every param, Enter keeps the change as a typed
 * command; `mix` opens the mixer page; the header reads bar.beat and the
 * loop range. At 80x24 and a wider size, in colour and under NO_COLOR.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const LEFT = "\u001b[D";

type Track = { id: string; volume?: number; pan?: number };

/** The tracks in the newest composition record under `.dawg/`. */
async function sessionTracks(cwd: string): Promise<Track[] | undefined> {
  const found: { path: string; mtime: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json"))
        found.push({ path, mtime: (await Bun.file(path).stat()).mtimeMs });
    }
  };
  await walk(join(cwd, ".dawg"));
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { path } of found) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as { composition?: { tracks?: Track[] } };
    if (parsed.composition?.tracks) return parsed.composition.tracks;
  }
  return undefined;
}

async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const SIZES = [
  [80, 24],
  [120, 32],
] as const;

describe.skipIf(!supported)("real PTY: four knobs", () => {
  for (const [cols, rows] of SIZES) {
    test(`${cols}x${rows}: volume opens the knobs, ↑↓ picks, ←→ turns, tab pages, enter keeps`, async () => {
      const t = await launch(cols, rows, { COLORTERM: "truecolor" });
      try {
        await t.until(() => t.vt.text().includes(" NOW "), "prompt", 15_000);
        // The header: transport, bar.beat, then the track.
        expect(t.vt.lines()[0]).toMatch(/120 BPM · 1\.1 · bass/);
        await t.send("volume\r");
        await t.until(() => t.vt.text().includes("◆›volume"), "knob page");
        const text = t.vt.text();
        for (const knob of ["● pan", "▲ reverb mix", "■ filter cutoff"])
          expect(text).toContain(knob);
        expect(text).toContain("↑↓ knob · ←→ turn");
        // Each glyph wears its knob colour: blue and orange differ.
        const blue = t.vt.findRow("● pan");
        const orange = t.vt.findRow("◆›volume");
        const fg = (row: number, glyph: string) =>
          t.vt.cell(t.vt.lines()[row]!.indexOf(glyph), row).style.fg;
        expect(fg(blue, "●")).toBeDefined();
        expect(fg(blue, "●")).not.toBe(fg(orange, "◆"));
        // ↑ picks the white knob; ↓ comes back to orange and ← turns it.
        await t.send(UP);
        await t.until(() => t.vt.text().includes("■›filter cutoff"), "white");
        await t.send(DOWN);
        await t.send(LEFT);
        await t.until(() => t.vt.text().includes("staged"), "staged turn");
        // Tab pages to every param and back.
        await t.send("\t");
        await t.until(() => t.vt.text().includes("tab knobs"), "all params");
        await t.send("\t");
        await t.until(() => t.vt.text().includes("tab all"), "knobs again");
        await t.send("\r");
        await waitFor(
          async () =>
            ((await sessionTracks(t.cwd))?.find((x) => x.id === "bass")
              ?.volume ?? 1) < 1,
          "volume kept",
        );
      } finally {
        t.terminal.close();
        t.proc.kill();
      }
    }, 40_000);

    test(`${cols}x${rows}: mix opens the mixer page, one orange level per track`, async () => {
      const t = await launch(cols, rows, { COLORTERM: "truecolor" });
      try {
        await t.until(() => t.vt.text().includes(" NOW "), "prompt", 15_000);
        await t.send("track drums\r");
        await t.until(() => t.vt.lines()[0]!.includes("drums"), "drums");
        await t.send("mix\r");
        await t.until(() => t.vt.text().includes("Mix › mixer"), "mixer");
        expect(t.vt.text()).toMatch(/◆ ?.?1 bass/);
        expect(t.vt.text()).toMatch(/◆.?.?2.?drums/);
        // ↑ to bass and ← turns bass down: the focus stays on drums.
        await t.send(UP);
        await t.send(LEFT);
        await t.send("\r");
        await waitFor(
          async () =>
            ((await sessionTracks(t.cwd))?.find((x) => x.id === "bass")
              ?.volume ?? 1) < 1,
          "bass level kept",
        );
        expect(t.vt.lines()[0]).toContain("drums");
      } finally {
        t.terminal.close();
        t.proc.kill();
      }
    }, 40_000);
  }

  test("NO_COLOR at 80x24: the glyphs carry every knob, and the loop shows in the header", async () => {
    const t = await launch(80, 24, { NO_COLOR: "1" });
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt", 15_000);
      await t.send("bars 8\r");
      await t.send("loop 5-6\r");
      await t.until(() => t.vt.lines()[0]!.includes("↻ 5–6"), "loop range");
      await t.send("synth\r");
      await t.until(() => t.vt.text().includes("≡ Sound"), "sound knobs");
      const text = t.vt.text();
      for (const glyph of ["●", "▲", "■", "◆"]) expect(text).toContain(glyph);
      const row = t.vt.findRow("◆ volume");
      const at = t.vt.lines()[row]!.indexOf("◆");
      expect(t.vt.cell(at, row).style.fg).toBeUndefined();
    } finally {
      t.terminal.close();
      t.proc.kill();
    }
  }, 40_000);
});
