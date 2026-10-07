/**
 * Sample packs against a local HTTP fixture server: no network. Built-in
 * catalog URLs are redirected to the fixture through the store's `fetch`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  type TrackScore,
} from "../../core/score.ts";
import { dc, wavBytes } from "./sample-fixtures.ts";
import {
  BANK_ALIASES_URL,
  NO_LICENSE,
  STRUDEL_BANK_ALIASES,
  bankAliasIndex,
  resolveBankAlias,
  PACK_CATALOG,
  PackError,
  PackStore,
  checkFetchUrl,
  creditsLine,
  kitFromBank,
  packCredits,
  packNameFromSource,
  parseManifest,
  resolveManifestUrl,
  withWavComment,
  writeCredits,
  type FetchLike,
} from "./packs.ts";
import { SampleLibrary, sampleKey } from "./samples.ts";
import {
  DEFAULT_ASSETS_CACHE_BYTES,
  DEFAULT_PACKS_CACHE_BYTES,
  assetsCacheMax,
  formatBytes,
  packsCacheMax,
  parseByteSize,
} from "./cache.ts";
import {
  kitListLines,
  parseKitCommand,
  parsePackCommand,
  useKit,
  useSound,
} from "../commands/pack.ts";
import { PACK_TOOLS } from "../agent/pack-tools.ts";

const dirs: string[] = [];
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

let server: ReturnType<typeof Bun.serve>;
let origin = "";
const hits: string[] = [];
const WAV = wavBytes(dc(480, 0.25));
const WAV2 = wavBytes(dc(960, 0.5));
let swapped = false;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      hits.push(url.pathname);
      const path = url.pathname;
      const json = (value: unknown) => Response.json(value);
      if (path === "/kit/strudel.json")
        return json({
          _base: `${origin}/kit/files/`,
          bd: ["bd/kick one.wav", "bd/kick2.wav"],
          sd: "sd/snare.wav",
          hh: ["hh/hat.wav"],
        });
      if (
        path === "/user/repo/main/strudel.json" ||
        path === "/user/repo/dev/strudel.json"
      )
        return json({ _base: "files/", cp: ["clap.wav"] });
      if (path === "/tdm.json")
        return json({
          _base: `${origin}/tdm/`,
          RolandTR909_bd: ["909/bd.wav"],
          RolandTR909_sd: ["909/sd.wav"],
          RolandTR909_hh: ["909/hh.wav", "909/hh2.wav"],
          RolandTR909_oh: ["909/oh.wav"],
          RolandTR808_bd: ["808/bd.wav"],
          RolandTR808_sd: ["808/sd.wav"],
        });
      if (path === "/piano.json")
        return json({
          _base: `${origin}/piano/`,
          piano: { A0: "A0.wav", C4: "C4.wav", A4: "A4.wav" },
        });
      if (path === "/gm/names.json") return json(["acoustic_grand_piano"]);
      if (path === "/alias.json")
        return json({
          RolandTR909: "TR909",
          RolandTR808: "TR808",
          LinnDrum: "LD",
          junk: 7,
        });
      if (path === "/big.wav")
        return new Response(new Uint8Array(70 * 1024 * 1024));
      if (path === "/slow.json")
        return new Promise((resolve) =>
          setTimeout(() => resolve(json({})), 2_000),
        );
      if (path.endsWith(".wav") || path.endsWith(".mp3"))
        return new Response(
          (swapped && path.includes("kick2")
            ? WAV2
            : WAV) as unknown as BodyInit,
        );
      return new Response("nope", { status: 404 });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** Redirects the built-in catalog URLs (and github raw) to the fixture. */
const redirect: FetchLike = (input, init) => {
  const url = String(input)
    .replace(
      "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json",
      `${origin}/tdm.json`,
    )
    .replace(
      "https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json",
      `${origin}/piano.json`,
    )
    .replace(
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/",
      `${origin}/gm/`,
    )
    .replace("https://raw.githubusercontent.com/", `${origin}/`)
    .replace(BANK_ALIASES_URL, `${origin}/alias.json`);
  if (!url.startsWith(origin)) throw new Error(`test fetched ${url}`);
  return fetch(url, init);
};

async function store(options: { offline?: boolean; dir?: string } = {}) {
  return new PackStore({
    dir: options.dir ?? (await temp("dawg-packs-")),
    allowLoopbackHttp: true,
    fetch: redirect,
    timeoutMs: 1_000,
    ...(options.offline ? { offline: true } : {}),
  });
}

function drumScore(): TrackScore {
  return createScore({
    tracks: [{ id: "drums", name: "drums", instrument: "drums" }],
  });
}

function apply(score: TrackScore, operations: readonly unknown[]): TrackScore {
  let next = score;
  for (const operation of operations)
    next = applyScoreOperation(next, operation as never);
  return next;
}

describe("manifest URLs", () => {
  test("github shorthand resolves like Strudel (main by default, branch optional)", () => {
    expect(resolveManifestUrl("github:tidalcycles/dirt-samples")).toBe(
      "https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json",
    );
    expect(resolveManifestUrl("github:user/repo/dev")).toBe(
      "https://raw.githubusercontent.com/user/repo/dev/strudel.json",
    );
    expect(resolveManifestUrl("https://example.com/pack/")).toBe(
      "https://example.com/pack/strudel.json",
    );
    expect(resolveManifestUrl("https://example.com/x.json")).toBe(
      "https://example.com/x.json",
    );
    expect(() => resolveManifestUrl("github:user/../etc")).toThrow(PackError);
    expect(packNameFromSource("github:tidalcycles/Dirt-Samples")).toBe(
      "dirt-samples",
    );
    expect(packNameFromSource("https://x.org/a/strudel.json")).toBe("a");
  });

  test("HTTPS only, no credentials, loopback HTTP only when allowed", () => {
    expect(() => checkFetchUrl("http://example.com/a.json")).toThrow(PackError);
    expect(() => checkFetchUrl("https://u:p@example.com/a.json")).toThrow(
      PackError,
    );
    expect(() => checkFetchUrl("file:///etc/passwd")).toThrow(PackError);
    expect(() => checkFetchUrl("http://127.0.0.1:1/a.json")).toThrow(PackError);
    expect(checkFetchUrl("http://127.0.0.1:1/a.json", true).hostname).toBe(
      "127.0.0.1",
    );
    expect(checkFetchUrl("https://example.com/a.json").protocol).toBe("https:");
  });

  test("parses lists, single files, note maps and relative _base", () => {
    const manifest = parseManifest(
      {
        _base: "samples/",
        bd: ["a.wav", "b.wav"],
        sd: "s.wav",
        keys: { C4: "c4.wav", A3: ["a3.wav"] },
        _x: 1,
      },
      "https://example.com/pack/strudel.json",
    );
    expect(manifest.base).toBe("https://example.com/pack/samples/");
    expect(manifest.sounds.get("bd")).toEqual({
      kind: "list",
      files: ["a.wav", "b.wav"],
    });
    expect(manifest.sounds.get("sd")).toEqual({
      kind: "list",
      files: ["s.wav"],
    });
    const keys = manifest.sounds.get("keys");
    expect(keys?.kind).toBe("zones");
    expect(keys?.kind === "zones" && keys.zones.map((z) => z.note)).toEqual([
      57, 60,
    ]);
    expect(() => parseManifest([], "https://e.com/x.json")).toThrow(PackError);
  });

  test("the catalog lists every pack with a manifest URL and license", () => {
    const names = PACK_CATALOG.map((pack) => pack.name);
    for (const name of [
      "tidal-drum-machines",
      "dirt-samples",
      "uzu-drumkit",
      "vcsl",
      "gm",
    ])
      expect(names).toContain(name);
    for (const pack of PACK_CATALOG) {
      expect(pack.manifestUrl.startsWith("https://")).toBe(true);
      expect(pack.license.length).toBeGreaterThan(0);
    }
    expect(PACK_CATALOG.find((p) => p.name === "vcsl")!.license).toBe(
      "CC0-1.0",
    );
    expect(PACK_CATALOG.find((p) => p.name === "dirt-samples")!.license).toBe(
      NO_LICENSE,
    );
  });
});

describe("pack store", () => {
  test("add fetches only the manifest; files come lazily, once", async () => {
    const packs = await store();
    hits.length = 0;
    const { pack, sounds } = await packs.add(`${origin}/kit/strudel.json`);
    expect(pack.name).toBe("kit");
    expect(sounds).toBe(3);
    expect(hits).toEqual(["/kit/strudel.json"]);
    expect((await packs.list()).map((p) => p.name)).toContain("kit");

    const resolved = await packs.resolve("pack:kit/bd:1");
    expect(resolved.url).toBe(`${origin}/kit/files/bd/kick2.wav`);
    expect(hits).toEqual(["/kit/strudel.json"]);
    // n wraps like Strudel's s("bd:n"); spaces are percent-encoded.
    expect((await packs.resolve("pack:kit/bd:2")).url).toBe(
      `${origin}/kit/files/bd/kick%20one.wav`,
    );

    const pinned = await packs.pin("pack:kit/bd:1");
    expect(pinned).toMatchObject({
      src: "pack:kit/bd:1",
      url: `${origin}/kit/files/bd/kick2.wav`,
      license: NO_LICENSE,
      sha256: createHash("sha256").update(WAV).digest("hex"),
    });
    await packs.pin("pack:kit/bd:1");
    expect(hits.filter((h) => h.endsWith("kick2.wav"))).toHaveLength(1);

    // The index lives in the pack dir; a second store sees the pack offline.
    const index = JSON.parse(
      await readFile(join(packs.dir, "index.json"), "utf8"),
    );
    expect(index.packs.kit.source).toBe(`${origin}/kit/strudel.json`);
    const offline = await store({ offline: true, dir: packs.dir });
    hits.length = 0;
    const again = await offline.pin("pack:kit/bd:1");
    expect(again.sha256).toBe(pinned.sha256);
    expect(hits).toEqual([]);
    await expect(offline.pin("pack:kit/sd")).rejects.toThrow("offline");

    expect(await packs.remove("kit")).toBe(true);
    expect((await packs.list()).map((p) => p.name)).not.toContain("kit");
  });

  test("github shorthand with a branch", async () => {
    const packs = await store();
    const { pack } = await packs.add("github:user/repo/dev", { name: "claps" });
    expect(pack.manifestUrl).toBe(
      "https://raw.githubusercontent.com/user/repo/dev/strudel.json",
    );
    expect((await packs.resolve("pack:claps/cp")).url).toBe(
      "https://raw.githubusercontent.com/user/repo/dev/files/clap.wav",
    );
  });

  test("refuses oversize files, slow servers, plain HTTP and missing sounds", async () => {
    const packs = await store();
    await expect(packs.fetchFile(`${origin}/big.wav`)).rejects.toThrow(
      PackError,
    );
    await expect(packs.add(`${origin}/slow.json`)).rejects.toThrow(PackError);
    const strict = new PackStore({
      dir: await temp("dawg-packs-"),
      fetch: redirect,
    });
    await expect(strict.add(`${origin}/kit/strudel.json`)).rejects.toThrow(
      PackError,
    );
    await expect(
      packs.resolve("pack:tidal-drum-machines/nope"),
    ).rejects.toThrow("no sound");
    await expect(
      packs.add("https://x.org/a.json", { name: "vcsl" }),
    ).rejects.toThrow("built-in");
  });

  test("a pinned file that changed upstream is an error, not a silent swap", async () => {
    const packs = await store();
    await packs.add(`${origin}/kit/strudel.json`);
    const pinned = await packs.pin("pack:kit/bd:1");
    swapped = true;
    try {
      const fresh = await store({ dir: await temp("dawg-packs-") });
      await expect(fresh.fetchFile(pinned.url!, pinned.sha256)).rejects.toThrow(
        "changed upstream",
      );
    } finally {
      swapped = false;
    }
  });
});

describe("kits and instruments", () => {
  test("kitFromBank maps Strudel banks to dawg drum voices", async () => {
    const packs = await store();
    const kit = await kitFromBank("RolandTR909", packs);
    expect(kit?.pack).toBe("tidal-drum-machines");
    expect(kit?.license).toBe(NO_LICENSE);
    expect(Object.fromEntries(kit!.voices)).toEqual({
      kick: "pack:tidal-drum-machines/RolandTR909_bd",
      snare: "pack:tidal-drum-machines/RolandTR909_sd",
      hat: "pack:tidal-drum-machines/RolandTR909_hh",
      openhat: "pack:tidal-drum-machines/RolandTR909_oh",
    });
    expect((await kitFromBank("808", packs))?.bank).toBe("RolandTR808");
    expect((await kitFromBank("tr808", packs))?.bank).toBe("RolandTR808");
    expect(await kitFromBank("nope", packs)).toBeUndefined();
  });

  test("/kit pins every voice and drum hits keep playing", async () => {
    const packs = await store();
    const result = await useKit(packs, drumScore(), "drums", "909");
    const score = apply(drumScore(), result.operations);
    const track = score.tracks.find((t) => t.id === "drums")!;
    expect(track.instrument).toBe("sampler");
    expect(track.sampler?.mode).toBe("oneshot");
    const kick = track.sampler!.voices.kick!;
    expect(kick.src).toBe("pack:tidal-drum-machines/RolandTR909_bd");
    expect(kick.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(kick.url).toBe(`${origin}/tdm/909/bd.wav`);
    expect(kick.license).toBe(NO_LICENSE);
    expect(result.summary).toContain("RolandTR909");

    // Pinned in the document: survives a JSON round trip unchanged.
    const again = scoreFromJSON(JSON.parse(JSON.stringify(score.toJSON())));
    expect(
      again.tracks.find((t) => t.id === "drums")!.sampler!.voices.kick,
    ).toEqual(kick);
  });

  test("old documents without pack fields still decode", () => {
    const score = scoreFromJSON({
      tracks: [
        {
          id: "s",
          name: "s",
          instrument: "sampler",
          sampler: {
            mode: "oneshot",
            voices: { kick: { src: "tracks/s/samples/k.wav" } },
          },
        },
      ],
    });
    expect(score.tracks[0]!.sampler!.voices.kick).toEqual({
      src: "tracks/s/samples/k.wav",
    });
  });

  test("keyed instruments: piano note map and gm_ soundfont names", async () => {
    const packs = await store();
    const piano = await useSound(packs, drumScore(), "keys", "piano/piano");
    const score = apply(drumScore(), piano.operations);
    const keys = score.tracks.find((t) => t.id === "keys")!;
    expect(keys.sampler?.mode).toBe("keyed");
    expect(Object.values(keys.sampler!.voices).map((v) => v.root)).toEqual([
      21, 60, 69,
    ]);
    expect(piano.license).toBe("CC-BY-3.0");

    const gm = await packs.resolve("pack:gm/gm_acoustic_grand_piano:Db4");
    expect(gm.url).toBe(
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/Db4.mp3",
    );
    expect(gm.root).toBe(61);
    const zones = await useSound(
      packs,
      drumScore(),
      "gm",
      "gm/gm_acoustic_grand_piano",
    );
    const voices = apply(drumScore(), zones.operations).tracks.find(
      (t) => t.id === "gm",
    )!.sampler!.voices;
    expect(Object.keys(voices).length).toBeGreaterThan(10);
    expect(Object.keys(voices).length).toBeLessThanOrEqual(64);
  });

  test("one oneshot voice from a sound with an index", async () => {
    const packs = await store();
    await packs.add(`${origin}/kit/strudel.json`);
    const result = await useSound(packs, drumScore(), "perc", "kit/bd:1");
    const track = apply(drumScore(), result.operations).tracks.find(
      (t) => t.id === "perc",
    )!;
    expect(Object.keys(track.sampler!.voices)).toEqual(["bd_1"]);
    expect(track.sampler!.voices.bd_1!.src).toBe("pack:kit/bd:1");
  });
});

describe("bank nicknames", () => {
  test("Strudel's alias snapshot resolves nicknames like Strudel", () => {
    expect(resolveBankAlias("TR909")).toBe("RolandTR909");
    expect(resolveBankAlias("tr909")).toBe("RolandTR909");
    expect(resolveBankAlias("TR808")).toBe("RolandTR808");
    expect(resolveBankAlias("Linn")).toBe("AkaiLinn");
    expect(resolveBankAlias("DMX")).toBe("OberheimDMX");
    expect(resolveBankAlias("sp12")).toBe("EmuSP12");
    expect(resolveBankAlias("MPC60")).toBe("AkaiMPC60");
    expect(resolveBankAlias("RolandTR909")).toBeUndefined();
    expect(Object.keys(STRUDEL_BANK_ALIASES).length).toBe(66);
    // Every nickname is distinct, so resolution never depends on order.
    const lower = Object.values(STRUDEL_BANK_ALIASES).map((v) =>
      v.toLowerCase(),
    );
    expect(new Set(lower).size).toBe(lower.length);
    // Malformed entries in a fetched file are dropped.
    const index = bankAliasIndex({ Good: "G", "bad name": "B", n: 3 });
    expect([...index.exact]).toEqual([["G", "Good"]]);
  });

  test("/kit, /pack use and pinned refs accept nicknames; short names still work", async () => {
    const packs = await store();
    // Exact-case Strudel nickname, any-case nickname, dawg short name.
    for (const name of ["TR909", "tr909", "909", "RolandTR909"])
      expect((await kitFromBank(name, packs))?.bank).toBe("RolandTR909");
    expect((await kitFromBank("TR808", packs))?.bank).toBe("RolandTR808");
    expect(await kitFromBank("TR707", packs)).toBeUndefined();

    // Bank nickname inside a pack ref, and as a sound prefix.
    const kit = await useSound(
      packs,
      drumScore(),
      "drums",
      "tidal-drum-machines/TR909",
    );
    expect(kit.summary).toContain("kit RolandTR909 on drums");
    const one = await useSound(
      packs,
      drumScore(),
      "perc",
      "tidal-drum-machines/tr808_sd",
    );
    const perc = apply(drumScore(), one.operations).tracks.find(
      (t) => t.id === "perc",
    )!;
    // Pins are canonical, so the document never depends on alias data.
    expect(perc.sampler!.voices.sd!.src).toBe(
      "pack:tidal-drum-machines/RolandTR808_sd",
    );
    const resolved = await packs.resolve("pack:tidal-drum-machines/TR909_hh:1");
    expect(resolved.src).toBe("pack:tidal-drum-machines/RolandTR909_hh:1");

    // The fetched alias file overlays the snapshot.
    const aliases = await packs.bankAliases("tidal-drum-machines");
    expect(resolveBankAlias("LD", aliases)).toBe("LinnDrum");
    expect(aliases.nicknames.get("RolandTR909")).toBe("TR909");
    expect((await packs.bankAliases("dirt-samples")).exact.size).toBe(0);
  });

  test("/kit list shows nicknames", async () => {
    const packs = await store();
    const lines = kitListLines(await packs.bankAliases("tidal-drum-machines"));
    expect(lines).toContain("909 · RolandTR909 · tidal-drum-machines");
    expect(lines).toContain("TR909 · RolandTR909 · tidal-drum-machines");
    expect(lines).toContain("SP12 · EmuSP12 · tidal-drum-machines");
    expect(parseKitCommand("/kit list")).toEqual({ kind: "list" });
    expect(parseKitCommand("/kit tr909")).toEqual({
      kind: "set",
      bank: "tr909",
    });
  });
});

describe("cache caps", () => {
  test("sizes parse with binary units; env overrides the defaults", () => {
    expect(parseByteSize("2GiB")).toBe(2 * 1024 ** 3);
    expect(parseByteSize("512M")).toBe(512 * 1024 ** 2);
    expect(parseByteSize("1.5g")).toBe(1.5 * 1024 ** 3);
    expect(parseByteSize("4096")).toBe(4096);
    expect(parseByteSize("-1")).toBeUndefined();
    expect(parseByteSize("lots")).toBeUndefined();
    expect(packsCacheMax({})).toBe(DEFAULT_PACKS_CACHE_BYTES);
    expect(DEFAULT_PACKS_CACHE_BYTES).toBe(2 * 1024 ** 3);
    expect(assetsCacheMax({})).toBe(DEFAULT_ASSETS_CACHE_BYTES);
    expect(DEFAULT_ASSETS_CACHE_BYTES).toBe(1024 ** 3);
    expect(packsCacheMax({ DAWG_PACKS_CACHE_MAX: "300M" })).toBe(
      300 * 1024 ** 2,
    );
    expect(assetsCacheMax({ DAWG_ASSETS_CACHE_MAX: "junk" })).toBe(
      DEFAULT_ASSETS_CACHE_BYTES,
    );
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
    expect(parsePackCommand("/pack cache")).toEqual({ kind: "cache" });
    expect(parsePackCommand("/pack cache prune")).toEqual({
      kind: "cache",
      pruneTo: "cap",
    });
    expect(parsePackCommand("/pack cache prune 100M")).toEqual({
      kind: "cache",
      pruneTo: 100 * 1024 ** 2,
    });
    expect(parsePackCommand("/pack cache clear")).toEqual({
      kind: "cache",
      pruneTo: 0,
    });
  });

  test("LRU eviction never evicts the open project's pins; evicted files re-fetch by sha256", async () => {
    const dir = await temp("dawg-packs-lru-");
    const packs = new PackStore({
      dir,
      allowLoopbackHttp: true,
      fetch: redirect,
      timeoutMs: 1_000,
      // Room for about two of the fixture files.
      maxFileCacheBytes: WAV.byteLength * 2 + 10,
    });
    const kit = await useKit(packs, drumScore(), "drums", "909");
    const score = apply(drumScore(), kit.operations);
    const projectRoot = await temp("dawg-packs-lru-project-");
    const library = new SampleLibrary({ projectRoot, packs });
    expect((await library.load(score)).problems).toEqual([]);
    const pinned = Object.values(
      score.tracks.find((t) => t.id === "drums")!.sampler!.voices,
    );
    const pinnedFiles = new Set(
      pinned.map(
        (ref) => `${createHash("sha256").update(ref.url!).digest("hex")}.bin`,
      ),
    );
    expect(pinnedFiles.size).toBe(4);
    // Make every pinned file present (pinning a kit over a tiny cap may
    // already have evicted some; protected now, they come back and stay).
    for (const ref of pinned) await packs.fetchFile(ref.url!, ref.sha256);
    const present = async () => new Set(await readdir(join(dir, "files")));
    for (const name of pinnedFiles)
      expect((await present()).has(name)).toBe(true);

    // Fetching other sounds goes over the cap: only unpinned files go.
    await packs.pin("pack:tidal-drum-machines/RolandTR808_bd");
    await packs.pin("pack:tidal-drum-machines/RolandTR808_sd");
    const files = await present();
    for (const name of pinnedFiles) expect(files.has(name)).toBe(true);
    expect(files.size).toBeLessThanOrEqual(pinnedFiles.size + 1);

    // A prune to zero clears everything but the pins.
    const status = await packs.cacheStatus();
    expect(status.max).toBe(WAV.byteLength * 2 + 10);
    const pruned = await packs.pruneCache(0);
    expect(await present()).toEqual(pinnedFiles);
    expect(pruned.bytes).toBe(WAV.byteLength * 4);

    // Once another project opens, the old pins can go; a re-render then
    // re-fetches them transparently and checks the pinned sha256.
    packs.protect([]);
    expect((await packs.pruneCache(0)).removed).toBe(4);
    hits.length = 0;
    const fresh = await temp("dawg-packs-lru-fresh-");
    const again = await new SampleLibrary({ projectRoot: fresh, packs }).load(
      score,
    );
    expect(again.problems).toEqual([]);
    // Every voice decodes to the same fixture PCM, so one fetch suffices.
    expect(
      hits.filter((h) => h.startsWith("/tdm/909/")).length,
    ).toBeGreaterThan(0);
    expect((await present()).size).toBeGreaterThan(0);
  });

  test("decoded assets in use survive pruning", async () => {
    const packs = await store();
    const kit = await useKit(packs, drumScore(), "drums", "909");
    const score = apply(drumScore(), kit.operations);
    const projectRoot = await temp("dawg-packs-assets-");
    // Room for one decoded fixture file (16-byte header + 480 floats).
    const library = new SampleLibrary({
      projectRoot,
      packs,
      maxCacheBytes: 16 + 480 * 4,
    });
    expect((await library.load(score)).problems).toEqual([]);
    const assets = join(projectRoot, ".dawg", "assets");
    // Four pins, one unique PCM (the fixture serves the same WAV bytes).
    const before = await readdir(assets);
    expect(before.length).toBeGreaterThan(0);
    expect((await library.pruneCache(0)).removed).toBe(0);
    expect(await readdir(assets)).toEqual(before);
    expect((await library.cacheStatus()).files).toBe(before.length);
  });
});

describe("rendering and credits", () => {
  test("SampleLibrary plays pinned pack voices offline from the asset cache", async () => {
    const packs = await store();
    const result = await useKit(packs, drumScore(), "drums", "909");
    const score = apply(drumScore(), result.operations);
    const projectRoot = await temp("dawg-packs-project-");
    const library = new SampleLibrary({ projectRoot, packs });
    const bank = await library.load(score);
    expect(bank.problems).toEqual([]);
    expect(bank.voices.get(sampleKey("drums", "kick"))?.frames).toBeGreaterThan(
      0,
    );
    expect(
      (await readdir(join(projectRoot, ".dawg", "assets"))).length,
    ).toBeGreaterThan(0);

    // A fresh process with no pack cache and no network still renders.
    hits.length = 0;
    const offline = new SampleLibrary({
      projectRoot,
      packs: await store({ offline: true }),
    });
    const cached = await offline.load(score);
    expect(cached.problems).toEqual([]);
    expect(
      cached.voices.get(sampleKey("drums", "kick"))?.frames,
    ).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  test("CREDITS.md names CC-BY packs only; WAV comment carries all packs", async () => {
    const packs = await store();
    const piano = await useSound(packs, drumScore(), "keys", "piano/piano");
    const kit = await useKit(packs, drumScore(), "drums", "909");
    const score = apply(apply(drumScore(), kit.operations), piano.operations);
    const refs = score.tracks.flatMap((t) =>
      Object.values(t.sampler?.voices ?? {}),
    );
    const credits = packCredits(refs, await packs.list());
    const project = await temp("dawg-packs-credits-");
    await writeCredits(project, credits);
    const text = await readFile(join(project, "CREDITS.md"), "utf8");
    expect(text).toContain("Salamander Grand Piano");
    expect(text).not.toContain("tidal-drum-machines");
    const line = creditsLine(credits)!;
    expect(line).toContain("Salamander");
    expect(line).toContain("tidal-drum-machines (none stated)");

    const tagged = withWavComment(WAV, `samples: ${line}`);
    expect(new TextDecoder().decode(tagged.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(tagged.buffer).getUint32(4, true)).toBe(
      tagged.byteLength - 8,
    );
    expect(new TextDecoder().decode(tagged)).toContain("ICMT");

    const none = await temp("dawg-packs-credits-");
    await writeCredits(
      none,
      packCredits(
        kit.operations.length
          ? refs.filter((r) => r.license === NO_LICENSE)
          : [],
        await packs.list(),
      ),
    );
    await expect(readFile(join(none, "CREDITS.md"), "utf8")).rejects.toThrow();
  });
});

describe("agent tools", () => {
  const context = () => ({
    score: drumScore(),
    focusedTrackId: "drums",
    revision: 1,
    newNoteId: (trackId: string, index: number) => `${trackId}-${index}`,
  });
  const tool = (name: string) => PACK_TOOLS.find((t) => t.name === name)!;

  test("list_packs, search_sounds, use_sound", async () => {
    const packs = await store();
    const listed = tool("list_packs").plan({}, context());
    if (listed.kind !== "action") throw new Error("expected action");
    const list = JSON.parse((await listed.run({ packs })).content);
    expect(list.packs.map((p: { name: string }) => p.name)).toContain(
      "tidal-drum-machines",
    );

    const searched = tool("search_sounds").plan(
      { query: "909 bd", pack: "tidal-drum-machines" },
      context(),
    );
    if (searched.kind !== "action") throw new Error("expected action");
    const found = JSON.parse((await searched.run({ packs })).content);
    expect(found.matches[0].src).toBe(
      "pack:tidal-drum-machines/RolandTR909_bd",
    );

    const used = tool("use_sound").plan({ sound: "808" }, context());
    if (used.kind !== "prepare") throw new Error("expected prepare");
    const plan = await used.run({ packs });
    expect(plan.kind).toBe("score");
    const score = apply(context().score, plan.operations);
    expect(score.tracks[0]!.sampler!.voices.kick!.src).toBe(
      "pack:tidal-drum-machines/RolandTR808_bd",
    );
    expect(() => tool("use_sound").plan({ sound: "" }, context())).toThrow();
  });
});
