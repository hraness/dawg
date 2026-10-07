import {
  clearKey,
  isValidKey,
  keyEnvName,
  maskKey,
  readConfig,
  resolveGatewayKey,
  resolveOpenRouterKey,
  storeKey,
  writeConfig,
  type AuthEnv,
  type KeyKind,
  type ProviderChoice,
  type ResolvedKey,
  type SubscriptionSlot,
} from "./credentials.ts";
import {
  describeReason,
  readCapabilities,
  resolveXcbBin,
  shortModelLabel,
  XCB_DOC_URL,
  XCB_INSTALL,
  XCB_MIN_VERSION,
  type XcbAccount,
  type XcbModel,
} from "../agent/xcb.ts";
import {
  isApiSelection,
  providerLabel,
  selectProvider,
  type ProviderSelection,
} from "../agent/provider.ts";
import {
  discover,
  familyCounts,
  LOGIN_OPTIONS,
  OPTION_TITLES,
  type Discovery,
  type LoginOption,
  type OptionStatus,
  type SubscriptionFamily,
} from "./discover.ts";
import {
  authorizeUrl,
  checkOpenRouterKey,
  createPkce,
  exchangeCode,
  OAUTH_TIMEOUT_MS,
  OPENROUTER_KEYS_URL,
  startCallbackServer,
} from "./openrouter.ts";
import {
  CLASS_TITLES,
  formatPromptCost,
  loadLiveCatalog,
  loadPrices,
  modelAlias,
  modelRows,
  resolveModelChoice,
  type ModelRow,
} from "../agent/models.ts";
import type { ApiProvider } from "../agent/gateway.ts";
import type { ChoiceItem, ChooseOptions } from "./picker.ts";

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
  /**
   * An arrow-key picker; resolves the chosen index or undefined on cancel.
   * Without it, choices are numbered and read with `ask`.
   */
  choose?(
    title: string,
    items: readonly ChoiceItem[],
    options?: ChooseOptions,
  ): Promise<number | undefined>;
}>;

export type LoginDeps = Readonly<{
  auth: AuthEnv;
  io: LoginIO;
  hostname: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Base URL override for OpenRouter (tests). */
  openrouterBaseUrl?: string;
  openrouterAuthUrl?: string;
  /** OAuth wait; defaults to five minutes. */
  oauthTimeoutMs?: number;
  /** Discovery deadline per probe. */
  discoveryTimeoutMs?: number;
}>;

/**
 * `auto` is bare `dawg login`: reuse a working saved choice, else discover
 * and pick. `key` pastes an AI Gateway key; `xcb` is any xcb account.
 */
export type LoginTarget = "auto" | "pick" | LoginOption | "key" | "xcb";
/** @deprecated kept for callers of the earlier API. */
export type LoginMode = LoginTarget;
export type KeyCheck = "valid" | "rejected" | "unverified";

export type LoginOptions = {
  budget?: number;
  xcb?: XcbPreset;
  /** `--account <id>` / `--model <key>` for codex and claude. */
  account?: string;
  model?: string;
};

/** `dawg login [<provider>|--key|--xcb] [--budget <dollars>]` → exit code. */
export async function login(
  target: LoginTarget,
  deps: LoginDeps,
  options: LoginOptions = {},
): Promise<number> {
  if (target === "xcb") return loginXcb(deps, options.xcb);
  if (target === "key") return loginWithPastedKey(deps, "gateway");
  if (target === "gateway") return loginGateway(deps, options);
  if (target === "openrouter") return loginOpenRouter(deps);
  if (target === "codex" || target === "claude")
    return loginSubscription(deps, target, options);
  if (target === "auto") {
    const config = await readConfig(deps.auth);
    if (config.provider && config.provider !== "auto") {
      const selection = await selectProvider(deps.auth);
      if (selection.kind !== "offline") {
        deps.io.print(
          `Signed in · ${providerLabel(selection)}. Switch with \`dawg login <gateway|openrouter|codex|claude>\` or \`dawg model\`.`,
        );
        return 0;
      }
      deps.io.print(`Your saved sign-in stopped working: ${selection.reason}.`);
    }
  }
  return loginPick(deps, options);
}

/** Discover everything, then show the picker (or confirm the one ready option). */
async function loginPick(
  deps: LoginDeps,
  options: LoginOptions,
): Promise<number> {
  const { io } = deps;
  io.print("Looking for existing setups…");
  const found = await discover(deps.auth, {
    refreshXcb: true,
    onProgress: (line) => io.print(line),
    ...(deps.discoveryTimeoutMs !== undefined
      ? { timeoutMs: deps.discoveryTimeoutMs }
      : {}),
  });
  const ready = found.options.filter((option) => option.ready);
  if (!io.interactive) {
    const best = ready[0];
    if (!best) {
      io.print("No AI provider is set up, and this is not a terminal.");
      io.print(
        "Set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY, or run `dawg login` in a terminal.",
      );
      return 1;
    }
    io.print(`Using ${best.title} (${stripCheck(best.summary)}).`);
    return useOption(deps, best.id, found, options);
  }
  if (ready.length === 1) {
    const only = ready[0]!;
    io.print(`Found ${only.title}: ${stripCheck(only.summary)}.`);
    const answer = (await io.ask(`Use ${only.title}? [Y/n] `))
      .trim()
      .toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes")
      return useOption(deps, only.id, found, options);
  }
  const initial = Math.max(
    0,
    found.options.findIndex((option) => option.ready || option.detected),
  );
  const index = await choose(
    io,
    "Sign in to dawg's agent",
    found.options.map((option, position) => ({
      label: `${option.title}${position === initial ? " (recommended)" : ""}`,
      detail: option.summary,
    })),
    { initial },
  );
  if (index === undefined) {
    io.print("Nothing changed. Direct commands work without signing in.");
    return 1;
  }
  return useOption(deps, found.options[index]!.id, found, options);
}

function stripCheck(summary: string): string {
  return summary.replace(/^✓\s*/, "");
}

async function useOption(
  deps: LoginDeps,
  id: LoginOption,
  found: Discovery,
  options: LoginOptions,
): Promise<number> {
  if (id === "gateway") return loginGateway(deps, options, found);
  if (id === "openrouter") return loginOpenRouter(deps, found.openrouterKey);
  return loginSubscription(deps, id, options);
}

/** The arrow-key picker when available, otherwise a numbered prompt. */
export async function choose(
  io: LoginIO,
  title: string,
  items: readonly ChoiceItem[],
  options: ChooseOptions = {},
): Promise<number | undefined> {
  if (io.choose) return io.choose(title, items, options);
  io.print(title);
  let group: string | undefined;
  items.forEach((item, index) => {
    if (item.group && item.group !== group) io.print(`  ${item.group}`);
    group = item.group;
    io.print(
      `  ${index + 1}) ${item.current ? "● " : ""}${item.label}${item.detail ? ` — ${item.detail}` : ""}`,
    );
  });
  if (!io.interactive) return undefined;
  const initial = (options.initial ?? 0) + 1;
  const answer = (
    await io.ask(`Choose 1-${items.length} [${initial}]: `)
  ).trim();
  const index = answer ? Number.parseInt(answer, 10) - 1 : initial - 1;
  if (!Number.isInteger(index) || index < 0 || index >= items.length)
    return undefined;
  return items[index]?.disabled ? undefined : index;
}

// ---------------------------------------------------------------------------
// Vercel AI Gateway

async function loginGateway(
  deps: LoginDeps,
  options: { budget?: number },
  found?: Discovery,
): Promise<number> {
  const { auth, io } = deps;
  const existing = found ? found.gatewayKey : await resolveGatewayKey(auth);
  if (existing && options.budget === undefined)
    return adoptKey(deps, "gateway", existing);
  const vercel = auth.runner.which("vercel");
  if (!vercel) {
    io.print(
      "The Vercel CLI is not installed. Install it to create a key automatically:",
    );
    io.print(`  ${VERCEL_INSTALL}`);
    io.print("Or paste an AI Gateway key (Enter opens the key page).");
    return loginWithPastedKey(deps, "gateway");
  }
  let who = await whoami(deps, vercel);
  if (!who) {
    if (!io.interactive) {
      io.print(
        "Not logged in to Vercel. Run `vercel login` first, or re-run `dawg login` in a terminal.",
      );
      return 1;
    }
    io.print(
      "Not logged in to Vercel; starting `vercel login` (opens your browser)…",
    );
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
  return saveAndReport(deps, "gateway", key, "created");
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

const SERVICE_NAMES: Readonly<Record<KeyKind, string>> = Object.freeze({
  gateway: "AI Gateway",
  openrouter: "OpenRouter",
});

/** A key that already exists (env or stored): validate it and select it. */
async function adoptKey(
  deps: LoginDeps,
  kind: KeyKind,
  key: ResolvedKey,
): Promise<number> {
  const { io } = deps;
  const check = await checkServiceKey(deps, kind, key.key);
  const where =
    key.source === "env" ? keyEnvName(kind) : `saved key ${maskKey(key.key)}`;
  if (check === "rejected") {
    io.print(`✗ ${SERVICE_NAMES[kind]} rejected the ${where}.`);
    if (key.source === "env") {
      io.print(`Unset ${keyEnvName(kind)} or replace it, then try again.`);
      return 1;
    }
    io.print("Let's replace it.");
    return kind === "openrouter"
      ? loginOpenRouter(deps, undefined)
      : loginWithPastedKey(deps, "gateway");
  }
  await selectService(deps, kind);
  io.print(
    `✓ Using ${SERVICE_NAMES[kind]} with ${where}${check === "unverified" ? " (could not verify offline)" : ""}.`,
  );
  return 0;
}

async function selectService(deps: LoginDeps, kind: KeyKind): Promise<void> {
  await writeConfig(deps.auth, { provider: kind, setup: undefined });
  const selection = await selectProvider(deps.auth);
  if (isApiSelection(selection))
    deps.io.print(
      `Model: ${modelAlias(kind, selection.modelId)} · change with \`dawg model\` or /model.`,
    );
}

async function loginWithPastedKey(
  deps: LoginDeps,
  kind: KeyKind,
): Promise<number> {
  const { io } = deps;
  const service = SERVICE_NAMES[kind];
  const page = kind === "gateway" ? KEYS_URL : OPENROUTER_KEYS_URL;
  if (!io.interactive) {
    io.print(
      `Pasting a key needs a terminal. Or set ${keyEnvName(kind)} in your environment.`,
    );
    return 1;
  }
  io.print(`Create a key at ${page}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entered = (
      await io.readSecret(
        `${service} key (input hidden, Enter to open the key page): `,
      )
    ).trim();
    if (!entered) {
      await openUrl(deps, page, "the key page");
      continue;
    }
    if (!isValidKey(entered)) {
      io.print(
        `That does not look like an ${service} key (letters, digits, - _ . only).`,
      );
      continue;
    }
    const check = await checkServiceKey(deps, kind, entered);
    if (check === "rejected") {
      io.print(`${service} rejected that key. Nothing was saved.`);
      continue;
    }
    return saveAndReport(deps, kind, entered, "pasted", check);
  }
  io.print("No key saved.");
  return 1;
}

async function saveAndReport(
  deps: LoginDeps,
  kind: KeyKind,
  key: string,
  how: "created" | "pasted" | "authorized",
  knownCheck?: KeyCheck,
): Promise<number> {
  const { auth, io } = deps;
  const service = SERVICE_NAMES[kind];
  const where = await storeKey(auth, kind, key);
  io.print(
    `Saved ${how} key ${maskKey(key)} to ${where === "keychain" ? "the macOS Keychain" : "~/.config/dawg/credentials.json"}.`,
  );
  const check = knownCheck ?? (await checkServiceKey(deps, kind, key));
  io.print(
    check === "valid"
      ? `✓ ${service} accepted the key.`
      : check === "rejected"
        ? `✗ ${service} rejected the key (new keys can take a moment; check with \`dawg auth status --check\`).`
        : `? Could not reach ${service} to verify the key; it is saved and will be used when online.`,
  );
  if (check === "rejected") return 1;
  await selectService(deps, kind);
  if (auth.env[keyEnvName(kind)])
    io.print(
      `Note: ${keyEnvName(kind)} is set in your environment and takes precedence.`,
    );
  io.print("Run `dawg` and type a request.");
  return 0;
}

function checkServiceKey(
  deps: Pick<LoginDeps, "auth" | "fetcher" | "openrouterBaseUrl">,
  kind: KeyKind,
  key: string,
): Promise<KeyCheck> {
  if (kind === "openrouter")
    return checkOpenRouterKey(key, {
      ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
      ...openrouterBase(deps),
    });
  return checkKey(deps, key);
}

function openrouterBase(deps: Pick<LoginDeps, "auth" | "openrouterBaseUrl">): {
  baseUrl?: string;
} {
  const base = deps.openrouterBaseUrl ?? deps.auth.env.OPENROUTER_BASE_URL;
  return base ? { baseUrl: base } : {};
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

// ---------------------------------------------------------------------------
// OpenRouter (OAuth PKCE)

async function loginOpenRouter(
  deps: LoginDeps,
  existing?: ResolvedKey,
): Promise<number> {
  const { io } = deps;
  const found = existing ?? (await resolveOpenRouterKey(deps.auth));
  if (found) return adoptKey(deps, "openrouter", found);
  if (!io.interactive) {
    io.print(
      "OpenRouter sign-in opens a browser, so it needs a terminal. Or set OPENROUTER_API_KEY.",
    );
    return 1;
  }
  const pkce = createPkce();
  const timeoutMs = deps.oauthTimeoutMs ?? OAUTH_TIMEOUT_MS;
  const server = startCallbackServer(pkce.state, { timeoutMs });
  try {
    // OpenRouter returns `state` unchanged next to `code` on the callback.
    const url = authorizeUrl(server.url, pkce, deps.openrouterAuthUrl);
    io.print("Sign in to OpenRouter in your browser to connect dawg.");
    await openUrl(deps, url, "OpenRouter");
    io.print(`If the browser did not open, visit:\n  ${url}`);
    io.print(
      `Waiting up to ${Math.round(timeoutMs / 60_000)} min… (Ctrl-C to cancel)`,
    );
    let code: string;
    try {
      code = await server.code;
    } catch (error) {
      io.print(
        `OpenRouter sign-in did not finish: ${error instanceof Error ? error.message : String(error)}.`,
      );
      io.print("You can paste a key instead.");
      return loginWithPastedKey(deps, "openrouter");
    }
    const key = await exchangeCode(code, pkce, {
      ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
      ...openrouterBase(deps),
    });
    return saveAndReport(deps, "openrouter", key, "authorized");
  } finally {
    server.stop();
  }
}

// ---------------------------------------------------------------------------
// Codex / Claude subscriptions through xcb

/** A pre-chosen xcb account and model (from the TUI picker). */
export type XcbPreset = Readonly<{ account: string; model: string }>;
export type XcbChoice = Readonly<{ account: XcbAccount; model: XcbModel }>;

/**
 * Every usable (account, model) pair xcb reports, without printing. An
 * account is usable iff `available`; models with no admission are skipped.
 */
export async function listXcbChoices(
  auth: AuthEnv,
  family?: string,
): Promise<XcbChoice[] | undefined> {
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) return undefined;
  try {
    return usableChoices(
      (await readCapabilities(bin, auth.runner)).accounts,
      family,
    );
  } catch {
    return undefined;
  }
}

function usableChoices(
  accounts: readonly XcbAccount[],
  family?: string,
): XcbChoice[] {
  return accounts
    .filter(
      (account) =>
        account.available &&
        (family === undefined || account.provider === family),
    )
    .sort(
      (a, b) =>
        Number(a.admission === "pending") - Number(b.admission === "pending"),
    )
    .flatMap((account) => account.models.map((model) => ({ account, model })));
}

const FAMILY_TITLES: Readonly<Record<SubscriptionFamily, string>> = {
  codex: OPTION_TITLES.codex,
  claude: OPTION_TITLES.claude,
};

async function loginSubscription(
  deps: LoginDeps,
  family: SubscriptionFamily,
  options: LoginOptions,
): Promise<number> {
  const { auth, io } = deps;
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin) {
    io.print(
      `dawg reaches your ${FAMILY_TITLES[family]} through xcb, which is not installed.`,
    );
    io.print(`  Install: ${XCB_INSTALL}`);
    io.print(`  Docs:    ${XCB_DOC_URL}`);
    io.print(`Then run \`dawg login ${family}\` again (or set XCB_BIN).`);
    return 1;
  }
  const read = async (): Promise<XcbAccount[] | undefined> => {
    const found = await discover(auth, {
      refreshXcb: true,
      onProgress: (line) => io.print(line),
      ...(deps.discoveryTimeoutMs !== undefined
        ? { timeoutMs: deps.discoveryTimeoutMs }
        : {}),
    });
    if (found.xcb.outdated)
      io.print(
        `xcb ${found.xcb.version ?? "?"} is installed; upgrade xcb to ${XCB_MIN_VERSION}+ (\`xcb upgrade\`).`,
      );
    if (found.xcb.state !== "ok") return undefined;
    return found.xcb.accounts.flatMap((row) =>
      row.account ? [row.account] : [],
    );
  };
  let accounts = await read();
  if (!accounts) {
    io.print("Could not read xcb's accounts. Check `xcb accounts list`.");
    return 1;
  }
  let choices = usableChoices(accounts, family);
  if (choices.length === 0) {
    const mine = accounts.filter((account) => account.provider === family);
    for (const account of mine.slice(0, 8))
      io.print(
        `  ${account.label} · ${describeReason(account.reason).replace("<account>", account.id)}`,
      );
    const setup = `xcb setup ${family}${mine.length > 0 ? " --new" : ""}`;
    if (!io.interactive) {
      io.print(
        `No ${FAMILY_TITLES[family]} is ready. Run \`${setup}\`, then \`dawg login ${family}\`.`,
      );
      return 1;
    }
    const answer = (
      await io.ask(
        `No ${FAMILY_TITLES[family]} is ready. Sign in now with \`${setup}\`? [Y/n] `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer !== "" && answer !== "y" && answer !== "yes") {
      io.print(`Run \`${setup}\` when ready, then \`dawg login ${family}\`.`);
      return 1;
    }
    const result = await auth.runner.run(bin, setup.split(" ").slice(1), {
      inherit: true,
      timeoutMs: 15 * 60_000,
    });
    if (result.code !== 0) {
      io.print(`\`${setup}\` did not finish. Nothing was saved.`);
      return 1;
    }
    accounts = (await read()) ?? [];
    choices = usableChoices(accounts, family);
    if (choices.length === 0) {
      io.print(
        `xcb still lists no usable ${family} account. Check \`xcb accounts list\`.`,
      );
      return 1;
    }
  }
  const picked = await pickXcbChoice(
    deps,
    choices,
    FAMILY_TITLES[family],
    options.account,
    options.model,
  );
  if (!picked) return 1;
  return saveXcb(deps, family, picked);
}

async function pickXcbChoice(
  deps: LoginDeps,
  choices: readonly XcbChoice[],
  title: string,
  account?: string,
  model?: string,
): Promise<XcbChoice | undefined> {
  const { io } = deps;
  let pool = choices;
  if (account) {
    pool = pool.filter(
      (choice) =>
        choice.account.id === account || choice.account.label === account,
    );
    if (pool.length === 0) {
      io.print(
        `No usable account "${account.slice(0, 40)}". Nothing was saved.`,
      );
      return undefined;
    }
  }
  if (model) {
    pool = pool.filter((choice) => choice.model.key === model);
    if (pool.length === 0) {
      io.print(
        `That account has no model "${model.slice(0, 60)}". Nothing was saved.`,
      );
      return undefined;
    }
  }
  // One account per row first, then its models.
  const accounts = [
    ...new Map(
      pool.map((choice) => [choice.account.id, choice.account]),
    ).values(),
  ];
  let chosenAccount = accounts[0]!;
  if (accounts.length > 1 && io.interactive) {
    const index = await choose(
      io,
      `${title} · choose an account`,
      accounts.map((row) => ({
        label: row.label,
        detail: `${row.models.length} models${row.admission === "pending" ? " · admits on first use" : ""}`,
      })),
    );
    if (index === undefined) {
      io.print("No account selected. Nothing was saved.");
      return undefined;
    }
    chosenAccount = accounts[index]!;
  }
  const models = pool.filter(
    (choice) => choice.account.id === chosenAccount.id,
  );
  let chosen = models[0]!;
  if (models.length > 1 && io.interactive) {
    const index = await choose(
      io,
      `${chosenAccount.label} · choose a model`,
      models.map((choice) => ({
        label: shortModelLabel(choice.model.key),
        detail: `${choice.model.label === choice.model.key ? "" : `${choice.model.label} · `}included`,
      })),
      { filter: models.length > 8 },
    );
    if (index === undefined) {
      io.print("No model selected. Nothing was saved.");
      return undefined;
    }
    chosen = models[index]!;
  }
  return chosen;
}

async function saveXcb(
  deps: LoginDeps,
  slot: SubscriptionSlot,
  picked: XcbChoice,
): Promise<number> {
  const { io } = deps;
  await writeConfig(deps.auth, {
    provider: slot,
    [slot]: { account: picked.account.id, model: picked.model.key },
    setup: undefined,
  });
  io.print(
    `✓ Using ${picked.account.label} (${picked.account.provider}) · ${shortModelLabel(picked.model.key)} through xcb.`,
  );
  if (picked.account.admission === "pending")
    io.print(
      "xcb admits this account on its first request, so the first turn can take up to a minute longer.",
    );
  io.print(
    "Saved to ~/.config/dawg/config.json (no secrets). Run `dawg` and type a request.",
  );
  return 0;
}

/** `dawg login --xcb`: any xcb account (Devin included). */
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
  const choices = usableChoices(accounts);
  if (choices.length === 0) {
    io.print("No xcb account is available for applications yet.");
    for (const account of accounts.slice(0, 12))
      io.print(
        `  ${account.label} · ${account.provider} · ${describeReason(account.reason).replace("<account>", account.id)}`,
      );
    if (accounts.length === 0)
      io.print(
        "No accounts found; add one with `xcb setup claude` or `xcb setup codex`.",
      );
    return 1;
  }
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
    return saveXcb(deps, slotFor(match.account.provider), match);
  }
  const picked = await pickXcbChoice(deps, choices, "xcb");
  if (!picked) return 1;
  return saveXcb(deps, slotFor(picked.account.provider), picked);
}

function slotFor(provider: string): SubscriptionSlot {
  return provider === "codex" || provider === "claude" ? provider : "xcb";
}

// ---------------------------------------------------------------------------
// Model picker

export type ModelChoice = Readonly<{
  label: string;
  detail: string;
  group: string;
  current: boolean;
  /** Saved with `saveModelChoice`. */
  value: string;
}>;

/**
 * The model list for the active provider: curated frontier/fast/open rows
 * the live catalog serves with tools, each with its estimated cost per
 * prompt; for a subscription, the models xcb lists for that account.
 */
export async function modelChoices(
  deps: Pick<LoginDeps, "auth" | "fetcher" | "openrouterBaseUrl">,
  selection: ProviderSelection,
): Promise<ModelChoice[]> {
  if (isApiSelection(selection)) {
    const common = {
      configDir: deps.auth.dir,
      ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
      // Tests (and mirrors) can point pricing elsewhere.
      ...(deps.auth.env.DAWG_MODELS_DEV_URL
        ? { url: deps.auth.env.DAWG_MODELS_DEV_URL }
        : {}),
    };
    const [catalog, prices] = await Promise.all([
      loadLiveCatalog(selection.kind, {
        ...common,
        apiKey: selection.apiKey,
        ...(selection.kind === "openrouter"
          ? openrouterBase(deps)
          : deps.auth.env.AI_GATEWAY_BASE_URL
            ? { baseUrl: deps.auth.env.AI_GATEWAY_BASE_URL }
            : {}),
      }),
      loadPrices(common),
    ]);
    return modelRows(selection.kind, {
      current: selection.modelId,
      ...(catalog ? { catalog } : {}),
      prices,
    }).map((row: ModelRow) => ({
      label: row.alias,
      detail: `${formatPromptCost(row.costUsd)}  ${row.label}`,
      group: CLASS_TITLES[row.class],
      current: row.current,
      value: row.id,
    }));
  }
  if (selection.kind === "xcb") {
    const capabilities = await readCapabilities(
      selection.bin,
      deps.auth.runner,
    );
    const account = capabilities.accounts.find(
      (row) => row.id === selection.account,
    );
    return (account?.available ? account.models : []).map((model) => ({
      label: shortModelLabel(model.key),
      detail:
        `included  ${model.label === model.key ? "" : model.label}`.trimEnd(),
      group: account!.label,
      current: model.key === selection.model,
      value: model.key,
    }));
  }
  return [];
}

/** Persist a model for the active provider; returns the new label. */
export async function saveModelChoice(
  auth: AuthEnv,
  selection: ProviderSelection,
  value: string,
): Promise<string> {
  if (isApiSelection(selection)) {
    const id = resolveModelChoice(selection.kind, value);
    if (!id) throw new Error(`unknown model "${value.slice(0, 40)}"`);
    await writeConfig(auth, {
      provider: selection.kind,
      [selection.kind === "openrouter" ? "openrouterModel" : "gatewayModel"]:
        id,
    });
    return `${modelAlias(selection.kind, id)} · ${selection.kind}`;
  }
  if (selection.kind === "xcb") {
    const slot = slotFor(selection.family);
    await writeConfig(auth, {
      provider: slot,
      [slot]: { account: selection.account, model: value },
    });
    return `${shortModelLabel(value)} · ${selection.family}`;
  }
  throw new Error(selection.reason);
}

/** `dawg model [<alias>|<vendor/model>]` → exit code. */
export async function modelCommand(
  deps: LoginDeps,
  arg?: string,
): Promise<number> {
  const { io, auth } = deps;
  const selection = await selectProvider(auth);
  if (selection.kind === "offline") {
    io.print(`No model available: ${selection.reason}.`);
    return 1;
  }
  const rows = await modelChoices(deps, selection);
  if (arg) {
    const value = isApiSelection(selection)
      ? resolveModelChoice(selection.kind, arg)
      : rows.find((row) => row.value === arg || row.label === arg)?.value;
    if (!value) {
      io.print(`Unknown model "${arg.slice(0, 40)}". Choices:`);
      for (const row of rows) io.print(`  ${row.label}  ${row.detail}`);
      return 2;
    }
    io.print(`model · ${await saveModelChoice(auth, selection, value)}`);
    return 0;
  }
  if (rows.length === 0) {
    io.print("The provider lists no models right now.");
    return 1;
  }
  const index = await choose(
    io,
    `Model · ${providerLabel(selection)}`,
    rows.map((row) => ({
      label: row.label,
      detail: row.detail,
      group: row.group,
      current: row.current,
    })),
    {
      initial: Math.max(
        0,
        rows.findIndex((row) => row.current),
      ),
      filter: true,
    },
  );
  if (index === undefined) {
    io.print(`model · ${providerLabel(selection)} (unchanged)`);
    return io.interactive ? 0 : 0;
  }
  io.print(
    `model · ${await saveModelChoice(auth, selection, rows[index]!.value)}`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Logout and status

const LOGOUT_TARGETS = Object.freeze([...LOGIN_OPTIONS, "xcb"] as const);
export type LogoutTarget = (typeof LOGOUT_TARGETS)[number];
export function isLogoutTarget(value: unknown): value is LogoutTarget {
  return (LOGOUT_TARGETS as readonly unknown[]).includes(value);
}

/**
 * `dawg logout [provider]`: with no provider, remove every stored key and
 * the saved choice; with one, remove only that provider's key or pick (and
 * the saved choice when it pointed there).
 */
export async function logout(
  deps: Pick<LoginDeps, "auth" | "io">,
  target?: LogoutTarget,
): Promise<number> {
  const { auth, io } = deps;
  const config = await readConfig(auth);
  const kinds: KeyKind[] = target
    ? target === "gateway" || target === "openrouter"
      ? [target]
      : []
    : ["gateway", "openrouter"];
  for (const kind of kinds) {
    const removed = await clearKey(auth, kind);
    io.print(
      removed.length > 0
        ? `Removed the stored ${SERVICE_NAMES[kind]} key (${removed.join(", ")}).`
        : `No stored ${SERVICE_NAMES[kind]} key.`,
    );
    if (auth.env[keyEnvName(kind)])
      io.print(`${keyEnvName(kind)} is still set in your environment.`);
  }
  const slots: SubscriptionSlot[] = target
    ? target === "codex" || target === "claude" || target === "xcb"
      ? [target]
      : []
    : ["codex", "claude", "xcb"];
  const patch: Record<string, undefined> = {};
  for (const slot of slots) {
    if (config[slot])
      io.print(
        `Forgot the ${slot} account choice (xcb keeps its own sign-in).`,
      );
    patch[slot] = undefined;
  }
  if (!target || config.provider === target) {
    patch.provider = undefined;
    patch.gatewayModel = undefined;
    patch.openrouterModel = undefined;
    io.print("Cleared the saved provider and model; `dawg login` asks again.");
  } else if (target === "gateway") patch.gatewayModel = undefined;
  else if (target === "openrouter") patch.openrouterModel = undefined;
  patch.setup = undefined;
  await writeConfig(auth, patch);
  return 0;
}

/**
 * `dawg auth status` / `/auth`: each option's detected state, which one is
 * active, and (with `verify`) whether its key is accepted. Never prints a
 * key, only its mask.
 */
export async function authStatus(
  deps: Pick<
    LoginDeps,
    "auth" | "fetcher" | "openrouterBaseUrl" | "discoveryTimeoutMs"
  >,
  options: {
    verify?: boolean;
    refreshXcb?: boolean;
    onProgress?: (line: string) => void;
  } = {},
): Promise<string[]> {
  const { auth } = deps;
  const [selection, config, found] = await Promise.all([
    selectProvider(auth),
    readConfig(auth),
    discover(auth, {
      refreshXcb: options.refreshXcb ?? true,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(deps.discoveryTimeoutMs !== undefined
        ? { timeoutMs: deps.discoveryTimeoutMs }
        : {}),
    }),
  ]);
  const active = activeOption(selection);
  const lines: string[] = [
    `active: ${providerLabel(selection)}${
      auth.env.DAWG_PROVIDER
        ? " (from DAWG_PROVIDER)"
        : config.provider
          ? " (saved)"
          : selection.kind === "offline"
            ? ""
            : " (auto)"
    }${selection.kind === "offline" ? ` · ${selection.reason}` : ""}`,
  ];
  for (const option of found.options) {
    let check = "";
    if (
      options.verify &&
      (option.id === "gateway" || option.id === "openrouter")
    ) {
      const key =
        option.id === "gateway" ? found.gatewayKey : found.openrouterKey;
      if (key) check = ` · ${await checkServiceKey(deps, option.id, key.key)}`;
    }
    lines.push(
      `${option.id === active ? "●" : " "} ${option.title.padEnd(28)} ${option.summary}${check}`,
    );
  }
  lines.push(xcbStatusLine(found));
  return lines;
}

function activeOption(selection: ProviderSelection): LoginOption | undefined {
  if (isApiSelection(selection)) return selection.kind;
  if (
    selection.kind === "xcb" &&
    (selection.family === "codex" || selection.family === "claude")
  )
    return selection.family;
  return undefined;
}

function xcbStatusLine(found: Discovery): string {
  const { xcb } = found;
  if (xcb.state === "missing") return `xcb: not installed (${XCB_INSTALL})`;
  const version = xcb.version ? ` ${xcb.version}` : "";
  const upgrade = xcb.outdated ? ` · upgrade xcb to ${XCB_MIN_VERSION}+` : "";
  if (xcb.state !== "ok") return `xcb${version}: ${xcb.state}${upgrade}`;
  const families = (["codex", "claude"] as const).map((family) => {
    const counts = familyCounts(xcb, family);
    return `${family} ${counts.ready} ready, ${counts.pending} pending, ${counts.unavailable + counts["signed-out"]} unavailable`;
  });
  return `xcb${version}: ${families.join(" · ")}${upgrade}`;
}

/** The picker's option statuses, for callers outside the login flow. */
export function optionLines(options: readonly OptionStatus[]): string[] {
  return options.map((option) => `${option.title}: ${option.summary}`);
}

async function openUrl(
  deps: Pick<LoginDeps, "auth" | "io">,
  url: string,
  what: string,
): Promise<void> {
  const opener = deps.auth.platform === "darwin" ? "open" : "xdg-open";
  if (!deps.auth.runner.which(opener)) return;
  const result = await deps.auth.runner
    .run(opener, [url], { timeoutMs: 10_000 })
    .catch(() => undefined);
  if (result?.code === 0) deps.io.print(`Opened ${what} in your browser.`);
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
  return text
    .replace(/\bvck_[A-Za-z0-9._-]+/g, "vck_[redacted]")
    .replace(/\bsk-or-[A-Za-z0-9._-]+/g, "sk-or-[redacted]");
}

export type { ProviderChoice };
