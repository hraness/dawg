/**
 * 0.7 clips end to end in a real PTY, offline: `/vocal import` copies a WAV
 * into the project and places a clip at a bar, `/clip` edits its gain,
 * `/lyrics` sings words on the guide notes, and ctrl-k Sound > Voice >
 * Clips lists the clip with its rows.
 */
import { expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeWav } from "../src/audio/wav.ts";
import { launch, supported } from "./pty-harness.ts";

type Doc = {
  tracks?: {
    id: string;
    instrument?: string;
    clips?: {
      id: string;
      src: string;
      sha256: string;
      startTick: number;
      gain?: number;
    }[];
  }[];
  notes?: { trackId: string; pitch: number; lyric?: string }[];
  ticksPerBeat?: number;
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
  "real PTY: /vocal import, /clip gain, /lyrics and Sound > Voice > Clips",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "vox"]);
    const vox = async () =>
      (await composition(t.cwd)).tracks?.find((track) => track.id === "vox");
    try {
      const pcm = new Int16Array(48_000);
      for (let i = 0; i < pcm.length; i += 1)
        pcm[i] = Math.round(
          Math.sin((2 * Math.PI * 220 * i) / 48_000) * 0.9 * 32767,
        );
      await writeFile(join(t.cwd, "take.wav"), encodeWav(pcm, 48_000));

      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("instrument vocal\r");
      for (let i = 0; i < 20 && (await vox())?.instrument !== "vocal"; i++)
        await Bun.sleep(100);
      await t.send("/vocal import take.wav 3\r");
      // A ready 48 kHz mono WAV is copied in without ffmpeg; give a loaded
      // CI runner time for the copy and hash.
      await t.until(() => t.vt.text().includes("at bar 3"), "import", 15_000);
      expect(t.vt.text()).toContain("peak -6 dBFS");
      const imported = await vox();
      expect(imported?.instrument).toBe("vocal");
      expect(imported?.clips).toHaveLength(1);
      const clip = imported!.clips![0]!;
      expect(clip.src).toMatch(/^tracks\/vox\/samples\/.+\.wav$/);
      expect(clip.sha256).toMatch(/^[0-9a-f]{64}$/);
      await readFile(join(t.cwd, clip.src));

      await t.send(`/clip ${clip.id} gain -3\r`);
      await t.until(() => t.vt.text().includes(`clip ${clip.id}:`), "gain");
      for (
        let i = 0;
        i < 20 && (await vox())?.clips?.[0]?.gain === clip.gain;
        i++
      )
        await Bun.sleep(100);
      // `gain -3` is absolute dB: 10^(-3/20).
      expect((await vox())?.clips?.[0]?.gain).toBeCloseTo(0.7079, 3);

      await t.send("add C4 at 1\r");
      await Bun.sleep(200);
      await t.send("add E4 at 2\r");
      await Bun.sleep(400);
      await t.send("/lyrics hel-lo world\r");
      await t.until(() => t.vt.text().includes("lyrics on"), "lyrics");

      // ctrl-k > Voice > clips shows the clip.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Arrange"), "menu root");
      await t.send("/Voice");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Voice"), "voice");
      await t.send("/clips");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("import a file"), "clips rows");
      expect(t.vt.text()).toContain(clip.id);
      for (let i = 0; i < 6; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
      expect(t.vt.text()).not.toContain("error");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
