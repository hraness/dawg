/**
 * Regressions from the q08 format review: undo of the newest edit survives
 * compaction at the size cap, and a full event log folds its oldest events
 * instead of refusing every later edit.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyTarget } from "../commands/history.ts";
import { compositionAt } from "./rebase.ts";
import {
  appendSessionEvent,
  ensureSession,
  createForkSession,
  inheritedEvents,
  loadSession,
  MAX_RECORD_BYTES,
} from "./store.ts";

/** A composition whose rewind against the previous one is ~270 KB. */
const wide = (seed: number) => ({
  notes: Array.from({ length: 6000 }, (_, i) => ({
    id: `n${i}`,
    pitch: (seed * 31 + i) % 128,
    start: i * 7 + seed,
  })),
});

describe("compaction keeps the newest rewind", () => {
  test("undo of the edit just made works at the size cap", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-review-compact-"));
    try {
      const session = await ensureSession(wide(0), {
        workspace,
        sessionId: "wide",
      });
      let record = session.record;
      for (let edit = 1; edit <= 34; edit += 1) {
        record = await appendSessionEvent(
          session.paths,
          record,
          { kind: "score.edit", payload: { n: edit } },
          wide(edit),
        );
        const last = record.events.at(-1)!;
        // Every append, including the ones that cross the cap, keeps the
        // rewind of the edit it appended.
        expect(last.rewind).toBeDefined();
        expect(compositionAt(record, edit - 1)).toEqual(wide(edit - 1));
        const undo = historyTarget(record.composition, record.events, "undo");
        expect(undo?.composition).toEqual(wide(edit - 1));
      }
      expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(
        MAX_RECORD_BYTES,
      );
      // The kept rewinds are a contiguous newest run, more than one deep.
      const kept = record.events.map((event) => event.rewind !== undefined);
      const first = kept.indexOf(true);
      expect(kept.slice(first).every(Boolean)).toBe(true);
      expect(kept.length - first).toBeGreaterThan(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("a full event log folds instead of refusing edits", () => {
  test("edits keep landing past 2000 events; revisions stay consistent", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-review-fold-"));
    try {
      const session = await ensureSession(
        { v: 0 },
        { workspace, sessionId: "long" },
      );
      let record = session.record;
      for (let edit = 1; edit <= 2450; edit += 1)
        record = await appendSessionEvent(
          session.paths,
          record,
          { kind: "score.edit", payload: { n: edit } },
          { v: edit },
        );
      expect(record.revision).toBe(2450);
      expect(record.events.length).toBeLessThanOrEqual(2000);
      expect(record.folded).toBe(2450 - record.events.length);
      record.events.forEach((event, index) =>
        expect(event.revision).toBe(record.folded! + index + 1),
      );
      const loaded = await loadSession<{ v: number }>(session.paths);
      expect(loaded).toEqual(record);
      // History inside the kept window still rewinds; folded history does not.
      expect(compositionAt(loaded, 2449)).toEqual({ v: 2449 });
      expect(compositionAt(loaded, record.folded!)).toEqual({
        v: record.folded!,
      });
      expect(compositionAt(loaded, record.folded! - 1)).toBeUndefined();
      expect(
        historyTarget(loaded.composition, loaded.events, "undo")?.composition,
      ).toEqual({ v: 2449 });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120_000);

  test("a fork of a folded parent inherits only the events still kept", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-review-foldfork-"));
    try {
      const session = await ensureSession(
        { v: 0 },
        { workspace, sessionId: "parent" },
      );
      let record = session.record;
      for (let edit = 1; edit <= 2100; edit += 1)
        record = await appendSessionEvent(
          session.paths,
          record,
          { kind: "score.edit", payload: {} },
          { v: edit },
        );
      const fork = await createForkSession(workspace, record, "child");
      const inherited = await inheritedEvents(
        workspace,
        fork.meta,
        fork.sessionId,
      );
      expect(inherited.length).toBe(record.events.length);
      expect(inherited.at(-1)!.revision).toBe(2100);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120_000);

  test("older records without `folded` load and re-serialize unchanged", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-review-foldold-"));
    try {
      const session = await ensureSession(
        { v: 0 },
        { workspace, sessionId: "old" },
      );
      await appendSessionEvent(
        session.paths,
        session.record,
        { kind: "score.edit", payload: {} },
        { v: 1 },
      );
      const bytes = await readFile(session.paths.record, "utf8");
      expect(bytes).not.toContain("folded");
      const loaded = await loadSession(session.paths);
      expect(loaded).toEqual(JSON.parse(bytes));
      expect("folded" in loaded).toBe(false);
      // A malformed fold count is rejected.
      const raw = JSON.parse(bytes);
      await writeFile(
        session.paths.record,
        JSON.stringify({ ...raw, folded: 0 }),
      );
      await expect(loadSession(session.paths)).rejects.toThrow(/folded/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
