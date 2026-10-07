/**
 * Sample loading for sampler tracks (score v2). Every voice's `src` is
 * resolved inside the project (lexically, then through `realpath`, never into
 * `.dawg/`), hashed, decoded and handed to the renderer as a `SampleBank`.
 *
 * - WAV (PCM 16/24/32-bit int, 32-bit float) and AIFF/AIFC (8/16/24/32-bit
 *   int, `sowt`, `fl32`) decode natively in TypeScript.
 * - Anything else (mp3, flac, ogg, m4a, …) decodes through `ffmpeg` when it is
 *   on PATH; dawg never installs it.
 * - Decoded PCM is cached content-addressed at `.dawg/assets/<sha256>.pcm`
 *   (and in memory), least recently used first out, bounded by
 *   `SCORE_LIMITS.maxSampleCacheBytes`.
 *
 * Loading never throws for project problems: a voice that cannot load is
 * reported as a `<what> · <why> · <next step>` problem and renders silent.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  PACK_PREFIX,
  SCORE_LIMITS,
  isSamplerInstrument,
  type SampleRef,
  type TrackScore,
} from "../../core/score.ts";
import { PackError, PackStore } from "./packs.ts";
import { trackDirectories } from "../../core/sdk/print.ts";
import { WavFormatError, parseWav } from "../media/vendor/wav.ts";
import { WorkspaceError, resolveReadPath } from "../agent/workspace.ts";

/** One decoded sample: source rate, mono mixdown for the renderer. */
export type DecodedSample = Readonly<{
  sha256: string;
  sampleRate: number;
  /** Channels in the source file (the renderer plays a mono mixdown). */
  channels: number;
  frames: number;
  mono: Float32Array;
}>;

export type SampleProblem = Readonly<{
  trackId: string;
  voice: string;
  src: string;
  level: "error" | "warning";
  /** `<what> · <why> · <next step>`. */
  message: string;
}>;

/** Decoded voices keyed by `sampleKey(trackId, voice)`, plus load problems. */
export type SampleBank = Readonly<{
  voices: ReadonlyMap<string, DecodedSample>;
  problems: readonly SampleProblem[];
}>;

export const EMPTY_SAMPLE_BANK: SampleBank = Object.freeze({
  voices: new Map<string, DecodedSample>(),
  problems: Object.freeze([]),
});

/** True when any track of the score is a sampler with voices. */
export function hasSamplerTracks(score: TrackScore): boolean {
  return score.tracks.some(
    (track) =>
      isSamplerInstrument(track.instrument) &&
      track.sampler !== undefined &&
      Object.keys(track.sampler.voices).length > 0,
  );
}

export function sampleKey(trackId: string, voice: string): string {
  return `${trackId}\u0000${voice}`;
}

/** Anything that resolves sample voices for a score (the engine's hook). */
export interface SampleSource {
  load(score: TrackScore): Promise<SampleBank>;
}

/** Interleaved float PCM at the file's own rate. */
export type PcmData = Readonly<{
  sampleRate: number;
  channels: number;
  frames: number;
  data: Float32Array;
}>;

export class SampleDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleDecodeError";
  }
}

const MIN_RATE = 8_000;
const MAX_RATE = 192_000;
const MAX_CHANNELS = 8;
/** ffmpeg output: fixed so the cache does not depend on probing. */
const FFMPEG_RATE = 48_000;
const FFMPEG_CHANNELS = 2;
const FFMPEG_TIMEOUT_MS = 60_000;
const CACHE_MAGIC = 0x4d435044; // "DPCM" little-endian
const CACHE_VERSION = 1;
const CACHE_HEADER_BYTES = 16;

// ---------------------------------------------------------------------------
// Native decoders

function ascii(bytes: Uint8Array, offset: number, count: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + count));
}

/** The container a file's first bytes announce, if dawg decodes it natively. */
export function nativeFormat(bytes: Uint8Array): "wav" | "aiff" | undefined {
  if (bytes.byteLength < 12) return undefined;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE")
    return "wav";
  const form = ascii(bytes, 8, 4);
  if (ascii(bytes, 0, 4) === "FORM" && (form === "AIFF" || form === "AIFC"))
    return "aiff";
  return undefined;
}

/** WAV through the vendored media parser (PCM 16/24/32, float32). */
export function decodeWav(bytes: Uint8Array): PcmData {
  let parsed;
  try {
    parsed = parseWav(bytes, {
      maximumBytes: SCORE_LIMITS.maxSampleFileBytes,
      maximumDurationSeconds: SCORE_LIMITS.maxSampleSeconds,
      maximumChannels: MAX_CHANNELS,
    });
  } catch (error) {
    if (error instanceof WavFormatError && error.code === "too_long")
      throw new SampleLimitError(
        `longer than the ${SCORE_LIMITS.maxSampleSeconds / 60} minute sample limit`,
      );
    if (error instanceof WavFormatError)
      throw new SampleDecodeError(error.message.replace(/\.$/, ""));
    throw error;
  }
  const { sampleRate, channels, sampleCount: frames } = parsed;
  const data = new Float32Array(frames * channels);
  for (let frame = 0; frame < frames; frame += 1)
    for (let channel = 0; channel < channels; channel += 1)
      data[frame * channels + channel] = parsed.sample(frame, channel);
  return { sampleRate, channels, frames, data };
}

/** IEEE 754 80-bit extended (AIFF sample rate). */
function extended80(view: DataView, offset: number): number {
  const exponent = view.getUint16(offset) & 0x7fff;
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exponent - 16383 - 63);
}

/** AIFF and AIFC (`NONE`, `sowt`, `fl32`/`FL32`). */
export function decodeAiff(bytes: Uint8Array): PcmData {
  if (nativeFormat(bytes) !== "aiff")
    throw new SampleDecodeError("file is not AIFF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const aifc = ascii(bytes, 8, 4) === "AIFC";
  let channels = 0;
  let frames = 0;
  let bits = 0;
  let sampleRate = 0;
  let compression = "NONE";
  let dataStart = -1;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.byteLength)
      throw new SampleDecodeError("AIFF contains a truncated chunk");
    if (id === "COMM") {
      if (size < 18) throw new SampleDecodeError("AIFF COMM chunk is short");
      channels = view.getUint16(start);
      frames = view.getUint32(start + 2);
      bits = view.getUint16(start + 6);
      sampleRate = extended80(view, start + 8);
      if (aifc && size >= 22) compression = ascii(bytes, start + 18, 4);
    } else if (id === "SSND") {
      const dataOffset = view.getUint32(start);
      dataStart = start + 8 + dataOffset;
    }
    offset = start + size + (size & 1);
  }
  if (dataStart < 0 || channels === 0)
    throw new SampleDecodeError("AIFF is missing COMM or SSND");
  const float = compression === "fl32" || compression === "FL32";
  const little = compression === "sowt";
  if (!float && !little && compression !== "NONE")
    throw new SampleDecodeError(`AIFC compression ${compression} is not PCM`);
  if (float) bits = 32;
  if (![8, 16, 24, 32].includes(bits))
    throw new SampleDecodeError(`AIFF ${bits}-bit samples are unsupported`);
  if (little && bits !== 16)
    throw new SampleDecodeError("AIFC sowt must be 16-bit");
  checkShape(sampleRate, channels, frames);
  const width = bits / 8;
  if (dataStart + frames * channels * width > bytes.byteLength)
    throw new SampleDecodeError("AIFF sound data is truncated");
  const data = new Float32Array(frames * channels);
  for (let index = 0; index < frames * channels; index += 1) {
    const at = dataStart + index * width;
    let value: number;
    if (float) value = Math.max(-1, Math.min(1, view.getFloat32(at)));
    else if (bits === 8) value = view.getInt8(at) / 128;
    else if (bits === 16) value = view.getInt16(at, little) / 32_768;
    else if (bits === 24) {
      let raw = (bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!;
      if (raw & 0x800000) raw |= ~0xffffff;
      value = raw / 8_388_608;
    } else value = view.getInt32(at) / 2_147_483_648;
    data[index] = value;
  }
  return { sampleRate, channels, frames, data };
}

function checkShape(sampleRate: number, channels: number, frames: number) {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < MIN_RATE ||
    sampleRate > MAX_RATE
  )
    throw new SampleDecodeError(
      `sample rate ${Math.round(sampleRate)} Hz is outside ${MIN_RATE}–${MAX_RATE} Hz`,
    );
  if (channels < 1 || channels > MAX_CHANNELS)
    throw new SampleDecodeError(`${channels} channels is unsupported`);
  if (frames / sampleRate > SCORE_LIMITS.maxSampleSeconds)
    throw new SampleDecodeError(
      `longer than ${SCORE_LIMITS.maxSampleSeconds / 60} minutes`,
    );
}

/** Average the channels; the renderer plays sampler voices in mono before pan. */
export function monoMix(pcm: PcmData): Float32Array {
  if (pcm.channels === 1) return pcm.data;
  const mono = new Float32Array(pcm.frames);
  for (let frame = 0; frame < pcm.frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < pcm.channels; channel += 1)
      sum += pcm.data[frame * pcm.channels + channel]!;
    mono[frame] = sum / pcm.channels;
  }
  return mono;
}

/**
 * Linear-interpolated resampling of a mono buffer. The renderer resamples on
 * the fly (rate = speed × source/engine rate); this is the same arithmetic
 * for callers that want a buffer at the engine rate.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const step = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const base = Math.floor(position);
    const next = Math.min(input.length - 1, base + 1);
    const fraction = position - base;
    const a = input[Math.min(input.length - 1, base)]!;
    out[index] = a + (input[next]! - a) * fraction;
  }
  return out;
}

// ---------------------------------------------------------------------------
// ffmpeg

export type FfmpegRunner = (
  args: readonly string[],
  options: Readonly<{ timeoutMs: number; maxBytes: number }>,
) => Promise<Readonly<{ code: number; stdout: Uint8Array; stderr: string }>>;

const bunFfmpeg: FfmpegRunner = async (args, options) => {
  const proc = Bun.spawn([...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of proc.stdout) {
      total += chunk.byteLength;
      if (total > options.maxBytes) {
        proc.kill();
        throw new SampleDecodeError(
          `decoded audio is longer than ${SCORE_LIMITS.maxSampleSeconds / 60} minutes`,
        );
      }
      chunks.push(chunk);
    }
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    const stdout = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      stdout.set(chunk, at);
      at += chunk.byteLength;
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

/** Decode any ffmpeg-readable file to 48 kHz stereo float. */
export async function decodeWithFfmpeg(
  ffmpeg: string,
  path: string,
  run: FfmpegRunner = bunFfmpeg,
): Promise<PcmData> {
  const maxBytes =
    SCORE_LIMITS.maxSampleSeconds * FFMPEG_RATE * FFMPEG_CHANNELS * 4 + 4096;
  const result = await run(
    [
      ffmpeg,
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vn",
      "-t",
      String(SCORE_LIMITS.maxSampleSeconds),
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      String(FFMPEG_CHANNELS),
      "-ar",
      String(FFMPEG_RATE),
      "-",
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS, maxBytes },
  );
  if (result.code !== 0) {
    const line = result.stderr.trim().split("\n").pop()?.slice(0, 160);
    throw new SampleDecodeError(
      `ffmpeg could not decode it${line ? ` (${line})` : ""}`,
    );
  }
  const frames = Math.floor(result.stdout.byteLength / (4 * FFMPEG_CHANNELS));
  if (frames === 0) throw new SampleDecodeError("ffmpeg produced no audio");
  const data = new Float32Array(frames * FFMPEG_CHANNELS);
  const view = new DataView(
    result.stdout.buffer,
    result.stdout.byteOffset,
    frames * FFMPEG_CHANNELS * 4,
  );
  for (let index = 0; index < data.length; index += 1)
    data[index] = Math.max(-1, Math.min(1, view.getFloat32(index * 4, true)));
  return { sampleRate: FFMPEG_RATE, channels: FFMPEG_CHANNELS, frames, data };
}

// ---------------------------------------------------------------------------
// Content-addressed PCM cache

export function encodeCachedPcm(pcm: PcmData): Uint8Array {
  const out = new Uint8Array(CACHE_HEADER_BYTES + pcm.data.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, CACHE_MAGIC, true);
  view.setUint32(4, CACHE_VERSION, true);
  view.setUint32(8, pcm.sampleRate, true);
  view.setUint32(12, pcm.channels, true);
  for (let index = 0; index < pcm.data.length; index += 1)
    view.setFloat32(CACHE_HEADER_BYTES + index * 4, pcm.data[index]!, true);
  return out;
}

export function decodeCachedPcm(bytes: Uint8Array): PcmData | undefined {
  if (bytes.byteLength < CACHE_HEADER_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== CACHE_MAGIC ||
    view.getUint32(4, true) !== CACHE_VERSION
  )
    return undefined;
  const sampleRate = view.getUint32(8, true);
  const channels = view.getUint32(12, true);
  const body = bytes.byteLength - CACHE_HEADER_BYTES;
  if (channels < 1 || channels > MAX_CHANNELS || body % (4 * channels) !== 0)
    return undefined;
  const data = new Float32Array(body / 4);
  for (let index = 0; index < data.length; index += 1)
    data[index] = view.getFloat32(CACHE_HEADER_BYTES + index * 4, true);
  return { sampleRate, channels, frames: data.length / channels, data };
}

/** Delete least recently used `.pcm` files until the directory fits `maxBytes`. */
export async function pruneAssetCache(
  dir: string,
  maxBytes: number,
  keep?: string,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const entries: { path: string; bytes: number; used: number }[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.pcm$/.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile())
      entries.push({ path, bytes: info.size, used: info.mtimeMs });
  }
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  entries.sort((a, b) => a.used - b.used || a.path.localeCompare(b.path));
  let removed = 0;
  for (const entry of entries) {
    if (total <= maxBytes) break;
    if (keep && entry.path.endsWith(`${keep}.pcm`)) continue;
    await unlink(entry.path).catch(() => undefined);
    total -= entry.bytes;
    removed += 1;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Library

export type SampleLibraryOptions = Readonly<{
  /** Absolute project root; sample paths must stay inside it. */
  projectRoot: string;
  /** Default `<projectRoot>/.dawg/assets`. */
  cacheDir?: string;
  /** Disk and memory cache budget; default `SCORE_LIMITS.maxSampleCacheBytes`. */
  maxCacheBytes?: number;
  /** ffmpeg binary, `null` for none; default `Bun.which("ffmpeg")`. */
  ffmpeg?: string | null;
  runFfmpeg?: FfmpegRunner;
  /** Resolves `pack:` voices; default a `PackStore` on the user cache. */
  packs?: PackStore;
}>;

type MemoryEntry = { sample: DecodedSample; bytes: number };

/**
 * Loads a score's sample voices. Decoded samples stay in an in-memory LRU
 * keyed by content hash, so re-renders after an edit cost a `stat` per voice.
 */
export class SampleLibrary implements SampleSource {
  public readonly projectRoot: string;
  public readonly cacheDir: string;
  private readonly maxCacheBytes: number;
  private readonly ffmpeg: string | null;
  private readonly runFfmpeg: FfmpegRunner | undefined;
  private readonly memory = new Map<string, MemoryEntry>();
  private memoryBytes = 0;
  /** `real:size:mtime` → sha256, so unchanged files are not re-hashed. */
  private readonly hashes = new Map<string, string>();
  private stats = { decodes: 0, diskHits: 0, memoryHits: 0 };

  public constructor(options: SampleLibraryOptions) {
    this.projectRoot = options.projectRoot;
    this.cacheDir =
      options.cacheDir ?? join(options.projectRoot, ".dawg", "assets");
    this.maxCacheBytes = Math.max(
      0,
      options.maxCacheBytes ?? SCORE_LIMITS.maxSampleCacheBytes,
    );
    this.ffmpeg =
      options.ffmpeg === undefined
        ? (Bun.which("ffmpeg") ?? null)
        : options.ffmpeg;
    this.runFfmpeg = options.runFfmpeg;
    this.packStore = options.packs;
  }

  private packStore: PackStore | undefined;

  private get packs(): PackStore {
    this.packStore ??= new PackStore();
    return this.packStore;
  }

  /** Decode/cache counters, for tests and diagnostics. */
  public get counters(): Readonly<{
    decodes: number;
    diskHits: number;
    memoryHits: number;
  }> {
    return { ...this.stats };
  }

  public async load(score: TrackScore): Promise<SampleBank> {
    const voices = new Map<string, DecodedSample>();
    const problems: SampleProblem[] = [];
    let dirs: ReadonlyMap<string, string> | undefined;
    for (const track of score.tracks) {
      if (!isSamplerInstrument(track.instrument) || !track.sampler) continue;
      const names = Object.keys(track.sampler.voices).sort();
      for (const voice of names.slice(0, SCORE_LIMITS.maxSamplerVoices)) {
        const ref = track.sampler.voices[voice]!;
        let src = ref.src;
        if (src.startsWith(PACK_PREFIX)) {
          try {
            const loaded = await this.loadPack(ref);
            voices.set(sampleKey(track.id, voice), loaded.sample);
            if (loaded.warning)
              problems.push({
                trackId: track.id,
                voice,
                src,
                level: "warning",
                message: `${voice} · ${src} · ${loaded.warning}`,
              });
          } catch (error) {
            problems.push({
              trackId: track.id,
              voice,
              src,
              level: "error",
              message:
                error instanceof PackError
                  ? `${voice} · ${src} · ${error.message}`
                  : describeFailure(voice, src, error, this.ffmpeg),
            });
          }
          continue;
        }
        if (!src.startsWith("tracks/")) {
          dirs ??= trackDirectories(score);
          src = `tracks/${dirs.get(track.id) ?? track.id}/${src.replace(/^\.\//, "")}`;
        }
        const report = (level: SampleProblem["level"], message: string) =>
          problems.push({
            trackId: track.id,
            voice,
            src: ref.src,
            level,
            message,
          });
        try {
          const loaded = await this.loadFile(src);
          if (ref.sha256 && ref.sha256 !== loaded.sha256)
            report(
              "warning",
              `${voice} · ${src} changed since it was imported (sha256 ${loaded.sha256.slice(0, 12)}… ≠ ${ref.sha256.slice(0, 12)}…) · playing the file on disk; re-import or update sha256 in track.ts`,
            );
          voices.set(sampleKey(track.id, voice), loaded);
        } catch (error) {
          report("error", describeFailure(voice, src, error, this.ffmpeg));
        }
      }
    }
    return Object.freeze({ voices, problems: Object.freeze(problems) });
  }

  /**
   * A `pack:` voice. With a pinned sha256 the decoded asset cache answers
   * without the network; otherwise the file comes from the pack store
   * (its file cache, then a download) and is checked against the pin.
   */
  private async loadPack(
    ref: SampleRef,
  ): Promise<{ sample: DecodedSample; warning?: string }> {
    if (ref.sha256) {
      const hit = this.fromMemory(ref.sha256);
      if (hit) return { sample: hit };
      const pcm = await this.fromDisk(ref.sha256);
      if (pcm) {
        this.stats.diskHits += 1;
        return { sample: this.admit(ref.sha256, pcm) };
      }
    }
    let url = ref.url;
    let warning: string | undefined;
    if (!url) {
      url = (await this.packs.resolve(ref.src)).url;
      if (!ref.sha256)
        warning =
          "not pinned · re-pick it with /kit, /pack or use_sound so renders stay reproducible";
    }
    const file = await this.packs.fetchFile(url, ref.sha256);
    if (file.bytes.byteLength > SCORE_LIMITS.maxSampleFileBytes)
      throw new SampleLimitError(
        `${formatMiB(file.bytes.byteLength)} is over the ${formatMiB(SCORE_LIMITS.maxSampleFileBytes)} sample file limit`,
      );
    const hit = this.fromMemory(file.sha256);
    if (hit) return { sample: hit, ...(warning ? { warning } : {}) };
    let pcm = await this.fromDisk(file.sha256);
    if (pcm) this.stats.diskHits += 1;
    else {
      pcm = await this.decode(file.bytes, file.path);
      this.stats.decodes += 1;
      await this.toDisk(file.sha256, pcm);
    }
    return {
      sample: this.admit(file.sha256, pcm),
      ...(warning ? { warning } : {}),
    };
  }

  private admit(sha256: string, pcm: PcmData): DecodedSample {
    if (pcm.frames / pcm.sampleRate > SCORE_LIMITS.maxSampleSeconds)
      throw new SampleLimitError(
        `${Math.round(pcm.frames / pcm.sampleRate)} s is over the ${SCORE_LIMITS.maxSampleSeconds / 60} minute sample limit`,
      );
    if (pcm.frames === 0) throw new SampleDecodeError("it contains no audio");
    const sample: DecodedSample = Object.freeze({
      sha256,
      sampleRate: pcm.sampleRate,
      channels: pcm.channels,
      frames: pcm.frames,
      mono: monoMix(pcm),
    });
    this.remember(sample);
    return sample;
  }

  private async loadFile(src: string): Promise<DecodedSample> {
    const resolved = await resolveReadPath(
      { root: this.projectRoot, trackSlug: "" },
      src,
      "sample",
    );
    const info = await stat(resolved.real);
    if (!info.isFile()) throw new SampleDecodeError("not a regular file");
    if (info.size > SCORE_LIMITS.maxSampleFileBytes)
      throw new SampleLimitError(
        `${formatMiB(info.size)} is over the ${formatMiB(SCORE_LIMITS.maxSampleFileBytes)} sample file limit`,
      );
    const statKey = `${resolved.real}:${info.size}:${info.mtimeMs}`;
    const knownSha = this.hashes.get(statKey);
    if (knownSha) {
      const hit = this.fromMemory(knownSha);
      if (hit) return hit;
    }
    const bytes = new Uint8Array(await readFile(resolved.real));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    this.hashes.set(statKey, sha256);
    if (this.hashes.size > 4096) this.hashes.clear();
    const hit = this.fromMemory(sha256);
    if (hit) return hit;
    let pcm = await this.fromDisk(sha256);
    if (pcm) this.stats.diskHits += 1;
    else {
      pcm = await this.decode(bytes, resolved.real);
      this.stats.decodes += 1;
      await this.toDisk(sha256, pcm);
    }
    if (pcm.frames / pcm.sampleRate > SCORE_LIMITS.maxSampleSeconds)
      throw new SampleLimitError(
        `${Math.round(pcm.frames / pcm.sampleRate)} s is over the ${SCORE_LIMITS.maxSampleSeconds / 60} minute sample limit`,
      );
    if (pcm.frames === 0) throw new SampleDecodeError("it contains no audio");
    const sample: DecodedSample = Object.freeze({
      sha256,
      sampleRate: pcm.sampleRate,
      channels: pcm.channels,
      frames: pcm.frames,
      mono: monoMix(pcm),
    });
    this.remember(sample);
    return sample;
  }

  private async decode(bytes: Uint8Array, path: string): Promise<PcmData> {
    const format = nativeFormat(bytes);
    if (format === "wav") return decodeWav(bytes);
    if (format === "aiff") return decodeAiff(bytes);
    if (!this.ffmpeg) throw new FfmpegMissingError();
    return decodeWithFfmpeg(this.ffmpeg, path, this.runFfmpeg);
  }

  private fromMemory(sha256: string): DecodedSample | undefined {
    const entry = this.memory.get(sha256);
    if (!entry) return undefined;
    this.memory.delete(sha256);
    this.memory.set(sha256, entry);
    this.stats.memoryHits += 1;
    return entry.sample;
  }

  private remember(sample: DecodedSample): void {
    const bytes = sample.mono.byteLength;
    this.memory.set(sample.sha256, { sample, bytes });
    this.memoryBytes += bytes;
    for (const [sha, entry] of this.memory) {
      if (this.memoryBytes <= this.maxCacheBytes) break;
      if (sha === sample.sha256) continue;
      this.memory.delete(sha);
      this.memoryBytes -= entry.bytes;
    }
  }

  private async fromDisk(sha256: string): Promise<PcmData | undefined> {
    const path = join(this.cacheDir, `${sha256}.pcm`);
    try {
      const pcm = decodeCachedPcm(new Uint8Array(await readFile(path)));
      if (!pcm) return undefined;
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      return pcm;
    } catch {
      return undefined;
    }
  }

  private async toDisk(sha256: string, pcm: PcmData): Promise<void> {
    const size = CACHE_HEADER_BYTES + pcm.data.length * 4;
    if (size > this.maxCacheBytes) return;
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const path = join(this.cacheDir, `${sha256}.pcm`);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, encodeCachedPcm(pcm));
      await rename(temporary, path);
      await pruneAssetCache(this.cacheDir, this.maxCacheBytes, sha256);
    } catch {
      /* the cache is an optimisation; a read-only project still renders */
    }
  }
}

export class SampleLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleLimitError";
  }
}

class FfmpegMissingError extends Error {
  constructor() {
    super("ffmpeg is not on PATH");
    this.name = "FfmpegMissingError";
  }
}

function formatMiB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

function describeFailure(
  voice: string,
  src: string,
  error: unknown,
  ffmpeg: string | null,
): string {
  const what = `${voice} · ${src}`;
  if (error instanceof WorkspaceError) {
    if (/no such file/.test(error.message))
      return `${what} · file is missing · add it under the track's samples/ or fix src in track.ts`;
    return `${what} · ${error.message} · keep samples inside the project, e.g. tracks/<slug>/samples/`;
  }
  if (error instanceof FfmpegMissingError)
    return `${what} · not WAV/AIFF and ffmpeg is not on PATH · convert it to WAV, or install ffmpeg (e.g. brew install ffmpeg) and reload`;
  if (error instanceof SampleLimitError)
    return `${what} · ${error.message} · trim it or import a shorter section`;
  if (error instanceof SampleDecodeError)
    return `${what} · ${error.message} · ${ffmpeg ? "re-export it as 16/24-bit WAV" : "re-export it as 16/24-bit WAV, or install ffmpeg"}`;
  const message = error instanceof Error ? error.message : String(error);
  return `${what} · ${message.slice(0, 160)} · check the file and reload`;
}
