/**
 * `dawg render <out.wav>`: renders a session (or a `track.loop/v1` file) to
 * a stereo 16-bit PCM WAV through the same deterministic renderer playback
 * uses, so two renders of one score are byte-identical. It reads the session
 * record from disk and never starts dawgd or plays audio.
 */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreFromJSON, type TrackScore } from "../core/score.ts";
import { decodeLoop } from "../core/loop.ts";
import { renderScoreWav } from "./audio/wav.ts";
import { resolveSessionArg } from "./session/attach.ts";
import {
  loadSession,
  readCurrentSessionId,
  sessionPaths,
} from "./session/store.ts";

export const RENDER_USAGE =
  "usage: dawg render <out.wav> [--session <name|id>] [--import <file.track.json>]";

const MAX_LOOP_FILE_BYTES = 512 * 1024;

type Output = { write(text: string): unknown };

export async function runRenderCommand(
  argv: readonly string[],
  workspace: string,
  stdout: Output,
  stderr: Output,
): Promise<number> {
  const rest = argv.slice(1);
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--session" || arg === "--import") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        stderr.write(`${arg} needs a value\n${RENDER_USAGE}\n`);
        return 2;
      }
      options.set(arg, value);
      index += 1;
    } else if (arg.startsWith("--")) {
      stderr.write(`unknown option ${arg}\n${RENDER_USAGE}\n`);
      return 2;
    } else positional.push(arg);
  }
  const target = positional[0];
  if (positional.length !== 1 || !target || !/\.wav$/i.test(target)) {
    stderr.write(`${RENDER_USAGE}\n`);
    return 2;
  }
  let score: TrackScore;
  try {
    score = await loadScore(workspace, options);
  } catch (error) {
    stderr.write(
      `render failed · ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const wav = renderScoreWav(score);
  const path = resolve(workspace, target);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, wav);
  await rename(temporary, path);
  const sha = createHash("sha256").update(wav).digest("hex");
  stdout.write(`rendered · ${target} · ${wav.byteLength} bytes · ${sha}\n`);
  return 0;
}

async function loadScore(
  workspace: string,
  options: ReadonlyMap<string, string>,
): Promise<TrackScore> {
  const importPath = options.get("--import");
  if (importPath !== undefined) {
    const contents = await readFile(resolve(workspace, importPath));
    if (contents.byteLength > MAX_LOOP_FILE_BYTES)
      throw new Error("loop import exceeds 512 KiB");
    return decodeLoop(contents.toString("utf8"));
  }
  const query = options.get("--session");
  const sessionId =
    query === undefined
      ? await readCurrentSessionId(workspace)
      : await resolveSessionArg(workspace, query);
  if (sessionId === undefined)
    throw new Error("no session here; run `dawg` first or pass --import");
  const record = await loadSession<unknown>(
    sessionPaths(workspace, sessionId),
  ).catch(() => {
    throw new Error(`no session named "${query ?? sessionId}"`);
  });
  return scoreFromJSON(record.composition);
}
