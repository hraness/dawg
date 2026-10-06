import { describe, expect, test } from "bun:test";
import { createGatewayClient } from "./gateway.ts";

describe("Vercel AI Gateway client", () => {
  test("maps friendly model labels and returns assistant content", async () => {
    let request: Request | undefined;
    const client = createGatewayClient({
      apiKey: "test-key",
      baseUrl: "https://gateway.test/v1",
      modelIds: { "sol-6.1": "provider/sol-6.1" },
      fetcher: (input, init) => {
        request = new Request(input, init);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"operations":[]}' } }],
            }),
            { status: 200 },
          ),
        );
      },
    });
    expect(
      await client.complete({
        model: "sol-6.1",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toBe('{"operations":[]}');
    expect(request?.url).toBe("https://gateway.test/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer test-key");
    expect(request).toBeDefined();
    const body = (await request!.json()) as { model?: unknown };
    expect(body.model).toBe("provider/sol-6.1");
  });
});
