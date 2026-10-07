import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  keyEnvName,
  maskKey,
  resolveGatewayKey,
  resolveOpenRouterKey,
  type AuthEnv,
  type ResolvedKey,
} from "./credentials.ts";
import {
  readAccountRows,
  readCapabilities,
  readXcbVersion,
  refreshAccounts,
  resolveXcbBin,
  versionAtLeast,
  XCB_MIN_VERSION,
  type XcbAccount,
  type XcbAccountRow,
  type XcbModel,
} from "../agent/xcb.ts";

/**
 * Read-only detection of every sign-in option, in parallel, each probe under
 * its own deadline. Nothing here writes, creates keys, or signs in; the only
 * subprocesses are `vercel whoami` and xcb's capability and account listings.
 */
export const LOGIN_OPTIONS = Object.freeze([
  "gateway",
  "openrouter",
  "codex",
  "claude",
] as const);
export type LoginOption = (typeof LOGIN_OPTIONS)[number];
export type SubscriptionFamily = "codex" | "claude";

export const OPTION_TITLES: Readonly<Record<LoginOption, string>> =
  Object.freeze({
    gateway: "Vercel AI Gateway",
    openrouter: "OpenRouter",
    codex: "ChatGPT / Codex subscription",
    claude: "Claude subscription",
  });

export type ProbeState = "ok" | "missing" | "timeout" | "error";

export type VercelProbe = Readonly<{
  state: ProbeState;
  bin?: string;
  /** `username (team slug)` when logged in. */
  user?: string;
  loggedIn: boolean;
}>;

export type SubscriptionReadiness =
  "ready" | "pending" | "unavailable" | "signed-out";

export type SubscriptionAccount = Readonly<{
  id: string;
  label: string;
  provider: string;
  readiness: SubscriptionReadiness;
  reason: string | null;
  models: readonly XcbModel[];
  account?: XcbAccount;
}>;

export type XcbProbe = Readonly<{
  state: ProbeState;
  bin?: string;
  /** `xcb --version`, when it answered. */
  version?: string;
  /** Installed xcb predates automatic admission (0.20.0). */
  outdated?: boolean;
  accounts: readonly SubscriptionAccount[];
}>;

export type OptionStatus = Readonly<{
  id: LoginOption;
  title: string;
  /** Usable right now with no further step. */
  ready: boolean;
  /** Something was found: ready, or one step away (e.g. Vercel CLI logged in). */
  detected: boolean;
  /** One line for the picker: "✓ found AI_GATEWAY_API_KEY". */
  summary: string;
}>;

export type Discovery = Readonly<{
  options: readonly OptionStatus[];
  gatewayKey?: ResolvedKey;
  openrouterKey?: ResolvedKey;
  vercel: VercelProbe;
  /** `.vercel/project.json` in the working directory. */
  linkedProject: boolean;
  xcb: XcbProbe;
}>;

export const DISCOVERY_TIMEOUT_MS = 4_000;

/** Resolve to `undefined` when `promise` misses the deadline. */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ value: T } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function discover(
  auth: AuthEnv,
  options: DiscoverOptions = {},
): Promise<Discovery> {
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const controller = new AbortController();
  try {
    const [gatewayKey, openrouterKey, vercel, linkedProject, xcb] =
      await Promise.all([
        withDeadline(
          resolveGatewayKey(auth).catch(() => undefined),
          timeoutMs,
        ).then((result) => result?.value),
        withDeadline(
          resolveOpenRouterKey(auth).catch(() => undefined),
          timeoutMs,
        ).then((result) => result?.value),
        probeVercel(auth, timeoutMs, controller.signal),
        isFile(join(options.cwd ?? process.cwd(), ".vercel", "project.json")),
        probeXcb(auth, timeoutMs, controller.signal, options),
      ]);
    const partial = { vercel, linkedProject, xcb };
    return {
      ...(gatewayKey ? { gatewayKey } : {}),
      ...(openrouterKey ? { openrouterKey } : {}),
      ...partial,
      options: [
        gatewayStatus(gatewayKey, vercel, linkedProject),
        openrouterStatus(openrouterKey),
        subscriptionStatus("codex", xcb),
        subscriptionStatus("claude", xcb),
      ],
    };
  } finally {
    // Stop any probe still running past its deadline.
    controller.abort();
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function probeVercel(
  auth: AuthEnv,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<VercelProbe> {
  const bin = auth.runner.which("vercel");
  if (!bin) return { state: "missing", loggedIn: false };
  const result = await withDeadline(
    vercelWhoami(auth, bin, { timeoutMs, signal }),
    timeoutMs,
  );
  if (!result) return { state: "timeout", bin, loggedIn: false };
  return result.value
    ? { state: "ok", bin, user: result.value, loggedIn: true }
    : { state: "ok", bin, loggedIn: false };
}

/** `vercel whoami --format json --non-interactive` → `user (team slug)`. */
export async function vercelWhoami(
  auth: Pick<AuthEnv, "runner">,
  vercel: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  const result = await auth.runner
    .run(vercel, ["whoami", "--format", "json", "--non-interactive"], {
      timeoutMs: options.timeoutMs ?? 20_000,
      maxOutputBytes: 64 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    .catch(() => undefined);
  if (!result || result.code !== 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const username =
      typeof record.username === "string" ? record.username : undefined;
    if (!username || !/^[\w.@+-]{1,64}$/.test(username)) return undefined;
    const team = record.team as Record<string, unknown> | undefined;
    const slug =
      team && typeof team.slug === "string" && /^[\w.-]{1,64}$/.test(team.slug)
        ? team.slug
        : undefined;
    return slug ? `${username} (team ${slug})` : username;
  } catch {
    return undefined;
  }
}

export type DiscoverOptions = {
  timeoutMs?: number;
  cwd?: string;
  /**
   * Run `xcb accounts refresh` for connected accounts that list no models
   * (sign-in and `dawg auth status` only; startup skips it).
   */
  refreshXcb?: boolean;
  /** Progress lines such as `refreshing 16 codex accounts…`. */
  onProgress?: (line: string) => void;
};

/** Per-account refresh cap; the whole refresh shares one extra deadline. */
export const XCB_REFRESH_TIMEOUT_MS = 10_000;

async function probeXcb(
  auth: AuthEnv,
  timeoutMs: number,
  signal: AbortSignal,
  options: DiscoverOptions = {},
): Promise<XcbProbe> {
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) return { state: "missing", accounts: [] };
  const result = await withDeadline(
    Promise.all([
      readCapabilities(bin, auth.runner, signal),
      readAccountRows(bin, auth.runner, signal),
      readXcbVersion(bin, auth.runner, signal),
    ]),
    timeoutMs,
  ).catch(() => "error" as const);
  if (result === "error") return { state: "error", bin, accounts: [] };
  if (!result) return { state: "timeout", bin, accounts: [] };
  let [capabilities, rows, version] = result.value;
  const stale = capabilities.accounts.filter(
    (account) =>
      account.connected &&
      account.reason === "models_unavailable" &&
      (account.provider === "codex" || account.provider === "claude"),
  );
  if (options.refreshXcb && stale.length > 0) {
    const families = [...new Set(stale.map((account) => account.provider))];
    options.onProgress?.(
      `refreshing ${stale.length} ${families.join("/")} account${stale.length === 1 ? "" : "s"}…`,
    );
    const refreshed = await withDeadline(
      refreshAccounts(
        bin,
        auth.runner,
        stale.map((account) => account.id),
        { timeoutMs: XCB_REFRESH_TIMEOUT_MS, signal },
      ),
      XCB_REFRESH_TIMEOUT_MS + 2_000,
    );
    if (refreshed && refreshed.value.length > 0) {
      const again = await withDeadline(
        readCapabilities(bin, auth.runner, signal),
        timeoutMs,
      ).catch(() => undefined);
      if (again) capabilities = again.value;
    }
  }
  return {
    state: "ok",
    bin,
    ...(version
      ? { version, outdated: !versionAtLeast(version, XCB_MIN_VERSION) }
      : {}),
    accounts: classifyAccounts(capabilities.accounts, rows),
  };
}

/** Merge xcb's capability rows with its sign-in rows into one readiness each. */
export function classifyAccounts(
  accounts: readonly XcbAccount[],
  rows: readonly XcbAccountRow[],
): SubscriptionAccount[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result: SubscriptionAccount[] = [];
  for (const account of accounts) {
    const row = byId.get(account.id);
    if (row && !row.enabled) continue;
    const readiness: SubscriptionReadiness = account.available
      ? account.admission === "pending"
        ? "pending"
        : "ready"
      : row?.authenticationRequired ||
          !account.connected ||
          account.reason === "authentication_required" ||
          account.reason === "not_connected"
        ? "signed-out"
        : "unavailable";
    result.push({
      id: account.id,
      label: account.label,
      provider: account.provider,
      readiness,
      reason: account.reason,
      models: account.models,
      account,
    });
  }
  // Accounts xcb lists but cannot generate with yet (no capability row).
  for (const row of rows) {
    if (!row.enabled || accounts.some((account) => account.id === row.id))
      continue;
    result.push({
      id: row.id,
      label: row.label,
      provider: row.provider,
      readiness: row.authenticationRequired ? "signed-out" : "unavailable",
      reason: null,
      models: [],
    });
  }
  return result;
}

export function usable(account: SubscriptionAccount): boolean {
  return account.readiness === "ready" || account.readiness === "pending";
}

function gatewayStatus(
  key: ResolvedKey | undefined,
  vercel: VercelProbe,
  linkedProject: boolean,
): OptionStatus {
  const base = { id: "gateway" as const, title: OPTION_TITLES.gateway };
  if (key)
    return {
      ...base,
      ready: true,
      detected: true,
      summary:
        key.source === "env"
          ? `✓ found ${keyEnvName("gateway")}`
          : key.source === "oidc"
            ? "✓ found VERCEL_OIDC_TOKEN"
            : `✓ saved key ${maskKey(key.key)}`,
    };
  if (vercel.loggedIn)
    return {
      ...base,
      ready: false,
      detected: true,
      summary: `✓ vercel CLI logged in as ${vercel.user}; creates a key`,
    };
  return {
    ...base,
    ready: false,
    detected: false,
    summary:
      vercel.state === "missing"
        ? "not set up · paste a key or install the vercel CLI"
        : vercel.state === "timeout"
          ? "vercel CLI did not answer in time · signs in with `vercel login`"
          : linkedProject
            ? "not signed in · project linked; signs in with `vercel login`"
            : "vercel CLI not logged in · signs in with `vercel login`",
  };
}

function openrouterStatus(key: ResolvedKey | undefined): OptionStatus {
  const base = { id: "openrouter" as const, title: OPTION_TITLES.openrouter };
  if (key)
    return {
      ...base,
      ready: true,
      detected: true,
      summary:
        key.source === "env"
          ? `✓ found ${keyEnvName("openrouter")}`
          : `✓ saved key ${maskKey(key.key)}`,
    };
  return {
    ...base,
    ready: false,
    detected: false,
    summary: "not set up · signs in through your browser",
  };
}

/** Counts per readiness for one subscription family. */
export function familyCounts(
  xcb: XcbProbe,
  family: string,
): Record<SubscriptionReadiness, number> {
  const counts = { ready: 0, pending: 0, unavailable: 0, "signed-out": 0 };
  for (const account of xcb.accounts)
    if (account.provider === family) counts[account.readiness] += 1;
  return counts;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function subscriptionStatus(
  family: SubscriptionFamily,
  xcb: XcbProbe,
): OptionStatus {
  const base = { id: family, title: OPTION_TITLES[family] };
  const name = family === "codex" ? "Codex" : "Claude";
  if (xcb.state === "missing")
    return {
      ...base,
      ready: false,
      detected: false,
      summary: "not set up · needs xcb",
    };
  if (xcb.state !== "ok")
    return {
      ...base,
      ready: false,
      detected: false,
      summary:
        xcb.state === "timeout"
          ? "xcb did not answer in time"
          : "xcb could not list accounts",
    };
  const counts = familyCounts(xcb, family);
  const parts: string[] = [];
  if (counts.ready > 0)
    parts.push(`${plural(counts.ready, `${name} account`)} ready`);
  if (counts.pending > 0)
    parts.push(
      `${counts.ready > 0 ? counts.pending : plural(counts.pending, `${name} account`)} admission pending`,
    );
  const usableCount = counts.ready + counts.pending;
  if (counts.unavailable > 0) parts.push(`${counts.unavailable} unavailable`);
  if (counts["signed-out"] > 0)
    parts.push(`${counts["signed-out"]} not signed in`);
  if (usableCount === 0 && xcb.outdated)
    parts.push(`upgrade xcb to ${XCB_MIN_VERSION}+`);
  if (parts.length === 0)
    return {
      ...base,
      ready: false,
      detected: false,
      summary: `not signed in · \`xcb setup ${family}\``,
    };
  return {
    ...base,
    ready: usableCount > 0,
    detected: usableCount > 0,
    summary: `${usableCount > 0 ? "✓ " : ""}${parts.join(" · ")}`,
  };
}

/** Usable (account, model) pairs for one family, ready accounts first. */
export function subscriptionChoices(
  xcb: XcbProbe,
  family: string | undefined,
): { account: SubscriptionAccount; model: XcbModel }[] {
  const accounts = xcb.accounts
    .filter(
      (account) =>
        usable(account) &&
        (family === undefined || account.provider === family),
    )
    .sort(
      (a, b) =>
        Number(b.readiness === "ready") - Number(a.readiness === "ready"),
    );
  return accounts.flatMap((account) =>
    account.models.map((model) => ({ account, model })),
  );
}
