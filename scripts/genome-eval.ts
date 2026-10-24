/**
 * How varied are generated songs? Compose N seeds (or N cards per brief from
 * the local model with --model) and report the pairwise spread, the closest
 * pair, and how far each song sits from the nearest demo. The three demos'
 * own spread is the yardstick; classic sheets land within a few hundredths
 * of a demo, which is the template problem this measures.
 *   bun scripts/genome-eval.ts [--n 12] [--seed 1] [--out DIR] [--model] ["brief" ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDemo, DEMOS } from "../core/demos/index.ts";
import {
  compileGenome,
  describeGenome,
  distance,
  fingerprint,
  generateGenomeSong,
  sampleGenome,
  spread,
  type GenSong,
} from "../core/distill/hyperpop/genome/index.ts";

import {
  findLocalModel,
  isLocalModel,
  localComplete,
  stopLocalServers,
} from "../src/agent/local.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const useModel = argv.includes("--model");
if (useModel) argv.splice(argv.indexOf("--model"), 1);
const n = Number(flag("n") ?? 12);
const first = Number(flag("seed") ?? 1);
const out = flag("out");
if (out) mkdirSync(out, { recursive: true });

const songs: GenSong[] = [];
if (useModel) {
  const model = findLocalModel();
  if (!isLocalModel(model)) throw new Error(model.reason);
  const briefs = argv.length
    ? argv
    : ["a euphoric late-night rave song about running every red light"];
  for (const brief of briefs)
    for (let i = 0; i < n; i++) {
      const started = Date.now();
      const song = await generateGenomeSong(
        brief,
        (chat, schema) =>
          localComplete(model, {
            messages: chat,
            schema,
            temperature: 0.9,
            maxTokens: 2_000,
          }),
        { seed: first + i },
      );
      console.log(
        `"${song.title}" seed ${song.seed} · ${((Date.now() - started) / 1000).toFixed(0)} s · hook "${song.card.hook}"`,
      );
      songs.push(song);
    }
  stopLocalServers();
} else
  for (let i = 0; i < n; i++)
    songs.push(compileGenome(sampleGenome(first + i)));

const demos = DEMOS.map((d) => fingerprint(createDemo(d.id)));
const prints = songs.map((s) => fingerprint(s.score));
for (const [i, song] of songs.entries()) {
  const near = demos.map((d) => distance(prints[i]!, d));
  const which = near.indexOf(Math.min(...near));
  console.log(
    `${i + 1}. "${song.title}" · ${song.score.bars} bars · nearest demo ${DEMOS[which]!.id} ${near[which]!.toFixed(2)}\n   ${describeGenome(song.genome).join("\n   ")}`,
  );
  if (out)
    writeFileSync(
      join(out, `${i + 1}.track.json`),
      JSON.stringify(song.score.toJSON()),
    );
}
const s = spread(prints);
const d = spread(demos);
const nearest = prints.map((p) =>
  Math.min(...demos.map((x) => distance(p, x))),
);
console.log(
  `\nspread ${s.mean.toFixed(3)} (demos ${d.mean.toFixed(3)}) · closest pair ${s.min.toFixed(3)} (${s.closest.map((x) => x + 1).join(" & ")}) · nearest demo mean ${(nearest.reduce((a, b) => a + b, 0) / nearest.length).toFixed(3)}, min ${Math.min(...nearest).toFixed(3)}`,
);
