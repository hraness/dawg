import type { TrackScore } from "../../core/score.ts";
import { PlaybackLock } from "./lock.ts";
import { LoopPlayer } from "./player.ts";
import { LoopRenderer, type LoopRender } from "./renderer.ts";
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
import { playbackTime } from "./arrange.ts";
import { transportMapFor, type TransportMap } from "./clock.ts";

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
 * Pick the audio backend. Order: DAWG_AUDIO=0 (none), DAWG_AUDIO_PLAYER
 * (explicit stdin command), DAWG_AUDIO_BACKEND (forced name), then ffplay,
 * sox `play`, and afplay (macOS) in that order.
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
        detail: "DAWG_AUDIO_BACKEND",
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
  /** Set false to render on the calling thread instead of a worker. */
  worker?: boolean;
  /** Project root for sampler voices; without it samplers render silent. */
  projectRoot?: string;
  /** Base delay before a dead player is respawned; doubles per attempt. */
  respawnMs?: number;
  /** Player lifecycle notices worth a status line. */
  onStatus?: (status: AudioStatus) => void;
}>;

export type AudioStatus = Readonly<{
  /** `restarting`: the player died and is being respawned; `stopped`: gave up. */
  state: "restarting" | "stopped";
  message: string;
}>;

/** Respawns of a dying player before playback is declared stopped. */
const MAX_RESPAWNS = 3;
/** A player that ran this long before dying resets the respawn budget. */
const RESPAWN_RESET_MS = 10_000;
/** Lead grows to this multiple of the last render time. */
const LEAD_RENDER_FACTOR = 1.5;

type Loop = Readonly<{
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
  score: TrackScore;
  beat: number | undefined;
  /** Monotonic ms when `beat` was observed. */
  atMs: number;
  generation: number;
  waiters: { resolve: () => void; reject: (error: Error) => void }[];
};

/**
 * The gapless audio engine. It renders the score into one seamless loop
 * (tails folded onto the start) and streams it to a long-lived stdin player.
 *
 * Timing: the engine is paced by the same monotonic clock as the transport.
 * Frame `n` of the stream belongs to wall time `start + n / rate`, and the
 * engine keeps a lead of audio queued ahead of now: at least `leadMs`, and
 * 1.5x the last render time when renders are slower than that. The device
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
  private readonly now: () => number;
  private readonly useTimer: boolean;
  private readonly spawnPlayer: (command: readonly string[]) => PlayerProcess;
  private readonly renderer: LoopRenderer;
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
      ((options.leadMs ?? 200) * this.sampleRate) / 1000,
    );
    this.defaultLeadFrames = this.leadFrames;
    this.fadeFrames = Math.max(
      1,
      Math.round(SWAP_FADE_SECONDS * this.sampleRate),
    );
    this.tickMs = options.tickMs ?? 20;
    this.now = options.now ?? (() => performance.now());
    this.useTimer = options.timer ?? true;
    this.spawnPlayer = options.spawn ?? spawnStdinPlayer;
    this.respawnMs = options.respawnMs ?? 250;
    this.onStatus = options.onStatus;
    this.renderer = new LoopRenderer({
      sampleRate: this.sampleRate,
      ...(options.worker === undefined ? {} : { worker: options.worker }),
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
    // Play mode and auditions keep their short lead: renders run
    // off-thread, so a slow render delays the swap, not the stream.
    const adaptive =
      (this.monitoring || this.leadPinned) && this.renderer.offThread
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
    return new Promise<void>((resolve, reject) => {
      const waiters = this.queued?.waiters ?? [];
      waiters.push({ resolve, reject });
      this.queued = {
        score,
        beat,
        atMs: this.now(),
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
        try {
          const render = await this.renderer.render(request.score);
          this.lastRenderMs = render.renderMs;
          // Stopped while rendering: the result is stale, not an error.
          if (request.generation === this.generation) {
            await this.apply(this.toLoop(render, request.score), request);
            this.lastLoopPcm = render.pcm;
            this.lastMaster = render.master;
          }
          for (const waiter of request.waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of request.waiters)
            waiter.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async apply(loop: Loop, request: PlayRequest): Promise<void> {
    // The transport kept moving while the render ran.
    const beat =
      request.beat === undefined
        ? undefined
        : beatAfter(
            loop,
            request.beat,
            ((this.now() - request.atMs) * this.sampleRate) / 1000,
          );
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
      beatAfter(this.loop, beat, this.queuedFrames()),
    );
  }

  private queuedFrames(): number {
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
    const due =
      Math.floor(((this.now() - this.startMs) * this.sampleRate) / 1000) +
      this.lead;
    let remaining = due - this.written;
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
    let offset = 0;
    while (loop && offset < remaining) {
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
        left += fade.loop.pcm[from]! * g;
        right += fade.loop.pcm[from + 1]! * g;
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
    return {
      pcm: render.pcm,
      frames: render.frames,
      framesPerBeat: (60 * this.sampleRate) / timeline.tempoBpm,
      sampleRate: this.sampleRate,
      ...(map ? { map } : {}),
    };
  }

  private frameForBeat(loop: Loop, beat: number): number {
    const frame = Math.round(frameOfBeat(loop, Math.max(0, beat)));
    return ((frame % loop.frames) + loop.frames) % loop.frames;
  }

  private swap(next: Loop, beat?: number): void {
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

  private async start(loop: Loop | undefined, beat: number): Promise<void> {
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
    this.endFades();
    this.startMs = this.now();
    this.written = 0;
    this.cursor = loop ? this.frameForBeat(loop, beat) : 0;
    void child.exited.then(() => {
      if (this.child !== child) return;
      this.onPlayerExit(generation);
    });
    this.pump();
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
    const heard = loop
      ? (((this.cursor - this.queuedFrames()) % loop.frames) + loop.frames) %
        loop.frames
      : 0;
    const diedAt = this.now();
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

function clamp16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}
