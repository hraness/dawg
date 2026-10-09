/**
 * The SDK is one vendored file with no imports, so `core/sdk/v1.ts` carries
 * a copy of the instrument word resolver (`core/instruments.ts`) between two
 * marker lines. `bun core/sdk/sync-instruments.ts` rewrites it and
 * `sync-instruments.test.ts` fails when it is stale. Same scheme as
 * `sync-chords.ts`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format } from "prettier";

export const BEGIN_MARKER =
  "// BEGIN instrument words: generated from core/instruments.ts by core/sdk/sync-instruments.ts";
export const END_MARKER = "// END instrument words";

const ROOT = join(import.meta.dir, "..", "..");
export const INSTRUMENTS_PATH = join(ROOT, "core", "instruments.ts");
export const SDK_PATH = join(ROOT, "core", "sdk", "v1.ts");

/** The resolver block (markers included) for a `core/instruments.ts` source. */
export function instrumentBlock(source: string): string {
  const start = source.indexOf("// ---- instrument words");
  if (start < 0) throw new Error("core/instruments.ts layout changed");
  const body = source
    .slice(source.indexOf("\n", start) + 1)
    .replace(/^export /gm, "")
    .trim();
  return `${BEGIN_MARKER}\n${body}\n${END_MARKER}`;
}

/** `sdk` with its resolver block replaced, formatted like the repo. */
export async function syncedSdk(
  sdk: string,
  instruments: string,
): Promise<string> {
  const from = sdk.indexOf(BEGIN_MARKER);
  const to = sdk.indexOf(END_MARKER);
  if (from < 0 || to < 0)
    throw new Error("v1.ts has no instrument word markers");
  const next =
    sdk.slice(0, from) +
    instrumentBlock(instruments) +
    sdk.slice(to + END_MARKER.length);
  return format(next, { parser: "typescript", filepath: SDK_PATH });
}

if (import.meta.main) {
  const [sdk, instruments] = await Promise.all([
    readFile(SDK_PATH, "utf8"),
    readFile(INSTRUMENTS_PATH, "utf8"),
  ]);
  const next = await syncedSdk(sdk, instruments);
  if (next !== sdk) await writeFile(SDK_PATH, next);
  console.log(
    next === sdk ? "v1.ts instrument words up to date" : "v1.ts updated",
  );
}
