/**
 * Monophonic f0 tracker for 0.7 Voice: pYIN-lite (Mauch and Dixon, ICASSP
 * 2014) over YIN's cumulative mean normalised difference (de Cheveigne and
 * Kawahara, JASA 2002).
 *
 * - The input is first resampled to exactly 16 kHz (zero-phase half-band
 *   stages with the Decimate2 taps, then a polyphase windowed-sinc final
 *   stage), so the result does not depend on the source rate.
 * - The difference function comes from one FFT cross-correlation per frame.
 * - Every local minimum of d' is a candidate; a Beta(2, 18) prior over YIN
 *   thresholds gives each its probability (pYIN), and an unvoiced state
 *   takes the rest.
 * - Octave control: a longer-lag dip hands its probability to a dip at a half
 *   or a third of its lag when the shorter one is nearly as deep in d', or
 *   when its raw difference is close and a harmonic comb finds no energy at
 *   the longer period's odd harmonics. A register prior and an octave fold
 *   catch what is left.
 * - A Viterbi pass over candidates plus unvoiced decodes the whole clip, with
 *   a transition cost that grows with the jump in cents.
 *
 * Frame f is centred exactly at t0 + f * hop whatever lag wins. The curve
 * comes back canonical (f0 through Math.fround, prob and aperiodic in 1/255
 * steps), which is exactly what the DWF0 disk cache stores, so a cache hit
 * and a cache miss render the same bytes. Deterministic; no randomness.
 */
import { fftInPlace } from "./fft.ts";
import { halfbandTaps } from "./oversample.ts";

/** Bumped whenever tracker output changes (it keys the disk cache). */
export const PITCH_TRACKER_VERSION = 2;

/** The rate every source is resampled to before tracking. */
export const TRACK_RATE = 16_000;

/** Default hop: 5 ms. */
export const PITCH_HOP_SECONDS = 0.005;

/**
 * Tracker ranges. `auto` starts at 70 Hz because 50/60 Hz hum and its
 * harmonics otherwise read as a voice in the gaps; only `bass` goes to 55.
 */
export const PITCH_VOICES = {
  auto: { fmin: 70, fmax: 1400 },
  bass: { fmin: 55, fmax: 400 },
  tenor: { fmin: 90, fmax: 600 },
  alto: { fmin: 140, fmax: 900 },
  soprano: { fmin: 200, fmax: 1400 },
} as const satisfies Record<string, { fmin: number; fmax: number }>;

export type PitchVoice = keyof typeof PITCH_VOICES;

export const PITCH_VOICE_NAMES = Object.keys(PITCH_VOICES) as PitchVoice[];

export function isPitchVoice(value: unknown): value is PitchVoice {
  return typeof value === "string" && value in PITCH_VOICES;
}

/**
 * The canonical pitch curve. Frame f is centred at `t0 + f * hop` seconds.
 * `f0` is Hz (0 when unvoiced); `prob` is the voicing probability and
 * `aperiodic` the YIN d' at the chosen lag, both in 1/255 steps (255 = 1).
 */
export type PitchCurve = Readonly<{
  t0: number;
  hop: number;
  f0: Float32Array;
  prob: Uint8Array;
  aperiodic: Uint8Array;
}>;

export type TrackOptions = Readonly<{
  /** Range preset (default `auto`, 70-1400 Hz). */
  voice?: PitchVoice;
  /** Overrides of the preset range in Hz. */
  fmin?: number;
  fmax?: number;
  /** Hop in seconds (default 5 ms); rounded to whole 16 kHz samples. */
  hop?: number;
  /** Frames this many dB under the loudest frame are unvoiced (default 45). */
  gateDb?: number;
  /** The harmonic-comb subharmonic check (default on; off for tests). */
  comb?: boolean;
}>;

/** Time of frame `f`. */
export function frameTime(curve: PitchCurve, f: number): number {
  return curve.t0 + f * curve.hop;
}

export function frameCount(curve: PitchCurve): number {
  return curve.f0.length;
}

/** Voicing probability of frame `f`, 0..1. */
export function probAt(curve: PitchCurve, f: number): number {
  return (curve.prob[f] ?? 0) / 255;
}

/** Aperiodicity of frame `f`, 0..1 (1 when unvoiced). */
export function aperiodicAt(curve: PitchCurve, f: number): number {
  return (curve.aperiodic[f] ?? 255) / 255;
}

/** An empty curve (no frames). */
export function emptyCurve(hop = PITCH_HOP_SECONDS): PitchCurve {
  return {
    t0: 0,
    hop,
    f0: new Float32Array(0),
    prob: new Uint8Array(0),
    aperiodic: new Uint8Array(0),
  };
}

// ------------------------------------------------------------ resampling

const HALFBAND = halfbandTaps(47, 8);

/** Zero-phase 2:1 decimation with the Decimate2 half-band taps. */
function halve(x: Float64Array): Float64Array {
  const n = Math.floor(x.length / 2);
  const y = new Float64Array(n);
  const mid = (HALFBAND.length - 1) / 2;
  const taps: number[] = [];
  const offsets: number[] = [];
  for (let k = 0; k < HALFBAND.length; k += 1) {
    if (HALFBAND[k] === 0) continue;
    taps.push(HALFBAND[k]!);
    offsets.push(k - mid);
  }
  const len = x.length;
  for (let j = 0; j < n; j += 1) {
    const c = 2 * j;
    let acc = 0;
    for (let k = 0; k < taps.length; k += 1) {
      const i = c + offsets[k]!;
      if (i >= 0 && i < len) acc += taps[k]! * x[i]!;
    }
    y[j] = acc;
  }
  return y;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

type PolyTable = Readonly<{
  up: number;
  down: number;
  half: number;
  phases: Float64Array[];
}>;

const POLY_TABLES = new Map<string, PolyTable>();

/** Kaiser-windowed sinc phases for a rational `up/down` resampler. */
function polyTable(from: number, to: number): PolyTable {
  const key = `${from}:${to}`;
  const cached = POLY_TABLES.get(key);
  if (cached) return cached;
  const g = gcd(from, to);
  const up = to / g;
  const down = from / g;
  // Cutoff at 0.45 of the lower rate, in cycles per input sample.
  const cut = (0.45 * Math.min(from, to)) / from;
  const half = Math.ceil(12 / (2 * cut));
  const beta = 8;
  const i0b = besselI0(beta);
  const phases: Float64Array[] = [];
  for (let p = 0; p < up; p += 1) {
    const frac = p / up;
    const taps = new Float64Array(2 * half);
    let sum = 0;
    for (let k = 0; k < 2 * half; k += 1) {
      const t = k - half + 1 - frac;
      const arg = 2 * cut * t;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      const r = t / half;
      const w =
        Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      taps[k] = sinc * w;
      sum += taps[k]!;
    }
    for (let k = 0; k < taps.length; k += 1) taps[k]! /= sum;
    phases.push(taps);
  }
  const table = { up, down, half, phases };
  POLY_TABLES.set(key, table);
  return table;
}

/** Zero-phase polyphase resampling between integer rates. */
function polyphase(x: Float64Array, from: number, to: number): Float64Array {
  if (from === to) return x;
  const { up, down, half, phases } = polyTable(from, to);
  const n = Math.floor((x.length * up) / down);
  const y = new Float64Array(n);
  const len = x.length;
  for (let j = 0; j < n; j += 1) {
    const num = j * down;
    const i = Math.floor(num / up);
    const taps = phases[num - i * up]!;
    let acc = 0;
    const base = i - half + 1;
    for (let k = 0; k < taps.length; k += 1) {
      const s = base + k;
      if (s >= 0 && s < len) acc += taps[k]! * x[s]!;
    }
    y[j] = acc;
  }
  return y;
}

/**
 * An exact 16 kHz copy of `x`: half-band halvings while the rate is at least
 * 32 kHz, then one polyphase stage. Sample n sits at n / 16000 seconds.
 */
export function resampleForTracking(
  x: Float64Array,
  sampleRate: number,
): Float64Array {
  let rate = Math.round(sampleRate);
  let y = x;
  while (rate >= 2 * TRACK_RATE && rate % 2 === 0) {
    y = halve(y);
    rate /= 2;
  }
  return polyphase(y, rate, TRACK_RATE);
}

// ------------------------------------------------------------ tracking

// Beta(2, 18) prior over thresholds 0.01..1 (pYIN's default, mean 0.1).
const THRESHOLDS = 100;
const BETA = (() => {
  const w = new Float64Array(THRESHOLDS);
  let s = 0;
  for (let i = 0; i < THRESHOLDS; i += 1) {
    const t = (i + 0.5) / THRESHOLDS;
    w[i] = t * (1 - t) ** 17;
    s += w[i]!;
  }
  for (let i = 0; i < THRESHOLDS; i += 1) w[i]! /= s;
  return w;
})();
const MAX_CANDIDATES = 6;
/** A shorter-lag dip within this much d' of a 2x/3x-lag dip wins. */
const SUBHARMONIC_MARGIN = 0.12;
/** The comb check runs when the short dip's raw difference is under this multiple. */
const SUBHARMONIC_RAW = 6;
/** Non-multiple / multiple harmonic energy under this means "not a real low period". */
const SUBHARMONIC_COMB = 0.3;
/** Candidates further than this from the clip's confident median are down-weighted. */
const REGISTER_CENTS = 1700;

type Dip = { tau: number; v: number; raw: number };
type Frame = {
  tau: number[];
  p: number[];
  ap: number[];
  rms: number;
  v: number;
};

const HANN = new Map<number, Float64Array>();

function hannOf(n: number): Float64Array {
  let w = HANN.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i += 1)
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    HANN.set(n, w);
  }
  return w;
}

/**
 * Goertzel energies at the harmonics k = 1, 2, ... of `rate / lag` up to
 * 4 kHz over a Hann window. `combRatio` reads them for each divisor.
 */
function harmonicEnergies(
  y: Float64Array,
  start: number,
  size: number,
  rate: number,
  lag: number,
): Float64Array {
  const w = hannOf(size);
  const f = rate / lag;
  const top = Math.min(4000, rate * 0.45);
  const count = Math.max(0, Math.ceil(top / f) - 1);
  const out = new Float64Array(count);
  for (let k = 1; k * f < top; k += 1) {
    const om = (2 * Math.PI * k * f) / rate;
    const c = 2 * Math.cos(om);
    let q1 = 0;
    let q2 = 0;
    for (let i = 0; i < size; i += 1) {
      const q0 = (y[start + i] ?? 0) * w[i]! + c * q1 - q2;
      q2 = q1;
      q1 = q0;
    }
    out[k - 1] = q1 * q1 + q2 * q2 - c * q1 * q2;
  }
  return out;
}

/**
 * Spectral subharmonic check: for a candidate whose harmonic energies are
 * `e`, and which is `div` times a shorter-lag candidate, the mean energy at
 * harmonics that are not multiples of `div` over the mean at the multiples. A
 * real low voice has energy at its odd harmonics; breath under a high voice
 * does not form harmonic lines there.
 */
function combRatio(e: Float64Array, div: number): number {
  let eNon = 0;
  let nNon = 0;
  let eMul = 0;
  let nMul = 0;
  for (let k = 1; k <= e.length; k += 1) {
    if (k % div === 0) {
      eMul += e[k - 1]!;
      nMul += 1;
    } else {
      eNon += e[k - 1]!;
      nNon += 1;
    }
  }
  if (!nMul || !nNon || eMul <= 0) return 1;
  return eNon / nNon / (eMul / nMul);
}

/** Frames per resumable block (0.5 s at hop 5 ms). */
const STEP_FRAMES = 100;

/** Track the f0 of a mono signal. Stereo sources: pass the mono mixdown. */
export function trackPitch(
  x: Float64Array,
  sampleRate: number,
  options: TrackOptions = {},
): PitchCurve {
  const steps = trackPitchSteps(x, sampleRate, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * `trackPitch` that yields to the event loop every 0.5 s of frames, so the
 * TUI and the live engine stay responsive while a long take is analysed.
 * `progress` gets the fraction of frames done. The curve is byte-identical.
 */
export async function trackPitchAsync(
  x: Float64Array,
  sampleRate: number,
  options: TrackOptions = {},
  progress?: (done: number) => void,
): Promise<PitchCurve> {
  const steps = trackPitchSteps(x, sampleRate, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    progress?.(r.value);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * The tracker as a generator: yields the fraction of frames done after each
 * block of STEP_FRAMES frames and returns the curve.
 */
export function* trackPitchSteps(
  x: Float64Array,
  sampleRate: number,
  options: TrackOptions = {},
): Generator<number, PitchCurve> {
  const range = PITCH_VOICES[options.voice ?? "auto"];
  const fmin = options.fmin ?? range.fmin;
  const fmax = options.fmax ?? range.fmax;
  const gateDb = options.gateDb ?? 45;
  const comb = options.comb !== false;
  const rate = TRACK_RATE;
  const hopS = Math.max(
    1,
    Math.round((options.hop ?? PITCH_HOP_SECONDS) * rate),
  );
  const hop = hopS / rate;
  const tauMax = Math.ceil(rate / fmin);
  const tauMin = Math.max(2, Math.floor(rate / fmax));
  const W = Math.max(256, 1 << Math.ceil(Math.log2(tauMax * 1.6)));
  // The difference over lag tau spans [s, s + W + tau); label frames at the
  // middle for a 220 Hz period (off by at most |tau - ref| / 2 samples).
  const tauRef = Math.min(tauMax, rate / 220);
  const centre = (W + tauRef) / 2;
  const pad = Math.floor(centre / hopS) * hopS;
  const t0 = (centre - pad) / rate;
  const src = resampleForTracking(x, sampleRate);
  if (src.length === 0) return emptyCurve(hop);
  const frames = Math.max(
    0,
    Math.floor((pad + src.length - centre) / hopS) + 1,
  );
  const y = new Float64Array(pad + src.length + W + tauMax + 2);
  y.set(src, pad);
  let N = 1;
  while (N < W + tauMax + 1) N <<= 1;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const pr = new Float64Array(N);
  const pi = new Float64Array(N);
  const sq = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i += 1) sq[i + 1] = sq[i]! + y[i]! * y[i]!;
  const d = new Float64Array(tauMax + 2);
  const dn = new Float64Array(tauMax + 2);
  const all: Frame[] = [];
  let maxRms = 0;
  for (let f = 0; f < frames; f += 1) {
    const s = f * hopS;
    re.fill(0);
    im.fill(0);
    // Pack a = window (W) as real and b = window plus lags as imaginary.
    for (let i = 0; i < W; i += 1) re[i] = y[s + i]!;
    for (let i = 0; i < W + tauMax; i += 1) im[i] = y[s + i]!;
    fftInPlace(re, im);
    // R = conj(A) * B, separating A and B from the packed spectrum.
    for (let k = 0; k < N; k += 1) {
      const k2 = (N - k) & (N - 1);
      const ar = 0.5 * (re[k]! + re[k2]!);
      const ai = 0.5 * (im[k]! - im[k2]!);
      const br = 0.5 * (im[k]! + im[k2]!);
      const bi = -0.5 * (re[k]! - re[k2]!);
      pr[k] = ar * br + ai * bi;
      pi[k] = ar * bi - ai * br;
    }
    fftInPlace(pr, pi, true);
    const e0 = Math.max(0, sq[s + W]! - sq[s]!);
    d[0] = 0;
    dn[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      const et = sq[s + tau + W]! - sq[s + tau]!;
      const r = pr[tau]! / N;
      const v = Math.max(0, e0 + et - 2 * r);
      d[tau] = v;
      run += v;
      dn[tau] = run > 0 ? (v * tau) / run : 1;
    }
    const rms = Math.sqrt(e0 / W);
    if (rms > maxRms) maxRms = rms;
    const mins: Dip[] = [];
    for (let tau = tauMin; tau < tauMax; tau += 1) {
      if (dn[tau]! < dn[tau - 1]! && dn[tau]! <= dn[tau + 1]!) {
        const a = dn[tau - 1]!;
        const b = dn[tau]!;
        const c = dn[tau + 1]!;
        const den = a - 2 * b + c;
        const off = den > 0 ? (0.5 * (a - c)) / den : 0;
        mins.push({
          tau: tau + Math.max(-0.5, Math.min(0.5, off)),
          v: b - 0.25 * (a - c) * off,
          raw: d[tau]!,
        });
      }
    }
    const tauList: number[] = [];
    const pList: number[] = [];
    const apList: number[] = [];
    if (mins.length) {
      const probs = new Float64Array(mins.length);
      let gi = 0;
      for (let i = 1; i < mins.length; i += 1)
        if (mins[i]!.v < mins[gi]!.v) gi = i;
      for (let t = 0; t < THRESHOLDS; t += 1) {
        const thr = (t + 1) / THRESHOLDS;
        let chosen = -1;
        for (let i = 0; i < mins.length; i += 1)
          if (mins[i]!.v < thr) {
            chosen = i;
            break;
          }
        if (chosen >= 0) probs[chosen]! += BETA[t]!;
        else probs[gi]! += BETA[t]! * 0.01;
      }
      // A dip at 2x or 3x the lag of a nearly-as-deep dip is a subharmonic.
      // The comb only runs while the long dip still carries mass to move.
      const energies = new Map<number, Float64Array>();
      const combOf = (i: number, div: number): number => {
        let e = energies.get(i);
        if (!e) {
          e = harmonicEnergies(y, s, W, rate, mins[i]!.tau);
          energies.set(i, e);
        }
        return combRatio(e, div);
      };
      for (let i = 0; i < mins.length; i += 1) {
        for (const div of [2, 3]) {
          const want = mins[i]!.tau / div;
          for (let m = 0; m < mins.length; m += 1) {
            if (m === i || Math.abs(mins[m]!.tau - want) > want * 0.04)
              continue;
            const short = mins[m]!;
            const long = mins[i]!;
            const sub =
              short.v < long.v + SUBHARMONIC_MARGIN ||
              (comb &&
                probs[i]! > 0 &&
                short.raw < SUBHARMONIC_RAW * long.raw &&
                combOf(i, div) < SUBHARMONIC_COMB);
            if (sub) {
              probs[m]! += probs[i]!;
              probs[i] = 0;
              short.v = Math.min(short.v, long.v);
            }
          }
        }
      }
      const order = [...mins.keys()]
        .sort((a, b) => probs[b]! - probs[a]! || a - b)
        .slice(0, MAX_CANDIDATES);
      for (const i of order) {
        if (probs[i]! <= 0) continue;
        tauList.push(mins[i]!.tau);
        pList.push(probs[i]!);
        apList.push(mins[i]!.v);
      }
    }
    // Voicing: the Beta-prior mass, or for breathy and low voices whose best
    // dip sits at 0.2-0.45, a ramp on that dip.
    let pv = 0;
    for (const q of pList) pv += q;
    const apMin = apList.length ? Math.min(...apList) : 1;
    const ramp = Math.max(0, Math.min(1, (0.5 - apMin) / 0.3));
    all.push({
      tau: tauList,
      p: pList,
      ap: apList,
      rms,
      v: Math.min(0.995, Math.max(pv, ramp)),
    });
    if ((f + 1) % STEP_FRAMES === 0 && f + 1 < frames) yield (f + 1) / frames;
  }
  // Energy gate.
  const gate = maxRms * 10 ** (-gateDb / 20);
  for (const fr of all)
    if (fr.rms <= gate) {
      fr.p = fr.p.map((p) => p * 0.02);
      fr.v *= 0.02;
    }
  const centsOf = (tau: number): number => 1200 * Math.log2(rate / tau / 440);
  // Register prior: candidates far from the clip's confident median pitch
  // are down-weighted, so a breathy stretch cannot settle an octave below.
  const confident: number[] = [];
  for (const fr of all) {
    if (fr.rms <= gate) continue;
    for (let i = 0; i < fr.tau.length; i += 1)
      if (fr.ap[i]! < 0.08) {
        confident.push(centsOf(fr.tau[i]!));
        break;
      }
  }
  if (confident.length >= 20) {
    confident.sort((a, b) => a - b);
    const median = confident[confident.length >> 1]!;
    for (const fr of all)
      fr.p = fr.p.map((p, i) =>
        Math.abs(centsOf(fr.tau[i]!) - median) > REGISTER_CENTS ? p * 0.15 : p,
      );
  }
  const path = viterbi(all, centsOf);
  const hz = new Float64Array(frames);
  const prob = new Uint8Array(frames);
  const aperiodic = new Uint8Array(frames).fill(255);
  for (let f = 0; f < frames; f += 1) {
    const fr = all[f]!;
    const k = path[f]!;
    let p = 0;
    for (const v of fr.p) p += v;
    prob[f] = toByte(p);
    if (k >= 0) {
      hz[f] = rate / fr.tau[k]!;
      aperiodic[f] = toByte(fr.ap[k]!);
    }
  }
  foldOctaves(hz);
  return { t0, hop, f0: Float32Array.from(hz), prob, aperiodic };
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/**
 * Octave-glitch repair: inside voiced stretches, a frame more than 900 cents
 * from the median of the voiced frames within 50 ms either side moves by
 * whole octaves to the octave nearest that median. Real leaps survive.
 */
function foldOctaves(hz: Float64Array): void {
  const n = hz.length;
  const src = Float64Array.from(hz);
  const R = 10;
  const win: number[] = [];
  for (let f = 0; f < n; f += 1) {
    if (!(src[f]! > 0)) continue;
    win.length = 0;
    for (let g = Math.max(0, f - R); g <= Math.min(n - 1, f + R); g += 1)
      if (src[g]! > 0) win.push(Math.log2(src[g]!));
    win.sort((a, b) => a - b);
    const med = win[win.length >> 1]!;
    const l = Math.log2(src[f]!);
    if (Math.abs(l - med) * 1200 > 900) hz[f] = 2 ** (l - Math.round(l - med));
  }
}

/** Viterbi over candidates (index >= 0) and unvoiced (-1). */
function viterbi(
  frames: readonly Frame[],
  centsOf: (tau: number) => number,
): number[] {
  const n = frames.length;
  const SWITCH = Math.log(0.02);
  const STAY_U = Math.log(0.98);
  const JUMP = 250; // a 250-cent jump between frames costs half a nat
  const back: Int8Array[] = [];
  let prevScore: number[] = [];
  let prevCents: number[] = [];
  for (let f = 0; f < n; f += 1) {
    const fr = frames[f]!;
    const k = fr.tau.length;
    let sum = 0;
    for (const p of fr.p) sum += p;
    const pv = fr.v;
    const emitU = Math.log(Math.max(1e-6, 1 - pv));
    const score = new Array<number>(k + 1).fill(-Infinity);
    const bp = new Int8Array(k + 1).fill(-1);
    const cents = fr.tau.map(centsOf);
    for (let j = 0; j <= k; j += 1) {
      const emit =
        j < k
          ? Math.log(Math.max(1e-9, (pv * fr.p[j]!) / Math.max(1e-12, sum)))
          : emitU;
      if (f === 0) {
        score[j] = emit;
        continue;
      }
      const pk = prevScore.length - 1;
      for (let i = 0; i <= pk; i += 1) {
        let t: number;
        if (i === pk && j === k) t = STAY_U;
        else if (i === pk || j === k) t = SWITCH;
        else {
          const dc = (cents[j]! - prevCents[i]!) / JUMP;
          t = -0.5 * dc * dc;
        }
        const s = prevScore[i]! + t + emit;
        if (s > score[j]!) {
          score[j] = s;
          bp[j] = i;
        }
      }
    }
    back.push(bp);
    prevScore = score;
    prevCents = cents;
  }
  const path = new Array<number>(n);
  let best = 0;
  for (let j = 1; j < prevScore.length; j += 1)
    if (prevScore[j]! > prevScore[best]!) best = j;
  for (let f = n - 1; f >= 0; f -= 1) {
    const k = frames[f]!.tau.length;
    path[f] = best === k ? -1 : best;
    best = back[f]![best]!;
  }
  return path;
}

// ------------------------------------------------------------ reading

/**
 * Hz at time `t` (seconds), interpolated in log frequency between frames; 0
 * outside the curve. Next to an unvoiced frame it takes the nearer frame.
 */
export function curveAt(curve: PitchCurve, t: number): number {
  const n = curve.f0.length;
  if (n === 0) return 0;
  const pos = (t - curve.t0) / curve.hop;
  if (pos < 0 || pos > n - 1) return 0;
  const i = Math.min(n - 2, Math.floor(pos));
  if (i < 0) return curve.f0[0]!;
  const a = curve.f0[i]!;
  const b = curve.f0[i + 1]!;
  const u = pos - i;
  if (!(a > 0) || !(b > 0)) return u < 0.5 ? a : b;
  return a * (b / a) ** u;
}

/** Hz per sample of a buffer at `sampleRate` (0 where unvoiced). */
export function curveToSamples(
  curve: PitchCurve,
  length: number,
  sampleRate: number,
  offsetSeconds = 0,
): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1)
    out[i] = curveAt(curve, offsetSeconds + i / sampleRate);
  return out;
}

/** Cents re A440 of `hz`. */
export function centsOfHz(hz: number): number {
  return 1200 * Math.log2(hz / 440);
}

/**
 * Where a confirmed pitch move began: walk back from `from` while each
 * earlier frame is closer to the old `anchor` (a glide or scoop), until a
 * frame is within 15 cents of it, at most 80 ms and never before `floor`.
 */
function glideStart(
  f0: Float64Array,
  hop: number,
  from: number,
  floor: number,
  anchor: number,
): number {
  const limit = Math.max(floor + 1, from - Math.round(0.08 / hop));
  const sign = Math.sign(centsOfHz(f0[from]!) - anchor);
  let f = from;
  while (f - 1 >= limit && f0[f - 1]! > 0) {
    const here = (centsOfHz(f0[f]!) - anchor) * sign;
    const before = (centsOfHz(f0[f - 1]!) - anchor) * sign;
    if (before >= here || here <= 15) break;
    f -= 1;
  }
  return f;
}

/**
 * A copy of `f0` with unvoiced gaps of at most `frames` frames between two
 * voiced frames filled by log interpolation (a dropout inside a glide).
 */
function bridgeGaps(f0: Float32Array, frames: number): Float64Array {
  const out = Float64Array.from(f0);
  const n = out.length;
  let f = 1;
  while (f < n) {
    if (out[f]! > 0 || !(out[f - 1]! > 0)) {
      f += 1;
      continue;
    }
    let g = f;
    while (g < n && !(out[g]! > 0)) g += 1;
    if (g < n && g - f <= frames) {
      const a = Math.log2(out[f - 1]!);
      const b = Math.log2(out[g]!);
      for (let k = f; k < g; k += 1)
        out[k] = 2 ** (a + ((b - a) * (k - f + 1)) / (g - f + 1));
    }
    f = g;
  }
  return out;
}

/** Half-width (seconds) of the centred median that note splitting reads. */
const VIBRATO_WINDOW = 0.125;

/**
 * Cents of each voiced frame's centred median over +-`half` frames of the
 * same voiced run. A 250 ms window spans at least one cycle of 4-8 Hz
 * vibrato, so wide vibrato stays one note while a held step still moves the
 * median at the step itself.
 */
function centredMedian(f0: Float64Array, half: number): Float64Array {
  const n = f0.length;
  const cents = new Float64Array(n);
  for (let f = 0; f < n; f += 1) cents[f] = f0[f]! > 0 ? centsOfHz(f0[f]!) : 0;
  const out = new Float64Array(n);
  const win: number[] = [];
  let f = 0;
  while (f < n) {
    if (!(f0[f]! > 0)) {
      f += 1;
      continue;
    }
    let end = f;
    while (end < n && f0[end]! > 0) end += 1;
    for (let g = f; g < end; g += 1) {
      win.length = 0;
      const a = Math.max(f, g - half);
      const b = Math.min(end - 1, g + half);
      for (let k = a; k <= b; k += 1) win.push(cents[k]!);
      win.sort((x, y) => x - y);
      out[g] = win[win.length >> 1]!;
    }
    f = end;
  }
  return out;
}

/** A note found in a pitch curve. */
export type PitchNote = Readonly<{
  /** Seconds. */
  start: number;
  end: number;
  /** Nearest MIDI note of the segment's median pitch. */
  midi: number;
  /** Median deviation from `midi` in cents (-50..50). */
  cents: number;
  /** Mean voicing probability, 0..1. */
  confidence: number;
}>;

export type PitchNotesOptions = Readonly<{
  /** A pitch move larger than this (cents) held for `holdSeconds` starts a note. */
  splitCents?: number;
  holdSeconds?: number;
  /** Shorter segments are dropped. */
  minSeconds?: number;
}>;

/**
 * Curve to notes: a note starts at each voiced onset and wherever the
 * pitch's 250 ms centred median leaves a slowly following anchor by more than
 * 70 cents for 40 ms (the onset backdated to where that glide began), so
 * vibrato up to +-150 cents stays one note. Each note's pitch is the median
 * of its frames.
 */
export function pitchNotes(
  curve: PitchCurve,
  options: PitchNotesOptions = {},
): PitchNote[] {
  const split = options.splitCents ?? 70;
  const hold = options.holdSeconds ?? 0.04;
  const minSeconds = options.minSeconds ?? 0.06;
  const n = curve.f0.length;
  const f0 = bridgeGaps(curve.f0, Math.round(0.025 / curve.hop));
  const centre = centredMedian(f0, Math.round(VIBRATO_WINDOW / curve.hop));
  const segments: [number, number][] = [];
  let open = -1;
  let anchor = NaN;
  let pending = -1;
  const close = (end: number): void => {
    if (open >= 0 && end > open) segments.push([open, end]);
    open = -1;
  };
  for (let f = 0; f < n; f += 1) {
    const hz = f0[f]!;
    if (!(hz > 0)) {
      close(f);
      anchor = NaN;
      pending = -1;
      continue;
    }
    const cc = centre[f]!;
    if (open < 0) {
      open = f;
      anchor = cc;
    } else if (Math.abs(cc - anchor) > split) {
      if (pending < 0) pending = f;
      else if ((f - pending) * curve.hop > hold) {
        const start = glideStart(f0, curve.hop, pending, open, anchor);
        close(start);
        open = start;
        anchor = cc;
        pending = -1;
      }
    } else pending = -1;
    if (pending < 0) anchor += (cc - anchor) * 0.05;
  }
  close(n);
  const notes: PitchNote[] = [];
  for (const [a, b] of segments) {
    if ((b - a) * curve.hop < minSeconds) continue;
    const cents: number[] = [];
    let conf = 0;
    for (let f = a; f < b; f += 1) {
      if (curve.f0[f]! > 0) cents.push(centsOfHz(curve.f0[f]!));
      conf += curve.prob[f]! / 255;
    }
    if (cents.length === 0) continue;
    cents.sort((x, y) => x - y);
    const med = cents[cents.length >> 1]!;
    const midi = Math.round(69 + med / 100);
    notes.push({
      start: frameTime(curve, a),
      end: frameTime(curve, b),
      midi,
      cents: Math.round(med - (midi - 69) * 100),
      confidence: Math.round((conf / (b - a)) * 100) / 100,
    });
  }
  return notes;
}
