/**
 * Where media tools read and write. Every output lives under
 * `tracks/<slug>/downloads/` (samples under `tracks/<slug>/samples/`), inputs
 * must resolve inside the project root, and results quote project-relative
 * paths so the model can chain tools without learning absolute paths.
 */
import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import {
  mkdir,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MediaHost } from "./types.ts";

export const MAX_NAME_LENGTH = 64;

/** The same slug the workspace tools use for `tracks/<slug>/`. */
export { trackSlug } from "../../core/slug.ts";

export function downloadsDir(
  host: Pick<MediaHost, "projectRoot" | "trackSlug">,
) {
  return join(host.projectRoot, "tracks", host.trackSlug, "downloads");
}

export function samplesDir(host: Pick<MediaHost, "projectRoot" | "trackSlug">) {
  return join(host.projectRoot, "tracks", host.trackSlug, "samples");
}

export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

/** Project-relative POSIX path for results. */
export function projectPath(root: string, absolute: string): string {
  // `absolute` usually comes from realpath; try the resolved root too so a
  // symlinked project directory (macOS /var → /private/var) stays relative.
  const roots = [root];
  try {
    const real = realpathSync(root);
    if (real !== root) roots.push(real);
  } catch {
    // Missing root: fall through to the plain relative path.
  }
  for (const base of roots) {
    const path = relative(base, absolute);
    if (path && !path.startsWith("..") && !isAbsolute(path))
      return path.split(sep).join("/");
  }
  return relative(root, absolute).split(sep).join("/");
}

export class MediaPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaPathError";
  }
}

/**
 * Resolve a model- or user-supplied input file: project-relative or absolute,
 * but always a regular file inside the project root once symlinks resolve.
 */
export async function resolveInput(
  host: Pick<MediaHost, "projectRoot" | "trackSlug">,
  file: unknown,
): Promise<{ absolute: string; relative: string; size: number }> {
  if (typeof file !== "string" || file.length === 0 || file.length > 1024)
    throw new MediaPathError("file must be a project-relative path");
  if (file.includes("\0"))
    throw new MediaPathError("file contains an invalid character");
  const candidates = isAbsolute(file)
    ? [file]
    : [resolve(host.projectRoot, file), join(downloadsDir(host), file)];
  const root = await realpath(host.projectRoot);
  for (const candidate of candidates) {
    let real: string;
    let info;
    try {
      real = await realpath(candidate);
      info = await stat(real);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (real !== root && !real.startsWith(root + sep))
      throw new MediaPathError(`${file} is outside the project`);
    return {
      absolute: real,
      relative: projectPath(root, real),
      size: info.size,
    };
  }
  throw new MediaPathError(
    `${file} was not found (paths are relative to the project or to tracks/${host.trackSlug}/downloads)`,
  );
}

/** `<base>.<ext>` in `dir`, or `<base>-2.<ext>`, … when it already exists. */
export async function freshPath(
  dir: string,
  base: string,
  suffix: string,
): Promise<{ path: string; base: string }> {
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    const path = join(dir, `${name}${suffix}`);
    try {
      await stat(path);
    } catch {
      return { path, base: name };
    }
  }
  throw new MediaPathError(`too many files named ${base} in ${dir}`);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** Write JSON through a temp file and rename, so readers never see a partial file. */
export async function writeJsonAtomic(path: string, value: unknown) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

export async function readJson(path: string): Promise<unknown> {
  try {
    const file = Bun.file(path);
    if (file.size > 16 * 1024 * 1024) return undefined;
    return JSON.parse(await file.text()) as unknown;
  } catch {
    return undefined;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
