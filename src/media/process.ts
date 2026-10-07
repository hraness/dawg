/**
 * Helpers shared by the media tools: bounded helper processes with progress
 * taps, bounded HTTP downloads, temp directories, and cancellation.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "../auth/runner.ts";
import { MEDIA_LIMITS, type MediaRunContext } from "./types.ts";
import { terminalSafeText } from "./vendor/util.ts";

export class MediaToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaToolError";
  }
}

export class MediaAbortError extends Error {
  constructor() {
    super("cancelled");
    this.name = "MediaAbortError";
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new MediaAbortError();
}

/** Deadline-bounded signal for one tool run. */
export function budgetSignal(
  context: MediaRunContext,
  timeoutMs: number,
): AbortSignal {
  return AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]);
}

export type HelperOptions = Readonly<{
  timeoutMs: number;
  /** Parse one stderr/stdout chunk into a progress line, or undefined. */
  progress?: (chunk: string) => string | undefined;
  /** Progress lines closer than this are dropped (default 400 ms). */
  minIntervalMs?: number;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}>;

/**
 * Run one helper binary with the tool budget, SIGTERM→SIGKILL on abort, bounded
 * output and throttled progress lines. Throws `MediaToolError` on non-zero exit.
 */
export async function runHelper(
  context: MediaRunContext,
  argv: readonly string[],
  options: HelperOptions,
): Promise<RunResult> {
  throwIfAborted(context.signal);
  const [command, ...args] = argv;
  if (!command) throw new MediaToolError("empty command");
  let last = 0;
  let lastLine = "";
  const result = await context.runner.run(command, args, {
    timeoutMs: options.timeoutMs,
    signal: context.signal,
    maxOutputBytes: MEDIA_LIMITS.maxToolOutputBytes,
    ...(options.env ? { env: options.env } : {}),
    ...(options.progress
      ? {
          onOutput: (_stream, chunk) => {
            const line = options.progress!(chunk);
            if (line === undefined || line === lastLine) return;
            const now = Date.now();
            if (now - last < (options.minIntervalMs ?? 400)) return;
            last = now;
            lastLine = line;
            context.progress(line);
          },
        }
      : {}),
  });
  if (context.signal.aborted) throw new MediaAbortError();
  if (result.killed)
    throw new MediaToolError(
      `${command} exceeded its ${Math.round(options.timeoutMs / 60_000)} min budget and was stopped`,
    );
  if (result.code !== 0) {
    const detail =
      lastMeaningfulLine(result.stderr) ?? lastMeaningfulLine(result.stdout);
    throw new MediaToolError(
      `${command} failed (exit ${result.code})${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}

export function lastMeaningfulLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const line = lines.at(-1);
  return line === undefined ? undefined : terminalSafeText(line, 300, "");
}

/** `42%` from tqdm-style output (`demucs`, `yt-dlp --newline`). */
export function percentProgress(label: string) {
  return (chunk: string): string | undefined => {
    const matches = chunk.match(/(\d{1,3}(?:\.\d)?)%/g);
    const lastMatch = matches?.at(-1);
    if (!lastMatch) return undefined;
    const value = Math.min(100, Math.round(parseFloat(lastMatch)));
    return `${label} ${value}%`;
  };
}

export async function withTempDir<T>(
  prefix: string,
  work: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `dawg-${prefix}-`));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type FetchLike = typeof fetch;

/** Read a JSON body no larger than `maxBytes`. */
export async function fetchJson(
  fetcher: FetchLike,
  url: string,
  init: RequestInit & { maxBytes?: number },
): Promise<unknown> {
  const response = await fetcher(url, init);
  const text = await readBoundedText(response, init.maxBytes ?? 1024 * 1024);
  if (!response.ok)
    throw new MediaToolError(
      `${new URL(url).pathname} answered ${response.status}${text ? `: ${terminalSafeText(text, 200, "")}` : ""}`,
    );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MediaToolError(`${new URL(url).pathname} did not return JSON`);
  }
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MediaToolError(`response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Stream a response body to `path` (via `.part`), capped at `maxBytes`. */
export async function downloadToFile(
  fetcher: FetchLike,
  url: string,
  path: string,
  options: Readonly<{
    maxBytes: number;
    signal: AbortSignal;
    progress?: (receivedBytes: number, totalBytes: number | undefined) => void;
  }>,
): Promise<number> {
  const response = await fetcher(url, { signal: options.signal });
  if (!response.ok || !response.body)
    throw new MediaToolError(
      `download of ${new URL(url).pathname} answered ${response.status}`,
    );
  const declared = Number(response.headers.get("content-length") ?? "");
  const total =
    Number.isFinite(declared) && declared > 0 ? declared : undefined;
  if (total !== undefined && total > options.maxBytes)
    throw new MediaToolError(
      `${new URL(url).pathname} is ${total} bytes, over the ${options.maxBytes}-byte cap`,
    );
  const part = `${path}.part`;
  const writer = Bun.file(part).writer();
  const reader = response.body.getReader();
  let received = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MediaToolError(
          `download exceeded the ${options.maxBytes}-byte cap`,
        );
      }
      writer.write(value);
      const now = Date.now();
      if (options.progress && now - lastReport > 500) {
        lastReport = now;
        options.progress(received, total);
      }
    }
    await writer.end();
    const { rename } = await import("node:fs/promises");
    await rename(part, path);
    return received;
  } catch (error) {
    try {
      await writer.end();
    } catch {
      // already closed
    }
    await rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}
