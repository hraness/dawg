/**
 * Model clients for the eval. `recordingClient` wraps a live client, times
 * every request (first streamed token, full response) and keeps the
 * normalized stream so the run can be replayed offline. `replayClient`
 * plays a recording back to the same agent loop, which is how the CI test
 * exercises the tasks, the host and every grader without a network.
 */
import type {
  ChatStreamEvent,
  ChatStreamRequest,
  GatewayClient,
} from "../../src/agent/gateway.ts";

/** One model request as recorded: what came back, not what was sent. */
export type RecordedRequest = Readonly<{
  /** Normalized stream events, with `activity` (retry chatter) dropped. */
  events: readonly ChatStreamEvent[];
  /** Request start to first text or tool-call delta. */
  firstTokenMs: number | null;
  /** Request start to stream end. */
  totalMs: number;
}>;

export type ClientStats = {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Provider-reported charge when the stream carried one. */
  reportedCostUsd: number;
  /** First request's first-token latency (what a user waits to see). */
  firstTokenMs: number | null;
};

export type RecordingClient = GatewayClient &
  Readonly<{
    recorded: RecordedRequest[];
    stats: ClientStats;
  }>;

const now = () => performance.now();

function emptyStats(): ClientStats {
  return {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reportedCostUsd: 0,
    firstTokenMs: null,
  };
}

function account(stats: ClientStats, event: ChatStreamEvent): void {
  if (event.type !== "usage") return;
  stats.inputTokens += event.inputTokens;
  stats.outputTokens += event.outputTokens;
  stats.cachedInputTokens += event.cachedInputTokens ?? 0;
  stats.reportedCostUsd += event.costUsd ?? 0;
}

/** Wraps `inner`, pinning every request to `modelId` and recording it. */
export function recordingClient(
  inner: GatewayClient,
  modelId: string,
): RecordingClient {
  const recorded: RecordedRequest[] = [];
  const stats = emptyStats();
  return {
    ...(inner.provider ? { provider: inner.provider } : {}),
    recorded,
    stats,
    modelId: () => modelId,
    async *stream(request: ChatStreamRequest, signal?: AbortSignal) {
      const started = now();
      let firstTokenMs: number | null = null;
      const events: ChatStreamEvent[] = [];
      stats.requests += 1;
      try {
        for await (const event of inner.stream(
          { ...request, modelId },
          signal,
        )) {
          if (
            firstTokenMs === null &&
            (event.type === "text" || event.type === "tool-delta")
          ) {
            firstTokenMs = now() - started;
            if (stats.firstTokenMs === null) stats.firstTokenMs = firstTokenMs;
          }
          if (event.type !== "activity") events.push(event);
          account(stats, event);
          yield event;
        }
      } finally {
        recorded.push({ events, firstTokenMs, totalMs: now() - started });
      }
    },
  };
}

/** Thrown when a replay asks for more requests than were recorded. */
export class ReplayExhaustedError extends Error {
  constructor(readonly index: number) {
    super(`replay has no recorded request #${index + 1}`);
    this.name = "ReplayExhaustedError";
  }
}

/** Plays `requests` back in order, one recording per model request. */
export function replayClient(
  requests: readonly RecordedRequest[],
): GatewayClient & Readonly<{ used(): number }> {
  let next = 0;
  return {
    provider: "gateway",
    modelId: (model) => model,
    used: () => next,
    async *stream() {
      const index = next++;
      const request = requests[index];
      if (!request) throw new ReplayExhaustedError(index);
      for (const event of request.events) yield event;
    },
  };
}

/** One tool call of a scripted model response. */
export type ScriptedCall = Readonly<{ name: string; args: unknown }>;

/**
 * A recording of a model that makes `steps` (each one response with those
 * tool calls in order) and then answers `text`. Reference solutions use it
 * to prove each task is solvable and its grader accepts a correct score.
 */
export function scripted(
  steps: readonly (readonly ScriptedCall[])[],
  text = "Done.",
): RecordedRequest[] {
  const requests: RecordedRequest[] = steps.map((calls, step) => ({
    events: [
      ...calls.map((call, index): ChatStreamEvent => ({
        type: "tool-delta",
        index,
        id: `ref-${step}-${index}`,
        name: call.name,
        arguments: JSON.stringify(call.args),
      })),
      { type: "finish", reason: "tool_calls" },
    ],
    firstTokenMs: 0,
    totalMs: 0,
  }));
  requests.push({
    events: [
      { type: "text", delta: text },
      { type: "finish", reason: "stop" },
    ],
    firstTokenMs: 0,
    totalMs: 0,
  });
  return requests;
}
