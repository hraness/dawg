import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireSessionLock } from "./lock.ts";

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS = 2_000;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_SESSION_ID_LENGTH = 64;
const MAX_EVENT_KIND_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 64;

export class SessionValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SessionValidationError";
  }
}

export type SessionEvent = {
  id: string;
  revision: number;
  kind: string;
  payload: unknown;
  at: string;
};

export type SessionRecord<T> = {
  sessionId: string;
  revision: number;
  updatedAt: string;
  composition: T;
  events: SessionEvent[];
};

export type SessionPaths = {
  root: string;
  pointer: string;
  record: string;
  lock: string;
};

export class SessionConflictError extends Error {
  public constructor() {
    super(
      "session changed in another Track window; retry against the latest revision",
    );
    this.name = "SessionConflictError";
  }
}

export function sessionPaths(
  workspace = process.cwd(),
  sessionId: string,
): SessionPaths {
  assertSessionId(sessionId);
  const root = join(workspace, ".track");
  return {
    root,
    pointer: join(root, "session"),
    record: join(root, "sessions", `${sessionId}.json`),
    lock: join(root, "sessions", `${sessionId}.lock`),
  };
}

export async function readCurrentSessionId(
  workspace = process.cwd(),
): Promise<string | undefined> {
  try {
    const id = (
      await readFile(join(workspace, ".track", "session"), "utf8")
    ).trim();
    if (id.length === 0) return undefined;
    assertSessionId(id);
    return id;
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function ensureSession<T>(
  initial: T,
  options: {
    workspace?: string;
    sessionId?: string;
    setCurrent?: boolean;
  } = {},
): Promise<{ paths: SessionPaths; record: SessionRecord<T> }> {
  const workspace = options.workspace ?? process.cwd();
  const root = join(workspace, ".track");
  await mkdir(root, { recursive: true });
  // Serialize pointer selection and first-record creation. Without this,
  // two windows launched together can each choose a different random session
  // and race to overwrite `.track/session`.
  const initLock = join(root, ".init.lock");
  const release = await acquireSessionLock(initLock);
  try {
    const sessionId =
      options.sessionId ??
      (await readCurrentSessionId(workspace)) ??
      randomUUID();
    const paths = sessionPaths(workspace, sessionId);
    await mkdir(dirname(paths.record), { recursive: true });
    const existing = await readRecordIfPresent<T>(paths.record);
    if (existing) {
      if (options.setCurrent !== false)
        await writeAtomic(paths.pointer, `${sessionId}`);
      return { paths, record: existing };
    }
    if (options.setCurrent !== false)
      await writeAtomic(paths.pointer, `${sessionId}`);
    try {
      const record: SessionRecord<T> = {
        sessionId,
        revision: 0,
        updatedAt: new Date().toISOString(),
        composition: initial,
        events: [],
      };
      const validated = validateSessionRecord<T>(record);
      await writeAtomic(paths.record, JSON.stringify(validated, null, 2));
      return { paths, record: validated };
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
      // A concurrent external creator can win only if it does not use the
      // init lock. Read it and validate rather than replacing its record.
      const record = await readRecordIfPresent<T>(paths.record);
      if (!record) throw error;
      return { paths, record };
    }
  } finally {
    await release();
  }
}

export async function appendSessionEvent<T>(
  paths: SessionPaths,
  current: SessionRecord<T>,
  event: Omit<SessionEvent, "id" | "revision" | "at"> & { id?: string },
  composition: T,
): Promise<SessionRecord<T>> {
  // trackd passes the client's idempotency key as the durable event id so a
  // retried intent stays a no-op across daemon restarts.
  if (event.id !== undefined) assertSessionId(event.id);
  const payloadJson = stringifyJson(event.payload, "session event payload");
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (payloadBytes > MAX_EVENT_BYTES)
    throw new Error(`session event exceeds ${MAX_EVENT_BYTES} bytes`);
  if (
    typeof event.kind !== "string" ||
    event.kind.length === 0 ||
    event.kind.length > MAX_EVENT_KIND_LENGTH
  )
    throw new SessionValidationError("session event kind is invalid");
  const release = await acquireSessionLock(paths.lock);
  try {
    const disk = await readRecord<T>(paths.record);
    if (disk.revision !== current.revision) throw new SessionConflictError();
    // Re-check the bounded event budget against the locked record. A stale
    // caller can pass the pre-lock check while another writer fills the log.
    if (disk.events.length >= MAX_EVENTS)
      throw new Error(`session event limit ${MAX_EVENTS} reached`);
    const revision = disk.revision + 1;
    const at = new Date().toISOString();
    const next: SessionRecord<T> = {
      sessionId: disk.sessionId,
      revision,
      updatedAt: at,
      composition,
      events: [
        ...disk.events,
        {
          kind: event.kind,
          payload: event.payload,
          id: event.id ?? randomUUID(),
          revision,
          at,
        },
      ],
    };
    const validated = validateSessionRecord<T>(next);
    await writeAtomic(paths.record, JSON.stringify(validated, null, 2));
    return validated;
  } finally {
    await release();
  }
}

export async function loadSession<T>(
  paths: SessionPaths,
): Promise<SessionRecord<T>> {
  return readRecord<T>(paths.record);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  if (Buffer.byteLength(contents, "utf8") > MAX_RECORD_BYTES)
    throw new SessionValidationError(
      `session record exceeds ${MAX_RECORD_BYTES} bytes`,
    );
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${contents}\n`, "utf8");
  await rename(temporary, path);
}

async function readRecord<T>(path: string): Promise<SessionRecord<T>> {
  const contents = await readFile(path, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_RECORD_BYTES)
    throw new SessionValidationError(
      `session record exceeds ${MAX_RECORD_BYTES} bytes`,
    );
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new SessionValidationError("session record contains invalid JSON");
  }
  return validateSessionRecord<T>(value);
}

async function readRecordIfPresent<T>(
  path: string,
): Promise<SessionRecord<T> | undefined> {
  try {
    return await readRecord<T>(path);
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function validateSessionRecord<T>(value: unknown): SessionRecord<T> {
  if (typeof value !== "object" || value === null)
    throw new SessionValidationError("session record must be an object");
  const record = value as Record<string, unknown>;
  assertSessionId(record.sessionId);
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0)
    throw new SessionValidationError("session revision must be a safe integer");
  if (
    typeof record.updatedAt !== "string" ||
    record.updatedAt.length === 0 ||
    record.updatedAt.length > MAX_TIMESTAMP_LENGTH
  )
    throw new SessionValidationError("session updatedAt is invalid");
  if (!Array.isArray(record.events) || record.events.length > MAX_EVENTS)
    throw new SessionValidationError(
      `session has more than ${MAX_EVENTS} events`,
    );
  if (record.revision !== record.events.length)
    throw new SessionValidationError(
      "session revision does not match its event log",
    );
  if (!("composition" in record))
    throw new SessionValidationError("session composition is missing");
  if (record.composition === undefined)
    throw new SessionValidationError("session composition is not JSON data");
  const events = record.events.map((event, index) => {
    if (typeof event !== "object" || event === null)
      throw new SessionValidationError("session event must be an object");
    const candidate = event as Record<string, unknown>;
    assertSessionId(candidate.id);
    if (
      !Number.isSafeInteger(candidate.revision) ||
      candidate.revision !== index + 1
    )
      throw new SessionValidationError("session event revisions are invalid");
    if (
      typeof candidate.kind !== "string" ||
      candidate.kind.length === 0 ||
      candidate.kind.length > MAX_EVENT_KIND_LENGTH
    )
      throw new SessionValidationError("session event kind is invalid");
    if (
      typeof candidate.at !== "string" ||
      candidate.at.length > MAX_TIMESTAMP_LENGTH
    )
      throw new SessionValidationError("session event timestamp is invalid");
    const payloadJson = stringifyJson(
      candidate.payload,
      "session event payload",
    );
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_EVENT_BYTES)
      throw new SessionValidationError(
        `session event exceeds ${MAX_EVENT_BYTES} bytes`,
      );
    return candidate as unknown as SessionEvent;
  });
  return {
    sessionId: record.sessionId,
    revision: record.revision as number,
    updatedAt: record.updatedAt,
    composition: record.composition as T,
    events,
  };
}

export function assertSessionId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SESSION_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new SessionValidationError(
      "session id contains unsafe path characters",
    );
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function stringifyJson(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new SessionValidationError(`${label} must be JSON data`);
    return encoded;
  } catch (error) {
    if (error instanceof SessionValidationError) throw error;
    throw new SessionValidationError(`${label} must be JSON data`);
  }
}
