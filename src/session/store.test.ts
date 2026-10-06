import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionEvent,
  ensureSession,
  loadSession,
  readCurrentSessionId,
  SessionConflictError,
} from "./store.ts";

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
});
