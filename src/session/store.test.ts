import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionEvent,
  ensureSession,
  loadSession,
  readCurrentSessionId,
  SessionValidationError,
  SessionConflictError,
} from "./store.ts";
import { acquireSessionLock } from "./lock.ts";

describe("session store", () => {
  test("creates a current session and atomically appends bounded events", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-session-"));
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
      (await readFile(join(workspace, ".track", "session"), "utf8")).trim(),
    ).toBe("demo");
  });

  test("rejects a stale writer instead of losing another window's event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-session-conflict-"));
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
    const workspace = await mkdtemp(join(tmpdir(), "track-pointer-"));
    const first = await ensureSession({ value: 1 }, { workspace });
    const second = await ensureSession(
      { value: 2 },
      { workspace, sessionId: "explicit", setCurrent: false },
    );
    expect(second.record.sessionId).toBe("explicit");
    expect(await readCurrentSessionId(workspace)).toBe(first.record.sessionId);
  });

  test("rejects unsafe ids before they can escape the session directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-unsafe-id-"));
    await expect(
      // Deliberately exercise a foreign CLI value at the path boundary.
      ensureSession({}, { workspace, sessionId: "../outside" }),
    ).rejects.toBeInstanceOf(SessionValidationError);
  });

  test("does not replace a corrupt record while ensuring a session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-corrupt-record-"));
    const path = join(workspace, ".track", "sessions", "broken.json");
    await Bun.write(join(workspace, ".track", "session"), "broken\n");
    await Bun.write(path, "{ this is not a session }\n");
    await expect(ensureSession({ safe: true }, { workspace })).rejects.toThrow(
      "invalid JSON",
    );
    expect(await readFile(path, "utf8")).toBe("{ this is not a session }\n");
  });

  test("concurrent first launches converge on one local session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-concurrent-init-"));
    const [one, two] = await Promise.all([
      ensureSession({ source: "one" }, { workspace }),
      ensureSession({ source: "two" }, { workspace }),
    ]);
    expect(one.record.sessionId).toBe(two.record.sessionId);
    expect(["one", "two"]).toContain(one.record.composition.source);
    expect(await readCurrentSessionId(workspace)).toBe(one.record.sessionId);
  });

  test("does not reclaim an old-looking lock owned by a live process", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "track-live-lock-"));
    const lockPath = join(workspace, "session.lock");
    const release = await acquireSessionLock(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    await expect(acquireSessionLock(lockPath, 30)).rejects.toThrow("timed out");
    await release();
    const releaseAgain = await acquireSessionLock(lockPath, 30);
    await releaseAgain();
  });
});
