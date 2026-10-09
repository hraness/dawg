/**
 * Evaluates a project's `song.ts` in an isolated Bun subprocess and parses
 * the result from `unknown` into a validated `TrackScore`.
 *
 * The child runs `eval-child.ts` with a scrubbed environment, the project as
 * its working directory, no native addons or auto-install, a 10 second
 * budget and a 32 MiB output bound. Anything it prints that is not the
 * expected JSON line is a diagnostic.
 *
 * Isolation is not a sandbox: the child runs project code as the user, with
 * the user's filesystem and network access. It protects dawg's own process
 * (a crash, hang or runaway output in song.ts never takes the window down),
 * not the machine, so only evaluate projects you trust.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLoopDocument } from "../loop.ts";
import { refreshRhythm } from "../rhythm.ts";
import { ScoreValidationError, TrackScore } from "../score.ts";

export const EVAL_TIMEOUT_MS = 10_000;
/**
 * Above the JSON of the largest score `SCORE_LIMITS` allows (64 tracks with
 * every automation lane full plus 4096 notes stays well under 16 MiB).
 */
export const EVAL_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** A problem in a project file; `file` is project-relative when known. */
export type Diagnostic = Readonly<{
  message: string;
  file?: string;
  line?: number;
  col?: number;
}>;

export type EvalResult =
  | Readonly<{ ok: true; score: TrackScore; ms: number }>
  | Readonly<{ ok: false; diagnostics: readonly Diagnostic[]; ms: number }>;

/** How the evaluator starts its child; tests inject a scripted one. */
export type EvalSpawn = (
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env: Readonly<Record<string, string>>;
    timeoutMs: number;
    maxOutputBytes: number;
  }>,
) => Promise<
  Readonly<{
    code: number;
    stdout: string;
    stderr: string;
    killed: boolean;
    /** Why the child was killed; absent means the time budget ran out. */
    reason?: "timeout" | "output";
  }>
>;

export type EvalOptions = Readonly<{
  spawn?: EvalSpawn;
  timeoutMs?: number;
}>;

const CHILD = join(dirname(fileURLToPath(import.meta.url)), "eval-child.ts");

/** Evaluates `<project>/song.ts`; never throws for project errors. */
export async function evaluateProject(
  project: string,
  options: EvalOptions = {},
): Promise<EvalResult> {
  const started = performance.now();
  const spawn = options.spawn ?? bunSpawn;
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.NO_COLOR = "1";
  const done = (result: EvalResult): EvalResult => result;
  let run: Awaited<ReturnType<EvalSpawn>>;
  try {
    run = await spawn(
      [
        process.execPath,
        "--no-addons",
        "--no-install",
        "--smol",
        CHILD,
        project,
      ],
      {
        cwd: project,
        env,
        timeoutMs: options.timeoutMs ?? EVAL_TIMEOUT_MS,
        maxOutputBytes: EVAL_MAX_OUTPUT_BYTES,
      },
    );
  } catch (error) {
    return done(
      failure(started, [{ message: `could not start bun: ${text(error)}` }]),
    );
  }
  if (run.killed && run.reason === "output")
    return done(
      failure(started, [
        {
          file: "song.ts",
          message: `evaluation printed more than ${EVAL_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB; song.ts must not log`,
        },
      ]),
    );
  if (run.killed)
    return done(
      failure(started, [
        {
          file: "song.ts",
          message: `evaluation timed out (${Math.round((options.timeoutMs ?? EVAL_TIMEOUT_MS) / 1000)} s); song.ts must be pure`,
        },
      ]),
    );
  const line = lastJsonLine(run.stdout);
  if (line === undefined) {
    const detail = (run.stderr || run.stdout)
      .trim()
      .split("\n")
      .slice(0, 8)
      .join("\n");
    return done(
      failure(started, [
        {
          file: "song.ts",
          message: detail
            ? `evaluation exited with code ${run.code}: ${detail}`
            : `evaluation exited with code ${run.code}`,
        },
      ]),
    );
  }
  return done(parseChildOutput(line, started));
}

/** Parses the child's JSON line from `unknown`; exported for tests. */
export function parseChildOutput(
  line: string,
  started = performance.now(),
): EvalResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return failure(started, [
      { file: "song.ts", message: "evaluation printed invalid JSON" },
    ]);
  }
  if (typeof value !== "object" || value === null)
    return failure(started, [
      { file: "song.ts", message: "evaluation printed no result" },
    ]);
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    const error =
      typeof record.error === "object" && record.error !== null
        ? (record.error as Record<string, unknown>)
        : {};
    const diagnostic: {
      message: string;
      file?: string;
      line?: number;
      col?: number;
    } = {
      message:
        typeof error.message === "string" && error.message.length > 0
          ? error.message.slice(0, 2000)
          : "song.ts threw",
    };
    if (typeof error.file === "string")
      diagnostic.file = error.file.slice(0, 512);
    if (typeof error.line === "number" && Number.isInteger(error.line))
      diagnostic.line = error.line;
    if (typeof error.col === "number" && Number.isInteger(error.col))
      diagnostic.col = error.col;
    return failure(started, [diagnostic]);
  }
  try {
    // Rhythm rows are generators: their lanes are expanded here, on the
    // host, so `song.ts` stores parameters and the score stores notes.
    const score = refreshRhythm(decodeLoopDocument(record.score));
    return { ok: true, score, ms: elapsed(started) };
  } catch (error) {
    return failure(started, [
      {
        file: "song.ts",
        message:
          error instanceof ScoreValidationError
            ? `invalid score: ${error.message}`
            : `invalid score: ${text(error)}`,
      },
    ]);
  }
}

/** `file:line:col message` for humans; file-less diagnostics print the message alone. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  if (!diagnostic.file) return diagnostic.message;
  const where =
    diagnostic.line === undefined
      ? diagnostic.file
      : `${diagnostic.file}:${diagnostic.line}:${diagnostic.col ?? 1}`;
  return `${where} ${diagnostic.message}`;
}

function failure(
  started: number,
  diagnostics: readonly Diagnostic[],
): EvalResult {
  return {
    ok: false,
    diagnostics: Object.freeze(diagnostics.map((d) => Object.freeze({ ...d }))),
    ms: elapsed(started),
  };
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lastJsonLine(stdout: string): string | undefined {
  const lines = stdout.split("\n").map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.startsWith('{"ok":')) return line;
  }
  return undefined;
}

/** Default spawner: `Bun.spawn` with the given env only (no inheritance). */
export const bunSpawn: EvalSpawn = async (args, options) => {
  const child = Bun.spawn([...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let killed = false;
  let reason: "timeout" | "output" = "timeout";
  const timer = setTimeout(() => {
    killed = true;
    child.kill();
  }, options.timeoutMs);
  const read = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      if (total + value.byteLength > options.maxOutputBytes) {
        if (!killed) reason = "output";
        killed = true;
        child.kill();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
    reader.releaseLock();
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(child.stdout),
      read(child.stderr),
      child.exited,
    ]);
    return killed
      ? { code, stdout, stderr, killed, reason }
      : { code, stdout, stderr, killed };
  } finally {
    clearTimeout(timer);
  }
};
