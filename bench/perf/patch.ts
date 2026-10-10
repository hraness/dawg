/** Patch-runner micro-benchmark rows (ns per voice-sample). */
import { patchRun } from "./patch-kernel.ts";
import { metric, type Metric } from "./stats.ts";

export function patch(runs = 5): Metric[] {
  return [
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
