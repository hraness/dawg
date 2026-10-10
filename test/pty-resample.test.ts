/**
 * Resample, sample shift/fade and grain play end to end in a real PTY,
 * offline: a note on a pluck track is resampled to a sampler track and a
 * granular track, the sampler voice is shifted with formants kept and given
 * a fade, the granular track is synced to the grid, and the ctrl-k menu
 * shows Project › Resample and the Sample and granular rows.
 */
import { expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Voice = {
  src?: string;
  sha256?: string;
  shift?: number;
  formant?: number;
  fadeTime?: number;
  from?: { source: string; score: string };
};
type Track = {
  id: string;
  instrument?: string;
  sampler?: { voices: Record<string, Voice> };
  granular?: Record<string, unknown>;
};
type Doc = { tracks?: Track[] };

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

async function waitFor(
  cwd: string,
  ok: (doc: Doc) => boolean,
  ms = 4000,
): Promise<Doc> {
  const deadline = Date.now() + ms;
  let doc: Doc = {};
  while (Date.now() < deadline) {
    doc = await composition(cwd);
    if (ok(doc)) return doc;
    await Bun.sleep(50);
  }
  return doc;
}

test.skipIf(!supported)(
  "real PTY: resample, shift, fade and grain sync",
  async () => {
    const t = await launch(110, 30, {}, ["--track", "lead"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("add C4 at 0\r");
      await Bun.sleep(400);
      await t.send("resample lead as stem\r");
      await t.until(() => t.vt.text().includes("stem"), "resample receipt");
      let doc = await waitFor(t.cwd, (d) =>
        Boolean(d.tracks?.some((track) => track.id === "stem")),
      );
      const stem = doc.tracks?.find((track) => track.id === "stem");
      const voice = Object.values(stem?.sampler?.voices ?? {})[0];
      expect(voice?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice?.from?.source).toBe("track:lead");
      expect(
        (await stat(join(t.cwd, "tracks", "stem", voice!.src!))).size,
      ).toBeGreaterThan(44);

      await t.send("shift 7 formant keep\r");
      await t.send("fade out 0.5\r");
      doc = await waitFor(t.cwd, (d) => {
        const v = Object.values(
          d.tracks?.find((track) => track.id === "stem")?.sampler?.voices ?? {},
        )[0];
        return v?.shift === 7 && v.formant === 0 && v.fadeTime === 0.5;
      });
      const shifted = Object.values(
        doc.tracks?.find((track) => track.id === "stem")?.sampler?.voices ?? {},
      )[0];
      expect(shifted).toMatchObject({ shift: 7, formant: 0, fadeTime: 0.5 });

      await t.send("resample lead grain as cloud\r");
      await waitFor(t.cwd, (d) =>
        Boolean(d.tracks?.some((track) => track.id === "cloud")),
      );
      await t.send("grain sync 1/16\r");
      doc = await waitFor(
        t.cwd,
        (d) =>
          d.tracks?.find((track) => track.id === "cloud")?.granular?.sync ===
          "1/16",
      );
      expect(
        doc.tracks?.find((track) => track.id === "cloud")?.granular?.sync,
      ).toBe("1/16");

      // The ctrl-k menu filters to the granular sync row and to Resample.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Sound"), "menu");
      await t.send("/sync");
      await t.until(() => t.vt.text().includes("sync"), "sync row");
      await t.send("\u001b");
      await t.send("\u001b");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Sound"), "menu again");
      await t.send("/resample");
      await t.until(() => /[Rr]esample/.test(t.vt.text()), "resample row");
      await t.send("\u001b");
      await t.send("\u001b");
    } finally {
      await t.send("\u0003");
      await Promise.race([t.proc.exited, Bun.sleep(5000)]);
      t.proc.kill();
      t.terminal.close();
    }
  },
  40_000,
);
