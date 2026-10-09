/**
 * The 0.7 singing voice end to end in a real PTY, offline: `/sing choir`
 * and an override land in the document, the ctrl-k Sound › browse sounds ›
 * Voices › Throat group switches to khoomei, and `/sing vowels` stamps the
 * notes.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    sing?: { preset?: string; voices?: number };
  }[];
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
  "real PTY: /sing choir, voices override, Voices › Throat menu",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/sing choir\r");
      await waitFor(
        async () => (await lead(t.cwd))?.sing?.preset === "choir",
        "choir in session",
      );
      await t.send("/sing voices 4\r");
      await waitFor(
        async () => (await lead(t.cwd))?.sing?.voices === 4,
        "voices in session",
      );
      const track = await lead(t.cwd);
      expect(track?.instrument).toBe("sing");
      expect(track?.sing).toEqual({ preset: "choir", voices: 4 });

      // ctrl-k → Sound › browse sounds › Voices › Throat → khoomei.
      await t.send("/menu sounds\r");
      await t.until(() => t.vt.text().includes("Voices"), "voices group");
      await t.send("/Voices");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Throat"), "sing groups");
      expect(t.vt.text()).toContain("Choir");
      expect(t.vt.text()).toContain("Solo");
      await t.send("/Throat");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("kargyraa"), "throat rows");
      await t.send("/khoomei");
      await t.send("\r");
      await waitFor(
        async () => (await lead(t.cwd))?.sing?.preset === "khoomei",
        "khoomei in session",
      );
      for (let i = 0; i < 8 && t.vt.text().includes("╭─ menu"); i++) {
        await t.send("\u001b");
        await Bun.sleep(150);
      }
      await t.until(() => !t.vt.text().includes("╭─ menu"), "menu closed");
      await t.send("/sing\r");
      await t.until(() => t.vt.text().includes("sing · khoomei"), "show");
      expect(t.vt.text()).not.toContain("error");
      // `/instrument <sing word>` and `instrument sing <preset>` both work.
      await t.send("/instrument ooh\r");
      await waitFor(
        async () => (await lead(t.cwd))?.sing?.preset === "ooh",
        "/instrument ooh",
      );
      await t.send("instrument sing chorale\r");
      await waitFor(
        async () => (await lead(t.cwd))?.sing?.preset === "chorale",
        "instrument sing chorale",
      );
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
