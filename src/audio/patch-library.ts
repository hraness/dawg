/**
 * Where patches come from besides the project (design §10): the user
 * library and patch packs.
 *
 * - **User library:** `$XDG_DATA_HOME/dawg/patches/<name>.json` (default
 *   `~/.local/share/dawg/patches`, `DAWG_PATCHES_DIR` overrides), plain data
 *   `{ sdk, patch, macros?, author?, license?, tags? }`.
 * - **Packs:** `patch load github:<user>/<repo>[@<branch>]/<name>` reads the
 *   repo's `patches.json` manifest (`{ license?, patches: { name: file } }`)
 *   and the patch file it names, through the sample-pack cache
 *   (src/audio/packs.ts: https only, bounded, cached by URL, sha256 pinned).
 *   The loaded patch records `from: "pack:<user>/<repo>/<name>@<sha12>"`.
 *
 * A patch is plain data that runs only dawg's own nodes, so loading one
 * never runs code. Every file is validated before it is returned.
 */
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  checkPatchName,
  validatePatch,
  type Patch,
  PatchValidationError,
} from "../../core/patch.ts";
import { SDK_VERSION } from "../../core/sdk/v1.ts";
import { PackError, PackStore, type PackStoreOptions } from "./packs.ts";

/** One user-library file. */
export type UserPatchFile = Readonly<{
  sdk: string;
  patch: Patch;
  /** Knob settings at save time, by macro id. */
  macros?: Readonly<Record<string, number>>;
  author?: string;
  license?: string;
  tags?: readonly string[];
}>;

/** A pack patch, ready to use, with its provenance. */
export type LoadedPatch = Readonly<{
  patch: Patch;
  /** `pack:<user>/<repo>/<name>@<sha12>`, also on `patch.from`. */
  from: string;
  sha256: string;
  license: string;
  url: string;
  cached: boolean;
}>;

/** The user patch directory. */
export function userPatchDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DAWG_PATCHES_DIR) return env.DAWG_PATCHES_DIR;
  const data =
    env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
  return join(data, "dawg", "patches");
}

function fileFor(dir: string, name: string): string {
  return join(dir, `${checkPatchName(name, "patch name")}.json`);
}

/** Reads one file's JSON as a patch: a library file or a bare patch. */
export function parsePatchFile(json: unknown, label: string): UserPatchFile {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new PatchValidationError(`${label} is not a patch file`);
  const record = json as Record<string, unknown>;
  const raw = record.patch ?? record;
  const patch = validatePatch(raw, { label });
  const macros = record.macros;
  const out: {
    sdk: string;
    patch: Patch;
    macros?: Record<string, number>;
    author?: string;
    license?: string;
    tags?: string[];
  } = {
    sdk: typeof record.sdk === "string" ? record.sdk : SDK_VERSION,
    patch,
  };
  if (macros && typeof macros === "object" && !Array.isArray(macros)) {
    const known = new Map(patch.macros.map((macro) => [macro.id, macro]));
    const values: Record<string, number> = {};
    for (const [id, value] of Object.entries(macros)) {
      const macro = known.get(id);
      if (macro && typeof value === "number" && Number.isFinite(value))
        values[id] = Math.min(macro.max, Math.max(macro.min, value));
    }
    if (Object.keys(values).length > 0) out.macros = values;
  }
  if (typeof record.author === "string")
    out.author = record.author.slice(0, 200);
  if (typeof record.license === "string")
    out.license = record.license.slice(0, 200);
  if (Array.isArray(record.tags))
    out.tags = record.tags
      .filter((tag): tag is string => typeof tag === "string")
      .slice(0, 16)
      .map((tag) => tag.slice(0, 40));
  return out;
}

/** Writes `patch` to the user library; returns the file path. */
export async function saveUserPatch(
  patch: Patch,
  options: Readonly<{
    dir?: string;
    name?: string;
    macros?: Readonly<Record<string, number>>;
    author?: string;
    license?: string;
    tags?: readonly string[];
  }> = {},
): Promise<string> {
  const dir = options.dir ?? userPatchDir();
  const name = options.name ?? patch.name;
  const saved = validatePatch({ ...patch, name }, { label: `patch ${name}` });
  const file: UserPatchFile = {
    sdk: SDK_VERSION,
    patch: saved,
    ...(options.macros && Object.keys(options.macros).length > 0
      ? { macros: options.macros }
      : {}),
    ...(options.author ? { author: options.author } : {}),
    ...(options.license ? { license: options.license } : {}),
    ...(options.tags?.length ? { tags: options.tags } : {}),
  };
  const path = fileFor(dir, name);
  await mkdir(dir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
  await rename(temporary, path);
  return path;
}

/** The user-library patch `name`, or undefined when there is no such file. */
export async function readUserPatch(
  name: string,
  dir: string = userPatchDir(),
): Promise<UserPatchFile | undefined> {
  let text: string;
  try {
    text = await readFile(fileFor(dir, name), "utf8");
  } catch {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PatchValidationError(`user patch ${name} is not valid JSON`);
  }
  return parsePatchFile(json, `user patch ${name}`);
}

/** Names in the user library, sorted. */
export async function listUserPatches(
  dir: string = userPatchDir(),
): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((file) => /^[a-z][a-z0-9-]*\.json$/.test(file))
      .map((file) => file.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Packs

/** `github:<user>/<repo>[@<branch>]/<name>`. */
const PATCH_SOURCE =
  /^github:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:@([A-Za-z0-9_./-]{1,100}?))?\/([a-z][a-z0-9-]{0,47})$/;

export type PatchSource = Readonly<{
  user: string;
  repo: string;
  branch: string;
  name: string;
  /** The repo's `patches.json`. */
  manifestUrl: string;
}>;

/** Whether `text` is a pack source rather than a library name. */
export function isPatchSource(text: string): boolean {
  return text.trim().startsWith("github:");
}

/** Parses a `github:` patch source; throws a PackError naming the shape. */
export function parsePatchSource(text: string): PatchSource {
  const match = PATCH_SOURCE.exec(text.trim());
  if (
    !match ||
    match.slice(1).some((part) => part && /(^|\/)\.\.?(\/|$)/.test(part))
  )
    throw new PackError(
      `${text.trim().slice(0, 80)} · use github:<user>/<repo>[@<branch>]/<patch>`,
    );
  const [, user, repo, branch = "main", name] = match;
  return {
    user: user!,
    repo: repo!,
    branch,
    name: name!,
    manifestUrl: `https://raw.githubusercontent.com/${user}/${repo}/${branch}/patches.json`,
  };
}

type PatchManifest = Readonly<{
  license: string;
  patches: Readonly<Record<string, string>>;
}>;

function parseManifest(bytes: Uint8Array, url: string): PatchManifest {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PackError(`${url} · not valid JSON`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new PackError(`${url} · not a patch manifest`);
  const record = json as Record<string, unknown>;
  const patches = record.patches;
  if (typeof patches !== "object" || patches === null || Array.isArray(patches))
    throw new PackError(`${url} · no "patches" table`);
  const table: Record<string, string> = {};
  for (const [name, file] of Object.entries(patches))
    if (
      typeof file === "string" &&
      /^[A-Za-z0-9_./-]{1,200}$/.test(file) &&
      !/(^|\/)\.\.?(\/|$)/.test(file)
    )
      table[name] = file;
  return {
    license:
      typeof record.license === "string" && record.license.trim()
        ? record.license.trim().slice(0, 100)
        : "none stated",
    patches: table,
  };
}

/**
 * Loads a pack patch. `pin` (a sha256, or its first 12 characters from a
 * `from` field) refuses a file that changed upstream.
 */
export async function loadPatchSource(
  text: string,
  options: PackStoreOptions &
    Readonly<{ store?: PackStore; pin?: string }> = {},
): Promise<LoadedPatch> {
  const source = parsePatchSource(text);
  const store = options.store ?? new PackStore(options);
  const manifestFile = await store.fetchFile(source.manifestUrl);
  const manifest = parseManifest(manifestFile.bytes, source.manifestUrl);
  const file = manifest.patches[source.name];
  if (!file) {
    const names = Object.keys(manifest.patches).slice(0, 8).join(", ");
    throw new PackError(
      `${source.user}/${source.repo} has no patch ${source.name}${names ? ` · it has ${names}` : ""}`,
    );
  }
  const url = new URL(file, source.manifestUrl).href;
  const pin = options.pin;
  const fetched = await store.fetchFile(
    url,
    pin && pin.length === 64 ? pin : undefined,
  );
  if (pin && !fetched.sha256.startsWith(pin))
    throw new PackError(
      `${source.name} · changed upstream (sha256 ${fetched.sha256.slice(0, 12)}… ≠ pinned ${pin.slice(0, 12)}…)`,
    );
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(fetched.bytes));
  } catch {
    throw new PackError(`${url} · not valid JSON`);
  }
  const parsed = parsePatchFile(json, `pack patch ${source.name}`);
  const from = `pack:${source.user}/${source.repo}/${source.name}@${fetched.sha256.slice(0, 12)}`;
  const patch = validatePatch(
    { ...parsed.patch, name: source.name, from },
    { label: `pack patch ${source.name}` },
  );
  return {
    patch,
    from,
    sha256: fetched.sha256,
    license: parsed.license ?? manifest.license,
    url,
    cached: fetched.cached,
  };
}
