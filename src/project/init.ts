/**
 * Project layout on disk:
 *
 *   dawg.json              project marker: format and SDK major
 *   tsconfig.json          strict, `"dawg"` → `.dawg/sdk/v1.ts`
 *   song.ts                `export default song({ ..., tracks: [...] })`
 *   tracks/<slug>/track.ts one `track({...})` per track (+ `samples/`)
 *   .dawg/sdk/v1.ts        vendored SDK, refreshed when the shipped copy is newer
 *   .dawg/sdk/tsconfig.json compiler options the root config extends
 *   .dawg/tsbuild/         incremental typecheck state
 *   .dawg/sync.json        hashes of files dawg wrote (echo suppression)
 *
 * `initProject` is idempotent, writes only under `dir`, and reports each
 * file it created or refreshed exactly once.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSimpleArgv } from "../argv.ts";
import { durableWrite } from "../fs/durable.ts";

export const PROJECT_FILE = "dawg.json";
export const PROJECT_FORMAT = "dawg.project/v1";
export const SDK_RELATIVE_PATH = ".dawg/sdk/v1.ts";
export const SDK_TSCONFIG_RELATIVE_PATH = ".dawg/sdk/tsconfig.json";

/** The SDK source dawg ships (`core/sdk/v1.ts`). */
export const SHIPPED_SDK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "sdk",
  "v1.ts",
);

export type ProjectManifest = Readonly<{ format: string; sdk: number }>;

export type InitResult = Readonly<{
  /** Project-relative paths created or refreshed, in write order. */
  wrote: readonly string[];
  /** SDK version now vendored in the project. */
  sdkVersion: string;
}>;

const SDK_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      types: [],
    },
  },
  null,
  2,
)}\n`;

const ROOT_TSCONFIG = `${JSON.stringify(
  {
    extends: "./.dawg/sdk/tsconfig.json",
    compilerOptions: { paths: { dawg: ["./.dawg/sdk/v1.ts"] } },
    include: ["song.ts", "tracks/**/*.ts", ".dawg/sdk/*.ts"],
  },
  null,
  2,
)}\n`;

const EMPTY_SONG = `import { song } from "dawg";

export default song({
  tempo: 120,
  meter: [4, 4],
  bars: 4,
  tracks: [],
});
`;

const GITIGNORE_LINES = [".dawg/*", "!.dawg/sdk/"];

/** True when `dir` holds a `dawg.json`. */
export async function isProject(dir: string): Promise<boolean> {
  return (await readManifest(dir)) !== undefined;
}

/** Parses `dawg.json` from unknown; undefined when absent or unreadable. */
export async function readManifest(
  dir: string,
): Promise<ProjectManifest | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, PROJECT_FILE), "utf8");
  } catch {
    return undefined;
  }
  if (text.length > 4096) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    if (record.format !== PROJECT_FORMAT) return undefined;
    if (typeof record.sdk !== "number" || !Number.isInteger(record.sdk))
      return undefined;
    return Object.freeze({ format: PROJECT_FORMAT, sdk: record.sdk });
  } catch {
    return undefined;
  }
}

/** Version string declared by an SDK source file, or undefined. */
export function sdkVersionOf(source: string): string | undefined {
  const match = source.match(/SDK_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

function newer(candidate: string, current: string | undefined): boolean {
  if (current === undefined) return true;
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  if (a[0] !== b[0]) return false; // a different major is never auto-applied
  for (let index = 1; index < 3; index += 1)
    if (a[index]! !== b[index]!) return a[index]! > b[index]!;
  return false;
}

export type InitOptions = Readonly<{
  /** SDK source to vendor; defaults to the shipped `core/sdk/v1.ts`. */
  sdkSource?: string;
}>;

/**
 * Creates or refreshes the project in `dir`. Existing `song.ts`,
 * `tsconfig.json`, `.gitignore` entries and `dawg.json` are left alone;
 * the vendored SDK is replaced only by a newer copy of the same major.
 */
export async function initProject(
  dir: string,
  options: InitOptions = {},
): Promise<InitResult> {
  const wrote: string[] = [];
  const sdkSource =
    options.sdkSource ?? (await readFile(SHIPPED_SDK_PATH, "utf8"));
  const shippedVersion = sdkVersionOf(sdkSource);
  if (!shippedVersion) throw new Error("shipped SDK has no SDK_VERSION");
  const major = Number(shippedVersion.split(".")[0]);

  await mkdir(join(dir, ".dawg", "sdk"), { recursive: true });
  await mkdir(join(dir, "tracks"), { recursive: true });

  const vendored = await readOptional(join(dir, SDK_RELATIVE_PATH));
  const vendoredVersion =
    vendored === undefined ? undefined : sdkVersionOf(vendored);
  let sdkVersion = vendoredVersion ?? shippedVersion;
  if (vendored === undefined || newer(shippedVersion, vendoredVersion)) {
    await writeAtomic(join(dir, SDK_RELATIVE_PATH), sdkSource);
    wrote.push(SDK_RELATIVE_PATH);
    sdkVersion = shippedVersion;
  }
  if (
    (await readOptional(join(dir, SDK_TSCONFIG_RELATIVE_PATH))) !== SDK_TSCONFIG
  ) {
    await writeAtomic(join(dir, SDK_TSCONFIG_RELATIVE_PATH), SDK_TSCONFIG);
    wrote.push(SDK_TSCONFIG_RELATIVE_PATH);
  }
  if ((await readManifest(dir)) === undefined) {
    await writeAtomic(
      join(dir, PROJECT_FILE),
      `${JSON.stringify({ format: PROJECT_FORMAT, sdk: major }, null, 2)}\n`,
    );
    wrote.push(PROJECT_FILE);
  }
  if ((await readOptional(join(dir, "tsconfig.json"))) === undefined) {
    await writeAtomic(join(dir, "tsconfig.json"), ROOT_TSCONFIG);
    wrote.push("tsconfig.json");
  }
  if ((await readOptional(join(dir, "song.ts"))) === undefined) {
    await writeAtomic(join(dir, "song.ts"), EMPTY_SONG);
    // Recorded as dawg-written so the first window lets the session win.
    await writeAtomic(
      join(dir, ".dawg", "sync.json"),
      `${JSON.stringify(
        {
          files: {
            "song.ts": createHash("sha256").update(EMPTY_SONG).digest("hex"),
          },
        },
        null,
        2,
      )}\n`,
    );
    wrote.push("song.ts");
  }
  const gitignore = (await readOptional(join(dir, ".gitignore"))) ?? "";
  const present = new Set(gitignore.split("\n").map((line) => line.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length > 0) {
    const prefix =
      gitignore.length === 0 || gitignore.endsWith("\n") ? "" : "\n";
    await writeAtomic(
      join(dir, ".gitignore"),
      `${gitignore}${prefix}${missing.join("\n")}\n`,
    );
    wrote.push(".gitignore");
  }
  return Object.freeze({ wrote: Object.freeze(wrote), sdkVersion });
}

export const INIT_USAGE =
  "usage: dawg init [dir] · writes song.ts, dawg.json, tsconfig.json and .dawg/sdk (existing files are kept)";

/** `dawg init [dir]`: creates the project and prints what it wrote. */
export async function runInitCommand(
  argv: readonly string[],
  cwd: string,
  stdout: { write(text: string): unknown },
  stderr: { write(text: string): unknown },
): Promise<number> {
  const parsed = parseSimpleArgv(argv.slice(1), 1);
  if (parsed.kind === "help") {
    stdout.write(`${INIT_USAGE}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    stderr.write(`${parsed.problem} · ${INIT_USAGE}\n`);
    return 2;
  }
  const dir = parsed.positionals[0];
  const target = dir ? resolve(cwd, dir) : cwd;
  try {
    const result = await initProject(target);
    if (result.wrote.length === 0)
      stdout.write(`project up to date (sdk ${result.sdkVersion})\n`);
    else for (const path of result.wrote) stdout.write(`wrote ${path}\n`);
    return 0;
  } catch (error) {
    stderr.write(
      `init failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Temp file + fsync + rename + directory fsync, so a reader never sees a
 * partial file and a crash never loses a write `.dawg/sync.json` vouches for.
 */
export async function writeAtomic(
  path: string,
  contents: string,
): Promise<void> {
  await durableWrite(path, contents);
}
