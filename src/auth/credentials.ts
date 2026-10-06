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
 * or `~/.config/track/credentials.json` (0600 under a 0700 directory), never in
 * the project's `.track/` directory. `AI_GATEWAY_API_KEY` always wins.
 */
export const KEYCHAIN_SERVICE = "track";
export const KEYCHAIN_ACCOUNT = "ai-gateway";
const MAX_CONFIG_BYTES = 16 * 1024;
/** Gateway keys are opaque tokens; restricting the alphabet keeps them quote-safe. */
const KEY_PATTERN = /^[A-Za-z0-9._-]{16,256}$/;
const XCB_ACCOUNT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const XCB_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

export const PROVIDER_CHOICES = Object.freeze([
  "gateway",
  "xcb",
  "auto",
] as const);
export type ProviderChoice = (typeof PROVIDER_CHOICES)[number];

export type TrackConfig = Readonly<{
  provider?: ProviderChoice;
  xcb?: Readonly<{ account: string; model: string }>;
}>;

export type CredentialSource = "env" | "keychain" | "file";
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
  if (env.TRACK_CONFIG_DIR) return env.TRACK_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "track");
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
  const underscore = key.indexOf("_");
  const prefix =
    underscore > 0 && underscore <= 4 ? key.slice(0, underscore + 1) : "";
  return `${prefix}…${key.slice(-4)}`;
}

function useKeychain(auth: AuthEnv): boolean {
  return (
    auth.platform === "darwin" &&
    auth.env.TRACK_CREDENTIAL_STORE !== "file" &&
    auth.runner.which("security") !== undefined
  );
}

/** Env, then Keychain, then the credentials file. */
export async function resolveGatewayKey(
  auth: AuthEnv,
): Promise<ResolvedKey | undefined> {
  const fromEnv = auth.env.AI_GATEWAY_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  if (useKeychain(auth)) {
    const result = await auth.runner
      .run(
        "security",
        [
          "find-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT,
          "-w",
        ],
        { timeoutMs: 10_000, maxOutputBytes: 4096 },
      )
      .catch(() => undefined);
    const key = result?.code === 0 ? result.stdout.trim() : "";
    if (isValidKey(key)) return { key, source: "keychain" };
  }
  const file = await readJsonObject(join(auth.dir, "credentials.json"));
  const key = file?.aiGateway;
  if (isValidKey(key)) return { key, source: "file" };
  return undefined;
}

/** Store the key. Returns where it went. Throws on an invalid key. */
export async function storeGatewayKey(
  auth: AuthEnv,
  key: string,
): Promise<"keychain" | "file"> {
  if (!isValidKey(key))
    throw new Error("that does not look like an AI Gateway key");
  if (useKeychain(auth)) {
    // `security -i` reads the command from stdin, so the secret never appears
    // in any process's argv. KEY_PATTERN guarantees it needs no escaping.
    const result = await auth.runner
      .run("security", ["-i"], {
        stdin: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -l "Track AI Gateway key" -w "${key}"\n`,
        timeoutMs: 15_000,
        maxOutputBytes: 4096,
      })
      .catch(() => undefined);
    if (result?.code === 0) {
      const check = await resolveFromKeychainOnly(auth);
      if (check === key) {
        await removeFileKey(auth);
        return "keychain";
      }
    }
  }
  const path = join(auth.dir, "credentials.json");
  const current = (await readJsonObject(path)) ?? {};
  await writePrivateJson(auth.dir, path, {
    ...current,
    version: 1,
    aiGateway: key,
  });
  return "file";
}

async function resolveFromKeychainOnly(
  auth: AuthEnv,
): Promise<string | undefined> {
  const result = await auth.runner
    .run(
      "security",
      [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ],
      { timeoutMs: 10_000, maxOutputBytes: 4096 },
    )
    .catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() : undefined;
}

/** Remove stored keys from both backends. Env keys are left to the user. */
export async function clearGatewayKey(auth: AuthEnv): Promise<string[]> {
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
          KEYCHAIN_ACCOUNT,
        ],
        { timeoutMs: 10_000, maxOutputBytes: 4096 },
      )
      .catch(() => undefined);
    if (result?.code === 0) removed.push("keychain");
  }
  if (await removeFileKey(auth)) removed.push("file");
  return removed;
}

async function removeFileKey(auth: AuthEnv): Promise<boolean> {
  const path = join(auth.dir, "credentials.json");
  const current = await readJsonObject(path);
  if (!current || !("aiGateway" in current)) return false;
  const { aiGateway: _removed, ...rest } = current;
  if (Object.keys(rest).filter((key) => key !== "version").length === 0)
    await rm(path, { force: true });
  else await writePrivateJson(auth.dir, path, rest);
  return true;
}

export async function readConfig(
  auth: Pick<AuthEnv, "dir">,
): Promise<TrackConfig> {
  return parseConfig(await readJsonObject(join(auth.dir, "config.json")));
}

export function parseConfig(value: unknown): TrackConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const record = value as Record<string, unknown>;
  const config: {
    provider?: ProviderChoice;
    xcb?: { account: string; model: string };
  } = {};
  if (PROVIDER_CHOICES.includes(record.provider as ProviderChoice))
    config.provider = record.provider as ProviderChoice;
  const xcb = record.xcb;
  if (typeof xcb === "object" && xcb !== null && !Array.isArray(xcb)) {
    const { account, model } = xcb as Record<string, unknown>;
    if (
      typeof account === "string" &&
      XCB_ACCOUNT_PATTERN.test(account) &&
      typeof model === "string" &&
      XCB_MODEL_PATTERN.test(model)
    )
      config.xcb = { account, model };
  }
  return config;
}

export async function writeConfig(
  auth: Pick<AuthEnv, "dir">,
  patch: Partial<{
    provider: ProviderChoice | undefined;
    xcb: TrackConfig["xcb"] | undefined;
  }>,
): Promise<TrackConfig> {
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
