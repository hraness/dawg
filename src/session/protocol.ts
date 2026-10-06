import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MetaValidationError,
  parseMetaExpect,
  parseMetaPatch,
  parseSessionMeta,
  type MetaExpect,
  type MetaPatch,
  type SessionMeta,
} from "./meta.ts";
import type { SessionEvent, SessionPaths, SessionRecord } from "./store.ts";

/**
 * trackd wire protocol: newline-delimited JSON over a Unix domain socket.
 * Every frame carries `v`; every inbound frame is parsed from `unknown` and
 * bounded before it can reach the reducer, the store, or the transport.
 */
export const PROTOCOL_VERSION = 1 as const;
/** Client intents carry at most one composition plus a bounded payload. */
export const MAX_CLIENT_FRAME_BYTES = 2 * 1024 * 1024;
/** Snapshots carry a full session record, which the store bounds at 4 MiB. */
export const MAX_SERVER_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_ID_LENGTH = 64;
const MAX_KIND_LENGTH = 128;
const MAX_OPERATIONS = 256;
const MAX_PRESENCE = 256;
/** macOS sun_path is 104 bytes including the terminator; Linux is 108. */
const MAX_SOCKET_PATH_BYTES = 100;

export type TransportAction = "play" | "pause" | "toggle" | "seek" | "tempo";

export type TransportState = {
  /** Daemon-assigned, strictly increasing per daemon process. */
  seq: number;
  playing: boolean;
  /** Beat position at `atMs`. */
  beat: number;
  bpm: number;
  /** Daemon monotonic clock expressed on the epoch (timeOrigin + now). */
  atMs: number;
};

/** One live window. trackd drops the entry when the client disconnects. */
export type PresenceEntry = {
  clientId: string;
  pid: number;
  label: string;
  focusedTrackId: string | null;
};

export type ClientMessage =
  | {
      v: 1;
      type: "hello";
      pid: number;
      label: string;
      clientId: string;
      focusedTrackId: string | null;
    }
  | { v: 1; type: "focus"; id: string; trackId: string | null }
  /** `draft` asks trackd to reserve a new `track-N` id when all are open. */
  | { v: 1; type: "claim"; id: string; preferred?: string; draft?: boolean }
  /** Conditional metadata write (rename, auto-name); never bumps the revision. */
  | { v: 1; type: "meta"; id: string; patch: MetaPatch; expect?: MetaExpect }
  | {
      v: 1;
      type: "apply";
      id: string;
      key: string;
      base: number;
      kind: string;
      payload: unknown;
      operations?: unknown[];
      composition?: unknown;
    }
  | {
      v: 1;
      type: "transport";
      id: string;
      action: TransportAction;
      beat?: number;
      bpm?: number;
    }
  | { v: 1; type: "sync"; id: string }
  | { v: 1; type: "ping"; id: string };

export type ApplyResult =
  | { status: "accepted"; revision: number }
  | { status: "duplicate"; revision: number }
  | {
      status: "rebase";
      baseRevision: number;
      currentRevision: number;
      message: string;
    }
  | { status: "rejected"; code: string; message: string };

export type ServerMessage =
  | {
      v: 1;
      type: "welcome";
      sessionId: string;
      pid: number;
      record: SessionRecord<unknown>;
      digest: string;
      transport: TransportState;
    }
  | {
      v: 1;
      type: "commit";
      event: SessionEvent;
      composition: unknown;
      digest: string;
    }
  | {
      v: 1;
      type: "snapshot";
      record: SessionRecord<unknown>;
      digest: string;
    }
  | ({ v: 1; type: "transport" } & TransportState)
  | { v: 1; type: "presence"; clients: PresenceEntry[] }
  | { v: 1; type: "meta"; meta: SessionMeta }
  | {
      v: 1;
      type: "claimed";
      id: string;
      trackId: string | null;
      /** True when `trackId` is a reserved draft not yet in the score. */
      draft?: boolean;
    }
  | ({ v: 1; type: "result"; id: string } & ApplyResult)
  | { v: 1; type: "pong"; id: string }
  | { v: 1; type: "error"; code: string; message: string };

export class ProtocolError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function encodeFrame(message: ClientMessage | ServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Splits a byte stream into bounded lines without unbounded buffering. */
export class LineDecoder {
  private pending = "";
  private pendingBytes = 0;

  public constructor(private readonly maxBytes: number) {}

  public push(chunk: string): string[] {
    const lines: string[] = [];
    let start = 0;
    let index = chunk.indexOf("\n");
    while (index >= 0) {
      const piece = chunk.slice(start, index);
      const bytes = this.pendingBytes + Buffer.byteLength(piece, "utf8");
      if (bytes > this.maxBytes)
        throw new ProtocolError("frame-too-large", "frame exceeds limit");
      lines.push(this.pending + piece);
      this.pending = "";
      this.pendingBytes = 0;
      start = index + 1;
      index = chunk.indexOf("\n", start);
    }
    const rest = chunk.slice(start);
    if (rest.length > 0) {
      this.pending += rest;
      this.pendingBytes += Buffer.byteLength(rest, "utf8");
      if (this.pendingBytes > this.maxBytes)
        throw new ProtocolError("frame-too-large", "frame exceeds limit");
    }
    return lines;
  }
}

export function parseClientMessage(line: string): ClientMessage {
  const value = parseObject(line);
  const type = value.type;
  if (type === "hello") {
    const pid = value.pid;
    const label = value.label;
    if (!Number.isSafeInteger(pid) || (pid as number) <= 0)
      throw new ProtocolError("invalid", "hello pid is invalid");
    if (typeof label !== "string" || label.length > MAX_KIND_LENGTH)
      throw new ProtocolError("invalid", "hello label is invalid");
    return {
      v: 1,
      type,
      pid: pid as number,
      label,
      clientId: requireId(value.clientId, "client id"),
      focusedTrackId: optionalTrackId(value.focusedTrackId),
    };
  }
  if (type === "focus")
    return {
      v: 1,
      type,
      id: requireId(value.id, "request id"),
      trackId: optionalTrackId(value.trackId),
    };
  if (type === "claim") {
    const message: ClientMessage = {
      v: 1,
      type,
      id: requireId(value.id, "request id"),
    };
    const preferred = optionalTrackId(value.preferred);
    if (preferred !== null) message.preferred = preferred;
    if (value.draft === true) message.draft = true;
    return message;
  }
  if (type === "meta") {
    const id = requireId(value.id, "request id");
    try {
      const message: ClientMessage = {
        v: 1,
        type,
        id,
        patch: parseMetaPatch(value.patch),
      };
      const expect = parseMetaExpect(value.expect);
      if (expect) message.expect = expect;
      return message;
    } catch (error) {
      if (error instanceof MetaValidationError)
        throw new ProtocolError("invalid", error.message);
      throw error;
    }
  }
  if (type === "apply") {
    const id = requireId(value.id, "request id");
    const key = requireId(value.key, "idempotency key");
    if (!Number.isSafeInteger(value.base) || (value.base as number) < 0)
      throw new ProtocolError("invalid", "base revision is invalid");
    const kind = value.kind;
    if (
      typeof kind !== "string" ||
      kind.length === 0 ||
      kind.length > MAX_KIND_LENGTH
    )
      throw new ProtocolError("invalid", "event kind is invalid");
    if (!("payload" in value) || value.payload === undefined)
      throw new ProtocolError("invalid", "event payload is missing");
    const hasOperations = value.operations !== undefined;
    const hasComposition = value.composition !== undefined;
    if (hasOperations === hasComposition)
      throw new ProtocolError(
        "invalid",
        "apply needs exactly one of operations or composition",
      );
    const message: ClientMessage = {
      v: 1,
      type,
      id,
      key,
      base: value.base as number,
      kind,
      payload: value.payload,
    };
    if (hasOperations) {
      if (
        !Array.isArray(value.operations) ||
        value.operations.length === 0 ||
        value.operations.length > MAX_OPERATIONS
      )
        throw new ProtocolError("invalid", "operations are invalid");
      message.operations = value.operations as unknown[];
    } else message.composition = value.composition;
    return message;
  }
  if (type === "transport") {
    const id = requireId(value.id, "request id");
    const action = value.action;
    if (
      action !== "play" &&
      action !== "pause" &&
      action !== "toggle" &&
      action !== "seek" &&
      action !== "tempo"
    )
      throw new ProtocolError("invalid", "transport action is invalid");
    const message: ClientMessage = { v: 1, type, id, action };
    if (action === "seek") {
      if (!isFiniteNonNegative(value.beat))
        throw new ProtocolError("invalid", "seek beat is invalid");
      message.beat = value.beat as number;
    }
    if (action === "tempo") {
      if (!isFiniteNonNegative(value.bpm) || (value.bpm as number) <= 0)
        throw new ProtocolError("invalid", "tempo bpm is invalid");
      message.bpm = value.bpm as number;
    }
    return message;
  }
  if (type === "sync" || type === "ping")
    return { v: 1, type, id: requireId(value.id, "request id") };
  throw new ProtocolError("unknown-type", "unknown message type");
}

export function parseServerMessage(line: string): ServerMessage {
  const value = parseObject(line);
  const type = value.type;
  if (type === "welcome") {
    if (typeof value.sessionId !== "string")
      throw new ProtocolError("invalid", "welcome session is invalid");
    if (!Number.isSafeInteger(value.pid))
      throw new ProtocolError("invalid", "welcome pid is invalid");
    return {
      v: 1,
      type,
      sessionId: value.sessionId,
      pid: value.pid as number,
      record: requireRecord(value.record),
      digest: requireDigest(value.digest),
      transport: requireTransport(value.transport),
    };
  }
  if (type === "commit") {
    const event = value.event;
    if (
      typeof event !== "object" ||
      event === null ||
      !Number.isSafeInteger((event as { revision?: unknown }).revision) ||
      typeof (event as { id?: unknown }).id !== "string" ||
      typeof (event as { kind?: unknown }).kind !== "string" ||
      typeof (event as { at?: unknown }).at !== "string"
    )
      throw new ProtocolError("invalid", "commit event is invalid");
    if (value.composition === undefined)
      throw new ProtocolError("invalid", "commit composition is missing");
    return {
      v: 1,
      type,
      event: event as SessionEvent,
      composition: value.composition,
      digest: requireDigest(value.digest),
    };
  }
  if (type === "snapshot")
    return {
      v: 1,
      type,
      record: requireRecord(value.record),
      digest: requireDigest(value.digest),
    };
  if (type === "transport") return { v: 1, type, ...requireTransport(value) };
  if (type === "result") {
    const id = requireId(value.id, "request id");
    const status = value.status;
    if (status === "accepted" || status === "duplicate") {
      if (!Number.isSafeInteger(value.revision))
        throw new ProtocolError("invalid", "result revision is invalid");
      return { v: 1, type, id, status, revision: value.revision as number };
    }
    if (status === "rebase") {
      if (
        !Number.isSafeInteger(value.baseRevision) ||
        !Number.isSafeInteger(value.currentRevision)
      )
        throw new ProtocolError("invalid", "rebase revisions are invalid");
      return {
        v: 1,
        type,
        id,
        status,
        baseRevision: value.baseRevision as number,
        currentRevision: value.currentRevision as number,
        message: boundedText(value.message),
      };
    }
    if (status === "rejected")
      return {
        v: 1,
        type,
        id,
        status,
        code: boundedText(value.code),
        message: boundedText(value.message),
      };
    throw new ProtocolError("invalid", "result status is invalid");
  }
  if (type === "presence") {
    if (!Array.isArray(value.clients) || value.clients.length > MAX_PRESENCE)
      throw new ProtocolError("invalid", "presence is invalid");
    return { v: 1, type, clients: value.clients.map(requirePresence) };
  }
  if (type === "meta")
    return { v: 1, type, meta: requireMeta(value.meta, undefined) };
  if (type === "claimed") {
    const message: ServerMessage = {
      v: 1,
      type,
      id: requireId(value.id, "request id"),
      trackId: optionalTrackId(value.trackId),
    };
    if (value.draft === true) message.draft = true;
    return message;
  }
  if (type === "pong")
    return { v: 1, type, id: requireId(value.id, "request id") };
  if (type === "error")
    return {
      v: 1,
      type,
      code: boundedText(value.code),
      message: boundedText(value.message),
    };
  throw new ProtocolError("unknown-type", "unknown message type");
}

/** Stable digest of a composition as stored and broadcast by trackd. */
export function compositionDigest(composition: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(composition) ?? "null")
    .digest("hex")
    .slice(0, 16);
}

/**
 * The socket lives beside the session record when the path fits in sun_path,
 * otherwise under the user's temp directory keyed by a hash of that path.
 */
export function daemonSocketPath(paths: SessionPaths): string {
  const local = paths.record.replace(/\.json$/, ".sock");
  if (Buffer.byteLength(local, "utf8") <= MAX_SOCKET_PATH_BYTES) return local;
  const hash = createHash("sha256").update(local).digest("hex").slice(0, 24);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return join(tmpdir(), `trackd-${uid}-${hash}.sock`);
}

export function daemonLockPath(paths: SessionPaths): string {
  return `${paths.record}.daemon.lock`;
}

export function daemonLogPath(paths: SessionPaths): string {
  return `${paths.record}.daemon.log`;
}

function parseObject(line: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ProtocolError("invalid-json", "frame is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ProtocolError("invalid", "frame must be an object");
  const record = value as Record<string, unknown>;
  if (record.v !== PROTOCOL_VERSION)
    throw new ProtocolError(
      "version",
      `unsupported protocol version; expected ${PROTOCOL_VERSION}`,
    );
  return record;
}

function requireId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
    throw new ProtocolError("invalid", `${label} is invalid`);
  return value;
}

/** Track ids are bounded score ids; `null`/absent means no focus. */
export function optionalTrackId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requireId(value, "track id");
}

export function requirePresence(value: unknown): PresenceEntry {
  if (typeof value !== "object" || value === null)
    throw new ProtocolError("invalid", "presence entry is invalid");
  const entry = value as Record<string, unknown>;
  if (!Number.isSafeInteger(entry.pid) || (entry.pid as number) <= 0)
    throw new ProtocolError("invalid", "presence pid is invalid");
  return {
    clientId: requireId(entry.clientId, "client id"),
    pid: entry.pid as number,
    label: boundedText(entry.label).slice(0, MAX_KIND_LENGTH),
    focusedTrackId: optionalTrackId(entry.focusedTrackId),
  };
}

/**
 * Atomic claim rule shared by trackd and the file fallback: the preferred
 * track when it exists and is free, otherwise the first free track in score
 * order, otherwise none. `taken` excludes the claimant's own entry.
 */
export function chooseTrack(
  trackIds: readonly string[],
  taken: ReadonlySet<string>,
  preferred?: string,
): string | null {
  if (preferred && trackIds.includes(preferred) && !taken.has(preferred))
    return preferred;
  return trackIds.find((id) => !taken.has(id)) ?? null;
}

/**
 * Claim with draft fallback: the first unfocused track in score order, else
 * a fresh `track-N` id that is neither in the score nor focused by another
 * window (so two late windows reserve different drafts).
 */
export function claimOrDraft(
  trackIds: readonly string[],
  taken: ReadonlySet<string>,
  preferred?: string,
): { trackId: string; draft: boolean } {
  const trackId = chooseTrack(trackIds, taken, preferred);
  if (trackId !== null) return { trackId, draft: false };
  return { trackId: draftTrackId(trackIds, taken), draft: true };
}

export function draftTrackId(
  trackIds: readonly string[],
  taken: ReadonlySet<string>,
): string {
  const used = new Set([...trackIds, ...taken]);
  for (let n = trackIds.length + 1; ; n += 1) {
    const id = `track-${n}`;
    if (!used.has(id)) return id;
  }
}

function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{1,64}$/.test(value))
    throw new ProtocolError("invalid", "digest is invalid");
  return value;
}

function requireRecord(value: unknown): SessionRecord<unknown> {
  if (typeof value !== "object" || value === null)
    throw new ProtocolError("invalid", "record is invalid");
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionId !== "string" ||
    !Number.isSafeInteger(record.revision) ||
    typeof record.updatedAt !== "string" ||
    !Array.isArray(record.events) ||
    record.events.length !== record.revision ||
    record.composition === undefined
  )
    throw new ProtocolError("invalid", "record is invalid");
  return {
    ...(record as unknown as SessionRecord<unknown>),
    meta: requireMeta(record.meta, {
      sessionId: record.sessionId,
      updatedAt: record.updatedAt,
    }),
  };
}

function requireMeta(
  value: unknown,
  fallback: { sessionId: string; updatedAt: string } | undefined,
): SessionMeta {
  if (fallback === undefined && (value === undefined || value === null))
    throw new ProtocolError("invalid", "meta is missing");
  try {
    return parseSessionMeta(
      value,
      fallback ?? { sessionId: "unknown", updatedAt: "" },
    );
  } catch (error) {
    if (error instanceof MetaValidationError)
      throw new ProtocolError("invalid", error.message);
    throw error;
  }
}

function requireTransport(value: unknown): TransportState {
  if (typeof value !== "object" || value === null)
    throw new ProtocolError("invalid", "transport is invalid");
  const state = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(state.seq) ||
    typeof state.playing !== "boolean" ||
    !isFiniteNonNegative(state.beat) ||
    !isFiniteNonNegative(state.bpm) ||
    (state.bpm as number) <= 0 ||
    !isFiniteNonNegative(state.atMs)
  )
    throw new ProtocolError("invalid", "transport is invalid");
  return {
    seq: state.seq as number,
    playing: state.playing,
    beat: state.beat as number,
    bpm: state.bpm as number,
    atMs: state.atMs as number,
  };
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 512) : "";
}

/** Epoch-anchored monotonic milliseconds, comparable across local processes. */
export function monotonicEpochMs(): number {
  return performance.timeOrigin + performance.now();
}
