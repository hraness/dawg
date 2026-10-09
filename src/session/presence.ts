import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { acquireSessionLock } from "./lock.ts";
import {
  chooseTrack,
  claimOrDraft,
  requirePresence,
  type PresenceEntry,
} from "./protocol.ts";
import type { SessionPaths } from "./store.ts";

/** Heartbeats are refreshed every second and expire after this window. */
export const PRESENCE_STALE_MS = 5_000;
const HEARTBEAT_MS = 1_000;
const MAX_PRESENCE_FILE_BYTES = 4 * 1024;
const MAX_PRESENCE_FILES = 256;

/**
 * Presence for windows on the file-lock fallback: one heartbeat file per
 * client under the session directory. Claims are serialized by a lock so two
 * windows opening at once cannot pick the same track.
 */
export class FilePresence {
  private readonly dir: string;
  private readonly lock: string;
  private entry: PresenceEntry;
  private timer: ReturnType<typeof setInterval> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private writes = 0;

  public constructor(paths: SessionPaths, entry: PresenceEntry) {
    this.dir = `${paths.record}.presence`;
    this.lock = `${paths.record}.presence.lock`;
    this.entry = entry;
  }

  public async start(): Promise<void> {
    await this.write();
    this.timer = setInterval(
      () => void this.write().catch(() => {}),
      HEARTBEAT_MS,
    );
    this.timer.unref?.();
  }

  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await rm(this.file(), { force: true });
  }

  public async focus(trackId: string | null): Promise<void> {
    this.entry = { ...this.entry, focusedTrackId: trackId };
    // Presence is advisory: a failed heartbeat write never refuses a focus change.
    await this.write().catch(() => undefined);
  }

  public async claim(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<string | null> {
    const release = await acquireSessionLock(this.lock);
    try {
      const taken = new Set<string>();
      for (const other of await this.list())
        if (other.clientId !== this.entry.clientId && other.focusedTrackId)
          taken.add(other.focusedTrackId);
      const trackId = chooseTrack(trackIds, taken, preferred);
      if (trackId !== null) await this.focus(trackId);
      return trackId;
    } finally {
      await release();
    }
  }

  /** Claim with draft fallback, serialized by the same lock as `claim`. */
  public async claimOrDraft(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<{ trackId: string; draft: boolean }> {
    const release = await acquireSessionLock(this.lock);
    try {
      const taken = new Set<string>();
      for (const other of await this.list())
        if (other.clientId !== this.entry.clientId && other.focusedTrackId)
          taken.add(other.focusedTrackId);
      const claim = claimOrDraft(trackIds, taken, preferred);
      await this.focus(claim.trackId);
      return claim;
    } finally {
      await release();
    }
  }

  /** Live entries; stale or dead-process heartbeats are removed. */
  public async list(now = Date.now()): Promise<PresenceEntry[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((name) =>
        name.endsWith(".json"),
      );
    } catch {
      return [];
    }
    const entries: PresenceEntry[] = [];
    for (const name of names.slice(0, MAX_PRESENCE_FILES)) {
      const path = join(this.dir, name);
      try {
        const text = await readFile(path, "utf8");
        if (text.length > MAX_PRESENCE_FILE_BYTES) throw new Error("too large");
        const value: unknown = JSON.parse(text);
        const at = (value as { at?: unknown }).at;
        const entry = requirePresence(value);
        if (
          typeof at !== "number" ||
          now - at > PRESENCE_STALE_MS ||
          !alive(entry.pid)
        )
          throw new Error("stale");
        entries.push(entry);
      } catch {
        await rm(path, { force: true }).catch(() => undefined);
      }
    }
    return entries;
  }

  private file(): string {
    return join(this.dir, `${this.entry.clientId}.json`);
  }

  /** Writes are serialized so the heartbeat and focus() never share a rename. */
  private write(): Promise<void> {
    const next = this.writing.then(
      () => this.writeNow(),
      () => this.writeNow(),
    );
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async writeNow(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file()}.${process.pid}.${++this.writes}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ ...this.entry, at: Date.now() }),
      "utf8",
    );
    await rename(temporary, this.file());
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
