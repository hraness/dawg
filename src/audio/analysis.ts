/**
 * The pitch-analysis cache (0.7). `pitchCurve` tracks a decoded sample once
 * and keeps the canonical curve in a small in-memory LRU and on disk at
 * `.dawg/analysis/<sha256>.<voice>.v<tracker version>.f0` (format DWF0).
 *
 * DWF0 holds exactly the canonical curve `trackPitch` returns (f0 Float32,
 * prob and aperiodic u8), so a cache hit renders the same bytes as a cache
 * miss. Layout, little endian:
 *
 *   0  "DWF0"          magic
 *   4  u16 DWF0 version, u16 tracker version
 *   8  u32 frames
 *  12  f64 hop seconds, 20 f64 t0 seconds
 *  28  f32[frames] f0 Hz (0 unvoiced)
 *   …  u8[frames] prob, u8[frames] aperiodic (1/255 steps)
 *   …  8 bytes: the sha256 prefix of every byte before it
 *
 * About 1.2 KB per audio second. Writes go to `<name>.<pid>.tmp` and are
 * renamed into place; write errors are swallowed (the cache is an
 * optimisation). Reads validate magic, versions, length and checksum, and
 * any mismatch is a miss. Analysis stays inside the project.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cacheUsage,
  pruneLru,
  type CacheUsage,
  type PruneResult,
} from "./cache.ts";
import {
  PITCH_TRACKER_VERSION,
  trackPitchAsync,
  type PitchCurve,
  type PitchVoice,
} from "./dsp/pitch.ts";

export const DWF0_VERSION = 1;
const HEAD = 28;
const CHECK = 8;
const MAGIC = [0x44, 0x57, 0x46, 0x30] as const;

/** Disk budget for `.dawg/analysis` (curves are small; 64 MB is ~15 h). */
export const ANALYSIS_CACHE_BYTES = 64 * 1024 * 1024;
/** In-memory curves kept (least recently used go first). */
export const ANALYSIS_MEMORY_ENTRIES = 64;

/** Every file the analysis cache writes. */
export const ANALYSIS_FILE = /^[0-9a-f]{64}\.\w+\.v\d+\.f0$/;

function checksum(bytes: Uint8Array, length: number): Uint8Array {
  return createHash("sha256").update(bytes.subarray(0, length)).digest();
}

/** The DWF0 bytes of a curve. */
export function encodeCurve(curve: PitchCurve): Uint8Array {
  const n = curve.f0.length;
  const size = HEAD + 6 * n + CHECK;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  view.setUint16(4, DWF0_VERSION, true);
  view.setUint16(6, PITCH_TRACKER_VERSION, true);
  view.setUint32(8, n, true);
  view.setFloat64(12, curve.hop, true);
  view.setFloat64(20, curve.t0, true);
  for (let f = 0; f < n; f += 1)
    view.setFloat32(HEAD + 4 * f, curve.f0[f]!, true);
  bytes.set(curve.prob, HEAD + 4 * n);
  bytes.set(curve.aperiodic, HEAD + 5 * n);
  bytes.set(checksum(bytes, size - CHECK).subarray(0, CHECK), size - CHECK);
  return bytes;
}

/** The curve in DWF0 `bytes`, or undefined for anything not exactly valid. */
export function decodeCurve(bytes: Uint8Array): PitchCurve | undefined {
  if (bytes.length < HEAD + CHECK) return undefined;
  for (let i = 0; i < 4; i += 1) if (bytes[i] !== MAGIC[i]) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== DWF0_VERSION) return undefined;
  if (view.getUint16(6, true) !== PITCH_TRACKER_VERSION) return undefined;
  const n = view.getUint32(8, true);
  if (bytes.length !== HEAD + 6 * n + CHECK) return undefined;
  const sum = checksum(bytes, bytes.length - CHECK);
  for (let i = 0; i < CHECK; i += 1)
    if (bytes[bytes.length - CHECK + i] !== sum[i]) return undefined;
  const hop = view.getFloat64(12, true);
  const t0 = view.getFloat64(20, true);
  if (!(hop > 0) || !Number.isFinite(t0)) return undefined;
  const f0 = new Float32Array(n);
  for (let f = 0; f < n; f += 1) f0[f] = view.getFloat32(HEAD + 4 * f, true);
  return {
    t0,
    hop,
    f0,
    prob: bytes.slice(HEAD + 4 * n, HEAD + 5 * n),
    aperiodic: bytes.slice(HEAD + 5 * n, HEAD + 6 * n),
  };
}

/** The cache file name of a sample's curve. */
export function analysisFileName(sha256: string, voice: PitchVoice): string {
  return `${sha256}.${voice}.v${PITCH_TRACKER_VERSION}.f0`;
}

/** `<projectRoot>/.dawg/analysis`. */
export function analysisDir(projectRoot: string): string {
  return join(projectRoot, ".dawg", "analysis");
}

/** What `pitchCurve` tracks: a decoded sample (mono mixdown) and its hash. */
export type AnalysisSource = Readonly<{
  sha256: string;
  sampleRate: number;
  mono: ArrayLike<number>;
}>;

export type PitchCurveOptions = Readonly<{
  voice?: PitchVoice;
  /** Project root; without one only the memory cache is used. */
  projectRoot?: string;
  /** Overrides `<projectRoot>/.dawg/analysis`. */
  dir?: string;
  /** Disk budget (default ANALYSIS_CACHE_BYTES). */
  maxBytes?: number;
  /** Fraction of frames tracked so far, on a cache miss. */
  progress?: (done: number) => void;
}>;

const memory = new Map<string, PitchCurve>();
const counters = { tracks: 0, diskHits: 0, memoryHits: 0 };

/** Tracking and cache-hit counts, for tests and the doctor. */
export function analysisCounters(): Readonly<typeof counters> {
  return { ...counters };
}

/** Drops the in-memory curves (tests; the disk cache stays). */
export function clearAnalysisMemory(): void {
  memory.clear();
}

function remember(key: string, curve: PitchCurve): void {
  memory.delete(key);
  memory.set(key, curve);
  while (memory.size > ANALYSIS_MEMORY_ENTRIES)
    memory.delete(memory.keys().next().value!);
}

/** The memory-cached curve of a sample, without tracking. */
export function cachedPitchCurve(
  sha256: string,
  voice: PitchVoice = "auto",
): PitchCurve | undefined {
  const key = analysisFileName(sha256, voice);
  const hit = memory.get(key);
  if (hit) remember(key, hit);
  return hit;
}

/**
 * The pitch curve of a decoded sample: memory, then disk, then tracked and
 * written back. Every path returns identical curves.
 */
export async function pitchCurve(
  source: AnalysisSource,
  options: PitchCurveOptions = {},
): Promise<PitchCurve> {
  const voice = options.voice ?? "auto";
  const name = analysisFileName(source.sha256, voice);
  const hit = memory.get(name);
  if (hit) {
    counters.memoryHits += 1;
    remember(name, hit);
    return hit;
  }
  const dir =
    options.dir ??
    (options.projectRoot ? analysisDir(options.projectRoot) : undefined);
  if (dir) {
    const path = join(dir, name);
    const bytes = await readFile(path).catch(() => undefined);
    const curve = bytes ? decodeCurve(new Uint8Array(bytes)) : undefined;
    if (curve) {
      counters.diskHits += 1;
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      remember(name, curve);
      return curve;
    }
  }
  counters.tracks += 1;
  const curve = await trackPitchAsync(
    Float64Array.from(source.mono),
    source.sampleRate,
    { voice },
    options.progress,
  );
  remember(name, curve);
  if (dir) await writeCurve(dir, name, curve, options.maxBytes, source.sha256);
  return curve;
}

async function writeCurve(
  dir: string,
  name: string,
  curve: PitchCurve,
  maxBytes = ANALYSIS_CACHE_BYTES,
  keep: string,
): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, encodeCurve(curve));
    await rename(temporary, path);
    await pruneAnalysisCache(dir, maxBytes, new Set([keep]));
  } catch {
    /* the cache is an optimisation; a read-only project still renders */
  }
}

/**
 * Deletes least recently used curves until `dir` fits `maxBytes`, never
 * the ones whose sha256 is in `keep` (the open project's samples).
 */
export async function pruneAnalysisCache(
  dir: string,
  maxBytes = ANALYSIS_CACHE_BYTES,
  keep: ReadonlySet<string> = new Set(),
): Promise<PruneResult> {
  return pruneLru(dir, ANALYSIS_FILE, maxBytes, (name) =>
    keep.has(name.slice(0, 64)),
  );
}

/** Files and bytes in the project's analysis cache, for `/pack cache`. */
export async function analysisCacheStatus(
  projectRoot: string,
): Promise<CacheUsage & { max: number }> {
  return {
    ...(await cacheUsage(analysisDir(projectRoot), ANALYSIS_FILE)),
    max: ANALYSIS_CACHE_BYTES,
  };
}

/** The `dawg media doctor` line for the project's analysis cache. */
export async function analysisDoctorLine(projectRoot: string): Promise<string> {
  const s = await analysisCacheStatus(projectRoot);
  const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
  return `· analysis cache .dawg/analysis · ${s.files} file${s.files === 1 ? "" : "s"} · ${mb(s.bytes)} MB of ${mb(s.max)} MB (least recently used pruned) · pitch tracker v${PITCH_TRACKER_VERSION}`;
}
