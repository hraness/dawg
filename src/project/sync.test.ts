import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperations } from "../../core/diff.ts";
import {
  addNote,
  createScore,
  TrackScore,
  updateTrack,
} from "../../core/score.ts";
import { printProject } from "../../core/sdk/print.ts";
import { initProject, writeAtomic } from "./init.ts";
import {
  applyFiles,
  projectSourceFiles,
  startProjectSync,
  summarize,
  type FilesApplyPlan,
  type SyncHost,
  type TypesState,
} from "./sync.ts";

type Card = { text: string; tone: string };

/** An in-memory session: commits apply the plan's operations in order. */
function host(project: string, initial: TrackScore) {
  let score = initial;
  const cards: Card[] = [];
  const commits: FilesApplyPlan[] = [];
  const types: TypesState[] = [];
  const api: SyncHost = {
    project,
    current: () => score,
    async commit(plan) {
      commits.push(plan);
      score = applyScoreOperations(score, plan.operations);
      return score;
    },
    card: (text, tone) => void cards.push({ text, tone }),
    types: (state) => void types.push(state),
  };
  return {
    api,
    cards,
    commits,
    types,
    get score() {
      return score;
    },
    set(next: TrackScore) {
      score = next;
    },
  };
}

const typecheck = async () => ({ ok: true, diagnostics: [], ms: 0 });

const base = createScore({
  tracks: [{ id: "main", name: "main", instrument: "sine" }],
  notes: [
    {
      id: "tui-1",
      trackId: "main",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    },
  ],
});

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-sync-"));
  await initProject(dir);
  return dir;
}

describe("applyFiles", () => {
  test("adopts session ids and plans the minimal operations", () => {
    const evaluated = createScore({
      tracks: [{ id: "main", name: "main", instrument: "sine" }],
      notes: [
        {
          id: "n-1",
          trackId: "main",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
        },
        {
          id: "n-2",
          trackId: "main",
          startTick: 480,
          durationTicks: 480,
          pitch: 62,
          velocity: 0.8,
        },
      ],
    });
    const plan = applyFiles(base, evaluated);
    expect(plan.operations.map((op) => op.type)).toEqual(["addNote"]);
    expect(plan.next.notes.map((n) => n.id)).toEqual(["tui-1", "n-2"]);
    expect(applyFiles(base, base).operations).toEqual([]);
    expect(summarize(plan.operations)).toBe("1 note");
  });
});

describe("startProjectSync", () => {
  test("startup: a fresh project is printed from the session score", async () => {
    const dir = await project();
    const h = host(dir, base);
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      const printed = printProject(base);
      for (const file of printed.files)
        expect(await readFile(join(dir, file.path), "utf8")).toBe(file.text);
      expect(h.commits).toEqual([]);
      expect(await projectSourceFiles(dir)).toEqual([
        "song.ts",
        "tracks/main/track.ts",
      ]);
      expect(h.types.at(-1)).toEqual({ ok: true, errors: 0 });
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("files → score commits one plan and keeps the author's formatting", async () => {
    const dir = await project();
    const h = host(dir, base);
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      const authored = `import { track, note } from "dawg";

export default track({
  id: "main",
  name: "main",
  instrument: "sine",
  notes: [
    note("C4", 0),
    note("E4", 1, 0.5), // added by hand
  ],
});
`;
      await writeAtomic(join(dir, "tracks/main/track.ts"), authored);
      expect(await sync.checkFiles()).toBe("applied from files · 1 note");
      expect(h.commits.length).toBe(1);
      expect(h.commits[0]!.operations.map((op) => op.type)).toEqual([
        "addNote",
      ]);
      expect(h.score.notes.map((n) => [n.id, n.pitch, n.startTick])).toEqual([
        ["tui-1", 60, 0],
        [h.score.notes[1]!.id, 64, 480],
      ]);
      expect(h.cards.at(-1)).toEqual({
        text: "applied from files · 1 note",
        tone: "success",
      });
      // The window reports the new score; the file already equals it, so it stays as written.
      sync.scoreChanged(h.score);
      await sync.flushScore();
      expect(await readFile(join(dir, "tracks/main/track.ts"), "utf8")).toBe(
        authored,
      );
      // Our own writes do not echo back as a second commit.
      await sync.checkFiles();
      expect(h.commits.length).toBe(1);
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("score → files reprints only the changed track and removes stale files it wrote", async () => {
    const two = createScore({
      ...base.toJSON(),
      tracks: [
        ...base.tracks,
        { id: "keys", name: "keys", instrument: "piano" },
      ],
    });
    const dir = await project();
    const h = host(dir, two);
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      const before = await stat(join(dir, "tracks/main/track.ts"));
      await Bun.sleep(20);
      const next = addNote(two, {
        id: "k1",
        trackId: "keys",
        startTick: 960,
        durationTicks: 480,
        pitch: 67,
        velocity: 0.8,
      });
      h.set(next);
      sync.scoreChanged(next);
      await sync.flushScore();
      expect(
        await readFile(join(dir, "tracks/keys/track.ts"), "utf8"),
      ).toContain('note("G4", 2)');
      expect((await stat(join(dir, "tracks/main/track.ts"))).mtimeMs).toBe(
        before.mtimeMs,
      );
      const removed = applyScoreOperations(next, [
        { type: "removeTrack", trackId: "keys" },
      ]);
      h.set(removed);
      sync.scoreChanged(removed);
      await sync.flushScore();
      await expect(stat(join(dir, "tracks/keys/track.ts"))).rejects.toThrow();
      expect(await readFile(join(dir, "song.ts"), "utf8")).not.toContain(
        "keys",
      );
      // A hand-edited stale file is kept.
      const renamed = updateTrack(removed, "main", { name: "lead" });
      await writeAtomic(
        join(dir, "tracks/main/track.ts"),
        "// mine\nexport default {};\n",
      );
      h.set(renamed);
      sync.scoreChanged(renamed);
      await sync.flushScore();
      expect(await readFile(join(dir, "tracks/main/track.ts"), "utf8")).toBe(
        "// mine\nexport default {};\n",
      );
      expect(
        await readFile(join(dir, "tracks/lead/track.ts"), "utf8"),
      ).toContain('name: "lead"');
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a broken file is rejected with a diagnostic card and the score is untouched", async () => {
    const dir = await project();
    const h = host(dir, base);
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      await writeAtomic(
        join(dir, "tracks/main/track.ts"),
        `import { track, note } from "dawg";\nexport default track({ name: "main", notes: [note("X9", 0)] });\n`,
      );
      expect(await sync.checkFiles()).toMatch(
        /^files rejected · tracks\/main\/track\.ts:2:\d+ pitch/,
      );
      expect(h.commits).toEqual([]);
      expect(h.cards.at(-1)?.tone).toBe("error");
      expect(h.cards.at(-1)?.text).toMatch(
        /^files rejected · tracks\/main\/track\.ts:2:\d+ pitch/,
      );
      const count = h.cards.length;
      await sync.checkFiles();
      expect(h.cards.length).toBe(count);
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("startup: files edited while dawg was closed win over the session", async () => {
    const dir = await project();
    await writeAtomic(
      join(dir, "tracks/main/track.ts"),
      `import { track, note } from "dawg";\nexport default track({ name: "main", notes: [note("D4", 2)] });\n`,
    );
    await writeAtomic(
      join(dir, "song.ts"),
      `import { song } from "dawg";\nimport main from "./tracks/main/track.ts";\nexport default song({ tempo: 90, tracks: [main] });\n`,
    );
    const h = host(dir, base);
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      expect(h.commits.length).toBe(1);
      expect(h.score.tempoBpm).toBe(90);
      expect(h.score.notes.map((n) => n.pitch)).toEqual([62]);
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fs.watch picks up an edit without an explicit check", async () => {
    const dir = await project();
    const h = host(dir, base);
    const sync = startProjectSync(h.api, {
      typecheck,
      debounceMs: 30,
      pollMs: 60_000,
    });
    try {
      await sync.checkFiles();
      await writeAtomic(
        join(dir, "tracks/main/track.ts"),
        `import { track, note } from "dawg";\nexport default track({ id: "main", name: "main", notes: [note("C4", 0), note("A4", 3)] });\n`,
      );
      const deadline = Date.now() + 5_000;
      while (h.commits.length === 0 && Date.now() < deadline)
        await Bun.sleep(25);
      expect(h.commits.length).toBe(1);
      expect(h.score.notes.length).toBe(2);
    } finally {
      await sync.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
