/**
 * The one synthetic voice fixture for 0.7 (ported unchanged from the design
 * prototype proto/pitch/voice.ts and phrases.ts). Tests in every voice lane
 * use it; lanes may append options, but existing outputs never change: the
 * hash pinned in voice.test.ts guards that, and VOICE_FIXTURE_VERSION only
 * moves with an owner-approved change.
 *
 * Vocal-like test signal with a known pitch curve: a Rosenberg glottal pulse
 * train (lip radiation as a first difference) through a cascade of formant
 * resonators for the vowels a e i o u, plus vibrato, slow drift, scoops,
 * falls, breath noise, consonant-like noise bursts and silences. Everything
 * is seeded; the true f0 (Hz per sample, 0 when unvoiced) and the onsets are
 * returned with the audio.
 */

/** Bumped only by an owner-approved change to existing outputs. */
export const VOICE_FIXTURE_VERSION = 1;

// Counter-based seeded randomness: a stored seed plus a counter, never
// Math.random. `unit(seed, n)` is a pure function of its inputs.
function hash32(seed: number, n: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n | 0, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1). */
function unit(seed: number, n: number): number {
  return hash32(seed, n) / 4294967296;
}

/** Uniform in [-1, 1). */
function bipolar(seed: number, n: number): number {
  return unit(seed, n) * 2 - 1;
}

/** A stream view for sequential draws: still pure given (seed, start). */
class Rng {
  private n = 0;
  constructor(readonly seed: number) {}
  next(): number {
    return unit(this.seed, this.n++);
  }
  bi(): number {
    return bipolar(this.seed, this.n++);
  }
}

export type Vowel = "a" | "e" | "i" | "o" | "u";

/** F1..F4 (Hz) for a generic adult voice (after Peterson and Barney 1952). */
export const VOWELS: Readonly<Record<Vowel, readonly number[]>> = {
  a: [730, 1090, 2440, 3400],
  e: [530, 1840, 2480, 3400],
  i: [270, 2290, 3010, 3400],
  o: [570, 840, 2410, 3400],
  u: [300, 870, 2240, 3400],
};
const BANDWIDTHS = [80, 90, 120, 150];
const FORMANT_GAINS = [1, 0.7, 0.35, 0.2];

export type SungNote = Readonly<{
  /** Seconds. */
  start: number;
  dur: number;
  /** MIDI pitch the singer means. */
  midi: number;
  /** Cents the singer is off (static), the thing correction must remove. */
  off?: number;
  vowel: Vowel;
  /** Start this many cents below and rise in (a scoop). */
  scoop?: number;
  /** Fall off the end by this many cents over the last 150 ms. */
  fall?: number;
  /** Vibrato depth in cents (peak) and rate in Hz; starts after 0.25 s. */
  vib?: number;
  rate?: number;
  /** Consonant noise burst before the onset, seconds (unvoiced). */
  consonant?: number;
  /** Glide in from the previous note (legato) instead of a gap, seconds. */
  legato?: number;
}>;

export type VoiceOptions = Readonly<{
  sr: number;
  seed: number;
  /** Breath noise level relative to the voiced peak (0.02 = -34 dB). */
  breath?: number;
  /** Drift depth in cents (slow random walk). */
  drift?: number;
}>;

export type VoiceSignal = Readonly<{
  x: Float64Array;
  /** True f0 in Hz per sample; 0 where unvoiced. */
  f0: Float64Array;
  /** Intended (perfectly tuned) pitch in cents re A440 per sample; NaN off-note. */
  target: Float64Array;
  /** Voiced onsets in seconds (one per note, the start of its voiced part). */
  onsets: number[];
  /** One syllable per note: start, voiced onset and end in seconds, vowel. */
  syllables: readonly VoiceSyllable[];
  sr: number;
}>;

export type VoiceSyllable = Readonly<{
  start: number;
  onset: number;
  end: number;
  vowel: Vowel;
}>;

function rosenberg(p: number): number {
  const tp = 0.4;
  const tn = 0.16;
  if (p < tp) return 0.5 * (1 - Math.cos((Math.PI * p) / tp));
  if (p < tp + tn) return Math.cos((Math.PI * (p - tp)) / (2 * tn));
  return 0;
}

export function synthVoice(
  notes: readonly SungNote[],
  opts: VoiceOptions,
): VoiceSignal {
  const { sr, seed } = opts;
  const breath = opts.breath ?? 0.02;
  const driftDepth = opts.drift ?? 6;
  const end = Math.max(...notes.map((n) => n.start + n.dur)) + 0.3;
  const len = Math.ceil(end * sr);
  const rng = new Rng(seed);
  const cents = new Float64Array(len).fill(NaN);
  const target = new Float64Array(len).fill(NaN);
  const amp = new Float64Array(len);
  const noiseAmp = new Float64Array(len);
  const formant = new Array(4).fill(0).map(() => new Float64Array(len));
  const onsets: number[] = [];

  // Drift: smoothed random walk, shared by the phrase.
  const drift = new Float64Array(len);
  {
    let d = 0;
    let v = 0;
    const step = Math.floor(sr / 200);
    for (let i = 0; i < len; i++) {
      if (i % step === 0) v = rng.bi();
      d += (v * driftDepth - d) * (1 / (0.25 * sr));
      drift[i] = d;
    }
  }

  let prevVowel: Vowel = notes[0]!.vowel;
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k]!;
    const s0 = Math.round(n.start * sr);
    const s1 = Math.min(len, Math.round((n.start + n.dur) * sr));
    const cons = n.consonant ?? 0;
    const voiced0 = s0 + Math.round(cons * sr);
    onsets.push(voiced0 / sr);
    const base = (n.midi - 69) * 100;
    const prev = k > 0 ? notes[k - 1] : undefined;
    const legato = n.legato && prev ? n.legato : 0;
    const rateJ = (n.rate ?? 5.5) * (1 + 0.05 * rng.bi());
    const vibPhase = rng.next() * 2 * Math.PI;
    for (let i = s0; i < s1; i++) {
      const t = (i - voiced0) / sr;
      // consonant burst
      if (i < voiced0) {
        const u = (i - s0) / Math.max(1, voiced0 - s0);
        noiseAmp[i] = 0.25 * Math.sin(Math.PI * u);
        continue;
      }
      let c = base + (n.off ?? 0);
      target[i] = base;
      if (n.scoop) c -= n.scoop * Math.exp(-t / 0.05);
      if (legato) {
        const pc = (prev!.midi - 69) * 100 + (prev!.off ?? 0);
        if (t < legato) {
          const u = t / legato;
          const sm = u * u * (3 - 2 * u);
          c = pc + (c - pc) * sm;
        }
      }
      const tEnd = (s1 - i) / sr;
      if (n.fall && tEnd < 0.15) c -= n.fall * (1 - tEnd / 0.15) ** 2;
      if (n.vib && t > 0.25) {
        const fade = Math.min(1, (t - 0.25) / 0.2);
        c += n.vib * fade * Math.sin(2 * Math.PI * rateJ * t + vibPhase);
      }
      c += drift[i]!;
      cents[i] = c;
      const att = Math.min(1, t / 0.02);
      const rel = Math.min(1, tEnd / 0.04);
      amp[i] = Math.min(att, rel) * (0.8 + 0.2 * Math.min(1, t / 0.3));
    }
    // formant tracks: glide from previous vowel over 40 ms
    const from = VOWELS[prevVowel];
    const to = VOWELS[n.vowel];
    for (let i = s0; i < s1; i++) {
      const u = Math.min(1, (i - s0) / (0.04 * sr));
      for (let f = 0; f < 4; f++)
        formant[f]![i] = from[f]! + (to[f]! - from[f]!) * u;
    }
    prevVowel = n.vowel;
  }
  // fill formant gaps with the last value
  for (let f = 0; f < 4; f++) {
    let last = VOWELS[notes[0]!.vowel][f]!;
    for (let i = 0; i < len; i++) {
      if (formant[f]![i]! > 0) last = formant[f]![i]!;
      else formant[f]![i] = last;
    }
  }

  // excitation
  const f0 = new Float64Array(len);
  const exc = new Float64Array(len);
  let phase = 0;
  let prevG = 0;
  for (let i = 0; i < len; i++) {
    const noise = rng.bi();
    if (amp[i]! > 0 && !Number.isNaN(cents[i]!)) {
      const hz = 440 * 2 ** (cents[i]! / 1200);
      f0[i] = hz;
      phase += hz / sr;
      if (phase >= 1) phase -= 1;
      const g = rosenberg(phase);
      const dg = g - prevG;
      prevG = g;
      // aspiration gated by the open phase
      const asp = breath * 4 * noise * (phase < 0.56 ? 1 : 0.3);
      exc[i] = amp[i]! * (dg * 6 + asp);
    } else {
      prevG = 0;
      phase = 0;
      exc[i] = noiseAmp[i]! * noise + breath * 0.15 * noise;
    }
  }
  // cascade formant resonators (time-varying 2-pole), parallel-weighted mix
  const out = new Float64Array(len);
  const y1 = [0, 0, 0, 0];
  const y2 = [0, 0, 0, 0];
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let f = 0; f < 4; f++) {
      const fc = formant[f]![i]!;
      const r = Math.exp((-Math.PI * BANDWIDTHS[f]!) / sr);
      const a1 = 2 * r * Math.cos((2 * Math.PI * fc) / sr);
      const a2 = -r * r;
      const g = 1 - r;
      const y = g * exc[i]! + a1 * y1[f]! + a2 * y2[f]!;
      y2[f] = y1[f]!;
      y1[f] = y;
      sum += FORMANT_GAINS[f]! * y;
    }
    out[i] = sum;
  }
  // consonant bursts are mostly high: add a bright copy of the noise
  let m = 0;
  for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(out[i]!));
  const g = m > 0 ? 0.7 / m : 1;
  let pn = 0;
  for (let i = 0; i < len; i++) {
    const nz = noiseAmp[i]! > 0 ? noiseAmp[i]! * 0.5 * (rng.bi() - pn) : 0;
    pn = nz;
    out[i] = out[i]! * g + nz;
  }
  const syllables = notes.map((n, k) => ({
    start: n.start,
    onset: onsets[k]!,
    end: n.start + n.dur,
    vowel: n.vowel,
  }));
  return { x: out, f0, target, onsets, syllables, sr };
}

/** A plain polyBLEP sawtooth over the same f0 curve: the cost reference. */
export function sawVoice(f0: Float64Array, sr: number): Float64Array {
  const out = new Float64Array(f0.length);
  let p = 0;
  for (let i = 0; i < f0.length; i++) {
    const dt = (f0[i]! || 220) / sr;
    p += dt;
    if (p >= 1) p -= 1;
    let s = 2 * p - 1;
    if (p < dt) {
      const t = p / dt;
      s -= t + t - t * t - 1;
    } else if (p > 1 - dt) {
      const t = (p - 1) / dt;
      s -= t * t + t + t + 1;
    }
    out[i] = 0.3 * s;
  }
  return out;
}

// Test phrases: deterministic, synthesized, with known truth.

export type PhraseSpec = [
  midi: number,
  dur: number,
  vowel: Vowel,
  extra?: Partial<SungNote>,
  gapAfter?: number,
];

export function build(specs: readonly PhraseSpec[], start = 0.2): SungNote[] {
  const out: SungNote[] = [];
  let t = start;
  for (const [midi, dur, vowel, extra, gap] of specs) {
    out.push({ start: t, dur, midi, vowel, ...extra });
    t += dur + (gap ?? 0);
  }
  return out;
}

// C major melody, sung a bit off, with scoops, falls, vibrato and consonants.
const MELODY: PhraseSpec[] = [
  [0, 0.5, "a", { off: 35, consonant: 0.04 }, 0.1],
  [2, 0.4, "e", { off: -28, scoop: 90 }, 0],
  [4, 0.9, "i", { off: 22, vib: 35, legato: 0.06 }, 0.15],
  [7, 0.35, "o", { off: -40, consonant: 0.03 }, 0],
  [5, 0.35, "u", { off: 18, legato: 0.05 }, 0],
  [
    4,
    1.1,
    "a",
    { off: -15, vib: 45, rate: 5.8, legato: 0.06, fall: 250 },
    0.35,
  ],
  [9, 0.45, "e", { off: 30, scoop: 120, consonant: 0.05 }, 0],
  [7, 0.45, "i", { off: -33, legato: 0.05 }, 0],
  [5, 0.45, "o", { off: 12, legato: 0.05 }, 0.1],
  [4, 0.6, "a", { off: 44, consonant: 0.04 }, 0],
  [2, 0.6, "u", { off: -44, legato: 0.06 }, 0.1],
  [0, 1.4, "o", { off: 25, vib: 30, rate: 5.2, scoop: 60, fall: 400 }, 0.3],
];

export function melody(base: number): SungNote[] {
  return build(
    MELODY.map(([m, d, v, e, g]) => [m + base, d, v, e, g] as PhraseSpec),
  );
}

/** Steady off-pitch notes for settle measurements: no scoop, vibrato or drift effects. */
export function steady(base: number, off: number): SungNote[] {
  const specs: PhraseSpec[] = [];
  const steps = [0, 4, 7, 5, 2, 9];
  for (let i = 0; i < steps.length; i++)
    specs.push([
      base + steps[i]!,
      0.8,
      (["a", "e", "i", "o", "u", "a"] as Vowel[])[i]!,
      { off: i % 2 ? -off : off },
      0.2,
    ]);
  return build(specs);
}

/** Steady vowels for formant measurements. */
export function vowels(midi: number): SungNote[] {
  return build(
    (["a", "e", "i", "o", "u"] as Vowel[]).map(
      (v) => [midi, 1.2, v, { vib: 20 }, 0.1] as PhraseSpec,
    ),
  );
}

/** Maqam bayati on D: neutral second (E half-flat) and neutral sixth sung near their places. */
export function bayati(): SungNote[] {
  // pitches in fractional MIDI semitones; the singer is off by a few cents
  const specs: Array<[number, number, Vowel, number]> = [
    [62, 0.6, "a", 12],
    [63.5, 0.6, "e", -18],
    [65, 0.6, "i", 15],
    [67, 0.8, "o", -10],
    [65, 0.4, "a", 20],
    [63.5, 0.6, "u", 22],
    [62, 1.0, "a", -16],
  ];
  return build(
    specs.map(
      ([m, d, v, off]) =>
        [Math.floor(m), d, v, { off: off + (m % 1) * 100 }, 0.08] as PhraseSpec,
    ),
  );
}
