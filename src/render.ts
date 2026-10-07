/**
 * `dawg render <out.wav>`: renders a session, the project files (`song.ts`,
 * in a project with no `--session`), or a `track.loop/v1` file to
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
import { SampleLibrary, hasSamplerTracks } from "./audio/samples.ts";
import {
  PackStore,
  creditsLine,
  packCredits,
  withWavComment,
  writeCredits,
} from "./audio/packs.ts";
import { evaluateProject, formatDiagnostic } from "../core/sdk/eval.ts";
import { isProject } from "./project/init.ts";
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
  if (rest.includes("--help") || rest.includes("-h")) {
    stdout.write(`${RENDER_USAGE}\n`);
    return 0;
  }
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--session" || arg === "--import") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        stderr.write(`${arg} needs a value · ${RENDER_USAGE}\n`);
        return 2;
      }
      options.set(arg, value);
      index += 1;
    } else if (arg.startsWith("--")) {
      stderr.write(`unknown option · ${arg} · ${RENDER_USAGE}\n`);
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
  let samples;
  if (hasSamplerTracks(score)) {
    samples = await new SampleLibrary({ projectRoot: workspace }).load(score);
    for (const problem of samples.problems)
      stderr.write(`sample ${problem.level} · ${problem.message}\n`);
  }
  let wav = renderScoreWav(score, { samples });
  // Pack sounds: name the packs (and CC-BY attributions) in the WAV's INFO
  // comment and on stdout; CREDITS.md in a project keeps the attributions.
  const refs = score.tracks.flatMap((track) =>
    Object.values(track.sampler?.voices ?? {}),
  );
  let credits: string | undefined;
  if (refs.some((ref) => ref.src.startsWith("pack:"))) {
    const list = packCredits(refs, await new PackStore().list());
    credits = creditsLine(list);
    if (credits) wav = withWavComment(wav, `samples: ${credits}`);
    if (await isProject(workspace).catch(() => false))
      await writeCredits(workspace, list).catch(() => undefined);
  }
  const path = resolve(workspace, target);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, wav);
  await rename(temporary, path);
  const sha = createHash("sha256").update(wav).digest("hex");
  stdout.write(`rendered · ${target} · ${wav.byteLength} bytes · ${sha}\n`);
  if (credits) stdout.write(`credits · ${credits}\n`);
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
  if (query === undefined && (await isProject(workspace))) {
    const evaluated = await evaluateProject(workspace);
    if (!evaluated.ok)
      throw new Error(
        `${evaluated.diagnostics.map(formatDiagnostic).join("; ").slice(0, 400)} · fix song.ts and retry (dawg check)`,
      );
    return evaluated.score;
  }
  const sessionId =
    query === undefined
      ? await readCurrentSessionId(workspace)
      : await resolveSessionArg(workspace, query);
  if (sessionId === undefined)
    throw new Error("no session here · run dawg first or pass --import");
  const record = await loadSession<unknown>(
    sessionPaths(workspace, sessionId),
  ).catch(() => {
    throw new Error(`no session named "${query ?? sessionId}" · dawg sessions`);
  });
  return scoreFromJSON(record.composition);
}
