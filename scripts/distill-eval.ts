/**
 * Run hyperpop briefs through a model and report how the distilled sheet
 * holds up: valid rounds, critic score, time. Uses the local model unless
 * DAWG_LOCAL_BASE_URL points elsewhere.
 *   bun scripts/distill-eval.ts [--out DIR] [--rounds N] ["brief" ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSong } from "../core/distill/hyperpop/index.ts";
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
const out = flag("out");
const rounds = Number(flag("rounds") ?? 3);
const briefs = argv.length
  ? argv
  : [
      "a euphoric late-night rave song about running every red light, in D minor",
      "a sparkly, sweet summer crush song, bright and bouncy",
      "an icy, glitchy song about a phone dying at a party, in G minor",
    ];
const model = findLocalModel();
if (!isLocalModel(model)) throw new Error(model.reason);
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
for (const [i, brief] of briefs.entries()) {
  const started = Date.now();
  try {
    const song = await generateSong(
      brief,
      (chat, schema) =>
        localComplete(model, {
          messages: chat,
          schema,
          temperature: 0.8,
          maxTokens: 12_000,
        }),
      {
        rounds,
        onRound: (r) =>
          console.log(
            `  round ${r.round}: ${r.ok ? `valid, critic ${r.score}` : "invalid"} in ${(r.ms / 1000).toFixed(1)} s${r.notes.length ? `\n    - ${r.notes.slice(0, 6).join("\n    - ")}` : ""}`,
          ),
      },
    );
    console.log(
      `${i + 1}. "${song.sheet.title}" ${song.sheet.key} ${song.sheet.bpm} bpm ${song.sheet.palette}: critic ${song.critic}, ${song.score.bars} bars, ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
    if (out) {
      writeFileSync(
        join(out, `${i + 1}.sheet.json`),
        JSON.stringify(song.sheet, null, 2),
      );
      writeFileSync(
        join(out, `${i + 1}.track.json`),
        JSON.stringify(song.score.toJSON()),
      );
    }
  } catch (error) {
    failed++;
    console.log(`${i + 1}. FAILED: ${(error as Error).message}`);
  }
}
stopLocalServers();
process.exit(failed > 0 ? 1 : 0);
