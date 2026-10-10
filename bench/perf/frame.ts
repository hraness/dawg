/**
 * TUI frame time during playback: `TuiApp.render` (compose + diff encode)
 * with a moving playhead, per terminal size. Also reports bytes per frame.
 */
import { TuiApp } from "../../tui/app.ts";
import { metric, type Metric } from "./stats.ts";

const notes = Array.from({ length: 64 }, (_, i) => ({
  startBeat: i * 0.25,
  pitch: 40 + ((i * 7) % 24),
  velocity: 0.5 + (i % 4) * 0.1,
  durationBeats: 0.25,
}));
const score = {
  trackName: "bass",
  trackId: "bass",
  sessionId: "7f3a91c2-0000",
  revision: 42,
  bpm: 120,
  key: "Am",
  playing: true,
  loopBeats: 16,
  beatsPerBar: 4,
  notes,
};

export function frames(
  sizes: ReadonlyArray<[number, number]> = [
    [80, 24],
    [200, 50],
  ],
  count = 600,
): Metric[] {
  const out: Metric[] = [];
  for (const [cols, rows] of sizes) {
    let bytes = 0;
    let now = 10_000;
    const app = new TuiApp({
      io: {
        write: (data: string) => {
          bytes += data.length;
          return true;
        },
        columns: () => cols,
        rows: () => rows,
      },
      capabilities: { colorDepth: "truecolor", unicode: true },
      clock: () => now,
      reducedMotion: false,
    } as never);
    const times: number[] = [];
    const sizesOut: number[] = [];
    for (let i = 0; i < count; i += 1) {
      now += 33;
      const before = bytes;
      const started = performance.now();
      app.render({ score, beat: (i * 0.066) % 16 } as never, { force: true });
      if (i >= 100) {
        times.push(performance.now() - started);
        sizesOut.push((bytes - before) / 1024);
      }
    }
    out.push(
      metric(
        `frame.${cols}x${rows}`,
        `frame time, playing, ${cols}x${rows}`,
        times,
      ),
      metric(
        `frame.bytes.${cols}x${rows}`,
        `bytes per frame, ${cols}x${rows}`,
        sizesOut,
        "KiB",
      ),
    );
  }
  return out;
}

if (import.meta.main) {
  const { table } = await import("./stats.ts");
  console.log(table(frames()));
}
