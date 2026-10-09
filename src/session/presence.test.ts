/** FilePresence: stop() never leaves a ghost, and crashed temp files are swept. */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePresence, PRESENCE_STALE_MS } from "./presence.ts";
import type { PresenceEntry } from "./protocol.ts";
import { sessionPaths } from "./store.ts";

const entry = (clientId: string): PresenceEntry => ({
  clientId,
  pid: process.pid,
  label: clientId,
  focusedTrackId: null,
});

describe("FilePresence", () => {
  test("stop() racing in-flight heartbeats leaves no entry (seeded, 40 runs)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-presence-"));
    try {
      const paths = sessionPaths(workspace, "p");
      for (let run = 0; run < 40; run += 1) {
        const presence = new FilePresence(paths, entry(`c${run}`));
        await presence.start();
        // Queue focus writes (as heartbeats would be) and stop while they run.
        const pending = Array.from({ length: (run % 5) + 1 }, (_, i) =>
          presence.focus(`t${i}`),
        );
        await presence.stop();
        await Promise.all(pending);
        const observer = new FilePresence(paths, entry("observer"));
        expect((await observer.list()).map((e) => e.clientId)).toEqual([]);
      }
      const left = await readdir(`${paths.record}.presence`);
      expect(left.filter((name) => !name.startsWith("observer"))).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("list() sweeps temp files from dead or stale writers only", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dawg-presence-tmp-"));
    try {
      const paths = sessionPaths(workspace, "p");
      const presence = new FilePresence(paths, entry("live"));
      await presence.start();
      const dir = `${paths.record}.presence`;
      const dead = join(dir, "x.json.999999.1.tmp");
      const old = join(dir, `y.json.${process.pid}.1.tmp`);
      const fresh = join(dir, `z.json.${process.pid}.2.tmp`);
      for (const path of [dead, old, fresh]) await writeFile(path, "{}");
      const past = (Date.now() - PRESENCE_STALE_MS * 3) / 1000;
      await utimes(old, past, past);
      await presence.list();
      const names = await readdir(dir);
      expect(names).not.toContain("x.json.999999.1.tmp");
      expect(names).not.toContain(`y.json.${process.pid}.1.tmp`);
      expect(names).toContain(`z.json.${process.pid}.2.tmp`);
      await presence.stop();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
