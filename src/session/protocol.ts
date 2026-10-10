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

/** Same shape as src/identity/actor.ts ACTOR_ID; kept here to stay leaf. */
const ACTOR_ID = /^a_[a-z2-7]{22}$/;

/**
 * dawgd wire protocol: newline-delimited JSON over a Unix domain socket.
 * Every frame carries `v`; every inbound frame is parsed from `unknown` and
 * bounded before it can reach the reducer, the store, or the transport.
 */
export const PROTOCOL_VERSION = 1 as const;
/**
 * Negotiated protocol revisions. Frames keep `v: 1` (the framing); `hello`
 * offers `{vMin, vMax, caps}` and `welcome` answers with the chosen revision
 * and the daemon's capabilities. A v1-only client sends neither and gets the
 * original behaviour. Revision 2 adds actors, per-client `seq`, ops on
 * events and transport `quantum`.
 */
export const PROTOCOL_MIN = 1;
export const PROTOCOL_MAX = 2;
/** What this build's dawgd offers in `welcome.caps`. */
export const DAEMON_CAPS = [
  "actor",
  "seq",
  "ops-log",
  "quantum",
  "opaque-kinds",
  "panes",
  "live",
] as const;
const MAX_CAPS = 32;
const MAX_CAP_LENGTH = 32;
/** Default musical cycle when a transport frame predates `quantum`. */
export const DEFAULT_QUANTUM = 4;
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
  /**
   * When `beat` held, on the *authority's host clock*: dawgd's monotonic
   * clock expressed on the epoch (timeOrigin + now). On one machine every
   * process shares it; a remote reader must convert with its per-client
   * offset (`SessionPort` applies `clockOffsetMs`, 0 locally) before use.
   */
  atMs: number;
  /** Beats per phase cycle (bar or loop), Link-style; defaults to 4. */
  quantum: number;
};

/** One live window. dawgd drops the entry when the client disconnects. */
export type PresenceEntry = {
  clientId: string;
  /** Who is at this window (src/identity/actor.ts); absent for v1 clients. */
  actorId?: string;
  /** Machine-local process id: display only, never identity. */
  pid: number;
  label: string;
  focusedTrackId: string | null;
  /**
   * Pane letter (A, B, C in join order, reused when freed), assigned by
   * dawgd. Display only: identity and per-pane undo key on `clientId`.
   */
  pane?: string;
  /** What the pane shows (see `PaneView`); absent until it reports. */
  screen?: string;
  /** The drawer parameter or page the pane has open. */
  param?: string;
  /** Recording a pass on `focusedTrackId`, and in which mode. */
  recording?: "overdub" | "replace";
  /** In PLAY (live keys) on `focusedTrackId`. */
  playing?: boolean;
  /** Locked to its screen and track (`pin`). */
  pinned?: boolean;
  /** Follows another pane's focus: its letter, or `*` for the latest. */
  follow?: string;
};

/** The per-pane view fields a client reports with `view`. */
export type PaneView = Pick<
  PresenceEntry,
  "screen" | "param" | "recording" | "playing" | "pinned" | "follow"
>;

/** A live click: on while any pane wants it; count-in from the last arm. */
export type LiveClick = {
  on: boolean;
  volume: number;
  /** A count-in before the transport starts, on the authority's clock. */
  countIn?: {
    startAtMs: number;
    startBeat: number;
    beats: number;
    barBeats: number;
    clickBeats: number;
    bpm: number;
  };
};

/**
 * Live notes go to the one engine on this machine. A window never sends
 * audio: dawgd renders the voice from the score it already holds.
 */
export type LiveMessage =
  | { v: 1; type: "live"; action: "monitor"; id: string; on: boolean }
  | {
      v: 1;
      type: "live";
      action: "on";
      /** Window-local voice id; dawgd namespaces it by client. */
      voice: number;
      trackId: string;
      pitch: number;
      /** 0..1, as score notes store it. */
      velocity: number;
      /** How long the key is held (or the longest live note). */
      seconds: number;
      /** Transport beat of the press, unwrapped. */
      beat: number;
      /** When pressed, on the authority's clock (local clock + offset). */
      atMs: number;
    }
  | { v: 1; type: "live"; action: "off"; voice: number; atMs: number }
  | ({ v: 1; type: "live"; action: "click" } & LiveClick);

/** dawgd's answer to `live monitor`: how the shared engine sounds. */
export type LiveStatus = {
  canMonitor: boolean;
  sampleRate: number;
  leadMs: number;
  note?: string;
};

export type ClientMessage =
  | {
      v: 1;
      type: "hello";
      pid: number;
      label: string;
      clientId: string;
      focusedTrackId: string | null;
      /** Protocol revisions this client speaks; absent means 1..1. */
      vMin?: number;
      vMax?: number;
      caps?: string[];
      actorId?: string;
      actorName?: string;
    }
  | { v: 1; type: "focus"; id: string; trackId: string | null }
  /** `draft` asks dawgd to reserve a new `track-N` id when all are open. */
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
      /**
       * Per-(actor, client) sequence number, strictly increasing per intent
       * and reused on retry: dawgd dedupes on (actorId, clientId, seq) across
       * restarts, the same way it dedupes on `key`.
       */
      seq?: number;
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
  | { v: 1; type: "ping"; id: string }
  /** Updates this pane's presence view fields; no reply. */
  | ({ v: 1; type: "view" } & PaneView)
  | LiveMessage;

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
      /** Negotiated revision; absent from a v1-only daemon. */
      protocol?: number;
      caps?: string[];
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
  | ({ v: 1; type: "liveStatus"; id: string } & LiveStatus)
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
    const message: ClientMessage = {
      v: 1,
      type,
      pid: pid as number,
      label,
      clientId: requireId(value.clientId, "client id"),
      focusedTrackId: optionalTrackId(value.focusedTrackId),
    };
    if (value.vMin !== undefined || value.vMax !== undefined) {
      const vMin = value.vMin ?? 1;
      const vMax = value.vMax ?? vMin;
      if (
        !Number.isSafeInteger(vMin) ||
        !Number.isSafeInteger(vMax) ||
        (vMin as number) < 1 ||
        (vMax as number) < (vMin as number)
      )
        throw new ProtocolError("invalid", "hello versions are invalid");
      message.vMin = vMin as number;
      message.vMax = vMax as number;
    }
    if (value.caps !== undefined) message.caps = requireCaps(value.caps);
    if (value.actorId !== undefined) {
      if (typeof value.actorId !== "string" || !ACTOR_ID.test(value.actorId))
        throw new ProtocolError("invalid", "hello actor is invalid");
      message.actorId = value.actorId;
    }
    if (value.actorName !== undefined) {
      if (typeof value.actorName !== "string")
        throw new ProtocolError("invalid", "hello actor name is invalid");
      message.actorName = value.actorName.slice(0, MAX_ID_LENGTH);
    }
    return message;
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
    if (value.seq !== undefined) {
      if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 1)
        throw new ProtocolError("invalid", "apply seq is invalid");
      message.seq = value.seq as number;
    }
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
  if (type === "view") return { v: 1, type, ...parsePaneView(value) };
  if (type === "live") return parseLive(value);
  throw new ProtocolError("unknown-type", "unknown message type");
}

const SCREEN = /^[a-z][a-z0-9-]{0,31}$/;
const PANE_LETTER = /^[A-Z]$/;

/** The view fields of a `view` frame or a presence entry; junk is dropped. */
export function parsePaneView(value: Record<string, unknown>): PaneView {
  const view: PaneView = {};
  if (typeof value.screen === "string" && SCREEN.test(value.screen))
    view.screen = value.screen;
  if (typeof value.param === "string" && value.param.length > 0)
    view.param = value.param.slice(0, MAX_ID_LENGTH);
  if (value.recording === "overdub" || value.recording === "replace")
    view.recording = value.recording;
  if (value.playing === true) view.playing = true;
  if (value.pinned === true) view.pinned = true;
  if (
    typeof value.follow === "string" &&
    (value.follow === "*" || PANE_LETTER.test(value.follow))
  )
    view.follow = value.follow;
  return view;
}

function parseLive(value: Record<string, unknown>): LiveMessage {
  const action = value.action;
  if (action === "monitor") {
    if (typeof value.on !== "boolean")
      throw new ProtocolError("invalid", "live monitor is invalid");
    return {
      v: 1,
      type: "live",
      action,
      id: requireId(value.id, "request id"),
      on: value.on,
    };
  }
  if (action === "on") {
    const voice = value.voice;
    const pitch = value.pitch;
    if (
      !Number.isSafeInteger(voice) ||
      !Number.isSafeInteger(pitch) ||
      (pitch as number) < 0 ||
      (pitch as number) > 127 ||
      !isFiniteNonNegative(value.velocity) ||
      (value.velocity as number) > 1 ||
      !isFiniteNonNegative(value.seconds) ||
      (value.seconds as number) > 600 ||
      !Number.isFinite(value.beat) ||
      !isFiniteNonNegative(value.atMs)
    )
      throw new ProtocolError("invalid", "live note is invalid");
    return {
      v: 1,
      type: "live",
      action,
      voice: voice as number,
      trackId: requireId(value.trackId, "track id"),
      pitch: pitch as number,
      velocity: value.velocity as number,
      seconds: value.seconds as number,
      beat: value.beat as number,
      atMs: value.atMs as number,
    };
  }
  if (action === "off") {
    if (!Number.isSafeInteger(value.voice) || !isFiniteNonNegative(value.atMs))
      throw new ProtocolError("invalid", "live note-off is invalid");
    return {
      v: 1,
      type: "live",
      action,
      voice: value.voice as number,
      atMs: value.atMs as number,
    };
  }
  if (action === "click") {
    if (
      typeof value.on !== "boolean" ||
      !isFiniteNonNegative(value.volume) ||
      (value.volume as number) > 1
    )
      throw new ProtocolError("invalid", "live click is invalid");
    const message: LiveMessage = {
      v: 1,
      type: "live",
      action,
      on: value.on,
      volume: value.volume as number,
    };
    const count = value.countIn as Record<string, unknown> | undefined;
    if (count !== undefined) {
      if (
        typeof count !== "object" ||
        count === null ||
        !isFiniteNonNegative(count.startAtMs) ||
        !Number.isFinite(count.startBeat) ||
        !isFiniteNonNegative(count.beats) ||
        !isFiniteNonNegative(count.barBeats) ||
        !isFiniteNonNegative(count.clickBeats) ||
        !isFiniteNonNegative(count.bpm) ||
        (count.bpm as number) <= 0 ||
        (count.beats as number) > 64
      )
        throw new ProtocolError("invalid", "live count-in is invalid");
      message.countIn = {
        startAtMs: count.startAtMs as number,
        startBeat: count.startBeat as number,
        beats: count.beats as number,
        barBeats: count.barBeats as number,
        clickBeats: count.clickBeats as number,
        bpm: count.bpm as number,
      };
    }
    return message;
  }
  throw new ProtocolError("invalid", "live action is invalid");
}

export function parseServerMessage(line: string): ServerMessage {
  const value = parseObject(line);
  const type = value.type;
  if (type === "welcome") {
    if (typeof value.sessionId !== "string")
      throw new ProtocolError("invalid", "welcome session is invalid");
    if (!Number.isSafeInteger(value.pid))
      throw new ProtocolError("invalid", "welcome pid is invalid");
    const message: ServerMessage = {
      v: 1,
      type,
      sessionId: value.sessionId,
      pid: value.pid as number,
      record: requireRecord(value.record),
      digest: requireDigest(value.digest),
      transport: requireTransport(value.transport),
    };
    if (value.protocol !== undefined) {
      if (
        !Number.isSafeInteger(value.protocol) ||
        (value.protocol as number) < 1
      )
        throw new ProtocolError("invalid", "welcome protocol is invalid");
      message.protocol = value.protocol as number;
    }
    if (value.caps !== undefined) message.caps = requireCaps(value.caps);
    return message;
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
  if (type === "liveStatus") {
    if (
      typeof value.canMonitor !== "boolean" ||
      !isFiniteNonNegative(value.sampleRate) ||
      !isFiniteNonNegative(value.leadMs)
    )
      throw new ProtocolError("invalid", "live status is invalid");
    const message: ServerMessage = {
      v: 1,
      type,
      id: requireId(value.id, "request id"),
      canMonitor: value.canMonitor,
      sampleRate: value.sampleRate as number,
      leadMs: value.leadMs as number,
    };
    if (typeof value.note === "string") message.note = boundedText(value.note);
    return message;
  }
  if (type === "error")
    return {
      v: 1,
      type,
      code: boundedText(value.code),
      message: boundedText(value.message),
    };
  throw new ProtocolError("unknown-type", "unknown message type");
}

/** Stable digest of a composition as stored and broadcast by dawgd. */
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
  return join(tmpdir(), `dawgd-${uid}-${hash}.sock`);
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
  const parsed: PresenceEntry = {
    clientId: requireId(entry.clientId, "client id"),
    pid: entry.pid as number,
    label: boundedText(entry.label).slice(0, MAX_KIND_LENGTH),
    focusedTrackId: optionalTrackId(entry.focusedTrackId),
  };
  if (typeof entry.actorId === "string" && ACTOR_ID.test(entry.actorId))
    parsed.actorId = entry.actorId;
  if (typeof entry.pane === "string" && PANE_LETTER.test(entry.pane))
    parsed.pane = entry.pane;
  return { ...parsed, ...parsePaneView(entry) };
}

/**
 * Capability names: short tokens. Unknown names are kept (a peer may know
 * more than we do); callers test membership only.
 */
function requireCaps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CAPS)
    throw new ProtocolError("invalid", "caps are invalid");
  return value.map((cap) => {
    if (
      typeof cap !== "string" ||
      cap.length === 0 ||
      cap.length > MAX_CAP_LENGTH ||
      !/^[a-z0-9][a-z0-9.-]*$/.test(cap)
    )
      throw new ProtocolError("invalid", "caps are invalid");
    return cap;
  });
}

/**
 * The revision both sides speak: the highest in the overlap of
 * [vMin, vMax] and [PROTOCOL_MIN, PROTOCOL_MAX], or undefined when none.
 */
export function negotiateProtocol(vMin = 1, vMax = vMin): number | undefined {
  const high = Math.min(vMax, PROTOCOL_MAX);
  return high >= Math.max(vMin, PROTOCOL_MIN) ? high : undefined;
}

/**
 * Atomic claim rule shared by dawgd and the file fallback: the preferred
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
    (record.folded !== undefined &&
      (!Number.isSafeInteger(record.folded) ||
        (record.folded as number) < 1)) ||
    record.events.length + ((record.folded as number | undefined) ?? 0) !==
      record.revision ||
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
    !isFiniteNonNegative(state.atMs) ||
    (state.quantum !== undefined &&
      (!isFiniteNonNegative(state.quantum) || (state.quantum as number) <= 0))
  )
    throw new ProtocolError("invalid", "transport is invalid");
  return {
    seq: state.seq as number,
    playing: state.playing,
    beat: state.beat as number,
    bpm: state.bpm as number,
    atMs: state.atMs as number,
    quantum: (state.quantum as number | undefined) ?? DEFAULT_QUANTUM,
  };
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 512) : "";
}

/**
 * Rebases a transport anchor from the authority's host clock to this
 * client's. `offsetMs` is (authority clock - local clock): 0 for every
 * process on one machine, measured by a future relay for remote peers.
 */
export function toLocalTransport(
  state: TransportState,
  offsetMs: number,
): TransportState {
  if (offsetMs === 0) return state;
  return { ...state, atMs: Math.max(0, state.atMs - offsetMs) };
}

/** Epoch-anchored monotonic milliseconds, comparable across local processes. */
export function monotonicEpochMs(): number {
  return performance.timeOrigin + performance.now();
}
