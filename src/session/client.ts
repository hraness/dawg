import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import type { MetaExpect, MetaPatch, SessionMeta } from "./meta.ts";
import {
  daemonSocketPath,
  encodeFrame,
  LineDecoder,
  MAX_SERVER_FRAME_BYTES,
  parseServerMessage,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  ProtocolError,
  type ApplyResult,
  type ClientMessage,
  type LiveMessage,
  type LiveStatus,
  type PaneView,
  type PresenceEntry,
  type ServerMessage,
  type TransportAction,
  type TransportState,
} from "./protocol.ts";
import {
  sessionPaths,
  type SessionEvent,
  type SessionPaths,
  type SessionRecord,
} from "./store.ts";

export type DaemonClientUpdate =
  | { type: "record"; record: SessionRecord<unknown>; digest: string }
  | { type: "transport"; transport: TransportState }
  | { type: "presence"; clients: PresenceEntry[] }
  | { type: "meta"; meta: SessionMeta }
  | { type: "status"; connected: boolean; message: string };

export type DaemonClientOptions = {
  workspace: string;
  sessionId: string;
  label?: string;
  clientId?: string;
  /** Who is at this window; see src/identity/actor.ts. */
  actor?: { id: string; name: string };
  /**
   * Protocol range to offer. Defaults to this build's full range; tests pin
   * `{vMin: 1, vMax: 1}` to act as an old client.
   */
  versions?: { vMin: number; vMax: number };
  focusedTrackId?: string | null;
  /** Spawn a detached daemon when none answers. Defaults to true. */
  spawn?: boolean;
  /** Extra daemon arguments, for example `--grace-ms` in tests. */
  daemonArgs?: string[];
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
};

type Pending = {
  frame: string;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DAEMON_ENTRY = join(import.meta.dir, "..", "daemon.ts");

export class DaemonUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DaemonUnavailableError";
  }
}

/**
 * A dawgd session client. It keeps the latest record, digest, transport and
 * presence; reconnects (respawning the daemon) when the socket drops; and
 * resends unanswered requests after reconnecting. Requests carry idempotency
 * keys, so a resend of an already-committed apply is reported as duplicate.
 */
export class DaemonClient {
  public readonly paths: SessionPaths;
  public readonly socketPath: string;
  public readonly clientId: string;
  public record!: SessionRecord<unknown>;
  public digest = "";
  public transport!: TransportState;
  public presence: PresenceEntry[] = [];
  public daemonPid = 0;
  /** Negotiated revision: 1 until a v2 daemon says otherwise. */
  public protocol = 1;
  public caps: readonly string[] = [];
  /** Last intent seq this client issued; retries resend the same one. */
  private seq = 0;
  private socket: Socket | undefined;
  private decoder = new LineDecoder(MAX_SERVER_FRAME_BYTES);
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(update: DaemonClientUpdate) => void>();
  private closed = false;
  private reconnecting: Promise<void> | undefined;
  private focusedTrackId: string | null;
  private welcomed: (() => void) | undefined;
  private view: ClientMessage | undefined;
  private monitoring = false;
  private click: LiveMessage | undefined;

  private constructor(private readonly options: DaemonClientOptions) {
    this.paths = sessionPaths(options.workspace, options.sessionId);
    this.socketPath = daemonSocketPath(this.paths);
    this.clientId = options.clientId ?? randomUUID();
    this.focusedTrackId = options.focusedTrackId ?? null;
  }

  /** Connects to the session daemon, starting one if none is alive. */
  public static async connect(
    options: DaemonClientOptions,
  ): Promise<DaemonClient> {
    const client = new DaemonClient(options);
    await client.open(options.connectTimeoutMs ?? 4_000);
    return client;
  }

  public get connected(): boolean {
    return this.socket !== undefined && !this.socket.destroyed;
  }

  public subscribe(listener: (update: DaemonClientUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async apply(intent: {
    base: number;
    kind: string;
    payload: unknown;
    key?: string;
    /** Reuse to retry the same intent; a fresh one is drawn otherwise. */
    seq?: number;
    operations?: unknown[];
    composition?: unknown;
  }): Promise<ApplyResult> {
    const message: ClientMessage = {
      v: 1,
      type: "apply",
      id: randomUUID(),
      key: intent.key ?? randomUUID(),
      base: intent.base,
      kind: intent.kind,
      payload: intent.payload,
    };
    if (this.protocol >= 2) message.seq = intent.seq ?? this.nextSeq();
    if (intent.operations) message.operations = intent.operations;
    else message.composition = intent.composition;
    return this.result(await this.request(message));
  }

  public async setTransport(
    action: TransportAction,
    value?: { beat?: number; bpm?: number },
  ): Promise<TransportState> {
    const message: ClientMessage = {
      v: 1,
      type: "transport",
      id: randomUUID(),
      action,
    };
    if (value?.beat !== undefined) message.beat = value.beat;
    if (value?.bpm !== undefined) message.bpm = value.bpm;
    await this.request(message);
    return this.transport;
  }

  /** Round-trips behind every queued write and returns the latest record. */
  public async sync(): Promise<SessionRecord<unknown>> {
    await this.request({ v: 1, type: "sync", id: randomUUID() });
    return this.record;
  }

  public async focus(trackId: string | null): Promise<void> {
    this.focusedTrackId = trackId;
    await this.request({ v: 1, type: "focus", id: randomUUID(), trackId });
  }

  /** Atomically claims a track no other live window is focused on. */
  public async claimTrack(preferred?: string): Promise<string | null> {
    const message: ClientMessage = { v: 1, type: "claim", id: randomUUID() };
    if (preferred) message.preferred = preferred;
    const reply = await this.request(message);
    const trackId = reply.type === "claimed" ? reply.trackId : null;
    if (trackId !== null) this.focusedTrackId = trackId;
    return trackId;
  }

  /** Like `claimTrack`, but reserves a draft `track-N` when all are open. */
  public async claimOrDraft(
    preferred?: string,
  ): Promise<{ trackId: string; draft: boolean }> {
    const message: ClientMessage = {
      v: 1,
      type: "claim",
      id: randomUUID(),
      draft: true,
    };
    if (preferred) message.preferred = preferred;
    const reply = await this.request(message);
    if (reply.type !== "claimed" || reply.trackId === null)
      throw new Error("dawgd did not reserve a track");
    this.focusedTrackId = reply.trackId;
    return { trackId: reply.trackId, draft: reply.draft === true };
  }

  /**
   * Conditional metadata write. `stale` means `expect` no longer matched
   * (for example a user rename landed first); `record.meta` is then current.
   */
  public async updateMeta(
    patch: MetaPatch,
    expect?: MetaExpect,
  ): Promise<"applied" | "stale"> {
    const message: ClientMessage = {
      v: 1,
      type: "meta",
      id: randomUUID(),
      patch,
    };
    if (expect) message.expect = expect;
    const result = this.result(await this.request(message));
    if (result.status === "accepted") return "applied";
    if (result.status === "rejected" && result.code === "stale-meta")
      return "stale";
    throw new Error(
      result.status === "rejected" ? result.message : "dawgd meta failed",
    );
  }

  /** True when dawgd runs live notes and the click (`live` capability). */
  public get sharedLive(): boolean {
    return this.caps.includes("live");
  }

  /** This pane's own presence entry, as dawgd last broadcast it. */
  public get self(): PresenceEntry | undefined {
    return this.presence.find((entry) => entry.clientId === this.clientId);
  }

  /** Reports this pane's view fields; resent after a reconnect. */
  public setView(view: PaneView): void {
    this.view = { v: 1, type: "view", ...view };
    if (this.connected) this.socket!.write(encodeFrame(this.view));
  }

  /** Turns this pane's share of the shared live engine on or off. */
  public async liveMonitor(on: boolean): Promise<LiveStatus> {
    this.monitoring = on;
    const reply = await this.request({
      v: 1,
      type: "live",
      action: "monitor",
      id: randomUUID(),
      on,
    });
    if (reply.type !== "liveStatus")
      throw new Error("dawgd did not answer live monitor");
    const { v: _v, type: _type, id: _id, ...status } = reply;
    return status;
  }

  /** Fire-and-forget live note or click; the click is resent on reconnect. */
  public live(message: Exclude<LiveMessage, { action: "monitor" }>): void {
    if (message.action === "click")
      this.click = message.on || message.countIn ? message : undefined;
    if (this.connected) this.socket!.write(encodeFrame(message));
  }

  /** The next per-(actor, client) intent number. */
  public nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  public close(): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("dawgd client closed"));
      this.pending.delete(id);
    }
    this.socket?.destroy();
    this.socket = undefined;
    this.listeners.clear();
  }

  private result(message: ServerMessage): ApplyResult {
    if (message.type !== "result")
      throw new Error(`unexpected dawgd reply ${message.type}`);
    if (message.status === "accepted" || message.status === "duplicate")
      return { status: message.status, revision: message.revision };
    if (message.status === "rebase")
      return {
        status: "rebase",
        baseRevision: message.baseRevision,
        currentRevision: message.currentRevision,
        message: message.message,
      };
    return { status: "rejected", code: message.code, message: message.message };
  }

  private request(
    message: ClientMessage & { id: string },
  ): Promise<ServerMessage> {
    if (this.closed) return Promise.reject(new Error("dawgd client closed"));
    const frame = encodeFrame(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new DaemonUnavailableError("dawgd did not answer in time"));
      }, this.options.requestTimeoutMs ?? 10_000);
      this.pending.set(message.id, { frame, resolve, reject, timer });
      if (this.connected) this.socket!.write(frame);
      // Otherwise the frame is sent after the reconnect handshake.
    });
  }

  private async open(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSpawn = 0;
    while (true) {
      try {
        await this.attach(Math.max(200, deadline - Date.now()));
        return;
      } catch (error) {
        if (this.closed) throw error;
        if (Date.now() >= deadline)
          throw new DaemonUnavailableError(
            `dawgd unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        // No listener (ENOENT) or a stale socket from a crashed daemon
        // (ECONNREFUSED): start one. A losing spawn exits on its own because
        // the daemon lock admits exactly one live daemon per session.
        // Respawn at most once a second, in case the first spawn lost a race
        // with a daemon that was already shutting down.
        if (this.options.spawn !== false && Date.now() - lastSpawn > 1_000) {
          this.spawnDaemon();
          lastSpawn = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
  }

  private spawnDaemon(): void {
    const child = Bun.spawn(
      [
        process.execPath,
        DAEMON_ENTRY,
        "--workspace",
        this.options.workspace,
        "--session",
        this.options.sessionId,
        ...(this.options.daemonArgs ?? []),
      ],
      {
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, DAWG_DAEMON_CHILD: "1" },
      },
    );
    child.unref();
  }

  /** Connects once and completes the hello/welcome handshake. */
  private attach(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ path: this.socketPath });
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error("handshake timed out")),
        timeoutMs,
      );
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      socket.setEncoding("utf8");
      socket.once("error", fail);
      socket.once("connect", () => {
        this.decoder = new LineDecoder(MAX_SERVER_FRAME_BYTES);
        this.welcomed = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.off("error", fail);
          socket.on("error", () => undefined);
          this.socket = socket;
          // As in dawgd, "end" alone may be all Bun reports for a hang-up.
          socket.on("close", () => this.onClose(socket));
          socket.on("end", () => {
            socket.destroy();
            this.onClose(socket);
          });
          // Resend everything that was unanswered on the previous socket,
          // after this pane's view and live state (a respawned dawgd knows
          // neither).
          if (this.view) socket.write(encodeFrame(this.view));
          if (this.monitoring)
            socket.write(
              encodeFrame({
                v: 1,
                type: "live",
                action: "monitor",
                id: randomUUID(),
                on: true,
              }),
            );
          if (this.click) socket.write(encodeFrame(this.click));
          for (const pending of this.pending.values())
            socket.write(pending.frame);
          resolve();
        };
        socket.on("data", (chunk: string) => this.onData(socket, chunk));
        socket.write(
          encodeFrame({
            v: 1,
            type: "hello",
            pid: process.pid,
            label: (this.options.label ?? "dawg").slice(0, 128),
            clientId: this.clientId,
            focusedTrackId: this.focusedTrackId,
            ...(this.options.versions ?? {
              vMin: PROTOCOL_MIN,
              vMax: PROTOCOL_MAX,
            }),
            caps: ["actor", "seq", "quantum", "panes", "live"],
            ...(this.options.actor
              ? {
                  actorId: this.options.actor.id,
                  actorName: this.options.actor.name,
                }
              : {}),
          }),
        );
      });
      socket.once("close", () => fail(new Error("socket closed")));
    });
  }

  private onData(socket: Socket, chunk: string): void {
    let lines: string[];
    try {
      lines = this.decoder.push(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const line of lines) {
      if (line.length === 0) continue;
      let message: ServerMessage;
      try {
        message = parseServerMessage(line);
      } catch (error) {
        // A newer daemon's message types are skipped, not fatal; a malformed
        // frame of a known type still drops the connection.
        if (error instanceof ProtocolError && error.code === "unknown-type")
          continue;
        socket.destroy();
        return;
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.daemonPid = message.pid;
      this.protocol = message.protocol ?? 1;
      this.caps = message.caps ?? [];
      this.record = message.record;
      this.digest = message.digest;
      this.transport = message.transport;
      this.welcomed?.();
      this.welcomed = undefined;
      this.emit({ type: "record", record: this.record, digest: this.digest });
      this.emit({ type: "transport", transport: this.transport });
      return;
    }
    if (message.type === "commit") {
      // Commits arrive in order on one socket; a gap means we missed a frame,
      // so ask for a snapshot instead of guessing.
      if (message.event.revision !== this.record.revision + 1) {
        if (message.event.revision > this.record.revision)
          void this.sync().catch(() => undefined);
        return;
      }
      this.record = {
        sessionId: this.record.sessionId,
        revision: message.event.revision,
        updatedAt: message.event.at,
        composition: message.composition,
        events: [...this.record.events, message.event as SessionEvent],
        meta: this.record.meta,
      };
      this.digest = message.digest;
      this.emit({ type: "record", record: this.record, digest: this.digest });
      return;
    }
    if (message.type === "snapshot") {
      const changed =
        message.record.revision !== this.record.revision ||
        message.digest !== this.digest;
      const metaChanged =
        message.record.meta.version !== this.record.meta.version;
      this.record = message.record;
      this.digest = message.digest;
      if (changed)
        this.emit({ type: "record", record: this.record, digest: this.digest });
      if (metaChanged) this.emit({ type: "meta", meta: this.record.meta });
      return;
    }
    if (message.type === "transport") {
      const { v: _v, type: _type, ...state } = message;
      this.transport = state;
      this.emit({ type: "transport", transport: state });
      return;
    }
    if (message.type === "meta") {
      // Metadata has its own version; never regress to an older one.
      if (message.meta.version < this.record.meta.version) return;
      this.record = { ...this.record, meta: message.meta };
      this.emit({ type: "meta", meta: message.meta });
      return;
    }
    if (message.type === "presence") {
      this.presence = message.clients;
      this.emit({ type: "presence", clients: message.clients });
      return;
    }
    if (message.type === "error") {
      this.emit({
        type: "status",
        connected: this.connected,
        // Audio notices (a lost output, a dying player) carry their words.
        message:
          message.code === "audio"
            ? `audio · ${message.message}`
            : `dawgd error · ${message.code}`,
      });
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private onClose(socket: Socket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    if (this.closed) return;
    this.emit({
      type: "status",
      connected: false,
      message: "dawgd reconnecting",
    });
    this.reconnecting ??= this.reconnect().finally(() => {
      this.reconnecting = undefined;
    });
  }

  private async reconnect(): Promise<void> {
    let delay = 50;
    while (!this.closed) {
      try {
        await this.open(3_000);
        this.emit({
          type: "status",
          connected: true,
          message: "dawgd reconnected",
        });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(1_000, delay * 2);
      }
    }
  }

  private emit(update: DaemonClientUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch {
        // A rendering listener must not break the protocol loop.
      }
    }
  }
}
