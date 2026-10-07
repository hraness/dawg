import { readSseData } from "./sse.ts";

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

const MODEL_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}$/i;
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
): string {
  if (!isGatewayModel(alias)) {
    if (MODEL_ID_PATTERN.test(alias)) return alias;
    throw new Error(
      `unknown model "${alias.slice(0, 32)}"; use ${GATEWAY_MODELS.join(" or ")} or a vendor/model ID`,
    );
  }
  const id = overrides[alias] ?? DEFAULT_MODEL_IDS[alias];
  if (!MODEL_ID_PATTERN.test(id))
    throw new Error(`model ID for ${alias} must look like provider/model`);
  return id;
}

function checkedModelId(id: string): string {
  if (!MODEL_ID_PATTERN.test(id))
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
};

/** Normalized stream events; provider chunk shapes never leave this module. */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
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
  const overrides: Partial<Record<GatewayModel, string | undefined>> = {
    "opus-5.5": process.env.DAWG_OPUS_MODEL || undefined,
    "sol-6.1": process.env.DAWG_SOL_MODEL || undefined,
    ...options.modelIds,
  };
  const redact = (text: string): string =>
    apiKey && apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;

  return {
    provider,
    modelId: (model) => resolveModelId(model, overrides),
    async *stream(request, signal) {
      const model =
        request.modelId !== undefined
          ? checkedModelId(request.modelId)
          : resolveModelId(request.model, overrides);
      if (!apiKey)
        throw new GatewayError(
          provider === "openrouter"
            ? "no OpenRouter key; run `dawg login openrouter` or set OPENROUTER_API_KEY"
            : "no AI Gateway key; run `dawg login` or set AI_GATEWAY_API_KEY",
        );
      const body: Record<string, unknown> = {
        model,
        messages: request.messages,
        stream: true,
        // The final chunk then carries token usage (and OpenRouter's cost).
        stream_options: { include_usage: true },
      };
      if (provider === "openrouter") body.usage = { include: true };
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
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "text/event-stream",
          ...(provider === "openrouter" ? OPENROUTER_HEADERS : {}),
        },
        body: JSON.stringify(body),
      };
      if (signal !== undefined) init.signal = signal;
      const response = await fetcher(`${baseUrl}/chat/completions`, init);
      if (!response.ok) {
        const detail = redact(await boundedErrorDetail(response));
        throw new GatewayError(
          `${name} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
          response.status,
        );
      }
      if (!response.body)
        throw new GatewayError(`${name} returned an empty stream`);
      const streamOptions: { maxBytes: number; signal?: AbortSignal } = {
        maxBytes: request.maxResponseBytes,
      };
      if (signal !== undefined) streamOptions.signal = signal;
      for await (const data of readSseData(response.body, streamOptions)) {
        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw new GatewayError(`${name} sent a malformed stream chunk`);
        }
        yield* normalizeChunk(chunk, redact, name);
      }
    },
  };
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
