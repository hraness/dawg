/**
 * Regressions from the q08 format review: no write over an author's edit,
 * one session per project folder, cross-window echo suppression, helper
 * modules in the evaluated graph, per-file reprints, and a seeded fuzz of
 * interleaved score edits, file edits and checks.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperations } from "../../core/diff.ts";
import { addNote, createScore, TrackScore } from "../../core/score.ts";
import { printProject } from "../../core/sdk/print.ts";
import { initProject, writeAtomic } from "./init.ts";
import { startProjectSync, type ProjectSync, type SyncHost } from "./sync.ts";

type Card = { text: string; tone: string };

/** A shared in-memory session several windows can attach to. */
function session(initial: TrackScore) {
  return { score: initial };
}

function window(
  project: string,
  shared: { score: TrackScore },
  sessionId?: string,
) {
  const cards: Card[] = [];
  let commits = 0;
  const api: SyncHost = {
    project,
    ...(sessionId === undefined ? {} : { sessionId: () => sessionId }),
    current: () => shared.score,
    async commit(plan) {
      commits += 1;
      shared.score = applyScoreOperations(shared.score, plan.operations);
      return shared.score;
    },
    card: (text, tone) => void cards.push({ text, tone }),
    types: () => undefined,
  };
  return {
    api,
    cards,
    get commits() {
      return commits;
    },
  };
}

const typecheck = async () => ({ ok: true, diagnostics: [], ms: 0 });
const start = (api: SyncHost): ProjectSync =>
  startProjectSync(api, { watch: false, typecheck });

const twoTracks = createScore({
  tracks: [
    { id: "main", name: "main", instrument: "sine" },
    { id: "keys", name: "keys", instrument: "piano" },
  ],
  notes: [
    {
      id: "m1",
      trackId: "main",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    },
  ],
});

function note(score: TrackScore, id: string, trackId: string, pitch: number) {
  return addNote(score, {
    id,
    trackId,
    startTick: 480 * (score.notes.length + 1),
    durationTicks: 240,
    pitch,
    velocity: 0.7,
  });
}

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-sync-review-"));
  await initProject(dir);
  return dir;
}

async function withProject(run: (dir: string) => Promise<void>) {
  const dir = await project();
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const read = (dir: string, path: string) => readFile(join(dir, path), "utf8");

describe("score → files never overwrites an author's edit", () => {
  test("a half-typed file survives a score change while it is rejected", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const w = window(dir, s, "s1");
      const sync = start(w.api);
      try {
        await sync.checkFiles();
        const wip = `import { track, note } from "dawg";\nexport default track({ name: "main", notes: [note("C4", 0),`;
        await writeAtomic(join(dir, "tracks/main/track.ts"), wip);
        expect(await sync.checkFiles()).toMatch(/^files rejected/);
        s.score = note(s.score, "m2", "main", 62);
        sync.scoreChanged(s.score);
        await sync.flushScore();
        expect(await read(dir, "tracks/main/track.ts")).toBe(wip);
        expect(w.cards.at(-1)).toEqual({
          text: "tracks/main/track.ts edited · not overwritten",
          tone: "warning",
        });
        // Deleting the file hands it back to dawg.
        await rm(join(dir, "tracks/main/track.ts"));
        s.score = note(s.score, "m3", "main", 64);
        sync.scoreChanged(s.score);
        await sync.flushScore();
        expect(await read(dir, "tracks/main/track.ts")).toBe(
          printProject(s.score).files.find(
            (f) => f.path === "tracks/main/track.ts",
          )!.text,
        );
      } finally {
        await sync.stop();
      }
    }));

  test("comments in an untouched track file survive another track's edit", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const w = window(dir, s, "s1");
      const sync = start(w.api);
      try {
        await sync.checkFiles();
        const printed = await read(dir, "tracks/main/track.ts");
        const commented = `// the hook, keep it simple\n${printed.replace(
          "export default",
          "/* lead */ export default",
        )}`;
        await writeAtomic(join(dir, "tracks/main/track.ts"), commented);
        expect(await sync.checkFiles()).toBe("files match the score");
        s.score = note(s.score, "k1", "keys", 67);
        sync.scoreChanged(s.score);
        await sync.flushScore();
        expect(await read(dir, "tracks/main/track.ts")).toBe(commented);
        expect(await read(dir, "tracks/keys/track.ts")).toContain("G4");
      } finally {
        await sync.stop();
      }
    }));
});

describe("one session per project folder", () => {
  test("a second session's window is detached while the owner is open", () =>
    withProject(async (dir) => {
      const x = session(twoTracks);
      const y = session(
        createScore({
          tracks: [{ id: "drums", name: "drums", instrument: "sine" }],
        }),
      );
      const wx = window(dir, x, "session-x");
      const sx = start(wx.api);
      await sx.checkFiles();
      const files = await read(dir, "song.ts");
      const wy = window(dir, y, "session-y");
      const sy = start(wy.api);
      try {
        expect(await sy.checkFiles()).toBe("files belong to session session-x");
        expect(await read(dir, "song.ts")).toBe(files);
        y.score = note(y.score, "d1", "drums", 36);
        sy.scoreChanged(y.score);
        await sy.flushScore();
        expect(await read(dir, "song.ts")).toBe(files);
        await sx.checkFiles();
        expect(x.score.tracks.map((t) => t.id)).toEqual(["main", "keys"]);
        expect(x.score.notes.length).toBe(1);
        expect(wx.commits).toBe(0);
        expect(wy.cards[0]?.text).toBe(
          "files belong to session session-x · not synced here",
        );
        // Once the owner closes, the other session may take the files over.
        await sx.stop();
        expect(await sy.checkFiles()).toBe("files reprinted from the score");
        expect(await read(dir, "song.ts")).toContain("drums");
        expect(x.score.tracks.map((t) => t.id)).toEqual(["main", "keys"]);
      } finally {
        await sx.stop();
        await sy.stop();
      }
    }));
});

describe("echo suppression across windows", () => {
  test("window B never reverts its newer edit by applying A's reprint", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const a = window(dir, s, "shared");
      const b = window(dir, s, "shared");
      const sa = start(a.api);
      const sb = start(b.api);
      try {
        await sa.checkFiles();
        await sb.checkFiles();
        // A edits (revision N+1) and reprints.
        s.score = note(s.score, "a1", "main", 62);
        sa.scoreChanged(s.score);
        await sa.flushScore();
        // B's user edits (revision N+2) before B's watcher sees A's write.
        s.score = note(s.score, "b1", "keys", 65);
        await sb.checkFiles();
        expect(s.score.notes.some((n) => n.id === "b1")).toBe(true);
        expect(b.commits).toBe(0);
        expect(a.commits).toBe(0);
      } finally {
        await sa.stop();
        await sb.stop();
      }
    }));

  test("concurrent reprints from two windows keep every file's hash", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const a = window(dir, s, "shared");
      const b = window(dir, s, "shared");
      const sa = start(a.api);
      const sb = start(b.api);
      try {
        await Promise.all([sa.checkFiles(), sb.checkFiles()]);
        for (let round = 0; round < 4; round += 1) {
          s.score = note(
            s.score,
            `n${round}`,
            round % 2 ? "keys" : "main",
            60 + round,
          );
          sa.scoreChanged(s.score);
          sb.scoreChanged(s.score);
          await Promise.all([sa.flushScore(), sb.flushScore()]);
        }
        const state = JSON.parse(await read(dir, ".dawg/sync.json")) as {
          files: Record<string, string>;
        };
        for (const file of printProject(s.score).files)
          expect(Object.keys(state.files)).toContain(file.path);
        // A fresh window on the same session sees the files as unedited.
        const c = window(dir, s, "shared");
        const sc = start(c.api);
        expect(await sc.checkFiles()).toMatch(
          /^files (match the score|unchanged)$/,
        );
        expect(c.commits).toBe(0);
        await sc.stop();
      } finally {
        await sa.stop();
        await sb.stop();
      }
    }));
});

describe("an edit saved just before a score flush", () => {
  test("is still applied by the next look", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const w = window(dir, s, "s1");
      const sync = start(w.api);
      try {
        await sync.checkFiles();
        const keys = (await read(dir, "tracks/keys/track.ts"))
          .replace("import { track }", "import { track, note }")
          .replace(/\}\);\n$/, '  notes: [note("A4", 3)],\n});\n');
        expect(keys).toContain("A4");
        await writeAtomic(join(dir, "tracks/keys/track.ts"), keys);
        // The watcher has not fired yet when a score edit is flushed.
        s.score = note(s.score, "m2", "main", 62);
        sync.scoreChanged(s.score);
        await sync.flushScore();
        expect(await read(dir, "tracks/keys/track.ts")).toBe(keys);
        expect(await sync.checkFiles()).toMatch(/^applied from files/);
        expect(
          s.score.notes.some((n) => n.trackId === "keys" && n.pitch === 69),
        ).toBe(true);
        expect(s.score.notes.some((n) => n.id === "m2")).toBe(true);
      } finally {
        await sync.stop();
      }
    }));
});

describe("the evaluated module graph", () => {
  test("an edit to a helper module a track imports is applied", () =>
    withProject(async (dir) => {
      const s = session(twoTracks);
      const w = window(dir, s);
      const sync = start(w.api);
      try {
        await sync.checkFiles();
        await writeAtomic(
          join(dir, "tracks/main/pitch.ts"),
          `export const P = "D4";\n`,
        );
        const printed = await read(dir, "tracks/main/track.ts");
        await writeAtomic(
          join(dir, "tracks/main/track.ts"),
          `import { P } from "./pitch.ts";\n${printed.replace('note("C4", 0)', "note(P, 0)")}`,
        );
        expect(await sync.checkFiles()).toMatch(/^applied from files/);
        expect(s.score.notes.find((n) => n.trackId === "main")?.pitch).toBe(62);
        await writeAtomic(
          join(dir, "tracks/main/pitch.ts"),
          `export const P = "G4";\n`,
        );
        expect(await sync.checkFiles()).toMatch(/^applied from files/);
        expect(s.score.notes.find((n) => n.trackId === "main")?.pitch).toBe(67);
        expect(await sync.checkFiles()).toBe("files unchanged");
        // A score change elsewhere leaves the helper and its importer alone.
        s.score = note(s.score, "k1", "keys", 60);
        sync.scoreChanged(s.score);
        await sync.flushScore();
        expect(await read(dir, "tracks/main/pitch.ts")).toBe(
          `export const P = "G4";\n`,
        );
        expect(await read(dir, "tracks/main/track.ts")).toContain("note(P, 0)");
      } finally {
        await sync.stop();
      }
    }));
});

/** Seeded PRNG (mulberry32): deterministic fuzz without dependencies. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fuzz: interleaved score edits, file edits and checks", () => {
  for (const seed of [7, 1234, 99991]) {
    test(`seed ${seed}: an unsynced author edit is never lost and a clean check converges`, () =>
      withProject(async (dir) => {
        const random = rng(seed);
        const s = session(twoTracks);
        const w = window(dir, s, "fuzz");
        const sync = start(w.api);
        let counter = 0;
        /** Text the author saved that dawg has not yet accepted, per file. */
        const pending = new Map<string, string>();
        try {
          await sync.checkFiles();
          for (let step = 0; step < 14; step += 1) {
            const roll = random();
            const path =
              random() < 0.5 ? "tracks/main/track.ts" : "tracks/keys/track.ts";
            if (roll < 0.4) {
              s.score = note(
                s.score,
                `f${counter++}`,
                random() < 0.5 ? "main" : "keys",
                48 + Math.floor(random() * 24),
              );
              sync.scoreChanged(s.score);
              await sync.flushScore();
            } else if (roll < 0.6) {
              const broken = `// wip ${counter++}\nexport default track({`;
              await writeAtomic(join(dir, path), broken);
              pending.set(path, broken);
            } else if (roll < 0.8) {
              const text = (await read(dir, path)).replace(
                /^/,
                `// comment ${counter++}\n`,
              );
              await writeAtomic(join(dir, path), text);
              pending.set(path, text);
            } else {
              const outcome = await sync.checkFiles();
              if (!outcome.startsWith("files rejected")) pending.clear();
            }
            for (const [file, text] of pending)
              expect(await read(dir, file)).toBe(text);
          }
          // The author deletes every broken file; a check then converges.
          for (const [file, text] of pending)
            if (text.endsWith("track({")) await rm(join(dir, file));
          sync.scoreChanged(s.score);
          await sync.flushScore();
          const outcome = await sync.checkFiles();
          expect(outcome).not.toMatch(/^files rejected/);
          expect(await sync.checkFiles()).toBe("files unchanged");
        } finally {
          await sync.stop();
        }
      }));
  }
});
