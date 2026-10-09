import { describe, expect, test } from "bun:test";
import {
  createGatewayClient,
  GatewayError,
  type ChatStreamEvent,
} from "./gateway.ts";
import { finishChunk, sseBody, textChunk } from "./sse-fixtures.ts";

const KEY = "sk-test-fallback-0000";
const noWait = { baseMs: 1, sleep: () => Promise.resolve() };

async function collect(events: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** Headers now, then nothing until the request is aborted. */
function stalled(init?: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener("abort", () =>
        controller.error(init.signal?.reason),
      );
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const ok = () =>
  new Response(sseBody([textChunk("hi"), finishChunk("stop")]), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

function modelOf(init?: RequestInit): string {
  return (JSON.parse(String(init?.body)) as { model: string }).model;
}

describe("first-byte timeout and fallback model", () => {
  test("a stream that sends nothing after headers is retried", async () => {
    const models: string[] = [];
    let calls = 0;
    const client = createGatewayClient({
      apiKey: KEY,
      firstByteTimeoutMs: 20,
      retry: { retries: 1, ...noWait },
      fetcher: (_input, init) => {
        models.push(modelOf(init));
        calls += 1;
        return Promise.resolve(calls === 1 ? stalled(init) : ok());
      },
    });
    const events = await collect(
      client.stream({
        model: "anthropic/claude-haiku-5.5",
        messages: [],
        maxResponseBytes: 10_000,
      }),
    );
    expect(events).toContainEqual({
      type: "activity",
      message: "retrying (stalled)…",
    });
    expect(events).toContainEqual({ type: "text", delta: "hi" });
    expect(models).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-haiku-5.5",
    ]);
  });

  test("gives up after the retries without a fallback", async () => {
    const client = createGatewayClient({
      apiKey: KEY,
      firstByteTimeoutMs: 10,
      retry: { retries: 1, ...noWait },
      fetcher: (_input, init) => Promise.resolve(stalled(init)),
    });
    const error = await collect(
      client.stream({
        model: "zai/glm-5.3-flash",
        messages: [],
        maxResponseBytes: 10_000,
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).toContain("sent nothing within 10 ms");
  });

  test("falls back once after repeated 503s and stalls", async () => {
    for (const failure of ["503", "stall"] as const) {
      const models: string[] = [];
      const client = createGatewayClient({
        apiKey: KEY,
        firstByteTimeoutMs: 10,
        retry: { retries: 1, ...noWait },
        fetcher: (_input, init) => {
          const model = modelOf(init);
          models.push(model);
          if (model === "zai/glm-5.3-flash") return Promise.resolve(ok());
          return Promise.resolve(
            failure === "503"
              ? new Response("busy", { status: 503 })
              : stalled(init),
          );
        },
      });
      const events = await collect(
        client.stream({
          model: "anthropic/claude-haiku-5.5",
          fallbackModelId: "zai/glm-5.3-flash",
          messages: [],
          maxResponseBytes: 10_000,
        }),
      );
      expect(models).toEqual([
        "anthropic/claude-haiku-5.5",
        "anthropic/claude-haiku-5.5",
        "zai/glm-5.3-flash",
      ]);
      expect(
        events.some(
          (e) =>
            e.type === "activity" &&
            e.message.startsWith("falling back to zai/glm-5.3-flash"),
        ),
      ).toBe(true);
      expect(events).toContainEqual({ type: "text", delta: "hi" });
    }
  });

  test("a non-retryable error never falls back, and the caller's abort wins", async () => {
    const models: string[] = [];
    const client = createGatewayClient({
      apiKey: KEY,
      retry: { retries: 2, ...noWait },
      fetcher: (_input, init) => {
        models.push(modelOf(init));
        return Promise.resolve(new Response("bad", { status: 400 }));
      },
    });
    await expect(
      collect(
        client.stream({
          model: "anthropic/claude-haiku-5.5",
          fallbackModelId: "zai/glm-5.3-flash",
          messages: [],
          maxResponseBytes: 10_000,
        }),
      ),
    ).rejects.toBeInstanceOf(GatewayError);
    expect(models).toEqual(["anthropic/claude-haiku-5.5"]);

    const controller = new AbortController();
    const slow = createGatewayClient({
      apiKey: KEY,
      firstByteTimeoutMs: 5_000,
      retry: { retries: 2, ...noWait },
      fetcher: (_input, init) => {
        setTimeout(() => controller.abort(new Error("user cancelled")), 5);
        return Promise.resolve(stalled(init));
      },
    });
    await expect(
      collect(
        slow.stream(
          {
            model: "anthropic/claude-haiku-5.5",
            fallbackModelId: "zai/glm-5.3-flash",
            messages: [],
            maxResponseBytes: 10_000,
          },
          controller.signal,
        ),
      ),
    ).rejects.toThrow("user cancelled");
  });
});
