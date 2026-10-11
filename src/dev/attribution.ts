/**
 * Who made an external edit to the project files (design §5.3).
 *
 * The project sync applies any change to `song.ts` or `tracks/**` as one
 * `files.apply` revision. This module decides whom that revision credits,
 * in order:
 *
 *  1. dawg's own agent: a `write_file`/`edit_file`, or a file an `exec` run
 *     changed (or a subagent's), leaves a pending attribution for 30 s in
 *     `.dawg/agent-writes.json`, shared by every window on the project, so
 *     whichever window applies the change credits it. An apply whose changed
 *     files all match takes it; a pending write noted just after the apply
 *     (an `exec` run, a race with another window's watcher) claims that
 *     revision late.
 *  2. A coding agent in another terminal: `dawg check` writes
 *     `.dawg/external.json` with the hashes it just checked and the actor
 *     (`DAWG_ACTOR`, `dawg check --as <actor>`, or `claude-code` inside
 *     Claude Code). An apply within 10 min whose changed files all match
 *     those hashes credits that actor: the check saw contents the editor had
 *     not applied yet.
 *     A coding agent usually saves first and checks second, so the reload
 *     lands as a plain save. A heartbeat cannot tell which of the files it
 *     hashed the agent wrote, so a trailing heartbeat claims a plain save
 *     late only for files it names explicitly (`dawg check --files a,b`,
 *     the heartbeat's `changed` list), within 2 min and with exactly the
 *     applied contents (`noteUnattributed` / `claimLate`).
 *  3. Anything else is `external` · `file`: a human's own editor save is
 *     never credited to a coding agent just because the agent checked the
 *     project afterwards.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { projectSourceFiles } from "../project/sync.ts";

export const PENDING_MS = 30_000;
export const HEARTBEAT_MS = 10 * 60_000;
export const HEARTBEAT_FILE = ".dawg/external.json";
/** Pending writes of dawg's agent, shared by every window on the project. */
export const AGENT_WRITES_FILE = ".dawg/agent-writes.json";
/** How long after a plain-save apply a trailing heartbeat may claim it. */
export const LATE_MS = 2 * 60_000;
const CLOCK_SLACK_MS = 2_000;
const MAX_UNCLAIMED = 16;
const MAX_PENDING = 32;
const MAX_FILES = 256;
const MAX_ACTOR = 64;

/** Whom a `files.apply` revision credits. */
export type Attribution = Readonly<{
  kind: "agent" | "subagent" | "external";
  /** `claude-code`, a subagent label, or `file` for an unattributed save. */
  id: string;
}>;

export const FILE_ATTRIBUTION: Attribution = Object.freeze({
  kind: "external",
  id: "file",
});

type Pending = {
  id: string;
  who: Attribution;
  files: Map<string, string>;
  at: number;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Hashes of the project's sources, as the running editor's sync sees them. */
export async function projectSourceHashes(
  project: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await projectSourceFiles(project)) {
    try {
      out.set(path, sha256(await readFile(join(project, path), "utf8")));
    } catch {
      // vanished between the walk and the read
    }
  }
  return out;
}

/** Paths whose hash differs between two snapshots (deleted files excluded). */
export function changedSources(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  return [...after]
    .filter(([path, hash]) => before.get(path) !== hash)
    .map(([path]) => path);
}

/** A bounded, printable actor name; undefined when nothing usable is left. */
export function cleanActor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  // eslint-disable-next-line no-control-regex
  const flat = value
    .trim()
    .replace(/[\u0000-\u001f\u007f\s]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clipped = flat.slice(0, MAX_ACTOR);
  return clipped.length > 0 ? clipped : undefined;
}

/** A late credit: revision `rev` was made by `who` after all. */
export type LateClaim = Readonly<{ rev: number; who: Attribution }>;

/**
 * Attribution for one window. Its agent's pending writes live in the shared
 * `.dawg/agent-writes.json`; its plain-save applies awaiting a late credit
 * stay in memory (only the window that applied can credit its row).
 */
export class Attributor {
  private unclaimed: { rev: number; files: Map<string, string>; at: number }[] =
    [];
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  public constructor(
    private readonly project: string,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * dawg's agent (or a subagent, by label) just wrote `path` (relative to
   * the project) with these contents. Recorded for every window; `settled`
   * resolves once it is on disk. Call it after the file is written.
   */
  public noteAgentWrite(
    path: string,
    text: string,
    subagent?: string | undefined,
  ): void {
    const who: Attribution =
      subagent === undefined
        ? { kind: "agent", id: "agent" }
        : { kind: "subagent", id: cleanActor(subagent) ?? "subagent" };
    const key = normalize(path);
    const hash = sha256(text);
    const at = this.now();
    void this.serial(() =>
      this.mutateShared((entries) => {
        // Consecutive writes by the same writer fold into one pending
        // entry, so an edit spanning two files matches as a whole.
        const last = entries.at(-1);
        if (last && last.who.kind === who.kind && last.who.id === who.id) {
          last.files.set(key, hash);
          last.at = at;
        } else
          entries.push({
            id: randomUUID(),
            who,
            files: new Map([[key, hash]]),
            at,
          });
        return entries.slice(-MAX_PENDING);
      }),
    );
  }

  /** Resolves once every noted write is on disk. */
  public settled(): Promise<void> {
    return this.queue;
  }

  /**
   * Whom an apply of these changed files (path → sha256 of the applied
   * contents, undefined for a deleted file) credits. A matching pending
   * entry is consumed.
   */
  public async attribute(
    changed: ReadonlyMap<string, string | undefined>,
  ): Promise<Attribution> {
    if (changed.size === 0) return FILE_ATTRIBUTION;
    let taken: Pending | undefined;
    await this.serial(async () => {
      await this.mutateShared((entries) => {
        for (let index = entries.length - 1; index >= 0; index -= 1)
          if (matches(changed, entries[index]!.files)) {
            taken = entries.splice(index, 1)[0];
            break;
          }
        return entries;
      });
    });
    if (taken) return taken.who;
    const beat = await readHeartbeat(this.project);
    if (
      beat &&
      this.now() - beat.at <= HEARTBEAT_MS &&
      matches(changed, beat.files) &&
      (beat.changed === undefined || covers(beat.changed, changed))
    )
      return { kind: "external", id: beat.actor };
    return FILE_ATTRIBUTION;
  }

  /**
   * An apply this window credited to a plain save: a pending agent write
   * noted just after it, or a `dawg check --files` heartbeat naming exactly
   * these contents within 2 minutes, credits the revision late.
   */
  public noteUnattributed(
    rev: number,
    changed: ReadonlyMap<string, string | undefined>,
  ): void {
    if (changed.size === 0 || [...changed.values()].includes(undefined)) return;
    this.expire();
    const files = new Map<string, string>();
    for (const [path, hash] of changed) files.set(normalize(path), hash!);
    this.unclaimed.push({ rev, files, at: this.now() });
    if (this.unclaimed.length > MAX_UNCLAIMED) this.unclaimed.shift();
  }

  /** True while a recent plain-save apply could still be claimed. */
  public get claimable(): boolean {
    this.expire();
    return this.unclaimed.length > 0;
  }

  /**
   * Revisions claimed late (each once): first by a pending agent write with
   * exactly the applied contents, then by a heartbeat newer than the apply
   * whose explicit `changed` list and hashes cover every file it changed.
   * A heartbeat without that list (a plain `dawg check`) claims nothing:
   * it hashes every source, so it cannot tell the agent's save from yours.
   */
  public async claimLate(): Promise<LateClaim[]> {
    if (!this.claimable) return [];
    const claimed: LateClaim[] = [];
    await this.serial(async () => {
      await this.mutateShared((entries) => {
        this.unclaimed = this.unclaimed.filter((entry) => {
          for (let index = entries.length - 1; index >= 0; index -= 1)
            if (matches(entry.files, entries[index]!.files)) {
              claimed.push({ rev: entry.rev, who: entries[index]!.who });
              entries.splice(index, 1);
              return false;
            }
          return true;
        });
        return entries;
      });
    });
    const beat = await readHeartbeat(this.project);
    if (beat?.changed && this.now() - beat.at <= LATE_MS) {
      const changed = beat.changed;
      this.unclaimed = this.unclaimed.filter((entry) => {
        if (beat.at < entry.at - CLOCK_SLACK_MS) return true;
        if (!covers(changed, entry.files)) return true;
        if (!matches(entry.files, beat.files)) return true;
        claimed.push({
          rev: entry.rev,
          who: { kind: "external", id: beat.actor },
        });
        return false;
      });
    }
    return claimed;
  }

  /**
   * Serializes this window's read-modify-writes of the shared file. A
   * failed write (read-only project) never fails an apply.
   */
  private serial(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work).catch(() => undefined);
    this.queue = run;
    return run;
  }

  /** Reads the live shared entries, lets `edit` change them, writes back. */
  private async mutateShared(
    edit: (entries: Pending[]) => Pending[],
  ): Promise<void> {
    const before = await readAgentWrites(this.project);
    const cutoff = this.now() - PENDING_MS;
    const live = before.filter((entry) => entry.at >= cutoff);
    const snapshot = JSON.stringify(serialize(before));
    const next = edit(
      live.map((entry) => ({ ...entry, files: new Map(entry.files) })),
    );
    const body = JSON.stringify(serialize(next));
    if (body === snapshot) return;
    await writeShared(this.project, body);
  }

  private expire(): void {
    const late = this.now() - LATE_MS;
    this.unclaimed = this.unclaimed.filter((entry) => entry.at >= late);
  }
}

function serialize(entries: readonly Pending[]): unknown {
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.who.kind,
      by: entry.who.id,
      at: entry.at,
      files: Object.fromEntries(entry.files),
    })),
  };
}

async function writeShared(project: string, body: string): Promise<void> {
  const path = join(project, AGENT_WRITES_FILE);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, `${body}\n`);
  await rename(temp, path);
}

/** `.dawg/agent-writes.json`, skipping malformed entries; [] when absent. */
export async function readAgentWrites(project: string): Promise<Pending[]> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(project, AGENT_WRITES_FILE), "utf8"),
    );
  } catch {
    return [];
  }
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>).entries;
  if (!Array.isArray(list)) return [];
  const out: Pending[] = [];
  for (const raw of list.slice(-MAX_PENDING)) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const kind = item.kind;
    const by = cleanActor(typeof item.by === "string" ? item.by : undefined);
    if ((kind !== "agent" && kind !== "subagent") || !by) continue;
    if (typeof item.at !== "number" || !Number.isFinite(item.at)) continue;
    const files = new Map<string, string>();
    if (typeof item.files === "object" && item.files !== null)
      for (const [path, hash] of Object.entries(
        item.files as Record<string, unknown>,
      ).slice(0, MAX_FILES))
        if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))
          files.set(normalize(path), hash);
    if (files.size === 0) continue;
    out.push({
      id: typeof item.id === "string" ? item.id : randomUUID(),
      who: { kind, id: by },
      files,
      at: item.at,
    });
  }
  return out;
}

/** Every path of `changed` is in the explicit list. */
function covers(
  list: readonly string[],
  changed: ReadonlyMap<string, string | undefined>,
): boolean {
  const named = new Set(list);
  for (const path of changed.keys())
    if (!named.has(normalize(path))) return false;
  return true;
}

/** Every changed file has the contents the writer recorded. */
function matches(
  changed: ReadonlyMap<string, string | undefined>,
  recorded: ReadonlyMap<string, string>,
): boolean {
  for (const [path, hash] of changed) {
    if (hash === undefined) return false;
    if (recorded.get(normalize(path)) !== hash) return false;
  }
  return true;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export type Heartbeat = Readonly<{
  actor: string;
  at: number;
  files: ReadonlyMap<string, string>;
  /**
   * The files the actor says it changed (`dawg check --files`); only these
   * may claim a plain save late. Absent: no late claims.
   */
  changed?: readonly string[];
}>;

/** `.dawg/external.json`, or undefined when absent or malformed. */
export async function readHeartbeat(
  project: string,
): Promise<Heartbeat | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(project, HEARTBEAT_FILE), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const actor = cleanActor(
    typeof record.actor === "string" ? record.actor : undefined,
  );
  const at = typeof record.at === "string" ? Date.parse(record.at) : NaN;
  if (!actor || !Number.isFinite(at)) return undefined;
  const files = new Map<string, string>();
  if (typeof record.files === "object" && record.files !== null)
    for (const [path, hash] of Object.entries(
      record.files as Record<string, unknown>,
    ).slice(0, MAX_FILES))
      if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))
        files.set(normalize(path), hash);
  const changed = Array.isArray(record.changed)
    ? record.changed
        .filter((path): path is string => typeof path === "string")
        .slice(0, MAX_FILES)
        .map(normalize)
    : undefined;
  return { actor, at, files, ...(changed ? { changed } : {}) };
}

/**
 * Records that `actor` just checked these files (path → sha256). Written
 * by `dawg check`; replaces the previous heartbeat atomically. `.dawg/` is
 * created only inside an existing project (the caller checks).
 */
export async function writeHeartbeat(
  project: string,
  actor: string,
  files: ReadonlyMap<string, string>,
  at: Date = new Date(),
  changed?: readonly string[],
): Promise<void> {
  const path = join(project, HEARTBEAT_FILE);
  await mkdir(dirname(path), { recursive: true });
  const body = {
    actor: cleanActor(actor) ?? "external",
    at: at.toISOString(),
    files: Object.fromEntries([...files].slice(0, MAX_FILES)),
    ...(changed !== undefined
      ? { changed: changed.slice(0, MAX_FILES).map(normalize) }
      : {}),
  };
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`);
  await rename(temp, path);
}

/** `by claude-code`, `by agent`, `by sub:drums`; empty for a plain save. */
export function attributionLabel(who: Attribution): string {
  if (who.kind === "subagent") return `by sub:${who.id}`;
  if (who.kind === "agent") return "by agent";
  return who.id === "file" ? "" : `by ${who.id}`;
}
