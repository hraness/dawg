import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionEvent,
  ensureSession,
  loadSession,
  MAX_RECORD_BYTES,
  readCurrentSessionId,
  SessionValidationError,
  SessionConflictError,
} from "./store.ts";
import { compositionAt } from "./rebase.ts";
import { acquireSessionLock } from "./lock.ts";

describe("session store", () => {
  test("creates a current session and atomically appends bounded events", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-session-"));
    const first = await ensureSession(
      { tracks: [] },
      { workspace, sessionId: "demo" },
    );
    const next = await appendSessionEvent(
      first.paths,
      first.record,
      { kind: "test", payload: { ok: true } },
      { tracks: ["bass"] },
    );
    expect(next.revision).toBe(1);
    expect(
      (await loadSession<typeof next.composition>(first.paths)).composition,
    ).toEqual({ tracks: ["bass"] });
    expect(
      (await readFile(join(workspace, ".dawg", "session"), "utf8")).trim(),
    ).toBe("demo");
  });

  test("rejects a stale writer instead of losing another window's event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-session-conflict-"));
    const first = await ensureSession(
      { notes: [] },
      { workspace, sessionId: "shared" },
    );
    await appendSessionEvent(
      first.paths,
      first.record,
      { kind: "one", payload: {} },
      { notes: [1] },
    );
    let rejection: unknown;
    try {
      await appendSessionEvent(
        first.paths,
        first.record,
        { kind: "stale", payload: {} },
        { notes: [2] },
      );
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(SessionConflictError);
    expect(
      (await loadSession<{ notes: number[] }>(first.paths)).events.map(
        (event) => event.kind,
      ),
    ).toEqual(["one"]);
  });

  test("explicit session attachment does not move the workspace pointer", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-pointer-"));
    const first = await ensureSession({ value: 1 }, { workspace });
    const second = await ensureSession(
      { value: 2 },
      { workspace, sessionId: "explicit", setCurrent: false },
    );
    expect(second.record.sessionId).toBe("explicit");
    expect(await readCurrentSessionId(workspace)).toBe(first.record.sessionId);
  });

  test("rejects unsafe ids before they can escape the session directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-unsafe-id-"));
    await expect(
      // Deliberately exercise a foreign CLI value at the path boundary.
      ensureSession({}, { workspace, sessionId: "../outside" }),
    ).rejects.toBeInstanceOf(SessionValidationError);
  });

  test("does not replace a corrupt record while ensuring a session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-corrupt-record-"));
    const path = join(workspace, ".dawg", "sessions", "broken.json");
    await Bun.write(join(workspace, ".dawg", "session"), "broken\n");
    await Bun.write(path, "{ this is not a session }\n");
    await expect(ensureSession({ safe: true }, { workspace })).rejects.toThrow(
      "invalid JSON",
    );
    expect(await readFile(path, "utf8")).toBe("{ this is not a session }\n");
  });

  test("concurrent first launches converge on one local session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-concurrent-init-"));
    const [one, two] = await Promise.all([
      ensureSession({ source: "one" }, { workspace }),
      ensureSession({ source: "two" }, { workspace }),
    ]);
    expect(one.record.sessionId).toBe(two.record.sessionId);
    expect(["one", "two"]).toContain(one.record.composition.source);
    expect(await readCurrentSessionId(workspace)).toBe(one.record.sessionId);
  });

  test("does not reclaim an old-looking lock owned by a live process", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-live-lock-"));
    const lockPath = join(workspace, "session.lock");
    const release = await acquireSessionLock(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    await expect(acquireSessionLock(lockPath, 30)).rejects.toThrow("timed out");
    await release();
    const releaseAgain = await acquireSessionLock(lockPath, 30);
    await releaseAgain();
  });

  test("2000 edits on an 8-track 16-bar loop stay under the record cap", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-session-growth-"));
    const tracks = Array.from({ length: 8 }, (_, t) => ({
      id: `track-${t}`,
      name: `Track ${t}`,
      instrument: t % 2 ? "synth" : "drums",
      volume: 0.8,
      pan: 0,
      effects: [{ type: "delay", time: 0.25, feedback: 0.3, mix: 0.2 }],
    }));
    // 16 bars x 4 beats x 2 notes per beat per track = 1024 notes.
    const notes = tracks.flatMap((track, t) =>
      Array.from({ length: 128 }, (_, i) => ({
        id: `${track.id}-n${i}`,
        trackId: track.id,
        pitch: 36 + ((t * 7 + i) % 36),
        startTick: i * 240,
        durationTicks: 240,
        velocity: 100,
      })),
    );
    let composition = { tempoBpm: 120, bars: 16, tracks, notes };
    const session = await ensureSession(composition, {
      workspace,
      sessionId: "growth",
    });
    let record = session.record;
    for (let edit = 0; edit < 2000; edit += 1) {
      const index = (edit * 97) % notes.length;
      const next = composition.notes.slice();
      next[index] = { ...next[index]!, pitch: 36 + (edit % 48) };
      composition = { ...composition, notes: next };
      record = await appendSessionEvent(
        session.paths,
        record,
        { kind: "score.edit", payload: { operation: { index } } },
        composition,
      );
    }
    expect(record.revision).toBe(2000);
    expect((await stat(session.paths.record)).size).toBeLessThan(
      MAX_RECORD_BYTES,
    );
    const loaded = await loadSession<typeof composition>(session.paths);
    expect(loaded.composition).toEqual(composition);
    expect(loaded.events).toHaveLength(2000);
    // Recent history is still recoverable through the rewinds.
    expect(compositionAt(loaded, 1999)).not.toEqual(composition);
    expect(compositionAt(loaded, 0)).toMatchObject({ tempoBpm: 120 });
  }, 60_000);

  test("strips embedded `before` payloads and compacts old rewinds under pressure", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-session-compact-"));
    const big = (seed: number) => ({
      blob: Array.from({ length: 4096 }, (_, i) => `${seed}:${i}`),
    });
    const session = await ensureSession(big(0), {
      workspace,
      sessionId: "compact",
    });
    let record = session.record;
    for (let edit = 1; edit <= 120; edit += 1)
      record = await appendSessionEvent(
        session.paths,
        record,
        { kind: "score.edit", payload: { before: big(edit - 1), n: edit } },
        big(edit),
      );
    const loaded = await loadSession(session.paths);
    expect((await stat(session.paths.record)).size).toBeLessThan(
      MAX_RECORD_BYTES,
    );
    expect(loaded.events[0]!.payload).toEqual({ n: 1 });
    expect(loaded.events[0]!.rewind).toBeUndefined();
    const newest = loaded.events[loaded.events.length - 1]!;
    expect(newest.rewind).toBeDefined();
    expect(compositionAt(loaded, 119)).toEqual(big(119));
  }, 60_000);

  test("rejects a record whose rewind is malformed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-session-badrewind-"));
    const session = await ensureSession(
      { v: 0 },
      { workspace, sessionId: "r" },
    );
    const record = await appendSessionEvent(
      session.paths,
      session.record,
      { kind: "score.edit", payload: {} },
      { v: 1 },
    );
    expect(record.events[0]!.rewind).toEqual({ obj: { v: { set: 0 } } });
    const raw = JSON.parse(await readFile(session.paths.record, "utf8"));
    raw.events[0].rewind = { set: 1, del: true };
    await writeFile(session.paths.record, JSON.stringify(raw));
    await expect(loadSession(session.paths)).rejects.toBeInstanceOf(
      SessionValidationError,
    );
  });
});
