import { statSync } from "node:fs";
import { join } from "node:path";
import {
  configDir,
  defaultAuthEnv,
  PROVIDER_CHOICES,
  readConfig,
  resolveGatewayKey,
  type AuthEnv,
  type CredentialSource,
  type ProviderChoice,
} from "../auth/credentials.ts";
import { systemRunner } from "../auth/runner.ts";
import {
  runAgentTurn,
  type AgentBudget,
  type AgentEvent,
  type AgentHost,
  type AgentTurnResult,
} from "./agent.ts";
import {
  createGatewayClient,
  type GatewayClient,
  type GatewayModel,
} from "./gateway.ts";
import { runTextAgentTurn } from "./xcb-agent.ts";
import {
  readCapabilities,
  resolveXcbBin,
  shortModelLabel,
  xcbGenerate,
  type XcbCapabilities,
} from "./xcb.ts";

/**
 * Which model backend a turn uses. `gateway` is the streaming tool-calling
 * loop on the Vercel AI Gateway; `xcb` emulates tools over `xcb --json
 * generate` with an AI subscription; `offline` means only direct commands.
 */
export type ProviderSelection =
  | Readonly<{
      kind: "gateway";
      choice: ProviderChoice;
      apiKey: string;
      source: CredentialSource;
    }>
  | Readonly<{
      kind: "xcb";
      choice: ProviderChoice;
      bin: string;
      account: string;
      accountLabel: string;
      model: string;
      /** xcb admits this account on its first call, which takes longer. */
      admissionPending?: boolean;
    }>
  | Readonly<{ kind: "offline"; choice: ProviderChoice; reason: string }>;

export const LOGIN_HINT = "run `track login` to enable the agent";
/** The small, cheap model used for one-line helpers such as session names. */
export const GATEWAY_SMALL_MODEL = "anthropic/claude-haiku-4.5";

export function providerChoice(
  env: Readonly<Record<string, string | undefined>>,
  saved: ProviderChoice | undefined,
): ProviderChoice {
  const fromEnv = env.TRACK_PROVIDER?.trim().toLowerCase();
  if (fromEnv && (PROVIDER_CHOICES as readonly string[]).includes(fromEnv))
    return fromEnv as ProviderChoice;
  return saved ?? "auto";
}

/**
 * Resolve the provider: `TRACK_PROVIDER`, then the choice saved by `track
 * login`, then `auto` (gateway when a key exists, else an available xcb
 * account, else offline).
 */
export async function selectProvider(
  auth: AuthEnv = defaultAuthEnv(systemRunner),
  options: { capabilities?: XcbCapabilities } = {},
): Promise<ProviderSelection> {
  const config = await readConfig(auth);
  const choice = providerChoice(auth.env, config.provider);
  if (choice === "gateway" || choice === "auto") {
    const key = await resolveGatewayKey(auth);
    if (key)
      return { kind: "gateway", choice, apiKey: key.key, source: key.source };
    if (choice === "gateway")
      return {
        kind: "offline",
        choice,
        reason: `no AI Gateway key; ${LOGIN_HINT}`,
      };
  }
  const bin = resolveXcbBin(auth.env, auth.runner);
  if (!bin)
    return {
      kind: "offline",
      choice,
      reason:
        choice === "xcb"
          ? "xcb is not installed; see `track login --xcb`"
          : `no model configured; ${LOGIN_HINT}`,
    };
  let capabilities: XcbCapabilities;
  try {
    capabilities =
      options.capabilities ?? (await readCapabilities(bin, auth.runner));
  } catch {
    return {
      kind: "offline",
      choice,
      reason: `xcb capabilities unavailable; ${LOGIN_HINT}`,
    };
  }
  const saved = config.xcb;
  if (saved) {
    const account = capabilities.accounts.find(
      (row) => row.id === saved.account,
    );
    if (
      account?.available &&
      account.models.some((model) => model.key === saved.model)
    )
      return {
        kind: "xcb",
        choice,
        bin,
        account: account.id,
        accountLabel: account.label,
        model: saved.model,
        ...(account.admission === "pending" ? { admissionPending: true } : {}),
      };
    if (choice === "xcb")
      return {
        kind: "offline",
        choice,
        reason: `xcb account ${saved.account.slice(0, 12)} is ${account?.reason ?? "missing"}; run \`track login --xcb\``,
      };
  }
  const account = capabilities.accounts.find((row) => row.available);
  if (account)
    return {
      kind: "xcb",
      choice,
      bin,
      account: account.id,
      accountLabel: account.label,
      model: account.models[0]!.key,
      ...(account.admission === "pending" ? { admissionPending: true } : {}),
    };
  return {
    kind: "offline",
    choice,
    reason:
      choice === "xcb"
        ? "no xcb account is qualified for applications; run `track login --xcb`"
        : `no model configured; ${LOGIN_HINT}`,
  };
}

/**
 * A cheap fingerprint of everything on disk and in the environment that
 * `selectProvider` reads (config.json, credentials.json, provider env vars).
 * Two stats per call; the host re-resolves the provider when it changes.
 */
export function providerFingerprint(
  dir: string = configDir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const parts = ["config.json", "credentials.json"].map((name) => {
    try {
      const info = statSync(join(dir, name));
      return `${name}:${info.size}:${info.mtimeMs}:${info.ino}`;
    } catch {
      return `${name}:-`;
    }
  });
  // Presence only: a process's environment cannot change under it, and the
  // fingerprint must never carry secret material.
  parts.push(
    `env:${env.TRACK_PROVIDER ?? "-"}:${env.AI_GATEWAY_API_KEY ? 1 : 0}`,
  );
  return parts.join("|");
}

/** `opus-5.5 · gateway`, `claude/sonnet · xcb`, or `offline`. */
export function providerLabel(
  selection: ProviderSelection,
  gatewayModel: GatewayModel,
): string {
  if (selection.kind === "gateway") return `${gatewayModel} · gateway`;
  if (selection.kind === "xcb")
    return `${shortModelLabel(selection.model)} · xcb`;
  return "offline";
}

export type ProviderTurnOptions = Readonly<{
  selection: ProviderSelection;
  prompt: string;
  model: GatewayModel;
  host: AgentHost;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  budget?: AgentBudget;
  /** Injected for tests; defaults to a client built from the selection's key. */
  gatewayClient?: GatewayClient;
  runner?: AuthEnv["runner"];
}>;

/** Run one agent turn on whichever provider was selected. */
export async function runProviderTurn(
  options: ProviderTurnOptions,
): Promise<AgentTurnResult> {
  const { selection } = options;
  const common = {
    prompt: options.prompt,
    host: options.host,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
  };
  if (selection.kind === "gateway")
    return runAgentTurn({
      ...common,
      model: options.model,
      client:
        options.gatewayClient ??
        createGatewayClient({ apiKey: selection.apiKey }),
    });
  if (selection.kind === "xcb") {
    const runner = options.runner ?? systemRunner;
    return runTextAgentTurn({
      ...common,
      generate: (prompt, call) =>
        xcbGenerate({
          bin: selection.bin,
          runner,
          account: selection.account,
          model: selection.model,
          prompt,
          timeoutMs: call.timeoutMs,
          maxOutputBytes: call.maxOutputBytes,
          signal: call.signal,
        }),
    });
  }
  const result: AgentTurnResult = {
    type: "error",
    code: "provider",
    message: selection.reason,
    applied: 0,
    revision: options.host.snapshot().revision,
  };
  options.onEvent?.(result);
  return result;
}

export type GenerateTextOptions = Readonly<{
  /** Upper bound on reply tokens (gateway `max_tokens`; xcb gets ~8 bytes per token). */
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Reuse an already-resolved provider; otherwise one is selected now. */
  selection?: ProviderSelection;
  gatewayClient?: GatewayClient;
  runner?: AuthEnv["runner"];
}>;

/**
 * One short, tool-free completion on whichever provider is configured, for
 * helpers such as the session auto-namer. Gateway uses `GATEWAY_SMALL_MODEL`;
 * xcb uses the selected account and model with a small output cap. Throws when
 * no provider is available (callers should fall back to a local default).
 * The returned text is untrusted, trimmed, and at most 512 characters.
 */
export async function generateText(
  prompt: string,
  options: GenerateTextOptions,
): Promise<string> {
  const selection = options.selection ?? (await selectProvider());
  const maxTokens = Math.min(1024, Math.max(1, Math.floor(options.maxTokens)));
  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, options.timeoutMs ?? 20_000),
  );
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const input = prompt.slice(0, 16_000);
  if (selection.kind === "gateway") {
    const client =
      options.gatewayClient ??
      createGatewayClient({ apiKey: selection.apiKey });
    let text = "";
    for await (const event of client.stream(
      {
        model: "opus-5.5",
        modelId: GATEWAY_SMALL_MODEL,
        maxTokens,
        messages: [{ role: "user", content: input }],
        maxResponseBytes: 16 * 1024,
      },
      signal,
    )) {
      if (event.type === "text") text += event.delta;
      if (text.length > 2048) break;
    }
    return text.trim().slice(0, 512);
  }
  if (selection.kind === "xcb") {
    const text = await xcbGenerate({
      bin: selection.bin,
      runner: options.runner ?? systemRunner,
      account: selection.account,
      model: selection.model,
      prompt: input,
      timeoutMs,
      maxOutputBytes: Math.min(4096, Math.max(64, maxTokens * 8)),
      signal,
    });
    return text.trim().slice(0, 512);
  }
  throw new Error(selection.reason);
}
