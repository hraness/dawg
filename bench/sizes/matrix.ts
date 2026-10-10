/**
 * `bun run sizes`: the full terminal-size matrix (test/sizes-lib.ts) over
 * every scenario, printed as a table; `--out <file>` also writes markdown
 * notes and `--only a,b` picks scenarios.
 */
import { writeFile } from "node:fs/promises";
import {
  FULL_SIZES,
  SCENARIOS,
  runScenario,
  type Size,
  type SizeResult,
} from "../../test/sizes-lib.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flag("--only")?.split(",");
const out = flag("--out");
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.name));
// `--sizes 50x14,60x16`: probe other sizes (finding the minimum).
const sizes: readonly Size[] =
  flag("--sizes")
    ?.split(",")
    .map((pair) => pair.split("x").map(Number) as unknown as Size) ??
  FULL_SIZES;

const median = (values: number[]) => {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const all: SizeResult[] = [];
for (const scenario of scenarios) {
  const results = await runScenario(scenario, sizes).catch((error: unknown) => {
    console.log(
      `${scenario.name}: setup failed · ${String(error).split("\n")[0]}`,
    );
    return [] as SizeResult[];
  });
  for (const r of results) {
    const ms = Math.max(...r.frameMs, 0);
    console.log(
      `${scenario.name.padEnd(14)} ${`${r.size[0]}x${r.size[1]}`.padEnd(8)} ` +
        `${r.tooSmall ? "small " : "      "}max ${ms.toFixed(2).padStart(7)}ms ` +
        `edge ${String(r.edgeRows).padStart(3)} ${r.problems.join(", ")}`,
    );
  }
  all.push(...results);
}

if (out) {
  const sizes = [...new Set(all.map((r) => `${r.size[0]}x${r.size[1]}`))];
  let md = `# dawg terminal-size matrix\n\n${new Date().toISOString()}\n\n## Problems\n\n`;
  for (const r of all.filter((r) => r.problems.length))
    md += `- ${r.scenario} @ ${r.size[0]}x${r.size[1]}: ${r.problems.join(", ")}\n`;
  md += `\n## Frame time, median / max ms (compose + encode)\n\n| scenario | ${sizes.join(" | ")} |\n|---|${sizes.map(() => "---:").join("|")}|\n`;
  for (const scenario of scenarios) {
    const row = sizes.map((size) => {
      const r = all.find(
        (x) =>
          x.scenario === scenario.name && `${x.size[0]}x${x.size[1]}` === size,
      );
      return r && r.frameMs.length
        ? `${median(r.frameMs).toFixed(1)} / ${Math.max(...r.frameMs).toFixed(1)}`
        : "–";
    });
    md += `| ${scenario.name} | ${row.join(" | ")} |\n`;
  }
  md += `\n## Screens\n\n`;
  for (const r of all)
    md += `### ${r.scenario} @ ${r.size[0]}x${r.size[1]}\n\n\`\`\`\n${r.screen
      .split("\n")
      .slice(0, 60)
      .map((l) => l.slice(0, 200))
      .join("\n")}\n\`\`\`\n\n`;
  await writeFile(out, md);
}
process.exit(all.some((r) => r.problems.length) ? 1 : 0);
