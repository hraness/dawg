/**
 * Who made an external edit to the project files (design §5.3).
 *
 * The project sync applies any change to `song.ts` or `tracks/**` as one
 * `files.apply` revision. This module decides whom that revision credits,
 * in order:
 *
 *  1. dawg's own agent: a `write_file` (or a subagent's) leaves a pending
 *     attribution in memory for 30 s; the next apply whose changed files
 *     all match those contents takes it.
 *  2. A coding agent in another terminal: `dawg check` writes
 *     `.dawg/external.json` with the hashes it just checked and the actor
 *     (`DAWG_ACTOR`, or `dawg check --as <actor>`). An apply within 10 min
 *     whose changed files all match those hashes credits that actor.
 *     A coding agent usually saves first and checks second, so the reload
 *     lands as a plain save; a heartbeat arriving within 2 min with exactly
 *     the applied contents then credits that revision late
 *     (`noteUnattributed` / `claimLate`).
 *  3. Anything else is `external` · `file`: a human's own editor save is
 *     not credited to a coding agent, because its hashes differ from the
 *     ones `dawg check` saw (unless the agent then checks that very save).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PENDING_MS = 30_000;
export const HEARTBEAT_MS = 10 * 60_000;
export const HEARTBEAT_FILE = ".dawg/external.json";
/** How long after a plain-save apply a trailing heartbeat may claim it. */
export const LATE_MS = 2 * 60_000;
const CLOCK_SLACK_MS = 2_000;
const MAX_UNCLAIMED = 16;
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

type Pending = { who: Attribution; files: Map<string, string>; at: number };

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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

/**
 * The window's memory of its own agent's writes. One per window; the
 * project sync asks it first.
 */
export class Attributor {
  private pending: Pending[] = [];
  private unclaimed: { rev: number; files: Map<string, string>; at: number }[] =
    [];
  private readonly now: () => number;

  public constructor(
    private readonly project: string,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * dawg's agent (or a subagent, by label) just wrote `path` (relative to
   * the project) with these contents.
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
    this.expire();
    const files = new Map([[normalize(path), sha256(text)]]);
    // Consecutive writes by the same writer fold into one pending entry, so
    // an edit spanning two files matches as a whole.
    const last = this.pending.at(-1);
    if (last && last.who.kind === who.kind && last.who.id === who.id) {
      for (const [key, hash] of files) last.files.set(key, hash);
      last.at = this.now();
      return;
    }
    this.pending.push({ who, files, at: this.now() });
  }

  /**
   * Whom an apply of these changed files (path → sha256 of the applied
   * contents, undefined for a deleted file) credits. A matching pending
   * entry is consumed.
   */
  public async attribute(
    changed: ReadonlyMap<string, string | undefined>,
  ): Promise<Attribution> {
    this.expire();
    if (changed.size === 0) return FILE_ATTRIBUTION;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const entry = this.pending[index]!;
      if (matches(changed, entry.files)) {
        this.pending.splice(index, 1);
        return entry.who;
      }
    }
    const beat = await readHeartbeat(this.project);
    if (
      beat &&
      this.now() - beat.at <= HEARTBEAT_MS &&
      matches(changed, beat.files)
    )
      return { kind: "external", id: beat.actor };
    return FILE_ATTRIBUTION;
  }

  /**
   * An apply this window credited to a plain save: if a `dawg check --as`
   * heartbeat with exactly these contents lands within 2 minutes, the
   * revision is credited to that actor after all (a coding agent edits
   * first and checks second, so its heartbeat usually trails the reload).
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
   * Revisions a fresh heartbeat claims (each once): the heartbeat is newer
   * than the apply and its hashes cover every file the apply changed.
   */
  public async claimLate(): Promise<{ rev: number; actor: string }[]> {
    if (!this.claimable) return [];
    const beat = await readHeartbeat(this.project);
    if (!beat || this.now() - beat.at > LATE_MS) return [];
    const claimed: { rev: number; actor: string }[] = [];
    this.unclaimed = this.unclaimed.filter((entry) => {
      if (beat.at < entry.at - CLOCK_SLACK_MS) return true;
      if (!matches(entry.files, beat.files)) return true;
      claimed.push({ rev: entry.rev, actor: beat.actor });
      return false;
    });
    return claimed;
  }

  private expire(): void {
    const cutoff = this.now() - PENDING_MS;
    this.pending = this.pending.filter((entry) => entry.at >= cutoff);
    const late = this.now() - LATE_MS;
    this.unclaimed = this.unclaimed.filter((entry) => entry.at >= late);
  }
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
  return { actor, at, files };
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
): Promise<void> {
  const path = join(project, HEARTBEAT_FILE);
  await mkdir(dirname(path), { recursive: true });
  const body = {
    actor: cleanActor(actor) ?? "external",
    at: at.toISOString(),
    files: Object.fromEntries([...files].slice(0, MAX_FILES)),
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
