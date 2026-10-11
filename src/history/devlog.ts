/**
 * Dev-mode observability (design §5.2): `log` rows in the session history
 * so a coding agent in another terminal (`dawg history --follow --kind log`)
 * and dawg's own agent can see what the window did.
 *
 * `devLog` writes through the process history sink (src/history/sink.ts),
 * so project sync and the audio engine need no handle. It is a no-op unless
 * dev mode is on (`dawg --dev`, `dawg dev`, `DAWG_DEV=1`), except
 * `level=error`, which is written in every mode. At most 20 rows a second
 * are written; the excess is counted into one `dropped N` row, written
 * when the next window opens or by `flushDevLog` (on exit). Error rows are
 * never rate limited: a crash during a burst must still be recorded.
 */
import { historySink } from "./sink.ts";
import type { TargetRef } from "./types.ts";

export type DevTopic =
  | "tool"
  | "typecheck"
  | "sync"
  | "reload"
  | "render"
  | "audio"
  | "exec"
  | "error"
  | "agent";

export type DevLevel = "debug" | "info" | "warn" | "error";

/** Rows per window before the rest are counted as dropped. */
export const DEV_LOG_RATE = 20;
const WINDOW_MS = 1000;
const MAX_SUMMARY = 200;
const MAX_PAYLOAD = 4 * 1024;

/** True when this process runs in dev mode. */
export function devEnabled(): boolean {
  return process.env.DAWG_DEV === "1";
}

/** Turns dev mode on for this process (the `--dev` flag; children inherit). */
export function enableDev(): void {
  process.env.DAWG_DEV = "1";
}

let windowStart = 0;
let written = 0;
let dropped = 0;
let now: () => number = () => Date.now();

/** Tests: a fake clock and a fresh rate window. */
export function resetDevLog(clock?: () => number): void {
  now = clock ?? (() => Date.now());
  windowStart = 0;
  written = 0;
  dropped = 0;
}

function clip(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The payload, as JSON-safe data no larger than 4 KiB once serialized. */
function boundPayload(payload: unknown): unknown {
  if (payload === undefined) return undefined;
  let json: string;
  try {
    json = JSON.stringify(payload) ?? "null";
  } catch {
    return { unserializable: true };
  }
  if (json.length <= MAX_PAYLOAD) return JSON.parse(json) as unknown;
  return { clipped: `${json.slice(0, MAX_PAYLOAD - 64)}…`, bytes: json.length };
}

export type DevLogOptions = Readonly<{ targets?: readonly TargetRef[] }>;

/**
 * Appends one `log` row (`sub` = level, `payload.topic`). Never throws and
 * never blocks: history is observability, not part of any edit.
 */
export function devLog(
  topic: DevTopic,
  level: DevLevel,
  summary: string,
  payload?: unknown,
  options: DevLogOptions = {},
): void {
  if (level !== "error" && !devEnabled()) return;
  const sink = historySink();
  if (!sink) return;
  const at = now();
  if (at - windowStart >= WINDOW_MS) {
    windowStart = at;
    written = 0;
    if (flushDropped()) written += 1;
  }
  if (level === "error") {
    // Errors bypass the budget (and report what a burst dropped first).
    flushDropped();
  } else if (written >= DEV_LOG_RATE) {
    dropped += 1;
    return;
  }
  if (level !== "error") written += 1;
  const bounded = boundPayload(payload);
  append(
    topic,
    level,
    summary,
    { topic, ...(bounded === undefined ? {} : { data: bounded }) },
    options.targets,
  );
}

/** Writes the pending `dropped N` row, if any; true when one was written. */
function flushDropped(): boolean {
  const lost = dropped;
  if (lost === 0) return false;
  dropped = 0;
  append(
    "error",
    "warn",
    `dropped ${lost} log row${lost === 1 ? "" : "s"} (over ${DEV_LOG_RATE}/s)`,
    { topic: "error", dropped: lost },
  );
  return true;
}

/**
 * Writes the pending `dropped N` row now (process exit), so a burst that
 * ends the process is still accounted for. Never throws.
 */
export function flushDevLog(): void {
  flushDropped();
}

function append(
  topic: DevTopic,
  level: DevLevel,
  summary: string,
  payload: Record<string, unknown>,
  targets?: readonly TargetRef[],
): void {
  const sink = historySink();
  if (!sink) return;
  try {
    const appended = sink.append({
      kind: "log",
      sub: level,
      actor: { kind: "system" },
      summary: clip(`${topic} · ${summary}`, MAX_SUMMARY),
      payload,
      ...(targets !== undefined ? { targets } : {}),
    });
    appended.done.catch(() => undefined);
  } catch {
    // A missing or read-only database never fails the window.
  }
}

/** The error's message and stack, the stack clipped to 4 KiB. */
export function errorPayload(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error)
    return {
      message: clip(error.message, 400),
      ...(error.stack
        ? { stack: error.stack.slice(0, MAX_PAYLOAD - 512) }
        : {}),
    };
  return { message: clip(String(error), 400) };
}
