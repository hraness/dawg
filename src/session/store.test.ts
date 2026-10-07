import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  utimes,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionEvent,
  ensureSession,
  loadSession,
  readCurrentSessionId,
  SessionValidationError,
  SessionConflictError,
  stateDir,
} from "./store.ts";
import { listSessions } from "./list.ts";
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

  test("reads a legacy .track workspace when .dawg is missing and never moves it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-legacy-state-"));
    const legacy = join(workspace, ".track");
    // A workspace written before the rename: build one, then move it to .track/.
    const seeded = await ensureSession(
      { notes: [] as number[] },
      { workspace, sessionId: "old" },
    );
    await appendSessionEvent(
      seeded.paths,
      seeded.record,
      { kind: "seed", payload: {} },
      { notes: [7] },
    );
    await rename(join(workspace, ".dawg"), legacy);
    const before = await readFile(join(legacy, "sessions", "old.json"), "utf8");

    expect(stateDir(workspace)).toBe(legacy);
    expect(await readCurrentSessionId(workspace)).toBe("old");
    const opened = await ensureSession(
      { notes: [] as number[] },
      { workspace },
    );
    expect(opened.record.sessionId).toBe("old");
    expect(opened.record.revision).toBe(1);
    expect(opened.record.composition).toEqual({ notes: [7] });
    expect(opened.paths.root).toBe(legacy);
    expect((await listSessions(workspace)).map((s) => s.sessionId)).toEqual([
      "old",
    ]);
    // Nothing was created under .dawg, and the legacy record is intact.
    expect(existsSync(join(workspace, ".dawg"))).toBe(false);
    expect(await readFile(join(legacy, "sessions", "old.json"), "utf8")).toBe(
      before,
    );
  });

  test("prefers .dawg when both exist and creates .dawg in a fresh workspace", async () => {
    const both = await mkdtemp(join(tmpdir(), "dawg-both-state-"));
    await mkdir(join(both, ".track", "sessions"), { recursive: true });
    await Bun.write(join(both, ".track", "session"), "old\n");
    await mkdir(join(both, ".dawg"), { recursive: true });
    expect(stateDir(both)).toBe(join(both, ".dawg"));
    expect(await readCurrentSessionId(both)).toBeUndefined();
    await ensureSession({ value: 1 }, { workspace: both, sessionId: "new" });
    expect(await readdir(join(both, ".track", "sessions"))).toEqual([]);
    expect(
      (await readFile(join(both, ".track", "session"), "utf8")).trim(),
    ).toBe("old");

    const fresh = await mkdtemp(join(tmpdir(), "dawg-fresh-state-"));
    await ensureSession({ value: 1 }, { workspace: fresh, sessionId: "a" });
    expect(existsSync(join(fresh, ".dawg", "sessions", "a.json"))).toBe(true);
    expect(existsSync(join(fresh, ".track"))).toBe(false);
  });
});
