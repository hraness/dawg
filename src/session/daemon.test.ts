import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  type ScoreOperation,
} from "../../core/score.ts";
import { DaemonClient } from "./client.ts";
import { FilePresence } from "./presence.ts";
import {
  compositionDigest,
  daemonLockPath,
  daemonLogPath,
  daemonSocketPath,
} from "./protocol.ts";
import { compositionAt } from "./rebase.ts";
import {
  ensureSession,
  loadSession,
  sessionPaths,
  type SessionPaths,
} from "./store.ts";

const WORKER = join(import.meta.dir, "fixtures", "client-worker.ts");
const FAKE_PLAYER = join(
  import.meta.dir,
  "..",
  "audio",
  "fixtures",
  "fake-player.ts",
);
// Spawned daemons inherit this: no test ever reaches a real sound device.
process.env.DAWG_AUDIO = "0";
const DAEMON_ARGS = ["--grace-ms", "300"];
const clients: DaemonClient[] = [];
const workspaces: string[] = [];

async function session(tracks = ["main"]) {
  const workspace = await mkdtemp(join(tmpdir(), "dawgd-"));
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
    const sessions = join(workspace, ".dawg", "sessions");
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

describe("dawgd", () => {
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
    // A stale full composition cannot be merged.
    const stale = await second.apply({
      base: 0,
      kind: "score.replace",
      key: "note-key-2",
      payload: {},
      composition: createScore({
        tracks: [{ id: "main", name: "main", instrument: "sine" }],
      }).toJSON(),
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

  test("events carry the authority-stamped actor and retries dedupe by seq", async () => {
    const { workspace, sessionId, paths } = await session();
    const actor = { id: `a_${"b".repeat(22)}`, name: "ben" };
    const pane = await DaemonClient.connect({
      workspace,
      sessionId,
      label: "pane",
      actor,
      daemonArgs: DAEMON_ARGS,
    });
    clients.push(pane);
    expect(pane.protocol).toBe(2);
    expect(pane.caps).toContain("actor");
    expect(pane.transport.quantum).toBe(4);
    const seq = pane.nextSeq();
    const first = await pane.apply({
      base: 0,
      kind: "score.operation",
      payload: {},
      seq,
      operations: [addNote("n1")],
    });
    expect(first).toEqual({ status: "accepted", revision: 1 });
    // A retry with a fresh idempotency key but the same seq is a no-op.
    const retry = await pane.apply({
      base: 0,
      kind: "score.operation",
      payload: {},
      seq,
      operations: [addNote("n1")],
    });
    expect(retry).toEqual({ status: "duplicate", revision: 1 });
    const stored = await loadSession(paths);
    const event = stored.events[0]!;
    expect(event.actor).toEqual({
      actorId: actor.id,
      clientId: pane.clientId,
      seq,
    });
    // Ops, not snapshots: the event names exactly what changed.
    expect(event.ops).toEqual([addNote("n1")]);
    await until(() => pane.presence.length === 1);
    expect(pane.presence[0]?.actorId).toBe(actor.id);
  });

  test("a v1-only client still edits and sees v2 commits", async () => {
    const { workspace, sessionId } = await session();
    const old = await DaemonClient.connect({
      workspace,
      sessionId,
      label: "old",
      versions: { vMin: 1, vMax: 1 },
      daemonArgs: DAEMON_ARGS,
    });
    clients.push(old);
    const current = await client(workspace, sessionId, "new");
    expect(old.protocol).toBe(1);
    expect(current.protocol).toBe(2);
    expect(
      await old.apply({
        base: 0,
        kind: "score.operation",
        payload: {},
        operations: [addNote("old")],
      }),
    ).toEqual({ status: "accepted", revision: 1 });
    expect(
      await current.apply({
        base: 1,
        kind: "a-future-kind",
        payload: { opaque: true },
        operations: [addNote("new", 240)],
      }),
    ).toEqual({ status: "accepted", revision: 2 });
    await until(() => old.record.revision === 2);
    expect(old.digest).toBe(current.digest);
  });

  test("replaying the ops log rebuilds the same composition", async () => {
    const { workspace, sessionId, paths } = await session();
    const a = await client(workspace, sessionId, "a");
    const b = await client(workspace, sessionId, "b");
    for (let index = 0; index < 6; index += 1) {
      const pane = index % 2 === 0 ? a : b;
      await pane.sync();
      const result = await pane.apply({
        base: pane.record.revision,
        kind: "score.operation",
        payload: {},
        operations: [addNote(`n${index}`, index * 120)],
      });
      expect(result.status).toBe("accepted");
    }
    const stored = await loadSession(paths);
    let replay = createScore({
      tracks: [{ id: "main", name: "main", instrument: "sine" }],
    });
    for (const event of stored.events)
      for (const op of event.ops ?? [])
        replay = applyScoreOperation(replay, op as ScoreOperation);
    expect(compositionDigest(replay.toJSON())).toBe(
      compositionDigest(stored.composition),
    );
    expect(new Set(stored.events.map((e) => e.actor?.clientId)).size).toBe(2);
  });

  test("stale operation intents rebase when nothing they touch changed", async () => {
    const { workspace, sessionId, paths } = await session(["main", "bass"]);
    const human = await client(workspace, sessionId, "human");
    const agent = await client(workspace, sessionId, "agent");
    expect(
      await agent.apply({
        base: 0,
        kind: "score.operation",
        payload: {},
        operations: [addNote("a1")],
      }),
    ).toMatchObject({ status: "accepted", revision: 1 });
    // The human edits another track while the agent still holds base 1.
    expect(
      await human.apply({
        base: 1,
        kind: "score.operation",
        payload: {},
        operations: [
          { type: "updateTrack", trackId: "bass", patch: { volume: 0.5 } },
        ],
      }),
    ).toMatchObject({ status: "accepted", revision: 2 });
    const rebased = await agent.apply({
      base: 1,
      kind: "agent.tool",
      payload: { summary: "more notes" },
      operations: [
        addNote("a2", 240),
        { type: "updateNote", noteId: "a1", patch: { velocity: 0.9 } },
      ],
    });
    expect(rebased).toEqual({ status: "accepted", revision: 3 });
    const disk = await loadSession<{
      notes: { id: string; velocity: number }[];
      tracks: { id: string; volume: number }[];
    }>(paths);
    expect(disk.composition.notes.map((note) => note.id).sort()).toEqual([
      "a1",
      "a2",
    ]);
    expect(disk.composition.notes.find((n) => n.id === "a1")?.velocity).toBe(
      0.9,
    );
    // The human's edit survived the rebase.
    expect(disk.composition.tracks.find((t) => t.id === "bass")?.volume).toBe(
      0.5,
    );
    const event = disk.events[2]!;
    expect(event.payload).toMatchObject({ rebasedFrom: 1 });
    expect(event.payload).not.toHaveProperty("before");
    // The event rewinds to the score the operations were replayed on (rev 2),
    // so undo drops only the agent's change.
    const before = compositionAt(disk, 2) as typeof disk.composition;
    expect(before.tracks.find((t) => t.id === "bass")?.volume).toBe(0.5);
    expect(before.notes.map((note) => note.id)).toEqual(["a1"]);

    // Touching something that changed since the base is still a conflict.
    await human.apply({
      base: 3,
      kind: "score.operation",
      payload: {},
      operations: [{ type: "updateNote", noteId: "a2", patch: { pitch: 64 } }],
    });
    const conflict = await agent.apply({
      base: 3,
      kind: "agent.tool",
      payload: {},
      operations: [{ type: "removeNote", noteId: "a2" }],
    });
    expect(conflict).toMatchObject({ status: "rebase", currentRevision: 4 });
    if (conflict.status === "rebase")
      expect(conflict.message).toContain("note a2 changed");
    // Bases beyond the log are never guessed.
    const future = await agent.apply({
      base: 99,
      kind: "agent.tool",
      payload: {},
      operations: [addNote("a3")],
    });
    expect(future.status).toBe("rebase");
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

  test("streams gapless audio: edits never restart the player", async () => {
    const { workspace, sessionId } = await session();
    const out = join(workspace, "player");
    process.env.DAWG_AUDIO_PLAYER = `${process.execPath} ${FAKE_PLAYER} ${out}`;
    delete process.env.DAWG_AUDIO;
    try {
      const connected = await client(workspace, sessionId);
      await connected.setTransport("play");
      await until(() => existsSync(`${out}.starts`));
      for (let index = 0; index < 3; index += 1) {
        await connected.sync();
        const result = await connected.apply({
          base: connected.record.revision,
          kind: "score.operation",
          payload: {},
          operations: [addNote(`live-${index}`, index * 240)],
        });
        expect(result.status).toBe("accepted");
        await Bun.sleep(80);
      }
      await connected.setTransport("seek", { beat: 1 });
      await Bun.sleep(80);
      const size = (await readFile(`${out}.pcm`)).length;
      expect(size).toBeGreaterThan(0);
      await until(async () => (await readFile(`${out}.pcm`)).length > size);
      await connected.setTransport("pause");
      const starts = (await readFile(`${out}.starts`, "utf8"))
        .trim()
        .split("\n");
      expect(starts).toHaveLength(1);
      // Pausing closes the player's stdin, so the fake player exits.
      await until(() => !alive(Number(starts[0])));
      expect((await readFile(`${out}.pcm`)).length % 4).toBe(0);
    } finally {
      delete process.env.DAWG_AUDIO_PLAYER;
      process.env.DAWG_AUDIO = "0";
    }
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

describe("dawgd panes", () => {
  test("panes get letters in join order, reuse freed ones, and report views", async () => {
    const { workspace, sessionId } = await session(["bass", "drums"]);
    const a = await client(workspace, sessionId, "a");
    const b = await client(workspace, sessionId, "b");
    await until(() => a.presence.length === 2 && b.self?.pane === "B");
    expect(a.self?.pane).toBe("A");
    expect(b.caps).toContain("panes");
    expect(b.sharedLive).toBe(true);
    b.setView({ screen: "tape", recording: "overdub", playing: true });
    await until(
      () => a.presence.find((entry) => entry.pane === "B")?.screen === "tape",
    );
    const seen = a.presence.find((entry) => entry.pane === "B")!;
    expect(seen.recording).toBe("overdub");
    expect(seen.playing).toBe(true);
    // A view replaces the previous one: unset fields clear.
    b.setView({ screen: "sound", param: "filter" });
    await until(
      () => a.presence.find((entry) => entry.pane === "B")?.screen === "sound",
    );
    expect(a.presence.find((entry) => entry.pane === "B")?.recording).toBe(
      undefined,
    );
    a.close();
    await until(() => b.presence.length === 1);
    const c = await client(workspace, sessionId, "c");
    await until(() => c.self?.pane !== undefined);
    expect(c.self?.pane).toBe("A");
  });

  test("two panes' live notes and clicks go to one engine", async () => {
    const { workspace, paths, sessionId } = await session(["bass", "drums"]);
    const out = join(workspace, "player");
    process.env.DAWG_AUDIO_PLAYER = `${process.execPath} ${FAKE_PLAYER} ${out}`;
    delete process.env.DAWG_AUDIO;
    try {
      const a = await client(workspace, sessionId, "a");
      const b = await client(workspace, sessionId, "b");
      const statusA = await a.liveMonitor(true);
      const statusB = await b.liveMonitor(true);
      expect(statusA.canMonitor).toBe(true);
      expect(statusB.sampleRate).toBe(statusA.sampleRate);
      await until(() => existsSync(`${out}.starts`));
      const now = Date.now();
      a.live({
        v: 1,
        type: "live",
        action: "click",
        on: true,
        volume: 0.5,
      });
      b.live({
        v: 1,
        type: "live",
        action: "click",
        on: true,
        volume: 0.5,
      });
      for (const [pane, trackId, pitch] of [
        [a, "bass", 40],
        [b, "drums", 36],
      ] as const)
        pane.live({
          v: 1,
          type: "live",
          action: "on",
          voice: 1,
          trackId,
          pitch,
          velocity: 0.8,
          seconds: 0.2,
          beat: 0,
          atMs: now,
        });
      const log = daemonLogPath(paths);
      await until(async () => {
        const text = existsSync(log) ? await readFile(log, "utf8") : "";
        return (
          text.includes(`live: note ${a.clientId} bass 40`) &&
          text.includes(`live: note ${b.clientId} drums 36`)
        );
      });
      // Both panes' notes reach the stream as audio, from one player.
      await until(async () => {
        const pcm = new Int16Array(
          (await readFile(`${out}.pcm`)).buffer.slice(0),
        );
        return pcm.some((sample) => sample !== 0);
      });
      const starts = (await readFile(`${out}.starts`, "utf8"))
        .trim()
        .split("\n");
      expect(starts).toHaveLength(1);
      // One pane leaving keeps the engine for the other.
      await a.liveMonitor(false);
      b.live({ v: 1, type: "live", action: "off", voice: 1, atMs: now });
      await b.liveMonitor(false);
      const text = await readFile(log, "utf8");
      expect(text.match(/live: monitor on/g)).toHaveLength(1);
      await until(async () =>
        (await readFile(log, "utf8")).includes("live: monitor off"),
      );
    } finally {
      delete process.env.DAWG_AUDIO_PLAYER;
      process.env.DAWG_AUDIO = "0";
    }
  });

  test("events carry the writing pane's client id", async () => {
    const { workspace, paths, sessionId } = await session();
    const a = await client(workspace, sessionId, "a");
    const b = await client(workspace, sessionId, "b");
    const result = await b.apply({
      base: b.record.revision,
      kind: "score.operation",
      payload: {},
      operations: [addNote("from-b", 0)],
    });
    expect(result.status).toBe("accepted");
    await a.sync();
    const stored = await loadSession(paths);
    expect(stored.events.at(-1)?.actor?.clientId).toBe(b.clientId);
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

  test("overlapping focus writes never fail a focus change", async () => {
    const { paths } = await session();
    const presence = new FilePresence(paths, {
      clientId: "one",
      pid: process.pid,
      label: "one",
      focusedTrackId: null,
    });
    await presence.start();
    try {
      const ids = Array.from({ length: 40 }, (_, i) => `t${i}`);
      await Promise.all(ids.map((id) => presence.focus(id)));
      const [entry] = await presence.list();
      expect(entry?.focusedTrackId).toBe("t39");
    } finally {
      await presence.stop();
    }
  });
});

describe("multi-window attach", () => {
  const CLAIM_WORKER = join(import.meta.dir, "fixtures", "claim-worker.ts");
  type Attached = { mode: string; trackId: string; draft: boolean };

  async function windows(
    workspace: string,
    sessionId: string,
    count: number,
    env: Record<string, string> = {},
  ) {
    const procs = Array.from({ length: count }, () =>
      Bun.spawn([process.execPath, CLAIM_WORKER, workspace, sessionId], {
        stdin: "pipe",
        stdout: "pipe",
        env: { ...process.env, ...env },
      }),
    );
    const readers = procs.map((proc) => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      return async (): Promise<string> => {
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            return line;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error(`worker exited: ${buffer}`);
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      };
    });
    for (const next of readers) expect(await next()).toBe("ready");
    for (const proc of procs) {
      proc.stdin.write("go\n");
      void proc.stdin.flush();
    }
    const attached = await Promise.all(
      readers.map(async (next) => JSON.parse(await next()) as Attached),
    );
    return { procs, readers, attached };
  }

  async function quit(
    procs: Array<{
      stdin: { write(s: string): void; end(): void };
      exited: Promise<number>;
    }>,
  ) {
    for (const proc of procs) {
      proc.stdin.write("quit\n");
      proc.stdin.end();
    }
    await Promise.all(procs.map((proc) => proc.exited));
  }

  for (const [label, env] of [
    ["dawgd", {}],
    ["file fallback", { DAWG_DAEMON: "0" }],
  ] as const) {
    test(`${label}: three windows restore three tracks, a fourth gets a draft`, async () => {
      const { workspace, sessionId } = await session(["drums", "bass", "keys"]);
      const first = await windows(workspace, sessionId, 3, env);
      try {
        const modes = new Set(first.attached.map((a) => a.mode));
        expect(modes).toEqual(new Set([label === "dawgd" ? "daemon" : "file"]));
        expect(new Set(first.attached.map((a) => a.trackId))).toEqual(
          new Set(["drums", "bass", "keys"]),
        );
        expect(first.attached.every((a) => !a.draft)).toBe(true);
        const fourth = await windows(workspace, sessionId, 1, env);
        try {
          const [draft] = fourth.attached;
          expect(draft).toEqual({
            mode: draft!.mode,
            trackId: "track-4",
            draft: true,
          });
          // The draft is not in the score until the first edit.
          const before = await loadSession<{ tracks: Array<{ id: string }> }>(
            pathsOf(workspace, sessionId),
          );
          expect(before.composition.tracks.map((t) => t.id)).not.toContain(
            "track-4",
          );
          fourth.procs[0]!.stdin.write("edit\n");
          void fourth.procs[0]!.stdin.flush();
          expect(await fourth.readers[0]!()).toMatch(/^edited \d+$/);
          const after = await loadSession<{
            tracks: Array<{ id: string }>;
            notes: Array<{ trackId: string }>;
          }>(pathsOf(workspace, sessionId));
          expect(after.composition.tracks.map((t) => t.id)).toEqual([
            "drums",
            "bass",
            "keys",
            "track-4",
          ]);
          expect(after.composition.notes.map((n) => n.trackId)).toEqual([
            "track-4",
          ]);
        } finally {
          await quit(fourth.procs);
        }
      } finally {
        await quit(first.procs);
      }
    }, 20_000);
  }
});

function pathsOf(workspace: string, sessionId: string): SessionPaths {
  return sessionPaths(workspace, sessionId);
}
