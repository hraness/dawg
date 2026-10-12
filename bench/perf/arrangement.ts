/** `bun bench/perf/arrangement.ts`: dense song model + full TUI frame. */
import { arrangementFixture } from "../../test/arrangement-fixture.ts";
import { tapeView } from "../../src/tui/tape-view.ts";
import { TuiApp } from "../../tui/app.ts";
import { metric, table, type Metric } from "./stats.ts";

const sizes = [
  [40, 16],
  [60, 20],
  [80, 24],
  [120, 36],
  [160, 50],
] as const;

export function arrangementFrames(count = 220): Metric[] {
  const metrics: Metric[] = [];
  for (const [tracks, scenes] of [
    [16, 12],
    [32, 24],
  ]) {
    const score = arrangementFixture(tracks, scenes);
    for (const [cols, rows] of sizes) {
      let bytes = 0;
      let now = 10_000;
      const app = new TuiApp({
        io: {
          write: (value: string) => {
            bytes += value.length;
            return true;
          },
          columns: () => cols,
          rows: () => rows,
        },
        capabilities: { colorDepth: "truecolor", unicode: true },
        clock: () => now,
        reducedMotion: true,
      });
      const modelTimes: number[] = [];
      const frameTimes: number[] = [];
      const byteCounts: number[] = [];
      for (let frame = 0; frame < count; frame++) {
        now += 33;
        const beat = frame * 0.25;
        const focused = Math.floor(frame / 7) % tracks!;
        const before = bytes;
        const start = performance.now();
        const tape = tapeView({
          score,
          trackId: score.tracks[focused]!.id,
          beat,
          transportBeat: beat,
          zoom: "beat",
          selected: 0,
          marks: () => "",
        });
        const built = performance.now();
        app.render(
          {
            score: {
              trackName: score.tracks[focused]!.name,
              trackId: score.tracks[focused]!.id,
              sessionId: "arrangement-benchmark",
              revision: 1,
              bpm: 120,
              playing: true,
              loopBeats: score.bars * 4,
              beatsPerBar: 4,
              notes: [],
            },
            beat,
            tape,
          },
          { force: true },
        );
        if (frame >= 40) {
          modelTimes.push(built - start);
          frameTimes.push(performance.now() - start);
          byteCounts.push((bytes - before) / 1024);
        }
      }
      const id = `${tracks}t.${scenes}s.${cols}x${rows}`;
      metrics.push(
        metric(`arrange.model.${id}`, `model ${id}`, modelTimes),
        metric(`arrange.frame.${id}`, `model + frame ${id}`, frameTimes),
        metric(`arrange.bytes.${id}`, `bytes ${id}`, byteCounts, "KiB"),
      );
    }
  }
  return metrics;
}

if (import.meta.main) console.log(table(arrangementFrames()));
