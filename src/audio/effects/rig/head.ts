/**
 * Amp heads (`fx.head`): preamp triode stages, a Yeh & Smith tone stack
 * ("Discretization of the '59 Fender Bassman Tone Stack", DAFx-06; Fender,
 * Marshall and Vox-like component values), a push-pull power amp with
 * supply sag and presence, then a makeup gain so every type and gain
 * setting plays a fixed -30 dBFS sine back at -30 dBFS. Ported from the 0.6
 * guitar prototype; `solid` (JC-120) and `bass` (SVT) are dawg additions in
 * the same model.
 */
import type { Adaa1 } from "../../dsp/shape.ts";
import { Dc, Hp1, Lp1, Rbj, clamp } from "./filters.ts";
import { adaaTanh, adaaTriode, runSection } from "./section.ts";

export const HEAD_TYPES = [
  "clean",
  "chime",
  "crunch",
  "lead",
  "high",
  "solid",
  "bass",
] as const;
export type HeadType = (typeof HEAD_TYPES)[number];

type StackValues = Readonly<{
  C1: number;
  C2: number;
  C3: number;
  R1: number;
  R2: number;
  R3: number;
  R4: number;
}>;

const STACKS = {
  // Fender 5F6-A Bassman (Yeh & Smith 2006, table 1).
  fender: {
    C1: 250e-12,
    C2: 20e-9,
    C3: 20e-9,
    R1: 250e3,
    R2: 1e6,
    R3: 25e3,
    R4: 56e3,
  },
  // Marshall JCM800 2203 (common FMV values).
  marshall: {
    C1: 470e-12,
    C2: 22e-9,
    C3: 22e-9,
    R1: 220e3,
    R2: 1e6,
    R3: 22e3,
    R4: 33e3,
  },
  // Brighter Vox-like voicing approximated with FMV values.
  vox: {
    C1: 100e-12,
    C2: 47e-9,
    C3: 22e-9,
    R1: 220e3,
    R2: 1e6,
    R3: 10e3,
    R4: 100e3,
  },
} satisfies Record<string, StackValues>;

/** Continuous FMV stack coefficients [b0..b3], [a0..a3]; pots t, m, l 0..1. */
export function stackAnalog(
  v: StackValues,
  t: number,
  m: number,
  l: number,
): { b: number[]; a: number[] } {
  const { C1, C2, C3, R1, R2, R3, R4 } = v;
  const b1 =
    t * C1 * R1 + m * C3 * R3 + l * (C1 * R2 + C2 * R2) + (C1 * R3 + C2 * R3);
  const b2 =
    t * (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4) -
    m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    m * (C1 * C3 * R1 * R3 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    l * (C1 * C2 * R1 * R2 + C1 * C2 * R2 * R4 + C1 * C3 * R2 * R4) +
    l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) +
    (C1 * C2 * R1 * R3 + C1 * C2 * R3 * R4 + C1 * C3 * R3 * R4);
  const b3 =
    l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) -
    m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) +
    m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) +
    t * C1 * C2 * C3 * R1 * R3 * R4 -
    t * m * C1 * C2 * C3 * R1 * R3 * R4 +
    t * l * C1 * C2 * C3 * R1 * R2 * R4;
  const a1 =
    C1 * R1 +
    C1 * R3 +
    C2 * R3 +
    C2 * R4 +
    C3 * R4 +
    m * C3 * R3 +
    l * (C1 * R2 + C2 * R2);
  const a2 =
    m *
      (C1 * C3 * R1 * R3 -
        C2 * C3 * R3 * R4 +
        C1 * C3 * R3 * R3 +
        C2 * C3 * R3 * R3) +
    l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) -
    m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    l *
      (C1 * C2 * R2 * R4 +
        C1 * C2 * R1 * R2 +
        C1 * C3 * R2 * R4 +
        C2 * C3 * R2 * R4) +
    (C1 * C2 * R1 * R4 +
      C1 * C3 * R1 * R4 +
      C1 * C2 * R3 * R4 +
      C1 * C2 * R1 * R3 +
      C1 * C3 * R3 * R4 +
      C2 * C3 * R3 * R4);
  const a3 =
    l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) -
    m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) +
    m *
      (C1 * C2 * C3 * R3 * R3 * R4 +
        C1 * C2 * C3 * R1 * R3 * R3 -
        C1 * C2 * C3 * R1 * R3 * R4) +
    l * C1 * C2 * C3 * R1 * R2 * R4 +
    C1 * C2 * C3 * R1 * R3 * R4;
  return { b: [0, b1, b2, b3], a: [1, a1, a2, a3] };
}

/** |H(j 2π f)| of the analog stack (for tests). */
export function stackAnalogMag(
  v: StackValues,
  t: number,
  m: number,
  l: number,
  f: number,
): number {
  const { b, a } = stackAnalog(v, t, m, l);
  const w = 2 * Math.PI * f;
  const nr = b[0]! - b[2]! * w * w;
  const ni = b[1]! * w - b[3]! * w * w * w;
  const dr = a[0]! - a[2]! * w * w;
  const di = a[1]! * w - a[3]! * w * w * w;
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

/** Third-order IIR from the bilinear transform of the analog stack. */
export class ToneStack {
  b = [0, 0, 0, 0];
  a = [1, 0, 0, 0];
  z0 = 0;
  z1 = 0;
  z2 = 0;

  constructor(
    readonly values: StackValues,
    t: number,
    m: number,
    l: number,
    readonly sr: number,
  ) {
    this.set(t, m, l);
  }

  set(t: number, m: number, l: number): void {
    const { b, a } = stackAnalog(
      this.values,
      clamp(t, 0, 1),
      clamp(m, 0, 1),
      clamp(l, 0, 1),
    );
    const c = 2 * this.sr;
    const c2 = c * c;
    const c3 = c2 * c;
    const B0 = -b[1]! * c - b[2]! * c2 - b[3]! * c3;
    const B1 = -b[1]! * c + b[2]! * c2 + 3 * b[3]! * c3;
    const B2 = b[1]! * c + b[2]! * c2 - 3 * b[3]! * c3;
    const B3 = b[1]! * c - b[2]! * c2 + b[3]! * c3;
    const A0 = -1 - a[1]! * c - a[2]! * c2 - a[3]! * c3;
    const A1 = -3 - a[1]! * c + a[2]! * c2 + 3 * a[3]! * c3;
    const A2 = -3 + a[1]! * c + a[2]! * c2 - 3 * a[3]! * c3;
    const A3 = -1 + a[1]! * c - a[2]! * c2 + a[3]! * c3;
    this.b = [B0 / A0, B1 / A0, B2 / A0, B3 / A0];
    this.a = [1, A1 / A0, A2 / A0, A3 / A0];
  }

  process(x: number): number {
    const { b, a } = this;
    const y = b[0]! * x + this.z0;
    this.z0 = b[1]! * x - a[1]! * y + this.z1;
    this.z1 = b[2]! * x - a[2]! * y + this.z2;
    this.z2 = b[3]! * x - a[3]! * y;
    return y;
  }
}

/** The bass pot is audio taper: knob 0..1 to resistance fraction. */
export const audioTaper = (k: number): number =>
  k <= 0 ? 0 : (10 ** (2 * clamp(k, 0, 1)) - 1) / 99;

type HeadModel = Readonly<{
  stages: number;
  stack: keyof typeof STACKS;
  /** Gain per preamp stage at gain 10 (linear). */
  stageGain: number;
  /** Interstage low-pass (Miller capacitance), Hz. */
  miller: number;
  /** Interstage coupling high-pass, Hz. */
  coupling: number;
  /** Bright cap: high shelf dB at low gain. */
  bright: number;
  /** Power amp drive into the push-pull stage. */
  power: number;
  sag: number;
  /** Symmetric (solid state) preamp clipping. */
  symmetric?: boolean;
}>;

const HEADS: Record<HeadType, HeadModel> = {
  clean: {
    stages: 1,
    stack: "fender",
    stageGain: 6,
    miller: 9000,
    coupling: 20,
    bright: 4,
    power: 0.6,
    sag: 0.2,
  },
  chime: {
    stages: 2,
    stack: "vox",
    stageGain: 5,
    miller: 8000,
    coupling: 60,
    bright: 3,
    power: 1.4,
    sag: 0.45,
  },
  crunch: {
    stages: 2,
    stack: "marshall",
    stageGain: 14,
    miller: 7000,
    coupling: 80,
    bright: 2,
    power: 1.0,
    sag: 0.3,
  },
  lead: {
    stages: 3,
    stack: "marshall",
    stageGain: 18,
    miller: 6500,
    coupling: 120,
    bright: 1,
    power: 1.0,
    sag: 0.25,
  },
  high: {
    stages: 4,
    stack: "marshall",
    stageGain: 20,
    miller: 6000,
    coupling: 160,
    bright: 0,
    power: 1.2,
    sag: 0.2,
  },
  // Solid-state clean (Roland JC-120): symmetric, stiff supply, bright.
  solid: {
    stages: 1,
    stack: "fender",
    stageGain: 3,
    miller: 12_000,
    coupling: 20,
    bright: 2,
    power: 0.4,
    sag: 0,
    symmetric: true,
  },
  // Tube bass head (Ampeg SVT): low coupling, darker interstage, more sag.
  bass: {
    stages: 2,
    stack: "fender",
    stageGain: 8,
    miller: 5000,
    coupling: 15,
    bright: 0,
    power: 1.0,
    sag: 0.35,
  },
};

export type HeadSettings = Readonly<{
  type: string;
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  master: number;
  sag?: number;
}>;

/** A head running at the oversampled rate `sr`. */
export class HeadCircuit {
  private readonly model: HeadModel;
  private readonly inHp: Hp1;
  private readonly bright: Rbj;
  private readonly stages: {
    pre: number;
    shaper: Adaa1;
    hp: Hp1;
    lp: Lp1;
  }[] = [];
  private readonly stack: ToneStack;
  private readonly power = adaaTanh();
  private readonly presence: Rbj;
  private readonly env: Lp1;
  private readonly dc: Dc;
  private drive = 1;
  private sagAmount = 0;
  private headroom = 1;
  private envLevel = 0;
  private count = 0;
  /** Sag is updated every this many oversampled samples (32 base). */
  private readonly control: number;

  constructor(
    settings: HeadSettings,
    private readonly sr: number,
    factor: number,
  ) {
    this.model = HEADS[settings.type as HeadType] ?? HEADS.crunch;
    this.control = 32 * factor;
    this.inHp = new Hp1(30, sr);
    this.bright = new Rbj("highshelf", 2500, 0.7, sr, 0);
    for (let s = 0; s < this.model.stages; s += 1)
      this.stages.push({
        pre: 1,
        shaper: this.model.symmetric ? adaaTanh() : adaaTriode(),
        hp: new Hp1(s === 0 ? 20 : this.model.coupling, sr),
        lp: new Lp1(this.model.miller, sr),
      });
    this.stack = new ToneStack(STACKS[this.model.stack], 0.5, 0.5, 0.5, sr);
    this.presence = new Rbj("highshelf", 3200, 0.7, sr, 0);
    this.env = new Lp1(6, sr);
    this.dc = new Dc(sr, 10);
    this.set(settings);
    this.setTone(settings);
  }

  /** Gain and master (cheap; control rate when automated). */
  set(p: HeadSettings): void {
    const model = this.model;
    const g = clamp(p.gain / 10, 0, 1);
    this.bright.set("highshelf", 2500, 0.7, this.sr, model.bright * (1 - g));
    for (let s = 0; s < this.stages.length; s += 1)
      this.stages[s]!.pre =
        s === 0
          ? 0.6 + model.stageGain * g * g * 1.6
          : model.stageGain * (0.3 + 0.7 * g);
    this.drive = model.power * (0.25 + 0.18 * clamp(p.master, 0, 10));
    this.sagAmount = clamp(p.sag ?? model.sag, 0, 1);
  }

  /** Tone stack and presence (static). */
  setTone(p: HeadSettings): void {
    this.stack.set(
      clamp(p.treble / 10, 0, 1),
      clamp(p.mid / 10, 0, 1),
      audioTaper(p.bass / 10),
    );
    this.presence.set(
      "highshelf",
      3200,
      0.7,
      this.sr,
      (clamp(p.presence, 0, 10) - 5) * 1.6,
    );
  }

  process(input: number): number {
    let x = this.bright.process(this.inHp.process(input));
    const stages = this.stages;
    for (let s = 0; s < stages.length; s += 1) {
      const st = stages[s]!;
      x = st.lp.process(st.shaper.process(st.hp.process(x) * st.pre));
      // Each triode stage inverts, alternating the asymmetry.
      x = -x;
    }
    x = this.stack.process(x) * 4.5;
    if (this.count % this.control === 0)
      this.headroom = 1 / (1 + 2.5 * this.sagAmount * this.envLevel);
    this.count += 1;
    const u =
      this.power.process((x * this.drive) / this.headroom) * this.headroom;
    this.envLevel = this.env.process(Math.abs(u));
    return this.dc.process(this.presence.process(u)) * 0.5;
  }
}

/** Calibration input: a 196 Hz (G3) sine at -30 dBFS. */
export const CALIBRATION_HZ = 196;
export const CALIBRATION_DBFS = -30;

const makeups = new Map<string, number>();

/**
 * Linear gain that brings `settings` (tone stack included) back to the
 * calibration sine's level: run the head on the sine, compare RMS after it
 * settles. Deterministic and cached per settings and rate.
 */
export function headMakeup(
  settings: HeadSettings,
  sampleRate: number,
  factor: 2 | 4,
): number {
  const key = `${sampleRate}|${factor}|${settings.type}|${settings.gain}|${settings.bass}|${settings.mid}|${settings.treble}|${settings.presence}|${settings.master}|${settings.sag ?? ""}`;
  const known = makeups.get(key);
  if (known !== undefined) return known;
  const amplitude = 10 ** (CALIBRATION_DBFS / 20) * Math.SQRT2;
  const settle = Math.round(sampleRate * 0.1);
  const length = settle + Math.round(sampleRate * 0.1);
  const buffer = new Float64Array(length);
  const w = (2 * Math.PI * CALIBRATION_HZ) / sampleRate;
  for (let i = 0; i < length; i += 1) buffer[i] = amplitude * Math.sin(w * i);
  const head = new HeadCircuit(settings, sampleRate * factor, factor);
  runSection(buffer, factor, (x) => head.process(x));
  let sum = 0;
  for (let i = settle; i < length; i += 1) sum += buffer[i]! * buffer[i]!;
  const rms = Math.sqrt(sum / (length - settle));
  const target = 10 ** (CALIBRATION_DBFS / 20);
  const makeup = rms > 1e-12 ? target / rms : 1;
  makeups.set(key, makeup);
  if (makeups.size > 4096) makeups.delete(makeups.keys().next().value!);
  return makeup;
}

/** Automated makeup grid: gain and master in whole steps, 0..10. */
const GRID = 11;
const grids = new Map<string, Float64Array>();

/**
 * Makeup for automated gain and master: bilinear between whole-step
 * calibration points of the same settings, computed lazily and cached per
 * tone settings and rate. Smooth across blocks (no cache key per value),
 * and a ramp calibrates at most a few dozen points once per process.
 */
export function headMakeupAt(
  settings: HeadSettings,
  sampleRate: number,
  factor: 2 | 4,
): number {
  const key = `${sampleRate}|${factor}|${settings.type}|${settings.bass}|${settings.mid}|${settings.treble}|${settings.presence}|${settings.sag ?? ""}`;
  let grid = grids.get(key);
  if (!grid) {
    grid = new Float64Array(GRID * GRID).fill(Number.NaN);
    grids.set(key, grid);
    if (grids.size > 256) grids.delete(grids.keys().next().value!);
  }
  const g = clamp(settings.gain, 0, 10);
  const m = clamp(settings.master, 0, 10);
  const g0 = Math.min(GRID - 2, Math.floor(g));
  const m0 = Math.min(GRID - 2, Math.floor(m));
  const point = (gi: number, mi: number): number => {
    const at = gi * GRID + mi;
    let value = grid[at]!;
    if (Number.isNaN(value)) {
      value = headMakeup(
        { ...settings, gain: gi, master: mi },
        sampleRate,
        factor,
      );
      grid[at] = value;
    }
    return value;
  };
  const fg = g - g0;
  const fm = m - m0;
  const a = point(g0, m0) + (point(g0, m0 + 1) - point(g0, m0)) * fm;
  const b =
    point(g0 + 1, m0) + (point(g0 + 1, m0 + 1) - point(g0 + 1, m0)) * fm;
  return a + (b - a) * fg;
}
