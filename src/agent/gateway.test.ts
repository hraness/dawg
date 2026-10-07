import { describe, expect, test } from "bun:test";
import {
  createGatewayClient,
  DEFAULT_MODEL_IDS,
  GatewayError,
  resolveModelId,
  type ChatStreamEvent,
} from "./gateway.ts";
import { readSseData, SseBudgetError } from "./sse.ts";
import {
  finishChunk,
  scriptedFetch,
  sseBody,
  textChunk,
  toolCallChunks,
} from "./sse-fixtures.ts";

const KEY = "sk-test-secret-key-0123456789";

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("SSE reader", () => {
  test("joins split chunks, skips comments, and stops at [DONE]", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(': keep-alive\r\n\r\ndata: {"a"'));
        controller.enqueue(encoder.encode(":1}\r\n\r\nevent: x\ndata: two\n"));
        controller.enqueue(encoder.encode("data: lines\n\ndata: [DONE]\n\n"));
        controller.enqueue(encoder.encode("data: after\n\n"));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of readSseData(body, { maxBytes: 1024 }))
      out.push(data);
    expect(out).toEqual(['{"a":1}', "two\nlines"]);
  });

  test("holds back a trailing CR so a split CRLF does not end the event early", async () => {
    const chunks = [
      'data: {"a"',
      ":1}\r",
      "\ndata: more\r\n\r",
      "\ndata: x\r\rdata: y\r\r",
      "data: tail\r",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of readSseData(body, { maxBytes: 1024 }))
      out.push(data);
    expect(out).toEqual(['{"a":1}\nmore', "x", "y", "tail"]);
  });

  test("enforces the byte budget", async () => {
    const body = sseBody([textChunk("x".repeat(500))]);
    const read = async () => {
      for await (const _ of readSseData(body, { maxBytes: 100 })) void _;
    };
    await expect(read()).rejects.toBeInstanceOf(SseBudgetError);
  });
});

describe("Vercel AI Gateway client", () => {
  test("streams text and tool-call deltas with the mapped model ID", async () => {
    const { fetcher, requests } = scriptedFetch([
      [
        textChunk("Adding "),
        textChunk("bass."),
        ...toolCallChunks(0, "call_1", "add_notes", { notes: [] }),
        finishChunk("tool_calls"),
      ],
    ]);
    const client = createGatewayClient({
      apiKey: KEY,
      baseUrl: "https://gateway.test/v1/",
      modelIds: { "sol-6.1": "provider/sol-6.1" },
      fetcher,
    });
    const events = await collect(
      client.stream({
        model: "sol-6.1",
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: { name: "x", description: "x", parameters: {} },
          },
        ],
        maxResponseBytes: 10_000,
      }),
    );
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", delta: "Adding " },
      { type: "text", delta: "bass." },
    ]);
    const args = events
      .filter((e) => e.type === "tool-delta")
      .map((e) => (e.type === "tool-delta" ? (e.arguments ?? "") : ""))
      .join("");
    expect(JSON.parse(args)).toEqual({ notes: [] });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
    const request = requests[0]!;
    expect(request.url).toBe("https://gateway.test/v1/chat/completions");
    expect(request.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const body = request.body as Record<string, unknown>;
    expect(body.model).toBe("provider/sol-6.1");
    expect(body.stream).toBe(true);
    expect(body.tool_choice).toBe("auto");
    expect(Array.isArray(body.tools)).toBe(true);
  });

  test("redacts the key from HTTP and in-stream provider errors", async () => {
    const http = createGatewayClient({
      apiKey: KEY,
      fetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: `bad key ${KEY}` } }),
            { status: 401 },
          ),
        ),
    });
    const httpError = await collect(
      http.stream({ model: "opus-5.5", messages: [], maxResponseBytes: 1000 }),
    ).catch((error: unknown) => error);
    expect(httpError).toBeInstanceOf(GatewayError);
    expect((httpError as GatewayError).status).toBe(401);
    expect(String((httpError as Error).message)).not.toContain(KEY);
    expect(String((httpError as Error).message)).toContain("[redacted]");

    const { fetcher } = scriptedFetch([
      [{ error: { message: `overloaded ${KEY}` } }],
    ]);
    const streamed = createGatewayClient({ apiKey: KEY, fetcher });
    const streamError = await collect(
      streamed.stream({
        model: "opus-5.5",
        messages: [],
        maxResponseBytes: 1000,
      }),
    ).catch((error: unknown) => error);
    expect(streamError).toBeInstanceOf(GatewayError);
    expect(String((streamError as Error).message)).not.toContain(KEY);
  });

  test("retries 408/429/5xx and network failures before the first byte, with backoff", async () => {
    const slept: number[] = [];
    const retry = {
      baseMs: 100,
      sleep: (ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    };
    const { fetcher, requests } = scriptedFetch([
      () => new Response("busy", { status: 429 }),
      () => Promise.reject(new TypeError("connect ECONNRESET")),
      [textChunk("ok"), finishChunk("stop")],
    ]);
    const client = createGatewayClient({ apiKey: KEY, fetcher, retry });
    const events = await collect(
      client.stream({ model: "sol-6.1", messages: [], maxResponseBytes: 1000 }),
    );
    expect(events).toEqual([
      { type: "activity", message: "retrying (429)…" },
      { type: "activity", message: "retrying (network)…" },
      { type: "text", delta: "ok" },
      { type: "finish", reason: "stop" },
    ]);
    expect(requests).toHaveLength(3);
    expect(slept).toEqual([100, 200]);
    // Every attempt carries a header-phase timeout signal.
    expect(requests.every((request) => request.headers !== undefined)).toBe(
      true,
    );

    // Two retries, then the error surfaces with its status.
    const exhausted = createGatewayClient({
      apiKey: KEY,
      retry,
      fetcher: () => Promise.resolve(new Response("down", { status: 503 })),
    });
    const error = await collect(
      exhausted.stream({
        model: "sol-6.1",
        messages: [],
        maxResponseBytes: 1000,
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).status).toBe(503);

    // 4xx other than 408/429 is never retried.
    let calls = 0;
    const client400 = createGatewayClient({
      apiKey: KEY,
      retry,
      fetcher: () => {
        calls += 1;
        return Promise.resolve(new Response("nope", { status: 400 }));
      },
    });
    await expect(
      collect(
        client400.stream({
          model: "sol-6.1",
          messages: [],
          maxResponseBytes: 1000,
        }),
      ),
    ).rejects.toBeInstanceOf(GatewayError);
    expect(calls).toBe(1);
  });

  test("gives up on a header phase that outlives the timeout and honors aborts", async () => {
    const hang = () => new Promise<Response>(() => undefined);
    const slow = createGatewayClient({
      apiKey: KEY,
      fetcher: (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
      headerTimeoutMs: 20,
      retry: { retries: 1, baseMs: 1, sleep: () => Promise.resolve() },
    });
    const error = await collect(
      slow.stream({ model: "sol-6.1", messages: [], maxResponseBytes: 1000 }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(String((error as Error).message)).toContain(
      "did not respond within 20 ms",
    );

    const controller = new AbortController();
    const aborted = createGatewayClient({
      apiKey: KEY,
      fetcher: (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
          controller.abort(new Error("user cancelled"));
        }),
      retry: { retries: 2, baseMs: 1, sleep: () => Promise.resolve() },
    });
    await expect(
      collect(
        aborted.stream(
          { model: "sol-6.1", messages: [], maxResponseBytes: 1000 },
          controller.signal,
        ),
      ),
    ).rejects.toThrow("user cancelled");
    void hang;
  });

  test("requires a key before any network request", async () => {
    let called = false;
    const client = createGatewayClient({
      apiKey: "",
      fetcher: () => {
        called = true;
        return Promise.resolve(new Response(""));
      },
    });
    const saved = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    try {
      await expect(
        collect(
          client.stream({
            model: "opus-5.5",
            messages: [],
            maxResponseBytes: 1,
          }),
        ),
      ).rejects.toThrow("AI_GATEWAY_API_KEY");
    } finally {
      if (saved !== undefined) process.env.AI_GATEWAY_API_KEY = saved;
    }
    expect(called).toBe(false);
  });
});

describe("model alias allowlist", () => {
  test("maps the two friendly labels; passes vendor/model IDs through", () => {
    expect(resolveModelId("opus-5.5")).toBe(DEFAULT_MODEL_IDS["opus-5.5"]);
    expect(DEFAULT_MODEL_IDS["opus-5.5"]).toBe("anthropic/claude-opus-5.5");
    expect(resolveModelId("sol-6.1")).toBe("openai/gpt-6.1-sol");
    expect(resolveModelId("sol-6.1", { "sol-6.1": "openai/gpt-6-sol" })).toBe(
      "openai/gpt-6-sol",
    );
    // The model picker saves full vendor/model IDs; bare names stay unknown.
    expect(resolveModelId("anthropic/claude-opus-5.5")).toBe(
      "anthropic/claude-opus-5.5",
    );
    expect(() => resolveModelId("gpt-4")).toThrow("unknown model");
    expect(() =>
      resolveModelId("opus-5.5", { "opus-5.5": "not a model id" }),
    ).toThrow("provider/model");
  });
});
