/** Test helpers that stream OpenAI-compatible SSE fixtures through `fetch`. */

export type FixtureChunk = Record<string, unknown> | string;

export function sseBody(
  chunks: readonly FixtureChunk[],
  options: { done?: boolean; split?: number; hang?: boolean } = {},
): ReadableStream<Uint8Array> {
  const lines = chunks
    .map(
      (chunk) =>
        `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`,
    )
    .join("");
  const text = options.done === false ? lines : `${lines}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(text);
  const split = options.split ?? 17;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        if (options.hang) return new Promise(() => undefined);
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + split));
      offset += split;
    },
  });
}

export function textChunk(content: string): Record<string, unknown> {
  return { choices: [{ index: 0, delta: { content } }] };
}

/** Split one tool call's argument JSON across several deltas. */
export function toolCallChunks(
  index: number,
  id: string,
  name: string,
  args: unknown,
  pieces = 3,
): Record<string, unknown>[] {
  const json = typeof args === "string" ? args : JSON.stringify(args);
  const size = Math.max(1, Math.ceil(json.length / pieces));
  const chunks: Record<string, unknown>[] = [
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id,
                type: "function",
                function: { name, arguments: "" },
              },
            ],
          },
        },
      ],
    },
  ];
  for (let offset = 0; offset < json.length; offset += size)
    chunks.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                function: { arguments: json.slice(offset, offset + size) },
              },
            ],
          },
        },
      ],
    });
  return chunks;
}

export function finishChunk(reason: string): Record<string, unknown> {
  return { choices: [{ index: 0, delta: {}, finish_reason: reason }] };
}

/** A fetch double that serves one scripted SSE response per request. */
export function scriptedFetch(
  responses: ReadonlyArray<
    | readonly FixtureChunk[]
    | ((init: RequestInit | undefined) => Response | Promise<Response>)
  >,
): {
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  requests: Array<{ url: string; headers: Headers; body: unknown }>;
} {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  let index = 0;
  return {
    requests,
    async fetcher(input, init) {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "null")),
      });
      const next = responses[index++];
      if (!next) throw new Error("unexpected extra request");
      if (typeof next === "function") return next(init);
      return new Response(sseBody(next), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  };
}
