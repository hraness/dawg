/**
 * Modal synthesis primitives (0.6, lane f06-modal): a bank of decaying
 * complex phasors (exact-frequency two-pole resonators) struck by a
 * half-sine mallet pulse. Bars, tines, shells (bells, gongs, bowls, pans)
 * and membranes differ only by a mode table and a strike-position law.
 * Ported from the reviewed prototype (proto/resonators/modal.ts) with the
 * review's fixes: an interior strike-position map with a 0.02 weight floor,
 * a per-tick Nyquist fade for bent modes, and stronger velocity to
 * hardness coupling.
 *
 * References: Adrien, "The missing link: modal synthesis" (1991); Cook,
 * Real Sound Synthesis (2002) and STK ModalBar; Fletcher and Rossing, The
 * Physics of Musical Instruments (1998) ch. 2, 3, 18-21; Rossing, Science
 * of Percussion Instruments (2000); Chaigne and Doutaut, JASA 101 (1997).
 */
import type { ModalBody, ModalSettings } from "../../../core/resonators.ts";
import { Biquad } from "./filters.ts";
import { seededRandom } from "./rng.ts";

export type ModalShape = "bar" | "tine" | "membrane" | "shell";

export type ModeTable = Readonly<{
  shape: ModalShape;
  /** Mode frequency ratios to the sounding pitch. */
  ratios: readonly number[];
  /** Relative mode amplitudes before strike position and mallet. */
  gains: readonly number[];
  /** Per-mode decay multipliers on top of the ring/tilt law (default 1). */
  decays?: readonly number[];
  /** bar/tine: beam mode index per entry. */
  beam?: readonly number[];
  /** membrane: [m, j_mn] per entry. */
  membrane?: readonly (readonly [number, number])[];
  /** Twin every mode at ratio (1 ± split/2): beating split modes centred on the nominal pitch. */
  split?: number;
  /**
   * Output trim (default 1) so every core preset peaks near -7.5 dBFS at
   * velocity 0.8 (spec test 13); measured on the bodies as ported.
   */
  level?: number;
}>;

/** Membrane Bessel zeros j_mn. */
const J = {
  "01": 2.4048,
  "11": 3.8317,
  "21": 5.1356,
  "02": 5.5201,
  "31": 6.3802,
  "12": 7.0156,
  "41": 7.5883,
  "22": 8.4172,
  "03": 8.6537,
  "51": 8.7715,
} as const;

/** Mode tables by body name (prototype values, unchanged). */
export const MODE_TABLES: Readonly<Record<ModalBody, ModeTable>> = {
  // Tuned bars, Rossing (2000) ch. 6-7: marimba and vibraphone 1:4:10,
  // xylophone 1:3:6.
  marimba: {
    shape: "bar",
    ratios: [1, 3.99, 9.95, 17.8],
    gains: [1, 0.32, 0.12, 0.03],
    decays: [1, 1, 1, 1.4],
    beam: [0, 1, 2, 3],
    level: 2.9,
  },
  vibraphone: {
    shape: "bar",
    ratios: [1, 3.98, 9.92, 17.6],
    gains: [1, 0.28, 0.1, 0.03],
    beam: [0, 1, 2, 3],
    level: 2.6,
  },
  xylophone: {
    shape: "bar",
    ratios: [1, 3.0, 6.1, 10.2],
    gains: [1, 0.45, 0.25, 0.08],
    beam: [0, 1, 2, 3],
    level: 3.5,
  },
  // Uniform free-free bar (Euler-Bernoulli).
  glockenspiel: {
    shape: "bar",
    ratios: [1, 2.756, 5.404, 8.933, 13.345, 18.638],
    gains: [1, 0.55, 0.35, 0.2, 0.1, 0.05],
    beam: [0, 1, 2, 3, 4, 5],
    level: 3.6,
  },
  celesta: {
    shape: "bar",
    ratios: [1, 2.756, 5.404, 8.933],
    gains: [1, 0.25, 0.1, 0.04],
    beam: [0, 1, 2, 3],
    level: 2.5,
  },
  // Tubular bell: the strike pitch sits an octave below mode 4.
  chimes: {
    shape: "bar",
    ratios: [0.2238, 0.617, 1.2096, 2.0, 2.987, 4.172, 5.555],
    gains: [0.05, 0.15, 0.35, 1, 0.8, 0.6, 0.3],
    beam: [0, 1, 2, 3, 4, 5, 6],
    level: 3.1,
  },
  // Clamped-free tines (cantilever 1 : 6.267 : 17.55).
  mbira: {
    shape: "tine",
    ratios: [1, 5.9, 16.7],
    gains: [1, 0.3, 0.06],
    beam: [0, 1, 2],
    level: 0.76,
  },
  kalimba: {
    shape: "tine",
    ratios: [1, 6.1, 17.2],
    gains: [1, 0.22, 0.05],
    beam: [0, 1, 2],
    level: 2.0,
  },
  musicbox: {
    shape: "tine",
    ratios: [1, 6.267, 17.55, 34.39],
    gains: [1, 0.4, 0.15, 0.05],
    beam: [0, 1, 2, 3],
  },
  toypiano: {
    shape: "tine",
    ratios: [1, 6.27, 17.55, 3.1],
    gains: [1, 0.5, 0.2, 0.12],
    beam: [0, 1, 2, 0],
  },
  // Gamelan: saron and bonang (Sethares 2005), gender ~ jublag.
  saron: {
    shape: "shell",
    ratios: [1, 2.34, 2.76, 4.75, 5.08, 5.91],
    gains: [1, 0.3, 0.45, 0.18, 0.15, 0.1],
  },
  bonang: {
    shape: "shell",
    ratios: [1, 1.52, 3.46, 3.92],
    gains: [1, 0.45, 0.3, 0.25],
    split: 0.002,
  },
  gender: {
    shape: "shell",
    ratios: [1, 2.77, 5.18, 5.33],
    gains: [1, 0.3, 0.12, 0.1],
  },
  kempul: {
    shape: "shell",
    ratios: [1, 2.0, 2.86, 3.67, 4.6],
    gains: [1, 0.25, 0.15, 0.1, 0.06],
    split: 0.012,
  },
  gong: {
    shape: "shell",
    ratios: [1, 2.0, 2.9, 3.8, 4.95, 6.2],
    gains: [1, 0.35, 0.2, 0.12, 0.08, 0.05],
    decays: [1, 0.8, 0.6, 0.5, 0.4, 0.3],
    split: 0.03,
    level: 1.25,
  },
  // Church bell partials (Rossing 2000 ch. 13).
  bell: {
    shape: "shell",
    ratios: [0.5, 1, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166],
    gains: [0.45, 0.5, 0.55, 0.25, 0.9, 0.35, 0.3, 0.25, 0.2],
    split: 0.0015,
  },
  // Free circular plate as a crotale approximation.
  crotale: {
    shape: "shell",
    ratios: [1, 1.73, 2.328, 3.91, 4.11, 6.3],
    gains: [1, 0.3, 0.6, 0.25, 0.35, 0.15],
  },
  // Steel pan note: tuned 1:2:3 with a slight octave stretch.
  steelpan: {
    shape: "shell",
    ratios: [1, 2.004, 3.0, 4.02, 5.1],
    gains: [1, 0.55, 0.3, 0.1, 0.05],
    level: 1.4,
  },
  // Singing bowl (Inacio, Henrique, Antunes 2004/2006), split pairs.
  bowl: {
    shape: "shell",
    ratios: [1, 2.7, 4.8, 7.5, 10.7, 14.2],
    gains: [1, 0.5, 0.3, 0.15, 0.08, 0.04],
    split: 0.004,
    level: 1.85,
  },
  // Timpani with air loading (Rossing 2000 ch. 3).
  timpani: {
    shape: "membrane",
    ratios: [0.85, 1, 1.5, 1.98, 2.44, 2.9],
    gains: [0.6, 1, 0.7, 0.5, 0.3, 0.2],
    decays: [0.12, 1, 0.9, 0.8, 0.7, 0.6],
    membrane: [
      [0, J["01"]],
      [1, J["11"]],
      [2, J["21"]],
      [3, J["31"]],
      [4, J["41"]],
      [5, J["51"]],
    ],
    level: 2.45,
  },
  // Tabla dayan: harmonic overtones from the loaded syahi (Raman 1934).
  tabla: {
    shape: "membrane",
    ratios: [1, 2, 3, 3.01, 4, 4.02, 5],
    gains: [1, 0.8, 0.5, 0.4, 0.3, 0.25, 0.15],
    decays: [0.6, 1, 1, 0.9, 0.9, 0.8, 0.8],
    membrane: [
      [0, J["01"]],
      [1, J["11"]],
      [2, J["21"]],
      [0, J["02"]],
      [3, J["31"]],
      [1, J["12"]],
      [4, J["41"]],
    ],
  },
  // Ideal membrane ratios for frame drums.
  frame: {
    shape: "membrane",
    ratios: [1, 1.593, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6],
    gains: [1, 0.8, 0.6, 0.5, 0.45, 0.35, 0.3, 0.25, 0.2],
    membrane: [
      [0, J["01"]],
      [1, J["11"]],
      [2, J["21"]],
      [0, J["02"]],
      [3, J["31"]],
      [1, J["12"]],
      [4, J["41"]],
      [2, J["22"]],
      [0, J["03"]],
    ],
  },
};

const LN1000 = Math.log(1000);

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Pole radius that decays by 60 dB in `t60` seconds. */
export function radiusForT60(t60: number, sampleRate: number): number {
  return Math.exp(-LN1000 / (Math.max(1e-4, t60) * sampleRate));
}

/** Bessel J_m(x) by its integral form (64-point midpoint rule). */
export function besselJ(m: number, x: number): number {
  const n = 64;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const t = ((i + 0.5) / n) * Math.PI;
    sum += Math.cos(m * t - x * Math.sin(t));
  }
  return sum / n;
}

/**
 * Euler-Bernoulli beam mode shape at x in [0, 1]: free-free ("free") or
 * clamped-free ("clamped", tip at x = 1). Both peak near 1 at a free end.
 */
export function beamShape(
  kind: "free" | "clamped",
  mode: number,
  x: number,
): number {
  const FREE = [4.7300408, 7.8532046, 10.9956078, 14.1371655, 17.2787597];
  const CLAMPED = [1.8751041, 4.6940911, 7.8547574, 10.9955407, 14.1371684];
  const table = kind === "free" ? FREE : CLAMPED;
  const beta =
    mode < table.length
      ? table[mode]!
      : ((2 * mode + (kind === "free" ? 3 : 1)) * Math.PI) / 2;
  const bx = beta * x;
  if (kind === "free") {
    const sigma =
      (Math.cosh(beta) - Math.cos(beta)) / (Math.sinh(beta) - Math.sin(beta));
    if (beta > 15)
      return (
        Math.cos(bx) -
        Math.sin(bx) +
        Math.exp(-bx) +
        (mode % 2 ? -1 : 1) * Math.exp(bx - beta)
      );
    return (
      (Math.cosh(bx) + Math.cos(bx) - sigma * (Math.sinh(bx) + Math.sin(bx))) /
      2
    );
  }
  const sigma =
    (Math.cosh(beta) + Math.cos(beta)) / (Math.sinh(beta) + Math.sin(beta));
  if (beta > 15) return Math.cos(bx) - Math.sin(bx) - Math.exp(-bx);
  return (
    (Math.cosh(bx) - Math.cos(bx) - sigma * (Math.sinh(bx) - Math.sin(bx))) / 2
  );
}

/** No mode drops below this fraction of its maximum weight. */
export const POSITION_FLOOR = 0.02;

/**
 * How strongly striking at user position `p` (0..1) excites a mode. The
 * range maps onto a safe interior per shape so no setting is silent.
 */
export function positionWeight(
  table: ModeTable,
  index: number,
  p: number,
): number {
  const u = clamp(p, 0, 1);
  let weight: number;
  if (table.shape === "bar")
    weight = Math.abs(beamShape("free", table.beam?.[index] ?? index, u));
  else if (table.shape === "tine")
    weight = Math.abs(
      beamShape("clamped", table.beam?.[index] ?? index, 0.08 + 0.92 * u),
    );
  else if (table.shape === "membrane") {
    const [m, j] = table.membrane![index]!;
    weight = Math.abs(besselJ(m, j * (0.05 + 0.85 * u)));
  } else return table.ratios[index]! ** (2 * (u - 0.5));
  return Math.max(POSITION_FLOOR, Math.min(1, weight));
}

/**
 * Hertz-law mallet: a unit-area half-sine force pulse. Harder mallets and
 * harder hits contact for less time (tau ~ v^-1/5), never longer than half
 * the fundamental period.
 */
export class MalletPulse {
  readonly samples: Float64Array;

  constructor(
    hardness: number,
    velocity: number,
    fundamentalHz: number,
    sampleRate: number,
  ) {
    const tauSoft = 0.004;
    const tauHard = 0.0002;
    let tau = Math.exp(
      Math.log(tauSoft) + (Math.log(tauHard) - Math.log(tauSoft)) * hardness,
    );
    tau *= Math.max(0.05, velocity) ** -0.2 * 0.9;
    // Capped at half a period at velocity 0.6, shorter for harder blows.
    tau = Math.min(tau, (0.5 * (1.6 - velocity)) / Math.max(20, fundamentalHz));
    const length = Math.max(1, Math.round(tau * sampleRate));
    const samples = new Float64Array(length);
    let area = 0;
    for (let i = 0; i < length; i += 1) {
      const value = Math.sin((Math.PI * (i + 0.5)) / length);
      samples[i] = value;
      area += value;
    }
    for (let i = 0; i < length; i += 1) samples[i]! /= area;
    this.samples = samples;
  }
}

/** Samples between control updates (poles, motor, Nyquist fade, lanes). */
export const MODAL_BLOCK = 32;
/** Middle C, where `ring` is the fundamental's T60. */
export const RING_REF_HZ = 261.63;
const SILENT = 1e-5;
/** Velocity to hardness coupling per unit velocity (review: 0.25 to 0.5). */
export const VELOCITY_HARDNESS = 0.5;
/**
 * Upper modes gain ratio^(VELOCITY_TILT (v - 0.6)): a harder blow excites
 * the upper modes more than the mallet's contact time alone shows once the
 * pulse is capped (spec test 12: onset centroid at velocity 1 at least
 * 1.15 times the centroid at 0.3). Velocity 0.6 is unchanged.
 */
export const VELOCITY_TILT = 1.5;
/** Fraction of the sample rate above which a mode fades out. */
export const NYQUIST_GUARD = 0.45;

export type ModalNote = Readonly<{
  hz: number;
  velocity: number;
  /** Song seconds of the onset (phase-locks the motor). */
  start: number;
  /** Seconds to note-off. */
  duration: number;
  seed: string;
  /** Extra hardness (an accent articulation). */
  accent?: number;
  /** Cents at t seconds from the onset (0.5 bends and glides). */
  cents?: (t: number) => number;
  /** Motor depth at t seconds from the onset (the `modal-motordepth` lane). */
  motordepth?: (t: number) => number;
}>;

/**
 * One struck note: modes as complex phasors z <- z c + x with
 * c = r e^{i w}, read from the imaginary part. Poles are recomputed every
 * `MODAL_BLOCK` samples when pitch, damping or Nyquist fades change.
 */
export class ModalBank {
  private readonly count: number;
  private readonly hz: Float64Array;
  private readonly t60: Float64Array;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly cr: Float64Array;
  private readonly ci: Float64Array;
  private readonly g: Float64Array;
  /** Nyquist fade level at the start of this block and its per-sample step. */
  private readonly fade: Float64Array;
  private readonly fadeStep: Float64Array;
  private readonly live: Uint8Array;
  private readonly motorMode: Uint8Array;
  private readonly pulse: Float64Array;
  private readonly clickBurst: Float64Array;
  private readonly random: () => number;
  private readonly buzzFilter = new Biquad();
  private readonly buzzVel: number;
  private readonly offAt: number;
  /** Sample index where the voice ends (its full ring or choke). */
  readonly endAt: number;
  private n = 0;
  private motorGain = 1;
  private released = false;
  private fading = false;

  constructor(
    private readonly settings: ModalSettings,
    private readonly note: ModalNote,
    private readonly sampleRate: number,
    maxTail: number,
  ) {
    const table = MODE_TABLES[settings.body] ?? MODE_TABLES.marimba;
    const f0 = note.hz;
    const v = clamp(note.velocity, 0, 1);
    this.random = seededRandom(`${note.seed}:modal`);
    // Modes are kept up to an octave above the guard so an upward bend can
    // fade them in; the per-tick fade keeps them silent while above it.
    const guard = NYQUIST_GUARD * sampleRate;
    const keep = 2 * guard;
    const twins = settings.ombak > 0 ? 2 : 1;
    const splits = table.split ? 2 : 1;
    const capacity = table.ratios.length * twins * splits;
    this.hz = new Float64Array(capacity);
    this.t60 = new Float64Array(capacity);
    this.zr = new Float64Array(capacity);
    this.zi = new Float64Array(capacity);
    this.cr = new Float64Array(capacity);
    this.ci = new Float64Array(capacity);
    this.g = new Float64Array(capacity);
    this.fade = new Float64Array(capacity);
    this.fadeStep = new Float64Array(capacity);
    this.live = new Uint8Array(capacity);
    this.motorMode = new Uint8Array(capacity);
    let weightSum = 0;
    let k = 0;
    for (let i = 0; i < table.ratios.length; i += 1) {
      const ratio = table.ratios[i]!;
      const weight =
        table.gains[i]! *
        positionWeight(table, i, settings.position) *
        ratio ** (VELOCITY_TILT * (v - 0.6));
      weightSum += Math.abs(table.gains[i]!);
      if (!(weight > 1e-4)) continue;
      const decay = table.decays?.[i] ?? 1;
      for (let s = 0; s < splits; s += 1) {
        for (let t = 0; t < twins; t += 1) {
          const hz =
            f0 *
              ratio *
              (splits > 1 ? 1 + (s ? 0.5 : -0.5) * table.split! : 1) +
            (twins > 1 ? (t ? 0.5 : -0.5) * settings.ombak : 0);
          if (hz >= keep || hz <= 0) continue;
          this.hz[k] = hz;
          this.t60[k] = Math.max(
            0.01,
            settings.ring * decay * (RING_REF_HZ / hz) ** settings.tilt,
          );
          this.g[k] = weight / (splits * twins);
          this.motorMode[k] = i === 0 ? 1 : 0;
          this.live[k] = 1;
          k += 1;
        }
      }
    }
    this.count = k;
    const norm =
      (settings.gain * v * (table.level ?? 1)) / Math.max(1e-9, weightSum);
    for (let i = 0; i < k; i += 1) this.g[i]! *= norm;
    const hard = clamp(
      settings.hardness + VELOCITY_HARDNESS * (v - 0.6) + (note.accent ?? 0),
      0,
      1,
    );
    this.pulse = new MalletPulse(
      hard,
      v,
      f0 * Math.min(1, table.ratios[0]!),
      sampleRate,
    ).samples;
    const clickLength = settings.click > 0 ? Math.round(0.004 * sampleRate) : 0;
    this.clickBurst = new Float64Array(clickLength);
    let last = 0;
    for (let i = 0; i < clickLength; i += 1) {
      const noise = this.random() * 2 - 1;
      this.clickBurst[i] =
        (noise - last) *
        Math.exp(-i / (0.0008 * sampleRate)) *
        settings.click *
        v *
        settings.gain *
        0.25;
      last = noise;
    }
    this.buzzFilter.set(
      "bpf",
      Math.min(3200, 0.4 * sampleRate),
      0.8,
      sampleRate,
    );
    // The buzzer rattles harder when the tine swings wider.
    this.buzzVel = v / 0.6;
    this.offAt = Math.round(note.duration * sampleRate);
    let longest = 0;
    for (let i = 0; i < k; i += 1) longest = Math.max(longest, this.t60[i]!);
    const tail =
      settings.damp > 0.999
        ? note.duration + settings.release
        : Math.max(note.duration, longest);
    this.endAt = Math.max(
      1,
      Math.round(Math.min(tail, note.duration + maxTail) * sampleRate),
    );
    this.updatePoles(0);
    // Modes above the guard at the onset start silent.
    for (let i = 0; i < k; i += 1) {
      this.fade[i] = this.fade[i]! + this.fadeStep[i]! * MODAL_BLOCK;
      this.fadeStep[i] = 0;
    }
    this.fading = false;
  }

  /** Recomputes poles, motor gain and Nyquist fades for the block at `n`. */
  private updatePoles(n: number): void {
    const t = n / this.sampleRate;
    const { settings, note } = this;
    let semis = 0;
    if (settings.strikebend !== 0)
      semis =
        settings.strikebend *
        clamp(note.velocity, 0, 1) *
        Math.exp(-t / Math.max(1e-3, settings.strikedecay));
    const cents = note.cents ? note.cents(t) : 0;
    const scale = 2 ** (semis / 12 + cents / 1200);
    const damping = this.released
      ? settings.damp / Math.max(1e-3, settings.release)
      : 0;
    const guard = NYQUIST_GUARD * this.sampleRate;
    let fading = false;
    for (let k = 0; k < this.count; k += 1) {
      if (!this.live[k]) continue;
      const hz = this.hz[k]! * scale;
      const w = (2 * Math.PI * hz) / this.sampleRate;
      const rate = 1 / this.t60[k]! + damping;
      const r = radiusForT60(1 / rate, this.sampleRate);
      this.cr[k] = r * Math.cos(w);
      this.ci[k] = r * Math.sin(w);
      // Fade a mode to silence over one tick while it sits above the guard.
      const target = hz < guard ? 1 : 0;
      const step = (target - this.fade[k]!) / MODAL_BLOCK;
      this.fadeStep[k] = step;
      if (step !== 0) fading = true;
    }
    this.fading = fading;
    const depth = note.motordepth ? note.motordepth(t) : settings.motordepth;
    if (settings.motor > 0 && depth > 0) {
      const phase = (note.start + t) * settings.motor;
      this.motorGain =
        1 - clamp(depth, 0, 1) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
    } else this.motorGain = 1;
  }

  /** Samples rendered so far. */
  get position(): number {
    return this.n;
  }

  /**
   * Adds `count` samples into out[offset..], each scaled by `level(i)`
   * when given; returns false once the voice has ended or gone silent.
   */
  process(out: Float64Array, offset: number, count: number): boolean {
    const { zr, zi, cr, ci, g, live, motorMode, pulse, clickBurst, settings } =
      this;
    const modes = this.count;
    const buzz = settings.buzz;
    const motor =
      settings.motor > 0 &&
      (settings.motordepth > 0 || this.note.motordepth !== undefined);
    const dynamic =
      settings.strikebend !== 0 || this.note.cents !== undefined || motor;
    const fade = this.fade;
    const fadeStep = this.fadeStep;
    for (let i = 0; i < count; i += 1) {
      const n = this.n;
      if (n >= this.endAt) return false;
      if (n % MODAL_BLOCK === 0) {
        if (this.fading) {
          for (let k = 0; k < modes; k += 1) {
            fade[k] = clamp(fade[k]!, 0, 1);
            fadeStep[k] = 0;
          }
          this.fading = false;
        }
        let changed = false;
        if (!this.released && n >= this.offAt && settings.damp > 0) {
          this.released = true;
          changed = true;
        }
        if (n > pulse.length && n % (MODAL_BLOCK * 16) === 0) {
          let alive = 0;
          for (let k = 0; k < modes; k += 1) {
            if (!live[k]) continue;
            if (Math.abs(g[k]!) * Math.hypot(zr[k]!, zi[k]!) < SILENT)
              live[k] = 0;
            else alive += 1;
          }
          if (alive === 0) {
            this.n = this.endAt;
            return false;
          }
        }
        if (n > 0 && (dynamic || changed || this.released)) this.updatePoles(n);
      }
      const x = n < pulse.length ? pulse[n]! : 0;
      let y = 0;
      let ym = 0;
      if (this.fading) {
        for (let k = 0; k < modes; k += 1) {
          const a = zr[k]!;
          const b = zi[k]!;
          const nr = a * cr[k]! - b * ci[k]! + x;
          const ni = a * ci[k]! + b * cr[k]!;
          zr[k] = nr;
          zi[k] = ni;
          const level = g[k]! * fade[k]!;
          fade[k] = fade[k]! + fadeStep[k]!;
          if (motor && motorMode[k]) ym += level * ni;
          else y += level * ni;
        }
      } else {
        for (let k = 0; k < modes; k += 1) {
          const a = zr[k]!;
          const b = zi[k]!;
          const nr = a * cr[k]! - b * ci[k]! + x;
          const ni = a * ci[k]! + b * cr[k]!;
          zr[k] = nr;
          zi[k] = ni;
          const level = g[k]! * fade[k]!;
          if (motor && motorMode[k]) ym += level * ni;
          else y += level * ni;
        }
      }
      y += ym * this.motorGain;
      if (n < clickBurst.length) y += clickBurst[n]!;
      if (buzz > 0) {
        const excess = Math.abs(y) - 0.04;
        if (excess > 0)
          y += this.buzzFilter.process(
            (this.random() * 2 - 1) * excess * buzz * 6 * this.buzzVel,
          );
        else this.buzzFilter.process(0);
      }
      out[offset + i]! += y;
      this.n += 1;
    }
    return true;
  }
}
