/**
 * Sample fitting end to end in a real PTY, offline: a synthesized break is
 * added as a sampler voice, `/bpm` gives it its tempo, `/fitmode` with no
 * mode listens and suggests `beats`, `/len` sets a length, and the fields
 * land in the document; the ctrl-k menu shows the voice's fit rows.
 */
import { expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeWav } from "../src/audio/wav.ts";
import { launch, supported } from "./pty-harness.ts";

type Voice = { bpm?: number; fitmode?: string; len?: number };
type Doc = {
  tracks?: { id: string; sampler?: { voices: Record<string, Voice> } }[];
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
  for (const path of found) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      composition?: Doc;
    };
    if (parsed.composition?.tracks) return parsed.composition;
  }
  return {};
}

/** Two bars of eighth-note clicks at 174 BPM: sharp, sparse, high crest. */
function breakWav(): Uint8Array {
  const rate = 44_100;
  const beat = (rate * 60) / 174;
  const frames = Math.round(beat * 8);
  const pcm = new Int16Array(frames);
  for (let hit = 0; hit < 16; hit += 1) {
    const at = Math.round((hit * beat) / 2);
    for (let i = 0; i < 1500 && at + i < frames; i += 1) {
      const env = Math.exp(-i / 150);
      // Deterministic: a fixed sine burst, no randomness.
      pcm[at + i] = Math.round(
        26_000 * env * Math.sin((2 * Math.PI * 180 * i) / rate),
      );
    }
  }
  return encodeWav(pcm, rate);
}

test.skipIf(!supported)(
  "real PTY: /bpm, /fitmode (suggested) and /len fit a sampler voice",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "drums"]);
    try {
      await writeFile(join(t.cwd, "brk.wav"), breakWav());
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("/sample brk.wav as brk\r");
      await t.until(() => t.vt.text().includes("brk"), "sample receipt");
      await Bun.sleep(300);

      await t.send("/fitmode beats\r");
      await t.until(
        () => t.vt.text().includes("needs the sample's tempo"),
        "fitmode needs a tempo",
      );
      await t.send("/bpm 174\r");
      await t.until(() => t.vt.text().includes("bpm 174"), "bpm receipt");
      await t.send("/fitmode\r");
      await t.until(
        () => t.vt.text().includes("suggested from the sound"),
        "suggested fitmode",
      );
      expect(t.vt.text()).toContain("fitmode beats");
      await t.send("/len 8\r");
      await t.until(() => t.vt.text().includes("len 8"), "len receipt");

      let voice: Voice | undefined;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const doc = await composition(t.cwd);
        const track = doc.tracks?.find((item) => item.sampler?.voices.brk);
        voice = track?.sampler?.voices.brk;
        if (voice?.len === 8) break;
        await Bun.sleep(50);
      }
      expect(voice).toMatchObject({ bpm: 174, fitmode: "beats", len: 8 });

      // A bare `bpm 150` stays song tempo and says where the sample's is.
      await t.send("bpm 150\r");
      await t.until(
        () => t.vt.text().includes("own tempo is /bpm 150"),
        "bare bpm is song tempo",
      );

      // The ctrl-k menu filters straight to the voice's fit rows.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Sound"), "menu");
      await t.send("/fitmode");
      await t.until(() => t.vt.text().includes("fitmode"), "fit row");
      await t.send("\u001b");
      await t.send("\u001b");
    } finally {
      await t.send("\u0003");
      await Promise.race([t.proc.exited, Bun.sleep(5000)]);
      t.proc.kill();
      t.terminal.close();
    }
  },
  30_000,
);
