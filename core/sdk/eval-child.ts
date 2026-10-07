/**
 * Runs inside the evaluation subprocess (`bun --no-addons --no-install
 * --smol eval-child.ts <project>`): imports the project's `song.ts`, fills
 * sample hashes, and prints one JSON line. Never imported by dawg itself.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_SAMPLE_FILE_BYTES = 50 * 1024 * 1024;

type Diagnostic = {
  message: string;
  file?: string;
  line?: number;
  col?: number;
};

async function main(): Promise<void> {
  const project = realpathSync(resolve(process.argv[2] ?? "."));
  const entry = join(project, "song.ts");
  let output: unknown;
  try {
    const module = (await import(pathToFileURL(entry).href)) as {
      default?: unknown;
    };
    const song = module.default;
    if (typeof song !== "object" || song === null)
      throw new Error("song.ts must `export default song({...})`");
    output = { ok: true, score: await withSampleHashes(song, project) };
  } catch (error) {
    output = { ok: false, error: diagnostic(error, project) };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function diagnostic(error: unknown, project: string): Diagnostic {
  if (typeof error !== "object" || error === null)
    return { message: String(error) };
  let record = error as Record<string, unknown>;
  // Bun wraps build errors in an AggregateError; the first one has the position.
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const first: unknown = record.errors[0];
    if (typeof first === "object" && first !== null)
      record = first as Record<string, unknown>;
  }
  const message =
    typeof record.message === "string" ? record.message : String(error);
  const out: Diagnostic = { message };
  // Bun's BuildMessage/ResolveMessage carry a position.
  const position = record.position as Record<string, unknown> | undefined;
  if (position && typeof position.file === "string") {
    out.file = relative(project, position.file) || position.file;
    if (typeof position.line === "number") out.line = position.line;
    if (typeof position.column === "number") out.col = position.column;
    return out;
  }
  const stack = typeof record.stack === "string" ? record.stack : "";
  for (const line of stack.split("\n")) {
    const match = line.match(
      /\(?((?:\/|file:\/\/)[^\s()]+?):(\d+):(\d+)\)?\s*$/,
    );
    if (!match) continue;
    const file = match[1]!.replace(/^file:\/\//, "");
    const rel = relative(project, file);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.startsWith(".dawg"))
      continue;
    out.file = rel;
    out.line = Number(match[2]);
    out.col = Number(match[3]);
    break;
  }
  return out;
}

/** Adds `sha256` to sampler voices whose file exists and is within the size limit. */
async function withSampleHashes(
  song: object,
  project: string,
): Promise<unknown> {
  const plain = JSON.parse(JSON.stringify(song)) as Record<string, unknown>;
  const tracks = Array.isArray(plain.tracks) ? plain.tracks : [];
  for (const track of tracks) {
    if (typeof track !== "object" || track === null) continue;
    const sampler = (track as Record<string, unknown>).sampler;
    if (typeof sampler !== "object" || sampler === null) continue;
    const voices = (sampler as Record<string, unknown>).voices;
    if (typeof voices !== "object" || voices === null) continue;
    for (const voice of Object.values(voices as Record<string, unknown>)) {
      if (typeof voice !== "object" || voice === null) continue;
      const ref = voice as Record<string, unknown>;
      if (
        typeof ref.src !== "string" ||
        typeof ref.sha256 === "string" ||
        ref.src.startsWith("pack:")
      )
        continue;
      const path = resolve(project, ref.src);
      if (relative(project, path).startsWith("..")) continue;
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_SAMPLE_FILE_BYTES) continue;
        ref.sha256 = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      } catch {
        // Missing sample: left for `dawg check` to report.
      }
    }
  }
  return plain;
}

await main();
