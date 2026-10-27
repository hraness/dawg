import { loopSecondsOf } from "../../core/tempo.ts";
import { MonitorBuffer } from "./monitor-buffer.ts";
import type { TrackScore } from "../../core/score.ts";
import { PlaybackLock } from "./lock.ts";
import { LoopPlayer } from "./player.ts";
import {
  LoopRenderer,
  RenderCancelledError,
  type LoopRender,
  type MonitorJob,
} from "./renderer.ts";
import {
  clickSounds,
  clicksIn,
  type ClickGrid,
  type ClickLevel,
} from "./click.ts";
import type { LiveNotePcm } from "./live.ts";
import { RING_OUT_FADE_SECONDS } from "./instruments.ts";
import { measureLoudness, pcmChannels } from "./loudness.ts";
import type { MasterReport } from "./master.ts";
import { levelOf, type SoundLevel } from "./preview.ts";
import { DEFAULT_SAMPLE_RATE, RENDER_CHANNELS } from "./wav.ts";
import { statSync } from "node:fs";
import {
  audioChoicePath,
  readAudioChoice,
  resolveOutputDevice,
} from "./devices.ts";
import { playbackTime, QUICK_PREROLL_SECONDS } from "./arrange.ts";
import { transportMapFor, type TransportMap } from "./clock.ts";
import {
  openNativePlayer,
  probeNativeSink,
  type AudioTiming,
  type NativeProbe,
  type PlayerClock,
  type SinkLibrary,
} from "./native.ts";

/**
 * How dawgd (or a file-mode window) makes sound.
 *
 * - `ffplay` and `sox` are streaming backends: one long-lived player reads
 *   raw interleaved s16le stereo PCM from stdin, and the engine writes the
 *   loop into it paced by the wall clock. Edits swap the loop buffer at the
 *   current phase, so playback never restarts and stays sample-continuous.
 * - `afplay` is the last fallback: re-render a WAV and restart the one-shot
 *   player on every edit (the pre-engine behavior), so edits cause a gap.
 * - `command` is an explicit DAWG_AUDIO_PLAYER override that also reads
 *   s16le from stdin; tests use it to record the exact byte stream.
 * - `none` makes no sound; the transport clock still runs.
 */
export type AudioBackend =
  "native" | "ffplay" | "sox" | "afplay" | "command" | "none";

export type AudioBackendInfo = Readonly<{
  backend: AudioBackend;
  /** True for gapless stdin-streaming backends. */
  streaming: boolean;
  /** argv with `{rate}` / `{channels}` already substituted, if streaming. */
  command?: readonly string[];
  /** Human-readable reason the backend was chosen. */
  detail: string;
  /** The loaded sink, for the `native` backend. */
  native?: SinkLibrary;
  /** Why the native sink is not in use, when another backend was picked. */
  nativeUnavailable?: string;
}>;

type Which = (binary: string) => string | null;

export type DetectOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  which?: Which;
  platform?: NodeJS.Platform;
  sampleRate?: number;
  /** Native sink probe; `false` skips it (tests). Default: the real one. */
  native?: (() => NativeProbe) | false;
}>;

let cachedProbe: NativeProbe | undefined;

/**
 * Replace the process's native probe (a test preload's fake sink, so a PTY
 * run can list and switch devices without hardware).
 */
export function setNativeProbe(probe: NativeProbe | undefined): void {
  cachedProbe = probe;
}

/** The real probe, once per process (dlopen is not repeated). */
function defaultNativeProbe(): NativeProbe {
  cachedProbe ??= probeNativeSink();
  return cachedProbe;
}

/** Streaming argv for the known stdin players. */
export function streamingCommand(
  backend: "ffplay" | "sox",
  binary: string,
  sampleRate: number,
): string[] {
  if (backend === "ffplay")
    return [
      binary,
      "-nodisp",
      "-hide_banner",
      "-loglevel",
      "quiet",
      "-fflags",
      "nobuffer",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ch_layout",
      "stereo",
      "-i",
      "-",
    ];
  return [
    binary,
    "-q",
    "-t",
    "raw",
    "-r",
    String(sampleRate),
    "-e",
    "signed-integer",
    "-b",
    "16",
    "-c",
    String(RENDER_CHANNELS),
    "-L",
    "-",
  ];
}

/**
 * Pick the audio backend. Order: DAWG_AUDIO=0 (none), DAWG_AUDIO_PLAYER
 * (explicit stdin command), DAWG_AUDIO_BACKEND (forced name), then the
 * native sink, ffplay, sox `play`, and afplay (macOS) in that order. When
 * the native sink cannot load, the fallback's detail says why.
 */
export function detectAudioBackend(
  options: DetectOptions = {},
): AudioBackendInfo {
  const env = options.env ?? process.env;
  const which: Which = options.which ?? ((binary) => Bun.which(binary));
  const platform = options.platform ?? process.platform;
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (env.DAWG_AUDIO === "0")
    return { backend: "none", streaming: false, detail: "DAWG_AUDIO=0" };
  const custom = env.DAWG_AUDIO_PLAYER?.trim();
  if (custom) {
    const command = parseCommand(custom).map((part) =>
      part
        .replaceAll("{rate}", String(sampleRate))
        .replaceAll("{channels}", String(RENDER_CHANNELS)),
    );
    if (command.length > 0)
      return {
        backend: "command",
        streaming: true,
        command,
        detail: "DAWG_AUDIO_PLAYER",
      };
  }
  const forced = env.DAWG_AUDIO_BACKEND?.trim().toLowerCase();
  const candidates: AudioBackend[] =
    forced === "native" ||
    forced === "ffplay" ||
    forced === "sox" ||
    forced === "afplay" ||
    forced === "none"
      ? [forced]
      : ["native", "ffplay", "sox", "afplay"];
  let unavailable: string | undefined;
  const why = (info: AudioBackendInfo): AudioBackendInfo =>
    unavailable
      ? {
          ...info,
          detail: `${info.detail} · native sink unavailable: ${unavailable}`,
          nativeUnavailable: unavailable,
        }
      : info;
  for (const candidate of candidates) {
    if (candidate === "native") {
      if (options.native === false) continue;
      const probe = options.native
        ? options.native()
        : env === process.env && options.platform === undefined
          ? defaultNativeProbe()
          : probeNativeSink({ env, platform });
      if (probe.ok)
        return {
          backend: "native",
          streaming: true,
          native: probe.library,
          detail: `native sink ${probe.detail} (device callback)`,
        };
      unavailable = probe.reason;
      continue;
    }
    if (candidate === "none")
      return {
        backend: "none",
        streaming: false,
        detail: "DAWG_AUDIO_BACKEND",
      };
    if (candidate === "ffplay" || candidate === "sox") {
      const binary = which(candidate === "ffplay" ? "ffplay" : "play");
      if (!binary) continue;
      return why({
        backend: candidate,
        streaming: true,
        command: streamingCommand(candidate, binary, sampleRate),
        detail: `${binary} (gapless stream)`,
      });
    }
    const binary = platform === "darwin" ? which("afplay") : null;
    if (binary)
      return why({
        backend: "afplay",
        streaming: false,
        detail: `${binary} (re-render on edit; install ffmpeg or sox for gapless playback)`,
      });
  }
  return why({
    backend: "none",
    streaming: false,
    detail: "no player found (install ffmpeg or sox)",
  });
}

/** One status line for `dawg auth status` and the header. */
export function audioStatusLine(info = detectAudioBackend()): string {
  return `audio: ${info.backend} · ${info.detail}`;
}

/** Splits a command string on whitespace, honoring simple quotes. */
function parseCommand(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of value.matchAll(pattern))
    parts.push(match[1] ?? match[2] ?? match[3]!);
  return parts;
}

/**
 * Swaps crossfade old to new over this window with equal-power gains
 * (cos/sin), reading both loops at the same beat. 20 ms is long enough that
 * the step a hard cut makes is spread below ~50 Hz (no click, even on a
 * full-scale low bass), short enough to sit inside the transport's 30 ms
 * resync tolerance and below the shortest audible echo (~30-50 ms), so an
 * edit never sounds smeared or doubled. Playback only: renders, exports and
 * the loop buffers themselves never pass through it.
 */
export const SWAP_FADE_SECONDS = 0.02;

/** Swaps re-anchor to the transport only past this disagreement. */
const RESYNC_SECONDS = 0.03;

type Sink = {
  write(chunk: Uint8Array): unknown;
  flush?(): unknown;
  end?(): unknown;
};

type PlayerProcess = {
  readonly pid: number;
  readonly stdin: Sink;
  readonly exited: Promise<number>;
  kill(): void;
  /** Device-clocked players (the native sink) pace the pump themselves. */
  readonly clock?: PlayerClock;
};

/** Play-mode lead on the native sink: the ring only covers pump jitter. */
export const NATIVE_PLAY_LEAD_MS = 15;
/** Pump interval on the native sink. */
export const NATIVE_TICK_MS = 5;

function envNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export type AudioEngineOptions = Readonly<{
  lockPath?: string;
  info?: AudioBackendInfo;
  sampleRate?: number;
  /** Frames written ahead of the wall clock. Bounds the player queue. */
  leadMs?: number;
  /** Pump interval. */
  tickMs?: number;
  /** Monotonic milliseconds. Injected by tests to drive the pump. */
  now?: () => number;
  /** Set false to drive `pump()` manually (tests). */
  timer?: boolean;
  spawn?: (command: readonly string[]) => PlayerProcess;
  /** Set false to render on the calling thread instead of a worker. */
  worker?: boolean;
  /** Cursor-first fixed-gain windows for arrangements over 45 seconds. */
  progressive?: boolean;
  /** Background workers rendering those windows ahead (default by cores). */
  renderWorkers?: number;
  /** Project root for sampler voices; without it samplers render silent. */
  projectRoot?: string;
  /** Base delay before a dead player is respawned; doubles per attempt. */
  respawnMs?: number;
  /** Player lifecycle notices worth a status line. */
  onStatus?: (status: AudioStatus) => void;
  /** Play-mode lead (default 60 ms; 15 ms on the native sink). */
  playLeadMs?: number;
  /**
   * Output device name (native sink; sox via AUDIODEV). Default:
   * DAWG_AUDIO_DEVICE, then the saved choice (src/audio/devices.ts), then
   * the system default. `null` forces the system default.
   */
  device?: string | null;
  /**
   * The saved choice to follow (`<config>/audio.json`): checked about once
   * a second while playing and before each player starts, so a choice made
   * in another window or the daemon's client moves playback. Defaults to
   * the real file when the backend is auto-detected (no `info`, no
   * `spawn`, no `device`); `false` never follows one.
   */
  choicePath?: string | false;
  /** Native sink device buffer frames (default 128; 0 = device default). */
  bufferFrames?: number;
}>;

export type AudioStatus = Readonly<{
  /**
   * `restarting`: the player died and is being respawned; `stopped`: gave
   * up; `device`: the chosen output is gone, playback moved to the default.
   */
  state: "restarting" | "stopped" | "device";
  message: string;
}>;

/** Respawns of a dying player before playback is declared stopped. */
const MAX_RESPAWNS = 3;
/** How often a playing engine checks the saved device choice. */
const CHOICE_CHECK_MS = 1000;

function fileMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function cleanEnvDevice(): string | undefined {
  return resolveOutputDevice(process.env, {});
}
/** A player that ran this long before dying resets the respawn budget. */
const RESPAWN_RESET_MS = 10_000;
/**
 * Default queue lead: the edit-to-audible floor while playing. 100 ms leaves
 * 80 ms of slack over the 20 ms pump tick for main-thread stalls (a frame
 * costs about 1 ms; play mode already runs at 60 ms).
 */
const DEFAULT_LEAD_MS = 100;
/** Inline renders grow the lead to this multiple of the last render time. */
const LEAD_RENDER_FACTOR = 1.5;
/** Seconds of monitor audio kept rendered ahead of the playhead. */
const MONITOR_AHEAD_SECONDS = 48;
/** While a new song version renders, the old one keeps only this runway. */
const MONITOR_HANDOFF_SECONDS = 6;
/** The first window a start renders: short, so sound comes in quickly. */
const MONITOR_START_SECONDS = 2;
/** The first window's shape (a prewarm renders the same one). */
const START_JOB = Object.freeze({
  quick: true,
  seconds: MONITOR_START_SECONDS,
});
const MONITOR_CATCH_UP_SECONDS = 3;
// Runway a start waits for past the playhead: about four seconds per unit of
// render cost, so slow machines buffer a little longer instead of cutting out.
const MONITOR_RUNWAY_PER_COST = 4;
const MONITOR_RUNWAY_MAX_SECONDS = 6;
const MONITOR_START_WAIT_MS = 6000;
/** Longest window; long windows spread the pre-roll over more output. */
const MONITOR_FULL_SECONDS = 16;
/** Shortest full-quality window worth its pre-roll. */
const MONITOR_MIN_FULL_SECONDS = 6;
/** Pre-roll a full-quality window renders (the arranger's overhang). */
const MONITOR_FULL_PREROLL_SECONDS = 8;
/** Retained monitor PCM: about 170 s of stereo at 48 kHz. */
const MONITOR_BYTES = 32 * 1024 * 1024;
/** Longest wait before retrying a window that failed. */
const MONITOR_RETRY_MAX_MS = 4000;

type MonitorStream = { score: TrackScore; buffer: MonitorBuffer };

/** A monitor window being rendered, and the frames it is expected to cover. */
type MonitorFill = {
  stream: MonitorStream;
  start: number;
  end: number;
  /** The foreground render a play or edit waits on (not a pool slot). */
  foreground?: boolean;
  /** Cancelled with the pool; settling, and no longer holding a slot. */
  cancelled?: boolean;
};

const wrapFrame = (frame: number, frames: number) =>
  ((frame % frames) + frames) % frames;

type Loop = Readonly<{
  monitor?: MonitorStream;
  pcm: Int16Array;
  frames: number;
  framesPerBeat: number;
  /** The song's tempo map; absent, a beat is `framesPerBeat` frames. */
  map?: TransportMap;
  sampleRate: number;
}>;

/** Loop frame (unwrapped without a map) where transport `beat` sounds. */
function frameOfBeat(loop: Loop, beat: number): number {
  const map = loop.map;
  if (!map) return beat * loop.framesPerBeat;
  const inner = ((beat % map.loopBeats) + map.loopBeats) % map.loopBeats;
  return map.seconds(inner) * loop.sampleRate;
}

/** Transport beat at loop `frame` (inside one pass with a map). */
function beatOfFrame(loop: Loop, frame: number): number {
  const map = loop.map;
  if (!map) return frame / loop.framesPerBeat;
  const seconds = frame / loop.sampleRate;
  const inner =
    ((seconds % map.loopSeconds) + map.loopSeconds) % map.loopSeconds;
  return map.beat(inner);
}

/** The beat `frames` stream frames after `beat`. */
function beatAfter(loop: Loop, beat: number, frames: number): number {
  if (!loop.map) return beat + frames / loop.framesPerBeat;
  return beatOfFrame(loop, frameOfBeat(loop, beat) + frames);
}

/** A loop fading out after a swap, read on from where it was. */
type FadeOut = {
  loop: Loop;
  cursor: number;
  /** Its gain when the fade began (below 1 when swapped out mid-fade). */
  from: number;
  /** Frames of the fade already written. */
  done: number;
};

/**
 * The click bus: the engine asks `beatAt` for the transport beat at a stream
 * frame's wall time (undefined while the transport is stopped; negative
 * during a count-in) and mixes a click on every step it crosses. It is a
 * monitoring bus only, never part of a loop render or an export.
 */
export type ClickBus = Readonly<{
  volume: number;
  beatsPerBar: number;
  subdivision: number;
  /** Meter-aware clicks (core/tempo.ts) replacing the fixed grid. */
  grid?: ClickGrid;
  beatAt: (monotonicMs: number) => number | undefined;
}>;

type LiveVoice = {
  pcm: Int16Array;
  frames: number;
  /** Frames of this voice already mixed. */
  position: number;
  /** Fade-out frames left once released early; undefined while sounding. */
  fadeLeft: number | undefined;
  fadeFrames: number;
  /** Rings to its end on note-off (0.6.1 modal ring-out). */
  ringOut?: boolean;
};

/**
 * At most this many ring-out voices sound at once; the oldest beyond it fades
 * over `RING_OUT_FADE_SECONDS` (spec 7.3: 32 resonator voices).
 */
export const MAX_RING_OUT_VOICES = 32;

type PlayRequest = {
  revision: number;
  seekRevision: number;
  score: TrackScore;
  beat: number | undefined;
  /** Monotonic ms when `beat` was observed. */
  atMs: number;
  /**
   * The transport holds at `beat` until this start is heard (`cue`), so
   * the start renders and plays from `beat` itself, not where a running
   * playhead would be by the time the first window lands.
   */
  cued: boolean;
  generation: number;
  waiters: { resolve: () => void; reject: (error: Error) => void }[];
};

/**
 * The gapless audio engine. Short songs render into one seamless loop; long
 * streaming arrangements use bounded fixed-gain monitoring windows. Exact
 * whole-song loudness remains an export operation.
 *
 * Timing: the engine is paced by the same monotonic clock as the transport.
 * Frame `n` of the stream belongs to wall time `start + n / rate`, and the
 * engine keeps a lead of audio queued ahead of now: `leadMs`, or 1.5x the
 * last render time when renders run inline (no worker) and are slower. The device
 * plays the queue at its own rate, so what you hear trails the transport by
 * the player's fixed output latency and never accumulates drift from
 * re-renders. Renders run in a worker; an edit re-renders off-thread and
 * swaps the buffer for every frame not yet written, mapping the current beat
 * into the new loop, so tempo and length changes keep the musical position.
 * Edits that arrive while a render is in flight coalesce into one render of
 * the newest score.
 */
export class AudioEngine {
  public readonly info: AudioBackendInfo;
  private readonly lock: PlaybackLock;
  public readonly sampleRate: number;
  private leadFrames: number;
  private readonly defaultLeadFrames: number;
  private readonly tickMs: number;
  /** The lead play mode and auditions pin (see `setLeadMs`). */
  public readonly playLeadMs: number;
  private readonly now: () => number;
  private readonly useTimer: boolean;
  private readonly customSpawn:
    ((command: readonly string[]) => PlayerProcess) | undefined;
  private readonly bufferFrames: number;
  /** The output device the next player opens (undefined: system default). */
  private outputDevice: string | undefined;
  private readonly choicePath: string | false;
  private choiceMtime: number;
  private choiceCheckedMs = Number.NEGATIVE_INFINITY;
  private readonly renderer: LoopRenderer;
  private readonly progressive: boolean;
  private renderRevision = 0;
  private seekRevision = 0;
  private seekAnchor: { beat: number; atMs: number } | undefined;
  /** Monitor windows in flight, foreground and background. */
  private fills: MonitorFill[] = [];
  /** A play or edit whose first window is still rendering. */
  private pendingLoop: { loop: Loop; request: PlayRequest } | undefined;
  /** A rendered edit waiting until its windows cover the playhead. */
  private incoming: { loop: Loop; request: PlayRequest } | undefined;
  /** Wall seconds per rendered second, learned from finished windows. */
  private renderCost = 0.75;
  /** Seconds from a play request until its first window lands. */
  private startLatency = 0;
  /** A starting stream waiting for any window to cover its playhead. */
  private startWaiter?: {
    stream: MonitorStream;
    resolve: (render: LoopRender) => void;
    reject: (error: Error) => void;
    render?: LoopRender;
  };
  private monitorFailed:
    { stream: MonitorStream; atMs: number; count: number } | undefined;
  private monitorBuffering = false;
  private monitorWanted = false;
  private readonly respawnMs: number;
  private readonly onStatus: ((status: AudioStatus) => void) | undefined;
  private fallback: LoopPlayer | undefined;
  private child: PlayerProcess | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private loop: Loop | undefined;
  /** Loops fading out after swaps (see `SWAP_FADE_SECONDS`). */
  private fades: FadeOut[] = [];
  /** Frames of the current loop's fade-in already written, while fading. */
  private fadeIn: number | undefined;
  private readonly fadeFrames: number;
  /** Monotonic ms that stream frame 0 belongs to. */
  private startMs = 0;
  /** Stream frames written since `startMs`. */
  private written = 0;
  /** Loop frame that stream frame `written` reads next (fractional-free). */
  private cursor = 0;
  private starting: Promise<void> | undefined;
  private generation = 0;
  private spawns = 0;
  private queued: PlayRequest | undefined;
  /** The request `drain` is rendering or applying. */
  private inflight: PlayRequest | undefined;
  /** Monotonic ms the latest cued start's beat is heard at (see `cue`). */
  private cueHeardMs: number | undefined;
  /** The prewarm rendering, and the newest one waiting behind it. */
  private warming: Promise<void> | undefined;
  private warmNext: { score: TrackScore; beat: number } | undefined;
  private draining = false;
  private lastRenderMs = 0;
  /** The loop last swapped in, for `level` (measured on demand, once). */
  private lastLoopPcm: Int16Array | undefined;
  private measured: { pcm: Int16Array; level: SoundLevel } | undefined;
  private loudnessOf: { pcm: Int16Array; report: MasterReport } | undefined;
  /** Loudness the song master reached on the loop now playing. */
  private lastMaster: MasterReport | undefined;
  private respawns = 0;
  private respawnTimer: ReturnType<typeof setTimeout> | undefined;
  /** Play mode: keep a player running without a loop for live voices. */
  private monitoring = false;
  /** A lead set by `setLeadMs` (play mode, auditions) is not adapted. */
  private leadPinned = false;
  private readonly voices = new Map<number, LiveVoice>();
  private click: ClickBus | undefined;
  private clickVoices: { sound: Float32Array; position: number }[] = [];
  private sounds: Readonly<Record<ClickLevel, Float32Array>> | undefined;

  public constructor(options: AudioEngineOptions = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.info =
      options.info ?? detectAudioBackend({ sampleRate: this.sampleRate });
    this.lock = new PlaybackLock(options.lockPath);
    this.leadFrames = Math.round(
      ((options.leadMs ?? DEFAULT_LEAD_MS) * this.sampleRate) / 1000,
    );
    this.defaultLeadFrames = this.leadFrames;
    this.fadeFrames = Math.max(
      1,
      Math.round(SWAP_FADE_SECONDS * this.sampleRate),
    );
    const native =
      this.info.backend === "native" ? this.info.native : undefined;
    this.tickMs = options.tickMs ?? (native ? NATIVE_TICK_MS : 20);
    this.playLeadMs =
      options.playLeadMs ??
      envNumber(process.env.DAWG_PLAY_LEAD_MS) ??
      (native ? NATIVE_PLAY_LEAD_MS : 60);
    this.now = options.now ?? (() => performance.now());
    this.useTimer = options.timer ?? true;
    this.choicePath =
      options.choicePath ??
      (options.info === undefined &&
      options.spawn === undefined &&
      options.device === undefined
        ? audioChoicePath()
        : false);
    this.outputDevice =
      options.device === null
        ? undefined
        : ((options.device?.trim() || undefined) ??
          (this.choicePath
            ? resolveOutputDevice(process.env, readAudioChoice(this.choicePath))
            : cleanEnvDevice()));
    this.choiceMtime = this.choicePath ? fileMtime(this.choicePath) : 0;
    this.bufferFrames =
      options.bufferFrames ?? envNumber(process.env.DAWG_AUDIO_BUFFER) ?? 128;
    this.customSpawn = options.spawn;
    this.respawnMs = options.respawnMs ?? 250;
    this.onStatus = options.onStatus;
    this.progressive = options.progressive ?? true;
    this.renderer = new LoopRenderer({
      sampleRate: this.sampleRate,
      ...(options.worker === undefined ? {} : { worker: options.worker }),
      ...(options.renderWorkers === undefined
        ? {}
        : { backgroundWorkers: options.renderWorkers }),
      ...(options.projectRoot === undefined
        ? {}
        : { projectRoot: options.projectRoot }),
    });
    if (this.info.backend === "afplay")
      this.fallback = new LoopPlayer(options.lockPath, options.projectRoot);
  }

  /** Whether a streaming player process is currently running. */
  public get streaming(): boolean {
    return this.child !== undefined;
  }

  /** Player processes started so far (gapless edits never add one). */
  public get playerStarts(): number {
    return this.spawns;
  }

  /** Milliseconds the most recent loop render took. */
  public get renderMs(): number {
    return this.lastRenderMs;
  }

  /** Foreground synthesis takes priority over optional full-song analysis. */
  public get preparing(): boolean {
    return this.draining || this.queued !== undefined || this.fills.length > 0;
  }

  /**
   * Set the queue lead (play mode drops it to ~60 ms so a key sounds soon
   * after it is pressed); `undefined` restores the constructed lead.
   */
  public setLeadMs(ms: number | undefined): void {
    this.leadPinned = ms !== undefined;
    this.leadFrames =
      ms === undefined
        ? this.defaultLeadFrames
        : Math.max(1, Math.round((ms * this.sampleRate) / 1000));
  }

  /**
   * A few words on how play mode sounds, for the play strip: the native
   * sink, or the stdin player and why the sink is not in use.
   */
  public get audioNote(): string {
    const monitor = this.loop?.monitor
      ? ` · causal monitor${this.loop.monitor.score.master?.target !== undefined ? " · target on export" : ""}${this.monitorBuffering ? " · buffering" : ""}${this.monitorFailed?.stream === this.loop.monitor ? " · unavailable" : ""}`
      : "";
    if (this.info.backend === "native") return "native sink" + monitor;
    return this.info.nativeUnavailable
      ? `${this.info.backend} · no native sink${monitor}`
      : this.info.backend + monitor;
  }

  /** Lead in milliseconds: how far ahead of now a new live voice sounds. */
  public get leadMs(): number {
    return (this.lead * 1000) / this.sampleRate;
  }

  /** Whether live voices and the click can sound (a streaming backend). */
  /**
   * RMS, peak and clips of the loop now playing (the audition meter);
   * measured once per render, on first read. Undefined before any render
   * or with no audio device.
   */
  public get level(): SoundLevel | undefined {
    const pcm = this.lastLoopPcm;
    if (!pcm) return undefined;
    if (this.measured?.pcm !== pcm)
      this.measured = { pcm, level: levelOf(pcm) };
    return this.measured.level;
  }

  /**
   * Integrated loudness and true peak of the loop now playing, after the
   * song master when there is one (the header meter). Without a master the
   * loop's PCM is measured once per render, on first read. Undefined before
   * any render.
   */
  public get loudness(): MasterReport | undefined {
    if (this.loop?.monitor) return undefined;
    const pcm = this.lastLoopPcm;
    if (!pcm) return undefined;
    if (this.lastMaster) return this.lastMaster;
    if (this.loudnessOf?.pcm !== pcm) {
      const [left, right] = pcmChannels(pcm);
      const measured = measureLoudness(left, right, this.sampleRate, {
        loop: true,
      });
      this.loudnessOf = {
        pcm,
        report: {
          gainDb: 0,
          integrated: measured.integrated,
          truePeak: measured.truePeak,
        },
      };
    }
    return this.loudnessOf.report;
  }

  public get canMonitor(): boolean {
    return this.info.backend !== "none" && !this.fallback;
  }

  /**
   * Play mode: keep the player running while the transport is stopped so
   * live notes and the click sound over silence. Off stops a loopless player.
   */
  public async monitor(on: boolean): Promise<void> {
    if (!this.canMonitor) return;
    this.monitoring = on;
    if (on) {
      if (this.child || this.starting) return;
      this.starting = this.start(undefined, 0).finally(() => {
        this.starting = undefined;
      });
      await this.starting;
      return;
    }
    this.voices.clear();
    this.clickVoices = [];
    if (!this.loop) await this.stopAsync();
  }

  public get monitoringLive(): boolean {
    return this.monitoring;
  }

  /**
   * Start a live voice at the write head: it sounds `leadMs` from now, and
   * the return value is the monotonic ms its first frame is scheduled at
   * (before the device's own output latency). A
   * voice with the same id is replaced in place (a re-rendered, longer or
   * released note keeps its position, so the swap is seamless).
   */
  public noteOn(id: number, note: LiveNotePcm): number {
    const existing = this.voices.get(id);
    if (existing) {
      existing.pcm = note.pcm;
      existing.frames = note.frames;
      existing.fadeLeft = undefined;
      existing.fadeFrames = this.releaseFrames(note);
      existing.ringOut = note.ringOut === true;
    } else {
      this.voices.set(id, {
        pcm: note.pcm,
        frames: note.frames,
        position: 0,
        fadeLeft: undefined,
        fadeFrames: this.releaseFrames(note),
        ...(note.ringOut ? { ringOut: true } : {}),
      });
      if (note.ringOut) this.capRingOut();
    }
    // Write what is due now so the voice joins the very next chunk.
    const first = this.written;
    this.pump();
    return this.frameMs(first);
  }

  /** A live voice's note-off fade: 10 ms, or the instrument's release. */
  private releaseFrames(note: LiveNotePcm): number {
    return Math.max(
      1,
      Math.round(this.sampleRate * (note.releaseSeconds ?? 0.01)),
    );
  }

  /**
   * Past `MAX_RING_OUT_VOICES` ringing voices, fade the oldest still at full
   * level over `RING_OUT_FADE_SECONDS` (Map order is start order).
   */
  private capRingOut(): void {
    let ringing = 0;
    for (const voice of this.voices.values())
      if (voice.ringOut && voice.fadeLeft === undefined) ringing += 1;
    for (const voice of this.voices.values()) {
      if (ringing <= MAX_RING_OUT_VOICES) break;
      if (!voice.ringOut || voice.fadeLeft !== undefined) continue;
      this.fadeRingOut(voice);
      ringing -= 1;
    }
  }

  private fadeRingOut(voice: LiveVoice): void {
    voice.fadeFrames = Math.max(
      1,
      Math.round(this.sampleRate * RING_OUT_FADE_SECONDS),
    );
    voice.fadeLeft = voice.fadeFrames;
  }

  /**
   * Fade a live voice out over ~10 ms (sustain lifted, mode left). A
   * ring-out voice keeps ringing; `noteOff(id, true)` silences it too.
   */
  public noteOff(id: number, force = false): void {
    const voice = this.voices.get(id);
    if (!voice || voice.fadeLeft !== undefined) return;
    if (!voice.ringOut) voice.fadeLeft = voice.fadeFrames;
    else if (force) this.fadeRingOut(voice);
  }

  /** Frames of live voice `id` already mixed, or undefined once finished. */
  public voicePosition(id: number): number | undefined {
    return this.voices.get(id)?.position;
  }

  public get liveVoices(): number {
    return this.voices.size;
  }

  /** Mix the click bus into the stream (undefined turns it off). */
  public setClick(click: ClickBus | undefined): void {
    this.click = click;
    if (!click) this.clickVoices = [];
    else this.sounds ??= clickSounds(this.sampleRate);
  }

  /** Frames kept queued ahead of the clock right now. */
  public get lead(): number {
    // Off-thread renders never stall the pump: a slow render delays the
    // swap, not the stream, so only inline renders grow the lead (every
    // frame of lead is a frame of edit latency).
    const adaptive = this.renderer.offThread
      ? 0
      : Math.round(
          (LEAD_RENDER_FACTOR * this.lastRenderMs * this.sampleRate) / 1000,
        );
    // The pump never queues more than a second, so the lead stays under it.
    return Math.min(
      Math.max(this.leadFrames, adaptive),
      Math.floor(this.sampleRate * 0.9),
    );
  }

  /**
   * Start playback at `beat`, or, when already playing, swap in the new
   * score at the current position without restarting the player. Resolves
   * once the render has been applied (or superseded by a newer one).
   */
  public play(score: TrackScore, beat?: number): Promise<void> {
    if (this.info.backend === "none") return Promise.resolve();
    if (this.fallback) return this.fallback.play(score, beat);
    return this.request(score, beat, false);
  }

  /**
   * Start playback at `beat` while the caller's transport holds there:
   * resolves with the monotonic ms that `beat` is heard at, so the
   * playhead can start with the sound instead of running ahead of it
   * while the first windows render. Undefined when the start was
   * superseded (a stop) or there is no stream to time (no audio, afplay);
   * the caller then starts its clock as it resolves.
   */
  public async cue(
    score: TrackScore,
    beat: number,
  ): Promise<number | undefined> {
    if (this.info.backend === "none") return undefined;
    if (this.fallback) {
      await this.fallback.play(score, beat);
      return undefined;
    }
    const generation = this.generation;
    this.cueHeardMs = undefined;
    await this.request(score, beat, true);
    // An edit before the sound started superseded this request and carries
    // the hold on (`request`): wait for the start it makes instead.
    while (this.cueHeardMs === undefined && generation === this.generation) {
      const carrier = this.queued?.cued
        ? this.queued
        : this.inflight?.cued
          ? this.inflight
          : undefined;
      if (!carrier) break;
      await new Promise<void>((resolve, reject) =>
        carrier.waiters.push({ resolve, reject }),
      );
    }
    return generation === this.generation ? this.cueHeardMs : undefined;
  }

  private request(
    score: TrackScore,
    beat: number | undefined,
    cued: boolean,
  ): Promise<void> {
    this.monitorWanted = true;
    const revision = ++this.renderRevision;
    // A play supersedes prewarms not yet sent; one in flight runs on.
    this.warmNext = undefined;
    this.renderer.cancelPending();
    this.cancelStart();
    // An edit during a start (no loop playing yet) keeps that start's
    // position and hold; without a loop there is no cursor to read it from.
    const prior = this.queued ?? this.inflight;
    const starting =
      !this.loop && prior?.generation === this.generation ? prior : undefined;
    const inherit = beat === undefined && starting?.beat !== undefined;
    return new Promise<void>((resolve, reject) => {
      const waiters = this.queued?.waiters ?? [];
      waiters.push({ resolve, reject });
      this.queued = {
        revision,
        seekRevision: this.seekRevision,
        score,
        beat: inherit ? starting.beat : beat,
        atMs: inherit ? starting.atMs : this.now(),
        cued: cued || starting?.cued === true,
        generation: this.generation,
        waiters,
      };
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queued) {
        const request = this.queued;
        this.queued = undefined;
        this.inflight = request;
        if (request.generation !== this.generation) {
          for (const waiter of request.waiters) waiter.resolve();
          continue;
        }
        try {
          const { streamed, frame } = this.startPlan(
            request.score,
            request.beat ??
              (this.loop ? beatOfFrame(this.loop, this.cursor) : 0),
          );
          let render: LoopRender;
          let next: Loop;
          if (streamed) {
            ({ render, next } = await this.renderStart(request, frame));
          } else {
            render = await this.renderer.render(request.score);
            next = this.toLoop(render, request.score);
          }
          this.lastRenderMs = render.renderMs;
          // Stopped while rendering: the result is stale, not an error.
          if (
            request.generation === this.generation &&
            request.revision === this.renderRevision
          ) {
            await this.apply(next, request);
            if (request.revision === this.renderRevision) {
              this.lastLoopPcm = render.pcm;
              this.lastMaster = render.master;
            }
          }
          for (const waiter of request.waiters) waiter.resolve();
        } catch (error) {
          if (
            error instanceof RenderCancelledError &&
            (request.generation !== this.generation ||
              request.revision !== this.renderRevision)
          ) {
            for (const waiter of request.waiters) waiter.resolve();
            continue;
          }
          for (const waiter of request.waiters)
            waiter.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
        }
      }
    } finally {
      this.draining = false;
      this.inflight = undefined;
      this.pendingLoop = undefined;
      this.prefetchMonitor();
    }
  }

  /** Whether a start streams windows, and the frame `beat` falls on. */
  private startPlan(
    score: TrackScore,
    beat: number,
  ): { streamed: boolean; frame: number } {
    const timeline = playbackTime(score);
    const map = transportMapFor(timeline);
    const seconds = map
      ? map.seconds(((beat % map.loopBeats) + map.loopBeats) % map.loopBeats)
      : (beat * 60) / timeline.tempoBpm;
    return {
      streamed:
        this.progressive && this.info.streaming && loopSecondsOf(timeline) > 45,
      frame: Math.max(0, Math.round(seconds * this.sampleRate)),
    };
  }

  /**
   * Render what a cued start at `beat` renders first, ahead of the play:
   * a streamed song's start window (a short song's whole loop) on the
   * render worker, which spins the worker up, decodes the samples and
   * shifts the vocal books that window plays. The play then reads the
   * worker's caches instead of paying that cold work while the transport
   * waits. Best effort, and only while nothing plays or starts; calls
   * while one renders coalesce into one more for the newest score.
   */
  public prewarm(score: TrackScore, beat = 0): Promise<void> {
    if (this.info.backend === "none" || this.fallback) return Promise.resolve();
    this.warmNext = { score, beat };
    this.warming ??= (async () => {
      while (this.warmNext) {
        const next = this.warmNext;
        this.warmNext = undefined;
        await this.warmStart(next.score, next.beat);
      }
    })().finally(() => {
      this.warming = undefined;
    });
    return this.warming;
  }

  private async warmStart(score: TrackScore, beat: number): Promise<void> {
    if (this.loop || this.draining || this.queued) return;
    const { streamed, frame } = this.startPlan(score, beat);
    try {
      if (!streamed) await this.renderer.warm(score);
      else {
        const frames = Math.max(
          1,
          Math.round(loopSecondsOf(playbackTime(score)) * this.sampleRate),
        );
        await this.renderer.warm(score, wrapFrame(frame, frames), START_JOB);
      }
    } catch {
      // The play renders the window itself.
    }
  }

  private beatForRequest(loop: Loop, request: PlayRequest): number | undefined {
    // The transport kept moving while the render ran.
    // A seek is newer transport intent even when it did not replace the score.
    const anchor =
      request.seekRevision !== this.seekRevision && this.seekAnchor
        ? this.seekAnchor
        : request;
    if (anchor.beat === undefined) return undefined;
    // A cued transport holds until the start is heard: no time passes.
    if (request.cued) return anchor.beat;
    return beatAfter(
      loop,
      anchor.beat,
      ((this.now() - anchor.atMs) * this.sampleRate) / 1000,
    );
  }

  private async apply(loop: Loop, request: PlayRequest): Promise<void> {
    if (this.child) {
      this.handOff(loop, request);
      // The swap lands on the next frame written, which sounds after the
      // queue already ahead of it: the cued beat is heard about now.
      if (request.cued) this.cueHeardMs = this.now();
      return;
    }
    if (this.starting) {
      await this.starting;
      if (this.child && request.revision === this.renderRevision) {
        this.handOff(loop, request);
        if (request.cued) this.cueHeardMs = this.now();
      }
      return;
    }
    this.starting = this.start(loop, 0, request.revision, request).finally(
      () => {
        this.starting = undefined;
      },
    );
    await this.starting;
  }

  /** Jump to transport `beat` (as of now) without restarting the player. */
  public seek(beat: number): void {
    this.seekRevision += 1;
    this.seekAnchor = { beat, atMs: this.now() };
    if (!this.loop || !this.child) return;
    this.monitorFailed = undefined;
    if (!this.draining) this.renderer.cancelPending();
    this.cursor = this.frameForBeat(
      this.loop,
      beatAfter(this.loop, beat, this.queuedFrames()),
    );
    this.prefetchMonitor();
  }

  /**
   * Stream timing on the native sink: the host time of the latest device
   * callback, when a frame is heard, and the device latency. Undefined on
   * the stdin players (their output latency is unknown).
   */
  public get timing(): AudioTiming | undefined {
    return this.child?.clock?.timing();
  }

  private queuedFrames(): number {
    const clock = this.child?.clock;
    if (clock) return clock.queuedFrames();
    const elapsed = Math.floor(
      ((this.now() - this.startMs) * this.sampleRate) / 1000,
    );
    return Math.max(0, this.written - elapsed);
  }

  public stop(): void {
    void this.stopAsync();
  }

  public async stopAsync(): Promise<void> {
    this.generation += 1;
    this.renderRevision += 1;
    this.monitorBuffering = false;
    this.monitorWanted = false;
    this.pendingLoop = undefined;
    this.incoming = undefined;
    this.renderer.cancelPending();
    this.renderer.cancelBackground();
    this.cancelStart();
    this.lastLoopPcm = undefined;
    this.lastMaster = undefined;
    this.respawns = 0;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = undefined;
    if (this.fallback) {
      this.fallback.stop();
      return;
    }
    await this.starting?.catch(() => undefined);
    if (this.monitoring && this.child) {
      // Play mode: the transport stopped, the live player keeps running.
      this.loop = undefined;
      this.endFades();
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const child = this.child;
    this.child = undefined;
    this.loop = undefined;
    this.endFades();
    if (child) {
      try {
        child.stdin.end?.();
      } catch {
        /* already closed */
      }
      child.kill();
      await child.exited.catch(() => undefined);
    }
    await this.lock.release();
  }

  /** Stops playback and releases the render worker. */
  public async dispose(): Promise<void> {
    this.monitoring = false;
    await this.stopAsync();
    this.renderer.dispose();
  }

  /**
   * Write every frame due by now plus the lead. Called by the timer; tests
   * call it directly with an injected clock.
   */
  public pump(): void {
    const child = this.child;
    const loop = this.loop;
    if (!child || (!loop && !this.monitoring)) return;
    if (this.followChoice()) return;
    if (this.incoming && this.trySwapIncoming()) {
      this.pump();
      return;
    }
    let remaining: number;
    if (child.clock) {
      // Device-clocked: top the ring up to the lead. Frames the device
      // played as silence (an underrun) are skipped so the loop stays on
      // the transport's beat.
      const slip = child.clock.slipFrames();
      if (slip > 0 && loop) this.cursor = (this.cursor + slip) % loop.frames;
      if (slip > 0) this.endFades();
      remaining = this.lead - child.clock.queuedFrames();
    } else {
      const due =
        Math.floor(((this.now() - this.startMs) * this.sampleRate) / 1000) +
        this.lead;
      remaining = due - this.written;
    }
    if (remaining <= 0) return;
    // Never queue more than one second at once, e.g. after a stalled loop.
    if (remaining > this.sampleRate) {
      const skipped = remaining - this.sampleRate;
      if (loop) this.cursor = (this.cursor + skipped) % loop.frames;
      this.endFades();
      this.written += skipped;
      remaining = this.sampleRate;
    }
    const out = new Int16Array(remaining * RENDER_CHANNELS);
    const wasBuffering = this.monitorBuffering;
    this.monitorBuffering = false;
    let offset = 0;
    while (loop && offset < remaining) {
      const take = Math.min(remaining - offset, loop.frames - this.cursor);
      if (loop.monitor) {
        if (!loop.monitor.buffer.copy(this.cursor, take, out, offset))
          this.monitorBuffering = true;
      } else
        out.set(
          loop.pcm.subarray(
            this.cursor * RENDER_CHANNELS,
            (this.cursor + take) * RENDER_CHANNELS,
          ),
          offset * RENDER_CHANNELS,
        );
      offset += take;
      this.cursor = (this.cursor + take) % loop.frames;
    }
    this.prefetchMonitor();
    if (loop?.monitor && wasBuffering && !this.monitorBuffering) {
      this.endFades();
      this.fadeIn = 0;
    }
    if (loop) this.crossfade(out, remaining);
    this.mixLive(out, this.written, remaining);
    this.written += remaining;
    try {
      child.stdin.write(new Uint8Array(out.buffer));
      child.stdin.flush?.();
    } catch {
      /* the exit handler decides whether to restart */
    }
  }

  /** Equal-power gain of a fade-in `done` frames along (0 to 1). */
  private rampGain(done: number): number {
    return Math.sin((Math.PI / 2) * Math.min(1, done / this.fadeFrames));
  }

  /**
   * Blend the start of a block (already the current loop) with the loops
   * fading out: new·sin + old·cos over `fadeFrames`, both read at the same
   * beat, so a swap never steps the waveform.
   */
  private crossfade(out: Int16Array, frames: number): void {
    if (this.fadeIn === undefined) return;
    const start = this.fadeIn;
    const count = Math.min(frames, this.fadeFrames - start);
    for (let index = 0; index < count; index += 1) {
      const gain = this.rampGain(start + index);
      const at = index * RENDER_CHANNELS;
      let left = out[at]! * gain;
      let right = out[at + 1]! * gain;
      for (const fade of this.fades) {
        if (fade.done >= this.fadeFrames) continue;
        const g =
          fade.from * Math.cos((Math.PI / 2) * (fade.done / this.fadeFrames));
        const from = fade.cursor * RENDER_CHANNELS;
        left +=
          (fade.loop.monitor
            ? fade.loop.monitor.buffer.sample(fade.cursor, 0)
            : fade.loop.pcm[from]!) * g;
        right +=
          (fade.loop.monitor
            ? fade.loop.monitor.buffer.sample(fade.cursor, 1)
            : fade.loop.pcm[from + 1]!) * g;
        fade.cursor = (fade.cursor + 1) % fade.loop.frames;
        fade.done += 1;
      }
      out[at] = clamp16(left);
      out[at + 1] = clamp16(right);
    }
    this.fadeIn = start + count;
    // Older fades that began earlier finish before the newest fade-in does.
    this.fades = this.fades.filter((fade) => fade.done < this.fadeFrames);
    if (this.fadeIn >= this.fadeFrames) this.endFades();
  }

  private endFades(): void {
    this.fades = [];
    this.fadeIn = undefined;
  }

  /** Wall time (monotonic ms) stream frame `frame` sounds at. */
  private frameMs(frame: number): number {
    const clock = this.child?.clock;
    if (clock) return clock.frameMs(frame);
    return this.startMs + (frame * 1000) / this.sampleRate;
  }

  /** Add live voices and the click bus to a block about to be written. */
  private mixLive(out: Int16Array, firstFrame: number, frames: number): void {
    if (this.voices.size === 0 && !this.click && this.clickVoices.length === 0)
      return;
    for (const [id, voice] of this.voices) {
      let index = 0;
      for (; index < frames && voice.position < voice.frames; index += 1) {
        let gain = 1;
        if (voice.fadeLeft !== undefined) {
          if (voice.fadeLeft <= 0) break;
          gain = voice.fadeLeft / voice.fadeFrames;
          voice.fadeLeft -= 1;
        }
        const at = index * RENDER_CHANNELS;
        const from = voice.position * RENDER_CHANNELS;
        out[at] = clamp16(out[at]! + voice.pcm[from]! * gain);
        out[at + 1] = clamp16(out[at + 1]! + voice.pcm[from + 1]! * gain);
        voice.position += 1;
      }
      if (
        voice.position >= voice.frames ||
        (voice.fadeLeft !== undefined && voice.fadeLeft <= 0)
      )
        this.voices.delete(id);
    }
    const click = this.click;
    if (click && this.sounds) {
      const from = click.beatAt(this.frameMs(firstFrame));
      const to = click.beatAt(this.frameMs(firstFrame + frames));
      // A stopped transport, a seek or a loop wrap fires no click.
      if (from !== undefined && to !== undefined && to > from && to - from < 2)
        for (const event of clicksIn(from, to, frames, click)) {
          this.clickVoices.push({
            sound: this.sounds[event.level],
            position: -event.offset,
          });
        }
    }
    if (this.clickVoices.length === 0) return;
    const level = 32767 * Math.max(0, Math.min(1, click?.volume ?? 0)) * 0.5;
    for (const voice of this.clickVoices) {
      for (let index = 0; index < frames; index += 1) {
        const position = voice.position + index;
        if (position < 0) continue;
        if (position >= voice.sound.length) break;
        const value = voice.sound[position]! * level;
        const at = index * RENDER_CHANNELS;
        out[at] = clamp16(out[at]! + value);
        out[at + 1] = clamp16(out[at + 1]! + value);
      }
      voice.position += frames;
    }
    this.clickVoices = this.clickVoices.filter(
      (voice) => voice.position < voice.sound.length,
    );
  }

  private toLoop(render: LoopRender, score: TrackScore): Loop {
    const timeline = playbackTime(score);
    const map = transportMapFor(timeline);
    const buffer = render.monitor
      ? new MonitorBuffer(render.monitor.loopFrames)
      : undefined;
    buffer?.add(render);
    return {
      ...(buffer ? { monitor: { score, buffer } } : {}),
      pcm: render.monitor ? new Int16Array(0) : render.pcm,
      frames: render.monitor?.loopFrames ?? render.frames,
      framesPerBeat: (60 * this.sampleRate) / timeline.tempoBpm,
      sampleRate: this.sampleRate,
      ...(map ? { map } : {}),
    };
  }

  /** An empty streamed loop whose windows arrive as they render. */
  private monitorLoop(score: TrackScore, frames: number): Loop {
    const timeline = playbackTime(score);
    const map = transportMapFor(timeline);
    return {
      monitor: { score, buffer: new MonitorBuffer(frames, MONITOR_BYTES) },
      pcm: new Int16Array(0),
      frames,
      framesPerBeat: (60 * this.sampleRate) / timeline.tempoBpm,
      sampleRate: this.sampleRate,
      ...(map ? { map } : {}),
    };
  }

  /**
   * Render a streamed song's first window where the playhead will be when
   * it lands, while the background pool renders the windows after it, so
   * sound starts quickly and has runway once it does.
   */
  private async renderStart(
    request: PlayRequest,
    frame: number,
  ): Promise<{ render: LoopRender; next: Loop }> {
    const timeline = playbackTime(request.score);
    const frames = Math.max(
      1,
      Math.round(loopSecondsOf(timeline) * this.sampleRate),
    );
    let next = this.monitorLoop(request.score, frames);
    const stream = next.monitor!;
    const landing = this.child
      ? this.projectedCursor(next, request)
      : wrapFrame(frame, frames);
    // A running playhead moves on while the first window renders, so that
    // window starts where it will be; a cued one waits where it is.
    const lead = request.cued
      ? 0
      : Math.max(
          this.startLatency * 0.8,
          this.renderCost *
            (MONITOR_START_SECONDS + QUICK_PREROLL_SECONDS + 0.25),
        );
    const head = wrapFrame(
      landing + Math.round(lead * this.sampleRate),
      frames,
    );
    const job = START_JOB;
    const fill: MonitorFill = {
      stream,
      start: head,
      end: head + MONITOR_START_SECONDS * this.sampleRate,
      foreground: true,
    };
    this.fills.push(fill);
    this.pendingLoop = { loop: next, request };
    // The first window goes out first; the pool then reads ahead beside it.
    // Sound starts once the windows cover enough runway past the playhead
    // that the pool stays ahead of it, whichever windows those are.
    const ready = new Promise<LoopRender>((resolve, reject) => {
      this.startWaiter = { stream, resolve, reject };
    });
    let adopted: Loop | undefined;
    const first = this.renderer
      .render(request.score, head, job)
      .then((render) => {
        this.noteCost(render, job);
        const range = render.monitor;
        if (
          !range ||
          !(range.loopFrames > 0) ||
          range.startFrame > head % range.loopFrames ||
          range.startFrame + render.frames <= head % range.loopFrames
        )
          throw new Error("monitor render did not cover the requested frame");
        // The arranger owns the loop length; follow it if rounding
        // disagrees, starting from this window alone.
        if (range.loopFrames !== frames) {
          adopted = this.monitorLoop(request.score, range.loopFrames);
          adopted.monitor!.buffer.add(render);
          this.startWaiter?.resolve(render);
          return;
        }
        if (this.streamLive(stream)) stream.buffer.add(render);
        this.checkStart(stream, render);
      })
      .catch((error: unknown) => {
        if (this.startWaiter?.stream === stream)
          this.startWaiter.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
      })
      .finally(() => {
        this.fills = this.fills.filter((other) => other !== fill);
        this.prefetchMonitor();
      });
    this.prefetchMonitor();
    let render: LoopRender;
    try {
      render = await ready;
    } finally {
      if (this.startWaiter?.stream === stream) this.startWaiter = undefined;
    }
    void first;
    this.startLatency =
      0.5 * this.startLatency + 0.5 * ((this.now() - request.atMs) / 1000);
    if (adopted) {
      next = adopted;
      if (this.pendingLoop?.request === request)
        this.pendingLoop = { loop: next, request };
    }
    return { render, next };
  }

  /** Contiguous frames `stream` holds from `from` on, up to `cap`. */
  private covered(stream: MonitorStream, from: number, cap: number): number {
    const frames = stream.buffer.loopFrames;
    let position = from;
    let total = 0;
    while (total < cap) {
      const end = stream.buffer.at(position)?.end;
      if (end === undefined) break;
      total += wrapFrame(end - position, frames) || frames;
      position = wrapFrame(end, frames);
    }
    return Math.min(total, cap);
  }

  /** A newer play or a stop supersedes a start still gathering runway. */
  private cancelStart(): void {
    const waiter = this.startWaiter;
    this.startWaiter = undefined;
    waiter?.reject(new RenderCancelledError("render cancelled"));
  }

  /** Start a waiting stream once its windows give the playhead runway. */
  private checkStart(
    stream: MonitorStream,
    render?: LoopRender,
    anyway = false,
  ): void {
    const waiter = this.startWaiter;
    const pending = this.pendingLoop;
    if (waiter?.stream !== stream || pending?.loop.monitor !== stream) return;
    if (render) waiter.render = render;
    const latest = waiter.render;
    if (!latest) return;
    const loop = pending.loop;
    const runway = Math.min(
      loop.frames,
      Math.round(
        Math.min(
          MONITOR_RUNWAY_MAX_SECONDS,
          this.renderCost * MONITOR_RUNWAY_PER_COST,
        ) * this.sampleRate,
      ),
    );
    const from = this.projectedCursor(loop, pending.request);
    const have = this.covered(stream, from, runway);
    // A failing pool, or one too slow to ever build the runway, starts with
    // whatever covers the playhead rather than holding the song silent.
    const waited = this.now() - pending.request.atMs > MONITOR_START_WAIT_MS;
    if (have < Math.max(1, runway) && !((anyway || waited) && have > 0)) return;
    this.startWaiter = undefined;
    waiter.resolve(latest);
  }

  /** Where `next` would play now if it replaced (or started) the loop. */
  private projectedCursor(next: Loop, request: PlayRequest): number {
    const beat = this.beatForRequest(next, request);
    if (this.child && this.loop) return this.swapCursor(next, beat);
    return this.frameForBeat(next, beat ?? 0);
  }

  /**
   * Swap in a rendered edit, or, for a streamed song whose windows do not
   * cover the playhead yet, keep the old version playing until they do.
   */
  private handOff(loop: Loop, request: PlayRequest): void {
    this.incoming = undefined;
    if (loop.monitor && this.loop) {
      this.incoming = { loop, request };
      if (!this.trySwapIncoming()) this.prefetchMonitor();
      return;
    }
    this.swap(loop, this.beatForRequest(loop, request));
  }

  private trySwapIncoming(): boolean {
    const next = this.incoming;
    if (!next || !this.child) return false;
    if (next.request.revision !== this.renderRevision) {
      this.incoming = undefined;
      return false;
    }
    const beat = this.beatForRequest(next.loop, next.request);
    if (!next.loop.monitor!.buffer.at(this.swapCursor(next.loop, beat)))
      return false;
    this.incoming = undefined;
    this.swap(next.loop, beat);
    return true;
  }

  /** Learn how fast windows render, for sizing the next ones. */
  private noteCost(render: LoopRender, job: MonitorJob): void {
    if (!(render.renderMs > 0) || !(render.frames > 0)) return;
    const rendered =
      render.frames / this.sampleRate +
      (job.quick
        ? QUICK_PREROLL_SECONDS + 0.25
        : MONITOR_FULL_PREROLL_SECONDS + 1);
    const cost = render.renderMs / 1000 / rendered;
    this.renderCost = 0.6 * this.renderCost + 0.4 * cost;
  }

  /** Seconds a quick window of `seconds` takes to land at the learned cost. */
  private landSeconds(seconds: number): number {
    return (
      Math.max(0.05, this.renderCost) * (seconds + QUICK_PREROLL_SECONDS + 0.25)
    );
  }

  /**
   * The largest window that should land before the playhead reaches it:
   * full quality when there is time for its pre-roll, otherwise a quick one.
   */
  private monitorJob(secondsAhead: number): MonitorJob {
    const budget = secondsAhead * 0.75 - 0.25;
    const cost = Math.max(0.05, this.renderCost);
    const full = Math.min(
      MONITOR_FULL_SECONDS,
      Math.floor(budget / cost - MONITOR_FULL_PREROLL_SECONDS - 1),
    );
    if (full >= MONITOR_MIN_FULL_SECONDS)
      return { seconds: full, background: true };
    const quick = Math.floor(budget / cost - QUICK_PREROLL_SECONDS - 0.25);
    return {
      seconds: Math.min(
        MONITOR_FULL_SECONDS,
        Math.max(MONITOR_START_SECONDS, quick),
      ),
      quick: true,
      background: true,
    };
  }

  private streamLive(stream: MonitorStream): boolean {
    return (
      stream === this.loop?.monitor ||
      stream === this.incoming?.loop.monitor ||
      stream === this.pendingLoop?.loop.monitor
    );
  }

  private failedRecently(stream: MonitorStream): boolean {
    const failed = this.monitorFailed;
    if (failed?.stream !== stream) return false;
    const wait = Math.min(
      MONITOR_RETRY_MAX_MS,
      250 * 2 ** Math.max(0, failed.count - 1),
    );
    return this.now() - failed.atMs < wait;
  }

  /**
   * Keep the pool busy rendering the first missing windows ahead of each
   * playhead that will be heard: the playing loop, then an edit waiting to
   * swap in or a start still rendering its first window.
   */
  private prefetchMonitor(): void {
    if (!this.monitorWanted) return;
    const handing = [this.incoming, this.pendingLoop].some(
      (next) => next !== undefined && next.loop !== this.loop,
    );
    const plans: {
      loop: Loop;
      cursor: number;
      horizon: number;
      catchUp?: boolean;
    }[] = [];
    if (this.loop?.monitor && this.child)
      plans.push({
        loop: this.loop,
        cursor: this.cursor,
        horizon: handing ? MONITOR_HANDOFF_SECONDS : MONITOR_AHEAD_SECONDS,
        catchUp: true,
      });
    for (const next of [this.incoming, this.pendingLoop])
      if (next && next.loop !== this.loop)
        plans.push({
          loop: next.loop,
          cursor: this.projectedCursor(next.loop, next.request),
          horizon: MONITOR_AHEAD_SECONDS,
          // A cued start's playhead waits for its runway: no gap is lost.
          catchUp: !next.request.cued,
        });
    // A window nobody will hear soon (an old version, a stopped song, a
    // spot the playhead jumped away from) would hold a worker for seconds.
    // Windows the playhead already passed finish on their own; only far
    // ahead or stale ones are worth restarting the pool for.
    const wanted = (fill: MonitorFill) =>
      plans.some(({ loop, cursor, horizon }) => {
        if (loop.monitor !== fill.stream) return false;
        const offset = wrapFrame(fill.start - cursor, loop.frames);
        return (
          offset < horizon * this.sampleRate ||
          offset > loop.frames - MONITOR_FULL_SECONDS * this.sampleRate
        );
      });
    const pool = () =>
      this.fills.filter((fill) => !fill.foreground && !fill.cancelled);
    if (pool().some((fill) => !wanted(fill))) {
      for (const fill of pool()) fill.cancelled = true;
      this.renderer.cancelBackground();
    }
    let free = this.renderer.backgroundSlots - pool().length;
    for (const plan of plans) {
      const { loop, cursor, horizon } = plan;
      const stream = loop.monitor!;
      if (this.failedRecently(stream)) continue;
      const frames = loop.frames;
      const limit = Math.min(frames, Math.round(horizon * this.sampleRate));
      let position = wrapFrame(cursor, frames);
      let ahead = 0;
      let catchingUp = false;
      while (free > 0 && ahead < limit) {
        const end =
          stream.buffer.at(position)?.end ??
          this.fills.find(
            (fill) =>
              !fill.cancelled &&
              fill.stream === stream &&
              wrapFrame(position - fill.start, frames) < fill.end - fill.start,
          )?.end;
        if (end === undefined) {
          // A gap even the smallest window cannot reach in time is lost
          // already; aim past it so the next window lands with room for
          // a useful size instead of chasing the playhead one second late.
          // Step at most to the next grid second so the skip stops at any
          // window already rendered or in flight.
          if (
            plan.catchUp &&
            ahead < this.landSeconds(MONITOR_START_SECONDS) * this.sampleRate
          )
            catchingUp = true;
          const target = Math.round(
            this.landSeconds(MONITOR_CATCH_UP_SECONDS) * 1.15 * this.sampleRate,
          );
          if (catchingUp && ahead < target) {
            const skip = Math.min(
              target - ahead,
              this.sampleRate - (position % this.sampleRate),
            );
            ahead += skip;
            position = wrapFrame(position + skip, frames);
            continue;
          }
          catchingUp = false;
          this.launchFill(
            stream,
            position,
            this.monitorJob(ahead / this.sampleRate),
          );
          free -= 1;
          continue;
        }
        catchingUp = false;
        ahead += wrapFrame(end - position, frames) || frames;
        position = wrapFrame(end, frames);
      }
    }
  }

  private launchFill(
    stream: MonitorStream,
    frame: number,
    job: MonitorJob,
  ): void {
    const fill: MonitorFill = {
      stream,
      start: frame,
      end: frame + Math.round((job.seconds ?? 4) * this.sampleRate),
    };
    this.fills.push(fill);
    void this.renderer
      .render(stream.score, frame, job)
      .then((render) => {
        this.noteCost(render, job);
        if (!this.streamLive(stream)) return;
        stream.buffer.add(render);
        // An invalid or truncated window must not recursively re-request the
        // same missing frame, especially when a cache answers synchronously.
        if (!stream.buffer.at(frame))
          throw new Error("monitor render did not cover the requested frame");
        if (this.monitorFailed?.stream === stream)
          this.monitorFailed = undefined;
        this.lastLoopPcm = render.pcm;
        this.checkStart(stream, render);
      })
      .catch((error: unknown) => {
        if (!(error instanceof RenderCancelledError))
          this.checkStart(stream, undefined, true);
        if (!(error instanceof RenderCancelledError) && this.streamLive(stream))
          this.monitorFailed = {
            stream,
            atMs: this.now(),
            count:
              (this.monitorFailed?.stream === stream
                ? this.monitorFailed.count
                : 0) + 1,
          };
      })
      .finally(() => {
        this.fills = this.fills.filter((other) => other !== fill);
        this.trySwapIncoming();
        this.prefetchMonitor();
      });
  }

  private frameForBeat(loop: Loop, beat: number): number {
    const frame = Math.round(frameOfBeat(loop, Math.max(0, beat)));
    return ((frame % loop.frames) + loop.frames) % loop.frames;
  }

  /** The cursor `next` takes over at, as `swap` places it. */
  private swapCursor(next: Loop, beat?: number): number {
    const previous = this.loop;
    // Keep the musical position: the same beat inside the new loop.
    let cursor = previous
      ? this.frameForBeat(next, beatOfFrame(previous, this.cursor))
      : 0;
    if (beat !== undefined) {
      // Re-anchor to the transport only when it disagrees audibly (a seek
      // or a tempo change); sub-frame rounding must not click on edits.
      // The next frame written sounds `queuedFrames` after now.
      const anchored = this.frameForBeat(
        next,
        beatAfter(next, beat, this.queuedFrames()),
      );
      const distance = Math.abs(anchored - cursor);
      const wrapped = Math.min(distance, next.frames - distance);
      if (!previous || wrapped > this.sampleRate * RESYNC_SECONDS)
        cursor = anchored;
    }
    return cursor;
  }

  private swap(next: Loop, beat?: number): void {
    const previous = this.loop;
    const cursor = this.swapCursor(next, beat);
    if (previous && this.child) {
      // The outgoing loop keeps its current gain (below 1 when it was
      // itself still fading in) and fades from there.
      const from = this.fadeIn === undefined ? 1 : this.rampGain(this.fadeIn);
      this.fades.push({ loop: previous, cursor: this.cursor, from, done: 0 });
      this.fadeIn = 0;
    }
    this.cursor = cursor;
    this.loop = next;
  }

  /** The output device players open; undefined is the system default. */
  public get device(): string | undefined {
    return this.outputDevice;
  }

  /** Whether this backend can play on a chosen output. */
  public get choosesDevice(): boolean {
    return (
      this.customSpawn === undefined &&
      (this.info.backend === "native" || this.info.backend === "sox")
    );
  }

  /**
   * Move playback to `device` (undefined: the system default). A running
   * player is replaced at the frame being heard, so the song carries on.
   */
  public setDevice(device: string | undefined): void {
    const next = device?.trim() || undefined;
    if (next === this.outputDevice) return;
    this.outputDevice = next;
    const child = this.child;
    if (!child || !this.choosesDevice) return;
    const loop = this.loop;
    const heard = this.heardFrame(loop);
    const at = this.now();
    const generation = this.generation;
    this.child = undefined;
    this.loop = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    child.kill();
    this.starting = child.exited
      .catch(() => undefined)
      .then(() => this.lock.release())
      .then(async () => {
        if (generation !== this.generation || this.child) return;
        if (!loop && !this.monitoring) return;
        const frame = heard + ((this.now() - at) * this.sampleRate) / 1000;
        await this.start(loop, loop ? beatOfFrame(loop, frame) : 0);
      })
      .finally(() => {
        this.starting = undefined;
      });
  }

  /**
   * Follow the saved choice when its file changed (at most once a second).
   * Returns true when that moved playback to another device.
   */
  private followChoice(force = false): boolean {
    if (!this.choicePath) return false;
    const now = this.now();
    if (!force && now - this.choiceCheckedMs < CHOICE_CHECK_MS) return false;
    this.choiceCheckedMs = now;
    const mtime = fileMtime(this.choicePath);
    if (mtime === this.choiceMtime) return false;
    this.choiceMtime = mtime;
    const next = resolveOutputDevice(
      process.env,
      readAudioChoice(this.choicePath),
    );
    if (next === this.outputDevice) return false;
    this.setDevice(next);
    return true;
  }

  private heardFrame(loop: Loop | undefined): number {
    return loop
      ? (((this.cursor - this.queuedFrames()) % loop.frames) + loop.frames) %
          loop.frames
      : 0;
  }

  /** Open a player on the chosen output, or the default when it is gone. */
  private spawnPlayer(command: readonly string[]): PlayerProcess {
    if (this.customSpawn) return this.customSpawn(command);
    this.followChoice(true);
    const native =
      this.info.backend === "native" ? this.info.native : undefined;
    const device = this.outputDevice;
    if (native) {
      const open = (name: string | undefined) =>
        openNativePlayer(native, {
          rate: this.sampleRate,
          channels: RENDER_CHANNELS,
          ...(name ? { device: name } : {}),
          bufferFrames: this.bufferFrames,
          now: this.now,
        });
      if (!device) return open(undefined);
      try {
        return open(device);
      } catch (error) {
        const player = open(undefined);
        this.deviceLost(device, error);
        return player;
      }
    }
    return spawnStdinPlayer(
      command,
      this.info.backend === "sox" && device ? { AUDIODEV: device } : undefined,
    );
  }

  /** The chosen output is gone: play on the default and say so once. */
  private deviceLost(device: string, _error?: unknown): void {
    if (this.outputDevice !== device) return;
    this.outputDevice = undefined;
    this.onStatus?.({
      state: "device",
      message: `audio output "${device}" is unavailable · playing on the system default`,
    });
  }

  /** After a player died: is its chosen output still there? */
  private deviceGone(): string | undefined {
    const device = this.outputDevice;
    if (!device || !this.choosesDevice) return undefined;
    if (this.info.backend === "sox") return device;
    try {
      const names = this.info.native?.devices(false) ?? [];
      return names.some((entry) => entry.name === device) ? undefined : device;
    } catch {
      return undefined;
    }
  }

  private async start(
    loop: Loop | undefined,
    beat: number,
    revision?: number,
    request?: PlayRequest,
  ): Promise<void> {
    const generation = this.generation;
    if (!(await this.lock.acquire())) return;
    if (
      generation !== this.generation ||
      (revision !== undefined && revision !== this.renderRevision)
    ) {
      await this.lock.release();
      return;
    }
    let child: PlayerProcess;
    try {
      child = this.spawnPlayer(this.info.command ?? []);
    } catch {
      await this.lock.release();
      return;
    }
    this.spawns += 1;
    this.child = child;
    this.loop = loop;
    this.endFades();
    this.startMs = this.now();
    this.written = 0;
    this.cursor = loop
      ? this.frameForBeat(
          loop,
          request ? (this.beatForRequest(loop, request) ?? 0) : beat,
        )
      : 0;
    void child.exited.then(() => {
      if (this.child !== child) return;
      this.onPlayerExit(generation);
    });
    this.pump();
    // After the first write, which anchors the native sink's frame clock.
    if (request?.cued) this.cueHeardMs = this.frameMs(0);
    if (this.useTimer) this.timer = setInterval(() => this.pump(), this.tickMs);
  }

  /**
   * The player died while we still want sound. Respawn it a bounded number
   * of times, resuming from the frame the listener last heard, and report
   * each attempt; after that, stop cleanly rather than show a silent
   * "playing" transport.
   */
  private onPlayerExit(generation: number): void {
    const loop = this.loop;
    const ranMs = this.now() - this.startMs;
    // Frame the device was playing when the stream ended.
    const heard = this.heardFrame(loop);
    const diedAt = this.now();
    const lost = this.deviceGone();
    this.child = undefined;
    this.loop = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    void this.lock.release().then(() => {
      if ((!loop && !this.monitoring) || generation !== this.generation) return;
      if (ranMs >= RESPAWN_RESET_MS) this.respawns = 0;
      if (this.respawns >= MAX_RESPAWNS) {
        this.onStatus?.({
          state: "stopped",
          message: `audio player exited ${MAX_RESPAWNS} times; playback stopped`,
        });
        return;
      }
      this.respawns += 1;
      const delay = this.respawnMs * 2 ** (this.respawns - 1);
      // An unplugged output: one notice, then the default device.
      if (lost) this.deviceLost(lost);
      else
        this.onStatus?.({
          state: "restarting",
          message: `audio player exited; restarting (${this.respawns}/${MAX_RESPAWNS})`,
        });
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = undefined;
        if (generation !== this.generation || this.child || this.starting)
          return;
        const frame = heard + ((this.now() - diedAt) * this.sampleRate) / 1000;
        const beat = loop ? beatOfFrame(loop, frame) : 0;
        this.starting = this.start(loop, beat).finally(() => {
          this.starting = undefined;
        });
      }, delay);
    });
  }
}

function spawnStdinPlayer(
  command: readonly string[],
  env?: Readonly<Record<string, string>>,
): PlayerProcess {
  if (command.length === 0) throw new Error("no player command");
  const child = Bun.spawn([...command], {
    ...(env ? { env: { ...process.env, ...env } } : {}),
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  return {
    pid: child.pid,
    stdin: child.stdin,
    exited: child.exited,
    kill: () => child.kill(),
  };
}

function clamp16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}
