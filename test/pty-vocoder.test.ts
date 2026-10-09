/**
 * The vocoder (0.7) in a real PTY, offline: `/vocoder` with no voice prints
 * the Entry guidance and changes nothing, `instrument vocoder` plus
 * `/vocoder robot` and a band override land in the document, and ctrl-k
 * Effects › Voice › Vocoder shows the Source and Preset rows.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    vocoder?: Record<string, unknown>;
  }[];
};

async function composition(cwd: string): Promise<Doc> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  let best: { revision: number; doc: Doc } | undefined;
  for (const path of found) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
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
  "real PTY: /vocoder entry guidance, instrument vocoder, Effects › Voice › Vocoder",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/vocoder\r");
      await t.until(
        () => t.vt.text().includes("no voice to vocode yet"),
        "entry guidance",
      );
      expect(t.vt.text()).toContain("/vocal import <file.wav>");

      await t.send("instrument vocoder\r");
      await waitFor(
        async () => (await lead(t.cwd))?.instrument === "vocoder",
        "carrier instrument",
      );
      await t.send("/vocoder robot\r");
      await t.send("/vocoder bands 16\r");
      await waitFor(
        async () => (await lead(t.cwd))?.vocoder?.bands === 16,
        "bands in session",
      );
      expect((await lead(t.cwd))?.vocoder).toEqual({
        preset: "robot",
        bands: 16,
      });

      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Effects"), "effects");
      await t.send("/Voice");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("Vocoder"), "voice group");
      await t.send("/Vocoder");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("preset"), "vocoder rows");
      expect(t.vt.text()).toContain("source");
      expect(t.vt.text()).toContain("robot");
      for (let i = 0; i < 4; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
      expect(t.vt.text()).not.toContain("error");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  40_000,
);
