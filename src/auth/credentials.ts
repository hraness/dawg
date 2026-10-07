import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "./runner.ts";

/**
 * Local credentials and provider choice. Secrets live in the macOS Keychain
 * or `~/.config/dawg/credentials.json` (0600 under a 0700 directory), never in
 * the project's `.dawg/` directory. `AI_GATEWAY_API_KEY` and
 * `OPENROUTER_API_KEY` always win over stored keys.
 */
export const KEYCHAIN_SERVICE = "dawg";
export const CONFIG_DIR_NAME = "dawg";
export const KEYCHAIN_ACCOUNT = "ai-gateway";

/** The two key-based providers. Subscriptions keep their secrets in xcb. */
export type KeyKind = "gateway" | "openrouter";
type KeySpec = Readonly<{
  account: string;
  field: string;
  env: string;
  label: string;
}>;
const KEY_SPECS: Readonly<Record<KeyKind, KeySpec>> = Object.freeze({
  gateway: {
    account: KEYCHAIN_ACCOUNT,
    field: "aiGateway",
    env: "AI_GATEWAY_API_KEY",
    label: "dawg AI Gateway key",
  },
  openrouter: {
    account: "openrouter",
    field: "openrouter",
    env: "OPENROUTER_API_KEY",
    label: "dawg OpenRouter key",
  },
});
/** A Vercel OIDC token is a JWT; bound it and keep the alphabet quote-safe. */
const OIDC_PATTERN = /^[A-Za-z0-9._-]{32,8192}$/;
const MAX_CONFIG_BYTES = 16 * 1024;
/** Gateway keys are opaque tokens; restricting the alphabet keeps them quote-safe. */
const KEY_PATTERN = /^[A-Za-z0-9._-]{16,256}$/;
const XCB_ACCOUNT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const XCB_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

/**
 * `codex` and `claude` are subscriptions through xcb; `xcb` is any xcb
 * account (Devin included), kept for `dawg login --xcb`.
 */
export const PROVIDER_CHOICES = Object.freeze([
  "gateway",
  "openrouter",
  "codex",
  "claude",
  "xcb",
  "auto",
] as const);
export type ProviderChoice = (typeof PROVIDER_CHOICES)[number];
export const SUBSCRIPTION_SLOTS = Object.freeze([
  "codex",
  "claude",
  "xcb",
] as const);
export type SubscriptionSlot = (typeof SUBSCRIPTION_SLOTS)[number];
export type XcbPick = Readonly<{ account: string; model: string }>;

export type DawgConfig = Readonly<{
  provider?: ProviderChoice;
  xcb?: XcbPick;
  codex?: XcbPick;
  claude?: XcbPick;
  /** Last model chosen per key-based provider: a `provider/model` ID. */
  gatewayModel?: string;
  openrouterModel?: string;
  /** Set when the first-run picker was dismissed, so it does not nag. */
  setup?: "skipped";
}>;

/** `vendor/model` IDs as the AI Gateway and OpenRouter spell them. */
export const PROVIDER_MODEL_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}$/i;

export type CredentialSource = "env" | "keychain" | "file" | "oidc";
export type ResolvedKey = Readonly<{ key: string; source: CredentialSource }>;

export type AuthEnv = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  runner: CommandRunner;
  platform: string;
  /** Absolute config directory; see `configDir`. */
  dir: string;
}>;

export function configDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = env.DAWG_CONFIG_DIR;
  if (explicit) return explicit;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, CONFIG_DIR_NAME);
}

export function defaultAuthEnv(runner: CommandRunner): AuthEnv {
  return {
    env: process.env,
    runner,
    platform: process.platform,
    dir: configDir(),
  };
}

export function isValidKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** `vck_…abcd`: never more than a short prefix and the last four characters. */
export function maskKey(key: string): string {
  if (key.length < 12) return "…";
  if (key.startsWith("sk-or-")) return `sk-or-…${key.slice(-4)}`;
  const underscore = key.indexOf("_");
  const prefix =
    underscore > 0 && underscore <= 4 ? key.slice(0, underscore + 1) : "";
  return `${prefix}…${key.slice(-4)}`;
}

function useKeychain(auth: AuthEnv): boolean {
  return (
    auth.platform === "darwin" &&
    auth.env.DAWG_CREDENTIAL_STORE !== "file" &&
    auth.runner.which("security") !== undefined
  );
}

/** Env, then Keychain, then the credentials file. */
export async function resolveKey(
  auth: AuthEnv,
  kind: KeyKind,
): Promise<ResolvedKey | undefined> {
  const spec = KEY_SPECS[kind];
  const fromEnv = auth.env[spec.env]?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const stored = await resolveStoredKey(auth, kind);
  return stored;
}

/** The Keychain or the credentials file, ignoring the environment. */
export async function resolveStoredKey(
  auth: AuthEnv,
  kind: KeyKind,
): Promise<ResolvedKey | undefined> {
  const spec = KEY_SPECS[kind];
  if (useKeychain(auth)) {
    const key = (await readKeychain(auth, spec.account)) ?? "";
    if (isValidKey(key)) return { key, source: "keychain" };
  }
  const file = await readJsonObject(join(auth.dir, "credentials.json"));
  const key = file?.[spec.field];
  if (isValidKey(key)) return { key, source: "file" };
  return undefined;
}

/**
 * The gateway credential: `AI_GATEWAY_API_KEY`, a stored key, then a
 * `VERCEL_OIDC_TOKEN` (what `vercel env pull` writes for a linked project;
 * AI Gateway accepts it as a bearer token until it expires).
 */
export async function resolveGatewayKey(
  auth: AuthEnv,
): Promise<ResolvedKey | undefined> {
  const key = await resolveKey(auth, "gateway");
  if (key) return key;
  const oidc = auth.env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc && OIDC_PATTERN.test(oidc)) return { key: oidc, source: "oidc" };
  return undefined;
}

export function resolveOpenRouterKey(
  auth: AuthEnv,
): Promise<ResolvedKey | undefined> {
  return resolveKey(auth, "openrouter");
}

/** Store a key. Returns where it went. Throws on an invalid key. */
export async function storeKey(
  auth: AuthEnv,
  kind: KeyKind,
  key: string,
): Promise<"keychain" | "file"> {
  const spec = KEY_SPECS[kind];
  if (!isValidKey(key))
    throw new Error(
      `that does not look like an ${kind === "gateway" ? "AI Gateway" : "OpenRouter"} key`,
    );
  if (useKeychain(auth)) {
    // `security -i` reads the command from stdin, so the secret never appears
    // in any process's argv. KEY_PATTERN guarantees it needs no escaping.
    const result = await auth.runner
      .run("security", ["-i"], {
        stdin: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${spec.account} -l "${spec.label}" -w "${key}"\n`,
        timeoutMs: 15_000,
        maxOutputBytes: 4096,
      })
      .catch(() => undefined);
    if (result?.code === 0) {
      const check = await readKeychain(auth, spec.account);
      if (check === key) {
        await removeFileKey(auth, kind);
        return "keychain";
      }
    }
  }
  const path = join(auth.dir, "credentials.json");
  const current = (await readJsonObject(path)) ?? {};
  await writePrivateJson(auth.dir, path, {
    ...current,
    version: 1,
    [spec.field]: key,
  });
  return "file";
}

export function storeGatewayKey(
  auth: AuthEnv,
  key: string,
): Promise<"keychain" | "file"> {
  return storeKey(auth, "gateway", key);
}

async function readKeychain(
  auth: AuthEnv,
  account: string,
): Promise<string | undefined> {
  const result = await auth.runner
    .run(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { timeoutMs: 10_000, maxOutputBytes: 4096 },
    )
    .catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() : undefined;
}

/** Remove a stored key from both backends. Env keys are left to the user. */
export async function clearKey(
  auth: AuthEnv,
  kind: KeyKind,
): Promise<string[]> {
  const removed: string[] = [];
  if (useKeychain(auth)) {
    const result = await auth.runner
      .run(
        "security",
        [
          "delete-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEY_SPECS[kind].account,
        ],
        { timeoutMs: 10_000, maxOutputBytes: 4096 },
      )
      .catch(() => undefined);
    if (result?.code === 0) removed.push("keychain");
  }
  if (await removeFileKey(auth, kind)) removed.push("file");
  return removed;
}

export function clearGatewayKey(auth: AuthEnv): Promise<string[]> {
  return clearKey(auth, "gateway");
}

/** The environment variable that overrides a stored key. */
export function keyEnvName(kind: KeyKind): string {
  return KEY_SPECS[kind].env;
}

async function removeFileKey(auth: AuthEnv, kind: KeyKind): Promise<boolean> {
  const field = KEY_SPECS[kind].field;
  const path = join(auth.dir, "credentials.json");
  const current = await readJsonObject(path);
  if (!current || !(field in current)) return false;
  const { [field]: _removed, ...rest } = current;
  if (Object.keys(rest).filter((key) => key !== "version").length === 0)
    await rm(path, { force: true });
  else await writePrivateJson(auth.dir, path, rest);
  return true;
}

export async function readConfig(
  auth: Pick<AuthEnv, "dir">,
): Promise<DawgConfig> {
  return parseConfig(await readJsonObject(join(auth.dir, "config.json")));
}

export function parseConfig(value: unknown): DawgConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const record = value as Record<string, unknown>;
  const config: {
    provider?: ProviderChoice;
    xcb?: XcbPick;
    codex?: XcbPick;
    claude?: XcbPick;
    gatewayModel?: string;
    openrouterModel?: string;
    setup?: "skipped";
  } = {};
  if (PROVIDER_CHOICES.includes(record.provider as ProviderChoice))
    config.provider = record.provider as ProviderChoice;
  for (const slot of SUBSCRIPTION_SLOTS) {
    const pick = parsePick(record[slot]);
    if (pick) config[slot] = pick;
  }
  for (const field of ["gatewayModel", "openrouterModel"] as const) {
    const id = record[field];
    if (typeof id === "string" && PROVIDER_MODEL_ID_PATTERN.test(id))
      config[field] = id;
  }
  if (record.setup === "skipped") config.setup = "skipped";
  return config;
}

function parsePick(value: unknown): XcbPick | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const { account, model } = value as Record<string, unknown>;
  return typeof account === "string" &&
    XCB_ACCOUNT_PATTERN.test(account) &&
    typeof model === "string" &&
    XCB_MODEL_PATTERN.test(model)
    ? { account, model }
    : undefined;
}

export type ConfigPatch = Partial<{
  provider: ProviderChoice | undefined;
  xcb: XcbPick | undefined;
  codex: XcbPick | undefined;
  claude: XcbPick | undefined;
  gatewayModel: string | undefined;
  openrouterModel: string | undefined;
  setup: "skipped" | undefined;
}>;

export async function writeConfig(
  auth: Pick<AuthEnv, "dir">,
  patch: ConfigPatch,
): Promise<DawgConfig> {
  const next: Record<string, unknown> = { ...(await readConfig(auth)) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  const parsed = parseConfig(next);
  await writePrivateJson(auth.dir, join(auth.dir, "config.json"), {
    version: 1,
    ...parsed,
  });
  return parsed;
}

async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Write via a 0600 temp file and rename, under a 0700 directory. */
export async function writePrivateJson(
  dir: string,
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
