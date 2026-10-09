/**
 * `dawg check` re-hashes every audio clip and take (0.7) and reports a file
 * that is missing or no longer matches its pinned sha256, pointing at the
 * track file the way a type error does.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Diagnostic } from "../../core/sdk/eval.ts";
import type { TrackScore } from "../../core/score.ts";
import { trackDirectories } from "../../core/sdk/print.ts";

const MAX_CLIP_FILE_BYTES = 50 * 1024 * 1024;

export async function clipPinDiagnostics(
  project: string,
  score: TrackScore,
): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const hashes = new Map<string, string | undefined>();
  const hashOf = async (src: string): Promise<string | undefined> => {
    if (hashes.has(src)) return hashes.get(src);
    let hash: string | undefined;
    const path = resolve(project, src);
    if (!relative(project, path).startsWith("..")) {
      try {
        const info = await stat(path);
        if (info.isFile() && info.size <= MAX_CLIP_FILE_BYTES)
          hash = createHash("sha256")
            .update(await readFile(path))
            .digest("hex");
      } catch {
        hash = undefined;
      }
    }
    hashes.set(src, hash);
    return hash;
  };
  const dirs = trackDirectories(score);
  for (const track of score.tracks) {
    const file = `tracks/${dirs.get(track.id) ?? track.id}/track.ts`;
    const items: [string, string, string][] = [
      ...(track.takes ?? []).map(
        (t) => [`take ${t.name}`, t.src, t.sha256] as [string, string, string],
      ),
      ...(track.clips ?? []).map(
        (c) => [`clip ${c.id}`, c.src, c.sha256] as [string, string, string],
      ),
    ];
    const usedTakes = new Set((track.clips ?? []).map((c) => c.take));
    for (const [label, src, pinned] of items) {
      const actual = await hashOf(src);
      if (actual === pinned) continue;
      // An unused take that is gone is only advice (sources.md 6).
      if (
        actual === undefined &&
        label.startsWith("take ") &&
        !usedTakes.has(label.slice(5))
      )
        continue;
      out.push({
        file,
        message:
          actual === undefined
            ? `${label}: ${src} is missing (re-import it or remove the clip)`
            : `${label}: ${src} does not match its sha256 pin (${pinned.slice(0, 8)} pinned, ${actual.slice(0, 8)} on disk); delete the sha256 line to re-pin`,
      });
    }
  }
  return out;
}
