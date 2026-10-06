import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import { DaemonClient } from "./client.ts";
import { FilePresence } from "./presence.ts";
import { daemonLockPath, daemonSocketPath } from "./protocol.ts";
import { ensureSession, loadSession, type SessionPaths } from "./store.ts";

const WORKER = join(import.meta.dir, "fixtures", "client-worker.ts");
const DAEMON_ARGS = ["--grace-ms", "300"];
const clients: DaemonClient[] = [];
const workspaces: string[] = [];

async function session(tracks = ["main"]) {
  const workspace = await mkdtemp(join(tmpdir(), "trackd-"));
  workspaces.push(workspace);
  const initial = createScore({
    tracks: tracks.map((id) => ({ id, name: id, instrument: "sine" })),
  });
  const { paths, record } = await ensureSession(initial.toJSON(), {
    workspace,
  });
  return { workspace, paths, sessionId: record.sessionId };
}

async function client(workspace: string, sessionId: string, label = "test") {
  const connected = await DaemonClient.connect({
    workspace,
    sessionId,
    label,
    daemonArgs: DAEMON_ARGS,
  });
  clients.push(connected);
  return connected;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean | Promise<boolean>, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

async function daemonPid(paths: SessionPaths): Promise<number | undefined> {
  try {
    const owner = JSON.parse(
      await readFile(join(daemonLockPath(paths), "owner"), "utf8"),
    ) as { pid: number };
    return owner.pid;
  } catch {
    return undefined;
  }
}

function addNote(id: string, startTick = 0) {
  return {
    type: "addNote",
    note: {
      id,
      trackId: "main",
      startTick,
      durationTicks: 120,
      pitch: 60,
      velocity: 0.8,
    },
  };
}

afterEach(async () => {
  for (const connected of clients.splice(0)) connected.close();
  for (const workspace of workspaces.splice(0)) {
    // Never leave a daemon behind, even when a test fails midway.
    const sessions = join(workspace, ".track", "sessions");
    const glob = new Bun.Glob("*.daemon.lock/owner");
    for await (const owner of glob.scan(sessions)) {
      try {
        const pid = (
          JSON.parse(await readFile(join(sessions, owner), "utf8")) as {
            pid: number;
          }
        ).pid;
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

describe("trackd", () => {
  test("two client processes converge on one revision and digest", async () => {
    const { workspace, paths, sessionId } = await session();
    const spawnWorker = (prefix: string) =>
      Bun.spawn([process.execPath, WORKER, workspace, sessionId, prefix, "8"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
    const workers = [spawnWorker("left"), spawnWorker("right")];
    const readers = workers.map((worker) =>
      worker.stdout.pipeThrough(new TextDecoderStream()).getReader(),
    );
    const buffers = ["", ""];
    const nextLine = async (index: number): Promise<string> => {
      while (!buffers[index]!.includes("\n")) {
        const chunk = await readers[index]!.read();
        if (chunk.done) throw new Error("worker exited early");
        buffers[index] += chunk.value;
      }
      const [line, ...rest] = buffers[index]!.split("\n");
      buffers[index] = rest.join("\n");
      return line!;
    };
    try {
      expect(await Promise.all([nextLine(0), nextLine(1)])).toEqual([
        "ready",
        "ready",
      ]);
      for (const worker of workers) worker.stdin.write("go\n");
      expect(await Promise.all([nextLine(0), nextLine(1)])).toEqual([
        "done",
        "done",
      ]);
      for (const worker of workers) worker.stdin.write("report\n");
      const reports = (await Promise.all([nextLine(0), nextLine(1)])).map(
        (line) =>
          JSON.parse(line) as {
            revision: number;
            digest: string;
            duplicates: number;
          },
      );
      expect(reports[0]!.revision).toBe(16);
      expect(reports[1]!.revision).toBe(16);
      expect(reports[0]!.digest).toBe(reports[1]!.digest);
      expect(reports.map((report) => report.duplicates)).toEqual([0, 0]);
      const disk = await loadSession<{ notes: unknown[] }>(paths);
      expect(disk.revision).toBe(16);
      expect(disk.composition.notes).toHaveLength(16);
      // Every idempotency key landed exactly once.
      expect(new Set(disk.events.map((event) => event.id)).size).toBe(16);
    } finally {
      for (const worker of workers) worker.kill("SIGKILL");
      await Promise.all(workers.map((worker) => worker.exited));
    }
  }, 20_000);

  test("duplicate idempotency keys are no-ops and stale bases get a rebase diagnostic", async () => {
    const { workspace, sessionId } = await session();
    const first = await client(workspace, sessionId);
    const second = await client(workspace, sessionId);
    const intent = {
      base: 0,
      kind: "score.operation",
      key: "note-key-1",
      payload: {},
      operations: [addNote("n1")],
    };
    expect(await first.apply(intent)).toEqual({
      status: "accepted",
      revision: 1,
    });
    expect(await second.apply(intent)).toEqual({
      status: "duplicate",
      revision: 1,
    });
    const stale = await second.apply({
      ...intent,
      key: "note-key-2",
      operations: [addNote("n2")],
    });
    expect(stale).toMatchObject({
      status: "rebase",
      baseRevision: 0,
      currentRevision: 1,
    });
    const invalid = await second.apply({
      ...intent,
      base: 1,
      key: "note-key-3",
      operations: [{ type: "addNote", note: { id: "bad", pitch: 999 } }],
    });
    expect(invalid.status).toBe("rejected");
    await first.sync();
    expect(first.record.revision).toBe(1);
    expect(second.record.revision).toBe(1);
    expect(first.digest).toBe(second.digest);
  });

  test("broadcasts one transport with a shared timestamp", async () => {
    const { workspace, sessionId } = await session();
    const first = await client(workspace, sessionId);
    const second = await client(workspace, sessionId);
    const seen: number[] = [];
    second.subscribe((update) => {
      if (update.type === "transport") seen.push(update.transport.seq);
    });
    await first.setTransport("play");
    await second.sync();
    expect(first.transport.playing).toBe(true);
    expect(second.transport).toEqual(first.transport);
    await first.setTransport("seek", { beat: 2 });
    await second.setTransport("pause");
    await first.sync();
    expect(first.transport.playing).toBe(false);
    expect(first.transport).toEqual(second.transport);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test("kill -9 then restart recovers the same digest and reclaims the socket", async () => {
    const { workspace, paths, sessionId } = await session();
    const connected = await client(workspace, sessionId);
    for (let index = 0; index < 3; index += 1)
      await connected.apply({
        base: connected.record.revision,
        kind: "score.operation",
        payload: {},
        operations: [addNote(`k${index}`, index * 120)],
      });
    const digest = connected.digest;
    const pid = connected.daemonPid;
    process.kill(pid, "SIGKILL");
    await until(() => !alive(pid));
    // The crashed daemon left its socket and lock behind.
    expect(existsSync(daemonSocketPath(paths))).toBe(true);
    await until(
      () => connected.connected && connected.daemonPid !== pid,
      8_000,
    );
    expect(connected.record.revision).toBe(3);
    expect(connected.digest).toBe(digest);
    expect(await daemonPid(paths)).toBe(connected.daemonPid);
    // A retried key from before the crash is still a duplicate.
    const replay = await connected.apply({
      base: 0,
      kind: "score.operation",
      key: connected.record.events[0]!.id,
      payload: {},
      operations: [addNote("k0")],
    });
    expect(replay.status).toBe("duplicate");
  }, 15_000);

  test("SIGTERM removes the socket and the idle grace period ends the daemon", async () => {
    const { workspace, paths, sessionId } = await session();
    const first = await client(workspace, sessionId);
    const pid = first.daemonPid;
    first.close();
    await until(() => !alive(pid), 3_000);
    expect(existsSync(daemonSocketPath(paths))).toBe(false);
    const second = await client(workspace, sessionId);
    const nextPid = second.daemonPid;
    expect(nextPid).not.toBe(pid);
    second.close();
    process.kill(nextPid, "SIGTERM");
    await until(() => !alive(nextPid), 3_000);
    expect(existsSync(daemonSocketPath(paths))).toBe(false);
    expect(await daemonPid(paths)).toBeUndefined();
  }, 10_000);

  test("reclaims a stale socket file that no daemon is listening on", async () => {
    const { workspace, paths, sessionId } = await session();
    await writeFile(daemonSocketPath(paths), "stale");
    const connected = await client(workspace, sessionId);
    expect(alive(connected.daemonPid)).toBe(true);
    expect(connected.record.revision).toBe(0);
  });

  test("simultaneous claims get different tracks and presence tracks disconnects", async () => {
    const { workspace, sessionId } = await session(["drums", "bass", "keys"]);
    const first = await client(workspace, sessionId, "a");
    const second = await client(workspace, sessionId, "b");
    const third = await client(workspace, sessionId, "c");
    const claims = await Promise.all([
      first.claimTrack(),
      second.claimTrack(),
      third.claimTrack("keys"),
    ]);
    expect(new Set(claims).size).toBe(3);
    expect(claims[2]).toBe("keys");
    const fourth = await client(workspace, sessionId, "d");
    expect(await fourth.claimTrack()).toBeNull();
    third.close();
    await until(() => fourth.presence.length === 3);
    expect(await fourth.claimTrack()).toBe("keys");
  });
});

describe("file presence fallback", () => {
  test("simultaneous claims get different tracks and stale heartbeats expire", async () => {
    const { paths } = await session();
    const entry = (clientId: string) => ({
      clientId,
      pid: process.pid,
      label: clientId,
      focusedTrackId: null,
    });
    const first = new FilePresence(paths, entry("one"));
    const second = new FilePresence(paths, entry("two"));
    await Promise.all([first.start(), second.start()]);
    try {
      const claims = await Promise.all([
        first.claim(["drums", "bass"]),
        second.claim(["drums", "bass"]),
      ]);
      expect(new Set(claims)).toEqual(new Set(["drums", "bass"]));
      expect(await first.list()).toHaveLength(2);
      expect(await first.list(Date.now() + 60_000)).toHaveLength(0);
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});
