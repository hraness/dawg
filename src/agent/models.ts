import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateJson } from "../auth/credentials.ts";
import {
  DEFAULT_MODEL_IDS,
  GATEWAY_BASE_URL,
  isGatewayModel,
  OPENROUTER_BASE_URL,
  type ApiProvider,
} from "./gateway.ts";

/**
 * The model catalog behind `/model` and `dawg model`: a curated list of
 * frontier, fast and open-weight models per key-based provider, filtered by
 * what the provider actually serves with tool calling, plus per-prompt cost
 * estimates from models.dev (or OpenRouter's own pricing on OpenRouter).
 */
export type ModelClass = "frontier" | "fast" | "open";
export const CLASS_TITLES: Readonly<Record<ModelClass, string>> = Object.freeze(
  { frontier: "frontier", fast: "fast", open: "open weights" },
);

export type CatalogEntry = Readonly<{
  /** Short name used in the UI and accepted by `/model <alias>`. */
  alias: string;
  label: string;
  class: ModelClass;
  gateway?: string;
  openrouter?: string;
}>;

/**
 * Slugs checked against the live catalogs on 2026-10-06
 * (`GET ai-gateway.vercel.sh/v1/models`, tag `tool-use`; `GET
 * openrouter.ai/api/v1/models`, `supported_parameters` has `tools`). The live
 * filter drops anything a provider stops serving.
 */
export const MODEL_CATALOG: readonly CatalogEntry[] = Object.freeze([
  {
    alias: "opus-5.5",
    label: "Claude Opus 5.5",
    class: "frontier",
    gateway: "anthropic/claude-opus-5.5",
    openrouter: "anthropic/claude-opus-5.5",
  },
  {
    alias: "fable-5.1",
    label: "Claude Fable 5.1",
    class: "frontier",
    gateway: "anthropic/claude-fable-5.1",
    openrouter: "anthropic/claude-fable-5.1",
  },
  {
    alias: "sol-6.1",
    label: "GPT-6.1 Sol",
    class: "frontier",
    gateway: "openai/gpt-6.1-sol",
    openrouter: "openai/gpt-6.1-sol",
  },
  {
    alias: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    class: "frontier",
    gateway: "google/gemini-3.1-pro-preview",
    openrouter: "google/gemini-3.1-pro-preview",
  },
  {
    alias: "sonnet-5.5",
    label: "Claude Sonnet 5.5",
    class: "fast",
    gateway: "anthropic/claude-sonnet-5.5",
    openrouter: "anthropic/claude-sonnet-5.5",
  },
  {
    alias: "haiku-4.5",
    label: "Claude Haiku 4.5",
    class: "fast",
    gateway: "anthropic/claude-haiku-4.5",
    openrouter: "anthropic/claude-haiku-4.5",
  },
  {
    alias: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    class: "fast",
    gateway: "openai/gpt-5.4-mini",
    openrouter: "openai/gpt-5.4-mini",
  },
  {
    alias: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    class: "fast",
    gateway: "google/gemini-3.8-flash",
    openrouter: "google/gemini-3.8-flash",
  },
  {
    alias: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    class: "open",
    gateway: "deepseek/deepseek-v4-pro",
    openrouter: "deepseek/deepseek-v4-pro",
  },
  {
    alias: "kimi-k3",
    label: "Kimi K3",
    class: "open",
    gateway: "moonshotai/kimi-k3",
    openrouter: "moonshotai/kimi-k3",
  },
  {
    alias: "qwen3.8-27b",
    label: "Qwen3.8 27B",
    class: "open",
    gateway: "alibaba/qwen3.8-27b",
    openrouter: "qwen/qwen3.8-27b",
  },
  {
    alias: "glm-5.3",
    label: "GLM-5.3",
    class: "open",
    gateway: "zai/glm-5.3",
    openrouter: "z-ai/glm-5.3",
  },
  {
    alias: "llama-4-maverick",
    label: "Llama 4 Maverick",
    class: "open",
    gateway: "meta/llama-4-maverick",
    openrouter: "meta-llama/llama-4-maverick",
  },
]);

const MODEL_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}$/i;

export function defaultModelId(provider: ApiProvider): string {
  return provider === "openrouter"
    ? MODEL_CATALOG[0]!.openrouter!
    : DEFAULT_MODEL_IDS["opus-5.5"];
}

/** An alias, a catalog label, or an exact `vendor/model` ID → the provider's ID. */
export function resolveModelChoice(
  provider: ApiProvider,
  input: string,
): string | undefined {
  const value = input.trim();
  const lower = value.toLowerCase();
  const entry = MODEL_CATALOG.find(
    (row) => row.alias === lower || row.label.toLowerCase() === lower,
  );
  if (entry) return entry[provider];
  if (isGatewayModel(lower)) return DEFAULT_MODEL_IDS[lower];
  return MODEL_ID_PATTERN.test(value) ? value : undefined;
}

/** `anthropic/claude-opus-5.5` → `opus-5.5`; unknown IDs show as themselves. */
export function modelAlias(
  provider: ApiProvider | undefined,
  id: string,
): string {
  const entry = MODEL_CATALOG.find(
    (row) =>
      (provider ? row[provider] === id : false) ||
      row.gateway === id ||
      row.openrouter === id,
  );
  return entry?.alias ?? id;
}

// ---------------------------------------------------------------------------
// Pricing

/** USD per token. */
export type Price = Readonly<{
  input: number;
  output: number;
  cacheRead?: number;
}>;

export type PriceTable = Readonly<{
  fetchedAt: number;
  /** models.dev provider id (`vercel`, `openrouter`, …) → model id → price. */
  providers: Readonly<Record<string, Readonly<Record<string, Price>>>>;
}>;

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const PRICE_TTL_MS = 24 * 60 * 60_000;
/** models.dev is ~5 MB today; refuse anything far larger. */
const MAX_MODELS_DEV_BYTES = 24 * 1024 * 1024;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MODELS_DEV_PROVIDERS = new Set([
  "vercel",
  "openrouter",
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "moonshotai",
  "zai",
  "alibaba",
  "llama",
]);
const PRICE_TIMEOUT_MS = 8_000;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function perToken(value: unknown, scale: number): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0
    ? number / scale
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep only prices from models.dev's `{provider: {models: {id: {cost}}}}`
 * (USD per million tokens). A 0/0 price is treated as unknown: models.dev
 * uses it for entries it has not priced.
 */
export function parseModelsDev(value: unknown, now = Date.now()): PriceTable {
  const providers: Record<string, Record<string, Price>> = {};
  if (!isRecord(value)) return { fetchedAt: now, providers };
  for (const [providerId, provider] of Object.entries(value)) {
    if (!MODELS_DEV_PROVIDERS.has(providerId) || !isRecord(provider)) continue;
    const models = isRecord(provider.models) ? provider.models : {};
    const table: Record<string, Price> = {};
    for (const [id, model] of Object.entries(models)) {
      if (!isRecord(model) || !isRecord(model.cost) || id.length > 200)
        continue;
      const input = perToken(model.cost.input, 1e6);
      const output = perToken(model.cost.output, 1e6);
      if (input === undefined || output === undefined) continue;
      if (input === 0 && output === 0 && !id.endsWith(":free")) continue;
      const cacheRead = perToken(model.cost.cache_read, 1e6);
      table[id] =
        cacheRead === undefined
          ? { input, output }
          : { input, output, cacheRead };
    }
    providers[providerId] = table;
  }
  return { fetchedAt: now, providers };
}

async function readBounded(response: Response, max: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function cacheDir(configDirectory: string): string {
  return join(configDirectory, "cache");
}

async function readCache<T>(
  path: string,
  parse: (value: unknown) => T | undefined,
): Promise<T | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CATALOG_BYTES) return undefined;
    return parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

function parsePriceCache(value: unknown): PriceTable | undefined {
  if (
    !isRecord(value) ||
    typeof value.fetchedAt !== "number" ||
    !isRecord(value.providers)
  )
    return undefined;
  return value as PriceTable;
}

export type PriceOptions = Readonly<{
  configDir: string;
  fetcher?: Fetcher;
  now?: () => number;
  url?: string;
}>;

/**
 * Prices from the ~24 h cache, refreshed from models.dev when stale. Offline
 * or on any fetch error, a stale cache wins; with no cache, an empty table.
 */
export async function loadPrices(options: PriceOptions): Promise<PriceTable> {
  const now = options.now ?? Date.now;
  const path = join(cacheDir(options.configDir), "models-dev.json");
  const cached = await readCache(path, parsePriceCache);
  if (cached && now() - cached.fetchedAt < PRICE_TTL_MS) return cached;
  try {
    const response = await (options.fetcher ?? fetch)(
      options.url ?? MODELS_DEV_URL,
      {
        signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error(`models.dev ${response.status}`);
    const table = parseModelsDev(
      JSON.parse(await readBounded(response, MAX_MODELS_DEV_BYTES)),
      now(),
    );
    await mkdir(cacheDir(options.configDir), {
      recursive: true,
      mode: 0o700,
    }).catch(() => undefined);
    await writePrivateJson(cacheDir(options.configDir), path, table).catch(
      () => undefined,
    );
    return table;
  } catch {
    return cached ?? { fetchedAt: 0, providers: {} };
  }
}

/** The models.dev entry for a provider model ID. */
export function priceFor(
  table: PriceTable,
  provider: ApiProvider,
  id: string,
): Price | undefined {
  const own =
    table.providers[provider === "gateway" ? "vercel" : "openrouter"]?.[id];
  if (own) return own;
  // Fall back to the vendor's direct listing (`anthropic/claude-x` → anthropic: `claude-x`).
  const [vendor, model] = id.split("/");
  if (!vendor || !model) return undefined;
  const direct =
    table.providers[
      vendor === "meta-llama" || vendor === "meta"
        ? "llama"
        : vendor === "z-ai"
          ? "zai"
          : vendor === "qwen"
            ? "alibaba"
            : vendor
    ];
  return direct?.[model];
}

// ---------------------------------------------------------------------------
// Live provider catalogs

export type LiveModel = Readonly<{
  id: string;
  name: string;
  tools: boolean;
  /** The provider's own price, when its catalog lists one. */
  price?: Price;
}>;

export type LiveCatalog = Readonly<{
  fetchedAt: number;
  provider: ApiProvider;
  models: readonly LiveModel[];
}>;

/** Gateway `/v1/models` (tag `tool-use`) or OpenRouter `/api/v1/models` (`tools`). */
export function parseLiveCatalog(
  provider: ApiProvider,
  value: unknown,
  now = Date.now(),
): LiveCatalog {
  const rows =
    isRecord(value) && Array.isArray(value.data)
      ? value.data.slice(0, 4000)
      : [];
  const models: LiveModel[] = [];
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      !MODEL_ID_PATTERN.test(row.id)
    )
      continue;
    const pricing = isRecord(row.pricing) ? row.pricing : {};
    const tools =
      provider === "openrouter"
        ? Array.isArray(row.supported_parameters) &&
          row.supported_parameters.includes("tools")
        : Array.isArray(row.tags) &&
          row.tags.includes("tool-use") &&
          (row.type ?? "language") === "language";
    const input = perToken(
      provider === "openrouter" ? pricing.prompt : pricing.input,
      1,
    );
    const output = perToken(
      provider === "openrouter" ? pricing.completion : pricing.output,
      1,
    );
    models.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name.slice(0, 80) : row.id,
      tools,
      ...(input !== undefined && output !== undefined
        ? { price: { input, output } }
        : {}),
    });
  }
  return { fetchedAt: now, provider, models };
}

function parseCatalogCache(value: unknown): LiveCatalog | undefined {
  if (
    !isRecord(value) ||
    typeof value.fetchedAt !== "number" ||
    !Array.isArray(value.models)
  )
    return undefined;
  return value as LiveCatalog;
}

export async function loadLiveCatalog(
  provider: ApiProvider,
  options: PriceOptions & { apiKey?: string; baseUrl?: string },
): Promise<LiveCatalog | undefined> {
  const now = options.now ?? Date.now;
  const path = join(cacheDir(options.configDir), `models-${provider}.json`);
  const cached = await readCache(path, parseCatalogCache);
  if (cached && now() - cached.fetchedAt < PRICE_TTL_MS) return cached;
  const base = (
    options.baseUrl ??
    (provider === "openrouter" ? OPENROUTER_BASE_URL : GATEWAY_BASE_URL)
  ).replace(/\/$/, "");
  try {
    const response = await (options.fetcher ?? fetch)(`${base}/models`, {
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
      headers: options.apiKey
        ? { authorization: `Bearer ${options.apiKey}` }
        : {},
    });
    if (!response.ok) throw new Error(`models ${response.status}`);
    const catalog = parseLiveCatalog(
      provider,
      JSON.parse(await readBounded(response, MAX_CATALOG_BYTES)),
      now(),
    );
    if (catalog.models.length === 0) throw new Error("empty catalog");
    // Cache only what the picker needs: tool-capable rows.
    const slim: LiveCatalog = {
      ...catalog,
      models: catalog.models.filter((model) => model.tools),
    };
    await writePrivateJson(cacheDir(options.configDir), path, slim).catch(
      () => undefined,
    );
    return slim;
  } catch {
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Cost per prompt

/**
 * A typical agent prompt, measured from the real loop (`AGENT_SYSTEM_PROMPT`
 * and `chatTools()` serialized, plus `compositionBrief` of a 3-track, 48-note
 * loop; see models.test.ts, which keeps these in step with the code):
 *
 * - system prompt ≈ 11 KB, tool schemas ≈ 70 KB, brief ≈ 1.6 KB typical
 *   (capped at 12 KiB), user request ≈ 0.1 KB → ≈ 83 KB ≈ 20,600 tokens
 *   per request at ~4 bytes per token;
 * - about 2 requests per prompt (tool calls, then a short reply), the second
 *   also carrying the first step's tool calls and results (≈ 0.6 KB);
 * - output ≈ 450 tokens of tool-call arguments and ≈ 150 of reply.
 *
 * So ≈ 41,400 input and ≈ 600 output tokens per prompt.
 */
export const TYPICAL_PROMPT = Object.freeze({
  inputTokens: 41_400,
  outputTokens: 600,
});

export function estimatePromptCost(
  price: Price,
  typical: { inputTokens: number; outputTokens: number } = TYPICAL_PROMPT,
): number {
  return (
    typical.inputTokens * price.input + typical.outputTokens * price.output
  );
}

/** One response's cost from its token counts; cached input at the cache rate. */
export function estimateRequestCost(
  price: Price,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  },
): number {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const cacheRate = price.cacheRead ?? price.input;
  return (
    (usage.inputTokens - cached) * price.input +
    cached * cacheRate +
    usage.outputTokens * price.output
  );
}

/** `~$0.034/prompt`, `~$0.0004/prompt`, `free`. */
export function formatPromptCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd === 0) return "free";
  return `~${formatUsd(usd)}/prompt`;
}

/** Two significant digits under a cent, cents above. */
export function formatUsd(usd: number): string {
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  if (usd >= 0.995) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd <= 0) return "$0";
  const digits = Math.min(6, Math.max(3, 1 - Math.floor(Math.log10(usd))));
  return `$${usd.toFixed(digits)}`;
}

// ---------------------------------------------------------------------------
// Picker rows

export type ModelRow = Readonly<{
  id: string;
  alias: string;
  label: string;
  class: ModelClass;
  /** Estimated USD per prompt, undefined when the price is unknown. */
  costUsd?: number;
  current: boolean;
}>;

/**
 * The picker list for a key-based provider: curated entries the live
 * catalog serves with tools (all curated entries when the catalog is
 * unavailable), grouped frontier → fast → open, plus the current model if
 * it is outside the list.
 */
export function modelRows(
  provider: ApiProvider,
  options: {
    current?: string;
    catalog?: LiveCatalog;
    prices?: PriceTable;
  },
): ModelRow[] {
  const live = new Map(
    options.catalog?.models.map((model) => [model.id, model]),
  );
  const price = (id: string): number | undefined => {
    // OpenRouter's own catalog price is authoritative there.
    const own = provider === "openrouter" ? live.get(id)?.price : undefined;
    const found =
      own ??
      (options.prices ? priceFor(options.prices, provider, id) : undefined) ??
      live.get(id)?.price;
    return found ? estimatePromptCost(found) : undefined;
  };
  const rows: ModelRow[] = [];
  for (const entry of MODEL_CATALOG) {
    const id = entry[provider];
    if (!id) continue;
    if (options.catalog && !live.get(id)?.tools) continue;
    const cost = price(id);
    rows.push({
      id,
      alias: entry.alias,
      label: entry.label,
      class: entry.class,
      ...(cost !== undefined ? { costUsd: cost } : {}),
      current: id === options.current,
    });
  }
  const order: ModelClass[] = ["frontier", "fast", "open"];
  rows.sort((a, b) => order.indexOf(a.class) - order.indexOf(b.class));
  if (options.current && !rows.some((row) => row.current)) {
    const cost = price(options.current);
    rows.unshift({
      id: options.current,
      alias: modelAlias(provider, options.current),
      label: live.get(options.current)?.name ?? options.current,
      class: "frontier",
      ...(cost !== undefined ? { costUsd: cost } : {}),
      current: true,
    });
  }
  return rows;
}

/**
 * The price used to cost a response when the provider sent no cost: on
 * OpenRouter its own catalog price (authoritative there), else models.dev.
 * Both come from the ~24 h caches, so this rarely touches the network.
 */
export async function priceForModel(
  provider: ApiProvider,
  id: string,
  options: PriceOptions & { apiKey?: string; baseUrl?: string },
): Promise<Price | undefined> {
  if (provider === "openrouter") {
    const live = await loadLiveCatalog(provider, options);
    const own = live?.models.find((model) => model.id === id)?.price;
    if (own) return own;
  }
  return priceFor(await loadPrices(options), provider, id);
}
