/**
 * Two-way sync between the project files and the session score.
 *
 * files → score: a change to `song.ts` or `tracks/<slug>/track.ts` (fs.watch
 * plus a slow poll, debounced 150 ms) evaluates the project, adopts the
 * session's note ids, diffs against the current score and commits one
 * `files.apply` revision through the session port. A failed evaluation is
 * reported as a card and leaves the score alone.
 *
 * score → files: a new score revision reprints the project and writes only
 * the files whose bytes differ. Files whose last evaluation already equals
 * the score are never rewritten, so an author's own formatting survives.
 *
 * Echo suppression: `.dawg/sync.json` records the hash of every file dawg
 * wrote; a watcher event whose file still hashes the same is ignored, in
 * this window and every other one.
 */

import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  adoptNoteIds,
  applyScoreOperations,
  diffScores,
} from "../../core/diff.ts";
import { encodeLoop } from "../../core/loop.ts";
import type { ScoreOperation, TrackScore } from "../../core/score.ts";
import {
  evaluateProject,
  formatDiagnostic,
  type Diagnostic,
  type EvalResult,
} from "../../core/sdk/eval.ts";
import { printProject } from "../../core/sdk/print.ts";
import { writeAtomic } from "./init.ts";
import { typecheckProject, type TypecheckResult } from "./typecheck.ts";

export const SYNC_DEBOUNCE_MS = 150;
export const SYNC_POLL_MS = 1_500;
const SYNC_STATE_FILE = ".dawg/sync.json";
const MAX_TRACKED_FILES = 512;

/** Header indicator state: `types ✓` or `types ✗ N`. */
export type TypesState = Readonly<{ ok: boolean; errors: number }>;

/** Result of reconciling an evaluated score with the session score. */
export type FilesApplyPlan = Readonly<{
  /** The session score after the file change, with session note ids kept. */
  next: TrackScore;
  operations: readonly ScoreOperation[];
}>;

/**
 * Pure core of files → score: adopts `current`'s note ids into `evaluated`
 * and returns the operations (and resulting score) that bring `current` to
 * it. Empty `operations` means the files already match the score.
 */
export function applyFiles(
  current: TrackScore,
  evaluated: TrackScore,
): FilesApplyPlan {
  const target = adoptNoteIds(current, evaluated);
  const operations = diffScores(current, target);
  const next =
    operations.length === 0
      ? current
      : applyScoreOperations(current, operations);
  return Object.freeze({ next, operations });
}

/** What the sync needs from its window. */
export type SyncHost = Readonly<{
  project: string;
  /** Current session score. */
  current(): TrackScore;
  /**
   * Commits the plan as one `files.apply` revision. Resolves with the
   * score the session now holds (it may be ahead after a rebase).
   */
  commit(plan: FilesApplyPlan, summary: string): Promise<TrackScore>;
  card(
    text: string,
    tone: "info" | "success" | "warning" | "error",
    hint?: string,
  ): void;
  types(state: TypesState): void;
}>;

export type SyncOptions = Readonly<{
  evaluate?: (project: string) => Promise<EvalResult>;
  typecheck?: (project: string) => Promise<TypecheckResult>;
  debounceMs?: number;
  pollMs?: number;
  /** Disable fs.watch and polling (tests drive `checkFiles` directly). */
  watch?: boolean;
}>;

export type ProjectSync = Readonly<{
  /** Call when the session score changed (local edit or another window). */
  scoreChanged(score: TrackScore): void;
  /**
   * Evaluate the files now (debounce skipped); resolves when applied with a
   * one-line outcome (`applied from files · 1 note`, `files rejected · …`,
   * `files match the score`), the last one when nothing changed since.
   */
  checkFiles(): Promise<string>;
  /** Reprint now (debounce skipped); resolves when written. */
  flushScore(): Promise<void>;
  stop(): Promise<void>;
}>;

type SyncState = { files: Record<string, string> };

export function startProjectSync(
  host: SyncHost,
  options: SyncOptions = {},
): ProjectSync {
  const evaluate =
    options.evaluate ?? ((project: string) => evaluateProject(project));
  const typecheck =
    options.typecheck ?? ((project: string) => typecheckProject(project));
  const debounceMs = options.debounceMs ?? SYNC_DEBOUNCE_MS;
  const project = host.project;
  const statePath = join(project, SYNC_STATE_FILE);
  /** Hashes of the project files as of the last successful evaluation. */
  let seen = new Map<string, string>();
  /** Outcome of the last evaluation, returned when the files did not change. */
  let lastOutcome = "files match the score";
  /** Encoded score the files were last known to equal. */
  let filesEqual = "";
  let lastRejection = "";
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  let fileTimer: ReturnType<typeof setTimeout> | undefined;
  let scoreTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingScore: TrackScore | undefined;
  let watchers: FSWatcher[] = [];
  let poll: ReturnType<typeof setInterval> | undefined;

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const readState = async (): Promise<SyncState> => {
    try {
      const value: unknown = JSON.parse(await readFile(statePath, "utf8"));
      if (typeof value !== "object" || value === null) return { files: {} };
      const files = (value as Record<string, unknown>).files;
      if (typeof files !== "object" || files === null) return { files: {} };
      const out: Record<string, string> = {};
      for (const [path, hash] of Object.entries(
        files as Record<string, unknown>,
      ))
        if (
          typeof hash === "string" &&
          /^[0-9a-f]{64}$/.test(hash) &&
          path.length < 512
        )
          out[path] = hash;
      return { files: out };
    } catch {
      return { files: {} };
    }
  };
  const writeState = (state: SyncState) =>
    writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);

  /**
   * Evaluates the files. In `files-win` mode (edits) the result is committed;
   * in `score-wins` mode (startup with unchanged files) a difference reprints
   * the files from the score instead.
   */
  const checkFilesNow = async (
    mode: "files-win" | "score-wins" = "files-win",
  ): Promise<string> => {
    if (stopped) return lastOutcome;
    const current = await hashProject(project);
    if (mode === "files-win" && sameHashes(current, seen)) return lastOutcome;
    const result = await evaluate(project);
    if (!result.ok) {
      const text = result.diagnostics.map(formatDiagnostic).join("; ");
      if (text !== lastRejection) {
        lastRejection = text;
        host.card(
          `files rejected · ${firstLine(text)}`,
          "error",
          "fix the file to apply",
        );
      }
      void runTypecheck();
      return (lastOutcome = `files rejected · ${text}`);
    }
    lastRejection = "";
    seen = current;
    const plan = applyFiles(host.current(), result.score);
    if (plan.operations.length === 0) {
      filesEqual = encodeLoop(host.current());
      void runTypecheck();
      return (lastOutcome = "files match the score");
    }
    if (mode === "score-wins") {
      pendingScore = host.current();
      await flushScoreNow();
      void runTypecheck();
      return (lastOutcome = "files reprinted from the score");
    }
    const summary = summarize(plan.operations);
    try {
      const committed = await host.commit(plan, summary);
      filesEqual = encodeLoop(committed);
      host.card(`applied from files · ${summary}`, "success");
      lastOutcome = `applied from files · ${summary}`;
    } catch (error) {
      host.card(
        `files not applied · ${firstLine(error instanceof Error ? error.message : String(error))}`,
        "warning",
      );
      lastOutcome = `files not applied · ${error instanceof Error ? error.message : String(error)}`;
    }
    void runTypecheck();
    return lastOutcome;
  };

  const flushScoreNow = async (): Promise<void> => {
    if (stopped || !pendingScore) return;
    const score = pendingScore;
    pendingScore = undefined;
    const encoded = encodeLoop(score);
    if (encoded === filesEqual) return;
    const printed = printProject(score);
    const state = await readState();
    const files = { ...state.files };
    const expected = new Set(printed.files.map((file) => file.path));
    const hashes = new Map<string, string>();
    for (const file of printed.files) {
      const hash = sha256(file.text);
      hashes.set(file.path, hash);
      const existing = await readOptional(join(project, file.path));
      if (existing === file.text) continue;
      await writeAtomic(join(project, file.path), file.text);
      files[file.path] = hash;
    }
    // Track files we printed earlier for tracks that no longer exist.
    for (const [path, hash] of Object.entries(state.files)) {
      if (expected.has(path) || !path.startsWith("tracks/")) continue;
      const existing = await readOptional(join(project, path));
      if (existing !== undefined && sha256(existing) === hash)
        await rm(join(project, path), { force: true });
      delete files[path];
    }
    await writeState({ files });
    seen = await hashProject(project);
    filesEqual = encoded;
  };

  let typecheckRunning = false;
  let typecheckAgain = false;
  const runTypecheck = async (): Promise<void> => {
    if (stopped) return;
    if (typecheckRunning) {
      typecheckAgain = true;
      return;
    }
    typecheckRunning = true;
    try {
      const result = await typecheck(project);
      host.types({ ok: result.ok, errors: result.diagnostics.length });
    } catch {
      host.types({ ok: false, errors: 1 });
    } finally {
      typecheckRunning = false;
      if (typecheckAgain) {
        typecheckAgain = false;
        void runTypecheck();
      }
    }
  };

  const scheduleFiles = () => {
    if (stopped) return;
    if (fileTimer) clearTimeout(fileTimer);
    fileTimer = setTimeout(() => {
      fileTimer = undefined;
      void enqueue(() => checkFilesNow("files-win"));
    }, debounceMs);
  };

  if (options.watch !== false) {
    const onEvent = (_event: string, filename: string | Buffer | null) => {
      const name = filename === null ? "" : String(filename);
      if (name && !isProjectSource(name)) return;
      scheduleFiles();
    };
    try {
      watchers.push(watch(project, { persistent: false }, onEvent));
      watchers.push(
        watch(
          join(project, "tracks"),
          { persistent: false, recursive: true },
          onEvent,
        ),
      );
    } catch {
      watchers.forEach((watcher) => watcher.close());
      watchers = [];
    }
    poll = setInterval(
      () => void enqueue(() => checkFilesNow("files-win")),
      options.pollMs ?? SYNC_POLL_MS,
    );
    poll.unref?.();
  }
  // Startup: files edited since dawg last wrote them (or never recorded)
  // win; otherwise the session score wins and reprints what files lack.
  void enqueue(async () => {
    const state = await readState();
    const current = await hashProject(project);
    const edited =
      current.size === 0 ||
      [...current].some(([path, hash]) => state.files[path] !== hash);
    await checkFilesNow(edited ? "files-win" : "score-wins");
  });

  return Object.freeze({
    scoreChanged(score: TrackScore) {
      if (stopped) return;
      pendingScore = score;
      if (scoreTimer) clearTimeout(scoreTimer);
      scoreTimer = setTimeout(() => {
        scoreTimer = undefined;
        void enqueue(flushScoreNow);
      }, debounceMs);
    },
    checkFiles: () => enqueue(() => checkFilesNow("files-win")),
    flushScore: () => enqueue(flushScoreNow),
    async stop() {
      stopped = true;
      if (fileTimer) clearTimeout(fileTimer);
      if (scoreTimer) clearTimeout(scoreTimer);
      if (poll) clearInterval(poll);
      watchers.forEach((watcher) => watcher.close());
      watchers = [];
      await queue.catch(() => undefined);
    },
  });
}

/** Project-relative source paths: `song.ts` and each track file under `tracks/`. */
export async function projectSourceFiles(project: string): Promise<string[]> {
  const files = ["song.ts"];
  let dirs: string[] = [];
  try {
    dirs = (await readdir(join(project, "tracks"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    dirs = [];
  }
  for (const dir of dirs.slice(0, MAX_TRACKED_FILES)) {
    const path = `tracks/${dir}/track.ts`;
    try {
      if ((await stat(join(project, path))).isFile()) files.push(path);
    } catch {
      // A directory without a track file (samples only) is not a source.
    }
  }
  return files;
}

function isProjectSource(name: string): boolean {
  return (
    name === "song.ts" || /(^|\/)track\.ts$/.test(name) || !name.includes(".")
  );
}

async function hashProject(project: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await projectSourceFiles(project)) {
    const text = await readOptional(join(project, path));
    if (text !== undefined) out.set(path, sha256(text));
  }
  return out;
}

function sameHashes(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [path, hash] of a) if (b.get(path) !== hash) return false;
  return true;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** `2 notes, 1 track` style summary of a plan for the activity card. */
export function summarize(operations: readonly ScoreOperation[]): string {
  const counts = new Map<string, number>();
  for (const op of operations) {
    const key = op.type.endsWith("Note")
      ? "note"
      : op.type.endsWith("Track")
        ? "track"
        : "setting";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => `${count} ${key}${count === 1 ? "" : "s"}`)
    .join(", ");
}

export type { Diagnostic };
