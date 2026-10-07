import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { WebError, type FetchLike } from "./http.ts";
import {
  BRAVE_SEARCH_URL,
  cleanResultUrl,
  describeSearchProvider,
  DUCKDUCKGO_HTML_URL,
  formatSearchResults,
  GATEWAY_BASE_URL,
  gatewaySearchBody,
  jsonArrayIn,
  OPENROUTER_BASE_URL,
  openRouterSearchBody,
  parseBraveResults,
  parseCompletionResults,
  parseDuckDuckGoHtml,
  parseSearchTool,
  SEARCH_LIMITS,
  SEARCH_RELAY_MODEL,
  searchProvider,
  webSearch,
  type SearchSpend,
} from "./search.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

type Call = { url: string; init: RequestInit };

/** A fetch that answers by URL prefix and records every call. */
function scripted(
  routes: Record<string, () => Response>,
): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init: init ?? {} });
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new TypeError(`unexpected fetch ${url}`);
    return routes[key]!();
  }) as FetchLike & { calls: Call[] };
  fetcher.calls = calls;
  return fetcher;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

describe("provider chain", () => {
  test("brave overrides, then gateway, then openrouter, then duckduckgo", () => {
    expect(
      searchProvider({
        braveApiKey: "b",
        gatewayApiKey: "g",
        openRouterApiKey: "o",
      }),
    ).toBe("brave");
    expect(searchProvider({ gatewayApiKey: "g", openRouterApiKey: "o" })).toBe(
      "gateway",
    );
    expect(searchProvider({ openRouterApiKey: "o" })).toBe("openrouter");
    expect(searchProvider({ braveApiKey: "  ", gatewayApiKey: "" })).toBe(
      "duckduckgo",
    );
    expect(searchProvider({})).toBe("duckduckgo");
  });

  test("parses DAWG_WEB_SEARCH and defaults to exa", () => {
    expect(parseSearchTool(undefined)).toBe("exa");
    expect(parseSearchTool(" Perplexity ")).toBe("perplexity");
    expect(parseSearchTool("parallel")).toBe("parallel");
    expect(parseSearchTool("browserbase")).toBe("browserbase");
    expect(parseSearchTool("google")).toBe("exa");
    expect(parseSearchTool(42)).toBe("exa");
  });

  test("rejects empty and oversized queries before any request", async () => {
    const fetcher = scripted({});
    await expect(webSearch("   ", { fetch: fetcher })).rejects.toThrow(
      /query is empty/,
    );
    await expect(
      webSearch("x".repeat(401), { fetch: fetcher }),
    ).rejects.toThrow(/longer than 400/);
    expect(fetcher.calls).toHaveLength(0);
  });
});

describe("gateway search", () => {
  test("builds the documented server-tool body per tool", () => {
    const exa = gatewaySearchBody("comb filter", 8, "exa", SEARCH_RELAY_MODEL);
    expect(exa.model).toBe("anthropic/claude-haiku-4.5");
    expect(exa.tools).toEqual([
      {
        type: "vercel:exa_search",
        config: { query: "comb filter", num_results: 8, type: "instant" },
      },
    ]);
    expect(exa.tool_choice).toBe("required");
    expect(exa.max_tokens).toBe(SEARCH_LIMITS.relayMaxTokens);
    expect(exa.stream).toBe(false);
    const messages = exa.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("at most 8 objects");
    expect(messages[1]).toEqual({
      role: "user",
      content: "Search: comb filter",
    });
    expect(gatewaySearchBody("q", 5, "perplexity", "m").tools).toEqual([
      {
        type: "vercel:perplexity_search",
        config: { query: "q", max_results: 5 },
      },
    ]);
    expect(gatewaySearchBody("q", 5, "parallel", "m").tools).toEqual([
      {
        type: "vercel:parallel_search",
        config: { objective: "q", max_results: 5 },
      },
    ]);
    const long = "w".repeat(300);
    expect(gatewaySearchBody(long, 5, "browserbase", "m").tools).toEqual([
      {
        type: "vercel:browserbase_search",
        config: { query: "w".repeat(200), num_results: 5 },
      },
    ]);
  });

  test("relays through the gateway, parses the JSON array, and reports spend", async () => {
    const body = JSON.parse(
      await fixture("gateway-exa-search.json"),
    ) as unknown;
    const fetcher = scripted({ [GATEWAY_BASE_URL]: () => json(body) });
    const spends: SearchSpend[] = [];
    const outcome = await webSearch("freeverb comb filters", {
      fetch: fetcher,
      gatewayApiKey: "gw-secret",
      onSpend: (spend) => spends.push(spend),
    });
    expect(outcome.provider).toBe("gateway");
    expect(outcome.tool).toBe("exa");
    expect(outcome.fallbackFrom).toBeUndefined();
    expect(outcome.results).toEqual([
      {
        title: "Freeverb – Physical Audio Signal Processing",
        url: "https://ccrma.stanford.edu/~jos/pasp/Freeverb.html",
        snippet:
          "Freeverb uses eight parallel Schroeder-Moorer comb filters followed by four series allpass filters.",
      },
      {
        title: "Freeverb3 Signal Processing Library",
        url: "https://freeverb3.sourceforge.net/",
        snippet:
          "A library implementing Freeverb and related reverb algorithms.",
      },
    ]);
    expect(spends).toEqual([{ provider: "gateway", tool: "exa", usd: 0.0091 }]);
    expect(fetcher.calls).toHaveLength(1);
    const call = fetcher.calls[0]!;
    expect(call.url).toBe(`${GATEWAY_BASE_URL}/chat/completions`);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).authorization).toBe(
      "Bearer gw-secret",
    );
    expect(sentBody(call).tools).toEqual([
      {
        type: "vercel:exa_search",
        config: {
          query: "freeverb comb filters",
          num_results: 8,
          type: "instant",
        },
      },
    ]);
    expect(describeSearchProvider(outcome)).toBe("gateway · exa");
    expect(formatSearchResults(outcome, "freeverb comb filters")).toMatch(
      /^2 results via gateway · exa\n1\. Freeverb – Physical Audio Signal Processing\n {3}https:\/\/ccrma/,
    );
  });

  test("honours DAWG_WEB_SEARCH via searchTool and a custom base URL", async () => {
    const fetcher = scripted({
      "https://gw.test/v1/chat/completions": () =>
        json({ choices: [{ message: { role: "assistant", content: "[]" } }] }),
    });
    const outcome = await webSearch("q", {
      fetch: fetcher,
      gatewayApiKey: "k",
      gatewayBaseUrl: "https://gw.test/v1/",
      searchTool: "perplexity",
      count: 3,
    });
    expect(outcome).toEqual({
      provider: "gateway",
      tool: "perplexity",
      results: [],
    });
    expect(sentBody(fetcher.calls[0]!).tools).toEqual([
      {
        type: "vercel:perplexity_search",
        config: { query: "q", max_results: 3 },
      },
    ]);
    expect(formatSearchResults(outcome, "q")).toBe(
      'no results for "q" (gateway · perplexity)',
    );
  });

  test("falls back to DuckDuckGo when the gateway fails and says so", async () => {
    const ddg = await fixture("duckduckgo.html");
    for (const [response, reason] of [
      [
        () => json({ error: "nope" }, 401),
        "gateway search rejected the API key (HTTP 401)",
      ],
      [
        () => json({ error: "nope" }, 402),
        "gateway search needs credits (HTTP 402)",
      ],
      [() => json({ error: "nope" }, 500), "gateway search returned HTTP 500"],
      [
        () => new Response("<html>", { status: 200 }),
        "gateway search returned invalid JSON",
      ],
      [() => json({ choices: [] }), "search relay returned no message"],
      [
        () => {
          throw new TypeError("fetch failed");
        },
        "gateway search failed: fetch failed",
      ],
    ] as const) {
      const fetcher = scripted({
        [GATEWAY_BASE_URL]: response,
        [DUCKDUCKGO_HTML_URL]: () => html(ddg),
      });
      const spends: SearchSpend[] = [];
      const outcome = await webSearch("comb filter reverb", {
        fetch: fetcher,
        gatewayApiKey: "k",
        onSpend: (spend) => spends.push(spend),
      });
      expect(outcome.provider).toBe("duckduckgo");
      expect(outcome.tool).toBeUndefined();
      expect(outcome.fallbackFrom).toBe(reason);
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(spends).toEqual([]);
      expect(fetcher.calls.map((call) => call.url.split("?")[0])).toEqual([
        `${GATEWAY_BASE_URL}/chat/completions`,
        DUCKDUCKGO_HTML_URL,
      ]);
      expect(formatSearchResults(outcome, "comb filter reverb")).toContain(
        `via duckduckgo\n(${reason}; answered by DuckDuckGo instead)`,
      );
    }
  });

  test("does not fall back when the caller aborted", async () => {
    const controller = new AbortController();
    const fetcher = scripted({
      [GATEWAY_BASE_URL]: () => {
        controller.abort(new Error("user cancelled"));
        throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(
      webSearch("q", {
        fetch: fetcher,
        gatewayApiKey: "k",
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(WebError);
    expect(fetcher.calls).toHaveLength(1);
  });

  test("times out a stalled relay and falls back", async () => {
    const ddg = await fixture("duckduckgo.html");
    const stalled: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const fetcher = scripted({ [DUCKDUCKGO_HTML_URL]: () => html(ddg) });
    const chained: FetchLike = (input, init) =>
      String(input).startsWith(GATEWAY_BASE_URL)
        ? stalled(input, init)
        : fetcher(input, init);
    const outcome = await webSearch("q", {
      fetch: chained,
      gatewayApiKey: "k",
      timeoutMs: 20,
    });
    expect(outcome.provider).toBe("duckduckgo");
    expect(outcome.fallbackFrom).toBe(
      "gateway search failed: timed out after 0.02s",
    );
  });
});

describe("openrouter search", () => {
  test("uses the web plugin and parses url_citation annotations", async () => {
    const body = JSON.parse(
      await fixture("openrouter-web-search.json"),
    ) as unknown;
    const fetcher = scripted({ [OPENROUTER_BASE_URL]: () => json(body) });
    const spends: SearchSpend[] = [];
    const outcome = await webSearch("comb filter", {
      fetch: fetcher,
      openRouterApiKey: "or-secret",
      onSpend: (spend) => spends.push(spend),
    });
    expect(outcome.provider).toBe("openrouter");
    expect(outcome.tool).toBe("web");
    expect(outcome.results).toEqual([
      {
        title: "Comb filter - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Comb_filter",
        snippet:
          "A comb filter adds a delayed version of a signal to itself, causing constructive and destructive interference.",
      },
      {
        title: "Feedback Comb Filters",
        url: "https://ccrma.stanford.edu/~jos/pasp/Feedback_Comb_Filters.html",
        snippet:
          "The feedback comb filter has a transfer function with poles spaced uniformly around the unit circle.",
      },
    ]);
    expect(spends).toEqual([
      { provider: "openrouter", tool: "web", usd: 0.0092 },
    ]);
    const call = fetcher.calls[0]!;
    expect(call.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect((call.init.headers as Record<string, string>).authorization).toBe(
      "Bearer or-secret",
    );
    expect(sentBody(call).plugins).toEqual([{ id: "web", max_results: 8 }]);
    expect(describeSearchProvider(outcome)).toBe("openrouter · web");
  });

  test("body shape", () => {
    expect(openRouterSearchBody("q", 4, "m")).toMatchObject({
      model: "m",
      plugins: [{ id: "web", max_results: 4 }],
      max_tokens: 800,
      stream: false,
    });
  });
});

describe("brave override", () => {
  test("calls Brave with the subscription token and parses web.results", async () => {
    const fetcher = scripted({
      [BRAVE_SEARCH_URL]: () =>
        json({
          web: {
            results: [
              {
                title: "A",
                url: "https://a.example/?gclid=1",
                description: "first <b>hit</b>",
              },
              { title: "B", url: "not a url", description: "dropped" },
              { url: "https://c.example/" },
            ],
          },
        }),
    });
    const outcome = await webSearch("q", {
      fetch: fetcher,
      braveApiKey: "brave-key",
      gatewayApiKey: "g",
    });
    expect(outcome).toEqual({
      provider: "brave",
      results: [
        { title: "A", url: "https://a.example/", snippet: "first hit" },
        { title: "https://c.example/", url: "https://c.example/", snippet: "" },
      ],
    });
    const call = fetcher.calls[0]!;
    expect(call.url).toBe(`${BRAVE_SEARCH_URL}?q=q&count=8`);
    expect(
      (call.init.headers as Record<string, string>)["x-subscription-token"],
    ).toBe("brave-key");
    expect(parseBraveResults({ web: { results: "nope" } }, 5)).toEqual([]);
    expect(parseBraveResults(null, 5)).toEqual([]);
  });
});

describe("duckduckgo parser", () => {
  test("extracts titles, unwrapped URLs and snippets from the fixture", async () => {
    const results = parseDuckDuckGoHtml(await fixture("duckduckgo.html"), 8);
    expect(results).toEqual([
      {
        title: "Freeverb – Physical Audio Signal Processing",
        url: "https://ccrma.stanford.edu/~jos/pasp/Freeverb.html",
        snippet:
          "Freeverb is a public-domain reverb made of eight parallel comb filters feeding four series allpass filters.",
      },
      {
        title: "Comb filter & allpass primer",
        url: "https://example.com/dsp/comb?page=2",
        snippet: "A short primer on feedback comb filters.",
      },
      {
        title: "Comb filter - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Comb_filter",
        snippet: "",
      },
    ]);
    expect(
      parseDuckDuckGoHtml(await fixture("duckduckgo.html"), 1),
    ).toHaveLength(1);
    expect(parseDuckDuckGoHtml("<html><body>nothing</body></html>", 8)).toEqual(
      [],
    );
  });

  test("ignores anything past the 64 KiB response cap", async () => {
    const page = await fixture("duckduckgo.html");
    const padded = `<html><body>${"<!-- pad -->".repeat(6000)}${page}`;
    expect(padded.length).toBeGreaterThan(SEARCH_LIMITS.maxResponseBytes);
    expect(parseDuckDuckGoHtml(padded, 8)).toEqual([]);
    const fetcher = scripted({ [DUCKDUCKGO_HTML_URL]: () => html(padded) });
    const outcome = await webSearch("q", { fetch: fetcher });
    expect(outcome).toEqual({ provider: "duckduckgo", results: [] });
  });
});

describe("helpers", () => {
  test("cleanResultUrl unwraps redirects, strips tracking params and rejects non-http", () => {
    expect(
      cleanResultUrl(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fp%3Futm_campaign%3Dx%26q%3D1&rut=1",
      ),
    ).toBe("https://a.example/p?q=1");
    expect(cleanResultUrl("https://a.example/x#frag")).toBe(
      "https://a.example/x",
    );
    expect(cleanResultUrl("javascript:void(0)")).toBeUndefined();
    expect(cleanResultUrl("ftp://a.example/")).toBeUndefined();
    expect(cleanResultUrl("//duckduckgo.com/l/?rut=1")).toBeUndefined();
    expect(
      cleanResultUrl(`https://a.example/${"x".repeat(600)}`),
    ).toBeUndefined();
    expect(cleanResultUrl("not a url")).toBeUndefined();
  });

  test("jsonArrayIn finds a direct, fenced or embedded array and tolerates junk", () => {
    expect(jsonArrayIn('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(jsonArrayIn('Here you go:\n```json\n[{"a":"x]y"}]\n```')).toEqual([
      { a: "x]y" },
    ]);
    expect(jsonArrayIn('{"not":"array"}')).toEqual([]);
    expect(jsonArrayIn("[1, 2")).toEqual([]);
    expect(jsonArrayIn("no brackets")).toEqual([]);
  });

  test("parseCompletionResults reads content parts, caps the count and dedupes", () => {
    const results = parseCompletionResults(
      {
        choices: [
          {
            message: {
              content: [
                {
                  type: "text",
                  text: '[{"title":"One","url":"https://one.example/"},',
                },
                {
                  type: "text",
                  text: '{"title":"Dup","url":"https://one.example/#x"},{"title":"Two","url":"https://two.example/","description":"d"}]',
                },
              ],
            },
          },
        ],
      },
      1,
    );
    expect(results).toEqual([
      { title: "One", url: "https://one.example/", snippet: "" },
    ]);
    expect(() => parseCompletionResults({ choices: [{}] }, 5)).toThrow(
      /no message/,
    );
    expect(() => parseCompletionResults("junk", 5)).toThrow(/no message/);
  });
});
