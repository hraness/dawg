/**
 * `bun run bench:perf`: every felt-latency measurement, printed as one
 * markdown table and saved as JSON.
 *
 *   bun run bench:perf                 all groups
 *   bun run bench:perf -- render live  only these groups
 *   bun run bench:perf -- --quick      fewer samples (a smoke run)
 *   bun run bench:perf -- --out f.json write results there
 *
 * Groups: startup, keys, command, fader, sync, agent (the real TUI in a PTY,
 * audio to bench/perf/sink.ts), frame, render, live, patch (in-process).
 * Run it on a quiet machine; the PTY groups take a couple of minutes.
 */
import { writeFile } from "node:fs/promises";
import { frames } from "./frame.ts";
import { live } from "./live.ts";
import { patch } from "./patch.ts";
import * as pty from "./pty.ts";
import { render } from "./render.ts";
import { calibrate, table, type Metric } from "./stats.ts";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
const wanted = args.filter(
  (arg, index) => !arg.startsWith("--") && index !== outIndex + 1,
);
const n = (full: number, small: number) => (quick ? small : full);

const GROUPS: Record<string, () => Promise<Metric[]> | Metric[]> = {
  startup: () => pty.startup(n(10, 3)),
  keys: () => pty.keys(n(12, 4)),
  command: () => pty.command(n(10, 3)),
  fader: () => pty.fader(n(10, 3)),
  sync: () => pty.sync(n(10, 3)),
  agent: () => pty.agent(n(10, 3)),
  frame: () => frames(undefined, n(600, 200)),
  render: () => render(n(5, 2)),
  live: () => live(n(5, 2)),
  patch: () => patch(n(7, 3)),
};

const names = wanted.length > 0 ? wanted : Object.keys(GROUPS);
for (const name of names)
  if (!GROUPS[name]) throw new Error(`unknown group ${name}`);
const calibrationMs = calibrate();
const results: Metric[] = [];
for (const name of names) {
  const started = performance.now();
  const metrics = await GROUPS[name]!();
  results.push(...metrics);
  console.error(
    `${name}: ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}
console.log(table(results));
console.log(
  `\ncalibration ${calibrationMs.toFixed(2)} ms · bun ${Bun.version} · ${process.platform}-${process.arch}`,
);
if (out)
  await writeFile(
    out,
    `${JSON.stringify({ calibrationMs, bun: Bun.version, platform: `${process.platform}-${process.arch}`, results }, null, 2)}\n`,
  );
process.exit(0);
