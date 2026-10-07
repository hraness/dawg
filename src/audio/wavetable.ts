/**
 * Wavetable oscillator: tables, band-limited mipmaps and the per-note voice.
 *
 * A wavetable is a stack of single-cycle frames. dawg keeps each frame as its
 * harmonic spectrum (up to `MAX_HARMONICS`), and builds playable tables from
 * it lazily: one table per frame per octave, each holding only the harmonics
 * that stay below Nyquist for notes in that octave. A note reads the level
 * whose top harmonic times the note frequency is at most Nyquist, so nothing
 * folds back. Tables are oversampled 8× (4× for the 1024-harmonic level) and
 * read with 4-point Hermite interpolation; neighbouring frames are mixed
 * linearly by the fractional position, which makes `wt` sweeps smooth.
 *
 * Strudel names: `wt` (position 0..1), `wtenv`/`wtattack`/`wtdecay`/
 * `wtsustain`/`wtrelease` (position envelope), `wtrate`/`wtdepth` (position
 * LFO), `warp`/`warpmode` and `wtphaserand`. The maths here is dawg's own,
 * written from Strudel's public parameter docs; no Strudel code is used.
 *
 * File tables follow the Serum/Vital WAV convention: a `clm ` chunk reading
 * `<!>2048 …` gives the frame length; without it a file whose length is a
 * multiple of 2048 samples is 2048-sample frames, and anything else is one
 * single-cycle frame (the AKWF convention).
 *
 * Everything is plain float64 arithmetic in a fixed order, so the same table
 * and score render byte-identical audio inline, in the worker and from a
 * warm or cold cache.
 */
import {
  BUILTIN_TABLE_PREFIX,
  WAVETABLE_INSTRUMENT,
  WAVETABLE_PARAMS,
  type Note,
  type Track,
  type TrackWavetable,
  type WarpMode,
} from "../../core/score.ts";
import { decodeWav, monoMix, nativeFormat } from "./samples.ts";
import {
  registerOscillatorResolver,
  type OscillatorFactory,
} from "./synth/oscillators.ts";

/** Harmonics kept per frame (a 2048-sample frame holds 1024). */
export const MAX_HARMONICS = 1024;
/** Frames kept per table; longer files are truncated. */
export const MAX_FRAMES = 512;
/** Default frame length when a file has no `clm ` chunk. */
export const DEFAULT_FRAME = 2048;
/** Longest single-cycle frame accepted. */
const MAX_FRAME = 8192;
/** Octave levels: level k keeps `MAX_HARMONICS >> k` harmonics. */
const LEVELS = 11;

export class WavetableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavetableError";
  }
}

/** One frame's spectrum: cosine and sine amplitudes for harmonics 1..H. */
type Spectrum = Readonly<{ re: Float64Array; im: Float64Array }>;

/**
 * A loaded table. `spectrum(i)` is cheap after the first call; mipmap levels
 * are built on demand and memoized on the instance.
 */
export class Wavetable {
  public readonly name: string;
  public readonly frames: number;
  /** Content hash of the source file, or `builtin:<name>`. */
  public readonly id: string;
  private readonly spectra: (Spectrum | undefined)[];
  private readonly source: (index: number) => Spectrum;
  private readonly levels: (Float64Array | undefined)[][] = [];
  private scale: number | undefined;

  public constructor(
    name: string,
    id: string,
    frames: number,
    source: (index: number) => Spectrum,
  ) {
    if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES)
      throw new WavetableError(`${name} · needs 1..${MAX_FRAMES} frames`);
    this.name = name;
    this.id = id;
    this.frames = frames;
    this.source = source;
    this.spectra = new Array<Spectrum | undefined>(frames);
    for (let level = 0; level < LEVELS; level += 1)
      this.levels.push(new Array<Float64Array | undefined>(frames));
  }

  public spectrum(index: number): Spectrum {
    let spectrum = this.spectra[index];
    if (!spectrum) {
      spectrum = this.source(index);
      this.spectra[index] = spectrum;
    }
    return spectrum;
  }

  /**
   * Gain that brings the loudest frame (full bandwidth) to peak 1. Computed
   * once over every frame so position sweeps keep their relative levels.
   */
  public gain(): number {
    if (this.scale === undefined) {
      let peak = 0;
      for (let frame = 0; frame < this.frames; frame += 1) {
        const table = this.table(frame, 0);
        for (let i = 0; i < table.length; i += 1)
          peak = Math.max(peak, Math.abs(table[i]!));
      }
      this.scale = peak > 1e-9 ? 1 / peak : 0;
    }
    return this.scale;
  }

  /** The playable table for one frame at one octave level. */
  public table(frame: number, level: number): Float64Array {
    const row = this.levels[level]!;
    let table = row[frame];
    if (!table) {
      table = synthesizeLevel(this.spectrum(frame), MAX_HARMONICS >> level);
      row[frame] = table;
    }
    return table;
  }
}

/** Table length for a level: oversampled so Hermite reads stay clean. */
function levelSize(harmonics: number): number {
  return Math.min(4096, Math.max(256, harmonics * 8));
}

function synthesizeLevel(spectrum: Spectrum, harmonics: number): Float64Array {
  const size = levelSize(harmonics);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const top = Math.min(harmonics, spectrum.re.length - 1, size / 2 - 1);
  // x[n] = Σ re_h cos(2πhn/N) + im_h sin(2πhn/N). With X[h] = (re - i·im)/2
  // and its conjugate at N-h, the inverse DFT gives exactly that sum.
  for (let h = 1; h <= top; h += 1) {
    re[h] = spectrum.re[h]! / 2;
    im[h] = -spectrum.im[h]! / 2;
    re[size - h] = spectrum.re[h]! / 2;
    im[size - h] = spectrum.im[h]! / 2;
  }
  fft(re, im, true);
  return re;
}

/**
 * In-place iterative radix-2 FFT. `inverse` uses e^{+i} and no scaling, so
 * inverse(forward(x)) = N·x.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n & (n - 1)) throw new WavetableError("fft size must be a power of two");
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length <<= 1) {
    const half = length >> 1;
    const step = (sign * 2 * Math.PI) / length;
    for (let k = 0; k < half; k += 1) {
      const wr = Math.cos(step * k);
      const wi = Math.sin(step * k);
      for (let start = k; start < n; start += length) {
        const a = start;
        const b = start + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
      }
    }
  }
}

/** Spectrum of one time-domain cycle (any length; FFT when a power of two). */
export function analyzeFrame(samples: Float32Array | Float64Array): Spectrum {
  const n = samples.length;
  const harmonics = Math.min(MAX_HARMONICS, Math.floor((n - 1) / 2));
  const outRe = new Float64Array(harmonics + 1);
  const outIm = new Float64Array(harmonics + 1);
  if ((n & (n - 1)) === 0) {
    const re = Float64Array.from(samples);
    const im = new Float64Array(n);
    fft(re, im);
    for (let h = 1; h <= harmonics; h += 1) {
      outRe[h] = (2 * re[h]!) / n;
      outIm[h] = (-2 * im[h]!) / n;
    }
  } else {
    for (let h = 1; h <= harmonics; h += 1) {
      let sumRe = 0;
      let sumIm = 0;
      const w = (2 * Math.PI * h) / n;
      for (let i = 0; i < n; i += 1) {
        sumRe += samples[i]! * Math.cos(w * i);
        sumIm += samples[i]! * Math.sin(w * i);
      }
      outRe[h] = (2 * sumRe) / n;
      outIm[h] = (2 * sumIm) / n;
    }
  }
  return Object.freeze({ re: outRe, im: outIm });
}

// ---------------------------------------------------------------------------
// File tables

/** Frame length a WAV announces in a Serum-style `clm ` chunk (`<!>2048 …`). */
export function clmFrameLength(bytes: Uint8Array): number | undefined {
  if (nativeFormat(bytes) !== "wav") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "clm ") {
      const text = String.fromCharCode(
        ...bytes.subarray(
          offset + 8,
          Math.min(bytes.byteLength, offset + 8 + Math.min(size, 64)),
        ),
      );
      const match = /^<!>(\d{1,5})/.exec(text);
      return match ? Number(match[1]) : undefined;
    }
    offset += 8 + size + (size & 1);
  }
  return undefined;
}

/** Splits a mono signal into frames the way the module doc describes. */
export function sliceFrames(
  mono: Float32Array,
  clm?: number,
): readonly Float32Array[] {
  let length: number;
  if (clm !== undefined && clm >= 8 && clm <= MAX_FRAME) length = clm;
  else if (mono.length >= DEFAULT_FRAME && mono.length % DEFAULT_FRAME === 0)
    length = DEFAULT_FRAME;
  else length = mono.length;
  if (length < 8)
    throw new WavetableError("too short for a single-cycle frame (8 samples)");
  if (length > MAX_FRAME)
    throw new WavetableError(
      `a ${mono.length}-sample file without a clm chunk is not a wavetable · frames are at most ${MAX_FRAME} samples`,
    );
  const count = Math.min(MAX_FRAMES, Math.floor(mono.length / length));
  const frames: Float32Array[] = [];
  for (let index = 0; index < count; index += 1)
    frames.push(mono.subarray(index * length, (index + 1) * length));
  return frames;
}

/** A table from WAV bytes (decoded natively; the frame layout from `clm `). */
export function wavetableFromWav(
  name: string,
  sha256: string,
  bytes: Uint8Array,
): Wavetable {
  if (nativeFormat(bytes) !== "wav")
    throw new WavetableError(`${name} · wavetables must be WAV files`);
  const mono = monoMix(decodeWav(bytes));
  const frames = sliceFrames(mono, clmFrameLength(bytes));
  return new Wavetable(name, sha256, frames.length, (index) =>
    analyzeFrame(frames[index]!),
  );
}

// ---------------------------------------------------------------------------
// Built-in tables (generated, so wavetables work offline)

type BuiltinSpec = Readonly<{
  title: string;
  frames: number;
  /** Amplitude of harmonic h (sine phase) at morph position 0..1. */
  harmonic: (h: number, x: number) => number;
}>;

const PI = Math.PI;

function shapes(h: number): [number, number, number, number] {
  const odd = h % 2 === 1;
  const sine = h === 1 ? 1 : 0;
  const triangle = odd
    ? ((((h - 1) / 2) % 2 === 0 ? 1 : -1) * 8) / (PI * PI * h * h)
    : 0;
  const saw = ((h % 2 === 1 ? 1 : -1) * 2) / (PI * h);
  const square = odd ? 4 / (PI * h) : 0;
  return [sine, triangle, saw, square];
}

/** Vowel formant centres (Hz) for a, e, i, o, u, assuming a 110 Hz cycle. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [800, 1150, 2900],
  [400, 1600, 2700],
  [350, 2300, 3000],
  [450, 800, 2830],
  [325, 700, 2530],
];

export const BUILTIN_TABLES: Readonly<Record<string, BuiltinSpec>> =
  Object.freeze({
    basic: {
      title: "sine → triangle → saw → square",
      frames: 64,
      harmonic: (h, x) => {
        const s = shapes(h);
        const at = x * 3;
        const i = Math.min(2, Math.floor(at));
        const t = at - i;
        return s[i]! * (1 - t) + s[i + 1]! * t;
      },
    },
    pwm: {
      title: "pulse width 50% → 5%",
      frames: 64,
      // A pulse of duty d, centred so it stays in sine phase: 4/(πh)·sin(πhd).
      harmonic: (h, x) => {
        const duty = 0.5 - 0.45 * x;
        return (4 / (PI * h)) * Math.sin(PI * h * duty) * 0.5;
      },
    },
    formant: {
      title: "vowels a → e → i → o → u",
      frames: 64,
      harmonic: (h, x) => {
        const at = x * (VOWELS.length - 1);
        const i = Math.min(VOWELS.length - 2, Math.floor(at));
        const t = at - i;
        const hz = h * 110;
        let amplitude = 0;
        VOWELS[i]!.forEach((centre, k) => {
          const c = centre * (1 - t) + VOWELS[i + 1]![k]! * t;
          const width = 90 + 40 * k;
          amplitude += Math.exp(-(((hz - c) / width) ** 2)) / (1 + k);
        });
        return h > 64 ? 0 : amplitude * (h % 2 === 0 ? -1 : 1);
      },
    },
    harmonics: {
      title: "additive: 1 → 32 harmonics",
      frames: 32,
      harmonic: (h, x) => {
        const count = 1 + Math.round(x * 31);
        return h <= count ? 1 / h : 0;
      },
    },
  });

export const BUILTIN_TABLE_NAMES = Object.freeze(Object.keys(BUILTIN_TABLES));

const builtinCache = new Map<string, Wavetable>();

export function builtinWavetable(name: string): Wavetable | undefined {
  const spec = BUILTIN_TABLES[name];
  if (!spec) return undefined;
  let table = builtinCache.get(name);
  if (!table) {
    table = new Wavetable(
      name,
      `${BUILTIN_TABLE_PREFIX}${name}`,
      spec.frames,
      (index) => {
        const x = spec.frames === 1 ? 0 : index / (spec.frames - 1);
        const re = new Float64Array(MAX_HARMONICS + 1);
        const im = new Float64Array(MAX_HARMONICS + 1);
        for (let h = 1; h <= MAX_HARMONICS; h += 1) im[h] = spec.harmonic(h, x);
        return Object.freeze({ re, im });
      },
    );
    builtinCache.set(name, table);
  }
  return table;
}

// ---------------------------------------------------------------------------
// Voice

/** Wavetables loaded for a render, keyed by track id. */
export type WavetableSet = ReadonlyMap<string, Wavetable>;

/** The table a wavetable track plays: loaded pack table, else a built-in. */
export function tableFor(
  track: Track,
  settings: TrackWavetable,
  loaded: WavetableSet | undefined,
): Wavetable | undefined {
  const src = settings.table.src;
  if (src.startsWith(BUILTIN_TABLE_PREFIX))
    return builtinWavetable(src.slice(BUILTIN_TABLE_PREFIX.length));
  return loaded?.get(track.id);
}

function param(settings: TrackWavetable, name: keyof typeof WAVETABLE_PARAMS) {
  return settings[name] ?? WAVETABLE_PARAMS[name][2];
}

/**
 * The phase map for a warp mode at amount `w` (0..1), and the steepest slope
 * it reaches (the factor the band limit must allow for).
 */
export function warpPhase(
  mode: WarpMode,
  w: number,
): { map: (phase: number) => number; slope: number } {
  if (w <= 0 || mode === "none") return { map: (p) => p, slope: 1 };
  switch (mode) {
    case "asym": {
      // Casio-style phase distortion: the first half of the cycle is read
      // in a shrinking share of the period.
      const knee = 0.5 - 0.49 * w;
      return {
        map: (p) =>
          p < knee ? (0.5 * p) / knee : 0.5 + (0.5 * (p - knee)) / (1 - knee),
        slope: 0.5 / knee,
      };
    }
    case "bendp": {
      const k = 1 + 3 * w;
      return { map: (p) => p ** k, slope: k };
    }
    case "bendm": {
      const k = 1 + 3 * w;
      return { map: (p) => 1 - (1 - p) ** k, slope: k };
    }
    case "bendmp": {
      // Both halves bend toward the middle of the cycle.
      const k = 1 + 3 * w;
      return {
        map: (p) => (p < 0.5 ? 0.5 * (2 * p) ** k : 1 - 0.5 * (2 - 2 * p) ** k),
        slope: k,
      };
    }
    case "sync": {
      // Hard sync: the table restarts up to 16 times per cycle.
      const ratio = 1 + 15 * w;
      return { map: (p) => (p * ratio) % 1, slope: ratio };
    }
    case "quant": {
      // Phase quantised to 2^(11-10w) steps: a stepped, bit-crushed read.
      const steps = 2 ** Math.round(11 - 10 * w);
      return { map: (p) => Math.floor(p * steps) / steps, slope: 1 };
    }
  }
}

/** Highest level index whose harmonics stay under Nyquist at `frequency`. */
export function levelFor(frequency: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  for (let level = 0; level < LEVELS; level += 1)
    if ((MAX_HARMONICS >> level) * frequency <= nyquist) return level;
  return -1;
}

function hermite(table: Float64Array, position: number): number {
  const size = table.length;
  const mask = size - 1;
  const i = Math.floor(position);
  const t = position - i;
  const y0 = table[(i - 1) & mask]!;
  const y1 = table[i & mask]!;
  const y2 = table[(i + 1) & mask]!;
  const y3 = table[(i + 2) & mask]!;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/** Position envelope value 0..1 at `seconds` into a note held `gate` seconds. */
function positionEnvelope(
  settings: TrackWavetable,
  seconds: number,
  gate: number,
): number {
  const attack = param(settings, "wtattack");
  const decay = param(settings, "wtdecay");
  const sustain = param(settings, "wtsustain");
  const release = param(settings, "wtrelease");
  const held = (t: number) => {
    if (t < attack) return attack > 0 ? t / attack : 1;
    const d = t - attack;
    if (d < decay) return 1 - (1 - sustain) * (decay > 0 ? d / decay : 1);
    return sustain;
  };
  if (seconds <= gate) return held(seconds);
  const after = seconds - gate;
  return release > 0 ? held(gate) * Math.max(0, 1 - after / release) : 0;
}

export type WavetableVoiceContext = Readonly<{
  sampleRate: number;
  samplesPerTick: number;
  /** Seconds per score tick. */
  secondsPerTick: number;
  /** How long the note's key is held, in seconds (the envelope's gate). */
  gate: number;
  /** Track position automation (`wt`) at a tick, if the lane has points. */
  positionAt: ((tick: number) => number) | undefined;
}>;

/**
 * The oscillator factory for one note of a wavetable track, in the shape the
 * synth voice's seam takes (`src/audio/synth/oscillators.ts`): the voice
 * supplies pitch, unison, FM, filters and the amplitude envelope, and calls
 * each instance with a phase in cycles and this sample's phase increment.
 * The band-limit level follows the increment, so vibrato, pitch envelopes
 * and detuned unison voices stay alias-free too.
 */
export function wavetableOscillator(
  table: Wavetable,
  settings: TrackWavetable,
  note: Note,
  context: WavetableVoiceContext,
): OscillatorFactory {
  const warp = warpPhase(settings.warpmode ?? "none", param(settings, "warp"));
  const gain = table.gain();
  const base = param(settings, "wt");
  const envAmount = param(settings, "wtenv");
  const lfoRate = param(settings, "wtrate");
  const lfoDepth = param(settings, "wtdepth");
  const phaseRand = param(settings, "wtphaserand");
  const last = table.frames - 1;
  const startSeconds = note.startTick * context.secondsPerTick;
  const ticksPerSecond = context.sampleRate / context.samplesPerTick;
  return (init) => {
    const startPhase = phaseRand > 0 ? phaseRand * init.random() : 0;
    let lastIncrement = Number.NaN;
    let level = -1;
    return (phase, increment) => {
      if (increment !== lastIncrement) {
        lastIncrement = increment;
        level = levelFor(
          Math.abs(increment) * init.sampleRate * warp.slope,
          init.sampleRate,
        );
      }
      if (level < 0) return 0;
      const seconds = init.time();
      let position = context.positionAt
        ? context.positionAt(note.startTick + seconds * ticksPerSecond)
        : base;
      if (envAmount !== 0)
        position +=
          envAmount * positionEnvelope(settings, seconds, context.gate);
      if (lfoDepth !== 0 && lfoRate > 0)
        position +=
          0.5 *
          lfoDepth *
          Math.sin(2 * PI * lfoRate * (startSeconds + seconds));
      position = Math.max(0, Math.min(1, position));
      const at = position * last;
      const lower = Math.floor(at);
      const mix = at - lower;
      const cycle = startPhase + phase;
      const read = warp.map(cycle - Math.floor(cycle));
      const a = table.table(lower, level);
      let value = hermite(a, read * a.length);
      if (mix > 0 && lower < last) {
        const b = table.table(lower + 1, level);
        value += (hermite(b, read * b.length) - value) * mix;
      }
      return value * gain;
    };
  };
}

/**
 * `instrument: "wavetable"` is a synth-voice sound. Registering it makes the
 * voice treat wavetable tracks like any synth (ADSR, unison, FM, filters);
 * the renderer passes each note the track's own table through
 * `VoiceContext.oscillatorFor`. This fallback (the built-in `basic` table at
 * the track's stored settings) is used only when no table is passed.
 */
registerOscillatorResolver((sound) =>
  sound === WAVETABLE_INSTRUMENT
    ? (init) => {
        const table = builtinWavetable("basic")!;
        const stored = init.param("wt");
        return wavetableOscillator(
          table,
          {
            table: { src: `${BUILTIN_TABLE_PREFIX}basic` },
            ...(typeof stored === "number" ? { wt: stored } : {}),
          },
          {
            id: "",
            trackId: "",
            startTick: 0,
            durationTicks: 1,
            pitch: 60,
            velocity: 1,
          },
          {
            sampleRate: init.sampleRate,
            samplesPerTick: 1,
            secondsPerTick: 1 / init.sampleRate,
            gate: Number.POSITIVE_INFINITY,
            positionAt: undefined,
          },
        )(init);
      }
    : undefined,
);
