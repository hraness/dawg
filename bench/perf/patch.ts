/** Patch-runner micro-benchmark rows (ns per voice-sample). */
import { patchRun } from "./patch-kernel.ts";
import { patchRunner } from "./patch-runner.ts";
import { metric, type Metric } from "./stats.ts";

export function patch(runs = 5): Metric[] {
  return [
    metric(
      "patch.runner",
      "patch runner, src/audio/patch (16 voices x 12 nodes, 48 kHz)",
      patchRunner(runs),
      "ns",
    ),
    metric(
      "patch.runner.interp",
      "patch runner, reference interpreter (fuse: false)",
      patchRunner(runs, false),
      "ns",
    ),
    metric(
      "patch.interp",
      "patch runner, flat interpreter (16 voices x 12 nodes, 48 kHz)",
      patchRun("interp", runs),
      "ns",
    ),
    metric(
      "patch.fused",
      "patch runner, fused voice loop",
      patchRun("fused", runs),
      "ns",
    ),
  ];
}

if (import.meta.main) {
  const { table } = await import("./stats.ts");
  console.log(table(patch()));
}
