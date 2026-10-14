/** Dense whole-song undo/redo: canonical score equivalence is checked on every replay. */
import { createHash } from "node:crypto";
import { createDemo } from "../../core/demos/index.ts";
import { diffScores } from "../../core/diff.ts";
import {
  applyScoreOperation,
  applyScoreOperations,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { paneHistoryStep } from "../../src/commands/history.ts";
import { diffRewind } from "../../src/session/delta.ts";
import { rebaseOperations } from "../../src/session/rebase.ts";
import { arrangementFixture } from "../../test/arrangement-fixture.ts";
import { metric, table, type Metric } from "./stats.ts";

const digest = (score: TrackScore) =>
  createHash("sha256").update(JSON.stringify(score.toJSON())).digest("hex");
export function historyReplay(runs = 5, sequential = false): Metric[] {
  const empty = createScore({
    tracks: [{ id: "main", name: "main", instrument: "sine" }],
  });
  const results: Metric[] = [];
  for (const [id, target] of [
    ["signal-bloom", createDemo("signal-bloom")],
    ["dense-32x24", arrangementFixture(32, 24)],
  ] as const) {
    const operations = diffScores(empty, target);
    const expected = digest(target);
    const events = [
      {
        revision: 1,
        kind: "demo.load",
        rewind: diffRewind(empty.toJSON(), target.toJSON()),
        actor: { clientId: "bench" },
      },
      {
        revision: 2,
        kind: "score.undo",
        payload: { undoneRevision: 1 },
        rewind: diffRewind(target.toJSON(), empty.toJSON()),
        actor: { clientId: "bench" },
      },
    ];
    const runners: [string, () => TrackScore][] = [
      ["batch", () => applyScoreOperations(empty, operations)],
      [
        "rebase",
        () => {
          const result = rebaseOperations(empty, empty, operations);
          if (!result.ok) throw new Error(result.reason);
          return result.next;
        },
      ],
      [
        "redo",
        () => {
          const result = paneHistoryStep(
            empty.toJSON(),
            events,
            "redo",
            "bench",
          );
          if (!result?.ok) throw new Error("redo failed");
          return result.next;
        },
      ],
      ...(sequential
        ? [
            [
              "sequential",
              () => operations.reduce(applyScoreOperation, empty),
            ] as [string, () => TrackScore],
          ]
        : []),
    ];
    for (const [method, run] of runners) {
      const samples: number[] = [];
      for (let i = 0; i < runs; i += 1) {
        const started = performance.now();
        const next = run();
        samples.push(performance.now() - started);
        if (digest(next) !== expected)
          throw new Error(`${id}.${method}: score digest differs`);
      }
      results.push(
        metric(
          `history.${id}.${method}`,
          `${id}, ${target.notes.length} notes: ${method}`,
          samples,
        ),
      );
    }
  }
  return results;
}
if (import.meta.main)
  console.log(table(historyReplay(3, process.argv.includes("--sequential"))));
