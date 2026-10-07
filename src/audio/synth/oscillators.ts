/**
 * Oscillators of the synth voice, behind one seam: `resolveOscillator`
 * maps a sound name to a factory, and `registerOscillatorResolver` lets
 * another module (the wavetable lane) add sounds without touching the
 * voice. Everything else a voice does (envelopes, unison, FM, filters)
 * lives in voice.ts and applies to every oscillator.
 *
 * Band-limiting: sawtooth, square and pulse use PolyBLEP residuals
 * (Välimäki & Huovilainen, "Antialiasing oscillators in subtractive
 * synthesis", 2007); additive partials above Nyquist are skipped. Noise is
 * seeded per note so a note sounds the same on every render.
 */

/** What a factory sees when a note starts. */
export type OscillatorInit = Readonly<{
  sound: string;
  sampleRate: number;
  /** Per-note PRNG, 0..1; deterministic for a note id and start. */
  random: () => number;
  /** Resolved `partials`/`phases`, when set. */
  partials?: readonly number[];
  phases?: readonly number[];
  /** Current pulse width 0..1, read every sample by pulse-like sounds. */
  width: () => number;
  /** Crackle density 0..1. */
  density: number;
  /**
   * The track's raw `synth` value for a parameter (undefined when unset),
   * so an oscillator registered elsewhere can read its own parameters.
   */
  param: (name: string) => unknown;
  /** Seconds since the note started, advanced per sample by the voice. */
  time: () => number;
}>;

/**
 * One oscillator instance (one unison voice of one note). `phase` is in
 * cycles (any real), `increment` the phase step of this sample; noise
 * sounds ignore both.
 */
export type Oscillator = (phase: number, increment: number) => number;

export type OscillatorFactory = (init: OscillatorInit) => Oscillator;

/** `undefined` when the resolver does not know the sound. */
export type OscillatorResolver = (
  sound: string,
) => OscillatorFactory | undefined;

const resolvers: OscillatorResolver[] = [];

/** Add sounds (checked before the built-ins, newest first). */
export function registerOscillatorResolver(resolver: OscillatorResolver): void {
  resolvers.unshift(resolver);
}

/** The factory for a sound, or `undefined` for an unknown name. */
export function resolveOscillator(
  sound: string,
): OscillatorFactory | undefined {
  const name = sound.trim().toLowerCase();
  for (const resolver of resolvers) {
    const factory = resolver(name);
    if (factory) return factory;
  }
  return BUILT_IN[name];
}

/** PolyBLEP residual for a unit step at phase 0 (t in cycles 0..1). */
export function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function frac(value: number): number {
  return value - Math.floor(value);
}

function sawtooth(phase: number, increment: number): number {
  const t = frac(phase);
  return 2 * t - 1 - polyBlep(t, Math.abs(increment));
}

function pulse(phase: number, increment: number, width: number): number {
  const t = frac(phase);
  const dt = Math.abs(increment);
  const w = Math.min(0.99, Math.max(0.01, width));
  let value = t < w ? 1 : -1;
  value += polyBlep(t, dt);
  value -= polyBlep(frac(t - w + 1), dt);
  // Remove the DC a non-50% pulse carries so width sweeps don't thump.
  return value - (2 * w - 1);
}

function triangle(phase: number): number {
  return 1 - 4 * Math.abs(frac(phase) - 0.5);
}

/**
 * dawg's original tone colours (piano, pluck, bass), unchanged so the
 * legacy voice renders byte-identically; also the oscillator for those
 * names when a track sets synth parameters.
 */
export function legacyWave(instrument: string, phase: number): number {
  const name = instrument.trim().toLowerCase();
  const cycle = phase - Math.floor(phase);
  const sine = Math.sin(2 * Math.PI * phase);
  if (name.includes("square")) return cycle < 0.5 ? 1 : -1;
  if (name.includes("saw")) return 2 * cycle - 1;
  if (name.includes("triangle")) return 1 - 4 * Math.abs(cycle - 0.5);
  if (name.includes("bass")) {
    // A rounded fundamental plus a quiet octave gives bass tracks useful weight.
    return Math.tanh(
      0.9 * Math.sin(2 * Math.PI * phase) +
        0.25 * Math.sin(4 * Math.PI * phase),
    );
  }
  if (name.includes("piano") || name.includes("pluck")) {
    // Add stable harmonics; the envelope above supplies the note decay.
    const harmonic =
      Math.sin(4 * Math.PI * phase) * 0.28 +
      Math.sin(6 * Math.PI * phase) * 0.12;
    return Math.tanh(sine + harmonic);
  }
  // Unknown instruments deliberately fall back to the original sine voice.
  return sine;
}

/**
 * Harmonic amplitudes of a basic waveform (Fourier series), scaled by
 * `partials` when given: `sawtooth` 1/h, `square` odd 1/h, `triangle`
 * odd ±1/h², `sine`/`user` the partials alone.
 */
function harmonicSeries(
  sound: string,
  partials: readonly number[] | undefined,
): number[] {
  const count = partials?.length ?? 1;
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const h = index + 1;
    const user = partials?.[index] ?? 1;
    let base = 1;
    if (sound === "sawtooth" || sound === "saw" || sound === "supersaw")
      base = 1 / h;
    else if (sound === "square" || sound === "pulse")
      base = h % 2 === 1 ? 1 / h : 0;
    else if (sound === "triangle")
      base =
        h % 2 === 1
          ? ((h - 1) / 2) % 2 === 0
            ? 1 / (h * h)
            : -1 / (h * h)
          : 0;
    out.push(base * user);
  }
  return out;
}

/** Additive oscillator: partials above Nyquist are skipped. */
function additive(init: OscillatorInit): Oscillator {
  const amplitudes = harmonicSeries(init.sound, init.partials ?? [1]);
  const phases = init.phases ?? [];
  const norm = Math.max(
    1,
    amplitudes.reduce((sum, value) => sum + Math.abs(value), 0),
  );
  const count = amplitudes.length;
  return (phase, increment) => {
    let sum = 0;
    const limit = Math.abs(increment) > 0 ? 0.5 / Math.abs(increment) : count;
    for (let index = 0; index < count && index + 1 < limit; index += 1) {
      const a = amplitudes[index]!;
      if (a === 0) continue;
      sum +=
        a *
        Math.sin(2 * Math.PI * ((index + 1) * phase + (phases[index] ?? 0)));
    }
    return sum / norm;
  };
}

/** Paul Kellet's refined pink filter (public-domain, ±0.05 dB above 9 Hz). */
function pinkNoise(random: () => number): () => number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  return () => {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const value = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    // Scaled to white noise's RMS (≈0.35) so the colours swap evenly.
    return value * 0.2;
  };
}

/** A pink-noise source for the `noise` mix control. */
export function makePinkNoise(random: () => number): () => number {
  return pinkNoise(random);
}

const BUILT_IN: Readonly<Record<string, OscillatorFactory>> = Object.freeze({
  sine: (init) =>
    init.partials ? additive(init) : (phase) => Math.sin(2 * Math.PI * phase),
  sawtooth: (init) => (init.partials ? additive(init) : sawtooth),
  saw: (init) => (init.partials ? additive(init) : sawtooth),
  supersaw: (init) => (init.partials ? additive(init) : sawtooth),
  square: (init) =>
    init.partials
      ? additive(init)
      : (phase, increment) => pulse(phase, increment, 0.5),
  pulse: (init) => (phase, increment) => pulse(phase, increment, init.width()),
  triangle: (init) => (init.partials ? additive(init) : triangle),
  user: (init) => additive(init),
  piano: () => (phase) => legacyWave("piano", phase),
  pluck: () => (phase) => legacyWave("pluck", phase),
  bass: () => (phase) => legacyWave("bass", phase),
  white: (init) => () => (init.random() * 2 - 1) * 0.6,
  pink: (init) => pinkNoise(init.random),
  brown: (init) => {
    let state = 0;
    return () => {
      // Leaky integration of white noise: a −6 dB/octave slope.
      state = (state + 0.02 * (init.random() * 2 - 1)) / 1.02;
      return state * 6.1;
    };
  },
  crackle: (init) => {
    const chance = Math.min(1, (init.density * 1000) / init.sampleRate);
    return () => {
      const hit = init.random() < chance;
      const value = init.random() * 2 - 1;
      return hit ? value : 0;
    };
  },
  // ZzFX sounds render through their own generator (zzfx.ts); these plain
  // waves only register the names (and serve as their seam fallback).
  z_sine: () => (phase) => Math.sin(2 * Math.PI * phase),
  z_triangle: () => triangle,
  z_sawtooth: () => sawtooth,
  z_square: () => (phase, increment) => pulse(phase, increment, 0.5),
  z_tan: () => (phase) =>
    Math.max(-1, Math.min(1, Math.tan(Math.PI * (phase - Math.floor(phase))))),
  z_noise: (init) => () => init.random() * 2 - 1,
});

/** Every built-in sound name. */
export const BUILT_IN_SOUNDS: readonly string[] = Object.freeze(
  Object.keys(BUILT_IN),
);
