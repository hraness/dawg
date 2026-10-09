/**
 * Shoegaze stages (0.6.1): wobble, bloom, swell (mono, after the cab) and
 * double (stereo, right after pan). Ported from the guitar design lane's
 * prototype (proto/guitar/rig.ts wobbleCurve, addFeedback, applySwell,
 * applyDouble).
 *
 * - wobble: a held tremolo arm (the "glide guitar" of Kevin Shields). One
 *   seeded curve per track in render time bends the whole voice sum
 *   together. The voice is read through a moving, non-causal delay whose
 *   slope is the pitch ratio, so a sine of peak `depth` cents is exact.
 * - bloom: feedback. The highest note held past `delay` grows a partial at
 *   `harm` × f0 with a slow seeded drift of a few cents (one seed per
 *   note id), the way a loud amp makes the top note sing.
 * - swell: a Slow Gear style volume swell; the gain resets at each onset
 *   cluster and rises over `time`.
 * - double: automatic double tracking. A second take is the input delayed
 *   `time` ms with a seeded wander of ± `drift` ms and a darker tilt,
 *   spread against the dry take by `width`.
 *
 * Every random number comes from the track id (and note id), so a render
 * is byte-identical on every run.
 */
import type { FxValues } from "../../../core/fx.ts";
import type { Track } from "../../../core/score.ts";
import { seededRandom } from "../dsp/rng.ts";
import { OnePole } from "../dsp/filters.ts";
import {
  CONTROL_SAMPLES,
  clamp,
  fxReader,
  type EffectContext,
  type EffectNote,
} from "./common.ts";

const CENTS_TO_LOG = Math.LN2 / 1200;

/** Catmull-Rom (4-point Hermite) read of `x` at a fractional position. */
function readAt(x: Float64Array, position: number): number {
  const last = x.length - 1;
  if (last < 0) return 0;
  const p = clamp(position, 0, last);
  const i = Math.floor(p);
  const t = p - i;
  const a = x[Math.max(0, i - 1)]!;
  const b = x[i]!;
  const c = x[Math.min(last, i + 1)]!;
  const d = x[Math.min(last, i + 2)]!;
  const c1 = 0.5 * (c - a);
  const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
  const c3 = 0.5 * (d - a) + 1.5 * (b - c);
  return ((c3 * t + c2) * t + c1) * t + b;
}

export type WobbleShape = Readonly<{
  /** Read offset in seconds at time t (positive: earlier audio). */
  offset: (t: number) => number;
  /** Pitch deviation in cents at time t. */
  cents: (t: number) => number;
  /** Largest possible |offset| in seconds (the components' summed amplitude). */
  span: number;
}>;

/**
 * Most a wobble moves a note in time, in seconds. Slow, deep settings
 * (100 c at 0.05 Hz) would otherwise drag strums 170 ms off the grid; past
 * this bound the depth gives way instead.
 */
export const WOBBLE_MAX_OFFSET = 0.015;

/**
 * The track's wobble curve: three seeded sines (the first at `rate`, the
 * others off-ratio) weighted by `drift`. Each component's delay amplitude
 * is chosen so its pitch contribution peaks at its share of `depth`.
 */
export function wobbleShape(
  depth: number,
  rate: number,
  drift: number,
  seed: string,
): WobbleShape {
  const r = seededRandom(`wobble:${seed}`);
  const phase = [r(), r(), r()].map((x) => x * 2 * Math.PI);
  const ratio = [1, 0.61 + 0.1 * r(), 1.53 + 0.2 * r()];
  const d = clamp(drift, 0, 1);
  const weight = [1 - d, 0.6 * d, 0.4 * d];
  const norm = weight[0]! + weight[1]! + weight[2]!;
  const hz = ratio.map((k) => Math.max(0.01, rate) * k);
  // Delay amplitude (s) whose derivative peaks at the component's cents.
  const amp = hz.map(
    (f, k) => ((weight[k]! / norm) * depth * CENTS_TO_LOG) / (2 * Math.PI * f),
  );
  return {
    span: amp[0]! + amp[1]! + amp[2]!,
    // Reading at t + offset(t): ratio = 1 + offset'(t) ≈ 2^(cents/1200).
    offset: (t) => {
      let s = 0;
      for (let k = 0; k < 3; k += 1)
        s += amp[k]! * Math.sin(2 * Math.PI * hz[k]! * t + phase[k]!);
      return s;
    },
    cents: (t) => {
      let s = 0;
      for (let k = 0; k < 3; k += 1)
        s +=
          amp[k]! *
          2 *
          Math.PI *
          hz[k]! *
          Math.cos(2 * Math.PI * hz[k]! * t + phase[k]!);
      return s / CENTS_TO_LOG;
    },
  };
}

export function applyWobble(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "wobble", values, context);
  const depth = read.param("depth");
  const rate = read.number("rate");
  const drift = read.number("drift");
  const sr = context.sampleRate;
  const peak = depth.automated ? 100 : depth.at(0);
  if (peak <= 0 || buffer.length === 0) return;
  // Unit-depth shape, scaled by the (possibly automated) depth.
  const shape = wobbleShape(1, rate, drift, track.id);
  // Depth that keeps every read within WOBBLE_MAX_OFFSET of the grid.
  const most = shape.span > 0 ? WOBBLE_MAX_OFFSET / shape.span : Infinity;
  const source = buffer.slice();
  let scale = Math.min(most, depth.at(0));
  for (let index = 0; index < buffer.length; index += 1) {
    if (depth.automated && index % CONTROL_SAMPLES === 0)
      scale = Math.min(most, depth.at(index));
    const t = index / sr;
    buffer[index] = readAt(source, index + scale * shape.offset(t) * sr);
  }
}

/**
 * Feedback bloom. Only the highest note sounding at once feeds back (one
 * dominant loop), and only once it has been held past `delay`. One sweep:
 * the dominant note is found per 32-sample block from the sorted note
 * starts and a small active set, and a hand-over crossfades 20 ms, so the
 * cost is O(samples + notes log notes) even on a dense strum.
 *
 * The partial feeds back from the signal itself: its level follows an
 * envelope of the incoming buffer (50 ms attack, `time` release), so a
 * quiet, faded or muted track blooms quietly or not at all, and the
 * partial never sits more than about -6 dB under the input's peak.
 */
export function applyBloom(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const notes = context.notes;
  if (!notes || notes.length === 0) return;
  const read = fxReader(track, "bloom", values, context);
  const amount = read.number("amount");
  if (amount <= 0) return;
  const harm = read.number("harm");
  const sr = context.sampleRate;
  const delay = Math.round(read.number("delay") * sr);
  const grow = Math.max(0.05, read.number("time"));
  const release = Math.round(0.08 * sr);
  const fade = Math.max(1, Math.round(0.02 * sr));
  // Envelope (peak-equivalent of a smoothed RMS) of the input.
  const follow = new Float64Array(buffer.length);
  const up = 1 - Math.exp(-1 / (0.05 * sr));
  const down = 1 - Math.exp(-1 / (Math.max(0.1, grow) * sr));
  let power = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const x2 = buffer[index]! * buffer[index]!;
    power += (x2 > power ? up : down) * (x2 - power);
    follow[index] = Math.sqrt(2 * power);
  }
  const sorted = notes
    .filter((note) => note.length > delay)
    .sort((x, y) => x.start - y.start || y.hz - x.hz);
  type Loop = {
    note: EffectNote;
    phase: number;
    driftHz: number;
    level: number;
    /** Hand-over gain 0..1 and its direction. */
    gain: number;
    rising: boolean;
  };
  const loops: Loop[] = [];
  const active: EffectNote[] = [];
  let next = 0;
  let current: EffectNote | undefined;
  for (let block = 0; block < buffer.length; block += BLOCK) {
    while (next < sorted.length && sorted[next]!.start <= block)
      active.push(sorted[next++]!);
    for (let k = active.length - 1; k >= 0; k -= 1)
      if (active[k]!.start + active[k]!.length <= block) active.splice(k, 1);
    let top: EffectNote | undefined;
    for (const note of active)
      if (note.start + delay <= block && (!top || note.hz > top.hz)) top = note;
    if (top !== current) {
      for (const loop of loops) if (loop.note !== top) loop.rising = false;
      if (top && !loops.some((loop) => loop.note === top)) {
        const r = seededRandom(`bloom:${track.id}:${top.id}`);
        loops.push({
          note: top,
          phase: r() * 2 * Math.PI,
          driftHz: 0.2 + 0.3 * r(),
          // Relative to the input envelope; at most -6 dB under it.
          level: Math.min(0.5, 0.6 * amount * (0.5 + 0.5 * top.velocity)),
          gain: current ? 0 : 1,
          rising: true,
        });
      }
      current = top;
    }
    const end = Math.min(buffer.length, block + BLOCK);
    for (let k = loops.length - 1; k >= 0; k -= 1) {
      const loop = loops[k]!;
      const from = loop.note.start + delay;
      const off = loop.note.start + loop.note.length;
      for (let index = block; index < end; index += 1) {
        const t = (index - from) / sr;
        const cents = 3 * Math.sin(2 * Math.PI * loop.driftHz * t);
        loop.phase +=
          (2 * Math.PI * harm * loop.note.hz * 2 ** (cents / 1200)) / sr;
        loop.gain = loop.rising
          ? Math.min(1, loop.gain + 1 / fade)
          : Math.max(0, loop.gain - 1 / fade);
        let env =
          follow[index]! * loop.level * loop.gain * (1 - Math.exp(-t / grow));
        if (index > off) env *= Math.max(0, 1 - (index - off) / release);
        buffer[index]! += env * Math.sin(loop.phase);
      }
      if (loop.gain <= 0 || end > off + release) {
        loops.splice(k, 1);
        if (current === loop.note) current = undefined;
      }
    }
  }
}

/** Control block of the bloom sweep, in samples. */
const BLOCK = 32;

/** Onset clusters (notes within 40 ms of the cluster's first), sorted. */
function onsets(notes: readonly EffectNote[], sr: number): number[] {
  const gap = 0.04 * sr;
  const out: number[] = [];
  for (const start of notes.map((note) => note.start).sort((a, b) => a - b))
    if (out.length === 0 || start - out[out.length - 1]! > gap) out.push(start);
  return out;
}

export function applySwell(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const notes = context.notes;
  if (!notes || notes.length === 0) return;
  const read = fxReader(track, "swell", values, context);
  const mix = read.param("mix");
  const sr = context.sampleRate;
  // Reaches about -0.4 dB at `time`.
  const tau = (Math.max(0.01, read.number("time")) / 3) * sr;
  // A new onset over a ringing chord first ducks the gain to 0 over at
  // most `duck` (scaled by how high it was), then rises again: no click.
  const duck = 0.006 * sr;
  const starts = onsets(notes, sr);
  let next = 0;
  let last = Number.NEGATIVE_INFINITY;
  let g = 1;
  let from = 0;
  let fall = 0;
  let wet = mix.at(0);
  for (let index = 0; index < buffer.length; index += 1) {
    if (mix.automated && index % CONTROL_SAMPLES === 0) wet = mix.at(index);
    while (next < starts.length && starts[next]! <= index) {
      // Before the first onset nothing sounds: rise from silence.
      from = last === Number.NEGATIVE_INFINITY ? 0 : g;
      fall = Math.round(duck * from);
      last = starts[next++]!;
    }
    if (last !== Number.NEGATIVE_INFINITY) {
      const elapsed = index - last;
      g =
        elapsed < fall
          ? from * (1 - elapsed / fall)
          : 1 - Math.exp(-(elapsed - fall) / tau);
    }
    buffer[index] = buffer[index]! * (1 - wet + wet * g * g);
  }
}

/** Seeded wandering delay of one channel, read non-causally from `x`. */
function secondTake(
  x: Float64Array,
  time: number,
  drift: number,
  seed: string,
  sr: number,
): Float64Array {
  const r = seededRandom(`double:${seed}`);
  const ph1 = r() * 2 * Math.PI;
  const ph2 = r() * 2 * Math.PI;
  const f1 = 0.35 + 0.3 * r();
  const f2 = 0.11 + 0.1 * r();
  const tilt = new OnePole(5500, sr);
  const out = new Float64Array(x.length);
  let d = (time / 1000) * sr;
  for (let index = 0; index < x.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      const t = index / sr;
      const wander =
        0.65 * Math.sin(2 * Math.PI * f1 * t + ph1) +
        0.35 * Math.sin(2 * Math.PI * f2 * t + ph2);
      d = ((time + drift * wander) / 1000) * sr;
    }
    const position = index - d;
    out[index] = tilt.process(position < 0 ? 0 : readAt(x, position));
  }
  return out;
}

export function applyDouble(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "double", values, context);
  const time = read.number("time");
  const drift = read.number("drift");
  const width = clamp(read.number("width"), 0, 1);
  const sr = context.sampleRate;
  const copyL = secondTake(left, time, drift, track.id, sr);
  const copyR = secondTake(right, time, drift, track.id, sr);
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index]!;
    const r = right[index]!;
    const cl = copyL[index]!;
    const cr = copyR[index]!;
    // width 1: the dry take left, the second take right; 0: both centred.
    left[index] = 0.5 * (l + cl) + 0.5 * width * (l - cl);
    right[index] = 0.5 * (r + cr) - 0.5 * width * (r - cr);
  }
}
