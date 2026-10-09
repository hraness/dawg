import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import type { AgentEvent, AgentHost } from "./agent.ts";
import {
  COMMAND_MODE_TOOL_NAMES,
  commandAgentSystemPrompt,
  runCommandAgentTurn,
  type CommandHost,
} from "./command-agent.ts";
import { createGatewayClient } from "./gateway.ts";
import { finishChunk, scriptedFetch, textChunk } from "./sse-fixtures.ts";

const KEY = "sk-test-command-mode";

/** A stream whose chunks are released by the test, one `release()` each. */
function gatedStream(chunks: readonly string[]) {
  const encoder = new TextEncoder();
  let release: (() => void) | undefined;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      await new Promise<void>((resolve) => (release = resolve));
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify(textChunk(chunks[index++]!))}\n\n`,
        ),
      );
    },
  });
  return {
    body,
    async step() {
      while (!release) await Bun.sleep(0);
      const go = release;
      release = undefined;
      go();
      await Bun.sleep(0);
      await Bun.sleep(0);
    },
  };
}

function host() {
  const state = { revision: 1, ran: [] as string[] };
  const agentHost: AgentHost = {
    snapshot: () => ({
      score: createScore({ tracks: [{ id: "main" }] }),
      revision: state.revision,
      focusedTrackId: "main",
      recentOperations: [],
    }),
    commit: () => Promise.reject(new Error("command mode never commits JSON")),
  };
  const commands: CommandHost = {
    isCommand: (line) => /^(tempo|add|fx|volume|bogus)\b/.test(line),
    run: (line) => {
      state.ran.push(line);
      if (line.startsWith("bogus"))
        return Promise.resolve({
          ok: false,
          message: "unrecognized",
          baseRevision: state.revision,
          resultRevision: state.revision,
        });
      state.revision += 1;
      return Promise.resolve({
        ok: true,
        message: `ok ${line}`,
        baseRevision: state.revision - 1,
        resultRevision: state.revision,
      });
    },
  };
  return { state, agentHost, commands };
}

function client(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return createGatewayClient({
    apiKey: KEY,
    baseUrl: "https://gw.test/v1",
    fetcher,
  });
}

describe("command-mode agent turn", () => {
  test("ghost text grows with the stream and each line runs before the stream ends", async () => {
    const stream = gatedStream([
      "tem",
      "po 96\nfx rev",
      "erb mix 0.4\n",
      "Set tempo and reverb.",
    ]);
    const { state, agentHost, commands } = host();
    const events: AgentEvent[] = [];
    const turn = runCommandAgentTurn({
      prompt: "slower and wetter",
      model: "anthropic/claude-haiku-4.5",
      host: agentHost,
      commands,
      client: client(() =>
        Promise.resolve(
          new Response(stream.body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
      onEvent: (event) => events.push(event),
    });
    const typing = () =>
      events
        .filter((event) => event.type === "command-typing")
        .map((event) => (event as { text: string }).text);

    await stream.step();
    expect(typing()).toEqual(["tem"]);
    expect(state.ran).toEqual([]);

    await stream.step();
    // `tempo 96` is complete: it ran while the model is still streaming.
    expect(state.ran).toEqual(["tempo 96"]);
    expect(typing().at(-1)).toBe("fx rev");

    await stream.step();
    expect(state.ran).toEqual(["tempo 96", "fx reverb mix 0.4"]);
    await stream.step();
    const result = await turn;
    expect(result.type).toBe("done");
    if (result.type !== "done") return;
    expect(result.applied).toBe(2);
    expect(result.text).toBe("Set tempo and reverb.");
    expect(typing().at(-1)).toBe("");
    const commandEvents = events.filter((event) => event.type === "command");
    expect(
      commandEvents.map((event) => (event as { line: string }).line),
    ).toEqual(["tempo 96", "fx reverb mix 0.4"]);
  });

  test("a failed line is fed back once for a correction round", async () => {
    const script = scriptedFetch([
      [textChunk("bogus 1\n"), finishChunk("stop")],
      [textChunk("tempo 90\nFixed it."), finishChunk("stop")],
    ]);
    const { state, agentHost, commands } = host();
    const result = await runCommandAgentTurn({
      prompt: "x",
      model: "anthropic/claude-haiku-4.5",
      host: agentHost,
      commands,
      client: client(script.fetcher),
    });
    expect(state.ran).toEqual(["bogus 1", "tempo 90"]);
    expect(result.type).toBe("done");
    if (result.type === "done") {
      expect(result.rejected).toBe(1);
      expect(result.applied).toBe(1);
    }
    const second = JSON.stringify(script.requests[1]!.body);
    expect(second).toContain("bogus 1 → FAILED: unrecognized");
  });

  test("offers only the tools commands cannot express, and the command reference", async () => {
    const script = scriptedFetch([
      [textChunk("Nothing to do."), finishChunk("stop")],
    ]);
    const { agentHost, commands } = host();
    await runCommandAgentTurn({
      prompt: "hi",
      model: "anthropic/claude-haiku-4.5",
      host: agentHost,
      commands,
      client: client(script.fetcher),
    });
    const body = script.requests[0]!.body as {
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ content: unknown }>;
    };
    for (const tool of body.tools ?? [])
      expect(COMMAND_MODE_TOOL_NAMES.has(tool.function.name)).toBe(true);
    expect(body.tools?.some((tool) => tool.function.name === "add_notes")).toBe(
      false,
    );
    expect(JSON.stringify(body.messages[0]!.content)).toContain(
      JSON.stringify(commandAgentSystemPrompt()).slice(1, -1),
    );
    expect(commandAgentSystemPrompt()).toContain("tempo");
    expect(commandAgentSystemPrompt()).toContain("names the key command");
  });
});
