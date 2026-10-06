import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCurrentSessionId, sessionPaths, loadSession } from "./store.ts";
import { daemonLockPath } from "./protocol.ts";

export type SessionSummary = {
  sessionId: string;
  revision: number;
  updatedAt: string;
  current: boolean;
  daemonPid: number | null;
  tracks: number | null;
  name: string;
  nameSource: "auto" | "user";
  forkOf?: { sessionId: string; revision: number };
  error?: string;
};

/** Lists sessions under `<workspace>/.track/sessions`, newest first. */
export async function listSessions(
  workspace: string,
): Promise<SessionSummary[]> {
  let names: string[];
  try {
    names = await readdir(join(workspace, ".track", "sessions"));
  } catch {
    return [];
  }
  const current = await readCurrentSessionId(workspace).catch(() => undefined);
  const summaries: SessionSummary[] = [];
  for (const name of names
    .filter((entry) => entry.endsWith(".json"))
    .slice(0, 512)) {
    const sessionId = name.slice(0, -".json".length);
    let paths;
    try {
      paths = sessionPaths(workspace, sessionId);
    } catch {
      continue;
    }
    const daemonPid = await liveDaemonPid(daemonLockPath(paths));
    try {
      const record = await loadSession<{ tracks?: unknown }>(paths);
      summaries.push({
        sessionId,
        revision: record.revision,
        updatedAt: record.updatedAt,
        current: sessionId === current,
        daemonPid,
        tracks: Array.isArray(record.composition?.tracks)
          ? record.composition.tracks.length
          : null,
        name: record.meta.name,
        nameSource: record.meta.nameSource,
        ...(record.meta.forkOf ? { forkOf: record.meta.forkOf } : {}),
      });
    } catch (error) {
      summaries.push({
        sessionId,
        revision: -1,
        updatedAt: "",
        current: sessionId === current,
        daemonPid,
        tracks: null,
        name: "",
        nameSource: "auto",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function printSessions(
  workspace: string,
  out: { write(text: string): unknown },
): Promise<void> {
  const sessions = await listSessions(workspace);
  if (sessions.length === 0) {
    out.write("no sessions in .track (run `track` to create one)\n");
    return;
  }
  for (const session of sessions) {
    const marker = session.current ? "*" : " ";
    const detail = session.error
      ? `unreadable · ${session.error}`
      : `rev ${session.revision} · ${session.tracks ?? "?"} tracks · updated ${session.updatedAt}`;
    const daemon = session.daemonPid
      ? ` · trackd pid ${session.daemonPid}`
      : "";
    out.write(`${marker} ${formatSessionLine(session, sessions)}${daemon}\n`);
  }
}

/** One `/sessions` row: name, short id, tracks, revision, age, fork parent. */
export function formatSessionLine(
  session: SessionSummary,
  all: readonly SessionSummary[] = [],
  now = Date.now(),
): string {
  const id = session.sessionId.slice(0, 8);
  if (session.error) return `${id}  unreadable · ${session.error}`;
  const parent = session.forkOf
    ? all.find((entry) => entry.sessionId === session.forkOf!.sessionId)
    : undefined;
  const fork = session.forkOf
    ? ` · fork of ${parent?.name || session.forkOf.sessionId.slice(0, 8)}@${session.forkOf.revision}`
    : "";
  return `${session.name.padEnd(24)} ${id}  ${session.tracks ?? "?"} tracks · rev ${session.revision} · ${relativeTime(session.updatedAt, now)}${fork}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export type SessionResolution =
  | { status: "found"; session: SessionSummary }
  | { status: "missing" }
  | { status: "ambiguous"; candidates: SessionSummary[] };

/**
 * Resolves `--session <name|id>`: an exact id, then an exact name
 * (case-insensitive), then a unique id prefix of at least 4 characters.
 */
export function resolveSession(
  sessions: readonly SessionSummary[],
  query: string,
): SessionResolution {
  const readable = sessions.filter((session) => !session.error);
  const byId = readable.find((session) => session.sessionId === query);
  if (byId) return { status: "found", session: byId };
  const lower = query.trim().toLowerCase();
  const byName = readable.filter(
    (session) => session.name.toLowerCase() === lower,
  );
  if (byName.length === 1) return { status: "found", session: byName[0]! };
  if (byName.length > 1) return { status: "ambiguous", candidates: byName };
  if (query.length >= 4) {
    const byPrefix = readable.filter((session) =>
      session.sessionId.startsWith(query),
    );
    if (byPrefix.length === 1)
      return { status: "found", session: byPrefix[0]! };
    if (byPrefix.length > 1)
      return { status: "ambiguous", candidates: byPrefix };
  }
  return { status: "missing" };
}

export function ambiguousSessionMessage(
  query: string,
  candidates: readonly SessionSummary[],
): string {
  return [
    `session "${query}" is ambiguous; use an id:`,
    ...candidates.map((session) => `  ${formatSessionLine(session)}`),
  ].join("\n");
}

async function liveDaemonPid(lockPath: string): Promise<number | null> {
  try {
    const text = await readFile(join(lockPath, "owner"), "utf8");
    if (text.length > 256) return null;
    const pid = (JSON.parse(text) as { pid?: unknown }).pid;
    if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return null;
    process.kill(pid as number, 0);
    return pid as number;
  } catch {
    return null;
  }
}
