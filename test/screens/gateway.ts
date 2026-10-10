/**
 * A fake AI gateway for the agent screens: an OpenAI-style streaming
 * endpoint whose reply chunks go out only as the scene releases them, so a
 * screen can be taken mid-stream.
 */
interface Gate {
  chunks: string[];
  released: number;
  waiters: (() => void)[];
}

export class FakeGateway {
  private readonly server: ReturnType<typeof Bun.serve>;
  private readonly replies: Gate[] = [];
  requests = 0;

  constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch: (request) => this.fetch(request),
    });
  }

  get env(): Record<string, string> {
    const origin = `http://127.0.0.1:${this.server.port}`;
    return {
      AI_GATEWAY_BASE_URL: `${origin}/v1`,
      DAWG_MODELS_DEV_URL: `${origin}/api.json`,
    };
  }

  /** Queues the next reply; returns a function releasing `n` chunks. */
  reply(chunks: string[]): (n?: number) => void {
    const gate: Gate = { chunks, released: 0, waiters: [] };
    this.replies.push(gate);
    return (n = 1) => {
      gate.released += n;
      for (const wake of gate.waiters.splice(0)) wake();
    };
  }

  stop(): void {
    this.server.stop(true);
  }

  private async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    await request.json();
    this.requests += 1;
    const gate = this.replies.shift() ?? {
      chunks: ["Done."],
      released: 1,
      waiters: [],
    };
    const encoder = new TextEncoder();
    const event = (body: unknown) =>
      encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
    let sent = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (sent >= gate.released && sent < gate.chunks.length)
            await new Promise<void>((wake) => gate.waiters.push(wake));
          if (sent >= gate.chunks.length) {
            controller.enqueue(
              event({
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              }),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          const content = gate.chunks[sent++]!;
          controller.enqueue(
            event({ choices: [{ index: 0, delta: { content } }] }),
          );
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
}
