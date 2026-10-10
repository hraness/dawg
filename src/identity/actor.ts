/**
 * Actor identity placeholder: who made an edit, stable across windows and
 * restarts on one machine. No keys and no login; a later signed identity can
 * bind to this id. It is sent only on the session protocol (`hello`), never
 * to model gateways or anywhere else.
 *
 * File: `<config>/actor.json` = `{ "id": "a_<22 base32>", "name": "$USER" }`,
 * created once with an exclusive atomic write so concurrent first runs agree.
 */
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { join } from "node:path";
import { configDir } from "../auth/credentials.ts";
import { randomBase32, setIdSalt } from "../../core/ids.ts";

export type Actor = Readonly<{ id: string; name: string }>;

export const ACTOR_ID = /^a_[a-z2-7]{22}$/;
const MAX_NAME_LENGTH = 64;

export function isActorId(value: unknown): value is string {
  return typeof value === "string" && ACTOR_ID.test(value);
}

export function actorPath(dir: string = configDir()): string {
  return join(dir, "actor.json");
}

function defaultName(env: Readonly<Record<string, string | undefined>>) {
  let name = env.USER || env.LOGNAME || "";
  if (!name) {
    try {
      name = userInfo().username;
    } catch {
      name = "";
    }
  }
  return cleanName(name) || "me";
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function parseActor(text: string): Actor | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (typeof value !== "object" || value === null) return undefined;
    if (!isActorId(value.id)) return undefined;
    return { id: value.id, name: cleanName(value.name) || "me" };
  } catch {
    return undefined;
  }
}

let cached: Actor | undefined;

/** A process-local actor that is never written (tests, read-only configs). */
export function ephemeralActor(name = "me"): Actor {
  return { id: `a_${randomBase32(22)}`, name: cleanName(name) || "me" };
}

/**
 * Reads the actor file, creating it on first run. A corrupt file is replaced
 * (the old id is unrecoverable anyway). Never throws: an unwritable config
 * dir yields an ephemeral actor for this process.
 */
export async function loadActor(
  options: {
    dir?: string;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<Actor> {
  const env = options.env ?? process.env;
  const dir = options.dir ?? configDir(env);
  const path = actorPath(dir);
  const existing = await readFile(path, "utf8").then(
    parseActor,
    () => undefined,
  );
  if (existing) return existing;
  const fresh = ephemeralActor(defaultName(env));
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(fresh)}\n`, { mode: 0o600 });
    try {
      // link() fails if the file exists: the first writer wins, others adopt it.
      await link(temp, path);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EEXIST") throw error;
      const winner = await readFile(path, "utf8").then(
        parseActor,
        () => undefined,
      );
      if (winner) return winner;
      // Corrupt file: replace it.
      await rm(path, { force: true });
      await link(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
    return fresh;
  } catch {
    return fresh;
  }
}

/** Process-wide actor, loaded once; also salts `newId`. */
export async function currentActor(): Promise<Actor> {
  if (!cached) {
    cached = await loadActor();
    setIdSalt(cached.id);
  }
  return cached;
}

/** Tests only. */
export function resetActorCache(): void {
  cached = undefined;
}
