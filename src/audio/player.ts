import { unlink } from "node:fs/promises";
import type { TrackScore } from "../../core/score.ts";
import { PlaybackLock } from "./lock.ts";
import { SampleLibrary, hasSamplerTracks, type SampleBank } from "./samples.ts";
import { RENDER_CHANNELS, encodeWav, renderScorePcm } from "./wav.ts";
import { transportMapFor } from "./clock.ts";

/** Small best-effort local player. The score and transport remain testable without a sound device. */
export class LoopPlayer {
  private process: { kill: () => void; exited?: Promise<number> } | undefined;
  private file: string | undefined;
  private readonly lock: PlaybackLock;
  private readonly lockPath: string | undefined;

  private library: SampleLibrary | undefined;

  public constructor(
    lockPath?: string,
    private readonly projectRoot?: string,
  ) {
    this.lockPath = lockPath;
    this.lock = new PlaybackLock(lockPath);
  }

  private get ownsLock(): boolean {
    return this.lockPath !== undefined && this.lock.held;
  }

  /** Whether this process currently owns the session's shared audio lock. */
  public get ownsPlaybackLock(): boolean {
    return this.ownsLock;
  }

  /**
   * Render one seamless loop (tails folded onto the start), rotated so the
   * file begins at `beat`, then (re)start the one-shot player on it. This is
   * the last-resort backend; streaming players never restart on edits.
   */
  public async play(score: TrackScore, beat = 0): Promise<void> {
    await this.stopAsync();
    if (process.env.DAWG_AUDIO === "0") return;
    if (this.lockPath && !(await this.acquireLock())) return;
    let samples: SampleBank | undefined;
    if (this.projectRoot !== undefined && hasSamplerTracks(score)) {
      this.library ??= new SampleLibrary({ projectRoot: this.projectRoot });
      samples = await this.library.load(score).catch(() => undefined);
    }
    const path = `/tmp/dawg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
    await Bun.write(path, renderLoopWav(score, beat, samples));
    this.file = path;
    this.spawn(path);
  }

  private spawn(path: string): void {
    const command =
      process.platform === "darwin"
        ? ["afplay", path]
        : [
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-loglevel",
            "quiet",
            "-loop",
            "0",
            path,
          ];
    try {
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      this.process = child;
      void child.exited.then(() => {
        if (this.process !== child) return;
        this.process = undefined;
        // afplay is one-shot, so restart the same rendered loop while the
        // session still owns the playback lock. Stop clears `this.file` first.
        if (this.file === path && this.ownsLock) {
          this.spawn(path);
          return;
        }
        void this.cleanup().then(() => this.releaseLock());
      });
    } catch {
      void this.cleanup().then(() => this.releaseLock());
    }
  }

  public stop(): void {
    void this.stopAsync();
  }

  private async stopAsync(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    child?.kill();
    await child?.exited;
    await this.cleanup();
    await this.releaseLock();
  }

  private async acquireLock(): Promise<boolean> {
    return this.lock.acquire();
  }

  private async releaseLock(): Promise<void> {
    await this.lock.release();
  }

  private async cleanup(): Promise<void> {
    if (!this.file) return;
    const path = this.file;
    this.file = undefined;
    await unlink(path).catch(() => undefined);
  }
}

/** A loop-folded WAV whose first frame is `beat` into the loop. */
export function renderLoopWav(
  score: TrackScore,
  beat = 0,
  samples?: SampleBank,
): Uint8Array {
  const audio = renderScorePcm(score, { loop: true, samples });
  const framesPerBeat = (60 * audio.sampleRate) / score.tempoBpm;
  const map = transportMapFor(score);
  const first = map
    ? map.seconds(Math.max(0, beat) % map.loopBeats) * audio.sampleRate
    : Math.max(0, beat) * framesPerBeat;
  const start =
    ((Math.round(first) % audio.frames) + audio.frames) % audio.frames;
  const rotated = new Int16Array(audio.pcm.length);
  rotated.set(audio.pcm.subarray(start * RENDER_CHANNELS));
  rotated.set(
    audio.pcm.subarray(0, start * RENDER_CHANNELS),
    (audio.frames - start) * RENDER_CHANNELS,
  );
  return encodeWav(rotated, audio.sampleRate, RENDER_CHANNELS);
}
