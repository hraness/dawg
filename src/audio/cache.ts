/**
 * Disk cache budgets and LRU pruning for pack downloads and decoded assets.
 *
 * Two caches hold audio on disk:
 *
 * - raw pack files, `~/.cache/dawg/packs/files/<sha256(url)>.bin`, shared by
 *   every project (default cap `DEFAULT_PACKS_CACHE_BYTES`, env
 *   `DAWG_PACKS_CACHE_MAX`);
 * - decoded PCM, `<project>/.dawg/assets/<sha256>.pcm`, per project (default
 *   cap `DEFAULT_ASSETS_CACHE_BYTES`, env `DAWG_ASSETS_CACHE_MAX`).
 *
 * Both evict least recently used files first (hits refresh the mtime) and
 * never evict a protected file: the ones the open project pins. An evicted
 * pack file is fetched again by its pinned URL and checked against its
 * pinned sha256, so eviction only ever costs a download.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SCORE_LIMITS } from "../../core/score.ts";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/**
 * Raw pack downloads. 2 GiB holds every file a typical user touches across
 * the built-in packs (a whole drum-machine bank is a few MiB, a GM
 * instrument 1–4 MiB of MP3, a uzu wavetable 1–2 MiB) with room to spare,
 * and stays small next to a browser cache on a laptop disk.
 */
export const DEFAULT_PACKS_CACHE_BYTES = 2 * GiB;
/**
 * Decoded float32 PCM per project. Decoding grows audio 2× (16-bit WAV) to
 * ~10× (MP3), so 1 GiB is about 100 minutes of mono 44.1 kHz audio: far
 * more than a project plays, while a few projects cannot fill a disk.
 */
export const DEFAULT_ASSETS_CACHE_BYTES = 1 * GiB;
/** Decoded samples kept in memory by one `SampleLibrary`. */
export const DEFAULT_MEMORY_CACHE_BYTES = SCORE_LIMITS.maxSampleCacheBytes;

const SIZE =
  /^\s*([0-9]+(?:\.[0-9]+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib|t|tb|tib)?\s*$/i;

/**
 * Bytes from `"2GiB"`, `"512M"`, `"1.5g"`, `"1048576"` (units are binary);
 * undefined when malformed or negative.
 */
export function parseByteSize(value: string): number | undefined {
  const match = SIZE.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase()[0]!;
  const scale =
    unit === "k"
      ? 1024
      : unit === "m"
        ? MiB
        : unit === "g"
          ? GiB
          : unit === "t"
            ? 1024 * GiB
            : 1;
  const bytes = Math.floor(amount * scale);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
}

function fromEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return parseByteSize(raw) ?? fallback;
}

/** Raw pack file cap: `DAWG_PACKS_CACHE_MAX` or 2 GiB. */
export function packsCacheMax(env: NodeJS.ProcessEnv = process.env): number {
  return fromEnv("DAWG_PACKS_CACHE_MAX", DEFAULT_PACKS_CACHE_BYTES, env);
}

/** Decoded asset cap: `DAWG_ASSETS_CACHE_MAX` or 1 GiB. */
export function assetsCacheMax(env: NodeJS.ProcessEnv = process.env): number {
  return fromEnv("DAWG_ASSETS_CACHE_MAX", DEFAULT_ASSETS_CACHE_BYTES, env);
}

export type CacheUsage = Readonly<{ files: number; bytes: number }>;

type Entry = { name: string; path: string; bytes: number; used: number };

async function entries(dir: string, pattern: RegExp): Promise<Entry[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Entry[] = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile())
      out.push({ name, path, bytes: info.size, used: info.mtimeMs });
  }
  return out;
}

/** Files and bytes of the cache entries in `dir` matching `pattern`. */
export async function cacheUsage(
  dir: string,
  pattern: RegExp,
): Promise<CacheUsage> {
  const list = await entries(dir, pattern);
  return {
    files: list.length,
    bytes: list.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export type PruneResult = Readonly<{
  removed: number;
  freed: number;
  /** Bytes left, protected files included. */
  bytes: number;
}>;

/**
 * Deletes least recently used entries until `dir` holds at most `maxBytes`.
 * `keep(name)` protects an entry (the open project's pins, the file being
 * written); protected entries count toward the total but are never removed,
 * so a project larger than the cap keeps everything it uses.
 */
export async function pruneLru(
  dir: string,
  pattern: RegExp,
  maxBytes: number,
  keep: (name: string) => boolean = () => false,
): Promise<PruneResult> {
  const list = await entries(dir, pattern);
  let total = list.reduce((sum, entry) => sum + entry.bytes, 0);
  list.sort((a, b) => a.used - b.used || a.name.localeCompare(b.name));
  let removed = 0;
  let freed = 0;
  for (const entry of list) {
    if (total <= maxBytes) break;
    if (keep(entry.name)) continue;
    try {
      await unlink(entry.path);
    } catch {
      continue;
    }
    total -= entry.bytes;
    freed += entry.bytes;
    removed += 1;
  }
  return { removed, freed, bytes: total };
}

/** `1.5 GiB`, `320 MiB`, `12 KiB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= GiB) return `${Math.round((bytes / GiB) * 10) / 10} GiB`;
  if (bytes >= MiB) return `${Math.round((bytes / MiB) * 10) / 10} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}
