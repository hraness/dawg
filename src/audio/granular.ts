/**
 * The granular instrument (0.6): a seeded, streaming grain voice and the
 * engine that plays a track's notes with it. Ported from the 0.6 granular
 * prototype (`proto/granular/granular.ts`, round 3) with the review's
 * changes: a per-semitone sinc bank (`dsp/bank.ts`) re-picked per 32-frame
 * block from the step times the note's cents (bend, glide, vibrato), the
 * `shimint` interval, beat-repeat latching (`repeat`, `hold`) and a slow
 * seeded drift of the head (`drift`, `drate`).
 *
 * Synchronous-grid granulator with jittered onsets after Roads,
 * *Microsound* (MIT Press 2001) and Bencina, "Implementing Real-Time
 * Granular Synthesis"; structure similar to Mutable Instruments Clouds.
 * Randomness is counter-based (`unit(seed, grain, slot)`), so changing one
 * parameter does not reshuffle the others' draws.
 */
import { parseKey, scaleOf } from "../../core/chords.ts";
import { pedalStateAt, type PerformedNote } from "../../core/expression.ts";
import {
  DEFAULT_GRANULAR_SOURCE,
  GRAIN_SYNC_BEATS,
  GRANULAR_LANE_PARAMS,
  GRANULAR_SOURCE_VOICE,
  SYNTH_SOURCE_SECONDS,
  granularTailSeconds,
  parseSynthSource,
  resolveGranular,
  type GranularSettings,
} from "../../core/granular.ts";
import type { FxLane } from "../../core/fx.ts";
import type { SampleRef, Track, TrackScore } from "../../core/score.ts";
import { SYNTH_PRESETS, type TrackSynth } from "../../core/synth.ts";
import { noteHz } from "../../core/tuning.ts";
import {
  BANK_CHUNK_FRAMES,
  bankChunk,
  bankLevel,
  type BankSource,
} from "./dsp/bank.ts";
import { seedHash, unit } from "./dsp/rng.ts";
import { WINDOW_TABLE, grainWindow } from "./dsp/window.ts";
import { interpolateAutomation } from "./effects/common.ts";
import type { EngineContext, InstrumentEngine } from "./instruments.ts";
import type { DecodedSample, SampleBank } from "./samples.ts";
import { renderSynthNote } from "./synth/voice.ts";
import { warpedSpan } from "./warp.ts";

/** Parameters are read, and the bank level re-picked, every 32 frames. */
export const CONTROL_FRAMES = 32;
/** Grains sounding at once per voice; later grains are skipped by index. */
export const MAX_GRAINS = 64;
/** Most grains overlapping at once (synced or not). */
const MAX_OVERLAP = 32;
/**
 * Voices per track; the oldest released voice is stolen first, then the
 * oldest held one, with a 5 ms fade.
 */
export const MAX_VOICES = 16;
const STEAL_SECONDS = 0.005;
const CHUNK_MASK = BANK_CHUNK_FRAMES - 1;

/** A grain (a class, so the hot loop sees one shape). */
class Grain {
  start = 0;
  len = 0;
  /** Read position at level 0 frames (all levels share the frame rate). */
  pos = 0;
  /** Signed source frames per output frame, before the note's cents. */
  step = 0;
  gl = 0;
  gr = 0;
}

export type GranularVoiceInit = Readonly<{
  source: BankSource;
  sr: number;
  settings: GranularSettings;
  /** Note frequency over the source root's frequency (tuning applied). */
  baseRate: number;
  velocity: number;
  gateFrames: number;
  /** NotePerformance.cents: bend, glide and vibrato in cents at t seconds. */
  cents?: (t: number) => number;
  /** Half pedal: the level fades from `from` seconds with `tau`. */
  damp?: Readonly<{ from: number; tau: number }>;
  seed: number;
  /**
   * `grain-<param>` lanes (0.6.1): each value at a voice frame, read every
   * 32 frames; grain-scoped ones latch at each grain's onset.
   */
  lanes?: readonly Readonly<{ name: string; at: (frame: number) => number }>[];
  /** `sync` (0.6.1): the voice frame of grid point `k` on the tempo map. */
  grid?: (k: number) => number;
  /** The synced period at grain `k` (default `grid(k + 1) - grid(k)`). */
  gridPeriod?: (k: number) => number;
  /** `quant` (0.6.1): a grain's semitone offset snapped to allowed pitches. */
  quant?: (semis: number, frame: number) => number;
  /** `pedal` (0.6.1): true while the sustain pedal holds the head. */
  held?: (frame: number) => boolean;
}>;

export type GranularVoice = {
  /** Adds `frames` frames at `offset`; false once silent for good. */
  process(
    outL: Float64Array,
    outR: Float64Array,
    offset: number,
    frames: number,
  ): boolean;
  readonly totalFrames: number;
};

/** A streaming grain voice. */
export function granularVoice(init: GranularVoiceInit): GranularVoice {
  const { source, sr, seed } = init;
  const lanes = init.lanes ?? [];
  // Automated rows read a mutable copy; without lanes `p` is the settings.
  const p: { -readonly [K in keyof GranularSettings]: GranularSettings[K] } =
    lanes.length > 0 ? { ...init.settings } : init.settings;
  const live = p as unknown as Record<string, number>;
  const data = source.data;
  const srcRate = source.rate;
  const n0 = Math.max(1, data.length);
  const begin = Math.max(0, Math.min(Math.floor(p.begin * n0), n0 - 1));
  const end = Math.max(begin + 1, Math.min(Math.ceil(p.end * n0), n0));
  const region = end - begin;
  const releaseFrames = Math.max(1, Math.round(p.release * sr));
  const attackFrames = Math.max(1, Math.round(p.attack * sr));
  const maxGrainFrames = Math.round(2 * sr);
  const tailFrames =
    releaseFrames + Math.round(Math.min(2, p.grain) * sr * 1.5);
  const total = init.gateFrames + tailFrames;
  const spawnEnd = init.gateFrames + releaseFrames;
  const win = grainWindow(p.window);
  const table = win.table;
  let grainSec = Math.max(0.005, Math.min(2, p.grain));
  let overlap = Math.max(0.05, Math.min(MAX_OVERLAP, p.overlap));
  let period = (grainSec * sr) / overlap;
  let len = Math.max(16, Math.min(maxGrainFrames, Math.round(grainSec * sr)));
  let winGain = Math.min(
    1,
    1 / Math.sqrt(Math.max(1e-9, overlap * win.meanSq)),
  );
  const frameStep = srcRate / sr;
  let scanStep = p.freeze ? 0 : p.scan * frameStep;
  const grid = init.grid;
  const gridPeriod =
    init.gridPeriod ?? ((at: number) => grid!(at + 1) - grid!(at));
  /** Grain shape from the current grain, overlap and (synced) period. */
  function shape(): void {
    grainSec = Math.max(0.005, Math.min(2, p.grain));
    if (grid) {
      period = Math.max(1, gridPeriod(k));
      overlap = Math.max(0.05, (grainSec * sr) / period);
      // The unsynced cap: a long grain on a fast grid shortens to 32
      // overlapping grains, so the level matches the grains that sound.
      if (overlap > MAX_OVERLAP) {
        overlap = MAX_OVERLAP;
        grainSec = (MAX_OVERLAP * period) / sr;
      }
    } else {
      overlap = Math.max(0.05, Math.min(MAX_OVERLAP, p.overlap));
      period = (grainSec * sr) / overlap;
    }
    len = Math.max(16, Math.min(maxGrainFrames, Math.round(grainSec * sr)));
    winGain = Math.min(1, 1 / Math.sqrt(Math.max(1e-9, overlap * win.meanSq)));
  }
  const grains: Grain[] = [];
  const pool: Grain[] = [];
  let t = 0;
  let scanned = 0;
  let k = 0;
  let nextGrid = grid ? grid(0) : 0;
  if (grid) shape();
  let latch = 0;
  let latched = 0;
  let lp = 0;
  let lpR = 0;
  const lpA =
    p.veltone > 0
      ? 1 -
        Math.exp(
          (-2 *
            Math.PI *
            Math.min(
              0.45 * sr,
              18000 * 2 ** (-6 * p.veltone * (1 - init.velocity)),
            )) /
            sr,
        )
      : 1;
  const amp = init.velocity * p.gain;
  const blockL = new Float64Array(CONTROL_FRAMES);
  const blockR = new Float64Array(CONTROL_FRAMES);

  function driftAt(sec: number): number {
    const driftDepth = 0.5 * p.drift * region;
    if (driftDepth === 0) return 0;
    const x = sec * p.drate;
    const i = Math.floor(x);
    const f = x - i;
    const a = 2 * unit(seed, i, 7) - 1;
    const b = 2 * unit(seed, i + 1, 7) - 1;
    const s = 0.5 - 0.5 * Math.cos(Math.PI * f);
    return driftDepth * (a + (b - a) * s);
  }

  function spawn(): void {
    if (grid) shape();
    const sec = nextGrid / sr;
    // Beat repeat: a grid step may latch the head for `hold` steps.
    if (latch > 0) latch -= 1;
    else {
      latched = scanned;
      if (p.repeat > 0 && unit(seed, k, 6) < p.repeat) latch = p.hold - 1;
    }
    const head = latched;
    const onset = nextGrid + p.jitter * unit(seed, k, 0) * period;
    const raw =
      p.pitch +
      p.detune * (unit(seed, k, 2) - 0.5) +
      (unit(seed, k, 5) < p.shimmer ? p.shimint : 0);
    const semis = init.quant ? init.quant(raw, nextGrid) : raw;
    const step0 = init.baseRate * 2 ** (semis / 12) * frameStep;
    let center =
      begin +
      p.pos * region +
      head +
      driftAt(sec) +
      p.spray * srcRate * (2 * unit(seed, k, 1) - 1);
    center = begin + ((((center - begin) % region) + region) % region);
    const span = step0 * len;
    const back = unit(seed, k, 4) < p.reverse;
    const theta = ((1 + p.spread * (2 * unit(seed, k, 3) - 1)) * Math.PI) / 4;
    if (grains.length < MAX_GRAINS) {
      const g = pool.pop() ?? new Grain();
      g.start = Math.round(onset);
      g.len = len;
      g.pos = back ? center + span / 2 : center - span / 2;
      g.step = back ? -step0 : step0;
      g.gl = Math.cos(theta) * Math.SQRT2 * winGain;
      g.gr = Math.sin(theta) * Math.SQRT2 * winGain;
      grains.push(g);
    }
    k += 1;
    nextGrid = grid ? grid(k) : nextGrid + period;
  }

  function envelope(i: number): number {
    const a = i < attackFrames ? i / attackFrames : 1;
    let e: number;
    if (i < init.gateFrames) e = a;
    else {
      const r = 1 - (i - init.gateFrames) / releaseFrames;
      e = r > 0 ? a * r : 0;
    }
    const damp = init.damp;
    if (damp) {
      const sec = i / sr;
      if (sec > damp.from) e *= Math.exp(-(sec - damp.from) / damp.tau);
    }
    return e;
  }

  function renderGrains(from: number, n: number, centsMul: number): void {
    blockL.fill(0, 0, n);
    blockR.fill(0, 0, n);
    const to = from + n;
    for (let gi = grains.length - 1; gi >= 0; gi -= 1) {
      const g = grains[gi]!;
      if (g.start >= to) continue;
      const a = g.start > from ? g.start : from;
      const gEnd = g.start + g.len;
      const b = gEnd < to ? gEnd : to;
      const step = g.step * centsMul;
      const level = bankLevel(step);
      let pos = g.pos;
      let ci = Math.floor(pos) >> 12;
      let chunk = bankChunk(source, level, ci);
      const wScale = WINDOW_TABLE / g.len;
      const gl = g.gl;
      const gr = g.gr;
      for (let i = a; i < b; i += 1) {
        const ip = Math.floor(pos);
        const c = ip >> 12;
        if (c !== ci) {
          ci = c;
          chunk = bankChunk(source, level, ci);
        }
        const o = (ip & CHUNK_MASK) + 1;
        const f = pos - ip;
        const xm1 = chunk[o - 1]!;
        const x0 = chunk[o]!;
        const x1 = chunk[o + 1]!;
        const x2 = chunk[o + 2]!;
        const c1 = 0.5 * (x1 - xm1);
        const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
        const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        const sample = ((c3 * f + c2) * f + c1) * f + x0;
        const u = (i - g.start) * wScale;
        const wi = Math.floor(u);
        const w = table[wi]! + (table[wi + 1]! - table[wi]!) * (u - wi);
        const s = sample * w;
        const j = i - from;
        blockL[j] = blockL[j]! + s * gl;
        blockR[j] = blockR[j]! + s * gr;
        pos += step;
      }
      g.pos = pos;
      if (gEnd <= to) {
        const last = grains.pop()!;
        if (last !== g) grains[gi] = last;
        pool.push(g);
      }
    }
  }

  let pedalDown = false;
  return {
    totalFrames: total,
    process(outL, outR, offset, frames) {
      let done = 0;
      while (done < frames) {
        if (t >= total) return false;
        const n = Math.min(
          CONTROL_FRAMES - (t % CONTROL_FRAMES),
          frames - done,
          total - t,
        );
        // Lanes are read on 32-frame control boundaries only, so any block
        // split renders the same samples.
        if (init.held && t % CONTROL_FRAMES === 0) pedalDown = init.held(t);
        if (lanes.length > 0 && t % CONTROL_FRAMES === 0) {
          for (const lane of lanes) live[lane.name] = lane.at(t);
          if (!grid) shape();
          scanStep = p.freeze ? 0 : p.scan * frameStep;
        }
        // Grid points of this block: the grid keeps running through the
        // release, so the release fades a living cloud (spec: release ~ T60).
        while (nextGrid < t + n && t < spawnEnd) spawn();
        const cents = init.cents ? init.cents(t / sr) : 0;
        const centsMul = cents === 0 ? 1 : 2 ** (cents / 1200);
        renderGrains(t, n, centsMul);
        if (!pedalDown) scanned += scanStep * n;
        for (let i = 0; i < n; i += 1) {
          let l = blockL[i]!;
          let r = blockR[i]!;
          if (lpA < 1) {
            lp += lpA * (l - lp);
            lpR += lpA * (r - lpR);
            l = lp;
            r = lpR;
          }
          const e = envelope(t + i) * amp;
          const at = offset + done + i;
          outL[at] = outL[at]! + l * e;
          outR[at] = outR[at]! + r * e;
        }
        t += n;
        done += n;
      }
      return t < total;
    },
  };
}

// ------------------------------------------------------------- sources

const synthSources = new Map<string, BankSource>();
const MAX_SYNTH_SOURCES = 16;
/** Envelope hop of the held-loop analysis. */
const LOOP_HOP_SECONDS = 0.01;
/** The loop starts once the render is within 6 dB of its loudest hop. */
const LOOP_START_DB = -6;
/** ... and ends at the last hop within 30 dB of it. */
const LOOP_END_DB = -30;
/** The loop is levelled by at most this much (a decaying bell or pluck). */
const LOOP_MAX_GAIN_DB = 30;
const LOOP_FADE_SECONDS = 0.05;

/**
 * The built-in source: a deterministic offline render of a synth preset
 * (or a sound with `synth` params) held at `note` for 4 s, made into a
 * held, seamless loop so a long note never wraps into silence or through
 * the attack: the sustained part (from 6 dB under the loudest point to
 * 30 dB under it) is levelled to a flat envelope, crossfaded at its seam
 * and tiled to at least 4 s, peak-normalised to 0.7.
 */
export function synthSource(
  name: string,
  note: number,
  sampleRate: number,
  synth?: TrackSynth,
): BankSource {
  const preset = SYNTH_PRESETS[name];
  const params = preset ? preset.synth : synth;
  const id = `synth:${name}@${note}:${sampleRate}${
    !preset && synth ? `:${JSON.stringify(synth)}` : ""
  }`;
  const cached = synthSources.get(id);
  if (cached) return cached;
  const frames = Math.round(SYNTH_SOURCE_SECONDS * sampleRate);
  const track = {
    id: "granular-source",
    name: "granular source",
    instrument: preset ? preset.instrument : name,
    muted: false,
    volume: 1,
    pan: 0,
    ...(params ? { synth: params } : {}),
  } as unknown as Track;
  const left = new Float64Array(frames);
  const ticksPerBeat = 480;
  renderSynthNote(
    left,
    undefined,
    {
      id: "granular-source",
      trackId: track.id,
      startTick: 0,
      durationTicks: ticksPerBeat * 8,
      pitch: note,
      velocity: 1,
    },
    track,
    0,
    frames,
    {
      sampleRate,
      samples: frames,
      samplesPerTick: (sampleRate * 0.5) / ticksPerBeat,
      tempoBpm: 120,
      ticksPerBeat,
    },
    () => 1,
  );
  const data = heldLoop(left, sampleRate);
  const source = Object.freeze({ id, rate: sampleRate, data });
  synthSources.set(id, source);
  while (synthSources.size > MAX_SYNTH_SOURCES) {
    const oldest = synthSources.keys().next().value as string;
    synthSources.delete(oldest);
  }
  return source;
}

/** A held render made into a levelled, seamless loop (see synthSource). */
export function heldLoop(
  render: Float64Array,
  sampleRate: number,
): Float32Array {
  const frames = render.length;
  const hop = Math.max(1, Math.round(LOOP_HOP_SECONDS * sampleRate));
  const hops = Math.max(1, Math.floor(frames / hop));
  const rms = new Float64Array(hops);
  let loudest = 0;
  for (let h = 0; h < hops; h += 1) {
    let sum = 0;
    for (let i = h * hop; i < (h + 1) * hop; i += 1)
      sum += render[i]! * render[i]!;
    rms[h] = Math.sqrt(sum / hop);
    if (rms[h]! > loudest) loudest = rms[h]!;
  }
  if (loudest === 0) return new Float32Array(frames);
  const startLevel = loudest * 10 ** (LOOP_START_DB / 20);
  const endLevel = loudest * 10 ** (LOOP_END_DB / 20);
  let first = 0;
  while (first < hops - 1 && rms[first]! < startLevel) first += 1;
  let last = hops - 1;
  while (last > first && rms[last]! < endLevel) last -= 1;
  const begin = first * hop;
  const stop = Math.min(frames, (last + 1) * hop);
  const fade = Math.max(
    1,
    Math.min(
      Math.round(LOOP_FADE_SECONDS * sampleRate),
      Math.floor((stop - begin) / 4),
    ),
  );
  const loop = Math.max(1, stop - begin - fade);
  // Level the loop: gain = loudest / envelope (hop centres, interpolated).
  const maxGain = 10 ** (LOOP_MAX_GAIN_DB / 20);
  const levelled = new Float64Array(loop + fade);
  for (let i = 0; i < loop + fade; i += 1) {
    const frame = begin + i;
    const x = frame / hop - 0.5;
    const h0 = Math.max(0, Math.min(hops - 1, Math.floor(x)));
    const h1 = Math.min(hops - 1, h0 + 1);
    const f = Math.max(0, Math.min(1, x - h0));
    const env = rms[h0]! + (rms[h1]! - rms[h0]!) * f;
    const gain = env > 0 ? Math.min(maxGain, loudest / env) : maxGain;
    levelled[i] = (render[frame] ?? 0) * gain;
  }
  // Seam: the head of the loop fades in while the frames after its end
  // fade out (equal power), so loop[last] -> loop[0] continues the render.
  const seamless = new Float64Array(loop);
  for (let i = 0; i < loop; i += 1) seamless[i] = levelled[i]!;
  for (let i = 0; i < fade && i < loop; i += 1) {
    const u = (i + 0.5) / fade;
    seamless[i] =
      levelled[i]! * Math.sin((u * Math.PI) / 2) +
      levelled[loop + i]! * Math.cos((u * Math.PI) / 2);
  }
  const copies = Math.max(1, Math.ceil(frames / loop));
  const out = new Float32Array(loop * copies);
  let peak = 0;
  for (let i = 0; i < loop; i += 1)
    peak = Math.max(peak, Math.abs(seamless[i]!));
  const g = peak > 0 ? 0.7 / peak : 0;
  for (let c = 0; c < copies; c += 1)
    for (let i = 0; i < loop; i += 1) out[c * loop + i] = seamless[i]! * g;
  return out;
}

/** The bank key of a granular track's sample source. */
export function granularSampleKey(trackId: string): string {
  return `${trackId}\u0000${GRANULAR_SOURCE_VOICE}`;
}

type ResolvedSource = Readonly<{ source: BankSource; root: number }>;

/** The track's source and the note that plays it at its own pitch. */
export function granularSource(
  track: Track,
  sampleRate: number,
  bank: SampleBank,
): ResolvedSource | undefined {
  const s = resolveGranular(track.granular);
  const src = s.src;
  const stored = track.granular?.root;
  if (typeof src === "string") {
    const parsed =
      parseSynthSource(src) ?? parseSynthSource(DEFAULT_GRANULAR_SOURCE)!;
    // A sound (not a preset) plays with the track's own synth params, so
    // `grain on` grains the track's tuned sound.
    return {
      source: synthSource(parsed.name, parsed.note, sampleRate, track.synth),
      root: stored ?? parsed.note,
    };
  }
  const decoded: DecodedSample | undefined = bank.voices.get(
    granularSampleKey(track.id),
  );
  if (!decoded || decoded.frames === 0) return undefined;
  const ref: SampleRef = src;
  return {
    source: {
      id: decoded.sha256,
      rate: decoded.sampleRate,
      data: decoded.mono,
    },
    root: stored ?? ref.root ?? 60,
  };
}

// --------------------------------------------------------------- engine

/**
 * Seeds by (seed, track, pitch, startTick, occurrence). The start is the
 * performed one, so humanize timing (amount or seed) also changes the
 * grain draws; edits elsewhere in the track do not.
 */
export function granularSeeds(
  notes: readonly PerformedNote[],
  seed: number,
  trackId: string,
): number[] {
  const seen = new Map<string, number>();
  return notes.map((note) => {
    const at = `${note.pitch}:${note.startTick}`;
    const occurrence = seen.get(at) ?? 0;
    seen.set(at, occurrence + 1);
    return seedHash(`${seed}:${trackId}:${at}:${occurrence}`);
  });
}

function spanOf(
  note: PerformedNote,
  context: EngineContext,
): { start: number; length: number } {
  if (context.warp)
    return warpedSpan(context.warp, note.startTick, note.durationTicks);
  const { tempoBpm, sampleRate } = context;
  const tpb = context.ticksPerBeat;
  return {
    start: Math.max(
      0,
      Math.floor((((note.startTick / tpb) * 60) / tempoBpm) * sampleRate),
    ),
    length: Math.max(
      1,
      Math.floor((((note.durationTicks / tpb) * 60) / tempoBpm) * sampleRate),
    ),
  };
}

/** Renders a granular track's performed notes into `left`/`right`. */
export function renderGranularTrack(
  left: Float64Array,
  right: Float64Array,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
  bank: SampleBank,
): void {
  const resolved = granularSource(track, context.sampleRate, bank);
  if (!resolved) return;
  const settings = resolveGranular(track.granular);
  const sr = context.sampleRate;
  const seeds = granularSeeds(notes, settings.seed, track.id);
  const rootHz = noteHz(resolved.root, undefined, context.tuning);
  // Plan: spans, then voice stealing (16 per track, oldest first).
  type Plan = {
    note: PerformedNote;
    seed: number;
    start: number;
    length: number;
    end: number;
    cut: number;
  };
  const tail = Math.round(granularTailSeconds(track.granular) * sr);
  let plans: Plan[] = notes.map((note, index) => {
    const { start, length } = spanOf(note, context);
    return {
      note,
      seed: seeds[index]!,
      start,
      length,
      end: start + length + tail,
      cut: Infinity,
    };
  });
  // Mono (0.6.1): notes that overlap the one before (legato) join its
  // voice, which retargets pitch at each note's start and keeps its grain
  // stream; a detached note cuts the previous voice's tail.
  const chains = new Map<Plan, Plan[]>();
  if (settings.mono && plans.length > 1) {
    const sorted = [...plans].sort((a, b) => a.start - b.start);
    const heads: Plan[] = [];
    let head: Plan | undefined;
    for (const plan of sorted) {
      if (head && plan.start < head.start + head.length) {
        chains.get(head)!.push(plan);
        head.length = Math.max(
          head.length,
          plan.start + plan.length - head.start,
        );
        head.end = head.start + head.length + tail;
        continue;
      }
      if (head && head.end > plan.start) head.cut = plan.start;
      head = plan;
      chains.set(plan, [plan]);
      heads.push(plan);
    }
    plans = heads;
  }
  const order = plans
    .map((_, index) => index)
    .sort((a, b) => plans[a]!.start - plans[b]!.start || a - b);
  const active: Plan[] = [];
  for (const index of order) {
    const plan = plans[index]!;
    for (let i = active.length - 1; i >= 0; i -= 1)
      if (Math.min(active[i]!.end, active[i]!.cut) <= plan.start)
        active.splice(i, 1);
    if (active.length >= MAX_VOICES) {
      // Oldest released voice first (active is in start order), else the
      // oldest held one.
      let at = active.findIndex(
        (candidate) => candidate.start + candidate.length <= plan.start,
      );
      if (at < 0) at = 0;
      const victim = active.splice(at, 1)[0]!;
      victim.cut = plan.start;
    }
    active.push(plan);
  }
  const stealFrames = Math.max(1, Math.round(STEAL_SECONDS * sr));
  const block = 4096;
  const outL = new Float64Array(block);
  const outR = new Float64Array(block);
  const volume = Math.max(0, Math.min(1, track.volume ?? 1));
  const lane = track.volumeAutomation ?? [];
  const tickOf = (frame: number): number =>
    context.warp
      ? context.warp.tick(frame)
      : frame / Math.max(1e-9, context.samplesPerTick);
  const frameOf = (tick: number): number =>
    context.warp ? context.warp.sample(tick) : tick * context.samplesPerTick;
  const grainLanes = GRANULAR_LANE_PARAMS.flatMap(({ param }) => {
    const points = track.fxAutomation?.[`grain-${param}` as FxLane];
    return points && points.length > 0 ? [{ param, points }] : [];
  });
  const syncBeats =
    settings.sync === "off" ? undefined : GRAIN_SYNC_BEATS[settings.sync];
  const allowed =
    settings.quant === "off"
      ? undefined
      : quantPitchClasses(context.score, settings.quant, context.quantChord);
  const pedal = settings.pedal ? track.pedal : undefined;
  for (const plan of plans) {
    const { note } = plan;
    if (plan.start >= left.length) continue;
    const hz = noteHz(note.pitch, note.cents, context.tuning);
    const performance = note.performance;
    const chain = chains.get(plan);
    const startTick = note.startTick;
    const startFrame = plan.start;
    let cents = performance?.cents;
    if (chain && chain.length > 1) {
      // Retarget: the cents of each chained note's pitch over the first's,
      // from its start, plus that note's own bend/glide/vibrato.
      const steps = chain.map((item) => ({
        from: (item.start - startFrame) / sr,
        cents:
          1200 *
          Math.log2(
            noteHz(item.note.pitch, item.note.cents, context.tuning) / hz,
          ),
        perf: item.note.performance?.cents,
        offset: (item.start - startFrame) / sr,
      }));
      cents = (t: number) => {
        let at = 0;
        while (at + 1 < steps.length && steps[at + 1]!.from <= t) at += 1;
        const step = steps[at]!;
        return step.cents + (step.perf ? step.perf(t - step.offset) : 0);
      };
    }
    const lanes = grainLanes.map(({ param, points }) => {
      const fallback = settings[param as keyof typeof settings] as number;
      return {
        name: param,
        at: (frame: number) =>
          interpolateAutomation(points, tickOf(startFrame + frame), fallback),
      };
    });
    let grid: ((k: number) => number) | undefined;
    let gridPeriod: ((k: number) => number) | undefined;
    if (syncBeats !== undefined) {
      const stepTicks = syncBeats * context.ticksPerBeat;
      const at = startTick / stepTicks;
      const k0 = Math.round(at);
      if (Math.abs(at - k0) < 1e-9)
        grid = (k: number) => frameOf((k0 + k) * stepTicks) - startFrame;
      else {
        // Off the grid (humanize, swing, a played note): the first grain
        // sounds at note-on, the rest follow the grid from the next point.
        const first = Math.floor(at) + 1;
        const point = (k: number) =>
          frameOf((first + k) * stepTicks) - startFrame;
        grid = (k: number) => (k === 0 ? 0 : point(k - 1));
        gridPeriod = (k: number) =>
          k === 0 ? point(1) - point(0) : point(k) - point(k - 1);
      }
    }
    const quant = allowed
      ? (semis: number, frame: number) =>
          snapSemis(note.pitch, semis, allowed(tickOf(startFrame + frame)))
      : undefined;
    const held =
      pedal && pedal.length > 0
        ? (frame: number) =>
            pedalStateAt(pedal, tickOf(startFrame + frame)) === "down"
        : undefined;
    const voice = granularVoice({
      source: resolved.source,
      sr,
      settings,
      baseRate: hz / rootHz,
      velocity: Math.max(0, Math.min(1, note.velocity)),
      gateFrames: plan.length,
      ...(cents ? { cents } : {}),
      ...(performance?.damp ? { damp: performance.damp } : {}),
      seed: plan.seed,
      ...(lanes.length > 0 ? { lanes } : {}),
      ...(grid ? { grid } : {}),
      ...(gridPeriod ? { gridPeriod } : {}),
      ...(quant ? { quant } : {}),
      ...(held ? { held } : {}),
    });
    const stop = Math.min(
      left.length,
      plan.start + voice.totalFrames,
      plan.cut === Infinity ? Infinity : plan.cut + stealFrames,
    );
    for (let at = plan.start; at < stop; at += block) {
      const n = Math.min(block, stop - at);
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      const alive = voice.process(outL, outR, 0, n);
      for (let i = 0; i < n; i += 1) {
        const frame = at + i;
        const tick = context.warp
          ? context.warp.tick(frame)
          : note.startTick +
            (frame - plan.start) / Math.max(1e-9, context.samplesPerTick);
        let g =
          volume * (lane.length > 0 ? interpolateAutomation(lane, tick, 1) : 1);
        if (frame >= plan.cut)
          g *= Math.max(0, 1 - (frame - plan.cut) / stealFrames);
        left[frame] = left[frame]! + outL[i]! * g;
        right[frame] = right[frame]! + outR[i]! * g;
      }
      if (!alive) break;
    }
  }
}

/**
 * The tracks whose notes make the `quant chord` harmony: pitched and not
 * muted in the song. Granular tracks, kits, one-shot samplers and
 * resampled audio (a ref with `from`, one held note) are left out, so a
 * resampled bus does not add its trigger pitch to every chord. Solo is
 * ignored: soloing a track (or a resample's soloed source) keeps the
 * song's chords.
 */
function harmonicTrack(track: Track): boolean {
  if (track.muted === true) return false;
  if (
    track.granular !== undefined ||
    track.instrument === "kit" ||
    track.kit !== undefined
  )
    return false;
  if (track.sampler || track.instrument === "sampler") {
    const sampler = track.sampler;
    if (!sampler || sampler.mode !== "keyed") return false;
    if (Object.values(sampler.voices).some((ref) => ref.from !== undefined))
      return false;
  }
  return true;
}

/**
 * Pitch classes sounding on the harmonic tracks, as change points:
 * `sets[i]` sounds from `ticks[i]` to `ticks[i + 1]`.
 */
export type ChordTimeline = Readonly<{
  ticks: readonly number[];
  sets: readonly (readonly number[])[];
}>;

const timelines = new WeakMap<TrackScore, ChordTimeline>();

/** The song's chord timeline (computed once per score object). */
export function chordTimeline(score: TrackScore): ChordTimeline {
  const known = timelines.get(score);
  if (known) return known;
  const harmonic = new Set(
    score.tracks.filter(harmonicTrack).map((track) => track.id),
  );
  const events = new Map<number, number[]>();
  const add = (tick: number, pc: number, delta: number) => {
    let row = events.get(tick);
    if (!row) events.set(tick, (row = new Array<number>(12).fill(0)));
    row[pc] = row[pc]! + delta;
  };
  for (const note of score.notes) {
    if (!harmonic.has(note.trackId) || note.durationTicks <= 0) continue;
    const pc = ((note.pitch % 12) + 12) % 12;
    add(note.startTick, pc, 1);
    add(note.startTick + note.durationTicks, pc, -1);
  }
  const counts = new Array<number>(12).fill(0);
  const ticks: number[] = [];
  const sets: number[][] = [];
  for (const tick of [...events.keys()].sort((a, b) => a - b)) {
    const row = events.get(tick)!;
    for (let pc = 0; pc < 12; pc += 1) counts[pc] = counts[pc]! + row[pc]!;
    ticks.push(tick);
    sets.push(counts.flatMap((count, pc) => (count > 0 ? [pc] : [])));
  }
  const timeline = Object.freeze({ ticks, sets });
  timelines.set(score, timeline);
  return timeline;
}

/** The classes sounding at `tick` (empty when nothing sounds). */
export function chordAt(
  timeline: ChordTimeline,
  tick: number,
): readonly number[] {
  const { ticks, sets } = timeline;
  let lo = 0;
  let hi = ticks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid]! <= tick) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? [] : sets[found]!;
}

/**
 * The chord changes between two ticks, relative to `from`, as a stable
 * string: what a `quant chord` render over that span reads.
 */
export function chordDigest(
  timeline: ChordTimeline,
  from = -Infinity,
  to = Infinity,
): string {
  const parts: string[] = [chordAt(timeline, from).join(".")];
  for (let i = 0; i < timeline.ticks.length; i += 1) {
    const tick = timeline.ticks[i]!;
    if (tick > from && tick < to)
      parts.push(
        `${Number.isFinite(from) ? tick - from : tick}:${timeline.sets[i]!.join(".")}`,
      );
  }
  return `chord:${parts.join(",")}`;
}

/**
 * `quant` (0.6.1): the pitch classes grains may land on at a tick. `scale`
 * is the song key's scale (chromatic without a key); `chord` is the pitch
 * classes sounding on the song's harmonic tracks at the tick (see
 * `harmonicTrack`), falling back to the scale when nothing else sounds
 * (Ableton Granulator and Bitwig's scale-quantised grain pitch work the
 * same way). `chord` reads `source` (the whole song for a live note) at
 * `tick + offset`.
 */
export function quantPitchClasses(
  score: TrackScore,
  mode: "scale" | "chord",
  source?: Readonly<{ score: TrackScore; tick: number }>,
): (tick: number) => readonly number[] {
  const key = parseKey(score.key ?? undefined);
  const scale = key ? scaleOf(key) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  if (mode === "scale") return () => scale;
  const timeline = chordTimeline(source?.score ?? score);
  const offset = source?.tick ?? 0;
  return (tick: number) => {
    const set = chordAt(timeline, tick + offset);
    return set.length > 0 ? set : scale;
  };
}

/** A grain's semitone offset over `pitch`, snapped to the nearest class. */
export function snapSemis(
  pitch: number,
  semis: number,
  classes: readonly number[],
): number {
  const target = pitch + semis;
  const base = Math.round(target);
  let best = base;
  let bestDistance = Infinity;
  for (let d = 0; d <= 6; d += 1)
    for (const candidate of d === 0 ? [base] : [base - d, base + d]) {
      if (!classes.includes(((candidate % 12) + 12) % 12)) continue;
      const distance = Math.abs(candidate - target);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  return best - pitch;
}

/** The registered engine (`src/audio/instruments.ts`). */
export const GRANULAR_ENGINE: InstrumentEngine = Object.freeze({
  id: "granular",
  field: "granular",
  render(dry, dryR, notes, track, context, bank) {
    const right = dryR ?? new Float64Array(dry.length);
    renderGranularTrack(dry, right, notes, track, context, bank);
    if (!dryR)
      for (let i = 0; i < dry.length; i += 1)
        dry[i] = 0.5 * (dry[i]! + right[i]!);
  },
  tailSeconds: (track: Track) => granularTailSeconds(track.granular),
  stereo: () => true,
  assetDigests(
    track: Track,
    bank: SampleBank,
    score?: TrackScore,
  ): readonly string[] {
    const src = track.granular?.src;
    const digests: string[] = [];
    if (src !== undefined && typeof src !== "string") {
      const decoded = bank.voices.get(granularSampleKey(track.id));
      digests.push(decoded ? decoded.sha256 : "missing");
    }
    // `quant chord` reads the other tracks' notes: their chords join the
    // stem key, so a cached stem re-renders when the harmony changes.
    if (score && resolveGranular(track.granular).quant === "chord")
      digests.push(chordDigest(chordTimeline(score)));
    return digests;
  },
});
