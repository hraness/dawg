import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  AGENT_SYSTEM_PROMPT,
  DONE_PROMPT,
  doneSummary,
  runAgentTurn,
  type AgentHost,
} from "./agent.ts";
import { createGatewayClient } from "./gateway.ts";
import {
  finishChunk,
  scriptedFetch,
  textChunk,
  toolCallChunks,
} from "./sse-fixtures.ts";

function memoryHost() {
  const state = {
    score: createScore({ tracks: [{ id: "main" }] }),
    revision: 1,
  };
  const host: AgentHost = {
    snapshot: () => ({
      score: state.score,
      revision: state.revision,
      focusedTrackId: "main",
      recentOperations: [],
    }),
    commit: (change) => {
      state.score = change.next;
      state.revision += 1;
      return Promise.resolve({ revision: state.revision });
    },
  };
  return { state, host };
}

function run(responses: Parameters<typeof scriptedFetch>[0]) {
  const script = scriptedFetch(responses);
  const { state, host } = memoryHost();
  const turn = runAgentTurn({
    prompt: "set the tempo to 96",
    model: "anthropic/claude-haiku-4.5",
    client: createGatewayClient({
      apiKey: "sk-test",
      baseUrl: "https://gw.test/v1",
      fetcher: script.fetcher,
    }),
    host,
  });
  return { script, state, turn };
}

describe("Done: ends a turn without the summary round trip", () => {
  test("parses the marker and its summary", () => {
    expect(doneSummary("Done: set the tempo to 96.")).toBe(
      "Set the tempo to 96.",
    );
    expect(doneSummary("  **Done** — moved the bass")).toBe("Moved the bass");
    expect(doneSummary("done - x")).toBe("X");
    expect(doneSummary("Done:")).toBe("Done.");
    expect(doneSummary("Done")).toBeUndefined();
    expect(doneSummary("I'll set the tempo.")).toBeUndefined();
    expect(doneSummary("Doneness: no")).toBeUndefined();
    expect(AGENT_SYSTEM_PROMPT).toContain(DONE_PROMPT);
  });

  test("one request when the calls apply and the text says Done:", async () => {
    const { script, state, turn } = run([
      [
        textChunk("Done: tempo is now 96 BPM."),
        ...toolCallChunks(0, "c1", "set_tempo", { bpm: 96 }),
        finishChunk("tool_calls"),
      ],
    ]);
    const result = await turn;
    expect(result).toMatchObject({
      type: "done",
      reason: "stop",
      text: "Tempo is now 96 BPM.",
      applied: 1,
    });
    expect(script.requests).toHaveLength(1);
    expect(state.score.tempoBpm).toBe(96);
  });

  test("a rejected call goes back to the model despite Done:", async () => {
    const { script, state, turn } = run([
      [
        textChunk("Done: tempo set."),
        ...toolCallChunks(0, "c1", "set_tempo", { bpm: 96 }),
        ...toolCallChunks(1, "c2", "set_tempo", { bpm: -5 }),
        finishChunk("tool_calls"),
      ],
      [
        textChunk("Tempo is 96; the second call was invalid."),
        finishChunk("stop"),
      ],
    ]);
    const result = await turn;
    expect(result).toMatchObject({ type: "done", rejected: 1, applied: 1 });
    expect(script.requests).toHaveLength(2);
    expect(state.score.tempoBpm).toBe(96);
  });

  test("read-only calls still get a reply step", async () => {
    const { script, turn } = run([
      [
        textChunk("Done: listed."),
        ...toolCallChunks(0, "c1", "list_sections", {}),
        finishChunk("tool_calls"),
      ],
      [textChunk("There are no sections yet."), finishChunk("stop")],
    ]);
    const result = await turn;
    expect(result).toMatchObject({ type: "done", reason: "stop", applied: 0 });
    expect(script.requests).toHaveLength(2);
  });

  test("text without the marker keeps the old two-step flow", async () => {
    const { script, turn } = run([
      [
        textChunk("Setting the tempo."),
        ...toolCallChunks(0, "c1", "set_tempo", { bpm: 96 }),
        finishChunk("tool_calls"),
      ],
      [textChunk("Done: tempo is 96."), finishChunk("stop")],
    ]);
    const result = await turn;
    expect(result).toMatchObject({ type: "done", text: "Tempo is 96." });
    expect(script.requests).toHaveLength(2);
  });
});
