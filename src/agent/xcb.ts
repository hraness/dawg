import type { CommandRunner } from "../auth/runner.ts";

/**
 * Client for xcb's application API (`xcb --json generate`): one prompt in, one
 * untrusted text reply out, zero tools, no streaming. See
 * https://github.com/hraness/xcb/blob/main/docs/application-api.md
 */
export const XCB_DOC_URL =
  "https://github.com/hraness/xcb/blob/main/docs/application-api.md";
export const XCB_INSTALL = "curl -fsSL https://xcb.sh/install.sh | sh";
export const XCB_LIMITS = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 262_144,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 300_000,
  maxCapabilityBytes: 2 * 1024 * 1024,
  maxAccounts: 128,
  maxModelsPerAccount: 64,
});
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;
const FAILURE_CODES = new Set([
  "invalid_request",
  "unavailable",
  "busy",
  "deadline",
  "cancelled",
  "provider_error",
  "output_limit",
  "custody_unproven",
]);

export class XcbError extends Error {
  constructor(
    message: string,
    readonly code: string = "provider_error",
  ) {
    super(message);
    this.name = "XcbError";
  }
}

export type XcbModel = Readonly<{ key: string; label: string }>;
export type XcbAccount = Readonly<{
  id: string;
  label: string;
  provider: string;
  available: boolean;
  connected: boolean;
  reason: string | null;
  models: readonly XcbModel[];
  /**
   * xcb's per-account application admission, when it reports one. `pending`
   * means xcb admits the account on first use (that call is slower); Track
   * treats it as usable. Absent on xcb builds without automatic admission.
   */
  admission?: "pending" | "admitted" | "denied" | undefined;
}>;
export type XcbCapabilities = Readonly<{
  supported: boolean;
  accounts: readonly XcbAccount[];
}>;

/** `XCB_BIN` if set, otherwise `xcb` on PATH. Never installs anything. */
export function resolveXcbBin(
  env: Readonly<Record<string, string | undefined>>,
  runner: CommandRunner,
): string | undefined {
  const explicit = env.XCB_BIN?.trim();
  if (explicit) return explicit;
  return runner.which("xcb");
}

function shortString(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max)
    : fallback;
}

/** Parse `xcb --json generate --capabilities` output from `unknown`. */
const ADMISSION_STATES = new Set(["pending", "admitted", "denied"]);

/** `"pending"` or `{ state | status: "pending" }`; anything else is ignored. */
function admissionState(value: unknown): XcbAccount["admission"] {
  const raw = isRecord(value) ? (value.state ?? value.status) : value;
  return typeof raw === "string" && ADMISSION_STATES.has(raw)
    ? (raw as XcbAccount["admission"])
    : undefined;
}

export function parseCapabilities(value: unknown): XcbCapabilities {
  if (!isRecord(value) || value.version !== 1)
    throw new XcbError("xcb capabilities were not a version-1 object");
  const rows = Array.isArray(value.accounts)
    ? value.accounts.slice(0, XCB_LIMITS.maxAccounts)
    : [];
  const accounts: XcbAccount[] = [];
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      !ID_PATTERN.test(row.id)
    )
      continue;
    const models: XcbModel[] = [];
    const modelRows = Array.isArray(row.models)
      ? row.models.slice(0, XCB_LIMITS.maxModelsPerAccount)
      : [];
    for (const model of modelRows) {
      if (
        !isRecord(model) ||
        typeof model.key !== "string" ||
        !MODEL_PATTERN.test(model.key)
      )
        continue;
      models.push({
        key: model.key,
        label: shortString(model.label, 64, model.key) || model.key,
      });
    }
    const label =
      shortString(row.label, 64) ||
      shortString(row.name, 64) ||
      shortString(row.email, 64) ||
      row.id;
    const admission = admissionState(row.admission);
    accounts.push({
      id: row.id,
      label,
      provider: shortString(row.provider, 32, "unknown") || "unknown",
      // A pending admission is usable: xcb admits the account on first call.
      available:
        models.length > 0 &&
        admission !== "denied" &&
        (row.available === true || admission === "pending"),
      ...(admission ? { admission } : {}),
      connected: row.connected === true,
      reason:
        typeof row.reason === "string" ? shortString(row.reason, 64) : null,
      models,
    });
  }
  return { supported: value.supported === true, accounts };
}

export async function readCapabilities(
  bin: string,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<XcbCapabilities> {
  const result = await runner.run(
    bin,
    ["--json", "generate", "--capabilities"],
    {
      timeoutMs: 15_000,
      maxOutputBytes: XCB_LIMITS.maxCapabilityBytes,
      ...(signal ? { signal } : {}),
    },
  );
  if (result.code !== 0)
    throw new XcbError(
      `xcb capabilities failed (exit ${result.code})`,
      "unavailable",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new XcbError("xcb capabilities were not valid JSON");
  }
  return parseCapabilities(parsed);
}

export type XcbGenerateRequest = Readonly<{
  bin: string;
  runner: CommandRunner;
  account: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}>;

/**
 * One `xcb --json generate` call. Aborting sends SIGTERM and waits for xcb to
 * finish its own cleanup (it keeps the account held until the provider exits).
 */
export async function xcbGenerate(
  request: XcbGenerateRequest,
): Promise<string> {
  if (!ID_PATTERN.test(request.account))
    throw new XcbError("invalid xcb account id", "invalid_request");
  if (!MODEL_PATTERN.test(request.model))
    throw new XcbError("invalid xcb model key", "invalid_request");
  const timeoutMs = clamp(
    Math.round(request.timeoutMs),
    XCB_LIMITS.minTimeoutMs,
    XCB_LIMITS.maxTimeoutMs,
  );
  const maxOutputBytes = clamp(
    Math.round(request.maxOutputBytes),
    1,
    XCB_LIMITS.maxOutputBytes,
  );
  const prompt = request.prompt.replace(/\u0000/g, "");
  if (prompt.trim().length === 0)
    throw new XcbError("empty prompt", "invalid_request");
  const body = JSON.stringify({
    version: 1,
    account: request.account,
    model: request.model,
    prompt,
    timeoutMs,
    maxOutputBytes,
  });
  if (new TextEncoder().encode(body).byteLength > XCB_LIMITS.maxInputBytes)
    throw new XcbError(
      "prompt exceeds xcb's 1 MiB input limit",
      "invalid_request",
    );
  if (request.signal?.aborted) throw new XcbError("cancelled", "cancelled");
  const result = await request.runner.run(request.bin, ["--json", "generate"], {
    stdin: body,
    // xcb enforces its own deadline; this is a backstop for a wedged process.
    timeoutMs: timeoutMs + 30_000,
    maxOutputBytes: maxOutputBytes * 2 + 16 * 1024,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (result.killed || request.signal?.aborted)
    throw new XcbError("cancelled", "cancelled");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new XcbError(`xcb generate returned no JSON (exit ${result.code})`);
  }
  if (!isRecord(parsed))
    throw new XcbError("xcb generate returned a non-object");
  if (
    parsed.status === "completed" &&
    result.code === 0 &&
    typeof parsed.text === "string"
  )
    return parsed.text.slice(0, maxOutputBytes);
  const code =
    typeof parsed.code === "string" && FAILURE_CODES.has(parsed.code)
      ? parsed.code
      : "provider_error";
  const requestId =
    typeof parsed.requestId === "string" &&
    /^[A-Za-z0-9_-]{1,80}$/.test(parsed.requestId)
      ? ` (${parsed.requestId})`
      : "";
  throw new XcbError(`xcb generate failed: ${code}${requestId}`, code);
}

/**
 * Find the first balanced top-level JSON object in `text`, honouring strings
 * and escapes. Only the first `maxBytes` characters are scanned.
 */
export function extractFirstJsonObject(
  text: string,
  maxChars = 64 * 1024,
): string | undefined {
  const scan = text.slice(0, maxChars);
  let start = scan.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < scan.length; index += 1) {
      const char = scan[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = scan.slice(start, index + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
    start = scan.indexOf("{", start + 1);
  }
  return undefined;
}

export type TextOp = Readonly<{ tool: string; args: Record<string, unknown> }>;
export type TextReply = Readonly<{
  ops: readonly TextOp[];
  say?: string;
  done: boolean;
}>;
export const TEXT_REPLY_LIMITS = Object.freeze({
  maxChars: 64 * 1024,
  maxOps: 16,
  maxSayChars: 400,
});

/** Parse a model reply into `{ops, say, done}` or throw with a short diagnostic. */
export function parseTextReply(text: string): TextReply {
  const json = extractFirstJsonObject(text, TEXT_REPLY_LIMITS.maxChars);
  if (json === undefined)
    throw new XcbError(
      text.length > TEXT_REPLY_LIMITS.maxChars
        ? "reply exceeded 64 KiB without a complete JSON object"
        : "reply did not contain a JSON object",
      "invalid_reply",
    );
  const value: unknown = JSON.parse(json);
  if (!isRecord(value))
    throw new XcbError("reply was not a JSON object", "invalid_reply");
  const rawOps = value.ops ?? [];
  if (!Array.isArray(rawOps))
    throw new XcbError("ops must be an array", "invalid_reply");
  if (rawOps.length > TEXT_REPLY_LIMITS.maxOps)
    throw new XcbError(
      `at most ${TEXT_REPLY_LIMITS.maxOps} ops per reply`,
      "invalid_reply",
    );
  const ops: TextOp[] = rawOps.map((op, index) => {
    if (
      !isRecord(op) ||
      typeof op.tool !== "string" ||
      op.tool.length === 0 ||
      op.tool.length > 64
    )
      throw new XcbError(`ops[${index}] needs a tool name`, "invalid_reply");
    const args = op.args ?? {};
    if (!isRecord(args))
      throw new XcbError(
        `ops[${index}].args must be an object`,
        "invalid_reply",
      );
    return { tool: op.tool, args };
  });
  const say =
    typeof value.say === "string" && value.say.trim()
      ? value.say.trim().slice(0, TEXT_REPLY_LIMITS.maxSayChars)
      : undefined;
  return { ops, done: value.done !== false, ...(say ? { say } : {}) };
}

/** A friendly short label: `claude/sonnet/low` → `claude/sonnet`. */
export function shortModelLabel(key: string): string {
  return key.split("/").slice(0, 2).join("/");
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
