import { compositionBrief } from "./brief.ts";
import {
  AGENT_LIMITS,
  AgentTimeoutError,
  classifyAgentError,
  executeCall,
  tighten,
  type AgentBudget,
  type AgentEvent,
  type AgentHost,
  type AgentTurnResult,
} from "./agent.ts";
import { AGENT_TOOLS, type AgentTool } from "./tools.ts";
import { parseTextReply, XcbError, type TextReply } from "./xcb.ts";
import { SseBudgetError } from "./sse.ts";

/** Steps per xcb turn. Each step is one full model call, so keep it small. */
export const XCB_MAX_STEPS = 3;
const MAX_PROMPT_CHARS = 8_000;
const MAX_FEEDBACK_CHARS = 6_000;

/** One text-in/text-out model call; `generate` must honour `signal`. */
export type TextGenerate = (
  prompt: string,
  options: { signal: AbortSignal; timeoutMs: number; maxOutputBytes: number },
) => Promise<string>;

export type TextAgentTurnOptions = Readonly<{
  prompt: string;
  generate: TextGenerate;
  host: AgentHost;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  budget?: AgentBudget;
  tools?: readonly AgentTool[];
  newNoteId?: (trackId: string, revision: number, index: number) => string;
}>;

export const TEXT_AGENT_SYSTEM_PROMPT = [
  "You are Track, a loop composer inside a terminal music workstation.",
  "You edit the score by returning operations. Each op is validated and applied immediately, in order, as its own revision.",
  "Times are in beats from the loop start (0-based). Keep notes inside loopBeats unless you extend the loop first.",
  "Prefer a few well-formed ops (one add_notes op per track part) over many tiny ones.",
  'For drums, create a track with instrument "kit" and use add_drums; drum pitches select voices, so do not use add_notes for beats.',
  'Reply with exactly one JSON object and nothing else, shaped {"ops":[{"tool":"<tool name>","args":{...}}],"say":"<one short sentence describing the musical change>","done":true}.',
  'Set "done":false only if you need to see the results of these ops before continuing; you will then get each op\'s result and can send more ops.',
  "If an op was rejected, read its diagnostic and either send a corrected op or stop with done:true.",
].join(" ");

/** Render the tool registry as a compact op catalog for a text-only model. */
export function renderToolCatalog(
  tools: readonly AgentTool[] = AGENT_TOOLS,
): string {
  return tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}\n  args schema: ${JSON.stringify(tool.parameters)}`,
    )
    .join("\n");
}

/**
 * A tool loop for providers without tool calling (xcb). The model returns one
 * JSON object of ops; each op goes through the same tool argument checks,
 * operation validator, reducer dry run and per-op commit as the gateway path.
 * Rejected ops or `done:false` trigger another call with diagnostics, up to
 * `XCB_MAX_STEPS` calls and the usual turn budgets.
 */
export async function runTextAgentTurn(
  options: TextAgentTurnOptions,
): Promise<AgentTurnResult> {
  const limits = {
    maxSteps: Math.min(
      XCB_MAX_STEPS,
      tighten(options.budget?.maxSteps, AGENT_LIMITS.maxSteps),
    ),
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
  const catalog = renderToolCatalog(tools);
  const nonce = Math.random().toString(36).slice(2, 6);
  const newNoteId =
    options.newNoteId ??
    ((trackId: string, revision: number, index: number) =>
      `${trackId.slice(0, 40)}-${revision}-${nonce}${index}`);
  const startedAt = Date.now();
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
  const steering: string[] = [];
  let feedback = "";
  const currentRevision = () => options.host.snapshot().revision;
  const finish = (result: AgentTurnResult): AgentTurnResult => {
    clearTimeout(timer);
    emit(result);
    return result;
  };
  const done = (reason: "stop" | "max-steps" | "max-tool-calls") =>
    finish({
      type: "done",
      reason,
      text: finalText,
      applied,
      rejected,
      revision: currentRevision(),
    });

  try {
    for (let step = 1; step <= limits.maxSteps; step += 1) {
      if (signal.aborted) throw signal.reason;
      for (const steer of options.host.takeSteering?.() ?? [])
        steering.push(steer.slice(0, 2_000));
      emit({ type: "step", step });
      const remainingBytes = limits.maxResponseBytes - bytesUsed;
      if (remainingBytes <= 0)
        throw new SseBudgetError(limits.maxResponseBytes);
      const prompt = [
        TEXT_AGENT_SYSTEM_PROMPT,
        `Tools:\n${catalog}`,
        `Composition brief (JSON): ${compositionBrief(options.host.snapshot())}`,
        `User request: ${options.prompt.slice(0, MAX_PROMPT_CHARS)}`,
        ...steering.map((text) => `Steering from the user mid-turn: ${text}`),
        feedback
          ? `Results of your previous ops (the brief above already reflects accepted ones):\n${feedback}`
          : "",
        "Reply now with the single JSON object.",
      ]
        .filter(Boolean)
        .join("\n\n");
      const remainingMs = limits.timeoutMs - (Date.now() - startedAt);
      const reply = await options.generate(prompt, {
        signal,
        timeoutMs: Math.max(1_000, remainingMs),
        maxOutputBytes: Math.min(remainingBytes, 64 * 1024),
      });
      if (signal.aborted) throw signal.reason;
      bytesUsed += reply.length;

      let parsed: TextReply;
      try {
        parsed = parseTextReply(reply);
      } catch (error) {
        const diagnostic =
          error instanceof XcbError
            ? error.message
            : "reply could not be parsed";
        rejected += 1;
        emit({
          type: "tool-rejected",
          callId: `xcb-${step}-reply`,
          name: "reply",
          diagnostic,
        });
        feedback = `Your reply was rejected: ${diagnostic}. Reply with exactly one JSON object.`;
        continue;
      }
      if (parsed.say) {
        finalText = parsed.say;
        emit({ type: "text-delta", delta: parsed.say });
      }
      const results: string[] = [];
      let stepRejected = 0;
      let overBudget = false;
      for (const [index, op] of parsed.ops.entries()) {
        if (signal.aborted) throw signal.reason;
        const callId = `xcb-${step}-${index}`;
        if (toolCalls >= limits.maxToolCalls) {
          overBudget = true;
          rejected += 1;
          stepRejected += 1;
          emit({
            type: "tool-rejected",
            callId,
            name: op.tool,
            diagnostic: "tool call budget exhausted",
          });
          continue;
        }
        toolCalls += 1;
        emit({ type: "tool-start", callId, name: op.tool, step });
        const outcome = await executeCall(
          { id: callId, name: op.tool, arguments: JSON.stringify(op.args) },
          { tools, host: options.host, newNoteId },
        );
        if (outcome.ok) {
          applied += outcome.mutated ? 1 : 0;
          if (outcome.explanation) finalText = outcome.explanation;
          emit(outcome.event);
        } else {
          rejected += 1;
          stepRejected += 1;
          emit({
            type: "tool-rejected",
            callId,
            name: op.tool,
            diagnostic: outcome.diagnostic,
          });
        }
        results.push(`ops[${index}] ${op.tool}: ${outcome.content}`);
      }
      if (overBudget || toolCalls >= limits.maxToolCalls)
        return done("max-tool-calls");
      if (stepRejected === 0 && parsed.done) return done("stop");
      feedback =
        results.join("\n").slice(0, MAX_FEEDBACK_CHARS) || "No ops were sent.";
    }
    return done("max-steps");
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
