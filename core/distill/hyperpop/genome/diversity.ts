/**
 * How far apart two songs are, measured from the scores alone so demos and
 * generated songs compare on the same terms: tempo, where the kicks and
 * snares fall, the pitch profile (key-free), how the melody moves, how
 * busy each layer is and how the form is cut. 0 is the same song, 1 is as
 * different as these features can say.
 */
import type { TrackScore } from "../../../score.ts";

export type Fingerprint = Readonly<{
  tempo: number;
  kick: readonly number[];
  snare: readonly number[];
  pitch: readonly number[];
  motion: readonly number[];
  density: readonly number[];
  form: readonly number[];
}>;

const TPB = 480;
const STEP = TPB / 4;
const DRUM_KICK = /kick/;
const DRUM_SNARE = /snare|clap/;
const SINGER = /^(vox|sing|singer|lead|hook|vocoder|voice)/;

const normal = (v: number[]): number[] => {
  const sum = v.reduce((a, b) => a + b, 0);
  return sum > 0 ? v.map((x) => x / sum) : v;
};

/** The score's features, each a distribution or a 0..1 number. */
export function fingerprint(score: TrackScore): Fingerprint {
  const kick = new Array(16).fill(0);
  const snare = new Array(16).fill(0);
  const pcs = new Array(12).fill(0);
  const motion = new Array(8).fill(0);
  const byTrack = new Map<string, number>();
  const melodic: { t: number; p: number }[] = [];
  for (const n of score.notes) {
    const step = Math.round(n.startTick / STEP) % 16;
    const drumKit = n.pitch >= 35 && n.pitch <= 46;
    if (DRUM_KICK.test(n.trackId) || (n.trackId === "drums" && n.pitch === 36))
      kick[step]++;
    else if (
      DRUM_SNARE.test(n.trackId) ||
      (n.trackId === "drums" && (n.pitch === 38 || n.pitch === 39))
    )
      snare[step]++;
    else if (!(drumKit && /drum|hat|perc|kit/.test(n.trackId)))
      pcs[((n.pitch % 12) + 12) % 12] += n.durationTicks;
    byTrack.set(n.trackId, (byTrack.get(n.trackId) ?? 0) + 1);
    if (SINGER.test(n.trackId)) melodic.push({ t: n.startTick, p: n.pitch });
  }
  // Key-free pitch profile: rotate so the most-held pitch class comes first.
  const top = pcs.indexOf(Math.max(...pcs));
  const pitch = normal(pcs.map((_, i) => pcs[(i + top) % 12]!));
  melodic.sort((a, b) => a.t - b.t);
  for (let i = 1; i < melodic.length; i++) {
    const d = Math.min(7, Math.abs(melodic[i]!.p - melodic[i - 1]!.p));
    motion[d]++;
  }
  // Layer density: notes per bar of the busiest layers, sorted, so names don't matter.
  const bars = Math.max(1, score.bars);
  const density = [...byTrack.values()]
    .map((c) => Math.min(1, c / bars / 32))
    .sort((a, b) => b - a);
  while (density.length < 12) density.push(0);
  const form = score.sections.map((s) => s.bars / bars);
  return {
    tempo: Math.max(0, Math.min(1, (score.tempoBpm - 80) / 120)),
    kick: normal(kick),
    snare: normal(snare),
    pitch,
    motion: normal(motion),
    density: density.slice(0, 12),
    form,
  };
}

const l1 = (a: readonly number[], b: readonly number[]) => {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return d;
};

/** Section cuts as a set of boundaries; distance is the share that don't line up. */
const formDistance = (a: readonly number[], b: readonly number[]) => {
  const cuts = (f: readonly number[]) => {
    let t = 0;
    return f.map((x) => Math.round((t += x) * 64));
  };
  const ca = new Set(cuts(a));
  const cb = new Set(cuts(b));
  const shared = [...ca].filter((x) => cb.has(x)).length;
  return 1 - (2 * shared) / Math.max(1, ca.size + cb.size);
};

export function distance(a: Fingerprint, b: Fingerprint): number {
  const parts = [
    Math.min(1, Math.abs(a.tempo - b.tempo) * 4),
    l1(a.kick, b.kick) / 2,
    l1(a.snare, b.snare) / 2,
    l1(a.pitch, b.pitch) / 2,
    l1(a.motion, b.motion) / 2,
    Math.min(1, l1(a.density, b.density) / 2),
    formDistance(a.form, b.form),
  ];
  return parts.reduce((x, y) => x + y, 0) / parts.length;
}

export type Spread = Readonly<{
  /** Mean distance over every pair. */
  mean: number;
  /** The closest pair: the best evidence of a shared template. */
  min: number;
  closest: readonly [number, number];
}>;

export function spread(prints: readonly Fingerprint[]): Spread {
  let sum = 0;
  let count = 0;
  let min = Infinity;
  let closest: [number, number] = [0, 0];
  for (let i = 0; i < prints.length; i++)
    for (let j = i + 1; j < prints.length; j++) {
      const d = distance(prints[i]!, prints[j]!);
      sum += d;
      count++;
      if (d < min) [min, closest] = [d, [i, j]];
    }
  return { mean: count ? sum / count : 0, min: count ? min : 0, closest };
}
