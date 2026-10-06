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
      });
    } catch (error) {
      summaries.push({
        sessionId,
        revision: -1,
        updatedAt: "",
        current: sessionId === current,
        daemonPid,
        tracks: null,
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
    out.write(`${marker} ${session.sessionId}  ${detail}${daemon}\n`);
  }
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
