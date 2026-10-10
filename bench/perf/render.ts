/**
 * Offline render time per bar (`renderScorePcm`, warm, 120 BPM 4/4, eight
 * bars) for the heavy presets, at 22.05 and 48 kHz. Each sample is one full
 * render divided by the bar count.
 */
import { createScore } from "../../core/score.ts";
import { renderScorePcm } from "../../src/audio/wav.ts";
import { metric, type Metric } from "./stats.ts";

const BAR = 1920;
const BARS = 8;
type N = {
  id: string;
  trackId: string;
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
};
let nid = 0;
const n = (
  trackId: string,
  pitch: number,
  startTick: number,
  durationTicks: number,
  velocity = 0.8,
): N => ({
  id: `n${nid++}`,
  trackId,
  pitch,
  startTick,
  durationTicks,
  velocity,
});
const chords = (t: string, roots = [57, 53, 60, 55], dur = BAR) => {
  const out: N[] = [];
  for (let b = 0; b < BARS; b += 1) {
    const r = roots[b % roots.length]!;
    for (const iv of [0, 4, 7, 12])
      out.push(n(t, r + iv - (iv === 4 && b % 2 ? 1 : 0), b * BAR, dur));
  }
  return out;
};
const melody = (t: string, base = 69, step = 240, len = 220) => {
  const out: N[] = [];
  const scale = [0, 2, 3, 5, 7, 8, 10, 12];
  for (let b = 0; b < BARS; b += 1)
    for (let s = 0; s < BAR / step; s += 1)
      out.push(
        n(t, base + scale[(b * 3 + s * 5) % 8]!, b * BAR + s * step, len),
      );
  return out;
};
const song = (tracks: object[], notes: N[]) =>
  createScore({
    tempoBpm: 120,
    bars: BARS,
    key: "A minor",
    tracks,
    notes,
  } as never);

export const RENDER_CASES: Record<
  string,
  () => ReturnType<typeof createScore>
> = {
  vocoder: () =>
    song(
      [
        { id: "v", name: "v", instrument: "sing", sing: { preset: "aah" } },
        {
          id: "pad",
          name: "pad",
          instrument: "vocoder",
          vocoder: { src: "v", carrier: "supersaw" },
        },
      ],
      [...melody("v", 60, 480, 460), ...chords("pad", [45, 41, 48, 43])],
    ),
  "sing-choir": () =>
    song(
      [{ id: "v", name: "v", instrument: "sing", sing: { preset: "choir" } }],
      melody("v", 60, 480, 460),
    ),
  "cellos-section": () =>
    song(
      [
        {
          id: "s",
          name: "s",
          instrument: "string",
          string: { preset: "cellos" },
        },
      ],
      chords("s", [45, 41, 48, 43]),
    ),
  "granular-swarm": () =>
    song(
      [
        {
          id: "g",
          name: "g",
          instrument: "granular",
          granular: { preset: "swarm", src: "synth:supersaw@60" },
        },
      ],
      chords("g"),
    ),
  psola: () =>
    song(
      [
        {
          id: "v",
          name: "v",
          instrument: "sing",
          sing: { preset: "aah" },
          autotune: { preset: "hard", to: "chord" },
        },
        { id: "k", name: "k", instrument: "saw" },
      ],
      [...melody("v", 60, 480, 460), ...chords("k")],
    ),
  "reverb-hall": () =>
    song(
      [
        {
          id: "p",
          name: "p",
          instrument: "saw",
          reverb: { mix: 0.4, size: 0.8, ir: "hall" },
        },
      ],
      chords("p"),
    ),
  "reverb-algo": () =>
    song(
      [
        {
          id: "p",
          name: "p",
          instrument: "saw",
          reverb: { mix: 0.4, size: 0.9 },
        },
      ],
      chords("p"),
    ),
};

export function render(
  runs = 3,
  rates: readonly number[] = [22_050, 48_000],
  only?: string,
): Metric[] {
  const out: Metric[] = [];
  for (const [name, make] of Object.entries(RENDER_CASES)) {
    if (only && !name.includes(only)) continue;
    const score = make();
    for (const rate of rates) {
      renderScorePcm(score, { sampleRate: rate });
      const perBar: number[] = [];
      for (let i = 0; i < runs; i += 1) {
        const started = performance.now();
        renderScorePcm(score, { sampleRate: rate });
        perBar.push((performance.now() - started) / BARS);
      }
      out.push(
        metric(
          `render.${name}.${rate / 1000}k`,
          `render ${name}, ${rate / 1000} kHz`,
          perBar,
          "ms/bar",
        ),
      );
    }
  }
  return out;
}

if (import.meta.main) {
  const { table } = await import("./stats.ts");
  console.log(
    table(render(Number(process.env.RUNS ?? 3), undefined, process.argv[2])),
  );
}
