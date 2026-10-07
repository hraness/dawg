/**
 * Audition latency bench: key press to staged audio scheduled, with the
 * real engine and render worker (the player is an in-memory sink).
 *
 *   bun bench/audition-latency.ts [nudges=30]
 *
 * A 4-track, 2-bar song (wavetable pad with reverb, saw bass with a filter,
 * a kit and a lead). Each case loops the focused track like the audition
 * loop (solo, or in context with the whole mix), then nudges one value
 * every 250 ms and records `render round trip + engine lead`, the same
 * number `Audition.latencies` reports. Not part of `bun run check`.
 */
import { updateTrack, type TrackScore } from "../core/score.ts";
import { AudioEngine } from "../src/audio/engine.ts";
import { previewScore } from "../src/audio/preview.ts";
import { song } from "../src/audio/fixtures/latency-song.ts";

const NUDGES = Number(process.argv[2] ?? 30);
const SAMPLE_RATE = 44_100;

type Case = {
  name: string;
  track: string;
  context: boolean;
  nudge: (score: TrackScore, i: number) => TrackScore;
};

const reverb = (score: TrackScore, i: number) =>
  updateTrack(score, "pad", {
    reverb: { mix: 0.3 + (i % 10) * 0.02, size: 0.6 },
  } as never);
const filter = (score: TrackScore, i: number) =>
  updateTrack(score, "bass", {
    filter: { cutoff: 800 + (i % 10) * 50, resonance: 0.3 },
  } as never);

const CASES: Case[] = [
  {
    name: "reverb mix, wavetable pad, solo",
    track: "pad",
    context: false,
    nudge: reverb,
  },
  {
    name: "reverb mix, wavetable pad, in context",
    track: "pad",
    context: true,
    nudge: reverb,
  },
  {
    name: "filter cutoff, saw bass, solo",
    track: "bass",
    context: false,
    nudge: filter,
  },
  {
    name: "filter cutoff, saw bass, in context",
    track: "bass",
    context: true,
    nudge: filter,
  },
];

function sink() {
  let exit: (code: number) => void = () => undefined;
  return () => ({
    pid: 1,
    stdin: { write: () => undefined },
    exited: new Promise<number>((resolve) => (exit = resolve)),
    kill: () => exit(0),
  });
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const rows: string[] = [];
for (const c of CASES) {
  const engine = new AudioEngine({
    info: {
      backend: "command",
      streaming: true,
      command: ["sink"],
      detail: "bench",
    },
    sampleRate: SAMPLE_RATE,
    spawn: sink() as never,
    lockPath: `/tmp/dawg-bench-${process.pid}.lock`,
  });
  engine.setLeadMs(60);
  let score = song();
  const first = previewScore(score, c.track, { context: c.context, beat: 0 })!;
  await engine.play(first.score, 0);
  await wait(300);
  const latencies: number[] = [];
  const renders: number[] = [];
  for (let i = 1; i <= NUDGES; i += 1) {
    const keyAt = performance.now();
    score = c.nudge(score, i);
    const preview = previewScore(score, c.track, {
      context: c.context,
      beat: 0,
    })!;
    await engine.play(preview.score);
    latencies.push(performance.now() - keyAt + engine.leadMs);
    renders.push(engine.renderMs);
    await wait(250);
  }
  const lead = engine.leadMs;
  await engine.dispose();
  rows.push(
    `| ${c.name} | ${pct(latencies, 0.5).toFixed(0)} ms | ${pct(latencies, 0.9).toFixed(0)} ms | ${pct(renders, 0.5).toFixed(0)} ms | ${lead.toFixed(0)} ms |`,
  );
}
console.log("| case | median | p90 | worker render (median) | lead |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(row);
process.exit(0);
