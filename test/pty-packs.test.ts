/**
 * Sample packs end to end in a real PTY, with no network: a local fixture
 * server stands in for the pack host and the built-in tidal-drum-machines
 * manifest is pre-seeded in the pack cache. `/kit 909` pins the kit, play
 * mode shows its voices and records a hit through the sampler path, and
 * `/pack add` + `/pack use` adds one sound from a Strudel-format manifest.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACK_CATALOG } from "../src/audio/packs.ts";
import { dc, wavBytes } from "../src/audio/sample-fixtures.ts";
import { launch, supported } from "./pty-harness.ts";

let server: ReturnType<typeof Bun.serve> | undefined;
let origin = "";

beforeAll(() => {
  if (!supported) return;
  const wav = wavBytes(dc(480, 0.25));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/extra/strudel.json")
        return Response.json({
          _base: `${origin}/files/`,
          cowbell: ["cb.wav"],
        });
      if (path.endsWith(".wav"))
        return new Response(wav as unknown as BodyInit);
      return new Response("nope", { status: 404 });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

let cwd = "";
afterAll(async () => {
  server?.stop(true);
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

/** The newest session composition under `.dawg/`. */
async function composition(cwd: string): Promise<{
  tracks?: {
    id: string;
    instrument?: string;
    sampler?: {
      voices: Record<
        string,
        { src: string; sha256?: string; license?: string }
      >;
    };
  }[];
  notes?: { trackId: string; pitch: number }[];
}> {
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
      composition?: Awaited<ReturnType<typeof composition>>;
    };
    if (parsed.composition?.tracks) return parsed.composition;
  }
  return {};
}

test.skipIf(!supported)(
  "real PTY: /kit 909 from a pack, play mode hits it, /pack add + use",
  async () => {
    cwd = await mkdtemp(join(tmpdir(), "dawg-pty-packs-"));
    const packDir = join(cwd, "packs");
    // Seed the built-in drum machine manifest (as a previous run would have).
    const tdm = PACK_CATALOG.find(
      (pack) => pack.name === "tidal-drum-machines",
    )!;
    await mkdir(join(packDir, "manifests"), { recursive: true });
    await writeFile(
      join(packDir, "manifests", "tidal-drum-machines.json"),
      JSON.stringify({
        url: tdm.manifestUrl,
        body: JSON.stringify({
          _base: `${origin}/tdm/`,
          RolandTR909_bd: ["909/bd.wav"],
          RolandTR909_sd: ["909/sd.wav"],
          RolandTR909_hh: ["909/hh.wav"],
        }),
      }),
    );

    const t = await launch(
      110,
      30,
      { DAWG_PACKS_DIR: packDir, DAWG_PACKS_ALLOW_LOOPBACK_HTTP: "1" },
      ["--track", "drums"],
      cwd,
    );
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/count-in 0\r");
      await t.until(
        () => t.vt.text().includes("count-in · 0 bars"),
        "count-in",
      );

      await t.send("/kit 909\r");
      await t.until(
        () => t.vt.text().includes("kit RolandTR909 on drums"),
        "kit receipt",
      );
      let doc = await composition(cwd);
      const drums = doc.tracks?.find((track) => track.id === "drums");
      expect(drums?.instrument).toBe("sampler");
      expect(drums?.sampler?.voices.kick?.src).toBe(
        "pack:tidal-drum-machines/RolandTR909_bd",
      );
      expect(drums?.sampler?.voices.kick?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(drums?.sampler?.voices.kick?.license).toBe("none stated");
      // No license gating anywhere.
      expect(t.vt.text()).not.toContain("personal use");

      // Play mode: voices sit on the keys (hat, kick, snare from A).
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play header");
      await t.send("r");
      await t.until(() => t.vt.text().includes("rec armed"), "armed");
      await t.send(" ");
      await t.until(() => t.vt.text().includes("REC"), "recording");
      await t.send("w"); // second slot: kick
      await Bun.sleep(250);
      await t.send(" ");
      await t.until(
        () => t.vt.text().includes("recorded 1 note"),
        "record receipt",
      );
      doc = await composition(cwd);
      expect(
        doc.notes
          ?.filter((note) => note.trackId === "drums")
          .map((n) => n.pitch),
      ).toEqual([37]);
      expect(t.vt.text()).not.toContain("sample kick");
      await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("PLAY "), "left play");

      // A pack by manifest URL, then one of its sounds as a new voice.
      await t.send(`/pack add ${origin}/extra/strudel.json\r`);
      await t.until(
        () => t.vt.text().includes("pack added · extra · 1 sounds"),
        "pack added",
      );
      await t.send("/pack use extra/cowbell\r");
      await t.until(() => t.vt.text().includes("cowbell on drums"), "pack use");
      doc = await composition(cwd);
      expect(
        doc.tracks?.find((track) => track.id === "drums")?.sampler?.voices
          .cowbell?.src,
      ).toBe("pack:extra/cowbell");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
