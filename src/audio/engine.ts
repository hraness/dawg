import type { TrackScore } from "../../core/score.ts";
import { PlaybackLock } from "./lock.ts";
import { LoopPlayer } from "./player.ts";
import { DEFAULT_SAMPLE_RATE, RENDER_CHANNELS, renderScorePcm } from "./wav.ts";

/**
 * How trackd (or a file-mode window) makes sound.
 *
 * - `ffplay` and `sox` are streaming backends: one long-lived player reads
 *   raw interleaved s16le stereo PCM from stdin, and the engine writes the
 *   loop into it paced by the wall clock. Edits swap the loop buffer at the
 *   current phase, so playback never restarts and stays sample-continuous.
 * - `afplay` is the last fallback: re-render a WAV and restart the one-shot
 *   player on every edit (the pre-engine behavior), so edits cause a gap.
 * - `command` is an explicit TRACK_AUDIO_PLAYER override that also reads
 *   s16le from stdin; tests use it to record the exact byte stream.
 * - `none` makes no sound; the transport clock still runs.
 */
export type AudioBackend = "ffplay" | "sox" | "afplay" | "command" | "none";

export type AudioBackendInfo = Readonly<{
  backend: AudioBackend;
  /** True for gapless stdin-streaming backends. */
  streaming: boolean;
  /** argv with `{rate}` / `{channels}` already substituted, if streaming. */
  command?: readonly string[];
  /** Human-readable reason the backend was chosen. */
  detail: string;
}>;

type Which = (binary: string) => string | null;

export type DetectOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  which?: Which;
  platform?: NodeJS.Platform;
  sampleRate?: number;
}>;

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
 * Pick the audio backend. Order: TRACK_AUDIO=0 (none), TRACK_AUDIO_PLAYER
 * (explicit stdin command), TRACK_AUDIO_BACKEND (forced name), then ffplay,
 * sox `play`, and afplay (macOS) in that order.
 */
export function detectAudioBackend(
  options: DetectOptions = {},
): AudioBackendInfo {
  const env = options.env ?? process.env;
  const which: Which = options.which ?? ((binary) => Bun.which(binary));
  const platform = options.platform ?? process.platform;
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (env.TRACK_AUDIO === "0")
    return { backend: "none", streaming: false, detail: "TRACK_AUDIO=0" };
  const custom = env.TRACK_AUDIO_PLAYER?.trim();
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
        detail: "TRACK_AUDIO_PLAYER",
      };
  }
  const forced = env.TRACK_AUDIO_BACKEND?.trim().toLowerCase();
  const candidates: AudioBackend[] =
    forced === "ffplay" ||
    forced === "sox" ||
    forced === "afplay" ||
    forced === "none"
      ? [forced]
      : ["ffplay", "sox", "afplay"];
  for (const candidate of candidates) {
    if (candidate === "none")
      return {
        backend: "none",
        streaming: false,
        detail: "TRACK_AUDIO_BACKEND",
      };
    if (candidate === "ffplay" || candidate === "sox") {
      const binary = which(candidate === "ffplay" ? "ffplay" : "play");
      if (!binary) continue;
      return {
        backend: candidate,
        streaming: true,
        command: streamingCommand(candidate, binary, sampleRate),
        detail: `${binary} (gapless stream)`,
      };
    }
    const binary = platform === "darwin" ? which("afplay") : null;
    if (binary)
      return {
        backend: "afplay",
        streaming: false,
        detail: `${binary} (re-render on edit; install ffmpeg or sox for gapless playback)`,
      };
  }
  return {
    backend: "none",
    streaming: false,
    detail: "no player found (install ffmpeg or sox)",
  };
}

/** One status line for `track auth status` and the header. */
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
};

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
}>;

type Loop = Readonly<{
  pcm: Int16Array;
  frames: number;
  framesPerBeat: number;
}>;

/**
 * The gapless audio engine. It renders the score into one seamless loop
 * (tails folded onto the start) and streams it to a long-lived stdin player.
 *
 * Timing: the engine is paced by the same monotonic clock as the transport.
 * Frame `n` of the stream belongs to wall time `start + n / rate`, and the
 * engine keeps exactly `leadMs` of audio queued ahead of now. The device
 * plays the queue at its own rate, so what you hear trails the transport by
 * the player's fixed output latency and never accumulates drift from
 * re-renders. An edit re-renders and swaps the buffer for every frame not
 * yet written, mapping the current beat into the new loop, so tempo and
 * length changes keep the musical position.
 */
export class AudioEngine {
  public readonly info: AudioBackendInfo;
  private readonly lock: PlaybackLock;
  private readonly sampleRate: number;
  private readonly leadFrames: number;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly useTimer: boolean;
  private readonly spawnPlayer: (command: readonly string[]) => PlayerProcess;
  private fallback: LoopPlayer | undefined;
  private child: PlayerProcess | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private loop: Loop | undefined;
  /** Monotonic ms that stream frame 0 belongs to. */
  private startMs = 0;
  /** Stream frames written since `startMs`. */
  private written = 0;
  /** Loop frame that stream frame `written` reads next (fractional-free). */
  private cursor = 0;
  private starting: Promise<void> | undefined;
  private generation = 0;
  private spawns = 0;

  public constructor(options: AudioEngineOptions = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.info =
      options.info ?? detectAudioBackend({ sampleRate: this.sampleRate });
    this.lock = new PlaybackLock(options.lockPath);
    this.leadFrames = Math.round(
      ((options.leadMs ?? 200) * this.sampleRate) / 1000,
    );
    this.tickMs = options.tickMs ?? 20;
    this.now = options.now ?? (() => performance.now());
    this.useTimer = options.timer ?? true;
    this.spawnPlayer = options.spawn ?? spawnStdinPlayer;
    if (this.info.backend === "afplay")
      this.fallback = new LoopPlayer(options.lockPath);
  }

  /** Whether a streaming player process is currently running. */
  public get streaming(): boolean {
    return this.child !== undefined;
  }

  /** Player processes started so far (gapless edits never add one). */
  public get playerStarts(): number {
    return this.spawns;
  }

  /**
   * Start playback at `beat`, or, when already playing, swap in the new
   * score at the current position without restarting the player.
   */
  public async play(score: TrackScore, beat?: number): Promise<void> {
    if (this.info.backend === "none") return;
    if (this.fallback) return this.fallback.play(score, beat);
    const loop = this.render(score);
    if (this.child) {
      this.swap(loop, beat);
      return;
    }
    if (this.starting) {
      await this.starting;
      if (this.child) this.swap(loop, beat);
      return;
    }
    this.starting = this.start(loop, beat ?? 0).finally(() => {
      this.starting = undefined;
    });
    await this.starting;
  }

  /** Jump to transport `beat` (as of now) without restarting the player. */
  public seek(beat: number): void {
    if (!this.loop || !this.child) return;
    this.cursor = this.frameForBeat(
      this.loop,
      beat + this.queuedBeats(this.loop),
    );
  }

  /**
   * Beats already queued ahead of the wall clock. The next frame written
   * sounds this far after now, so a transport beat maps to the write head
   * by adding it.
   */
  private queuedBeats(loop: Loop): number {
    const elapsed = Math.floor(
      ((this.now() - this.startMs) * this.sampleRate) / 1000,
    );
    return Math.max(0, this.written - elapsed) / loop.framesPerBeat;
  }

  public stop(): void {
    void this.stopAsync();
  }

  public async stopAsync(): Promise<void> {
    this.generation += 1;
    if (this.fallback) {
      this.fallback.stop();
      return;
    }
    await this.starting?.catch(() => undefined);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const child = this.child;
    this.child = undefined;
    this.loop = undefined;
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

  /**
   * Write every frame due by now plus the lead. Called by the timer; tests
   * call it directly with an injected clock.
   */
  public pump(): void {
    const child = this.child;
    const loop = this.loop;
    if (!child || !loop) return;
    const due =
      Math.floor(((this.now() - this.startMs) * this.sampleRate) / 1000) +
      this.leadFrames;
    let remaining = due - this.written;
    if (remaining <= 0) return;
    // Never queue more than one second at once, e.g. after a stalled loop.
    if (remaining > this.sampleRate) {
      const skipped = remaining - this.sampleRate;
      this.cursor = (this.cursor + skipped) % loop.frames;
      this.written += skipped;
      remaining = this.sampleRate;
    }
    const out = new Int16Array(remaining * RENDER_CHANNELS);
    let offset = 0;
    while (offset < remaining) {
      const take = Math.min(remaining - offset, loop.frames - this.cursor);
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
    this.written += remaining;
    try {
      child.stdin.write(new Uint8Array(out.buffer));
      child.stdin.flush?.();
    } catch {
      /* the exit handler decides whether to restart */
    }
  }

  private render(score: TrackScore): Loop {
    const audio = renderScorePcm(score, {
      sampleRate: this.sampleRate,
      loop: true,
    });
    return {
      pcm: audio.pcm,
      frames: audio.frames,
      framesPerBeat: (60 * this.sampleRate) / score.tempoBpm,
    };
  }

  private frameForBeat(loop: Loop, beat: number): number {
    const frame = Math.round(Math.max(0, beat) * loop.framesPerBeat);
    return ((frame % loop.frames) + loop.frames) % loop.frames;
  }

  private swap(next: Loop, beat?: number): void {
    const previous = this.loop;
    // Keep the musical position: the same beat inside the new loop.
    let cursor = previous
      ? this.frameForBeat(next, this.cursor / previous.framesPerBeat)
      : 0;
    if (beat !== undefined) {
      // Re-anchor to the transport only when it disagrees audibly (a seek
      // or a tempo change); sub-frame rounding must not click on edits.
      const anchored = this.frameForBeat(next, beat + this.queuedBeats(next));
      const distance = Math.abs(anchored - cursor);
      const wrapped = Math.min(distance, next.frames - distance);
      if (!previous || wrapped > this.sampleRate * RESYNC_SECONDS)
        cursor = anchored;
    }
    this.cursor = cursor;
    this.loop = next;
  }

  private async start(loop: Loop, beat: number): Promise<void> {
    const generation = this.generation;
    if (!(await this.lock.acquire())) return;
    if (generation !== this.generation) {
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
    this.startMs = this.now();
    this.written = 0;
    this.cursor = this.frameForBeat(loop, beat);
    void child.exited.then(() => {
      if (this.child !== child) return;
      // The player died while we still want sound: stop cleanly rather than
      // spin; the next play() starts a fresh player.
      this.child = undefined;
      this.loop = undefined;
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      void this.lock.release();
    });
    this.pump();
    if (this.useTimer) this.timer = setInterval(() => this.pump(), this.tickMs);
  }
}

function spawnStdinPlayer(command: readonly string[]): PlayerProcess {
  if (command.length === 0) throw new Error("no player command");
  const child = Bun.spawn([...command], {
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
