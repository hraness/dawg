/**
 * The SDK is one vendored file with no imports, so `core/sdk/v1.ts` carries
 * a copy of the chord engine (`core/chords.ts`) between two marker lines.
 * This keeps the copy exact: `bun core/sdk/sync-chords.ts` rewrites it and
 * `sync-chords.test.ts` fails when it is stale.
 *
 * The copy is the module body from its first section rule up to
 * `CHORD_PROCESS` (agent prose the SDK does not need), with `export`
 * dropped so the engine stays private to the SDK.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format } from "prettier";

export const BEGIN_MARKER =
  "// BEGIN chord engine: generated from core/chords.ts by core/sdk/sync-chords.ts";
export const END_MARKER = "// END chord engine";

const ROOT = join(import.meta.dir, "..", "..");
export const CHORDS_PATH = join(ROOT, "core", "chords.ts");
export const SDK_PATH = join(ROOT, "core", "sdk", "v1.ts");

/** The engine block (markers included) for a `core/chords.ts` source. */
export function chordBlock(source: string): string {
  const start = source.indexOf("// ----");
  const end = source.indexOf("/** How dawg builds chords");
  if (start < 0 || end < 0) throw new Error("core/chords.ts layout changed");
  const body = source
    .slice(start, end)
    .replace(/^export /gm, "")
    .trimEnd();
  return `${BEGIN_MARKER}\n${body}\n${END_MARKER}`;
}

/** `sdk` with its engine block replaced, formatted like the repo. */
export async function syncedSdk(sdk: string, chords: string): Promise<string> {
  const from = sdk.indexOf(BEGIN_MARKER);
  const to = sdk.indexOf(END_MARKER);
  if (from < 0 || to < 0) throw new Error("v1.ts has no chord engine markers");
  const next =
    sdk.slice(0, from) + chordBlock(chords) + sdk.slice(to + END_MARKER.length);
  return format(next, { parser: "typescript", filepath: SDK_PATH });
}

if (import.meta.main) {
  const [sdk, chords] = await Promise.all([
    readFile(SDK_PATH, "utf8"),
    readFile(CHORDS_PATH, "utf8"),
  ]);
  const next = await syncedSdk(sdk, chords);
  if (next !== sdk) await writeFile(SDK_PATH, next);
  console.log(next === sdk ? "v1.ts chord engine up to date" : "v1.ts updated");
}
