/**
 * Live key render cost in-process (`LiveSynth.render`, 44.1 kHz): the first
 * press in a fresh process (cold JIT and tables), the first press after the
 * play-mode pre-warm (`warmLive`), and later new pitches. Each cold sample is
 * its own subprocess.
 */
import { metric, type Metric } from "./stats.ts";

const RATE = 44_100;
export const LIVE_CASES: Record<string, object> = {
  saw: { instrument: "saw" },
  "saw-fx": {
    instrument: "saw",
    filter: { cutoff: 1200, resonance: 0.3 },
    reverb: { mix: 0.3, size: 0.7 },
    delay: { beats: 0.5, feedback: 0.4, mix: 0.3 },
  },
  grand: { instrument: "grand", keys: {} },
  tonewheel: { instrument: "tonewheel", keys: {} },
  "bowed-cello": { instrument: "string", string: { preset: "cello" } },
  "sing-choir": { instrument: "sing", sing: { preset: "choir" } },
  "granular-swarm": {
    instrument: "granular",
    granular: { preset: "swarm", src: "synth:supersaw@60" },
  },
};

async function child(name: string, prewarm: boolean): Promise<void> {
  const { createScore } = await import("../../core/score.ts");
  const { LiveSynth, warmLive } = await import("../../src/audio/live.ts");
  const score = createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "t", name: "t", ...LIVE_CASES[name] }],
    notes: [],
  } as never);
  if (prewarm) warmLive(score, "t", RATE);
  const synth = new LiveSynth(RATE);
  const req = (pitch: number) => ({
    score,
    trackId: "t",
    pitch,
    velocity: 0.8,
    seconds: 0.5,
  });
  let started = performance.now();
  synth.render(req(62));
  const first = performance.now() - started;
  const later: number[] = [];
  for (let pitch = 48; pitch < 60; pitch += 1) {
    started = performance.now();
    synth.render(req(pitch));
    later.push(performance.now() - started);
  }
  console.log(JSON.stringify({ first, later }));
}

export async function live(coldRuns = 5): Promise<Metric[]> {
  const out: Metric[] = [];
  for (const name of Object.keys(LIVE_CASES)) {
    const cold: number[] = [];
    const warmed: number[] = [];
    const later: number[] = [];
    for (let i = 0; i < coldRuns; i += 1)
      for (const prewarm of [false, true]) {
        const proc = Bun.spawn(
          [
            process.execPath,
            import.meta.path,
            "--child",
            name,
            prewarm ? "1" : "0",
          ],
          {
            stdout: "pipe",
            stderr: "inherit",
          },
        );
        const text = await new Response(proc.stdout).text();
        await proc.exited;
        const result = JSON.parse(text.trim().split("\n").pop()!) as {
          first: number;
          later: number[];
        };
        (prewarm ? warmed : cold).push(result.first);
        if (!prewarm) later.push(...result.later);
      }
    out.push(
      metric(
        `live.cold.${name}`,
        `key render, first press, no pre-warm, ${name}`,
        cold,
      ),
      metric(
        `live.prewarmed.${name}`,
        `key render, first press after play-mode warm, ${name}`,
        warmed,
      ),
      metric(
        `live.warm.${name}`,
        `key render, new pitch, warm, ${name}`,
        later,
      ),
    );
  }
  return out;
}

if (import.meta.main) {
  if (process.argv[2] === "--child")
    await child(process.argv[3]!, process.argv[4] === "1");
  else {
    const { table } = await import("./stats.ts");
    console.log(table(await live(Number(process.env.RUNS ?? 3))));
  }
}
