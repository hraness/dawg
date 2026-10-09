/**
 * Live agent eval: runs the task set against real models through dawg's
 * resolved provider (AI Gateway or OpenRouter), grades with code, records
 * every model response as a transcript, and writes a results JSON.
 *
 *   bun bench/agent-eval/cli.ts --models anthropic/claude-haiku-4.5,openai/gpt-6-luna \
 *     --reps 1 --tasks all --concurrency 6 --cap 20 --out bench/agent-eval/results/run.json
 *
 * `--cap` is a hard USD limit across the whole invocation (`--spent` adds
 * money already spent by earlier invocations). No task starts once the
 * estimate reaches it. Keys are never printed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  isApiSelection,
  apiClient,
  selectProvider,
} from "../../src/agent/provider.ts";
import { recordingClient, type RecordedRequest } from "./client.ts";
import { costOf, fetchPricing, type Pricing } from "./pricing.ts";
import { runTask, type TaskRun } from "./run.ts";
import { summarize, type ModelSummary, type RunRecord } from "./summary.ts";
import { TASKS, type EvalTask } from "./tasks.ts";

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    reps: { type: "string", default: "1" },
    tasks: { type: "string", default: "all" },
    concurrency: { type: "string", default: "6" },
    cap: { type: "string", default: "20" },
    spent: { type: "string", default: "0" },
    out: { type: "string" },
    transcripts: { type: "string" },
    "max-steps": { type: "string" },
  },
});

if (!values.models || !values.out) {
  console.error(
    "usage: --models a,b --out results.json [--reps n] [--tasks all|tier|id,id] [--cap usd]",
  );
  process.exit(2);
}

const models = values.models
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const reps = Math.max(1, Number(values.reps));
const concurrency = Math.max(1, Number(values.concurrency));
const cap = Number(values.cap);
let spent = Number(values.spent);

function pickTasks(spec: string): EvalTask[] {
  if (spec === "all") return [...TASKS];
  const parts = new Set(spec.split(","));
  return TASKS.filter((t) => parts.has(t.id) || parts.has(t.tier));
}
const tasks = pickTasks(values.tasks!);
if (tasks.length === 0) throw new Error(`no tasks match ${values.tasks}`);

const selection = await selectProvider();
if (!isApiSelection(selection))
  throw new Error(
    `the eval needs a key-based provider; resolved ${selection.kind}`,
  );
const pricing: Map<string, Pricing> = await fetchPricing(selection);
for (const model of models)
  if (!pricing.has(model))
    throw new Error(`${selection.kind} does not list ${model}`);
const inner = apiClient(selection);
console.error(
  `provider ${selection.kind} · ${tasks.length} tasks × ${reps} reps × ${models.length} models · cap $${cap}`,
);

const records: RunRecord[] = [];
let capped = false;
type Job = { model: string; task: EvalTask; rep: number };
const jobs: Job[] = [];
for (let rep = 1; rep <= reps; rep += 1)
  for (const task of tasks)
    for (const model of models) jobs.push({ model, task, rep });

async function runJob(job: Job): Promise<void> {
  const client = recordingClient(inner, job.model);
  let run: TaskRun;
  try {
    run = await runTask(job.task, {
      client,
      model: job.model,
      ...(values["max-steps"]
        ? { budget: { maxSteps: Number(values["max-steps"]) } }
        : {}),
    });
  } catch (error) {
    run = {
      id: job.task.id,
      tier: job.task.tier,
      pass: false,
      checks: [],
      turns: client.stats.requests,
      toolCalls: 0,
      rejected: 0,
      calls: [],
      end: "harness-error",
      text: "",
      wallMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const cost = costOf(pricing.get(job.model)!, client.stats);
  spent += cost;
  const record: RunRecord = {
    model: job.model,
    rep: job.rep,
    run: { ...run, calls: run.calls, text: run.text.slice(0, 400) },
    stats: { ...client.stats },
    modelMs: client.recorded.reduce((sum, r) => sum + r.totalMs, 0),
    costUsd: cost,
  };
  records.push(record);
  if (values.transcripts)
    await saveTranscript(values.transcripts, job, client.recorded, run);
  const failed = run.checks.filter((c) => !c.ok).map((c) => c.name);
  console.error(
    `${run.pass ? "PASS" : "FAIL"} ${job.model} ${job.task.id} r${job.rep} · ${run.turns} steps ${run.toolCalls} calls · ${(run.wallMs / 1000).toFixed(1)}s · $${cost.toFixed(4)} (total $${spent.toFixed(2)})${failed.length ? ` · ${failed.join("; ").slice(0, 160)}` : ""}${run.error ? ` · ${run.error.slice(0, 160)}` : ""}`,
  );
}

async function saveTranscript(
  dir: string,
  job: Job,
  recorded: readonly RecordedRequest[],
  run: TaskRun,
): Promise<void> {
  const path = join(
    dir,
    job.model.replace(/\//g, "__"),
    `${job.task.id}.r${job.rep}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ model: job.model, task: job.task.id, pass: run.pass, requests: recorded })}\n`,
  );
}

let next = 0;
async function worker(): Promise<void> {
  while (next < jobs.length) {
    if (spent >= cap) {
      capped = true;
      return;
    }
    const job = jobs[next++]!;
    await runJob(job);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const summaries: ModelSummary[] = models.map((model) =>
  summarize(
    model,
    records.filter((r) => r.model === model),
  ),
);
await mkdir(dirname(values.out), { recursive: true });
await writeFile(
  values.out,
  `${JSON.stringify(
    {
      provider: selection.kind,
      date: new Date().toISOString(),
      tasks: tasks.map((t) => t.id),
      reps,
      capUsd: cap,
      spentUsd: spent,
      capped,
      summaries,
      records,
    },
    null,
    1,
  )}\n`,
);
for (const s of summaries)
  console.error(
    `${s.model}: pass ${(s.passRate * 100).toFixed(0)}% (${s.passed}/${s.runs}) · p50 turn ${(s.p50TurnMs / 1000).toFixed(1)}s · p50 first token ${s.p50FirstTokenMs === null ? "-" : (s.p50FirstTokenMs / 1000).toFixed(2) + "s"} · $${s.costUsd.toFixed(3)}`,
  );
console.error(`spent $${spent.toFixed(2)}${capped ? " · CAP REACHED" : ""}`);
