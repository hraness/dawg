/**
 * Runs one eval task: builds the temp project, drives dawg's real agent
 * loop (`runAgentTurn` with every agent tool) against it, re-evaluates the
 * printed project files, and grades the final score with code.
 */
import { evaluateProject } from "../../core/sdk/eval.ts";
import { encodeLoop } from "../../core/loop.ts";
import {
  runAgentTurn,
  type AgentBudget,
  type AgentEvent,
} from "../../src/agent/agent.ts";
import type { GatewayClient } from "../../src/agent/gateway.ts";
import type { TrackScore } from "../../core/score.ts";
import type { Check, GradeContext, ToolCallRecord } from "./grade.ts";
import { createEvalHost } from "./host.ts";
import type { EvalTask } from "./tasks.ts";

/**
 * The encoded score with note ids dropped and notes sorted: evaluating the
 * files mints content-hash note ids, so only the music has to match.
 */
export function musicKey(score: TrackScore): string {
  const loop = JSON.parse(encodeLoop(score)) as Record<string, unknown>;
  const notes = (loop.notes as Array<Record<string, unknown>>)
    .map(({ id: _id, ...rest }) => JSON.stringify(rest))
    .sort();
  return JSON.stringify({ ...loop, notes });
}

const sameMusic = (a: TrackScore, b: TrackScore) => musicKey(a) === musicKey(b);

export type TaskRun = Readonly<{
  id: string;
  tier: string;
  pass: boolean;
  checks: readonly Check[];
  /** Model requests in the turn (agent steps). */
  turns: number;
  toolCalls: number;
  rejected: number;
  calls: readonly ToolCallRecord[];
  end: string;
  text: string;
  wallMs: number;
  error?: string;
}>;

export type RunTaskOptions = Readonly<{
  client: GatewayClient;
  model: string;
  budget?: AgentBudget;
  /** Run tsc on workspace writes (the live run does; replays may skip). */
  typecheck?: boolean;
}>;

/** Deterministic note ids so replays and graders never see a random nonce. */
const noteId = (trackId: string, revision: number, index: number) =>
  `${trackId.slice(0, 40)}-${revision}-e${index}`;

export async function runTask(
  task: EvalTask,
  options: RunTaskOptions,
): Promise<TaskRun> {
  const initial = task.setup();
  const env = await createEvalHost({
    score: initial.score,
    focusedTrackId: initial.focus,
    typecheck: options.typecheck ?? true,
  });
  const calls: ToolCallRecord[] = [];
  let turns = 0;
  const started = performance.now();
  const onEvent = (event: AgentEvent) => {
    if (event.type === "step") turns = event.step;
    else if (event.type === "tool-applied")
      calls.push({
        name: event.name,
        outcome:
          event.resultRevision === event.baseRevision ? "read" : "applied",
      });
    else if (event.type === "tool-rejected")
      calls.push({ name: event.name, outcome: "rejected" });
  };
  try {
    const result = await runAgentTurn({
      prompt: task.prompt,
      model: options.model,
      client: options.client,
      host: env.host,
      onEvent,
      newNoteId: noteId,
      ...(options.budget ? { budget: options.budget } : {}),
    });
    const wallMs = performance.now() - started;
    const evaluated = await evaluateProject(env.root);
    const files = evaluated.ok
      ? sameMusic(evaluated.score, env.score())
        ? { ok: true, detail: "files evaluate to the session score" }
        : { ok: false, detail: "files evaluate to a different score" }
      : {
          ok: false,
          detail: evaluated.diagnostics
            .slice(0, 3)
            .map((d) => d.message)
            .join("; "),
        };
    const ctx: GradeContext = {
      initial: initial.score,
      score: env.score(),
      text: result.type === "done" ? result.text : "",
      calls,
      files,
    };
    let checks: Check[];
    try {
      checks = [...task.grade(ctx)];
    } catch (error) {
      checks = [
        {
          name: "grader",
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        },
      ];
    }
    if (result.type === "error")
      checks.push({
        name: "turn completed",
        ok: false,
        detail: `${result.code}: ${result.message}`,
      });
    return {
      id: task.id,
      tier: task.tier,
      pass: checks.length > 0 && checks.every((c) => c.ok),
      checks,
      turns,
      toolCalls: calls.length,
      rejected: calls.filter((c) => c.outcome === "rejected").length,
      calls,
      end: result.type === "done" ? result.reason : result.code,
      text: result.type === "done" ? result.text : result.message,
      wallMs,
      ...(result.type === "error" ? { error: result.message } : {}),
    };
  } finally {
    await env.close();
  }
}
