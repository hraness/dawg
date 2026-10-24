/**
 * Perform the gold charts (or one by title) and judge them against the
 * demos' craft: distinct bars, voice-leading, clashes, expression, intro and
 * section lengths. With --out, each score is written as JSON for rendering.
 *   bun scripts/chart.ts [--out DIR] ["Paper Comet" ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judge } from "../core/distill/hyperpop/chart/critic.ts";
import { GOLD } from "../core/distill/hyperpop/chart/gold/index.ts";
import { performChart } from "../core/distill/hyperpop/chart/perform.ts";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const out = outAt >= 0 ? argv[outAt + 1] : undefined;
const titles = argv.filter((a, i) => i !== outAt && i !== outAt + 1);
const charts = titles.length
  ? GOLD.filter((c) =>
      titles.some((t) => c.title.toLowerCase() === t.toLowerCase()),
    )
  : GOLD;
if (!charts.length) {
  console.error(
    `no chart named ${titles.join(", ")}; gold: ${GOLD.map((c) => c.title).join(", ")}`,
  );
  process.exit(1);
}
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
for (const chart of charts) {
  const performed = performChart(chart);
  const data = performed.score.toJSON();
  const { craft, problems } = judge(data);
  console.log(
    `${chart.title}: ${performed.notes[0]}, ${data.notes.length} notes`,
  );
  console.log(
    `  distinct ${Math.round(craft.distinctBars * 100)}% · voice-leading ${craft.voiceLeading.toFixed(2)} · clashes ${Math.round(craft.clashes * 100)}% · expression ${craft.expressivePerSung.toFixed(2)} a sung note`,
  );
  for (const p of problems) console.log(`  ✗ ${p}`);
  failed += problems.length ? 1 : 0;
  if (out) {
    const file = join(
      out,
      `${chart.title.toLowerCase().replace(/\W+/g, "-")}.json`,
    );
    writeFileSync(file, JSON.stringify(data));
    console.log(`  ${file}`);
  }
}
process.exit(failed ? 1 : 0);
