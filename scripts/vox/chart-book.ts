/**
 * A chart's studio vocal book: every distinct sung line the performer
 * places, sung by Kokoro + WORLD (songs.py), plus a chop bank on the chart's
 * hook words and a held vowel.
 *
 * Usage: bun scripts/vox/chart-book.ts chart.json <out dir> [--voice af_heart]
 *        [--id slug-vox] [--formant 1] [--python .venv/bin/python]
 *
 * Writes <id>.wav, <id>.spec.json, and <id>.book.json: the VoxBank that
 * `performChart(chart, book)` takes, plus the `core/bundled-samples.ts` entry
 * (sha256 and slices) to register the sample under assets/samples/studio.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chartScale,
  repairChart,
  type Chart,
} from "../../core/distill/hyperpop/chart/format.ts";
import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1]! : fallback;
};
const [chartPath, outDir] = args;
if (!chartPath || !outDir) {
  console.error(
    "usage: chart-book.ts chart.json <out dir> [--voice v] [--id x]",
  );
  process.exit(2);
}
const chart = repairChart(JSON.parse(readFileSync(chartPath, "utf8")) as Chart);
const performed = performChart(chart);
const slug = chart.title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const id = flag("id", `${slug}-vox`);
const voice = flag("voice", "af_heart");
const python = flag("python", ".venv/bin/python");

// The books sing between F#4 and A5: the whole song moves by octaves so its
// middle note sits there, and the chops and the held vowel sit on the tonic.
const pitches = performed.phrases
  .flatMap((p) => p.notes.map((n) => n[1]))
  .sort((a, b) => a - b);
const middle = pitches[Math.floor(pitches.length / 2)] ?? 69;
const shift = 12 * Math.round((71 - middle) / 12);
const tonic = chartScale(chart).root;
const root = tonic + 12 * Math.round((69 - tonic) / 12);

const parts: [string, number, object[]][] = performed.phrases.map((p) => [
  p.key,
  p.beats,
  p.notes.map(([beat, pitch, len, syl], k) => ({
    syl,
    beat,
    len,
    midi: pitch + shift,
    ...(k === p.notes.length - 1 && len >= 1.2 ? { vib: 0.25 } : {}),
  })),
]);
// Chops are whole one-syllable words from the chops and the chorus, most
// used first, without the little words.
const FILLER = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "in",
  "on",
  "my",
  "i",
  "it",
  "is",
  "at",
  "for",
  "as",
]);
const counts = new Map<string, number>();
for (const s of chart.sections)
  for (const l of [
    ...(s.chops ?? []),
    ...(s.kind === "chorus" ? (s.sing ?? []) : []),
  ]) {
    const syls = (l.words ?? "").split(/\s+/).filter((w) => w && w !== "_");
    syls.forEach((w, k) => {
      if (w.endsWith("-") || syls[k - 1]?.endsWith("-")) return;
      // A chop is a sampler voice name, so contractions ("you're") sit out.
      const word = w.toLowerCase().replace(/[^a-z']/g, "");
      if (/^[a-z]{2,}$/.test(word) && !FILLER.has(word))
        counts.set(word, (counts.get(word) ?? 0) + 1);
    });
  }
const words = [...counts]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 4)
  .map(([w]) => w);
const syllables = [...new Set([...words, "oh", "yeah"])];
for (const w of syllables)
  parts.push([
    w,
    1,
    [{ syl: w, beat: 0, len: 0.7, midi: root, legato: false, gap: 0.05 }],
  ]);
parts.push([
  "hold",
  4,
  [{ syl: "ooh", beat: 0, len: 3.8, midi: root, vib: 0.15 }],
]);

const spec = {
  voice,
  bpm: chart.bpm,
  formant: Number(flag("formant", "1")),
  parts,
};
const specPath = join(outDir, `${id}.spec.json`);
const wavPath = join(outDir, `${id}.wav`);
writeFileSync(specPath, JSON.stringify(spec));
const run = Bun.spawnSync(
  [python, "-I", "scripts/vox/songs.py", "--spec", specPath, wavPath],
  {
    stderr: "inherit",
  },
);
if (run.exitCode) process.exit(run.exitCode);
const table = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!) as {
  seconds: number;
  slices: { name: string; begin: number; end: number }[];
};
const book = {
  sample: id,
  root,
  syllables,
  lines: Object.fromEntries(performed.phrases.map((p) => [p.key, p.beats])),
  heads: performed.phrases
    .filter((p) => p.kind === "chorus")
    .slice(0, 3)
    .map((p) => p.key),
  entry: {
    id,
    title: `${chart.title} Vocal`,
    description: `Original Kokoro + WORLD vocal book for the ${chart.title} chart.`,
    tags: ["vocal", "hyperpop", "book"],
    root,
    seconds: table.seconds,
    bpm: chart.bpm,
    sha256: createHash("sha256").update(readFileSync(wavPath)).digest("hex"),
    slices: table.slices,
  },
};
writeFileSync(join(outDir, `${id}.book.json`), JSON.stringify(book, null, 1));
console.log(
  `${id}: ${performed.phrases.length} lines, ${syllables.join(" ")}, ${table.seconds}s`,
);
