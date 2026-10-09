/**
 * Re-grades a results file offline: replays each record's transcript through
 * the current agent loop, host and grader, keeps the live latency, token and
 * cost numbers, and prints every verdict that changed. Use it after fixing a
 * grader so published numbers never come from a grader that is gone.
 *
 *   bun bench/agent-eval/regrade.ts --results r.json --transcripts dir --out r2.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { replayClient, type RecordedRequest } from "./client.ts";
import { runTask } from "./run.ts";
import { summarize, type RunRecord } from "./summary.ts";
import { TASKS } from "./tasks.ts";

export function transcriptPath(dir: string, record: RunRecord): string {
  return join(
    dir,
    record.model.replace(/\//g, "__"),
    `${record.run.id}.r${record.rep}.json`,
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      results: { type: "string" },
      transcripts: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.results || !values.transcripts || !values.out)
    throw new Error("usage: --results FILE --transcripts DIR --out FILE");
  const data = JSON.parse(await readFile(values.results, "utf8")) as {
    records: RunRecord[];
    summaries: unknown;
  } & Record<string, unknown>;
  const records: RunRecord[] = [];
  let flips = 0;
  for (const record of data.records) {
    const task = TASKS.find((t) => t.id === record.run.id);
    if (!task || record.run.error) {
      records.push(record);
      continue;
    }
    const transcript = JSON.parse(
      await readFile(transcriptPath(values.transcripts, record), "utf8"),
    ) as { requests: RecordedRequest[] };
    const replayed = await runTask(task, {
      client: replayClient(transcript.requests),
      model: record.model,
    });
    if (replayed.pass !== record.run.pass) {
      flips++;
      console.error(
        `${record.model} ${record.run.id} r${record.rep}: ${record.run.pass ? "pass" : "fail"} -> ${replayed.pass ? "pass" : "fail"}`,
      );
    }
    records.push({
      ...record,
      run: { ...record.run, pass: replayed.pass, checks: replayed.checks },
    });
  }
  const models = [...new Set(records.map((r) => r.model))];
  const summaries = models.map((model) =>
    summarize(
      model,
      records.filter((r) => r.model === model),
    ),
  );
  await writeFile(
    values.out,
    `${JSON.stringify({ ...data, summaries, records }, null, 1)}\n`,
  );
  console.error(`${records.length} records, ${flips} changed`);
}
