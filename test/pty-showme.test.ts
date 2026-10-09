/**
 * Show-me in a real PTY with a fake streaming gateway: the test releases
 * each SSE chunk, so it can look at the screen and the saved session while
 * the model is still "writing". Ghost text appears in the prompt bar, the
 * first command's effect lands before the stream ends, the caption names
 * the gesture, the finish hint teaches the command, the streamed commands
 * commit the same composition a human typing them does, and `/showme off`
 * sends the classic JSON tool request instead.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Gate = { chunks: string[]; released: number; waiters: (() => void)[] };

let server: ReturnType<typeof Bun.serve> | undefined;
let origin = "";
/** One scripted reply per request, in order. */
let replies: Gate[] = [];
const bodies: unknown[] = [];

function chunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}

/** A reply whose chunks stream only as the test releases them. */
function gated(chunks: string[]): Gate {
  return { chunks, released: 0, waiters: [] };
}

function release(gate: Gate, count = 1): void {
  gate.released += count;
  for (const wake of gate.waiters.splice(0)) wake();
}

beforeAll(() => {
  if (!supported) return;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (!path.endsWith("/chat/completions"))
        return new Response("nope", { status: 404 });
      bodies.push(await request.json());
      const gate = replies.shift() ?? gated(["Done."]);
      if (gate.released === 0 && gate.chunks.length === 1) release(gate);
      const encoder = new TextEncoder();
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            while (sent >= gate.released && sent < gate.chunks.length)
              await new Promise<void>((resolve) => gate.waiters.push(resolve));
            if (sent >= gate.chunks.length) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
                ),
              );
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(chunk(gate.chunks[sent++]!)));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

function env(): Record<string, string> {
  return {
    AI_GATEWAY_BASE_URL: `${origin}/v1`,
    DAWG_MODELS_DEV_URL: `${origin}/api.json`,
  };
}

/** The newest saved composition under `.dawg/`, as text. */
async function composition(cwd: string): Promise<Record<string, unknown>> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      composition?: Record<string, unknown>;
    };
    if (parsed.composition && "tracks" in parsed.composition)
      return parsed.composition;
  }
  throw new Error("no session composition");
}

async function quit(t: Awaited<ReturnType<typeof launch>>): Promise<void> {
  t.terminal.write("\u0003");
  await Promise.race([t.proc.exited, Bun.sleep(5000)]);
  t.proc.kill();
  t.terminal.close();
}

const LINES = [
  "tempo 96",
  "fx reverb mix 0.4",
  "add C4 at 0 for 0.5",
  "add E4 at 1 for 0.5",
  "volume 0.6",
  "pan -0.3",
  "/track drums",
  "instrument kit",
  "hit kick at 0",
  "pattern hat 0 0.5 1 1.5",
];

test.skipIf(!supported)(
  "real PTY: ghost text streams, the first command lands mid-stream, caption and hint teach it",
  async () => {
    const reply = gated([
      "tem",
      "po 96\nfx rev",
      "erb mix 0.4\n",
      "Slower and wetter: type tempo 96, or fx reverb mix 0.4.",
    ]);
    replies = [reply];
    const t = await launch(100, 30, env(), ["--track", "main"]);
    await t.until(() => t.vt.text().includes("STEER"), "prompt");
    await t.send("make it slower and wetter\r");
    await t.until(() => bodies.length > 0, "request");
    release(reply);
    await t.until(() => t.vt.text().includes("tem▏"), "ghost text");
    release(reply);
    // `tempo 96` ran while the stream is still open.
    await t.until(() => t.vt.text().includes("fx rev▏"), "next ghost");
    await t.until(
      () =>
        /96\s*(bpm|BPM)/.test(t.vt.text()) ||
        t.vt.text().includes("tempo · 96"),
      "tempo applied mid-stream",
    );
    expect(reply.released).toBeLessThan(reply.chunks.length);
    release(reply);
    await t.until(
      () => t.vt.text().includes("fader · fx reverb mix → 0.4"),
      "fader caption",
    );
    release(reply);
    await t.until(
      () => t.vt.text().includes("do it yourself: type fx reverb mix 0.4"),
      "finish hint",
    );
    const saved = await composition(t.cwd);
    expect(saved.tempoBpm).toBe(96);
    // Command mode sends only the tools commands cannot express.
    const body = bodies.at(-1) as { tools?: { function: { name: string } }[] };
    expect(body.tools?.some((tool) => tool.function.name === "add_notes")).toBe(
      false,
    );
    await quit(t);
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: streamed commands commit the same composition as typing them",
  async () => {
    const typed = await launch(100, 30, { ...env(), DAWG_AI: "0" }, [
      "--track",
      "main",
    ]);
    await typed.until(() => typed.vt.text().includes("try:"), "offline prompt");
    for (const line of LINES) await typed.send(`${line}\r`);
    await Bun.sleep(300);
    const byHand = await composition(typed.cwd);
    await quit(typed);

    replies = [gated([`${LINES.join("\n")}\nDone.`])];
    const streamed = await launch(100, 30, env(), ["--track", "main"]);
    await streamed.until(() => streamed.vt.text().includes("STEER"), "prompt");
    await streamed.send("build it\r");
    await streamed.until(
      () => streamed.vt.text().includes("do it yourself: type pattern hat"),
      "finished",
      10_000,
    );
    await Bun.sleep(300);
    const byAgent = await composition(streamed.cwd);
    await quit(streamed);
    // Note ids are random per session even when a person types both (the
    // typed path mints them); everything else is byte-identical.
    const ids = (value: Record<string, unknown>) =>
      JSON.stringify(value).replace(
        /"id":"[^"]*","trackId"/g,
        '"id":"·","trackId"',
      );
    expect(ids(byAgent)).toBe(ids(byHand));
  },
  40_000,
);

test.skipIf(!supported)(
  "real PTY: /showme off restores the JSON tool path and is saved",
  async () => {
    const t = await launch(100, 30, env(), ["--track", "main"]);
    await t.until(() => t.vt.text().includes("STEER"), "prompt");
    await t.send("/showme off\r");
    await t.until(() => t.vt.text().includes("show me off"), "off");
    const before = bodies.length;
    replies = [gated(["Nothing to change."])];
    await t.send("hello\r");
    await t.until(() => bodies.length > before, "request");
    const body = bodies.at(-1) as { tools?: { function: { name: string } }[] };
    expect(body.tools?.some((tool) => tool.function.name === "add_notes")).toBe(
      true,
    );
    await t.until(() => !t.vt.text().includes("thinking"), "turn done");
    const config = JSON.parse(
      await readFile(join(t.cwd, ".config", "dawg", "config.json"), "utf8"),
    ) as { showMe?: string };
    expect(config.showMe).toBe("off");
    await quit(t);
  },
  30_000,
);
