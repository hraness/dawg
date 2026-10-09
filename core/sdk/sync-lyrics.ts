/**
 * The SDK is one vendored file with no imports, so `core/sdk/v1.ts` carries
 * a copy of the lyric grammar (`core/lyrics.ts`) between two marker lines.
 * `bun core/sdk/sync-lyrics.ts` rewrites it and `sync-lyrics.test.ts` fails
 * when it is stale. Same scheme as `sync-instruments.ts`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format } from "prettier";

export const BEGIN_MARKER =
  "// BEGIN lyrics: generated from core/lyrics.ts by core/sdk/sync-lyrics.ts";
export const END_MARKER = "// END lyrics";

const ROOT = join(import.meta.dir, "..", "..");
export const LYRICS_PATH = join(ROOT, "core", "lyrics.ts");
export const SDK_PATH = join(ROOT, "core", "sdk", "v1.ts");

/** The lyric block (markers included) for a `core/lyrics.ts` source. */
export function lyricBlock(source: string): string {
  const start = source.indexOf("// ---- lyrics");
  if (start < 0) throw new Error("core/lyrics.ts layout changed");
  const body = source
    .slice(source.indexOf("\n", start) + 1)
    .replace(/^export /gm, "")
    .trim();
  return `${BEGIN_MARKER}\n${body}\n${END_MARKER}`;
}

/** `sdk` with its lyric block replaced, formatted like the repo. */
export async function syncedSdk(sdk: string, lyrics: string): Promise<string> {
  const from = sdk.indexOf(BEGIN_MARKER);
  const to = sdk.indexOf(END_MARKER);
  if (from < 0 || to < 0) throw new Error("v1.ts has no lyric markers");
  const next =
    sdk.slice(0, from) + lyricBlock(lyrics) + sdk.slice(to + END_MARKER.length);
  return format(next, { parser: "typescript", filepath: SDK_PATH });
}

if (import.meta.main) {
  const [sdk, lyrics] = await Promise.all([
    readFile(SDK_PATH, "utf8"),
    readFile(LYRICS_PATH, "utf8"),
  ]);
  const next = await syncedSdk(sdk, lyrics);
  if (next !== sdk) await writeFile(SDK_PATH, next);
  console.log(next === sdk ? "v1.ts lyrics up to date" : "v1.ts updated");
}
