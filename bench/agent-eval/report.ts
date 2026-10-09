/**
 * Merges result files from several `cli.ts` invocations (the full ladder,
 * extra latency reps, a sample of an expensive model) into one results
 * file and prints the markdown table used in docs/model-eval.md.
 *
 *   bun bench/agent-eval/report.ts --out bench/agent-eval/results/2026-10.json a.json b.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { summarize, type ModelSummary, type RunRecord } from "./summary.ts";

type ResultFile = Readonly<{
  provider?: string;
  date?: string;
  spentUsd?: number;
  records: RunRecord[];
}>;

/**
 * One markdown row per model, best task-weighted pass rate first, then
 * fastest.
 */
export function markdownTable(summaries: readonly ModelSummary[]): string {
  const sec = (ms: number | null) =>
    ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
  const pct = (v: number | undefined) =>
    v === undefined ? "–" : `${Math.round(v * 100)}%`;
  const rows = [...summaries].sort(
    (a, b) => b.taskPassRate - a.taskPassRate || a.p50TurnMs - b.p50TurnMs,
  );
  return [
    "| model | pass | single | compose | files | multi | recovery | p50 turn | p95 turn | p50 first token | steps | calls | $/task | runs |",
    "| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
    ...rows.map(
      (s) =>
        `| ${s.model} | ${pct(s.taskPassRate)} | ${pct(s.tiers.single)} | ${pct(s.tiers.compose)} | ${pct(s.tiers.files)} | ${pct(s.tiers.multi)} | ${pct(s.tiers.recovery)} | ${sec(s.p50TurnMs)} | ${sec(s.p95TurnMs)} | ${sec(s.p50FirstTokenMs)} | ${s.meanSteps.toFixed(1)} | ${s.meanToolCalls.toFixed(1)} | $${s.costPerTaskUsd.toFixed(4)} | ${s.runs} |`,
    ),
  ].join("\n");
}

/** Merges the records of several result files and summarizes per model. */
export function merge(files: readonly ResultFile[]): {
  records: RunRecord[];
  summaries: ModelSummary[];
} {
  const records = files.flatMap((f) => f.records);
  const models = [...new Set(records.map((r) => r.model))];
  return {
    records,
    summaries: models.map((m) =>
      summarize(
        m,
        records.filter((r) => r.model === m),
      ),
    ),
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { out: { type: "string" } },
    allowPositionals: true,
  });
  const files: ResultFile[] = await Promise.all(
    positionals.map(
      async (p) => JSON.parse(await readFile(p, "utf8")) as ResultFile,
    ),
  );
  const { records, summaries } = merge(files);
  // What these records cost; a file's own spentUsd also carries `--spent`
  // offsets from other invocations, so it cannot be summed or maxed.
  const costUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(
      values.out,
      `${JSON.stringify({ provider: files[0]?.provider, dates: files.map((f) => f.date), costUsd, summaries, records }, null, 1)}\n`,
    );
  }
  console.log(markdownTable(summaries));
  console.error(`${records.length} runs · $${costUsd.toFixed(2)}`);
}
