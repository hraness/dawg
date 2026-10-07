import { envValue } from "../env.ts";
import {
  clearGatewayKey,
  isValidKey,
  maskKey,
  readConfig,
  resolveGatewayKey,
  storeGatewayKey,
  writeConfig,
  type AuthEnv,
} from "./credentials.ts";
import {
  readCapabilities,
  resolveXcbBin,
  XCB_DOC_URL,
  XCB_INSTALL,
  type XcbAccount,
  type XcbModel,
} from "../agent/xcb.ts";
import { providerLabel, selectProvider } from "../agent/provider.ts";

export const KEYS_URL =
  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys";
export const VERCEL_INSTALL = "bun add -g vercel   # or: npm i -g vercel";
const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** Terminal interaction, injectable so flows are testable without a TTY. */
export type LoginIO = Readonly<{
  print(line: string): void;
  /** Read a line without echo. */
  readSecret(prompt: string): Promise<string>;
  ask(prompt: string): Promise<string>;
  interactive: boolean;
}>;

export type LoginDeps = Readonly<{
  auth: AuthEnv;
  io: LoginIO;
  hostname: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}>;

export type LoginMode = "gateway" | "xcb" | "key";
export type KeyCheck = "valid" | "rejected" | "unverified";

/** `dawg login [--gateway|--xcb|--key] [--budget <dollars>]` → exit code. */
export async function login(
  mode: LoginMode,
  deps: LoginDeps,
  options: { budget?: number; xcb?: XcbPreset } = {},
): Promise<number> {
  if (mode === "xcb") return loginXcb(deps, options.xcb);
  if (mode === "key") return loginWithPastedKey(deps);
  return loginGateway(deps, options);
}

async function loginGateway(
  deps: LoginDeps,
  options: { budget?: number },
): Promise<number> {
  const { auth, io } = deps;
  const vercel = auth.runner.which("vercel");
  if (!vercel) {
    io.print(
      "The Vercel CLI is not installed. Install it to create a key automatically:",
    );
    io.print(`  ${VERCEL_INSTALL}`);
    io.print("Or paste an existing AI Gateway key instead.");
    return loginWithPastedKey(deps);
  }
  let who = await whoami(deps, vercel);
  if (!who) {
    if (!io.interactive) {
      io.print(
        "Not logged in to Vercel. Run `vercel login` first, or re-run `dawg login` in a terminal.",
      );
      return 1;
    }
    io.print("Not logged in to Vercel; starting `vercel login`…");
    const result = await auth.runner.run(vercel, ["login"], {
      inherit: true,
      timeoutMs: 10 * 60_000,
    });
    if (result.code !== 0) {
      io.print("`vercel login` did not finish. Nothing was saved.");
      return 1;
    }
    who = await whoami(deps, vercel);
    if (!who) {
      io.print("Still not logged in to Vercel. Nothing was saved.");
      return 1;
    }
  }
  io.print(`Vercel: ${who}`);
  const name = `dawg-${safeHostname(deps.hostname)}`;
  const args = [
    "ai-gateway",
    "api-keys",
    "create",
    "--name",
    name,
    "--non-interactive",
  ];
  if (options.budget !== undefined)
    args.push("--limit", String(options.budget));
  io.print(
    `Creating AI Gateway key "${name}"${options.budget !== undefined ? ` with a $${options.budget} limit` : ""}…`,
  );
  const created = await auth.runner.run(vercel, args, {
    timeoutMs: 60_000,
    maxOutputBytes: 64 * 1024,
  });
  // The CLI prints only the key on stdout; status lines go to stderr.
  const key = created.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => isValidKey(line));
  if (created.code !== 0 || !key) {
    const detail = created.stderr.replace(/\s+/g, " ").trim().slice(0, 200);
    io.print(
      `Could not create a key${detail ? `: ${redactKeys(detail)}` : ` (exit ${created.code})`}.`,
    );
    io.print("You can paste one instead with `dawg login --key`.");
    return 1;
  }
  return saveAndReport(deps, key, "created");
}

async function whoami(
  deps: LoginDeps,
  vercel: string,
): Promise<string | undefined> {
  const result = await deps.auth.runner
    .run(vercel, ["whoami", "--format", "json", "--non-interactive"], {
      timeoutMs: 20_000,
      maxOutputBytes: 64 * 1024,
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

async function loginWithPastedKey(deps: LoginDeps): Promise<number> {
  const { io } = deps;
  if (!io.interactive) {
    io.print(
      "Pasting a key needs a terminal. Or set AI_GATEWAY_API_KEY in your environment.",
    );
    return 1;
  }
  io.print(`Create a key at ${KEYS_URL}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entered = (
      await io.readSecret(
        "AI Gateway key (input hidden, Enter to open the key page): ",
      )
    ).trim();
    if (!entered) {
      await openUrl(deps, KEYS_URL);
      continue;
    }
    if (!isValidKey(entered)) {
      io.print(
        "That does not look like an AI Gateway key (letters, digits, - _ . only).",
      );
      continue;
    }
    const check = await checkKey(deps, entered);
    if (check === "rejected") {
      io.print("AI Gateway rejected that key. Nothing was saved.");
      continue;
    }
    return saveAndReport(deps, entered, "pasted", check);
  }
  io.print("No key saved.");
  return 1;
}

async function saveAndReport(
  deps: LoginDeps,
  key: string,
  how: "created" | "pasted",
  knownCheck?: KeyCheck,
): Promise<number> {
  const { auth, io } = deps;
  const where = await storeGatewayKey(auth, key);
  await writeConfig(auth, { provider: "gateway" });
  io.print(
    `Saved ${how} key ${maskKey(key)} to ${where === "keychain" ? "the macOS Keychain" : "~/.config/dawg/credentials.json"}.`,
  );
  const check = knownCheck ?? (await checkKey(deps, key));
  io.print(
    check === "valid"
      ? "✓ AI Gateway accepted the key. Run `dawg` and type a request."
      : check === "rejected"
        ? "✗ AI Gateway rejected the key (new keys can take a moment; check with `dawg auth status`)."
        : "? Could not reach AI Gateway to verify the key; it is saved and will be used when online.",
  );
  if (auth.env.AI_GATEWAY_API_KEY)
    io.print(
      "Note: AI_GATEWAY_API_KEY is set in your environment and takes precedence.",
    );
  return check === "rejected" ? 1 : 0;
}

/** A cheap authenticated request (`GET /v1/credits`). */
export async function checkKey(
  deps: Pick<LoginDeps, "auth" | "fetcher">,
  key: string,
): Promise<KeyCheck> {
  const fetcher = deps.fetcher ?? fetch;
  const base = (deps.auth.env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  try {
    const response = await fetcher(`${base}/credits`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "rejected";
    return "unverified";
  } catch {
    return "unverified";
  }
}

/** A pre-chosen xcb account and model (from the TUI picker). */
export type XcbPreset = Readonly<{ account: string; model: string }>;
export type XcbChoice = Readonly<{ account: XcbAccount; model: XcbModel }>;

/**
 * Every usable (account, model) pair xcb reports, without printing. Accounts
 * with a pending automatic admission count as usable.
 */
export async function listXcbChoices(
  auth: AuthEnv,
): Promise<XcbChoice[] | undefined> {
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) return undefined;
  try {
    return (await readCapabilities(bin, auth.runner)).accounts
      .filter((account) => account.available)
      .flatMap((account) =>
        account.models.map((model) => ({ account, model })),
      );
  } catch {
    return undefined;
  }
}

async function loginXcb(deps: LoginDeps, preset?: XcbPreset): Promise<number> {
  const { auth, io } = deps;
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) {
    io.print(
      "xcb is not installed. It routes dawg's requests to your Claude, Codex or Devin subscription.",
    );
    io.print(`  Install: ${XCB_INSTALL}`);
    io.print(`  Docs:    ${XCB_DOC_URL}`);
    io.print("Then run `dawg login --xcb` again (or set XCB_BIN to its path).");
    return 1;
  }
  let accounts: readonly XcbAccount[];
  try {
    accounts = (await readCapabilities(bin, auth.runner)).accounts;
  } catch (error) {
    io.print(
      `Could not read xcb capabilities: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const choices = accounts
    .filter((account) => account.available)
    .flatMap((account) => account.models.map((model) => ({ account, model })));
  if (choices.length === 0) {
    io.print("No xcb account is available for applications yet.");
    io.print(
      "An account must pass xcb's application qualification before apps like dawg can use it:",
    );
    io.print(`  ${XCB_DOC_URL}#application-checks-and-expiry`);
    const connected = accounts
      .filter((account) => account.connected)
      .slice(0, 8);
    if (connected.length > 0) {
      io.print(
        "Inspect what qualification would bind for an account (read-only):",
      );
      for (const account of connected)
        io.print(
          `  xcb --json qualify-application --inspect --account ${account.id} --model <model-key>   # ${account.label} · ${account.provider} · ${account.reason ?? "ready"}`,
        );
      io.print("List model keys with `xcb models`.");
    } else io.print("No connected accounts found; connect one with xcb first.");
    return 1;
  }
  let picked = choices[0]!;
  if (preset) {
    const match = choices.find(
      (choice) =>
        choice.account.id === preset.account &&
        choice.model.key === preset.model,
    );
    if (!match) {
      io.print(
        `xcb account ${preset.account.slice(0, 24)} · ${preset.model.slice(0, 60)} is no longer available. Nothing was saved.`,
      );
      return 1;
    }
    picked = match;
  } else if (choices.length > 1) {
    choices.forEach((choice, index) =>
      io.print(
        `  ${index + 1}) ${choice.account.label} · ${choice.account.provider} · ${choice.model.key}`,
      ),
    );
    if (io.interactive) {
      const answer = (await io.ask(`Choose 1-${choices.length} [1]: `)).trim();
      const index = answer ? Number.parseInt(answer, 10) - 1 : 0;
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
        io.print("No account selected. Nothing was saved.");
        return 1;
      }
      picked = choices[index]!;
    }
  }
  await writeConfig(auth, {
    provider: "xcb",
    xcb: { account: picked.account.id, model: picked.model.key },
  });
  io.print(
    `✓ Using ${picked.account.label} (${picked.account.provider}) · ${picked.model.key} through xcb.`,
  );
  if (picked.account.admission === "pending")
    io.print(
      "xcb admits this account on its first request, so the first turn takes longer.",
    );
  io.print(
    "Saved to ~/.config/dawg/config.json (no secrets). Run `dawg` and type a request.",
  );
  return 0;
}

/** `dawg logout`: remove stored keys and the saved provider choice. */
export async function logout(
  deps: Pick<LoginDeps, "auth" | "io">,
): Promise<number> {
  const removed = await clearGatewayKey(deps.auth);
  await writeConfig(deps.auth, { provider: undefined, xcb: undefined });
  deps.io.print(
    removed.length > 0
      ? `Removed the stored AI Gateway key (${removed.join(", ")}).`
      : "No stored AI Gateway key.",
  );
  deps.io.print("Cleared the saved provider choice.");
  if (deps.auth.env.AI_GATEWAY_API_KEY)
    deps.io.print("AI_GATEWAY_API_KEY is still set in your environment.");
  return 0;
}

/** `dawg auth status` / `/auth`. Never prints a key, only its mask. */
export async function authStatus(
  deps: Pick<LoginDeps, "auth" | "fetcher">,
  options: { verify?: boolean; gatewayModel?: "opus-5.5" | "sol-6.1" } = {},
): Promise<string[]> {
  const { auth } = deps;
  const lines: string[] = [];
  const selection = await selectProvider(auth);
  const config = await readConfig(auth);
  lines.push(
    `provider: ${providerLabel(selection, options.gatewayModel ?? "opus-5.5")} (${selection.choice}${
      envValue("PROVIDER", auth.env)
        ? " from DAWG_PROVIDER"
        : config.provider
          ? " saved"
          : ""
    })${selection.kind === "offline" ? ` · ${selection.reason}` : ""}`,
  );
  const key = await resolveGatewayKey(auth);
  if (key) {
    const check = options.verify ? ` · ${await checkKey(deps, key.key)}` : "";
    lines.push(`ai gateway key: ${maskKey(key.key)} (${key.source})${check}`);
  } else lines.push("ai gateway key: none");
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) lines.push("xcb: not installed");
  else if (selection.kind === "xcb")
    lines.push(`xcb: ${selection.accountLabel} · ${selection.model}`);
  else if (config.xcb)
    lines.push(`xcb: saved ${config.xcb.account} · ${config.xcb.model}`);
  else lines.push("xcb: installed, no account chosen (`dawg login --xcb`)");
  return lines;
}

async function openUrl(deps: LoginDeps, url: string): Promise<void> {
  const opener = deps.auth.platform === "darwin" ? "open" : "xdg-open";
  if (!deps.auth.runner.which(opener)) {
    deps.io.print(`Open ${url}`);
    return;
  }
  await deps.auth.runner
    .run(opener, [url], { timeoutMs: 10_000 })
    .catch(() => undefined);
  deps.io.print("Opened the key page in your browser.");
}

export function safeHostname(hostname: string): string {
  const cleaned = hostname
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "host";
}

function redactKeys(text: string): string {
  return text.replace(/\bvck_[A-Za-z0-9._-]+/g, "vck_[redacted]");
}
