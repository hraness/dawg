/**
 * Sample packs: Strudel-style sample manifests used from dawg.
 *
 * A pack is a JSON manifest in the format Strudel's `samples(...)` reads
 * (`{"_base": url, sound: [files] | file | {note: file | [files]}}`) or the
 * `github:user/repo[/branch]` shorthand for `<repo>/<branch>/strudel.json`
 * (branch defaults to `main`). This is a clean-room loader for that public
 * format; no Strudel code is used.
 *
 * Manifests are fetched on first use and cached under
 * `$XDG_CACHE_HOME/dawg/packs` (default `~/.cache/dawg/packs`). Sample files
 * are fetched one at a time, only when a track first uses them, and kept in
 * `files/` by URL; decoded PCM then lands in the project's sha256 asset cache
 * like any other sample. With a cached manifest and files nothing touches the
 * network. Every pinned sound records its pack and license.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import {
  formatPackRef,
  isPinnedSampleUrl,
  parsePackRef,
  SCORE_LIMITS,
  type PackRef,
  type Sampler,
  type SampleRef,
} from "../../core/score.ts";
import {
  DRUM_VOICES,
  parseDrumVoice,
  type DrumVoice,
} from "../../core/drums.ts";

export const PACK_LIMITS = Object.freeze({
  maxManifestBytes: 8 * 1024 * 1024,
  maxSounds: 20_000,
  maxFilesPerSound: 1_024,
  maxFileNameLength: 512,
  fetchTimeoutMs: 30_000,
  maxRedirects: 4,
  /** Raw downloaded files; decoded PCM lives in the project asset cache. */
  maxFileCacheBytes: SCORE_LIMITS.maxSampleCacheBytes,
  /** Zones a keyed instrument keeps (the sampler voice limit). */
  maxZones: SCORE_LIMITS.maxSamplerVoices,
});

/** License label for packs whose repository states none. */
export const NO_LICENSE = "none stated";

export type PackKind = "strudel" | "gm";

export type PackInfo = Readonly<{
  /** Slug used in `pack:<name>/...`. */
  name: string;
  title: string;
  /** What the user typed: URL or `github:` shorthand. */
  source: string;
  /** Resolved HTTPS manifest URL. */
  manifestUrl: string;
  /** SPDX id, or `none stated`. */
  license: string;
  /** Attribution line for CC-BY / CC-BY-SA packs. */
  attribution?: string;
  homepage?: string;
  kind: PackKind;
  builtin: boolean;
}>;

/** `github:user/repo[/branch]` (Strudel's shorthand). */
const GITHUB =
  /^github:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\/([A-Za-z0-9_./-]{1,200}))?\/?$/;

const DOUGH = "https://raw.githubusercontent.com/felixroos/dough-samples/main";

/**
 * Packs dawg knows without `/pack add`. Manifest URLs are the ones Strudel's
 * default sample set loads (dough-samples hosts the drum-machine, VCSL,
 * piano and mridangam manifests; Dirt-Samples and uzu-drumkit ship their own
 * strudel.json). Licenses were read from each repository.
 */
export const PACK_CATALOG: readonly PackInfo[] = Object.freeze(
  (
    [
      {
        name: "tidal-drum-machines",
        title: "Tidal drum machines (TR-808, TR-909, LinnDrum, …)",
        source: `${DOUGH}/tidal-drum-machines.json`,
        license: NO_LICENSE,
        homepage: "https://github.com/ritchse/tidal-drum-machines",
        kind: "strudel",
      },
      {
        name: "dirt-samples",
        title: "TidalCycles Dirt-Samples",
        source: "github:tidalcycles/dirt-samples",
        license: NO_LICENSE,
        homepage: "https://github.com/tidalcycles/Dirt-Samples",
        kind: "strudel",
      },
      {
        name: "uzu-drumkit",
        title: "uzu drumkit",
        source: "github:tidalcycles/uzu-drumkit",
        license: "Unlicense",
        homepage: "https://github.com/tidalcycles/uzu-drumkit",
        kind: "strudel",
      },
      {
        name: "vcsl",
        title: "Versilian Community Sample Library",
        source: `${DOUGH}/vcsl.json`,
        license: "CC0-1.0",
        homepage: "https://github.com/sgossner/VCSL",
        kind: "strudel",
      },
      {
        name: "piano",
        title: "Salamander Grand Piano",
        source: `${DOUGH}/piano.json`,
        license: "CC-BY-3.0",
        attribution:
          "Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0, https://creativecommons.org/licenses/by/3.0/)",
        homepage: "https://archive.org/details/SalamanderGrandPianoV3",
        kind: "strudel",
      },
      {
        name: "mridangam",
        title: "Mridangam",
        source: `${DOUGH}/mridangam.json`,
        license: "CC-BY-SA-4.0",
        attribution:
          "Mridangam samples (c) Arthur Carabott 2022, performer Harishankar V Menon (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/)",
        homepage: "https://github.com/felixroos/dough-samples",
        kind: "strudel",
      },
      {
        name: "emu-sp12",
        title: "E-mu SP-12",
        source: `${DOUGH}/EmuSP12.json`,
        license: NO_LICENSE,
        homepage: "https://github.com/felixroos/dough-samples",
        kind: "strudel",
      },
      {
        name: "gm",
        title: "General MIDI soundfont (FluidR3_GM)",
        source:
          "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/names.json",
        license: "CC-BY-3.0",
        attribution:
          "FluidR3_GM soundfont by Frank Wen, via gleitz/midi-js-soundfonts (CC BY 3.0, https://creativecommons.org/licenses/by/3.0/)",
        homepage: "https://github.com/gleitz/midi-js-soundfonts",
        kind: "gm",
      },
      {
        name: "gm-musyngkite",
        title: "General MIDI soundfont (Musyng Kite)",
        source:
          "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json",
        license: "CC-BY-SA-3.0",
        attribution:
          "Musyng Kite soundfont, via gleitz/midi-js-soundfonts (CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/)",
        homepage: "https://github.com/gleitz/midi-js-soundfonts",
        kind: "gm",
      },
    ] as const
  ).map((entry) =>
    Object.freeze({
      ...entry,
      manifestUrl: resolveManifestUrl(entry.source),
      builtin: true,
    }),
  ),
);

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

// ---------------------------------------------------------------------------
// URLs

/**
 * Manifest URL for a pack source. `github:user/repo[/branch]` reads
 * `strudel.json` at the root of that branch (default `main`); a URL ending in
 * `/` gets `strudel.json` appended; anything else is used as is.
 */
export function resolveManifestUrl(source: string): string {
  const trimmed = source.trim();
  const github = GITHUB.exec(trimmed);
  if (github) {
    const [, user, repo, branch] = github;
    if (
      [user, repo, branch].some(
        (part) => part && /(^|\/)\.\.?(\/|$)/.test(part),
      )
    )
      throw new PackError(`${trimmed} · not a valid github: shorthand`);
    return `https://raw.githubusercontent.com/${user}/${repo}/${(branch ?? "main").replace(/\/$/, "")}/strudel.json`;
  }
  if (trimmed.startsWith("github:"))
    throw new PackError(
      `${trimmed.slice(0, 80)} · use github:<user>/<repo>[/<branch>]`,
    );
  return trimmed.endsWith("/") ? `${trimmed}strudel.json` : trimmed;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

/**
 * The URL rule for anything dawg downloads: HTTPS, no credentials, bounded;
 * plain HTTP only to loopback when the store allows it (tests).
 */
export function checkFetchUrl(value: string, allowLoopbackHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PackError(`${value.slice(0, 80)} · not a URL`);
  }
  if (url.username || url.password)
    throw new PackError(
      `${url.hostname} · credentials in URLs are not allowed · use a public URL`,
    );
  const loopbackHttp =
    url.protocol === "http:" &&
    allowLoopbackHttp &&
    isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp)
    throw new PackError(`${value.slice(0, 80)} · packs must use https://`);
  if (value.length > SCORE_LIMITS.maxSampleUrlLength)
    throw new PackError(
      `URL is over ${SCORE_LIMITS.maxSampleUrlLength} characters`,
    );
  return url;
}

// ---------------------------------------------------------------------------
// Manifests

export type ManifestZone = Readonly<{
  note: number;
  name: string;
  file: string;
}>;

export type ManifestSound =
  | Readonly<{ kind: "list"; files: readonly string[] }>
  | Readonly<{ kind: "zones"; zones: readonly ManifestZone[] }>;

export type Manifest = Readonly<{
  /** Absolute base URL files resolve against. */
  base: string;
  sounds: ReadonlyMap<string, ManifestSound>;
}>;

const SOUND_NAME = /^[A-Za-z0-9][A-Za-z0-9_.~+-]{0,127}$/;
const NOTE_NAME = /^([A-Ga-g])(#|s|b)?(-?[0-9])$/;
const PITCH_CLASS: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** MIDI number for a manifest note key (`A0`, `c4`, `Ds1`, `Bb3`). */
export function noteNumber(name: string): number | undefined {
  const match = NOTE_NAME.exec(name);
  if (!match) return undefined;
  const accidental = match[2] === "b" ? -1 : match[2] ? 1 : 0;
  const midi =
    (Number(match[3]) + 1) * 12 +
    PITCH_CLASS[match[1]!.toLowerCase()]! +
    accidental;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

function checkFileName(value: unknown, where: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PACK_LIMITS.maxFileNameLength ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new PackError(`${where} · file names must be short strings`);
  return value;
}

/** Parses a Strudel-format manifest; `manifestUrl` is the default base. */
export function parseManifest(json: unknown, manifestUrl: string): Manifest {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new PackError("manifest must be a JSON object of sounds");
  const record = json as Record<string, unknown>;
  let base = new URL(".", manifestUrl).href;
  if (record._base !== undefined) {
    if (typeof record._base !== "string")
      throw new PackError("manifest _base must be a URL string");
    base = new URL(record._base, manifestUrl).href;
  }
  if (!base.endsWith("/")) base += "/";
  const sounds = new Map<string, ManifestSound>();
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("_")) continue;
    if (!SOUND_NAME.test(key)) continue;
    if (sounds.size >= PACK_LIMITS.maxSounds)
      throw new PackError(
        `manifest has more than ${PACK_LIMITS.maxSounds} sounds`,
      );
    if (typeof value === "string")
      sounds.set(key, { kind: "list", files: [checkFileName(value, key)] });
    else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value.length > PACK_LIMITS.maxFilesPerSound)
        throw new PackError(
          `${key} has more than ${PACK_LIMITS.maxFilesPerSound} files`,
        );
      sounds.set(key, {
        kind: "list",
        files: Object.freeze(value.map((file) => checkFileName(file, key))),
      });
    } else if (typeof value === "object" && value !== null) {
      const zones: ManifestZone[] = [];
      for (const [name, file] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const note = noteNumber(name);
        if (note === undefined) continue;
        const first = Array.isArray(file) ? file[0] : file;
        zones.push({
          note,
          name,
          file: checkFileName(first, `${key}.${name}`),
        });
      }
      if (zones.length === 0) continue;
      if (zones.length > PACK_LIMITS.maxFilesPerSound)
        throw new PackError(
          `${key} has more than ${PACK_LIMITS.maxFilesPerSound} zones`,
        );
      zones.sort((a, b) => a.note - b.note);
      sounds.set(key, { kind: "zones", zones: Object.freeze(zones) });
    }
  }
  return Object.freeze({ base, sounds });
}

/** Notes every soundfont instrument in midi-js-soundfonts has (A0..C8). */
const GM_FILE_NOTES = (() => {
  const names = [
    "C",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "Gb",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ];
  const out: { note: number; name: string }[] = [];
  for (let midi = 21; midi <= 108; midi += 1)
    out.push({
      note: midi,
      name: `${names[midi % 12]}${Math.floor(midi / 12) - 1}`,
    });
  return out;
})();

/**
 * A soundfont pack from midi-js-soundfonts' `names.json` (a list of GM
 * instrument names): each becomes `gm_<name>`, a keyed sound with one MP3 per
 * note from A0 to C8.
 */
export function parseGmNames(json: unknown, manifestUrl: string): Manifest {
  if (!Array.isArray(json) || json.length > 512)
    throw new PackError("soundfont names.json must be a list of names");
  const base = new URL(".", manifestUrl).href;
  const sounds = new Map<string, ManifestSound>();
  for (const name of json) {
    if (typeof name !== "string" || !/^[a-z0-9_]{1,64}$/.test(name)) continue;
    sounds.set(`gm_${name}`, {
      kind: "zones",
      zones: Object.freeze(
        GM_FILE_NOTES.map(({ note, name: noteName }) => ({
          note,
          name: noteName,
          file: `${name}-mp3/${noteName}.mp3`,
        })),
      ),
    });
  }
  return Object.freeze({ base, sounds });
}

// ---------------------------------------------------------------------------
// Fetching

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * GET with the pack URL rule applied to the URL and every redirect, a
 * timeout, and a byte limit enforced while streaming.
 */
export async function fetchBounded(
  url: string,
  options: Readonly<{
    maxBytes: number;
    fetch?: FetchLike;
    timeoutMs?: number;
    allowLoopbackHttp?: boolean;
    signal?: AbortSignal;
  }>,
): Promise<Uint8Array> {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? PACK_LIMITS.fetchTimeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  let current = checkFetchUrl(url, options.allowLoopbackHttp).href;
  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await doFetch(current, {
        redirect: "manual",
        signal,
        headers: { accept: "*/*" },
      });
    } catch (error) {
      if (timeout.aborted)
        throw new PackError(`${shortUrl(current)} · timed out`);
      throw new PackError(
        `${shortUrl(current)} · ${error instanceof Error ? error.message.slice(0, 120) : "fetch failed"} · offline? cached sounds still play`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= PACK_LIMITS.maxRedirects)
        throw new PackError(`${shortUrl(current)} · too many redirects`);
      current = checkFetchUrl(
        new URL(location, current).href,
        options.allowLoopbackHttp,
      ).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PackError(`${shortUrl(current)} · HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > options.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new PackError(
        `${shortUrl(current)} · ${formatMiB(declared)} is over the ${formatMiB(options.maxBytes)} limit`,
      );
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader)
      for (;;) {
        let next: Awaited<ReturnType<typeof reader.read>>;
        try {
          next = await reader.read();
        } catch {
          throw new PackError(
            `${shortUrl(current)} · ${timeout.aborted ? "timed out" : "download interrupted"}`,
          );
        }
        if (next.done) break;
        total += next.value.byteLength;
        if (total > options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PackError(
            `${shortUrl(current)} · over the ${formatMiB(options.maxBytes)} limit`,
          );
        }
        chunks.push(next.value);
      }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

function shortUrl(url: string): string {
  return url.length > 96 ? `${url.slice(0, 93)}…` : url;
}

function formatMiB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Store

export function defaultPackDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DAWG_PACKS_DIR) return env.DAWG_PACKS_DIR;
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
  return join(cache, "dawg", "packs");
}

export type PackStoreOptions = Readonly<{
  /** Default `defaultPackDir()`. */
  dir?: string;
  fetch?: FetchLike;
  /** Allow `http://127.0.0.1` sources (tests); default `DAWG_PACKS_ALLOW_LOOPBACK_HTTP=1`. */
  allowLoopbackHttp?: boolean;
  /** Never touch the network; only cached manifests and files. */
  offline?: boolean;
  timeoutMs?: number;
}>;

/** A pack sound resolved to one concrete file. */
export type ResolvedSound = Readonly<{
  pack: string;
  sound: string;
  ref: PackRef;
  src: string;
  url: string;
  license: string;
  /** Keyed zones: the note the file plays at. */
  root?: number;
}>;

export type FetchedFile = Readonly<{
  url: string;
  sha256: string;
  bytes: Uint8Array;
  /** On-disk copy (ffmpeg decodes from it). */
  path: string;
  cached: boolean;
}>;

type IndexFile = {
  version: 1;
  packs: Record<
    string,
    Omit<PackInfo, "builtin" | "manifestUrl"> & { addedAt: string }
  >;
};

const PACK_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Slug for a pack added from `source` (`github:a/b` → `b`). */
export function packNameFromSource(source: string): string {
  const github = GITHUB.exec(source.trim());
  let raw: string;
  if (github) raw = github[2]!;
  else {
    let path = source;
    try {
      path = new URL(source).pathname;
    } catch {
      /* fall through */
    }
    const parts = path.split("/").filter(Boolean);
    let last = parts.pop() ?? "pack";
    if (/^strudel\.json$/i.test(last)) last = parts.pop() ?? "pack";
    raw = last.replace(/\.json$/i, "");
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
  return slug || "pack";
}

/**
 * The pack registry, manifest cache and raw file cache. Safe to share; all
 * state lives on disk and in small in-memory memos.
 */
export class PackStore {
  public readonly dir: string;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly allowLoopbackHttp: boolean;
  private readonly offline: boolean;
  private readonly timeoutMs: number;
  private readonly manifests = new Map<string, Promise<Manifest>>();
  private readonly inflight = new Map<string, Promise<FetchedFile>>();

  public constructor(options: PackStoreOptions = {}) {
    this.dir = options.dir ?? defaultPackDir();
    this.fetchImpl = options.fetch;
    this.allowLoopbackHttp =
      options.allowLoopbackHttp ??
      process.env.DAWG_PACKS_ALLOW_LOOPBACK_HTTP === "1";
    this.offline = options.offline ?? false;
    this.timeoutMs = options.timeoutMs ?? PACK_LIMITS.fetchTimeoutMs;
  }

  // -- registry -------------------------------------------------------------

  private async readIndex(): Promise<IndexFile> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.dir, "index.json"), "utf8"),
      ) as IndexFile;
      if (
        parsed?.version === 1 &&
        parsed.packs &&
        typeof parsed.packs === "object"
      )
        return parsed;
    } catch {
      /* missing or unreadable: empty registry */
    }
    return { version: 1, packs: {} };
  }

  private async writeIndex(index: IndexFile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, "index.json");
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`);
    await rename(temporary, path);
  }

  /** Built-in packs first, then added ones (an added name shadows none). */
  public async list(): Promise<PackInfo[]> {
    const index = await this.readIndex();
    const added = Object.entries(index.packs)
      .filter(
        ([name]) =>
          PACK_NAME.test(name) && !PACK_CATALOG.some((p) => p.name === name),
      )
      .map(([name, entry]) => this.fromIndex(name, entry))
      .filter((entry): entry is PackInfo => entry !== undefined)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    return [...PACK_CATALOG, ...added];
  }

  private fromIndex(
    name: string,
    entry: IndexFile["packs"][string],
  ): PackInfo | undefined {
    try {
      return Object.freeze({
        name,
        title: String(entry.title ?? name).slice(0, 120),
        source: String(entry.source),
        manifestUrl: resolveManifestUrl(String(entry.source)),
        license: String(entry.license ?? NO_LICENSE).slice(0, 64),
        ...(entry.attribution
          ? { attribution: String(entry.attribution).slice(0, 400) }
          : {}),
        ...(entry.homepage ? { homepage: String(entry.homepage) } : {}),
        kind: entry.kind === "gm" ? "gm" : "strudel",
        builtin: false,
      });
    } catch {
      return undefined;
    }
  }

  public async info(name: string): Promise<PackInfo | undefined> {
    return (await this.list()).find((pack) => pack.name === name);
  }

  /**
   * Registers a pack by manifest URL or `github:` shorthand, fetching its
   * manifest once to check it. Returns the pack and its sound count.
   */
  public async add(
    source: string,
    options: Readonly<{
      name?: string;
      license?: string;
      attribution?: string;
    }> = {},
  ): Promise<Readonly<{ pack: PackInfo; sounds: number }>> {
    const manifestUrl = resolveManifestUrl(source);
    checkFetchUrl(manifestUrl, this.allowLoopbackHttp);
    const name = options.name ?? packNameFromSource(source);
    if (!PACK_NAME.test(name))
      throw new PackError(
        `${name.slice(0, 40)} · pack names are lowercase a-z, 0-9, . _ -`,
      );
    if (PACK_CATALOG.some((pack) => pack.name === name))
      throw new PackError(
        `${name} is a built-in pack · pick another name with as <name>`,
      );
    const repo = GITHUB.exec(source.trim());
    const pack: PackInfo = Object.freeze({
      name,
      title: name,
      source: source.trim(),
      manifestUrl,
      license: options.license ?? NO_LICENSE,
      ...(options.attribution ? { attribution: options.attribution } : {}),
      ...(repo ? { homepage: `https://github.com/${repo[1]}/${repo[2]}` } : {}),
      kind: /\/names\.json$/.test(manifestUrl) ? "gm" : "strudel",
      builtin: false,
    });
    this.manifests.delete(name);
    const manifest = await this.loadManifest(pack, { refresh: true });
    const index = await this.readIndex();
    const { builtin: _builtin, manifestUrl: _url, ...stored } = pack;
    index.packs[name] = { ...stored, addedAt: new Date().toISOString() };
    await this.writeIndex(index);
    return { pack, sounds: manifest.sounds.size };
  }

  /** Forgets an added pack, or a built-in pack's cached manifest. */
  public async remove(name: string): Promise<boolean> {
    const index = await this.readIndex();
    const builtin = PACK_CATALOG.some((pack) => pack.name === name);
    const known = builtin || name in index.packs;
    if (name in index.packs) {
      delete index.packs[name];
      await this.writeIndex(index);
    }
    this.manifests.delete(name);
    await unlink(this.manifestPath(name)).catch(() => undefined);
    return known;
  }

  // -- manifests ------------------------------------------------------------

  private manifestPath(name: string): string {
    return join(this.dir, "manifests", `${name}.json`);
  }

  public async manifest(name: string): Promise<Manifest> {
    const pack = await this.info(name);
    if (!pack)
      throw new PackError(
        `no pack named ${name.slice(0, 64)} · /pack list shows the packs`,
      );
    return this.loadManifest(pack);
  }

  private loadManifest(
    pack: PackInfo,
    options: Readonly<{ refresh?: boolean }> = {},
  ): Promise<Manifest> {
    const memo = this.manifests.get(pack.name);
    if (memo && !options.refresh) return memo;
    const promise = this.readManifest(pack, options.refresh === true);
    this.manifests.set(pack.name, promise);
    promise.catch(() => this.manifests.delete(pack.name));
    return promise;
  }

  private async readManifest(
    pack: PackInfo,
    refresh: boolean,
  ): Promise<Manifest> {
    const path = this.manifestPath(pack.name);
    const parse = (text: string) => {
      const json: unknown = JSON.parse(text);
      return pack.kind === "gm"
        ? parseGmNames(json, pack.manifestUrl)
        : parseManifest(json, pack.manifestUrl);
    };
    if (!refresh) {
      try {
        const cached = JSON.parse(await readFile(path, "utf8")) as {
          url?: string;
          body?: string;
        };
        if (cached.url === pack.manifestUrl && typeof cached.body === "string")
          return parse(cached.body);
      } catch {
        /* not cached yet */
      }
    }
    if (this.offline)
      throw new PackError(
        `${pack.name} · manifest is not cached and dawg is offline`,
      );
    const bytes = await fetchBounded(pack.manifestUrl, {
      maxBytes: PACK_LIMITS.maxManifestBytes,
      timeoutMs: this.timeoutMs,
      allowLoopbackHttp: this.allowLoopbackHttp,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
    const body = new TextDecoder().decode(bytes);
    let manifest: Manifest;
    try {
      manifest = parse(body);
    } catch (error) {
      if (error instanceof PackError)
        throw new PackError(`${pack.name} · ${error.message}`);
      throw new PackError(`${pack.name} · manifest is not valid JSON`);
    }
    try {
      await mkdir(join(this.dir, "manifests"), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          url: pack.manifestUrl,
          fetchedAt: new Date().toISOString(),
          body,
        }),
      );
      await rename(temporary, path);
    } catch {
      /* the cache is an optimisation */
    }
    return manifest;
  }

  // -- sounds ---------------------------------------------------------------

  /** Resolves `pack:<pack>/<sound>[:<n>]` to one file URL (fetches the manifest if needed). */
  public async resolve(src: string | PackRef): Promise<ResolvedSound> {
    const ref = typeof src === "string" ? parsePackRef(src) : src;
    if (!ref)
      throw new PackError(
        `${String(src).slice(0, 80)} · use pack:<pack>/<sound>[:<n>]`,
      );
    const pack = await this.info(ref.pack);
    if (!pack)
      throw new PackError(
        `no pack named ${ref.pack} · /pack list shows the packs`,
      );
    const manifest = await this.loadManifest(pack);
    const sound =
      manifest.sounds.get(ref.sound) ?? caseInsensitive(manifest, ref.sound);
    if (!sound)
      throw new PackError(
        `${ref.pack} has no sound ${ref.sound} · /pack info ${ref.pack} lists them`,
      );
    const soundName = manifest.sounds.has(ref.sound)
      ? ref.sound
      : caseKey(manifest, ref.sound)!;
    let file: string;
    let root: number | undefined;
    if (sound.kind === "list") {
      const index = typeof ref.n === "number" ? ref.n : 0;
      file = sound.files[index % sound.files.length]!;
    } else {
      const wanted = typeof ref.n === "string" ? noteNumber(ref.n) : undefined;
      const zone =
        wanted !== undefined
          ? nearestZone(sound.zones, wanted)
          : sound.zones[(ref.n as number) % sound.zones.length]!;
      file = zone.file;
      root = zone.note;
    }
    const url = new URL(encodePath(file), manifest.base).href;
    checkFetchUrl(url, this.allowLoopbackHttp);
    const canonical: PackRef = Object.freeze({ ...ref, sound: soundName });
    return Object.freeze({
      pack: pack.name,
      sound: soundName,
      ref: canonical,
      src: formatPackRef(canonical),
      url,
      license: pack.license,
      ...(root !== undefined ? { root } : {}),
    });
  }

  /**
   * The bytes of one sample file: from `files/` when cached, else fetched
   * (once, even when many voices ask at the same time). Enforces the sample
   * file size limit. A pinned `sha256` that no longer matches is an error.
   */
  public fetchFile(url: string, expectSha256?: string): Promise<FetchedFile> {
    const key = `${url}\u0000${expectSha256 ?? ""}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = this.fetchFileOnce(url, expectSha256).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchFileOnce(
    url: string,
    expectSha256?: string,
  ): Promise<FetchedFile> {
    checkFetchUrl(url, this.allowLoopbackHttp);
    const filesDir = join(this.dir, "files");
    const path = join(filesDir, `${sha256Hex(url)}.bin`);
    try {
      const bytes = new Uint8Array(await readFile(path));
      const sha256 = sha256Hex(bytes);
      if (!expectSha256 || sha256 === expectSha256) {
        const now = new Date();
        await utimes(path, now, now).catch(() => undefined);
        return { url, sha256, bytes, path, cached: true };
      }
    } catch {
      /* not cached */
    }
    if (this.offline)
      throw new PackError(`${shortUrl(url)} · not cached and dawg is offline`);
    const bytes = await fetchBounded(url, {
      maxBytes: SCORE_LIMITS.maxSampleFileBytes,
      timeoutMs: this.timeoutMs,
      allowLoopbackHttp: this.allowLoopbackHttp,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
    if (bytes.byteLength === 0)
      throw new PackError(`${shortUrl(url)} · empty file`);
    const sha256 = sha256Hex(bytes);
    if (expectSha256 && sha256 !== expectSha256)
      throw new PackError(
        `${shortUrl(url)} · changed upstream (sha256 ${sha256.slice(0, 12)}… ≠ pinned ${expectSha256.slice(0, 12)}…) · re-pick the sound to pin the new file`,
      );
    try {
      await mkdir(filesDir, { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, path);
      await pruneFiles(filesDir, PACK_LIMITS.maxFileCacheBytes, path);
    } catch {
      /* read-only cache: still usable this once from memory */
    }
    return { url, sha256, bytes, path, cached: false };
  }

  /**
   * Resolves and fetches a pack sound and returns the pinned `SampleRef`
   * (src, sha256, url, license, and root for keyed zones).
   */
  public async pin(
    src: string | PackRef,
    extra: Partial<SampleRef> = {},
  ): Promise<SampleRef> {
    const resolved = await this.resolve(src);
    const file = await this.fetchFile(resolved.url);
    return Object.freeze({
      ...extra,
      src: resolved.src,
      sha256: file.sha256,
      url: resolved.url,
      license: resolved.license,
      ...(resolved.root !== undefined && extra.root === undefined
        ? { root: resolved.root }
        : {}),
    });
  }

  /**
   * Sounds whose name contains every query word, across all packs whose
   * manifests are cached or fetchable. Packs that fail to load are skipped.
   */
  public async search(
    query: string,
    options: Readonly<{ pack?: string; limit?: number }> = {},
  ): Promise<SoundMatch[]> {
    const words = query
      .toLowerCase()
      .split(/[\s/:]+/)
      .filter(Boolean);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const out: SoundMatch[] = [];
    for (const pack of await this.list()) {
      if (options.pack && pack.name !== options.pack) continue;
      let manifest: Manifest;
      try {
        manifest = await this.loadManifest(pack);
      } catch {
        continue;
      }
      for (const [name, sound] of manifest.sounds) {
        const haystack = `${pack.name}/${name}`.toLowerCase();
        if (!words.every((word) => haystack.includes(word))) continue;
        out.push({
          pack: pack.name,
          sound: name,
          src: `pack:${pack.name}/${name}`,
          kind: sound.kind === "zones" ? "keyed" : "oneshot",
          count:
            sound.kind === "zones" ? sound.zones.length : sound.files.length,
          license: pack.license,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
}

export type SoundMatch = Readonly<{
  pack: string;
  sound: string;
  src: string;
  /** `keyed` sounds are pitched instruments (note zones). */
  kind: "oneshot" | "keyed";
  /** Files (oneshot) or zones (keyed). */
  count: number;
  license: string;
}>;

function caseKey(manifest: Manifest, sound: string): string | undefined {
  const lower = sound.toLowerCase();
  for (const key of manifest.sounds.keys())
    if (key.toLowerCase() === lower) return key;
  return undefined;
}

function caseInsensitive(
  manifest: Manifest,
  sound: string,
): ManifestSound | undefined {
  const key = caseKey(manifest, sound);
  return key === undefined ? undefined : manifest.sounds.get(key);
}

function nearestZone(
  zones: readonly ManifestZone[],
  note: number,
): ManifestZone {
  let best = zones[0]!;
  for (const zone of zones)
    if (Math.abs(zone.note - note) < Math.abs(best.note - note)) best = zone;
  return best;
}

/** Percent-encodes characters a manifest path may carry raw (spaces, #, ?). */
function encodePath(file: string): string {
  return file
    .split("/")
    .map((part) => {
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join("/");
}

async function pruneFiles(
  dir: string,
  maxBytes: number,
  keep: string,
): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: { path: string; bytes: number; used: number }[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.bin$/.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile())
      entries.push({ path, bytes: info.size, used: info.mtimeMs });
  }
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  entries.sort((a, b) => a.used - b.used || a.path.localeCompare(b.path));
  for (const entry of entries) {
    if (total <= maxBytes) break;
    if (entry.path === keep) continue;
    await unlink(entry.path).catch(() => undefined);
    total -= entry.bytes;
  }
}

// ---------------------------------------------------------------------------
// Kits and instruments

/** Ready-made banks `/kit` knows by short name; all resolve through packs. */
export const DEFAULT_KITS: Readonly<
  Record<string, Readonly<{ pack: string; bank: string }>>
> = Object.freeze({
  "909": { pack: "tidal-drum-machines", bank: "RolandTR909" },
  "808": { pack: "tidal-drum-machines", bank: "RolandTR808" },
  "707": { pack: "tidal-drum-machines", bank: "RolandTR707" },
  "606": { pack: "tidal-drum-machines", bank: "RolandTR606" },
  linn: { pack: "tidal-drum-machines", bank: "LinnDrum" },
  lm1: { pack: "tidal-drum-machines", bank: "LinnLM1" },
  dmx: { pack: "tidal-drum-machines", bank: "OberheimDMX" },
  cr78: { pack: "tidal-drum-machines", bank: "RolandCompurhythm78" },
  uzu: { pack: "uzu-drumkit", bank: "" },
  dirt: { pack: "dirt-samples", bank: "" },
});

/** Soundfont instruments the menu offers first (Strudel `gm_` naming). */
export const GM_INSTRUMENTS: readonly string[] = Object.freeze([
  "gm_acoustic_grand_piano",
  "gm_electric_piano_1",
  "gm_electric_piano_2",
  "gm_vibraphone",
  "gm_marimba",
  "gm_drawbar_organ",
  "gm_acoustic_guitar_nylon",
  "gm_electric_guitar_clean",
  "gm_acoustic_bass",
  "gm_electric_bass_finger",
  "gm_synth_bass_1",
  "gm_string_ensemble_1",
  "gm_choir_aahs",
  "gm_trumpet",
  "gm_flute",
  "gm_lead_1_square",
  "gm_pad_2_warm",
]);

/** The kit `/kit` uses with no bank. */
export const DEFAULT_KIT = "909";

export type Kit = Readonly<{
  pack: string;
  /** Manifest bank prefix (`RolandTR909`), empty for bank-less packs. */
  bank: string;
  license: string;
  /** dawg drum voice → pack sound src (`pack:tidal-drum-machines/RolandTR909_bd`). */
  voices: ReadonlyMap<DrumVoice, string>;
}>;

/** Sound suffixes per drum voice, best first (Tidal/Strudel naming). */
const KIT_SOUNDS: Readonly<Record<DrumVoice, readonly string[]>> =
  Object.freeze({
    kick: ["bd"],
    snare: ["sd", "sn"],
    clap: ["cp"],
    rim: ["rim", "rs", "cb"],
    tom: ["mt", "lt", "ht"],
    hat: ["hh", "ch"],
    openhat: ["oh", "ho"],
  });

/**
 * A drum kit from a Strudel-style bank (`RolandTR909`, `tr909`, `909`,
 * `uzu`, …): the pack sound each dawg drum voice plays. Banks match the
 * `<bank>_<sound>` manifest keys case-insensitively, by full name or suffix;
 * `bank("RolandTR909")` in Strudel and `/kit RolandTR909` pick the same files.
 * Undefined when no pack has the bank.
 */
export async function kitFromBank(
  bank: string,
  store: PackStore = new PackStore(),
  options: Readonly<{ pack?: string }> = {},
): Promise<Kit | undefined> {
  const wanted = bank.trim();
  const preset = options.pack ? undefined : DEFAULT_KITS[wanted.toLowerCase()];
  const packs = await store.list();
  const ordered = options.pack
    ? packs.filter((p) => p.name === options.pack)
    : preset
      ? packs.filter((p) => p.name === preset.pack)
      : [
          ...packs.filter((p) => p.name === "tidal-drum-machines"),
          ...packs.filter(
            (p) => p.name !== "tidal-drum-machines" && p.kind === "strudel",
          ),
        ];
  let firstError: unknown;
  let loaded = 0;
  for (const pack of ordered) {
    let manifest: Manifest;
    try {
      manifest = await store.manifest(pack.name);
      loaded += 1;
    } catch (error) {
      firstError ??= error;
      continue;
    }
    const prefix = preset
      ? preset.bank
      : wanted.toLowerCase() === pack.name && !banksOf(manifest).length
        ? ""
        : findBank(manifest, wanted);
    if (prefix === undefined) continue;
    const voices = new Map<DrumVoice, string>();
    for (const info of DRUM_VOICES) {
      for (const suffix of KIT_SOUNDS[info.voice]) {
        const key = prefix ? `${prefix}_${suffix}` : suffix;
        if (manifest.sounds.get(key)?.kind === "list") {
          voices.set(info.voice, `pack:${pack.name}/${key}`);
          break;
        }
      }
    }
    if (voices.size === 0) continue;
    return Object.freeze({
      pack: pack.name,
      bank: prefix,
      license: pack.license,
      voices,
    });
  }
  // Nothing matched and no pack could load (offline, say): say why.
  if (firstError && (preset || options.pack || loaded === 0)) throw firstError;
  return undefined;
}

/** All `<bank>_` prefixes a pack's manifest has with at least a kick or snare. */
export function banksOf(manifest: Manifest): string[] {
  const banks = new Set<string>();
  for (const key of manifest.sounds.keys()) {
    const at = key.lastIndexOf("_");
    if (at <= 0) continue;
    const suffix = key.slice(at + 1);
    if (parseDrumVoice(suffix) === "kick" || parseDrumVoice(suffix) === "snare")
      banks.add(key.slice(0, at));
  }
  return [...banks].sort();
}

function findBank(manifest: Manifest, wanted: string): string | undefined {
  const banks = banksOf(manifest);
  const lower = wanted.toLowerCase();
  return (
    banks.find((bank) => bank.toLowerCase() === lower) ??
    banks.find((bank) => bank.toLowerCase().endsWith(lower))
  );
}

/**
 * The sampler voices for a kit: one oneshot voice per drum voice, named like
 * dawg drum voices, each pinned to its file.
 */
export async function pinKit(kit: Kit, store: PackStore): Promise<Sampler> {
  const voices: Record<string, SampleRef> = {};
  const entries = [...kit.voices];
  const pinned = await Promise.all(entries.map(([, src]) => store.pin(src)));
  entries.forEach(([voice], index) => {
    voices[voice] = pinned[index]!;
  });
  return Object.freeze({ mode: "oneshot", voices: Object.freeze(voices) });
}

/**
 * A keyed sampler for a pitched pack sound (`gm_acoustic_grand_piano`,
 * `piano`, …): one voice per note zone, thinned evenly to the voice limit,
 * each pinned with its root note. List sounds become one keyed voice at C4.
 */
export async function pinInstrument(
  pack: string,
  sound: string,
  store: PackStore,
  options: Readonly<{ maxZones?: number }> = {},
): Promise<Sampler> {
  const manifest = await store.manifest(pack);
  const key = manifest.sounds.has(sound) ? sound : caseKey(manifest, sound);
  const entry = key === undefined ? undefined : manifest.sounds.get(key);
  if (!entry || key === undefined)
    throw new PackError(`${pack} has no sound ${sound}`);
  if (entry.kind === "list") {
    const ref = await store.pin({ pack, sound: key, n: 0 }, { root: 60 });
    return Object.freeze({ mode: "keyed", voices: Object.freeze({ s0: ref }) });
  }
  const zones = thinZones(
    entry.zones,
    options.maxZones ?? defaultZoneCount(entry.zones),
  );
  const refs = await mapLimit(zones, 6, (zone) =>
    store.pin({ pack, sound: key, n: zone.name }),
  );
  const voices: Record<string, SampleRef> = {};
  zones.forEach((zone, index) => {
    voices[`z${String(zone.note).padStart(3, "0")}`] = refs[index]!;
  });
  return Object.freeze({ mode: "keyed", voices: Object.freeze(voices) });
}

/** Dense soundfonts (a file per semitone) keep every third note. */
function defaultZoneCount(zones: readonly ManifestZone[]): number {
  return Math.min(
    PACK_LIMITS.maxZones,
    zones.length > 40 ? Math.ceil(zones.length / 3) : zones.length,
  );
}

export function thinZones(
  zones: readonly ManifestZone[],
  max: number,
): ManifestZone[] {
  const limit = Math.max(1, Math.min(max, PACK_LIMITS.maxZones));
  if (zones.length <= limit) return [...zones];
  const out: ManifestZone[] = [];
  for (let index = 0; index < limit; index += 1)
    out.push(
      zones[Math.round((index * (zones.length - 1)) / (limit - 1 || 1))]!,
    );
  return out.filter((zone, index) => index === 0 || zone !== out[index - 1]);
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Credits

export type PackCredit = Readonly<{
  pack: string;
  license: string;
  attribution?: string;
  homepage?: string;
  sounds: readonly string[];
}>;

/** Packs a score's sampler voices use, with their licenses. */
export function packCredits(
  voices: Iterable<SampleRef>,
  packs: readonly PackInfo[] = PACK_CATALOG,
): PackCredit[] {
  const byPack = new Map<string, { license: string; sounds: Set<string> }>();
  for (const ref of voices) {
    const parsed = parsePackRef(ref.src);
    if (!parsed) continue;
    const entry = byPack.get(parsed.pack) ?? {
      license:
        ref.license ??
        packs.find((p) => p.name === parsed.pack)?.license ??
        NO_LICENSE,
      sounds: new Set<string>(),
    };
    entry.sounds.add(parsed.sound);
    byPack.set(parsed.pack, entry);
  }
  return [...byPack]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pack, entry]) => {
      const info = packs.find((p) => p.name === pack);
      return Object.freeze({
        pack,
        license: entry.license,
        ...(info?.attribution ? { attribution: info.attribution } : {}),
        ...(info?.homepage ? { homepage: info.homepage } : {}),
        sounds: Object.freeze([...entry.sounds].sort()),
      });
    });
}

/** True for licenses that require attribution (CC-BY, CC-BY-SA). */
export function needsAttribution(license: string): boolean {
  return /^CC-BY(-SA)?-/.test(license);
}

/**
 * `CREDITS.md` text for the attribution-requiring packs a score uses, or
 * undefined when none need credit.
 */
export function creditsMarkdown(
  credits: readonly PackCredit[],
): string | undefined {
  const needed = credits.filter((credit) => needsAttribution(credit.license));
  if (needed.length === 0) return undefined;
  const lines = [
    "# Credits",
    "",
    "This project uses samples that require attribution. Keep these lines with music you release.",
    "",
  ];
  for (const credit of needed) {
    lines.push(
      `- **${credit.pack}** (${credit.license}): ${credit.attribution ?? credit.homepage ?? credit.pack}`,
    );
    lines.push(
      `  - sounds: ${credit.sounds.slice(0, 40).join(", ")}${credit.sounds.length > 40 ? ", …" : ""}`,
    );
  }
  lines.push(
    "",
    "Written by dawg from the pack metadata pinned in the tracks.",
    "",
  );
  return lines.join("\n");
}

/** Writes or removes `<projectRoot>/CREDITS.md` to match the score's packs. */
export async function writeCredits(
  projectRoot: string,
  credits: readonly PackCredit[],
): Promise<"written" | "unchanged" | "none"> {
  const text = creditsMarkdown(credits);
  if (text === undefined) return "none";
  const path = join(projectRoot, "CREDITS.md");
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === text) return "unchanged";
  if (
    current !== undefined &&
    !current.includes("Written by dawg from the pack metadata")
  )
    return "unchanged"; // the user's own CREDITS.md; leave it alone
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
  return "written";
}

/** Every pinned check a score-stored ref needs before it can be fetched. */
export function isFetchablePin(ref: SampleRef): boolean {
  return ref.url !== undefined && isPinnedSampleUrl(ref.url);
}

/** One line naming every pack a render uses, attribution first. */
export function creditsLine(
  credits: readonly PackCredit[],
): string | undefined {
  if (credits.length === 0) return undefined;
  return credits
    .map((credit) =>
      needsAttribution(credit.license) && credit.attribution
        ? credit.attribution
        : `${credit.pack} (${credit.license})`,
    )
    .join("; ");
}

/**
 * A copy of a RIFF/WAVE file with a `LIST/INFO` chunk carrying `ICMT`
 * (comment) appended after the existing chunks; readers that do not know it
 * skip it. Unchanged when `bytes` is not RIFF/WAVE.
 */
export function withWavComment(bytes: Uint8Array, comment: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    return bytes;
  const text = new TextEncoder().encode(`${comment.slice(0, 4000)}\0`);
  const padded = text.byteLength + (text.byteLength % 2);
  const listSize = 4 + 8 + padded;
  const base = bytes.byteLength + (bytes.byteLength % 2);
  const out = new Uint8Array(base + 8 + listSize);
  out.set(bytes);
  const o = new DataView(out.buffer);
  const put = (offset: number, value: string) => {
    for (let index = 0; index < 4; index += 1)
      out[offset + index] = value.charCodeAt(index);
  };
  put(base, "LIST");
  o.setUint32(base + 4, listSize, true);
  put(base + 8, "INFO");
  put(base + 12, "ICMT");
  o.setUint32(base + 16, text.byteLength, true);
  out.set(text, base + 20);
  o.setUint32(4, out.byteLength - 8, true);
  void view;
  return out;
}
