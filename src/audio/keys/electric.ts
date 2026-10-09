/**
 * Electric keys (0.6.1 keys-electric lane): the Rhodes-style tine piano
 * (`epiano`), the Wurlitzer-style reed piano (`wurli`) and the clavinet
 * (`clav`), ported from the reviewed prototype
 * (`.plans/dawg-06/proto/keys/keys.ts`, `TineVoice` and `ClavVoice`) with
 * the review's round-2 fixes: the pickups run at twice the sample rate
 * (band-limited both ways, so a hard-driven tine does not alias), the
 * epiano carries its own suitcase stereo vibrato (`vibe`), the wurli its
 * tremolo (`trem`), and clav pickup positions vary per track (seeded).
 *
 * Tine: a clamped-free cantilever, three modes at 1, 6.267 and 17.547 times
 * the fundamental plus the tone bar, read through an electromagnetic pickup
 * whose flux falls off with the tine's distance from the pole piece
 * (1 / (1 + d^2)), differentiated (Faraday). After Shear and Wright, "The
 * Electromagnetically Sustained Rhodes Piano" (NIME 2011) and Gabrielli et
 * al., "Physical modeling of the Rhodes piano" (DAFx-10). Reed: the
 * electrostatic pickup of the Wurlitzer 200 reads capacitance, 1 / (1 - k x),
 * not a derivative; a peak at 1.1 kHz gives the nasal case. Clav: modal
 * string struck near its end by a tangent, two pickup combs sin(n pi p) at
 * neck and bridge, the mute slider damping upper partials and a small
 * negative re-pluck when the string leaves the anvil (Gabrielli, Välimäki,
 * Penttinen, Squartini and Bilbao, EURASIP JASP 2013:103).
 */
import { DcBlock, OnePole } from "../dsp/filters.ts";
import { Oversample2x } from "../dsp/oversample.ts";
import { unit } from "../dsp/rng.ts";
import {
  Biquad2,
  Burst,
  clamp,
  hammerPulse,
  lerp,
  LN1000,
  ModeBank,
  panGains,
  TAU,
} from "./dsp.ts";

/** Resolved electric voice parameters (core/keys.ts `KEYS_PARAMS`). */
export type ElectricParams = Readonly<{
  kind: "epiano" | "wurli" | "clav";
  hardness: number;
  touch: number;
  decay: number;
  release: number;
  width: number;
  bark: number;
  bell: number;
  /** Output low-pass in Hz; 0 is off. */
  tone: number;
  pickup: "neck" | "bridge" | "both" | "out";
  mute: number;
}>;

export type ElectricNoteOn = Readonly<{
  pitch: number;
  hz: number;
  velocity: number;
  /** Track seed hash (clav pickup positions are per track). */
  trackSeed: number;
  noteSeed: string;
}>;

/** Clamped-free cantilever mode ratios. */
const BEAM = [1, 6.267, 17.547] as const;
/** Rest position of the tine relative to the pickup pole. */
const X0 = 0.4;

/** The voice interface the keys engine drives (shared with `PianoVoice`). */
export type KeysVoice = {
  readonly gl: number;
  readonly gr: number;
  readonly released: boolean;
  noteOff(): void;
  setCents(cents: number): void;
  damp(tau: number): void;
  process(out: Float64Array, offset: number, count: number): boolean;
};

/** Seconds a released tine or reed takes to fall 60 dB. */
export function tineReleaseT60(pitch: number, release: number): number {
  return release * (0.09 + 0.25 * clamp((60 - pitch) / 32, 0, 1));
}

/** Seconds a released clav string takes to fall 60 dB (the yarn damper). */
export function clavReleaseT60(release: number): number {
  return release * 0.06;
}

/** Tine (epiano) and reed (wurli) voice. */
export class TineVoice implements KeysVoice {
  private readonly bank: ModeBank;
  private readonly pulse: Float64Array;
  private pos = 0;
  private readonly over = new Oversample2x();
  private readonly dc: DcBlock;
  private readonly lp: OnePole | undefined;
  private readonly peak: Biquad2 | undefined;
  private readonly norm: number;
  readonly gl: number;
  readonly gr: number;
  private tmp = new Float64Array(0);
  private readonly bursts: Burst[] = [];
  private readonly rhodes: boolean;
  /** Pickup state at the doubled rate. */
  private prevX = 0;
  private prevPhi = 0;
  private releasedFlag = false;
  private age = 0;
  private readonly shape: (x: number) => number;

  constructor(
    private readonly note: ElectricNoteOn,
    private readonly p: ElectricParams,
    private readonly sr: number,
  ) {
    const v = clamp(lerp(0.8, note.velocity, p.touch), 0.01, 1);
    const key = note.pitch;
    const f = note.hz;
    const rhodes = p.kind === "epiano";
    this.rhodes = rhodes;
    const T = rhodes
      ? p.decay * 9 * 2 ** (-(key - 36) / 26)
      : p.decay * 4.5 * 2 ** (-(key - 40) / 26);
    const bell =
      p.bell *
      (rhodes ? 0.04 + 0.22 * v * v : 0.02 + 0.08 * v * v) *
      2 ** (-(key - 60) / 30);
    const drive = lerp(0.35, rhodes ? 1.6 : 1.5, p.bark);
    const A = (0.15 + 0.85 * v) * drive;
    // Hardness scales the hammer contact (0.5 is the prototype's).
    const contact = lerp(2.2, 0.9, v) * (1.4 - 0.8 * p.hardness);
    this.pulse = hammerPulse(Math.max(2, Math.round(contact * 1e-3 * sr)), 1.5);
    this.bank = new ModeBank(4);
    this.bank.add(f, T, A * 0.85, 1, sr);
    // Tone bar: a slightly sharp, longer partner (the Rhodes tuning fork).
    if (rhodes) this.bank.add(f * 2 ** (0.4 / 1200), T * 1.3, A * 0.15, 1, sr);
    this.bank.add(f * BEAM[1], 0.35 * 2 ** (-(key - 60) / 24), A * bell, 1, sr);
    if (rhodes) this.bank.add(f * BEAM[2], 0.06, A * bell * 0.3 * v, 1, sr);
    // Normalise by the pickup's small-signal slope at the doubled rate.
    const w = (TAU * f) / (2 * sr);
    this.norm =
      (rhodes ? 0.3 : 0.32) /
      ((rhodes ? (2 * X0) / (1 + X0 * X0) ** 2 : 0.5) * w);
    this.prevPhi = this.pickup(0);
    this.dc = new DcBlock(sr, 8);
    this.lp = p.tone > 0 ? new OnePole(p.tone, sr) : undefined;
    this.peak = rhodes
      ? undefined
      : new Biquad2().set("peak", 1100, 0.9, 4, sr);
    [this.gl, this.gr] = panGains(p.width * clamp((key - 60) / 30, -1, 1));
    this.bursts.push(
      new Burst(
        `${note.noteSeed}:tine`,
        rhodes ? 1800 : 1200,
        1.2,
        0.002,
        0.01 * v * v,
        sr,
      ),
    );
    // The pickup at 2x: linear interpolation of the modal output between
    // base-rate samples is done by the half-band interpolator; this runs on
    // each doubled-rate sample in order, so it may keep state.
    this.shape = (x: number) => {
      this.prevX = x;
      const phi = this.pickup(x);
      const dy = rhodes ? -(phi - this.prevPhi) : phi - this.prevPhi;
      this.prevPhi = phi;
      const y = dy * this.norm;
      return rhodes ? y : Math.tanh(1.3 * y) / 1.3;
    };
  }

  private pickup(x: number): number {
    if (this.rhodes) {
      const d = x - X0;
      return 1 / (1 + d * d);
    }
    return 1 / (1 - 0.5 * Math.min(x, 1.6));
  }

  get released(): boolean {
    return this.releasedFlag;
  }

  noteOff(): void {
    if (this.releasedFlag) return;
    this.releasedFlag = true;
    const t = tineReleaseT60(this.note.pitch, this.p.release);
    this.bank.damp(() => t, this.sr);
    this.bursts.push(
      new Burst(
        `${this.note.noteSeed}:damper`,
        180,
        1,
        0.02,
        0.006 * this.note.velocity,
        this.sr,
      ),
    );
  }

  setCents(cents: number): void {
    this.bank.retune(2 ** (cents / 1200));
  }

  damp(tau: number): void {
    this.bank.damp(() => LN1000 * tau, this.sr);
  }

  process(out: Float64Array, offset: number, count: number): boolean {
    if (this.tmp.length < count) this.tmp = new Float64Array(count);
    const tmp = this.tmp;
    tmp.fill(0, 0, count);
    let done = 0;
    if (this.pos < this.pulse.length) {
      done = Math.min(count, this.pulse.length - this.pos);
      this.bank.run(tmp, 0, done, this.pulse, this.pos);
      this.pos += done;
    }
    if (done < count) this.bank.run(tmp, done, count - done, null, 0);
    for (let i = 0; i < count; i += 1) {
      let y = this.over.process(tmp[i]!, this.shape);
      y = this.dc.process(y);
      if (this.peak) y = this.peak.process(y);
      if (this.lp) y = this.lp.process(y);
      for (const b of this.bursts) if (!b.done) y += b.next();
      out[offset + i]! += y;
    }
    this.age += count;
    if (this.age % 256 < count) this.bank.cull(1e-6);
    // The oversampler and DC blocker hold a short tail after the modes go.
    return (
      this.bank.n > 0 ||
      this.bursts.some((b) => !b.done) ||
      Math.abs(this.prevX) > 1e-9
    );
  }
}

/**
 * Clav pickup positions (fractions of the string from the bridge end), with
 * a seeded per-track spread of +/-6%: two clavinets never sound identical.
 */
export function clavPositions(trackSeed: number): {
  neck: number;
  bridge: number;
  tangent: number;
} {
  const spread = (slot: number) => 1 + 0.12 * (unit(trackSeed, 0, slot) - 0.5);
  return {
    neck: 0.19 * spread(0),
    bridge: 0.065 * spread(1),
    tangent: 0.04 * spread(2),
  };
}

export class ClavVoice implements KeysVoice {
  private readonly bank: ModeBank;
  private pulse: Float64Array;
  private pos = 0;
  private readonly lp: OnePole | undefined;
  private readonly hp: Biquad2;
  readonly gl: number;
  readonly gr: number;
  private tmp = new Float64Array(0);
  private releasedFlag = false;
  private age = 0;

  constructor(
    note: ElectricNoteOn,
    private readonly p: ElectricParams,
    private readonly sr: number,
  ) {
    const v = clamp(lerp(0.8, note.velocity, p.touch), 0.01, 1);
    const key = note.pitch;
    const B = 1.5e-4 * 2 ** ((key - 48) / 16);
    // Partial 1 sits exactly at the tuned pitch.
    const f0 = note.hz / Math.sqrt(1 + B);
    const T = p.decay * 5 * 2 ** (-(key - 40) / 24);
    const { neck, bridge, tangent } = clavPositions(note.trackSeed);
    const contact = lerp(0.6, 0.25, v) * (1.4 - 0.8 * p.hardness);
    this.pulse = hammerPulse(Math.max(2, Math.round(contact * 1e-3 * sr)), 1.2);
    const bank = new ModeBank(80);
    const modes: [number, number, number][] = [];
    let energy = 0;
    for (let n = 1; n <= 80; n += 1) {
      const fn = n * f0 * Math.sqrt(1 + B * n * n);
      if (fn >= 0.45 * sr) break;
      const a = Math.sin(n * Math.PI * neck);
      const b = Math.sin(n * Math.PI * bridge);
      const w =
        p.pickup === "neck"
          ? a
          : p.pickup === "bridge"
            ? b * 2
            : p.pickup === "out"
              ? a - b
              : (a + b) * 0.7;
      const u = Math.sin(n * Math.PI * tangent) * w;
      const t60 =
        (T / (1 + (fn / 3000) ** 2)) *
        (1 - 0.85 * p.mute * Math.min(1, (n - 1) / 4));
      modes.push([fn, t60, u]);
      energy += Math.sin(n * Math.PI * tangent) ** 2;
    }
    const G = (0.5 * v ** 1.2) / Math.sqrt(Math.max(1e-9, energy));
    for (const [fn, t60, u] of modes)
      bank.add(fn, Math.max(0.02, t60), u * G, 1, sr);
    this.bank = bank;
    this.lp = p.tone > 0 ? new OnePole(p.tone, sr) : undefined;
    this.hp = new Biquad2().set("hpf", 70, 0.7, 0, sr);
    [this.gl, this.gr] = panGains(p.width * clamp((key - 60) / 30, -1, 1));
  }

  get released(): boolean {
    return this.releasedFlag;
  }

  noteOff(): void {
    if (this.releasedFlag) return;
    this.releasedFlag = true;
    // The string leaves the anvil: a small negative pluck, then the yarn damps it.
    const plunk = hammerPulse(Math.max(2, Math.round(0.3e-3 * this.sr)), 1);
    for (let i = 0; i < plunk.length; i += 1) plunk[i]! *= -0.35;
    this.pulse = plunk;
    this.pos = 0;
    const t = clavReleaseT60(this.p.release);
    this.bank.damp(() => t, this.sr);
  }

  setCents(cents: number): void {
    this.bank.retune(2 ** (cents / 1200));
  }

  damp(tau: number): void {
    this.bank.damp(() => LN1000 * tau, this.sr);
  }

  process(out: Float64Array, offset: number, count: number): boolean {
    if (this.tmp.length < count) this.tmp = new Float64Array(count);
    const tmp = this.tmp;
    tmp.fill(0, 0, count);
    let done = 0;
    if (this.pos < this.pulse.length) {
      done = Math.min(count, this.pulse.length - this.pos);
      this.bank.run(tmp, 0, done, this.pulse, this.pos);
      this.pos += done;
    }
    if (done < count) this.bank.run(tmp, done, count - done, null, 0);
    for (let i = 0; i < count; i += 1) {
      let y = this.hp.process(tmp[i]!);
      if (this.lp) y = this.lp.process(y);
      out[offset + i]! += y;
    }
    this.age += count;
    if (this.age % 256 < count) this.bank.cull(1e-6);
    return this.bank.n > 0;
  }
}

/** A voice for an electric family. */
export function electricVoice(
  note: ElectricNoteOn,
  p: ElectricParams,
  sr: number,
): KeysVoice {
  return p.kind === "clav"
    ? new ClavVoice(note, p, sr)
    : new TineVoice(note, p, sr);
}

/**
 * The electric post stage, run on the summed track: the epiano's suitcase
 * stereo vibrato (antiphase left/right gain, `vibe` depth at `vibehz`) and
 * the wurli's tremolo (`trem` depth at 5.6 Hz, both channels). The phase is
 * song time (`startSample` of the buffer at the song's sample 0), so a loop
 * and a full render agree. `depthAt(sample)` reads the lane.
 */
export function electricPost(
  left: Float64Array,
  right: Float64Array,
  kind: ElectricParams["kind"],
  rateHz: number,
  depthAt: (sample: number) => number,
  sr: number,
  startSample = 0,
): void {
  if (kind === "clav") return;
  const block = 32;
  for (let i = 0; i < left.length; i += block) {
    const depth = clamp(depthAt(i), 0, 1);
    const end = Math.min(left.length, i + block);
    if (depth <= 0) continue;
    for (let s = i; s < end; s += 1) {
      const lfo = Math.sin((TAU * rateHz * (s + startSample)) / sr);
      if (kind === "epiano") {
        // Constant-power autopan between the two speakers of the suitcase.
        const pan = depth * lfo;
        const a = ((pan + 1) * Math.PI) / 4;
        left[s]! *= Math.SQRT2 * Math.cos(a);
        right[s]! *= Math.SQRT2 * Math.sin(a);
      } else {
        const gain = 1 - 0.5 * depth * (1 - lfo);
        left[s]! *= gain;
        right[s]! *= gain;
      }
    }
  }
}
