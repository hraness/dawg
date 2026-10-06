import { appendFile, rm, stat, truncate } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import {
  applyScoreOperation,
  scoreFromJSON,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { TransportClock } from "../audio/clock.ts";
import { LoopPlayer } from "../audio/player.ts";
import { acquireSessionLock } from "./lock.ts";
import {
  compositionDigest,
  daemonLockPath,
  daemonLogPath,
  daemonSocketPath,
  encodeFrame,
  LineDecoder,
  MAX_CLIENT_FRAME_BYTES,
  monotonicEpochMs,
  parseClientMessage,
  ProtocolError,
  type ApplyResult,
  chooseTrack,
  type ClientMessage,
  type PresenceEntry,
  type ServerMessage,
  type TransportState,
} from "./protocol.ts";
import {
  appendSessionEvent,
  loadSession,
  SessionConflictError,
  sessionPaths,
  type SessionPaths,
  type SessionRecord,
} from "./store.ts";

/** A slow client that stops reading is dropped rather than buffered forever. */
const MAX_CLIENT_BACKLOG_BYTES = 32 * 1024 * 1024;
const DEFAULT_GRACE_MS = 30_000;
const DISK_POLL_MS = 750;
const MAX_LOG_BYTES = 256 * 1024;

type Composition = ReturnType<TrackScore["toJSON"]>;

type Client = {
  socket: Socket;
  decoder: LineDecoder;
  ready: boolean;
  presence?: PresenceEntry;
};

export type DaemonOptions = {
  workspace: string;
  sessionId: string;
  graceMs?: number;
};

/**
 * trackd: the single writer and the single audio transport for one session.
 * Clients send intents; the daemon applies them through the core reducer,
 * persists them with the existing atomic store, and broadcasts the result.
 */
export class TrackDaemon {
  private readonly paths: SessionPaths;
  private readonly socketPath: string;
  private readonly graceMs: number;
  private readonly clients = new Set<Client>();
  private readonly keys = new Map<string, number>();
  private readonly clock = new TransportClock();
  private readonly audio: LoopPlayer;
  private record!: SessionRecord<Composition>;
  private score!: TrackScore;
  private digest = "";
  private seq = 0;
  private server: Server | undefined;
  private releaseLock: (() => Promise<void>) | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private diskTimer: ReturnType<typeof setInterval> | undefined;
  private diskMtime = 0;
  private stopping: Promise<void> | undefined;

  public constructor(options: DaemonOptions) {
    this.paths = sessionPaths(options.workspace, options.sessionId);
    this.socketPath = daemonSocketPath(this.paths);
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.audio = new LoopPlayer(`${this.paths.record}.audio.lock`);
  }

  /** Returns false when another live daemon already owns this session. */
  public async start(): Promise<boolean> {
    try {
      this.releaseLock = await acquireSessionLock(
        daemonLockPath(this.paths),
        400,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out"))
        return false;
      throw error;
    }
    try {
      await this.reload();
      this.clock.setTempo(this.score.tempoBpm);
      // We hold the daemon lock, so any socket file left here belongs to a
      // crashed daemon and is safe to reclaim.
      await rm(this.socketPath, { force: true });
      this.server = createServer((socket) => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.socketPath, () => {
          this.server!.off("error", reject);
          resolve();
        });
      });
      this.diskTimer = setInterval(() => void this.pollDisk(), DISK_POLL_MS);
      this.armGrace();
      await this.log(`started pid ${process.pid} socket ${this.socketPath}`);
      return true;
    } catch (error) {
      await this.releaseLock?.();
      this.releaseLock = undefined;
      throw error;
    }
  }

  public get socket(): string {
    return this.socketPath;
  }

  // Declared before `stopped` so field initialization order keeps the resolver.
  private resolveStopped: () => void = () => undefined;
  /** Resolves once the daemon has shut down for any reason. */
  public readonly stopped: Promise<void> = new Promise((resolve) => {
    this.resolveStopped = resolve;
  });

  public stop(reason = "stop"): Promise<void> {
    this.stopping ??= this.shutdown(reason).finally(() =>
      this.resolveStopped(),
    );
    return this.stopping;
  }

  private async shutdown(reason: string): Promise<void> {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.diskTimer) clearInterval(this.diskTimer);
    this.audio.stop();
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    await this.queue.catch(() => undefined);
    // Bun's server.close callback can wait on already-destroyed sockets, so
    // bound it: the socket file is removed below either way.
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      const timer = setTimeout(resolve, 250);
      this.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await rm(this.socketPath, { force: true });
    await this.log(`stopped (${reason})`);
    await this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private accept(socket: Socket): void {
    if (this.stopping) return void socket.destroy();
    const client: Client = {
      socket,
      decoder: new LineDecoder(MAX_CLIENT_FRAME_BYTES),
      ready: false,
    };
    this.clients.add(client);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      let lines: string[];
      try {
        lines = client.decoder.push(chunk);
      } catch (error) {
        this.fail(client, error);
        return;
      }
      for (const line of lines) {
        if (line.length === 0) continue;
        let message: ClientMessage;
        try {
          message = parseClientMessage(line);
        } catch (error) {
          this.fail(client, error);
          return;
        }
        this.handle(client, message);
      }
    });
    // Bun does not always emit "close" for a socket that was written to
    // after its peer hung up, so any of these ends the client exactly once.
    const drop = () => {
      if (!this.clients.delete(client)) return;
      socket.destroy();
      if (client.presence) this.broadcastPresence();
      if (this.clients.size === 0) this.armGrace();
    };
    socket.on("end", drop);
    socket.on("error", drop);
    socket.on("close", drop);
  }

  private fail(client: Client, error: unknown): void {
    const code = error instanceof ProtocolError ? error.code : "invalid";
    const message = error instanceof Error ? error.message : "invalid frame";
    this.send(client, { v: 1, type: "error", code, message });
    client.socket.end();
  }

  private handle(client: Client, message: ClientMessage): void {
    if (message.type === "hello") {
      client.ready = true;
      client.presence = {
        clientId: message.clientId,
        pid: message.pid,
        label: message.label,
        focusedTrackId: message.focusedTrackId,
      };
      this.send(client, {
        v: 1,
        type: "welcome",
        sessionId: this.record.sessionId,
        pid: process.pid,
        record: this.record,
        digest: this.digest,
        transport: this.transportState(),
      });
      this.broadcastPresence();
      return;
    }
    if (!client.ready) {
      this.fail(client, new ProtocolError("handshake", "send hello first"));
      return;
    }
    if (message.type === "focus") {
      client.presence!.focusedTrackId = message.trackId;
      this.broadcastPresence();
      this.send(client, {
        v: 1,
        type: "claimed",
        id: message.id,
        trackId: message.trackId,
      });
      return;
    }
    if (message.type === "claim") {
      // Synchronous on the single event loop, so two simultaneous claims are
      // serialized and can never pick the same track.
      const taken = new Set<string>();
      for (const other of this.clients)
        if (other !== client && other.presence?.focusedTrackId)
          taken.add(other.presence.focusedTrackId);
      const trackId = chooseTrack(
        this.score.tracks.map((track) => track.id),
        taken,
        message.preferred,
      );
      if (trackId !== null) client.presence!.focusedTrackId = trackId;
      this.send(client, { v: 1, type: "claimed", id: message.id, trackId });
      this.broadcastPresence();
      return;
    }
    if (message.type === "ping") {
      this.send(client, { v: 1, type: "pong", id: message.id });
      return;
    }
    if (message.type === "sync") {
      // Queue behind pending writes so the snapshot reflects them.
      this.enqueue(async () => {
        this.send(client, {
          v: 1,
          type: "snapshot",
          record: this.record,
          digest: this.digest,
        });
        this.send(client, {
          v: 1,
          type: "result",
          id: message.id,
          status: "accepted",
          revision: this.record.revision,
        });
      });
      return;
    }
    if (message.type === "transport") {
      this.enqueue(async () => {
        this.transport(message.action, message.beat, message.bpm);
        this.send(client, {
          v: 1,
          type: "result",
          id: message.id,
          status: "accepted",
          revision: this.record.revision,
        });
      });
      return;
    }
    this.enqueue(async () => {
      const result = await this.apply(message);
      this.send(client, { v: 1, type: "result", id: message.id, ...result });
    });
  }

  private enqueue(task: () => Promise<void>): void {
    // One writer, strictly ordered: every intent observes the previous one.
    this.queue = this.queue.then(task).catch(async (error: unknown) => {
      await this.log(`task failed: ${String(error)}`);
    });
  }

  private async apply(
    message: Extract<ClientMessage, { type: "apply" }>,
  ): Promise<ApplyResult> {
    const seen = this.keys.get(message.key);
    if (seen !== undefined) return { status: "duplicate", revision: seen };
    if (message.base !== this.record.revision)
      return {
        status: "rebase",
        baseRevision: message.base,
        currentRevision: this.record.revision,
        message: `session is at rev ${this.record.revision}; rebase from rev ${message.base}`,
      };
    let next: TrackScore;
    try {
      if (message.operations) {
        next = this.score;
        for (const operation of message.operations)
          next = applyScoreOperation(next, parseOperation(operation));
      } else next = scoreFromJSON(message.composition);
      // Round-trip through the parser so only canonical score data is stored.
      next = scoreFromJSON(next.toJSON());
    } catch (error) {
      return {
        status: "rejected",
        code: "invalid-operation",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const previousTempo = this.score.tempoBpm;
    try {
      this.record = await appendSessionEvent(
        this.paths,
        this.record,
        { kind: message.kind, payload: message.payload, id: message.key },
        next.toJSON(),
      );
    } catch (error) {
      if (error instanceof SessionConflictError) {
        // A file-fallback window wrote directly; adopt the disk state.
        await this.reload();
        this.broadcast({
          v: 1,
          type: "snapshot",
          record: this.record,
          digest: this.digest,
        });
        return {
          status: "rebase",
          baseRevision: message.base,
          currentRevision: this.record.revision,
          message: "session changed on disk; rebase",
        };
      }
      return {
        status: "rejected",
        code: "store",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.score = next;
    this.digest = compositionDigest(this.record.composition);
    this.keys.set(message.key, this.record.revision);
    this.diskMtime = await this.recordMtime();
    const event = this.record.events[this.record.events.length - 1]!;
    this.broadcast({
      v: 1,
      type: "commit",
      event,
      composition: this.record.composition,
      digest: this.digest,
    });
    this.afterScoreChange(previousTempo);
    return { status: "accepted", revision: this.record.revision };
  }

  private afterScoreChange(previousTempo: number): void {
    if (this.score.tempoBpm !== previousTempo) {
      this.clock.setTempo(this.score.tempoBpm);
      this.broadcastTransport();
    }
    if (this.clock.playing) void this.audio.play(this.score).catch(() => {});
  }

  private transport(
    action: "play" | "pause" | "toggle" | "seek" | "tempo",
    beat?: number,
    bpm?: number,
  ): void {
    const play =
      action === "play" || (action === "toggle" && !this.clock.playing);
    const pause =
      action === "pause" || (action === "toggle" && this.clock.playing);
    if (play && !this.clock.playing) {
      this.clock.play();
      void this.audio.play(this.score).catch(() => {});
    } else if (pause && this.clock.playing) {
      this.clock.pause();
      this.audio.stop();
    } else if (action === "seek" && beat !== undefined) {
      const now = Date.now();
      this.clock.sync(beat, this.clock.playing, now, now);
    } else if (action === "tempo" && bpm !== undefined) {
      this.clock.setTempo(bpm);
    }
    this.broadcastTransport();
  }

  private transportState(): TransportState {
    const atMs = monotonicEpochMs();
    return {
      seq: this.seq,
      playing: this.clock.playing,
      beat: this.clock.beatAt(),
      bpm: this.score.tempoBpm,
      atMs,
    };
  }

  private broadcastTransport(): void {
    this.seq += 1;
    this.broadcast({ v: 1, type: "transport", ...this.transportState() });
  }

  private presence(): PresenceEntry[] {
    const entries: PresenceEntry[] = [];
    for (const client of this.clients)
      if (client.ready && client.presence) entries.push({ ...client.presence });
    return entries;
  }

  private broadcastPresence(): void {
    this.broadcast({ v: 1, type: "presence", clients: this.presence() });
  }

  private broadcast(message: ServerMessage): void {
    const frame = encodeFrame(message);
    for (const client of this.clients)
      if (client.ready) this.write(client, frame);
  }

  private send(client: Client, message: ServerMessage): void {
    this.write(client, encodeFrame(message));
  }

  private write(client: Client, frame: string): void {
    if (client.socket.destroyed) return;
    if (client.socket.writableLength > MAX_CLIENT_BACKLOG_BYTES) {
      client.socket.destroy();
      return;
    }
    client.socket.write(frame);
  }

  private async reload(): Promise<void> {
    this.record = await loadSession<Composition>(this.paths);
    this.score = scoreFromJSON(this.record.composition);
    this.digest = compositionDigest(this.record.composition);
    this.keys.clear();
    for (const event of this.record.events)
      this.keys.set(event.id, event.revision);
    this.diskMtime = await this.recordMtime();
  }

  /** Adopt writes from windows that fell back to the file-lock path. */
  private async pollDisk(): Promise<void> {
    const mtime = await this.recordMtime();
    if (mtime === this.diskMtime) return;
    this.enqueue(async () => {
      const latest = await loadSession<Composition>(this.paths).catch(
        () => undefined,
      );
      this.diskMtime = await this.recordMtime();
      if (!latest || latest.revision <= this.record.revision) return;
      const previousTempo = this.score.tempoBpm;
      await this.reload();
      this.broadcast({
        v: 1,
        type: "snapshot",
        record: this.record,
        digest: this.digest,
      });
      this.afterScoreChange(previousTempo);
    });
  }

  private async recordMtime(): Promise<number> {
    try {
      return (await stat(this.paths.record)).mtimeMs;
    } catch {
      return 0;
    }
  }

  private armGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      if (this.clients.size === 0) void this.stop("idle");
    }, this.graceMs);
  }

  private async log(line: string): Promise<void> {
    const path = daemonLogPath(this.paths);
    try {
      if ((await stat(path)).size > MAX_LOG_BYTES) await truncate(path, 0);
    } catch {
      // Missing log file is created by the append below.
    }
    await appendFile(path, `${new Date().toISOString()} ${line}\n`).catch(
      () => undefined,
    );
  }
}

const OPERATION_TYPES = new Set([
  "addTrack",
  "addNote",
  "removeNote",
  "updateNote",
  "setTempo",
  "setBars",
  "updateTrack",
  "setAutomation",
  "clearTrack",
]);

/** Shape gate before the reducer, which validates every field it reads. */
function parseOperation(value: unknown): ScoreOperation {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { type?: unknown }).type !== "string" ||
    !OPERATION_TYPES.has((value as { type: string }).type)
  )
    throw new Error("unsupported score operation");
  return value as ScoreOperation;
}

/** Entry point used by `src/daemon.ts`. Exits the process when done. */
export async function runDaemon(options: DaemonOptions): Promise<never> {
  const daemon = new TrackDaemon(options);
  let started = false;
  try {
    started = await daemon.start();
  } catch (error) {
    process.stderr.write(`trackd: ${String(error)}\n`);
    process.exit(1);
  }
  if (!started) process.exit(0); // Another daemon owns the session.
  const exit = (signal: string) =>
    void daemon.stop(signal).finally(() => process.exit(0));
  process.on("SIGTERM", () => exit("SIGTERM"));
  process.on("SIGINT", () => exit("SIGINT"));
  process.on("SIGHUP", () => exit("SIGHUP"));
  await daemon.stopped;
  process.exit(0);
}
