/**
 * Web search for the agent. Provider chain, first match wins:
 *
 * 1. `BRAVE_SEARCH_API_KEY` set → Brave Web Search API (explicit override).
 * 2. An AI Gateway key → one non-streaming Chat Completions call on a small
 *    model with a gateway server-side search tool (`vercel:exa_search` by
 *    default; `DAWG_WEB_SEARCH=exa|perplexity|parallel|browserbase`). The
 *    gateway runs the search and bills it; the model relays the results as a
 *    JSON array that is parsed from `unknown`.
 * 3. An OpenRouter key → the same one-shot with OpenRouter's `web` plugin;
 *    `annotations[].url_citation` entries become results.
 * 4. DuckDuckGo's HTML endpoint parsed with a bounded regex extractor.
 *
 * A gateway or OpenRouter failure falls through to DuckDuckGo and says so.
 * Every request is capped in time and bytes; results are plain
 * `{title, url, snippet}` records and keys are never echoed.
 */
import {
  decodeEntities,
  describeFetchError,
  readBounded,
  stripTags,
  timeoutSignal,
  WebError,
  type FetchLike,
} from "./http.ts";

export const SEARCH_LIMITS = Object.freeze({
  maxQueryChars: 400,
  defaultCount: 8,
  maxCount: 10,
  timeoutMs: 10_000,
  /** Model-backed providers get a little longer: the search runs server-side first. */
  modelTimeoutMs: 20_000,
  maxResponseBytes: 64 * 1024,
  maxTitleChars: 160,
  maxSnippetChars: 300,
  maxUrlChars: 500,
  relayMaxTokens: 800,
});

export const BRAVE_SEARCH_URL =
  "https://api.search.brave.com/res/v1/web/search";
export const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Cheap relay model; the same ID exists on the gateway and on OpenRouter. */
export const SEARCH_RELAY_MODEL = "anthropic/claude-haiku-4.5";

export const GATEWAY_SEARCH_TOOLS = Object.freeze([
  "exa",
  "perplexity",
  "parallel",
  "browserbase",
] as const);
export type GatewaySearchTool = (typeof GATEWAY_SEARCH_TOOLS)[number];

/** Estimated USD per search request (vercel.com/docs/ai-gateway/models-and-providers/web-search, 2026-10-06). */
export const SEARCH_TOOL_USD: Readonly<Record<GatewaySearchTool, number>> =
  Object.freeze({
    exa: 0.007,
    perplexity: 0.005,
    parallel: 0.005,
    browserbase: 0.007,
  });
/** OpenRouter's web plugin bills per result ($4 per 1,000 results). */
export const OPENROUTER_RESULT_USD = 0.004;

export type SearchResult = Readonly<{
  title: string;
  url: string;
  snippet: string;
}>;

export type SearchProvider = "brave" | "gateway" | "openrouter" | "duckduckgo";

export type SearchSpend = Readonly<{
  provider: "gateway" | "openrouter";
  tool: string;
  /** Estimated USD for the search call (tool price plus any reported model cost). */
  usd: number;
}>;

export type SearchOptions = Readonly<{
  count?: number;
  /** Brave Web Search API key; when set it overrides the whole chain. */
  braveApiKey?: string;
  /** AI Gateway key; enables the gateway search tools. */
  gatewayApiKey?: string;
  gatewayBaseUrl?: string;
  /** `DAWG_WEB_SEARCH`; defaults to `exa`. */
  searchTool?: string;
  /** OpenRouter key; enables the `web` plugin. */
  openRouterApiKey?: string;
  openRouterBaseUrl?: string;
  relayModel?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called once per billed search so the host can record it in its spend ledger. */
  onSpend?: (spend: SearchSpend) => void;
}>;

export type SearchOutcome = Readonly<{
  provider: SearchProvider;
  /** The gateway tool (`exa`) or OpenRouter plugin (`web`) that answered. */
  tool?: string;
  results: readonly SearchResult[];
  /** Set when a paid provider failed and DuckDuckGo answered instead. */
  fallbackFrom?: string;
}>;

export function parseSearchTool(value: unknown): GatewaySearchTool {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (GATEWAY_SEARCH_TOOLS as readonly string[]).includes(name)
    ? (name as GatewaySearchTool)
    : "exa";
}

/** Which provider a search would try first for the given credentials. */
export function searchProvider(
  options: Pick<
    SearchOptions,
    "braveApiKey" | "gatewayApiKey" | "openRouterApiKey"
  >,
): SearchProvider {
  if (present(options.braveApiKey)) return "brave";
  if (present(options.gatewayApiKey)) return "gateway";
  if (present(options.openRouterApiKey)) return "openrouter";
  return "duckduckgo";
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function webSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const trimmed = query.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) throw new WebError("query is empty");
  if (trimmed.length > SEARCH_LIMITS.maxQueryChars)
    throw new WebError(
      `query is longer than ${SEARCH_LIMITS.maxQueryChars} characters`,
    );
  const count = Math.max(
    1,
    Math.min(
      SEARCH_LIMITS.maxCount,
      options.count ?? SEARCH_LIMITS.defaultCount,
    ),
  );
  const provider = searchProvider(options);
  if (provider === "brave") return braveSearch(trimmed, count, options);
  if (provider === "gateway" || provider === "openrouter") {
    try {
      return provider === "gateway"
        ? await gatewaySearch(trimmed, count, options)
        : await openRouterSearch(trimmed, count, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = error instanceof WebError ? error.message : "failed";
      const fallback = await duckDuckGoSearch(trimmed, count, options);
      return { ...fallback, fallbackFrom: reason };
    }
  }
  return duckDuckGoSearch(trimmed, count, options);
}

type BoundedRequest = Readonly<{
  provider: SearchProvider;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}>;

/** One bounded request: timeout, status check, 64 KiB body. */
async function boundedRequest(
  request: BoundedRequest,
  options: SearchOptions,
): Promise<string> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timer = timeoutSignal(request.timeoutMs, options.signal);
  try {
    let response: Response;
    try {
      response = await fetcher(request.url, {
        ...request.init,
        signal: timer.signal,
      });
    } catch (error) {
      throw new WebError(
        `${request.provider} search failed: ${timer.timedOut() ? `timed out after ${request.timeoutMs / 1000}s` : describeFetchError(error)}`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebError(
        response.status === 401 || response.status === 403
          ? `${request.provider} search rejected the API key (HTTP ${response.status})`
          : response.status === 402
            ? `${request.provider} search needs credits (HTTP 402)`
            : `${request.provider} search returned HTTP ${response.status}`,
      );
    }
    const { bytes } = await readBounded(
      response,
      SEARCH_LIMITS.maxResponseBytes,
      timer.signal,
    );
    return new TextDecoder("utf-8").decode(bytes);
  } finally {
    timer.dispose();
  }
}

function parseJson(text: string, provider: SearchProvider): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new WebError(`${provider} search returned invalid JSON`);
  }
}

async function braveSearch(
  query: string,
  count: number,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const text = await boundedRequest(
    {
      provider: "brave",
      url: `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${count}`,
      init: {
        method: "GET",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip",
          "x-subscription-token": options.braveApiKey!.trim(),
        },
        redirect: "follow",
      },
      timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.timeoutMs,
    },
    options,
  );
  return {
    provider: "brave",
    results: parseBraveResults(parseJson(text, "brave"), count),
  };
}

async function duckDuckGoSearch(
  query: string,
  count: number,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const text = await boundedRequest(
    {
      provider: "duckduckgo",
      url: `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(query)}`,
      init: {
        method: "GET",
        headers: {
          accept: "text/html",
          "user-agent": "Mozilla/5.0 (compatible; dawg-agent)",
        },
        redirect: "follow",
      },
      timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.timeoutMs,
    },
    options,
  );
  return { provider: "duckduckgo", results: parseDuckDuckGoHtml(text, count) };
}

const RELAY_SYSTEM_PROMPT =
  'You are a search relay. Using only the web search results provided to you, reply with exactly one JSON array and nothing else (no prose, no code fence) of at most {count} objects shaped {"title":string,"url":string,"snippet":string}, where snippet is one sentence taken from that result. Reply [] if there are no results.';

/** The Chat Completions body for a gateway server-side search tool. */
export function gatewaySearchBody(
  query: string,
  count: number,
  tool: GatewaySearchTool,
  model: string,
): Record<string, unknown> {
  const config: Record<string, unknown> =
    tool === "parallel"
      ? { objective: query, max_results: count }
      : tool === "perplexity"
        ? { query, max_results: count }
        : tool === "browserbase"
          ? { query: query.slice(0, 200), num_results: count }
          : { query, num_results: count, type: "instant" };
  return {
    model,
    messages: relayMessages(query, count),
    tools: [{ type: `vercel:${tool}_search`, config }],
    tool_choice: "required",
    max_tokens: SEARCH_LIMITS.relayMaxTokens,
    stream: false,
  };
}

/** The Chat Completions body for OpenRouter's `web` plugin. */
export function openRouterSearchBody(
  query: string,
  count: number,
  model: string,
): Record<string, unknown> {
  return {
    model,
    messages: relayMessages(query, count),
    plugins: [{ id: "web", max_results: count }],
    max_tokens: SEARCH_LIMITS.relayMaxTokens,
    stream: false,
  };
}

function relayMessages(query: string, count: number) {
  return [
    {
      role: "system",
      content: RELAY_SYSTEM_PROMPT.replace("{count}", String(count)),
    },
    { role: "user", content: `Search: ${query}` },
  ];
}

async function gatewaySearch(
  query: string,
  count: number,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const tool = parseSearchTool(options.searchTool);
  const model = options.relayModel ?? SEARCH_RELAY_MODEL;
  const base = (options.gatewayBaseUrl ?? GATEWAY_BASE_URL).replace(/\/$/, "");
  const text = await boundedRequest(
    {
      provider: "gateway",
      url: `${base}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.gatewayApiKey!.trim()}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(gatewaySearchBody(query, count, tool, model)),
      },
      timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.modelTimeoutMs,
    },
    options,
  );
  const json = parseJson(text, "gateway");
  const results = parseCompletionResults(json, count);
  options.onSpend?.({
    provider: "gateway",
    tool,
    usd: round(SEARCH_TOOL_USD[tool] + reportedCost(json)),
  });
  return { provider: "gateway", tool, results };
}

async function openRouterSearch(
  query: string,
  count: number,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const model = options.relayModel ?? SEARCH_RELAY_MODEL;
  const base = (options.openRouterBaseUrl ?? OPENROUTER_BASE_URL).replace(
    /\/$/,
    "",
  );
  const text = await boundedRequest(
    {
      provider: "openrouter",
      url: `${base}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.openRouterApiKey!.trim()}`,
          "content-type": "application/json",
          accept: "application/json",
          "http-referer": "https://dawg.sh",
          "x-title": "dawg",
        },
        body: JSON.stringify(openRouterSearchBody(query, count, model)),
      },
      timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.modelTimeoutMs,
    },
    options,
  );
  const json = parseJson(text, "openrouter");
  const results = parseCompletionResults(json, count);
  options.onSpend?.({
    provider: "openrouter",
    tool: "web",
    usd: round(
      OPENROUTER_RESULT_USD * Math.max(results.length, 1) + reportedCost(json),
    ),
  });
  return { provider: "openrouter", tool: "web", results };
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/** `usage.cost` (OpenRouter) or `usage.cost_usd`/`usage.cost` (gateway) when reported. */
function reportedCost(json: unknown): number {
  const usage = record(record(json)?.usage);
  const cost = usage?.cost ?? usage?.cost_usd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? Math.min(cost, 1)
    : 0;
}

/**
 * Results from a relay completion: `url_citation` annotations first (they
 * carry the provider's own titles and excerpts), then the JSON array in the
 * message text, de-duplicated by URL.
 */
export function parseCompletionResults(
  json: unknown,
  count: number,
): SearchResult[] {
  const message = record(
    (Array.isArray(record(json)?.choices) &&
      record((record(json)!.choices as unknown[])[0])?.message) ||
      undefined,
  );
  if (!message) throw new WebError("search relay returned no message");
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const push = (title: unknown, url: unknown, snippet: unknown) => {
    if (results.length >= count) return;
    const result = makeResult(title, url, snippet);
    if (!result || seen.has(result.url)) return;
    seen.add(result.url);
    results.push(result);
  };
  const annotations = Array.isArray(message.annotations)
    ? message.annotations.slice(0, 64)
    : [];
  for (const entry of annotations) {
    const citation = record(record(entry)?.url_citation);
    if (citation) push(citation.title, citation.url, citation.content);
  }
  const content = messageText(message.content);
  for (const item of jsonArrayIn(content).slice(0, 64)) {
    const value = record(item);
    if (value) push(value.title, value.url, value.snippet ?? value.description);
  }
  return results;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => {
        const text = record(part)?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  return "";
}

/** The first JSON array in `text` (direct, fenced, or embedded), else `[]`. */
export function jsonArrayIn(text: string): unknown[] {
  const source = text.slice(0, SEARCH_LIMITS.maxResponseBytes);
  const start = source.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(source.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/** Parse Brave's `web.results[]` from an untrusted JSON value. */
export function parseBraveResults(
  json: unknown,
  count: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const items = record(record(json)?.web)?.results;
  if (!Array.isArray(items)) return results;
  for (const item of items) {
    if (results.length >= count) break;
    const value = record(item);
    const result = makeResult(value?.title, value?.url, value?.description);
    if (result) results.push(result);
  }
  return results;
}

const DDG_RESULT =
  /<a[^>]{0,300}class="[^"]*result__a[^"]*"[^>]{0,300}href="([^"]{1,1500})"[^>]{0,300}>([\s\S]{0,1000}?)<\/a>/g;
const DDG_SNIPPET =
  /class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]{0,300}>([\s\S]{0,2000}?)<\/(?:a|td|div|span)>/g;

/** Parse DuckDuckGo's HTML result page with bounded regexes. */
export function parseDuckDuckGoHtml(
  html: string,
  count: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const source = html.slice(0, SEARCH_LIMITS.maxResponseBytes);
  const anchors: { title: string; url: string; end: number }[] = [];
  DDG_RESULT.lastIndex = 0;
  for (
    let match = DDG_RESULT.exec(source);
    match && anchors.length < count;
    match = DDG_RESULT.exec(source)
  ) {
    anchors.push({
      url: decodeEntities(match[1]!),
      title: stripTags(match[2]!),
      end: DDG_RESULT.lastIndex,
    });
  }
  for (const [index, anchor] of anchors.entries()) {
    const limit = anchors[index + 1]?.end ?? source.length;
    DDG_SNIPPET.lastIndex = anchor.end;
    const snippet = DDG_SNIPPET.exec(source);
    const text = snippet && snippet.index < limit ? stripTags(snippet[1]!) : "";
    const result = makeResult(anchor.title, anchor.url, text);
    if (result) results.push(result);
  }
  return results;
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|mc_eid$|igshid$)/i;

/**
 * Unwrap DuckDuckGo's `/l/?uddg=` redirect and drop common tracking
 * parameters. Anything that is not an http(s) URL yields `undefined`.
 */
export function cleanResultUrl(raw: string): string | undefined {
  let text = raw.trim();
  if (text.startsWith("//")) text = `https:${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (
    url.hostname.endsWith("duckduckgo.com") &&
    url.pathname.startsWith("/l/")
  ) {
    const target = url.searchParams.get("uddg");
    if (!target) return undefined;
    return cleanResultUrl(target);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  for (const key of [...url.searchParams.keys()])
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.hash = "";
  const cleaned = url.toString();
  return cleaned.length > SEARCH_LIMITS.maxUrlChars ? undefined : cleaned;
}

function makeResult(
  title: unknown,
  url: unknown,
  snippet: unknown,
): SearchResult | undefined {
  if (typeof url !== "string") return undefined;
  const cleaned = cleanResultUrl(url);
  if (!cleaned) return undefined;
  const titleText =
    typeof title === "string"
      ? stripTags(title).slice(0, SEARCH_LIMITS.maxTitleChars)
      : "";
  const snippetText =
    typeof snippet === "string"
      ? stripTags(snippet).slice(0, SEARCH_LIMITS.maxSnippetChars)
      : "";
  return { title: titleText || cleaned, url: cleaned, snippet: snippetText };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `gateway · exa`, `openrouter · web`, `duckduckgo`. */
export function describeSearchProvider(outcome: SearchOutcome): string {
  return outcome.tool
    ? `${outcome.provider} · ${outcome.tool}`
    : outcome.provider;
}

/** Render results as the compact text the model reads. */
export function formatSearchResults(
  outcome: SearchOutcome,
  query: string,
): string {
  const via = describeSearchProvider(outcome);
  const fallback = outcome.fallbackFrom
    ? `\n(${outcome.fallbackFrom}; answered by DuckDuckGo instead)`
    : "";
  if (outcome.results.length === 0)
    return `no results for "${query.slice(0, 80)}" (${via})${fallback}`;
  const lines = outcome.results.map(
    (result, index) =>
      `${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`,
  );
  return `${outcome.results.length} result${outcome.results.length === 1 ? "" : "s"} via ${via}${fallback}\n${lines.join("\n")}`;
}
