/**
 * Two-way sync between the project files and the session score.
 *
 * files → score: a change to any project source (`song.ts`, track files,
 * helper modules they import, tuning files; fs.watch plus a slow poll,
 * debounced 150 ms) evaluates the project, adopts the session's note ids,
 * diffs against the current score and commits one `files.apply` revision
 * through the session port. A failed evaluation is reported as a card and
 * leaves the score alone.
 *
 * score → files: a new score revision reprints the project and writes only
 * the files whose own slice of the score changed, so an author's formatting
 * and comments in untouched files survive. A file edited since dawg last
 * synced it (hash differs from `.dawg/sync.json`) is never overwritten: the
 * edit wins and a card says so.
 *
 * Echo suppression: `.dawg/sync.json` records the hash of every file as of
 * the last time files and score agreed; a watcher event whose changed files
 * all still hash the same is ignored, in this window and every other one.
 *
 * Ownership: `.dawg/sync.json` names the session the files belong to and
 * the live windows syncing it. A window on a different session while the
 * owner is still open never reads or writes the files.
 */

import { createHash, randomUUID } from "node:crypto";
import { watch, type Dirent, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
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
import { acquireSessionLock } from "../session/lock.ts";
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
  /**
   * The session this window is attached to; it may change when the window
   * switches sessions. Omitted, the files are never treated as owned.
   */
  sessionId?: () => string | undefined;
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

type Holder = { pid: number; token: string };
type SyncOwner = { sessionId: string; holders: Holder[] };
type SyncState = { files: Record<string, string>; owner?: SyncOwner };

/** Tokens of the syncs running in this process (pids alone cannot tell them apart). */
const liveTokens = new Set<string>();
const SYNC_LOCK_FILE = ".dawg/sync.lock";
const MAX_HOLDERS = 64;
const TRACK_FILE = /^tracks\/[^/]+\/track\.ts$/;

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
  const lockPath = join(project, SYNC_LOCK_FILE);
  const token = randomUUID();
  liveTokens.add(token);
  /** Hashes of the project sources as of this window's last look. */
  let seen = new Map<string, string>();
  /** Outcome of the last evaluation, returned when the files did not change. */
  let lastOutcome = "files match the score";
  /** Encoded score the files were last known to equal. */
  let filesEqual = "";
  /** Per file: the canonical print its current contents are known to evaluate to. */
  let known = new Map<string, string>();
  let lastRejection = "";
  let lastConflict = "";
  /** Session id this window last claimed the files for; undefined while detached. */
  let attached: string | undefined;
  let detachedNotice = "";
  /** The next look at the files decides who wins (startup, session switch). */
  let needsStartup = true;
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
      const record = value as Record<string, unknown>;
      const files = record.files;
      const out: Record<string, string> = {};
      if (typeof files === "object" && files !== null)
        for (const [path, hash] of Object.entries(
          files as Record<string, unknown>,
        ))
          if (
            typeof hash === "string" &&
            /^[0-9a-f]{64}$/.test(hash) &&
            path.length < 512
          )
            out[path] = hash;
      const state: SyncState = { files: out };
      const owner = parseOwner(record.owner);
      if (owner) state.owner = owner;
      return state;
    } catch {
      return { files: {} };
    }
  };
  const writeState = (state: SyncState) =>
    writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  /** Serializes every read-modify-write of sync.json and the files across windows. */
  const locked = async <T>(task: () => Promise<T>): Promise<T> => {
    await mkdir(join(project, ".dawg"), { recursive: true });
    const release = await acquireSessionLock(lockPath);
    try {
      return await task();
    } finally {
      await release();
    }
  };

  /**
   * Claims the files for this window's session. A different session owns
   * them while any of its windows is still open: this window then stays
   * detached and never touches the files. Returns whether the files are
   * this window's; a changed session makes the next look a fresh startup.
   */
  const claim = async (): Promise<{ ok: boolean }> => {
    const sessionId = host.sessionId?.();
    if (sessionId === undefined) return { ok: true };
    const result = await locked(async () => {
      const state = await readState();
      const owner = state.owner;
      const others = (owner?.holders ?? []).filter(
        (holder) => holder.token !== token && holderAlive(holder),
      );
      if (owner && owner.sessionId !== sessionId && others.length > 0)
        return { ok: false, owner: owner.sessionId };
      const holders =
        owner?.sessionId === sessionId
          ? [...others, { pid: process.pid, token }]
          : [{ pid: process.pid, token }];
      const next: SyncOwner = {
        sessionId,
        holders: holders.slice(-MAX_HOLDERS),
      };
      if (JSON.stringify(next) !== JSON.stringify(owner))
        await writeState({ ...state, owner: next });
      return { ok: true, owner: sessionId };
    });
    if (!result.ok) {
      attached = undefined;
      const notice = `files belong to session ${result.owner}`;
      if (notice !== detachedNotice) {
        detachedNotice = notice;
        host.card(
          `${notice} · not synced here`,
          "warning",
          "another window has them open; close it or switch to that session",
        );
      }
      return { ok: false };
    }
    detachedNotice = "";
    if (attached !== sessionId) needsStartup = true;
    attached = sessionId;
    return { ok: true };
  };

  const recordSynced = async (hashes: Map<string, string>): Promise<void> => {
    await locked(async () => {
      const state = await readState();
      const files = { ...state.files };
      for (const [path, hash] of hashes) files[path] = hash;
      for (const path of Object.keys(files))
        if (!hashes.has(path) && !(await exists(join(project, path))))
          delete files[path];
      await writeState({ ...state, files });
    });
  };

  /**
   * Evaluates the files. In `files-win` mode (edits) the result is committed;
   * in `score-wins` mode (startup with unchanged files) a difference reprints
   * the files from the score instead.
   */
  const checkFilesNow = async (
    requested: "files-win" | "score-wins" = "files-win",
  ): Promise<string> => {
    let mode = requested;
    if (stopped) return lastOutcome;
    const claimed = await claim();
    if (!claimed.ok) return (lastOutcome = detachedNotice);
    if (needsStartup) {
      // First look (or this window switched sessions): files edited since
      // dawg last synced them (or never recorded) win; otherwise the
      // session score wins and reprints what the files lack.
      needsStartup = false;
      seen = new Map();
      known = new Map();
      filesEqual = "";
      const state = await readState();
      const hashes = await hashProject(project);
      const edited =
        hashes.size === 0 ||
        [...hashes].some(([path, hash]) => state.files[path] !== hash);
      mode = edited ? "files-win" : "score-wins";
    }
    const current = await hashProject(project);
    if (mode === "files-win") {
      // Nothing re-evaluated: a standing rejection still holds, anything
      // else is reported as unchanged rather than repeating an old apply.
      if (sameHashes(current, seen))
        return lastRejection ? lastOutcome : (lastOutcome = UNCHANGED);
      // An echo: every changed file is exactly what dawg (this window or
      // another) last synced, so the session already holds it.
      const state = await readState();
      const changed = changedPaths(current, seen);
      if (
        seen.size > 0 &&
        !lastRejection &&
        changed.every(
          (path) =>
            current.get(path) !== undefined &&
            state.files[path] === current.get(path),
        )
      ) {
        for (const path of changed) known.delete(path);
        seen = current;
        return (lastOutcome = "files match the score");
      }
    }
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
      seen = current;
      void runTypecheck();
      return (lastOutcome = `files rejected · ${text}`);
    }
    lastRejection = "";
    seen = current;
    known = printedTexts(result.score);
    const plan = applyFiles(host.current(), result.score);
    if (plan.operations.length === 0) {
      filesEqual = encodeLoop(host.current());
      await recordSynced(current);
      void runTypecheck();
      return (lastOutcome = "files match the score");
    }
    if (mode === "score-wins") {
      pendingScore = host.current();
      await recordSynced(current);
      await flushScoreNow();
      void runTypecheck();
      return (lastOutcome = "files reprinted from the score");
    }
    const summary = summarize(plan.operations);
    try {
      const committed = await host.commit(plan, summary);
      filesEqual = encodeLoop(committed);
      await recordSynced(current);
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
    const claimed = await claim();
    if (!claimed.ok) return;
    if (needsStartup) await checkFilesNow("files-win");
    if (stopped || !pendingScore) return;
    const score = pendingScore;
    pendingScore = undefined;
    const encoded = encodeLoop(score);
    if (encoded === filesEqual) return;
    const printed = printProject(score);
    const conflicts: string[] = [];
    /** Paths this flush wrote (hash) or removed (undefined). */
    const wrote = new Map<string, string | undefined>();
    await locked(async () => {
      const state = await readState();
      const files = { ...state.files };
      const expected = new Set(printed.files.map((file) => file.path));
      for (const file of printed.files) {
        const path = join(project, file.path);
        const existing = await readOptional(path);
        if (existing === file.text) {
          files[file.path] = sha256(existing);
          known.set(file.path, file.text);
          continue;
        }
        // This file's slice of the score is unchanged: keep the author's text.
        if (existing !== undefined && known.get(file.path) === file.text)
          continue;
        // Edited since dawg last synced it (or never synced): the edit wins.
        if (existing !== undefined && files[file.path] !== sha256(existing)) {
          conflicts.push(file.path);
          continue;
        }
        await writeAtomic(path, file.text);
        files[file.path] = sha256(file.text);
        wrote.set(file.path, files[file.path]);
        known.set(file.path, file.text);
      }
      // Track files dawg printed earlier for tracks that no longer exist.
      for (const [path, hash] of Object.entries(state.files)) {
        if (expected.has(path) || !TRACK_FILE.test(path)) continue;
        const existing = await readOptional(join(project, path));
        if (existing !== undefined && sha256(existing) !== hash) continue;
        if (existing !== undefined)
          await rm(join(project, path), { force: true });
        wrote.set(path, undefined);
        delete files[path];
        known.delete(path);
      }
      await writeState({ ...state, files });
    });
    // Only our own writes are folded into `seen`: an edit the author saved
    // to any other file since the last look must still be evaluated. While
    // the files are rejected nothing is folded, so the next look re-evaluates.
    if (!lastRejection) {
      seen = new Map(seen);
      for (const [path, hash] of wrote)
        if (hash === undefined) seen.delete(path);
        else seen.set(path, hash);
    }
    if (conflicts.length === 0) {
      filesEqual = encoded;
      lastConflict = "";
      return;
    }
    filesEqual = "";
    const text = conflicts.join(", ");
    if (text !== lastConflict) {
      lastConflict = text;
      host.card(
        `${text} edited · not overwritten`,
        "warning",
        "save it to apply, or delete it to reprint",
      );
    }
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

  /** Errors (a lock timeout, a full disk) become a card, never an unhandled rejection. */
  const guarded =
    <T>(task: () => Promise<T>, fallback: T) =>
    async (): Promise<T> => {
      try {
        return await task();
      } catch (error) {
        host.card(
          `file sync failed · ${firstLine(error instanceof Error ? error.message : String(error))}`,
          "warning",
        );
        return fallback;
      }
    };
  const filesWin = guarded(() => checkFilesNow("files-win"), "");
  const flush = guarded(flushScoreNow, undefined);

  const scheduleFiles = () => {
    if (stopped) return;
    if (fileTimer) clearTimeout(fileTimer);
    fileTimer = setTimeout(() => {
      fileTimer = undefined;
      void enqueue(filesWin);
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
      () => void enqueue(filesWin),
      options.pollMs ?? SYNC_POLL_MS,
    );
    poll.unref?.();
  }
  void enqueue(filesWin);

  return Object.freeze({
    scoreChanged(score: TrackScore) {
      if (stopped) return;
      pendingScore = score;
      if (scoreTimer) clearTimeout(scoreTimer);
      scoreTimer = setTimeout(() => {
        scoreTimer = undefined;
        void enqueue(flush);
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
      liveTokens.delete(token);
      // Release this window's hold so another session may take the files.
      await locked(async () => {
        const state = await readState();
        if (!state.owner?.holders.some((holder) => holder.token === token))
          return;
        await writeState({
          ...state,
          owner: {
            ...state.owner,
            holders: state.owner.holders.filter(
              (holder) => holder.token !== token,
            ),
          },
        });
      }).catch(() => undefined);
    },
  });
}

/** Text extensions a project's evaluation can read: modules, data and tuning. */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|json|scl|kbm)$/;
const MAX_SOURCE_DEPTH = 6;
/** Outcome when no project source changed since the last look. */
export const UNCHANGED = "files unchanged";
/** Project configuration, not evaluated: editing it never re-evaluates. */
const CONFIG_FILES = new Set([
  "dawg.json",
  "tsconfig.json",
  "jsconfig.json",
  "package.json",
]);
/** Larger files are fingerprinted by size and mtime instead of content. */
const MAX_HASHED_BYTES = 2 * 1024 * 1024;

/**
 * Project-relative source paths: `song.ts`, each `tracks/<slug>/track.ts`,
 * and every other module, JSON or tuning file in the project that an
 * evaluation could import or read. Dot directories (`.dawg`, `.git`) and
 * `node_modules` are skipped; bounded by count and depth.
 */
export async function projectSourceFiles(project: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SOURCE_DEPTH || out.length >= MAX_TRACKED_FILES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(join(project, dir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= MAX_TRACKED_FILES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (CONFIG_FILES.has(path)) continue;
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name))
        out.push(path);
    }
  };
  await walk("", 0);
  return out.sort(
    (a, b) => sourceRank(a) - sourceRank(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** `song.ts` first, then track files, then everything else. */
function sourceRank(path: string): number {
  return path === "song.ts" ? 0 : TRACK_FILE.test(path) ? 1 : 2;
}

function isProjectSource(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (base.startsWith(".") && base.length > 0) return false;
  return SOURCE_EXTENSION.test(base) || !base.includes(".");
}

async function hashProject(project: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await projectSourceFiles(project)) {
    const hash = await hashFile(join(project, path));
    if (hash !== undefined) out.set(path, hash);
  }
  return out;
}

async function hashFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (info.size > MAX_HASHED_BYTES)
      return sha256(`${info.size}:${info.mtimeMs}`);
    return sha256(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function printedTexts(score: TrackScore): Map<string, string> {
  return new Map(
    printProject(score).files.map((file) => [file.path, file.text]),
  );
}

function changedPaths(
  a: Map<string, string>,
  b: Map<string, string>,
): string[] {
  const out = new Set<string>();
  for (const [path, hash] of a) if (b.get(path) !== hash) out.add(path);
  for (const path of b.keys()) if (!a.has(path)) out.add(path);
  return [...out];
}

function parseOwner(value: unknown): SyncOwner | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    record.sessionId.length > 128 ||
    !Array.isArray(record.holders)
  )
    return undefined;
  const holders: Holder[] = [];
  for (const holder of record.holders.slice(0, MAX_HOLDERS)) {
    if (typeof holder !== "object" || holder === null) continue;
    const { pid, token } = holder as Record<string, unknown>;
    if (
      typeof pid === "number" &&
      Number.isSafeInteger(pid) &&
      pid > 0 &&
      typeof token === "string" &&
      token.length > 0 &&
      token.length <= 64
    )
      holders.push({ pid, token });
  }
  return { sessionId: record.sessionId, holders };
}

function holderAlive(holder: Holder): boolean {
  if (holder.pid === process.pid) return liveTokens.has(holder.token);
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
