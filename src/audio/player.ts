import { mkdir, rm, stat, unlink, utimes } from "node:fs/promises";
import type { TrackScore } from "../../core/score.ts";
import { renderScoreWav } from "./wav.ts";

/** Small best-effort local player. The score and transport remain testable without a sound device. */
export class LoopPlayer {
  private process: { kill: () => void; exited?: Promise<number> } | undefined;
  private file: string | undefined;
  private ownsLock = false;
  private lockHeartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly lockPath: string | undefined;

  public constructor(lockPath?: string) {
    this.lockPath = lockPath;
  }

  public async play(score: TrackScore): Promise<void> {
    await this.stopAsync();
    if (process.env.TRACK_AUDIO === "0") return;
    if (this.lockPath && !(await this.acquireLock())) return;
    const path = `/tmp/track-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
    await Bun.write(path, renderScoreWav(score));
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
    if (!this.lockPath) return true;
    try {
      await mkdir(this.lockPath);
      await Bun.write(`${this.lockPath}/owner`, `${process.pid}\n`);
      this.ownsLock = true;
      // The lock is also the crash-recovery signal. Keep its mtime fresh while
      // playback is alive so a second window cannot reclaim an active player
      // after the stale threshold elapses.
      this.lockHeartbeat = setInterval(() => {
        if (!this.lockPath || !this.ownsLock) return;
        void utimes(this.lockPath, new Date(), new Date()).catch(
          () => undefined,
        );
      }, 5_000);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(this.lockPath)).mtimeMs > 15_000) {
          await rm(this.lockPath, { recursive: true, force: true });
          return this.acquireLock();
        }
      } catch {
        /* another window released between stat and retry */
      }
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.ownsLock || !this.lockPath) return;
    this.ownsLock = false;
    if (this.lockHeartbeat) {
      clearInterval(this.lockHeartbeat);
      this.lockHeartbeat = undefined;
    }
    await rm(this.lockPath, { recursive: true, force: true });
  }

  private async cleanup(): Promise<void> {
    if (!this.file) return;
    const path = this.file;
    this.file = undefined;
    await unlink(path).catch(() => undefined);
  }
}
