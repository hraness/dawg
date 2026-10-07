import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { TrackScore } from "../../core/score.ts";
import { AudioEngine } from "../audio/engine.ts";
import { DaemonClient, type DaemonClientOptions } from "./client.ts";
import { FilePresence } from "./presence.ts";
import type {
  PresenceEntry,
  TransportAction,
  TransportState,
} from "./protocol.ts";
import type { MetaExpect, MetaPatch, SessionMeta } from "./meta.ts";
import {
  appendSessionEvent,
  loadSession,
  SessionConflictError,
  updateSessionMeta,
  type SessionEvent,
  type SessionPaths,
  type SessionRecord,
} from "./store.ts";

export type PortUpdate<T> =
  | { type: "record"; record: SessionRecord<T> }
  | { type: "transport"; transport: TransportState }
  | { type: "presence"; clients: PresenceEntry[] }
  /** Name or lineage changed; the score revision did not. */
  | { type: "meta"; meta: SessionMeta }
  /** Structured sync state for the header; no activity card. */
  | { type: "sync"; sync: SyncStatus }
  | { type: "status"; message: string };

/**
 * `synced` connected and idle, `syncing` a write is in flight, `conflict` the
 * last write raced another window and must rebase, `offline` trackd dropped
 * and is reconnecting, `local` file-lock fallback (no daemon).
 */
export type SyncStatus =
  "synced" | "syncing" | "conflict" | "offline" | "local";

export type MetaWriteResult = {
  status: "applied" | "stale";
  /** The metadata now in effect (the winner's, when stale). */
  meta: SessionMeta;
};

/** What a window plays locally. Connected windows never start audio. */
export type WindowPlayer = {
  /** Start at `beat`, or swap a playing loop in place (gapless engine). */
  play(score: TrackScore, beat?: number): Promise<void>;
  stop(): void;
};

/**
 * The seam between the TUI and session persistence. `daemon` talks to trackd
 * (single writer, single transport, pushed updates); `file` is the original
 * file-lock path with snapshot polling, kept as the never-break fallback.
 */
export interface SessionPort<T> {
  readonly mode: "daemon" | "file";
  /** Human-readable status for the activity line. */
  readonly status: string;
  readonly player: WindowPlayer;
  readonly sync: SyncStatus;
  /** Appends an event at `current.revision`; throws SessionConflictError when stale. */
  append(
    current: SessionRecord<T>,
    event: Omit<SessionEvent, "id" | "revision" | "at">,
    composition: T,
  ): Promise<SessionRecord<T>>;
  load(): Promise<SessionRecord<T>>;
  /** Daemon mode only: asks trackd to change the shared transport. */
  transport(
    action: TransportAction,
    value?: { beat?: number; bpm?: number },
  ): Promise<void>;
  subscribe(listener: (update: PortUpdate<T>) => void): () => void;
  focus(trackId: string | null): Promise<void>;
  /** Atomically claims a track that no other live window has focused. */
  claimTrack(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<string | null>;
  /**
   * `claimTrack` with a draft fallback: when every track is focused, reserve
   * a new `track-N` id (not yet in the score) for this window.
   */
  claimOrDraft(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<{ trackId: string; draft: boolean }>;
  presence(): Promise<PresenceEntry[]>;
  /**
   * Conditional metadata write: applies only while `expect` matches the
   * stored metadata, so a user rename always beats an in-flight auto-name.
   */
  updateMeta(patch: MetaPatch, expect?: MetaExpect): Promise<MetaWriteResult>;
  close(): Promise<void>;
}

export type OpenPortOptions = {
  paths: SessionPaths;
  sessionId: string;
  label: string;
  focusedTrackId: string | null;
  /** Set false for one-shot commands (demo, export) that must not spawn trackd. */
  daemon?: boolean;
  daemonArgs?: string[];
};

/** Connects to (or starts) trackd, falling back to the file-lock path. */
export async function openSessionPort<T>(
  options: OpenPortOptions,
): Promise<SessionPort<T>> {
  if (options.daemon !== false && process.env.TRACK_DAEMON !== "0") {
    try {
      const clientOptions: DaemonClientOptions = {
        workspace: dirname(options.paths.root),
        sessionId: options.sessionId,
        label: options.label,
        focusedTrackId: options.focusedTrackId,
      };
      if (options.daemonArgs) clientOptions.daemonArgs = options.daemonArgs;
      const client = await DaemonClient.connect(clientOptions);
      return new DaemonPort<T>(client);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const port = await FilePort.open<T>(options);
      port.status = `trackd unavailable (${reason}); using file lock`;
      return port;
    }
  }
  const port = await FilePort.open<T>(options);
  port.status = "file session";
  return port;
}

const silentPlayer: WindowPlayer = {
  play: async () => undefined,
  stop: () => undefined,
};

class DaemonPort<T> implements SessionPort<T> {
  public readonly mode = "daemon" as const;
  public readonly player = silentPlayer;
  public status: string;
  public sync: SyncStatus = "synced";
  private readonly syncListeners = new Set<(sync: SyncStatus) => void>();

  public constructor(private readonly client: DaemonClient) {
    this.status = `trackd pid ${client.daemonPid}`;
  }

  private setSync(sync: SyncStatus): void {
    if (this.sync === sync) return;
    this.sync = sync;
    for (const listener of this.syncListeners) listener(sync);
  }

  public async append(
    current: SessionRecord<T>,
    event: Omit<SessionEvent, "id" | "revision" | "at">,
    composition: T,
  ): Promise<SessionRecord<T>> {
    // Transport lives in trackd's clock, not in the event log, when connected.
    if (event.kind === "transport") return this.record();
    if (this.client.connected) this.setSync("syncing");
    let result;
    try {
      result = await this.client.apply({
        base: current.revision,
        kind: event.kind,
        payload: event.payload,
        composition,
        key: randomUUID(),
      });
    } catch (error) {
      this.setSync(this.client.connected ? "synced" : "offline");
      throw error;
    }
    if (result.status === "accepted" || result.status === "duplicate") {
      this.setSync("synced");
      return this.record();
    }
    if (result.status === "rebase") {
      this.setSync("conflict");
      throw new SessionConflictError();
    }
    this.setSync("synced");
    throw new Error(`trackd rejected ${event.kind}: ${result.message}`);
  }

  public async load(): Promise<SessionRecord<T>> {
    await this.client.sync();
    return this.record();
  }

  public async transport(
    action: TransportAction,
    value?: { beat?: number; bpm?: number },
  ): Promise<void> {
    await this.client.setTransport(action, value);
  }

  public subscribe(listener: (update: PortUpdate<T>) => void): () => void {
    listener({ type: "transport", transport: this.client.transport });
    const onSync = (sync: SyncStatus) => listener({ type: "sync", sync });
    this.syncListeners.add(onSync);
    const unsubscribe = this.client.subscribe((update) => {
      if (update.type === "record") {
        // A fresh record means this window has caught up after a conflict.
        if (this.sync === "conflict") this.setSync("synced");
        listener({ type: "record", record: update.record as SessionRecord<T> });
      } else if (update.type === "status") {
        this.status = update.message;
        this.setSync(update.connected ? "synced" : "offline");
        listener({ type: "status", message: update.message });
      } else listener(update);
    });
    return () => {
      this.syncListeners.delete(onSync);
      unsubscribe();
    };
  }

  public focus(trackId: string | null): Promise<void> {
    return this.client.focus(trackId);
  }

  public claimTrack(
    _trackIds: readonly string[],
    preferred?: string,
  ): Promise<string | null> {
    // trackd claims against its own authoritative score order.
    return this.client.claimTrack(preferred);
  }

  public claimOrDraft(
    _trackIds: readonly string[],
    preferred?: string,
  ): Promise<{ trackId: string; draft: boolean }> {
    return this.client.claimOrDraft(preferred);
  }

  public async presence(): Promise<PresenceEntry[]> {
    return this.client.presence;
  }

  public async updateMeta(
    patch: MetaPatch,
    expect?: MetaExpect,
  ): Promise<MetaWriteResult> {
    const status = await this.client.updateMeta(patch, expect);
    return { status, meta: this.client.record.meta };
  }

  public async close(): Promise<void> {
    this.client.close();
  }

  private record(): SessionRecord<T> {
    return this.client.record as SessionRecord<T>;
  }
}

class FilePort<T> implements SessionPort<T> {
  public readonly mode = "file" as const;
  public status = "file session";
  public readonly sync = "local" as const;
  public readonly player: WindowPlayer;
  private readonly presenceStore: FilePresence;

  private constructor(private readonly options: OpenPortOptions) {
    this.player = new AudioEngine({
      lockPath: `${options.paths.record}.audio.lock`,
    });
    this.presenceStore = new FilePresence(options.paths, {
      clientId: randomUUID(),
      pid: process.pid,
      label: options.label.slice(0, 128),
      focusedTrackId: options.focusedTrackId,
    });
  }

  public static async open<T>(options: OpenPortOptions): Promise<FilePort<T>> {
    const port = new FilePort<T>(options);
    if (options.daemon !== false)
      await port.presenceStore.start().catch(() => undefined);
    return port;
  }

  public append(
    current: SessionRecord<T>,
    event: Omit<SessionEvent, "id" | "revision" | "at">,
    composition: T,
  ): Promise<SessionRecord<T>> {
    return appendSessionEvent(this.options.paths, current, event, composition);
  }

  public load(): Promise<SessionRecord<T>> {
    return loadSession<T>(this.options.paths);
  }

  public async transport(): Promise<void> {
    throw new Error("file sessions drive transport locally");
  }

  public subscribe(listener: (update: PortUpdate<T>) => void): () => void {
    let revision = -1;
    let metaVersion = -1;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.load()
        .then((record) => {
          if (record.revision > revision) listener({ type: "record", record });
          else if (metaVersion >= 0 && record.meta.version > metaVersion)
            listener({ type: "meta", meta: record.meta });
          revision = Math.max(revision, record.revision);
          metaVersion = Math.max(metaVersion, record.meta.version);
        })
        // A partially written or concurrently replaced snapshot is retried next tick.
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, 200);
    return () => clearInterval(timer);
  }

  public focus(trackId: string | null): Promise<void> {
    return this.presenceStore.focus(trackId);
  }

  public claimTrack(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<string | null> {
    return this.presenceStore.claim(trackIds, preferred);
  }

  public claimOrDraft(
    trackIds: readonly string[],
    preferred?: string,
  ): Promise<{ trackId: string; draft: boolean }> {
    return this.presenceStore.claimOrDraft(trackIds, preferred);
  }

  public presence(): Promise<PresenceEntry[]> {
    return this.presenceStore.list();
  }

  public async updateMeta(
    patch: MetaPatch,
    expect?: MetaExpect,
  ): Promise<MetaWriteResult> {
    const result = await updateSessionMeta<T>(
      this.options.paths,
      patch,
      expect,
    );
    return { status: result.status, meta: result.record.meta };
  }

  public async close(): Promise<void> {
    this.player.stop();
    await this.presenceStore.stop();
  }
}
