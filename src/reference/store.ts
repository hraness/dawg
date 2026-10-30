import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { sha256File } from "../media/paths.ts";
import { checkVocalCancellation } from "../vocals/backend.ts";
import { record } from "../vocals/spec.ts";
import { REFERENCE_LIMITS, ReferenceError } from "./analysis.ts";

export const referenceHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ReferenceArtifact = Readonly<{
  kind: "prepared" | "recreated";
  requestHash: string;
  manifestPath: string;
  files: Readonly<Record<string, string>>;
  data: Record<string, unknown>;
  reused: boolean;
}>;
export type ReferenceLocation = Readonly<{
  root: string;
  base: string;
  dir: string;
  relativeDir: string;
  requestHash: string;
  kind: ReferenceArtifact["kind"];
}>;
const safePart = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/;
const sha = /^[a-f0-9]{64}$/;
export const projectRelative = (root: string, path: string) =>
  relative(root, path).split(sep).join("/");

export async function referenceDirectory(
  root: string,
  parts: readonly string[],
  create = false,
): Promise<string | undefined> {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (create)
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw error;
    }
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !(await realpath(current)).startsWith(root + sep)
    )
      throw new ReferenceError(
        "Reference outputs must stay in project-owned directories without symlinks",
      );
  }
  return current;
}

export async function referenceLocation(
  projectRoot: string,
  trackSlug: string,
  kind: ReferenceArtifact["kind"],
  requestHash: string,
  writeScope?: (path: string) => boolean,
): Promise<ReferenceLocation> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(trackSlug) || !sha.test(requestHash))
    throw new ReferenceError("Invalid reference output identity");
  const root = await realpath(projectRoot),
    parts = ["tracks", trackSlug, "references"];
  const base = join(root, ...parts),
    dir = join(base, `${kind}-${requestHash}`),
    relativeDir = projectRelative(root, dir);
  if (writeScope && !writeScope(`${relativeDir}/manifest.json`))
    throw new ReferenceError(
      "Reference output is outside this task's write scope",
    );
  await referenceDirectory(root, parts);
  return { root, base, dir, relativeDir, requestHash, kind };
}

export async function readReferenceJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > REFERENCE_LIMITS.maxJsonBytes
  )
    throw new ReferenceError(
      "Reference JSON must be a bounded project-owned regular file",
    );
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new ReferenceError("Reference JSON is invalid");
  }
}

export async function loadReference(
  location: ReferenceLocation,
): Promise<ReferenceArtifact | undefined> {
  try {
    await lstat(location.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const subdir = projectRelative(location.root, location.dir).split("/");
  await referenceDirectory(location.root, subdir);
  const manifest = record(
    await readReferenceJson(join(location.dir, "manifest.json")),
    "reference manifest",
  );
  if (
    manifest.version !== 1 ||
    manifest.kind !== location.kind ||
    manifest.requestHash !== location.requestHash
  )
    throw new ReferenceError(
      "Accepted reference manifest identity changed; preserve the artifact",
    );
  const files = record(manifest.files, "reference files");
  if (Object.keys(files).length > 256)
    throw new ReferenceError("Too many accepted reference files");
  const checked: Record<string, string> = {};
  let bytes = 0;
  for (const [path, digest] of Object.entries(files)) {
    const parts = path.split("/");
    if (
      path.length > 1024 ||
      parts.length > 6 ||
      parts.some(
        (part) => !safePart.test(part) || part === "." || part === "..",
      ) ||
      typeof digest !== "string" ||
      !sha.test(digest)
    )
      throw new ReferenceError("Invalid accepted reference file identity");
    if (parts.length > 1)
      await referenceDirectory(location.root, [
        ...subdir,
        ...parts.slice(0, -1),
      ]);
    const file = join(location.dir, path),
      info = await lstat(file);
    bytes += info.size;
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      bytes > REFERENCE_LIMITS.maxArtifactBytes ||
      (await sha256File(file)) !== digest
    )
      throw new ReferenceError(
        "Accepted reference file changed; the artifact was preserved",
      );
    checked[path] = digest;
  }
  return {
    kind: location.kind,
    requestHash: location.requestHash,
    manifestPath: `${location.relativeDir}/manifest.json`,
    files: checked,
    data: record(manifest.data, "reference data"),
    reused: true,
  };
}

export async function withReferenceStage(
  location: ReferenceLocation,
  signal: AbortSignal,
  work: (stage: string) => Promise<Record<string, unknown>>,
  writeScope?: (path: string) => boolean,
): Promise<ReferenceArtifact> {
  checkVocalCancellation(signal);
  const cached = await loadReference(location);
  if (cached) return cached;
  const parts = projectRelative(location.root, location.base).split("/");
  await referenceDirectory(location.root, parts, true);
  const stage = (await referenceDirectory(
    location.root,
    [...parts, `pending-${randomUUID()}`],
    true,
  ))!;
  try {
    const data = await work(stage);
    checkVocalCancellation(signal);
    const files: Record<string, string> = {};
    let bytes = 0;
    let entries = 0;
    const collect = async (dir: string, depth = 0) => {
      if (depth > 5)
        throw new ReferenceError(
          "Reference output directories are too deeply nested",
        );
      for (const name of (await readdir(dir)).sort()) {
        if (++entries > 256)
          throw new ReferenceError(
            "Reference output has too many files or directories",
          );
        if (!safePart.test(name) || name === "." || name === "..")
          throw new ReferenceError("Invalid generated reference filename");
        const path = join(dir, name),
          info = await lstat(path);
        if (info.isSymbolicLink())
          throw new ReferenceError(
            "Generated reference output cannot be a symlink",
          );
        if (info.isDirectory()) {
          await collect(path, depth + 1);
          continue;
        }
        const key = projectRelative(stage, path);
        bytes += info.size;
        if (
          !info.isFile() ||
          Object.keys(files).length >= 256 ||
          bytes > REFERENCE_LIMITS.maxArtifactBytes
        )
          throw new ReferenceError(
            "Generated reference output exceeds its file/size budget",
          );
        if (writeScope && !writeScope(`${location.relativeDir}/${key}`))
          throw new ReferenceError(
            "Reference asset is outside this task's write scope",
          );
        files[key] = await sha256File(path);
      }
    };
    await collect(stage);
    await writeFile(
      join(stage, "manifest.json"),
      `${JSON.stringify({ version: 1, kind: location.kind, requestHash: location.requestHash, files, data })}\n`,
      { flag: "wx" },
    );
    checkVocalCancellation(signal);
    await referenceDirectory(location.root, parts);
    try {
      await rename(stage, location.dir);
    } catch (error) {
      if (
        !["EEXIST", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      const winner = await loadReference(location);
      if (!winner) throw error;
      return winner;
    }
    return {
      kind: location.kind,
      requestHash: location.requestHash,
      manifestPath: `${location.relativeDir}/manifest.json`,
      files,
      data,
      reused: false,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function copyReferenceInput(
  source: string,
  target: string,
  expectedHash: string,
): Promise<void> {
  const info = await lstat(source);
  if (!info.isFile() || info.size > REFERENCE_LIMITS.maxInputBytes)
    throw new ReferenceError(
      "Reference input exceeds the regular-file/500 MiB budget",
    );
  await copyFile(source, target, 1);
  if ((await sha256File(target)) !== expectedHash)
    throw new ReferenceError(
      "Reference input changed while copying; retry from a stable input",
    );
}
