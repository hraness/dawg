import { mkdir, rm, stat, utimes } from "node:fs/promises";

/** Locks older than this without a heartbeat belong to a crashed player. */
const STALE_LOCK_MS = 15_000;
const HEARTBEAT_MS = 5_000;

/**
 * The per-session audio lock: one directory that at most one process (a
 * window in file mode, or trackd) holds while it is making sound. Its mtime
 * is a heartbeat so a crashed owner is reclaimed after STALE_LOCK_MS.
 */
export class PlaybackLock {
  private owned = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  public constructor(private readonly path: string | undefined) {}

  public get held(): boolean {
    return this.path === undefined || this.owned;
  }

  public async acquire(): Promise<boolean> {
    if (!this.path) return true;
    if (this.owned) return true;
    try {
      await mkdir(this.path);
      await Bun.write(`${this.path}/owner`, `${process.pid}\n`);
      this.owned = true;
      this.heartbeat = setInterval(() => {
        if (!this.path || !this.owned) return;
        void utimes(this.path, new Date(), new Date()).catch(() => undefined);
      }, HEARTBEAT_MS);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(this.path)).mtimeMs > STALE_LOCK_MS) {
          await rm(this.path, { recursive: true, force: true });
          return this.acquire();
        }
      } catch {
        /* another window released between stat and retry */
      }
      return false;
    }
  }

  public async release(): Promise<void> {
    if (!this.owned || !this.path) return;
    this.owned = false;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    await rm(this.path, { recursive: true, force: true });
  }
}
