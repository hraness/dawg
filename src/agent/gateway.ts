import { isProviderModelId } from "../auth/credentials.ts";
import { readSseData, SseBudgetError } from "./sse.ts";

/**
 * The two original model aliases. A model is either one of these or an exact
 * `vendor/model` ID chosen from the model picker (see `models.ts`).
 */
export const GATEWAY_MODELS = Object.freeze(["opus-5.5", "sol-6.1"] as const);
export type GatewayModel = (typeof GATEWAY_MODELS)[number];

/**
 * Default provider IDs, confirmed against the AI Gateway catalog
 * (`GET https://ai-gateway.vercel.sh/v1/models`, 2026-10-06): both are
 * language models tagged `tool-use`.
 */
export const DEFAULT_MODEL_IDS: Readonly<Record<GatewayModel, string>> =
  Object.freeze({
    "opus-5.5": "anthropic/claude-opus-5.5",
    "sol-6.1": "openai/gpt-6.1-sol",
  });

const MAX_ERROR_BODY_BYTES = 4 * 1024;

export function isGatewayModel(value: unknown): value is GatewayModel {
  return (
    typeof value === "string" &&
    (GATEWAY_MODELS as readonly string[]).includes(value)
  );
}

/**
 * Resolve an alias (`opus-5.5`) or an exact `vendor/model` ID to the ID sent
 * to the provider, rejecting anything else.
 */
export function resolveModelId(
  alias: string,
  overrides: Partial<Record<GatewayModel, string | undefined>> = {},
  provider: ApiProvider = "gateway",
): string {
  if (!isGatewayModel(alias)) {
    if (isProviderModelId(alias, provider)) return alias;
    throw new Error(
      `unknown model "${alias.slice(0, 32)}"; use ${GATEWAY_MODELS.join(" or ")} or a vendor/model ID`,
    );
  }
  const id = overrides[alias] ?? DEFAULT_MODEL_IDS[alias];
  if (!isProviderModelId(id, provider))
    throw new Error(`model ID for ${alias} must look like provider/model`);
  return id;
}

function checkedModelId(id: string, provider: ApiProvider): string {
  if (!isProviderModelId(id, provider))
    throw new Error("model ID must look like provider/model");
  return id;
}

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatStreamRequest = {
  /** An alias (`opus-5.5`) or an exact `vendor/model` ID. */
  model: string;
  messages: readonly ChatMessage[];
  tools?: readonly ChatTool[];
  temperature?: number;
  /** Exact provider model ID, bypassing the alias (e.g. a small model for naming). */
  modelId?: string;
  maxTokens?: number;
  maxResponseBytes: number;
  /**
   * A model ID to try once when every attempt on the main model failed
   * before producing a byte (a 5xx, a header timeout, a stalled stream).
   */
  fallbackModelId?: string;
};

/** Normalized stream events; provider chunk shapes never leave this module. */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  /** Progress worth a status line, such as a retry; never model output. */
  | { type: "activity"; message: string }
  | {
      type: "tool-delta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "finish"; reason: string }
  /**
   * Token usage for one request, from the final chunk when the request asked
   * for `stream_options.include_usage`. `costUsd` is the provider's own
   * charge when it reports one (OpenRouter's `usage.cost`).
   */
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      costUsd?: number;
    };

export type GatewayClient = {
  /** Which service this client talks to. */
  readonly provider?: ApiProvider;
  /** The provider model ID that a turn will use (for diagnostics only). */
  modelId(model: string): string;
  stream(
    request: ChatStreamRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent>;
};

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

type GatewayFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Retries after a failed request that has not yet produced a byte. */
export const GATEWAY_RETRIES = 2;
/** Base backoff; each retry doubles it, with +-50% jitter. */
const RETRY_BASE_MS = 500;
/** Response headers must arrive within this long, per attempt. */
export const GATEWAY_HEADER_TIMEOUT_MS = 15_000;
/**
 * After headers, the first stream event must arrive within this long, per
 * attempt. A provider that accepts the request and then sends nothing is
 * retried like a header timeout: no byte has reached the caller yet.
 */
export const GATEWAY_FIRST_BYTE_TIMEOUT_MS = 20_000;

export type GatewayRetryOptions = Readonly<{
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}>;

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** The two OpenAI-compatible, key-based services. */
export type ApiProvider = "gateway" | "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
/** OpenRouter's app attribution headers (https://openrouter.ai/docs/app-attribution). */
const OPENROUTER_HEADERS = Object.freeze({
  "http-referer": "https://dawg.sh",
  "x-title": "dawg",
});

export type ApiClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  modelIds?: Partial<Record<GatewayModel, string>>;
  fetcher?: GatewayFetcher;
  retry?: GatewayRetryOptions;
  headerTimeoutMs?: number;
  firstByteTimeoutMs?: number;
};

/** The streaming tool-calling client for OpenRouter's OpenAI-compatible API. */
export function createOpenRouterClient(
  options: ApiClientOptions = {},
): GatewayClient {
  return createApiClient("openrouter", {
    ...options,
    baseUrl:
      options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL,
    apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
  });
}

export function createGatewayClient(
  options: ApiClientOptions = {},
): GatewayClient {
  return createApiClient("gateway", {
    ...options,
    baseUrl:
      options.baseUrl ?? process.env.AI_GATEWAY_BASE_URL ?? GATEWAY_BASE_URL,
    apiKey: options.apiKey ?? process.env.AI_GATEWAY_API_KEY,
  });
}

function createApiClient(
  provider: ApiProvider,
  options: ApiClientOptions,
): GatewayClient {
  const fetcher = options.fetcher ?? fetch;
  const name = provider === "openrouter" ? "OpenRouter" : "AI Gateway";
  const baseUrl = (options.baseUrl ?? GATEWAY_BASE_URL).replace(/\/$/, "");
  const apiKey = options.apiKey;
  const retries = options.retry?.retries ?? GATEWAY_RETRIES;
  const retryBaseMs = options.retry?.baseMs ?? RETRY_BASE_MS;
  const sleep = options.retry?.sleep ?? ((ms: number) => Bun.sleep(ms));
  const random = options.retry?.random ?? Math.random;
  const headerTimeoutMs = options.headerTimeoutMs ?? GATEWAY_HEADER_TIMEOUT_MS;
  const firstByteTimeoutMs =
    options.firstByteTimeoutMs ?? GATEWAY_FIRST_BYTE_TIMEOUT_MS;
  const overrides: Partial<Record<GatewayModel, string | undefined>> = {
    "opus-5.5": process.env.DAWG_OPUS_MODEL || undefined,
    "sol-6.1": process.env.DAWG_SOL_MODEL || undefined,
    ...options.modelIds,
  };
  const redact = (text: string): string =>
    apiKey && apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;

  return {
    provider,
    modelId: (model) => resolveModelId(model, overrides, provider),
    async *stream(request, signal) {
      const primary =
        request.modelId !== undefined
          ? checkedModelId(request.modelId, provider)
          : resolveModelId(request.model, overrides, provider);
      const fallback =
        request.fallbackModelId !== undefined &&
        request.fallbackModelId !== primary
          ? checkedModelId(request.fallbackModelId, provider)
          : undefined;
      if (!apiKey)
        throw new GatewayError(
          provider === "openrouter"
            ? "no OpenRouter key; run `dawg login openrouter` or set OPENROUTER_API_KEY"
            : "no AI Gateway key; run `dawg login` or set AI_GATEWAY_API_KEY",
        );
      const encodeFor = (model: string): string => {
        const body: Record<string, unknown> = {
          model,
          messages: withPromptCache(provider, model, request.messages),
          stream: true,
          // The final chunk then carries token usage (and OpenRouter's cost).
          stream_options: { include_usage: true },
        };
        if (provider === "openrouter") body.usage = { include: true };
        // The Gateway adds Anthropic cache breakpoints itself when asked; it
        // documents the option as a no-op for implicitly caching providers.
        else body.providerOptions = { gateway: { caching: "auto" } };
        if (request.tools && request.tools.length > 0) {
          body.tools = request.tools;
          body.tool_choice = "auto";
        }
        if (request.temperature !== undefined)
          body.temperature = request.temperature;
        if (
          request.maxTokens !== undefined &&
          Number.isInteger(request.maxTokens) &&
          request.maxTokens > 0
        )
          body.max_tokens = Math.min(request.maxTokens, 4096);
        return JSON.stringify(body);
      };
      let model = primary;
      let encoded = encodeFor(model);
      // Retry only before any byte of a response has been consumed: a
      // network failure, a header-phase timeout, or 408/429/5xx. Once the
      // stream is flowing, a failure surfaces as-is (replaying could repeat
      // tool calls the model already made).
      let events: AsyncIterator<string> | undefined;
      let first: IteratorResult<string> | undefined;
      const streamOptions: { maxBytes: number; signal?: AbortSignal } = {
        maxBytes: request.maxResponseBytes,
      };
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw abortError(signal);
        // The header budget bounds only the wait for response headers. A
        // fetch signal also governs the body, so the timer is cleared as soon
        // as headers arrive; after that only the caller's signal (the user or
        // the turn budget) can cut the stream short.
        const headerController = new AbortController();
        const headerTimer = setTimeout(
          () =>
            headerController.abort(
              new DOMException(
                `${name} did not respond within ${headerTimeoutMs} ms`,
                "TimeoutError",
              ),
            ),
          headerTimeoutMs,
        );
        const headerSignal = headerController.signal;
        const requestSignal =
          signal === undefined
            ? headerSignal
            : AbortSignal.any([signal, headerSignal]);
        const init: RequestInit = {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
            ...(provider === "openrouter" ? OPENROUTER_HEADERS : {}),
          },
          body: encoded,
          signal: requestSignal,
        };
        let reason: string;
        try {
          let candidate: Response;
          try {
            candidate = await fetcher(`${baseUrl}/chat/completions`, init);
          } finally {
            clearTimeout(headerTimer);
          }
          if (candidate.ok) {
            if (!candidate.body)
              throw new GatewayError(`${name} returned an empty stream`);
            // Wait for the first event under its own budget; the stall
            // signal is never fired once it has arrived.
            const stall = new AbortController();
            const stallTimer = setTimeout(
              () =>
                stall.abort(
                  new DOMException(
                    `${name} sent nothing within ${firstByteTimeoutMs} ms`,
                    "TimeoutError",
                  ),
                ),
              firstByteTimeoutMs,
            );
            streamOptions.signal =
              signal === undefined
                ? stall.signal
                : AbortSignal.any([signal, stall.signal]);
            // Any byte, a keep-alive comment included, proves the provider
            // is alive and disarms the stall timer.
            const watched = candidate.body.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  clearTimeout(stallTimer);
                  controller.enqueue(chunk);
                },
              }),
            );
            const iterator = readSseData(watched, streamOptions)[
              Symbol.asyncIterator
            ]();
            try {
              first = await iterator.next();
              events = iterator;
              break;
            } catch (error) {
              if (!stall.signal.aborted || signal?.aborted) throw error;
              await iterator.return?.(undefined).catch(() => undefined);
              if (attempt >= retries) {
                if (fallback !== undefined && model !== fallback) {
                  model = fallback;
                  encoded = encodeFor(model);
                  attempt = -1;
                  yield {
                    type: "activity",
                    message: `falling back to ${model} (stalled)…`,
                  };
                  continue;
                }
                throw new GatewayError(
                  `${name} sent nothing within ${firstByteTimeoutMs} ms`,
                );
              }
              reason = "stalled";
            } finally {
              clearTimeout(stallTimer);
            }
            yield { type: "activity", message: `retrying (${reason})…` };
            await sleep(
              Math.round(retryBaseMs * 2 ** attempt * (0.5 + random())),
            );
            continue;
          }
          const detail = redact(await boundedErrorDetail(candidate));
          const error = new GatewayError(
            `${name} request failed (${candidate.status})${detail ? `: ${detail}` : ""}`,
            candidate.status,
          );
          if (!retryableStatus(candidate.status)) throw error;
          if (attempt >= retries) {
            if (fallback === undefined || model === fallback) throw error;
            reason = String(candidate.status);
            model = fallback;
            encoded = encodeFor(model);
            attempt = -1;
            yield {
              type: "activity",
              message: `falling back to ${model} (${reason})…`,
            };
            continue;
          }
          reason = String(candidate.status);
        } catch (error) {
          if (error instanceof GatewayError || error instanceof SseBudgetError)
            throw error;
          if (signal?.aborted) throw abortError(signal);
          if (attempt >= retries) {
            const failure = new GatewayError(
              headerSignal.aborted
                ? `${name} did not respond within ${headerTimeoutMs} ms`
                : `${name} request failed: ${redact(error instanceof Error ? error.message : String(error))}`,
            );
            if (fallback === undefined || model === fallback) throw failure;
            model = fallback;
            encoded = encodeFor(model);
            attempt = -1;
            yield {
              type: "activity",
              message: `falling back to ${model} (${headerSignal.aborted ? "timeout" : "network"})…`,
            };
            continue;
          }
          reason = headerSignal.aborted ? "timeout" : "network";
        }
        yield { type: "activity", message: `retrying (${reason})…` };
        const backoff = retryBaseMs * 2 ** attempt;
        await sleep(Math.round(backoff * (0.5 + random())));
      }
      try {
        for (let next = first; !next.done; next = await events.next()) {
          const data = next.value;
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            throw new GatewayError(`${name} sent a malformed stream chunk`);
          }
          yield* normalizeChunk(chunk, redact, name);
        }
      } catch (error) {
        // A failure while the body streams (a reset connection, a transport
        // timeout) is a provider failure, not an internal one. Budget errors
        // and the caller's own abort keep their identity.
        if (
          error instanceof GatewayError ||
          error instanceof SseBudgetError ||
          signal?.aborted
        )
          throw error;
        const timedOut =
          error instanceof Error && error.name === "TimeoutError";
        throw new GatewayError(
          timedOut
            ? `${name} stream timed out`
            : `${name} stream failed: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 300)}`,
        );
      }
    },
  };
}

/**
 * Mark the leading system message as a prompt-cache breakpoint for Anthropic
 * models on OpenRouter and the AI Gateway. Anthropic caches tools, then
 * system, then messages, so a breakpoint on the static system prompt caches
 * the tool schemas and the prompt (about 27K tokens) across every step of a
 * turn; the per-step brief follows it and stays uncached. The Gateway's
 * `caching: "auto"` option alone cached nothing on its chat completions
 * endpoint (bench/agent-eval measured 0 cached tokens over 4M), so the
 * breakpoint is explicit there too. Other providers cache prefixes
 * implicitly, so their messages go out unchanged.
 */
export function withPromptCache(
  provider: ApiProvider,
  model: string,
  messages: readonly ChatMessage[],
): readonly unknown[] {
  const first = messages[0];
  if (
    !model.toLowerCase().startsWith("anthropic/") ||
    first?.role !== "system" ||
    first.content.length === 0
  )
    return messages;
  return [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: first.content,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    ...messages.slice(1),
  ];
}

function* normalizeChunk(
  chunk: unknown,
  redact: (text: string) => string,
  name = "AI Gateway",
): Generator<ChatStreamEvent> {
  if (!isRecord(chunk)) return;
  if (isRecord(chunk.error)) {
    const message =
      typeof chunk.error.message === "string"
        ? chunk.error.message.slice(0, 300)
        : "unknown provider error";
    throw new GatewayError(`${name} stream error: ${redact(message)}`);
  }
  const usage = parseUsage(chunk.usage);
  if (usage) yield usage;
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  if (!isRecord(choice)) return;
  const delta = isRecord(choice.delta) ? choice.delta : undefined;
  if (delta && typeof delta.content === "string" && delta.content.length > 0)
    yield { type: "text", delta: delta.content };
  if (delta && Array.isArray(delta.tool_calls)) {
    for (const [position, call] of delta.tool_calls.entries()) {
      if (!isRecord(call)) continue;
      const event: ChatStreamEvent = {
        type: "tool-delta",
        index:
          typeof call.index === "number" && Number.isInteger(call.index)
            ? call.index
            : position,
      };
      if (typeof call.id === "string") event.id = call.id;
      const fn = isRecord(call.function) ? call.function : undefined;
      if (fn && typeof fn.name === "string" && fn.name.length > 0)
        event.name = fn.name;
      if (fn && typeof fn.arguments === "string")
        event.arguments = fn.arguments;
      yield event;
    }
  }
  if (typeof choice.finish_reason === "string")
    yield { type: "finish", reason: choice.finish_reason };
}

/** Bounded, non-negative token counts; anything else is ignored. */
function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < 1e9
    ? Math.floor(value)
    : undefined;
}

export function parseUsage(
  value: unknown,
): Extract<ChatStreamEvent, { type: "usage" }> | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = count(value.prompt_tokens);
  const outputTokens = count(value.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const event: Extract<ChatStreamEvent, { type: "usage" }> = {
    type: "usage",
    inputTokens,
    outputTokens,
  };
  const details = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : undefined;
  const cached = count(details?.cached_tokens);
  if (cached !== undefined) event.cachedInputTokens = cached;
  const rawCost =
    typeof value.cost === "string" ? Number(value.cost) : value.cost;
  if (
    typeof rawCost === "number" &&
    Number.isFinite(rawCost) &&
    rawCost >= 0 &&
    rawCost < 1000
  )
    event.costUsd = rawCost;
  return event;
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("agent request was aborted");
  error.name = "AbortError";
  return error;
}

async function boundedErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        isRecord(parsed) &&
        isRecord(parsed.error) &&
        typeof parsed.error.message === "string"
      )
        return parsed.error.message.slice(0, 300);
    } catch {
      // Plain-text error bodies are summarized below.
    }
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
