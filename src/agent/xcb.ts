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

export type XcbModel = Readonly<{
  key: string;
  label: string;
  admission?: XcbAdmission;
}>;
export type XcbAccount = Readonly<{
  id: string;
  label: string;
  provider: string;
  available: boolean;
  connected: boolean;
  reason: string | null;
  models: readonly XcbModel[];
  /**
   * xcb 0.20+: the best admission among the account's models. `pending`
   * means the first call checks it (up to ~60 s slower). Absent when the
   * account is unavailable or on older xcb builds.
   */
  admission?: XcbAdmission | undefined;
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

/**
 * xcb 0.20+ admission (docs/application-api.md): `pending` means the next
 * `generate` checks the model first and is slower but usable; `admitted` and
 * `qualified` are checked. It is `null` whenever the account has a `reason`,
 * so admission alone never makes an account usable: `available` does.
 */
export type XcbAdmission = "pending" | "admitted" | "qualified";
const ADMISSION_STATES = new Set<string>(["pending", "admitted", "qualified"]);

function admissionState(value: unknown): XcbAdmission | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && ADMISSION_STATES.has(value)
    ? (value as XcbAdmission)
    : undefined;
}

/** The first xcb release with automatic application admission. */
export const XCB_MIN_VERSION = "0.20.0";

/**
 * What a capability `reason` means for the user, with the next step. Unknown
 * reasons stay unavailable with the raw code.
 */
export function describeReason(reason: string | null): string {
  switch (reason) {
    case null:
      return "ready";
    case "application_disabled":
      return "app access turned off; run `xcb application enable`";
    case "authentication_required":
      return "signed out; run `xcb accounts login <account>`";
    case "not_connected":
      return "not signed in";
    case "account_disabled":
      return "disabled in xcb";
    case "account_busy":
      return "busy (run limit reached); try again shortly";
    case "runtime_unavailable":
      return "provider runtime unavailable; run `xcb doctor`";
    case "sandbox_unproven":
      return "xcb could not confirm the provider sandbox; run `xcb doctor`";
    case "admission_failed":
      return "automatic check failed; retry after 15 minutes";
    case "models_unavailable":
      return "no models listed; run `xcb accounts refresh <account>`";
    case "application_not_qualified":
      return "needs xcb 0.20.0+ (upgrade xcb)";
    default:
      return `unavailable (${reason})`;
  }
}

/** Parse `xcb --json generate --capabilities` output from `unknown`. */
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
      // xcb 0.20+ lists every model with an admission; `null` means this
      // account cannot use it. Older builds omit the field (all listed usable).
      const admission = admissionState(model.admission);
      if (admission === null) continue;
      models.push({
        key: model.key,
        label: shortString(model.label, 64, model.key) || model.key,
        ...(admission ? { admission } : {}),
      });
    }
    const label =
      shortString(row.label, 64) ||
      shortString(row.name, 64) ||
      shortString(row.email, 64) ||
      row.id;
    const reason =
      typeof row.reason === "string" ? shortString(row.reason, 64) : null;
    const admission = admissionState(row.admission);
    accounts.push({
      id: row.id,
      label,
      provider: shortString(row.provider, 32, "unknown") || "unknown",
      // Usable iff xcb says so and it lists a model to call.
      available: row.available === true && reason === null && models.length > 0,
      ...(admission ? { admission } : {}),
      connected: row.connected === true,
      reason,
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

/** One row of `xcb --json accounts`: sign-in state, no secrets. */
export type XcbAccountRow = Readonly<{
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  authenticationRequired: boolean;
}>;

/** Parse `xcb --json accounts` from `unknown`; unknown rows are skipped. */
export function parseAccountRows(value: unknown): XcbAccountRow[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) return [];
  const rows: XcbAccountRow[] = [];
  for (const row of value.accounts.slice(0, XCB_LIMITS.maxAccounts)) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      !ID_PATTERN.test(row.id)
    )
      continue;
    rows.push({
      id: row.id,
      label: shortString(row.name, 64) || shortString(row.email, 64) || row.id,
      provider: shortString(row.provider, 32, "unknown") || "unknown",
      enabled: row.enabled !== false,
      authenticationRequired: row.authenticationRequired === true,
    });
  }
  return rows;
}

/** `xcb --json accounts`, read-only. Empty on any failure. */
export async function readAccountRows(
  bin: string,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<XcbAccountRow[]> {
  const result = await runner
    .run(bin, ["--json", "accounts"], {
      timeoutMs: 15_000,
      maxOutputBytes: XCB_LIMITS.maxCapabilityBytes,
      ...(signal ? { signal } : {}),
    })
    .catch(() => undefined);
  if (!result || result.code !== 0) return [];
  try {
    return parseAccountRows(JSON.parse(result.stdout));
  } catch {
    return [];
  }
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

/** Extra child-process time for xcb's first-call admission check. */
export const XCB_ADMISSION_GRACE_MS = 75_000;
/** Backoff before retrying a `busy` result (two first calls on one account). */
export const XCB_BUSY_BACKOFF_MS = Object.freeze([2_000, 6_000]);

/**
 * `xcbGenerate`, retried with backoff while xcb answers `busy` (e.g. the
 * account is mid-admission for another caller). Other failures pass through.
 */
export async function xcbGenerateWithRetry(
  request: XcbGenerateRequest & {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<string> {
  const sleep = request.sleep ?? abortableSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await xcbGenerate(request);
    } catch (error) {
      const delay = XCB_BUSY_BACKOFF_MS[attempt];
      if (
        !(error instanceof XcbError) ||
        error.code !== "busy" ||
        delay === undefined ||
        request.signal?.aborted
      )
        throw error;
      await sleep(delay, request.signal);
      if (request.signal?.aborted) throw new XcbError("cancelled", "cancelled");
    }
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * `xcb accounts refresh <id>` for accounts whose catalog is empty
 * (`models_unavailable`): about 5 s, no provider turn. Each account is
 * refreshed at most once per process. Returns the ids that succeeded.
 */
const refreshedAccounts = new Set<string>();
export async function refreshAccounts(
  bin: string,
  runner: CommandRunner,
  ids: readonly string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  const todo = ids.filter(
    (id) => ID_PATTERN.test(id) && !refreshedAccounts.has(id),
  );
  for (const id of todo) refreshedAccounts.add(id);
  const results = await Promise.all(
    todo.map((id) =>
      runner
        .run(bin, ["accounts", "refresh", id], {
          timeoutMs: options.timeoutMs ?? 10_000,
          maxOutputBytes: 64 * 1024,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        .then((result) => (result.code === 0 ? id : undefined))
        .catch(() => undefined),
    ),
  );
  return results.filter((id): id is string => id !== undefined);
}

/** Test hook: forget which accounts this process refreshed. */
export function resetRefreshedAccounts(): void {
  refreshedAccounts.clear();
}

/** `xcb --version` → `0.20.0`, or undefined. */
export async function readXcbVersion(
  bin: string,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await runner
    .run(bin, ["--version"], {
      timeoutMs: 5_000,
      maxOutputBytes: 4096,
      ...(signal ? { signal } : {}),
    })
    .catch(() => undefined);
  if (!result || result.code !== 0) return undefined;
  return /(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
}

/** True when `version` is at least `min` (plain x.y.z). */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

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
    // xcb enforces its own deadline; this backstop also covers the automatic
    // admission check on a binding's first call (up to ~60 s on top).
    timeoutMs: timeoutMs + XCB_ADMISSION_GRACE_MS,
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
