/**
 * The native audio sink (native/sink, Rust + cpal) loaded through bun:ffi.
 *
 * The engine still renders and mixes every sample in TypeScript; the sink
 * only plays them from a lock-free ring drained by the device's own audio
 * callback (and captures input into another ring). That removes the stdin
 * pipe and the external player's buffer from the output path.
 *
 * The library ships prebuilt per platform under `native/prebuilt/<target>/`
 * with a `manifest.json` of sha256 sums; it is verified before dlopen and
 * never compiled on install. Anything missing or wrong falls back to the
 * stdin players, and the reason is reported (`dawg doctor`, `/auth`).
 */
import { dlopen as ffiOpen, FFIType as T, ptr as ffiPtr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeWav } from "./wav.ts";

/** The C ABI shape this loader speaks (native/sink `ABI_VERSION`). */
export const SINK_ABI_VERSION = 1;
const STAT_COUNT = 12;

/** Prebuilt targets: `<platform>-<arch>`. */
export const NATIVE_TARGETS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
]);

export function nativeTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const target = `${platform}-${arch}`;
  return NATIVE_TARGETS.includes(target) ? target : undefined;
}

export function libraryFileName(platform: string = process.platform): string {
  return platform === "darwin" ? "libdawg_sink.dylib" : "libdawg_sink.so";
}

/** Where the package keeps prebuilt libraries and their manifest. */
export const PREBUILT_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "native",
  "prebuilt",
);

export type NativeManifest = Readonly<{
  abi: number;
  libraries: Readonly<Record<string, { file: string; sha256: string }>>;
}>;

/** Device stats, in the order `dawg_sink_stats` writes them. */
export type SinkStats = Readonly<{
  /** Frames queued in the ring (output) or captured and unread (input). */
  queued: number;
  /** Output: stream frames elapsed, starved ones included; input: captured. */
  frames: number;
  /** Output: underruns; input: frames dropped on a full ring. */
  xruns: number;
  /** Device latency (output: callback to speaker; input: mic to callback). */
  latencyNs: number;
  /** Host clock (`clockNs`) at the most recent callback. */
  callbackNs: number;
  /** Host time the first frame of that callback plays (or was captured). */
  edgeNs: number;
  /** `frames` at that edge. */
  framesAtEdge: number;
  bufferFrames: number;
  rate: number;
  channels: number;
  deviceRate: number;
  failed: boolean;
}>;

export type SinkDevice = Readonly<{
  name: string;
  default: boolean;
  channels: number;
  rate: number;
}>;

export type OpenRequest = Readonly<{
  /** Device name; undefined or "default" is the system default, "null" headless. */
  device?: string;
  rate: number;
  channels: number;
  /** Device buffer frames (0 keeps the device default). */
  bufferFrames?: number;
  ringFrames: number;
}>;

export interface SinkEndpoint {
  /** Queue interleaved samples (output); returns samples accepted. */
  write(samples: Float32Array): number;
  /** Read captured interleaved samples (input); returns samples read. */
  read(out: Float32Array): number;
  stats(): SinkStats;
  clear(): number;
  close(): void;
}

/** The sink as TypeScript sees it, over real ffi or a test fake. */
export interface SinkLibrary {
  readonly abiVersion: number;
  clockNs(): number;
  lastError(): string;
  devices(input: boolean): SinkDevice[];
  openOutput(request: OpenRequest): SinkEndpoint | undefined;
  openInput(request: OpenRequest): SinkEndpoint | undefined;
}

/** The raw symbols, as `bun:ffi` dlopen returns them (or a fake). */
export type SinkSymbols = Readonly<{
  dawg_sink_abi_version: () => number;
  dawg_sink_clock_ns: () => number | bigint;
  dawg_sink_last_error: (out: unknown, len: number) => number | bigint;
  dawg_sink_devices: (
    input: number,
    out: unknown,
    len: number,
  ) => number | bigint;
  dawg_sink_open: (...args: unknown[]) => unknown;
  dawg_capture_open: (...args: unknown[]) => unknown;
  dawg_sink_write: (
    sink: unknown,
    samples: unknown,
    count: number,
  ) => number | bigint;
  dawg_capture_read: (
    capture: unknown,
    out: unknown,
    count: number,
  ) => number | bigint;
  dawg_sink_stats: (endpoint: unknown, out: unknown) => number;
  dawg_sink_clear: (endpoint: unknown) => number | bigint;
  dawg_sink_close: (endpoint: unknown) => void;
}>;

export type Dlopen = (path: string) => SinkSymbols;

/** `bun:ffi` signatures for every exported symbol. */
const OPEN_ARGS = [T.ptr, T.u32, T.u32, T.u32, T.u32];
const ffiDlopen: Dlopen = (path) =>
  ffiOpen(path, {
    dawg_sink_abi_version: { args: [], returns: T.u32 },
    dawg_sink_clock_ns: { args: [], returns: T.u64 },
    dawg_sink_last_error: { args: [T.ptr, T.u64], returns: T.u64 },
    dawg_sink_devices: { args: [T.i32, T.ptr, T.u64], returns: T.u64 },
    dawg_sink_open: { args: OPEN_ARGS, returns: T.ptr },
    dawg_capture_open: { args: OPEN_ARGS, returns: T.ptr },
    dawg_sink_write: { args: [T.ptr, T.ptr, T.u64], returns: T.u64 },
    dawg_capture_read: { args: [T.ptr, T.ptr, T.u64], returns: T.u64 },
    dawg_sink_stats: { args: [T.ptr, T.ptr], returns: T.i32 },
    dawg_sink_clear: { args: [T.ptr], returns: T.u64 },
    dawg_sink_close: { args: [T.ptr], returns: T.void },
  }).symbols as unknown as SinkSymbols;

/** Wrap raw symbols in the typed `SinkLibrary` (pointers via `ptr`). */
export function bindSink(
  symbols: SinkSymbols,
  ptr: (view: ArrayBufferView) => unknown,
): SinkLibrary {
  const n = (value: number | bigint): number => Number(value);
  const text = (
    fill: (out: unknown, len: number) => number | bigint,
  ): string => {
    let size = 256;
    for (;;) {
      const buffer = new Uint8Array(size);
      const full = n(fill(ptr(buffer), size));
      if (full < size)
        return new TextDecoder().decode(buffer.subarray(0, full));
      size = full + 1;
    }
  };
  const endpoint = (handle: unknown): SinkEndpoint => {
    const stats = new BigUint64Array(STAT_COUNT);
    let open = true;
    return {
      write: (samples) =>
        open && samples.length > 0
          ? n(symbols.dawg_sink_write(handle, ptr(samples), samples.length))
          : 0,
      read: (out) =>
        open && out.length > 0
          ? n(symbols.dawg_capture_read(handle, ptr(out), out.length))
          : 0,
      stats: () => {
        if (open) symbols.dawg_sink_stats(handle, ptr(stats));
        const v = Array.from(stats, Number);
        return {
          queued: v[0]!,
          frames: v[1]!,
          xruns: v[2]!,
          latencyNs: v[3]!,
          callbackNs: v[4]!,
          edgeNs: v[5]!,
          framesAtEdge: v[6]!,
          bufferFrames: v[7]!,
          rate: v[8]!,
          channels: v[9]!,
          deviceRate: v[10]!,
          failed: v[11] !== 0 || !open,
        };
      },
      clear: () => (open ? n(symbols.dawg_sink_clear(handle)) : 0),
      close: () => {
        if (!open) return;
        open = false;
        symbols.dawg_sink_close(handle);
      },
    };
  };
  const opener =
    (fn: SinkSymbols["dawg_sink_open"]) =>
    (request: OpenRequest): SinkEndpoint | undefined => {
      const name = Buffer.from(`${request.device ?? "default"}\0`);
      const handle = fn(
        ptr(name),
        request.rate,
        request.channels,
        request.bufferFrames ?? 0,
        request.ringFrames,
      );
      return handle ? endpoint(handle) : undefined;
    };
  return {
    abiVersion: symbols.dawg_sink_abi_version(),
    clockNs: () => n(symbols.dawg_sink_clock_ns()),
    lastError: () => text((out, len) => symbols.dawg_sink_last_error(out, len)),
    devices: (input) =>
      text((out, len) => symbols.dawg_sink_devices(input ? 1 : 0, out, len))
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name = "", isDefault, channels, rate] = line.split("\t");
          return {
            name,
            default: isDefault === "1",
            channels: Number(channels),
            rate: Number(rate),
          };
        }),
    openOutput: opener(symbols.dawg_sink_open),
    openInput: opener(symbols.dawg_capture_open),
  };
}

export type NativeProbe =
  | Readonly<{ ok: true; library: SinkLibrary; path: string; detail: string }>
  | Readonly<{ ok: false; reason: string }>;

export type ProbeOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  platform?: string;
  arch?: string;
  /** Directory holding `manifest.json` and `<target>/<lib>`. */
  dir?: string;
  dlopen?: Dlopen;
  ptr?: (view: ArrayBufferView) => unknown;
}>;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Find, verify and load the sink. `DAWG_AUDIO_NATIVE=0` turns it off;
 * `DAWG_SINK_LIB=<path>` loads a local build unverified (development).
 */
export function probeNativeSink(options: ProbeOptions = {}): NativeProbe {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (env.DAWG_AUDIO_NATIVE === "0")
    return { ok: false, reason: "DAWG_AUDIO_NATIVE=0" };
  const override = env.DAWG_SINK_LIB?.trim();
  let path: string;
  let detail: string;
  if (override) {
    if (!existsSync(override))
      return { ok: false, reason: `DAWG_SINK_LIB ${override} not found` };
    path = override;
    detail = `${override} (DAWG_SINK_LIB, unverified)`;
  } else {
    const target = nativeTarget(platform, options.arch ?? process.arch);
    if (!target)
      return {
        ok: false,
        reason: `no prebuilt native sink for ${platform}-${options.arch ?? process.arch}`,
      };
    const dir = options.dir ?? PREBUILT_DIR;
    let manifest: NativeManifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    } catch {
      return { ok: false, reason: "native sink not installed (no manifest)" };
    }
    const entry = manifest.libraries?.[target];
    if (!entry || manifest.abi !== SINK_ABI_VERSION)
      return { ok: false, reason: `no native sink for ${target} in manifest` };
    path = join(dir, entry.file);
    if (!existsSync(path))
      return { ok: false, reason: `native sink ${entry.file} missing` };
    const actual = sha256File(path);
    if (actual !== entry.sha256)
      return {
        ok: false,
        reason: `native sink ${entry.file} sha256 mismatch (refusing to load)`,
      };
    detail = `${target} sha256 ${actual.slice(0, 12)} verified`;
  }
  try {
    const dlopen = options.dlopen ?? ffiDlopen;
    const ptr = options.ptr ?? (ffiPtr as (view: ArrayBufferView) => unknown);
    const library = bindSink(dlopen(path), ptr);
    if (library.abiVersion !== SINK_ABI_VERSION)
      return {
        ok: false,
        reason: `native sink ABI ${library.abiVersion}, expected ${SINK_ABI_VERSION}`,
      };
    return { ok: true, library, path, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `native sink failed to load: ${message.slice(0, 120)}`,
    };
  }
}

/**
 * Stream timing for one buffer, on the engine's monotonic ms clock: the
 * host time of the latest device callback, when its first frame is heard,
 * and the device latencies. Networked sessions align on these.
 */
export type AudioTiming = Readonly<{
  /** Monotonic ms of the latest device callback. */
  callbackMs: number;
  /** Monotonic ms the engine stream frame `frame` is heard at. */
  heardMs: number;
  frame: number;
  outputLatencyMs: number;
  inputLatencyMs?: number;
  underruns: number;
  queuedFrames: number;
  bufferFrames: number;
  deviceRate: number;
}>;

/** Maps the sink's host clock onto the engine's monotonic ms clock. */
export function clockOffsetMs(
  library: SinkLibrary,
  now: () => number = () => performance.now(),
): number {
  const before = now();
  const ns = library.clockNs();
  const after = now();
  return (before + after) / 2 - ns / 1e6;
}

/** What the engine asks a device-clocked player (see `NativePlayer`). */
export type PlayerClock = Readonly<{
  /** Frames queued ahead of the device. */
  queuedFrames: () => number;
  /**
   * Stream frames the device played as silence since the last call (an
   * underrun); the engine skips its cursor by as much to stay on time.
   */
  slipFrames: () => number;
  /** Monotonic ms engine stream frame `frame` is heard at. */
  frameMs: (frame: number) => number;
  timing: () => AudioTiming;
}>;

/**
 * A `PlayerProcess` over the sink: s16le chunks from the engine become f32
 * (exactly `v / 32768`, so what plays is sample-identical to the stream the
 * stdin players get). A device failure ends it like a dead player process,
 * so the engine's respawn path reopens the (possibly new) default device.
 */
export class NativePlayer {
  public readonly pid = 0;
  public readonly exited: Promise<number>;
  public readonly clock: PlayerClock;
  public readonly stdin: { write(chunk: Uint8Array): void; end(): void };
  private resolveExit: (code: number) => void = () => undefined;
  private done = false;
  /** Engine stream frames written so far. */
  private written = 0;
  /** Device stream index minus engine stream frame, at the last check. */
  private offset = 0;
  /** Set by the first write: frames the device played before it don't count. */
  private anchored = false;
  private readonly offsetMs: number;

  public constructor(
    private readonly endpoint: SinkEndpoint,
    private readonly library: SinkLibrary,
    private readonly channels: number,
    private readonly rate: number,
    now: () => number = () => performance.now(),
  ) {
    this.exited = new Promise((resolve) => (this.resolveExit = resolve));
    this.offsetMs = clockOffsetMs(library, now);
    this.stdin = {
      write: (chunk) => this.write(chunk),
      end: () => undefined,
    };
    this.clock = {
      queuedFrames: () => {
        const stats = this.endpoint.stats();
        // A lost device ends the player; the engine respawns on the default.
        if (stats.failed) this.kill(1);
        return stats.queued;
      },
      slipFrames: () => {
        if (!this.anchored) return 0;
        const stats = this.endpoint.stats();
        const offset = stats.frames + stats.queued - this.written;
        const slip = Math.max(0, offset - this.offset);
        this.offset = Math.max(this.offset, offset);
        return slip;
      },
      frameMs: (frame) => this.frameMs(frame, this.endpoint.stats()),
      timing: () => {
        const stats = this.endpoint.stats();
        const frame = Math.max(0, stats.framesAtEdge - this.offset);
        return {
          callbackMs: stats.callbackNs / 1e6 + this.offsetMs,
          heardMs: this.frameMs(frame, stats),
          frame,
          outputLatencyMs: stats.latencyNs / 1e6,
          underruns: stats.xruns,
          queuedFrames: stats.queued,
          bufferFrames: stats.bufferFrames,
          deviceRate: stats.deviceRate,
        };
      },
    };
  }

  private frameMs(frame: number, stats: SinkStats): number {
    return (
      stats.edgeNs / 1e6 +
      this.offsetMs +
      ((frame + this.offset - stats.framesAtEdge) * 1000) / this.rate
    );
  }

  private write(chunk: Uint8Array): void {
    if (this.done) return;
    if (this.endpoint.stats().failed) {
      this.kill(1);
      return;
    }
    if (!this.anchored) {
      const stats = this.endpoint.stats();
      this.offset = stats.frames + stats.queued;
      this.anchored = true;
    }
    const pcm = new Int16Array(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength >> 1,
    );
    const samples = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1)
      samples[index] = pcm[index]! / 32768;
    const accepted = this.endpoint.write(samples);
    // A full ring drops the tail; count it as written so timing holds.
    this.written += pcm.length / this.channels;
    if (accepted < samples.length)
      this.offset -= (samples.length - accepted) / this.channels;
  }

  public kill(code = 0): void {
    if (this.done) return;
    this.done = true;
    this.endpoint.close();
    this.resolveExit(code);
  }
}

/** Ring sizing: two seconds holds the engine's one-second cap plus lead. */
export function openNativePlayer(
  library: SinkLibrary,
  options: Readonly<{
    rate: number;
    channels: number;
    device?: string;
    bufferFrames?: number;
    /** The engine's monotonic ms clock (timing is reported on it). */
    now?: () => number;
  }>,
): NativePlayer {
  const endpoint = library.openOutput({
    ...(options.device ? { device: options.device } : {}),
    rate: options.rate,
    channels: options.channels,
    bufferFrames: options.bufferFrames ?? 0,
    ringFrames: options.rate * 2,
  });
  if (!endpoint)
    throw new Error(library.lastError() || "native sink open failed");
  return new NativePlayer(
    endpoint,
    library,
    options.channels,
    options.rate,
    options.now,
  );
}

/**
 * Input capture for recorded takes: the device fills a ring, `drain` pulls
 * what has arrived. The sink keeps no score state; `writeTake` stores the
 * audio as a sha256-named WAV and the caller commits one `setClips` op.
 */
export class NativeCapture {
  private readonly chunks: Float32Array[] = [];
  private readonly scratch: Float32Array;

  public constructor(
    private readonly endpoint: SinkEndpoint,
    public readonly rate: number,
    public readonly channels: number,
  ) {
    this.scratch = new Float32Array(rate * channels);
  }

  public static open(
    library: SinkLibrary,
    options: Readonly<{
      rate: number;
      channels: number;
      device?: string;
      bufferFrames?: number;
    }>,
  ): NativeCapture {
    const endpoint = library.openInput({
      ...(options.device ? { device: options.device } : {}),
      rate: options.rate,
      channels: options.channels,
      bufferFrames: options.bufferFrames ?? 0,
      ringFrames: options.rate * 4,
    });
    if (!endpoint)
      throw new Error(library.lastError() || "native capture open failed");
    return new NativeCapture(endpoint, options.rate, options.channels);
  }

  /** Pull everything captured so far; returns samples added. */
  public drain(): number {
    let total = 0;
    for (;;) {
      const got = this.endpoint.read(this.scratch);
      if (got === 0) return total;
      this.chunks.push(this.scratch.slice(0, got));
      total += got;
    }
  }

  public stats(): SinkStats {
    return this.endpoint.stats();
  }

  /** Stop and return every captured sample, interleaved. */
  public close(): Float32Array {
    this.drain();
    this.endpoint.close();
    const out = new Float32Array(
      this.chunks.reduce((sum, c) => sum + c.length, 0),
    );
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Store a take as `tracks/<slug>/takes/<sha256>.wav` (16-bit PCM). Returns
 * the project-relative `src` and its `sha256` for the caller's `setClips`.
 */
export async function writeTake(
  projectRoot: string,
  trackSlug: string,
  samples: Float32Array,
  rate: number,
  channels: number,
): Promise<{ src: string; sha256: string }> {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1)
    pcm[index] = Math.max(
      -32768,
      Math.min(32767, Math.round(samples[index]! * 32768)),
    );
  const bytes = encodeWav(pcm, rate, channels);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const src = `tracks/${trackSlug}/takes/${sha256}.wav`;
  await mkdir(join(projectRoot, "tracks", trackSlug, "takes"), {
    recursive: true,
  });
  await writeFile(join(projectRoot, src), bytes);
  return { src, sha256 };
}
