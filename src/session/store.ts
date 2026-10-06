import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS = 2_000;

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
    return id.length > 0 ? id : undefined;
  } catch {
    return undefined;
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
  const sessionId =
    options.sessionId ??
    (await readCurrentSessionId(workspace)) ??
    randomUUID();
  const paths = sessionPaths(workspace, sessionId);
  await mkdir(dirname(paths.record), { recursive: true });
  await mkdir(paths.root, { recursive: true });
  if (options.setCurrent !== false)
    await writeFile(paths.pointer, `${sessionId}\n`, "utf8");
  try {
    return {
      paths,
      record: JSON.parse(
        await readFile(paths.record, "utf8"),
      ) as SessionRecord<T>,
    };
  } catch {
    const record: SessionRecord<T> = {
      sessionId,
      revision: 0,
      updatedAt: new Date().toISOString(),
      composition: initial,
      events: [],
    };
    await writeAtomic(paths.record, JSON.stringify(record, null, 2));
    return { paths, record };
  }
}

export async function appendSessionEvent<T>(
  paths: SessionPaths,
  current: SessionRecord<T>,
  event: Omit<SessionEvent, "id" | "revision" | "at">,
  composition: T,
): Promise<SessionRecord<T>> {
  const payloadBytes = Buffer.byteLength(JSON.stringify(event.payload), "utf8");
  if (payloadBytes > MAX_EVENT_BYTES)
    throw new Error(`session event exceeds ${MAX_EVENT_BYTES} bytes`);
  await acquireLock(paths.lock);
  try {
    const disk = JSON.parse(
      await readFile(paths.record, "utf8"),
    ) as SessionRecord<T>;
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
      events: [...disk.events, { ...event, id: randomUUID(), revision, at }],
    };
    await writeAtomic(paths.record, JSON.stringify(next, null, 2));
    return next;
  } finally {
    await rm(paths.lock, { recursive: true, force: true });
  }
}

export async function loadSession<T>(
  paths: SessionPaths,
): Promise<SessionRecord<T>> {
  return JSON.parse(await readFile(paths.record, "utf8")) as SessionRecord<T>;
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${contents}\n`, "utf8");
  await rename(temporary, path);
}

async function acquireLock(path: string, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await mkdir(path);
      await writeFile(join(path, "owner"), `${process.pid}\n`, "utf8");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const details = await stat(path);
        if (Date.now() - details.mtimeMs > 10_000)
          await rm(path, { recursive: true, force: true });
      } catch {
        /* another writer released it */
      }
      if (Date.now() - started >= timeoutMs)
        throw new Error("timed out waiting for the Track session lock");
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
}
