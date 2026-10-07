import {
  applyScoreOperation,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { compositionBrief } from "./brief.ts";
import {
  GatewayError,
  type ChatMessage,
  type ChatToolCall,
  type GatewayClient,
  type GatewayModel,
} from "./gateway.ts";
import { validateAgentOperation } from "./planner.ts";
import { SseBudgetError } from "./sse.ts";
import {
  AGENT_TOOLS,
  chatTools,
  findAgentTool,
  type AgentTool,
  type ToolPlan,
} from "./tools.ts";

/** Hard ceilings for one agent turn. Callers may only tighten them. */
export const AGENT_LIMITS = Object.freeze({
  maxSteps: 8,
  maxToolCalls: 32,
  maxResponseBytes: 256 * 1024,
  maxToolArgumentBytes: 32 * 1024,
  timeoutMs: 90_000,
  maxTextChars: 4_000,
});

export type AgentBudget = Partial<{
  maxSteps: number;
  maxToolCalls: number;
  maxResponseBytes: number;
  timeoutMs: number;
}>;

/**
 * Structured progress for a TUI. Events are emitted in order; exactly one of
 * `done` or `error` ends every turn.
 */
export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; callId: string; name: string; step: number }
  | {
      type: "tool-applied";
      callId: string;
      name: string;
      summary: string;
      baseRevision: number;
      resultRevision: number;
      trackId?: string;
    }
  | {
      type: "tool-rejected";
      callId: string;
      name: string;
      diagnostic: string;
    }
  | {
      type: "done";
      reason: AgentDoneReason;
      text: string;
      applied: number;
      rejected: number;
      revision: number;
    }
  | {
      type: "error";
      code: AgentErrorCode;
      message: string;
      applied: number;
      revision: number;
    };

export type AgentDoneReason = "stop" | "max-steps" | "max-tool-calls";
export type AgentErrorCode =
  "aborted" | "timeout" | "budget" | "provider" | "internal";

export type AgentSnapshot = Readonly<{
  score: TrackScore;
  revision: number;
  focusedTrackId: string;
  recentOperations: readonly string[];
}>;

/** The score change a validated tool call asks the host to commit. */
export type AgentCommit = Readonly<{
  next: TrackScore;
  operations: readonly ScoreOperation[];
  baseRevision: number;
  toolName: string;
  callId: string;
  summary: string;
}>;

/** Thrown by a host when the session moved past `baseRevision`. */
export class StaleRevisionError extends Error {
  constructor(
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `score changed (rev ${baseRevision} → ${currentRevision}); re-plan from the latest brief`,
    );
    this.name = "StaleRevisionError";
  }
}

/** The narrow surface the agent needs from its host (main.ts or a daemon). */
export type AgentHost = Readonly<{
  snapshot(): AgentSnapshot;
  /** Atomically commit `next` if the session is still at `baseRevision`. */
  commit(change: AgentCommit): Promise<{ revision: number }>;
  transport?(action: "play" | "pause" | "toggle"): Promise<void>;
  /** Steering messages typed during this turn, consumed between steps. */
  takeSteering?(): readonly string[];
}>;

export type AgentTurnOptions = Readonly<{
  prompt: string;
  model: GatewayModel;
  client: GatewayClient;
  host: AgentHost;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  budget?: AgentBudget;
  tools?: readonly AgentTool[];
  /** Note ID factory; defaults to `${track}-${revision}-${nonce}${index}`. */
  newNoteId?: (trackId: string, revision: number, index: number) => string;
}>;

export type AgentTurnResult = Extract<AgentEvent, { type: "done" | "error" }>;

export const AGENT_SYSTEM_PROMPT = [
  "You are dawg, a loop composer inside a terminal music workstation.",
  "Edit the score only by calling the provided tools; every call is validated and applied immediately, and its result tells you the new revision.",
  "Times are in beats from the loop start (0-based). Keep notes inside loopBeats unless you extend the loop first.",
  "Prefer a few well-formed calls (one add_notes call per track part) over many tiny ones.",
  'For drums, create a track with instrument "kit" and use add_drums; drum pitches select voices, so do not use add_notes for beats.',
  "Effects (set_effects, set_automation): low-pass filter cutoff 20..20000 Hz and resonance 0..1; stereo delay beats 0.0625..4, feedback 0..0.9, mix 0..1; stereo reverb mix 0..1 (0.15..0.35 is a natural room) and size 0..1; pan -1..1 is equal-power stereo. Automatable lanes: volume, pan, filter, resonance, delay-feedback, delay-mix.",
  "If a call is rejected, read the diagnostic and either fix the arguments or stop.",
  "When you are done, reply with one short sentence describing the musical change.",
].join(" ");

/**
 * Run one bounded, streaming, tool-calling turn. Every completed tool call is
 * validated by the tool, then by the planner's operation validator, then by a
 * dry run of the reducer, and only then committed through the host. A failed
 * call is reported to the model and the TUI without touching the score.
 */
export async function runAgentTurn(
  options: AgentTurnOptions,
): Promise<AgentTurnResult> {
  const limits = {
    maxSteps: tighten(options.budget?.maxSteps, AGENT_LIMITS.maxSteps),
    maxToolCalls: tighten(
      options.budget?.maxToolCalls,
      AGENT_LIMITS.maxToolCalls,
    ),
    maxResponseBytes: tighten(
      options.budget?.maxResponseBytes,
      AGENT_LIMITS.maxResponseBytes,
    ),
    timeoutMs: tighten(options.budget?.timeoutMs, AGENT_LIMITS.timeoutMs),
  };
  const emit = (event: AgentEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A rendering failure must never corrupt the turn.
    }
  };
  const tools = options.tools ?? AGENT_TOOLS;
  const chatToolList = chatTools(tools);
  const nonce = Math.random().toString(36).slice(2, 6);
  const newNoteId =
    options.newNoteId ??
    ((trackId: string, revision: number, index: number) =>
      `${trackId.slice(0, 40)}-${revision}-${nonce}${index}`);
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new AgentTimeoutError(limits.timeoutMs)),
    limits.timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;

  let applied = 0;
  let rejected = 0;
  let toolCalls = 0;
  let bytesUsed = 0;
  let finalText = "";
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: options.prompt.slice(0, 8_000) },
  ];
  const finish = (result: AgentTurnResult): AgentTurnResult => {
    clearTimeout(timer);
    emit(result);
    return result;
  };
  const currentRevision = () => options.host.snapshot().revision;

  try {
    for (let step = 1; step <= limits.maxSteps; step += 1) {
      if (signal.aborted) throw signal.reason;
      for (const steer of options.host.takeSteering?.() ?? [])
        messages.push({
          role: "user",
          content: `Steering from the user mid-turn: ${steer.slice(0, 2_000)}`,
        });
      emit({ type: "step", step });
      const snapshot = options.host.snapshot();
      const brief = compositionBrief(snapshot);
      const request: ChatMessage[] = [
        messages[0]!,
        { role: "system", content: `Composition brief (JSON): ${brief}` },
        ...messages.slice(1),
      ];
      const remaining = limits.maxResponseBytes - bytesUsed;
      if (remaining <= 0) throw new SseBudgetError(limits.maxResponseBytes);

      let text = "";
      let streamBytes = 0;
      const pending = new Map<
        number,
        { id: string; name: string; arguments: string; started: boolean }
      >();
      for await (const event of options.client.stream(
        {
          model: options.model,
          messages: request,
          tools: chatToolList,
          maxResponseBytes: remaining,
        },
        signal,
      )) {
        if (event.type === "text") {
          streamBytes += event.delta.length;
          if (text.length < AGENT_LIMITS.maxTextChars) {
            const delta = event.delta.slice(
              0,
              AGENT_LIMITS.maxTextChars - text.length,
            );
            text += delta;
            emit({ type: "text-delta", delta });
          }
        } else if (event.type === "tool-delta") {
          const call = pending.get(event.index) ?? {
            id: "",
            name: "",
            arguments: "",
            started: false,
          };
          if (event.id) call.id = event.id;
          if (event.name) call.name += event.name;
          if (event.arguments) {
            call.arguments += event.arguments;
            streamBytes += event.arguments.length;
            if (call.arguments.length > AGENT_LIMITS.maxToolArgumentBytes)
              throw new SseBudgetError(AGENT_LIMITS.maxToolArgumentBytes);
          }
          if (!pending.has(event.index)) {
            if (pending.size + toolCalls >= limits.maxToolCalls + 1) {
              // Ignore calls past the budget; the turn ends after this step.
              continue;
            }
            pending.set(event.index, call);
          }
          if (!call.started && call.name) {
            call.started = true;
            emit({
              type: "tool-start",
              callId: call.id || `call-${step}-${event.index}`,
              name: call.name,
              step,
            });
          }
        }
      }
      bytesUsed += streamBytes;
      if (text.trim()) finalText = text.trim();

      const calls = [...pending.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, call]) => ({
          ...call,
          id: call.id || `call-${step}-${index}`,
        }));
      if (calls.length === 0) {
        return finish({
          type: "done",
          reason: "stop",
          text: finalText,
          applied,
          rejected,
          revision: currentRevision(),
        });
      }
      const assistantCalls: ChatToolCall[] = calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      }));
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: assistantCalls,
      });
      let overBudget = false;
      for (const call of calls) {
        if (signal.aborted) throw signal.reason;
        let content: string;
        if (toolCalls >= limits.maxToolCalls) {
          overBudget = true;
          content = JSON.stringify({
            ok: false,
            error: "tool call budget exhausted; not applied",
          });
          rejected += 1;
          emit({
            type: "tool-rejected",
            callId: call.id,
            name: call.name,
            diagnostic: "tool call budget exhausted",
          });
        } else {
          toolCalls += 1;
          const outcome = await executeCall(call, {
            tools,
            host: options.host,
            newNoteId,
          });
          if (outcome.ok) {
            applied += outcome.mutated ? 1 : 0;
            if (outcome.explanation) finalText = outcome.explanation;
            emit(outcome.event);
          } else {
            rejected += 1;
            emit({
              type: "tool-rejected",
              callId: call.id,
              name: call.name,
              diagnostic: outcome.diagnostic,
            });
          }
          content = outcome.content;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
      if (overBudget || toolCalls >= limits.maxToolCalls) {
        return finish({
          type: "done",
          reason: "max-tool-calls",
          text: finalText,
          applied,
          rejected,
          revision: currentRevision(),
        });
      }
    }
    return finish({
      type: "done",
      reason: "max-steps",
      text: finalText,
      applied,
      rejected,
      revision: currentRevision(),
    });
  } catch (error) {
    const { code, message } = classifyAgentError(error, signal, options.signal);
    return finish({
      type: "error",
      code,
      message,
      applied,
      revision: currentRevision(),
    });
  } finally {
    clearTimeout(timer);
  }
}

export type CallOutcome =
  | {
      ok: true;
      mutated: boolean;
      content: string;
      explanation?: string;
      event: Extract<AgentEvent, { type: "tool-applied" }>;
    }
  | { ok: false; content: string; diagnostic: string };

export async function executeCall(
  call: { id: string; name: string; arguments: string },
  context: {
    tools: readonly AgentTool[];
    host: AgentHost;
    newNoteId: (trackId: string, revision: number, index: number) => string;
  },
): Promise<CallOutcome> {
  const reject = (diagnostic: string): CallOutcome => ({
    ok: false,
    diagnostic: diagnostic.slice(0, 300),
    content: JSON.stringify({ ok: false, error: diagnostic.slice(0, 300) }),
  });
  const tool = findAgentTool(call.name, context.tools);
  if (!tool) return reject(`unknown tool ${call.name.slice(0, 40)}`);
  let args: unknown;
  try {
    args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return reject("arguments were not valid JSON");
  }
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return reject("arguments must be a JSON object");
  const snapshot = context.host.snapshot();
  let plan: ToolPlan;
  try {
    plan = tool.plan(args as Record<string, unknown>, {
      score: snapshot.score,
      focusedTrackId: snapshot.focusedTrackId,
      revision: snapshot.revision,
      newNoteId: (trackId, index) =>
        context.newNoteId(trackId, snapshot.revision + 1, index),
    });
  } catch (error) {
    return reject(errorMessage(error));
  }
  const appliedEvent = (
    summary: string,
    resultRevision: number,
    trackId?: string,
  ): Extract<AgentEvent, { type: "tool-applied" }> => ({
    type: "tool-applied",
    callId: call.id,
    name: call.name,
    summary,
    baseRevision: snapshot.revision,
    resultRevision,
    ...(trackId ? { trackId } : {}),
  });
  if (plan.kind === "explain") {
    return {
      ok: true,
      mutated: false,
      explanation: plan.text,
      content: JSON.stringify({ ok: true, shown: true }),
      event: appliedEvent(plan.summary, snapshot.revision),
    };
  }
  if (plan.kind === "transport") {
    if (!context.host.transport) return reject("transport is unavailable");
    try {
      await context.host.transport(plan.action);
    } catch (error) {
      return reject(errorMessage(error));
    }
    return {
      ok: true,
      mutated: false,
      content: JSON.stringify({ ok: true, transport: plan.action }),
      event: appliedEvent(plan.summary, context.host.snapshot().revision),
    };
  }
  let next = snapshot.score;
  const operations: ScoreOperation[] = [];
  try {
    for (const candidate of plan.operations) {
      const operation = validateAgentOperation(candidate);
      next = applyScoreOperation(next, operation);
      operations.push(operation);
    }
  } catch (error) {
    return reject(`rejected by score validation: ${errorMessage(error)}`);
  }
  if (next === snapshot.score)
    return {
      ok: true,
      mutated: false,
      content: JSON.stringify({
        ok: true,
        summary: "no change",
        revision: snapshot.revision,
      }),
      event: appliedEvent("no change", snapshot.revision, plan.trackId),
    };
  try {
    const { revision } = await context.host.commit({
      next,
      operations,
      baseRevision: snapshot.revision,
      toolName: call.name,
      callId: call.id,
      summary: plan.summary,
    });
    return {
      ok: true,
      mutated: true,
      content: JSON.stringify({ ok: true, summary: plan.summary, revision }),
      event: appliedEvent(plan.summary, revision, plan.trackId),
    };
  } catch (error) {
    if (error instanceof StaleRevisionError)
      return reject(`stale revision: ${error.message}`);
    return reject(`commit failed: ${errorMessage(error)}`);
  }
}

export class AgentTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`agent turn timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export function classifyAgentError(
  error: unknown,
  signal: AbortSignal,
  userSignal: AbortSignal | undefined,
): { code: AgentErrorCode; message: string } {
  if (userSignal?.aborted) return { code: "aborted", message: "cancelled" };
  if (
    error instanceof AgentTimeoutError ||
    signal.reason instanceof AgentTimeoutError
  )
    return {
      code: "timeout",
      message:
        error instanceof AgentTimeoutError
          ? error.message
          : (signal.reason as AgentTimeoutError).message,
    };
  if (error instanceof SseBudgetError)
    return { code: "budget", message: error.message };
  if (error instanceof GatewayError)
    return { code: "provider", message: error.message };
  // XcbError (src/agent/xcb.ts); matched by name to keep this module provider-neutral.
  if (error instanceof Error && error.name === "XcbError")
    return { code: "provider", message: errorMessage(error) };
  if (error instanceof Error && error.name === "AbortError")
    return { code: "aborted", message: "cancelled" };
  return { code: "internal", message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export function tighten(value: number | undefined, ceiling: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, ceiling)
    : ceiling;
}

/** Collapse agent events into one short activity line for the status bar. */
export function describeAgentEvent(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "step":
      return event.step === 1 ? "thinking…" : `thinking… step ${event.step}`;
    case "text-delta":
      return undefined;
    case "tool-start":
      return `${event.name.replace(/_/g, " ")}…`;
    case "tool-applied":
      return `✓ ${event.summary}`;
    case "tool-rejected":
      return `✗ ${event.name}: ${event.diagnostic}`;
    case "done":
      return (
        event.text.split("\n")[0]?.slice(0, 160) ||
        (event.applied > 0
          ? `applied ${event.applied} change${event.applied === 1 ? "" : "s"}`
          : "agent made no changes")
      );
    case "error":
      return event.code === "aborted"
        ? `cancelled · kept rev ${event.revision}`
        : `agent ${event.code}: ${event.message}`;
  }
}
