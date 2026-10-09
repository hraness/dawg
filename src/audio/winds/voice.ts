/**
 * One blown voice: a digital waveguide bore driven by a reed table
 * (clarinet, `reed`), a conical reed (`sax`, also oboe and bassoon), an
 * air jet (`jet`, flutes; open or stopped) or a lip resonator (`lips`,
 * brass). After Cook and Scavone's STK (Clarinet, Saxofony, Flute, Brass;
 * https://github.com/thestk/stk) and J. O. Smith, Physical Audio Signal
 * Processing (https://ccrma.stanford.edu/~jos/pasp/), ported from the
 * reviewed prototype (.plans/dawg-06/proto/resonators/winds.ts) with the
 * review's fixes:
 *
 * - jet: a two-period loop (bore 1.5 periods, jet 0.5) less the loop
 *   low-pass and DC-blocker phase delays, with a jet offset and an edge
 *   tap so open pipes get even harmonics; stopped pipes are an inverting
 *   half-period bore (odd harmonics).
 * - jet, reed and sax run at twice the rate with first-order ADAA on their
 *   nonlinearity and the 47-tap half-band decimator; brass runs at 1x.
 * - Thiran fractional delays, loop cutoff and the trim are retuned every
 *   32-sample control tick (bends, glides, slurs, vibrato).
 * - The oscillation pressure keeps a 0.45 floor for stable pitch; a
 *   separate breath gain (30 dB over breath 0..1) makes swells audible.
 *
 * Deterministic: noise from `seededRandom` keyed by the note.
 */
import type { WindSettings } from "../../../core/resonators.ts";
import { Decimate2 } from "../dsp/oversample.ts";
import { seededRandom } from "../dsp/rng.ts";
import { DcBlock, OnePole } from "../dsp/filters.ts";
import {
  WindBiquad,
  LoopDelay,
  dcBlockDelay,
  onePoleDelay,
} from "./filters.ts";

/** Control tick in base-rate samples. */
export const WIND_BLOCK = 32;

/** Pitch target over the voice: the first entry at 0, slurs after it. */
export type WindSegment = Readonly<{ at: number; hz: number }>;

export type WindNote = Readonly<{
  /** Pitches in base-rate samples from the voice start; [0] at 0. */
  segments: readonly WindSegment[];
  /** Breath duration (note-off) in base-rate samples. */
  length: number;
  velocity: number;
  seed: string;
  /** Extra breath for accent/marcato (+), less for ghost (-). */
  push?: number;
  /** Pitch offset in cents at t seconds (bends, glides). */
  cents?: (t: number) => number;
  /** Automation at t seconds; returns undefined for a parameter with no lane. */
  lane?: (param: string, t: number) => number | undefined;
}>;

/** Per-voice trims: cents as a function of sounding Hz, output gain. */
export type WindTrim = Readonly<{
  cents: (hz: number) => number;
  level: number;
  /** Loudness curve over the range: a gain factor at `hz` (default 1). */
  gain?: (hz: number) => number;
  /**
   * Calibration 1 lips (q08): the lip resonance sits on the sounding pitch
   * at Q 40 and the lip opening saturates softly, so the lips lock to the
   * bore's mode instead of beating against it (a 23-35% warble every 8 or
   * 9 periods before). Only the calibration 1 trim rows set it.
   */
  lips?: 1;
}>;

const NO_TRIM: WindTrim = { cents: () => 0, level: 1 };

const SLUR_SECONDS = 0.03;
/** First-order ADAA delays its shaper's output by half a sample. */
const ADAA_DELAY = 0.5;
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

// Reed table g(p) = p * clamp(0.7 - s p, -1, 1) and its antiderivative (ADAA).
function reedG(p: number, s: number): number {
  return p * clamp(0.7 - s * p, -1, 1);
}
function reedF(p: number, s: number): number {
  const p1 = -0.3 / s;
  const p2 = 1.7 / s;
  const mid = (x: number) => 0.35 * x * x - (s * x * x * x) / 3;
  if (p < p1) return 0.5 * p * p + mid(p1) - 0.5 * p1 * p1;
  if (p > p2) return -0.5 * p * p + mid(p2) + 0.5 * p2 * p2;
  return mid(p);
}
// Jet table j(x) = clamp(x^3 - x, -1, 1) and its antiderivative.
const JET_EDGE = 1.3247179572447458; // real root of x^3 - x - 1
function jetG(x: number): number {
  return clamp(x * x * x - x, -1, 1);
}
function jetF(x: number): number {
  const a = Math.abs(x);
  const poly = (v: number) => 0.25 * v ** 4 - 0.5 * v * v;
  if (a <= JET_EDGE) return poly(x);
  return poly(JET_EDGE) + (a - JET_EDGE);
}

/**
 * STK's lip filter: a two-pole resonance at the lip frequency with no
 * zeros (BiQuad::setResonance, unnormalised), so the mouth pressure's DC
 * sets the lips' operating point and the squared area mapping has gain.
 */
class LipResonator {
  private a1 = 0;
  private a2 = 0;
  private y1 = 0;
  private y2 = 0;
  private g = 1;
  set(hz: number, q: number, gain: number, sampleRate: number): void {
    const radius = Math.exp((-Math.PI * hz) / (q * sampleRate));
    this.a1 = -2 * radius * Math.cos((2 * Math.PI * hz) / sampleRate);
    this.a2 = radius * radius;
    this.g = gain * (1 + this.a1 + this.a2);
  }
  process(x: number): number {
    const y = this.g * x - this.a1 * this.y1 - this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** First-order ADAA around a shaper with a parameter. */
class Adaa {
  private x1 = 0;
  private F1: number;
  constructor(
    private readonly f: (x: number) => number,
    private readonly F: (x: number) => number,
  ) {
    this.F1 = F(0);
  }
  process(x: number): number {
    const Fx = this.F(x);
    const dx = x - this.x1;
    const y =
      Math.abs(dx) < 1e-6 ? this.f(0.5 * (x + this.x1)) : (Fx - this.F1) / dx;
    this.x1 = x;
    this.F1 = Fx;
    return y;
  }
}

export class WindVoice {
  /** Base-rate sample after which the voice is silent. */
  readonly endAt: number;
  private readonly rate: number;
  private readonly os: boolean;
  private readonly random: () => number;
  private readonly d0: LoopDelay;
  private readonly d1: LoopDelay;
  private readonly loopLp: OnePole;
  private readonly dc: DcBlock;
  private readonly outDc: DcBlock;
  private readonly noiseLp: OnePole;
  private readonly lip = new LipResonator();
  private readonly shelf = new WindBiquad();
  /** Reed, sax and lips brightness: a pitch-tracked tilt outside the loop. */
  private readonly tone = new WindBiquad();
  private readonly mutes: WindBiquad[] = [];
  private readonly wahFilter = new WindBiquad();
  private readonly decimate: Decimate2 | undefined;
  private readonly shaper: Adaa | undefined;
  private readonly reedSlope: number;
  private settings: WindSettings;
  private n = 0;
  private envelope = 0;
  private oz1 = 0;
  private hz: number;
  private slurFrom = 0;
  private slurAt = -1;
  private segment = 0;
  private pressure = 0;
  private breathGain = 1;
  private wah = 1;
  /** Output gain the loudness curve asks for, and its smoothed value. */
  private gainTarget = 1;
  private gainNow = -1;
  private readonly growlHz: number;

  constructor(
    base: WindSettings,
    private readonly note: WindNote,
    private readonly sampleRate: number,
    private readonly trim: WindTrim = NO_TRIM,
  ) {
    this.settings = base;
    const p = base;
    this.os = p.model !== "lips";
    this.rate = this.os ? 2 * sampleRate : sampleRate;
    this.random = seededRandom(`${note.seed}:wind`);
    let lowest = Infinity;
    for (const s of note.segments) lowest = Math.min(lowest, s.hz);
    lowest = Math.max(15, lowest) * 0.5; // room for a -1 octave bend
    const maxDelay = (this.rate / lowest) * 2.2 + 16;
    this.d0 = new LoopDelay(maxDelay);
    this.d1 = new LoopDelay(maxDelay);
    this.loopLp = new OnePole(4000, this.rate);
    this.dc = new DcBlock(this.rate, 20);
    this.outDc = new DcBlock(sampleRate, 20);
    this.noiseLp = new OnePole(2500, this.rate);
    this.decimate = this.os ? new Decimate2() : undefined;
    this.reedSlope = 0.3 * (0.6 + 0.8 * p.reed);
    const s = this.reedSlope;
    if (p.model === "reed")
      this.shaper = new Adaa(
        (x) => reedG(x, s),
        (x) => reedF(x, s),
      );
    else if (p.model === "jet") this.shaper = new Adaa(jetG, jetF);
    this.hz = note.segments[0]!.hz;
    this.growlHz = 70 + 50 * this.random();
    // Dynamics: a 1.5 kHz shelf of (v - 0.6) k dB; brass blares, flutes barely change.
    const k = { jet: 8, reed: 10, sax: 14, lips: 22 }[p.model];
    const v = clamp(note.velocity + (note.push ?? 0), 0, 1);
    this.shelf.set("highshelf", 1500, 0.7, (v - 0.6) * k, sampleRate);
    this.setupMute(sampleRate);
    this.endAt = note.length + Math.round((p.release * 3 + 0.05) * sampleRate);
    this.control(0);
  }

  private setupMute(sr: number): void {
    const add = (
      type: Parameters<WindBiquad["set"]>[0],
      hz: number,
      q: number,
      db: number,
    ) => this.mutes.push(new WindBiquad().set(type, hz, q, db, sr));
    switch (this.settings.mute) {
      case "straight":
        add("hpf", 450, 0.7, 0);
        add("peak", 1800, 2, 9);
        add("lpf", 7000, 0.7, 0);
        break;
      case "cup":
        add("hpf", 220, 0.7, 0);
        add("peak", 850, 1.5, 5);
        add("lpf", 2200, 0.8, 0);
        break;
      case "harmon":
        add("hpf", 700, 0.8, 0);
        add("peak", 1650, 4, 14);
        add("lpf", 4200, 1, 0);
        break;
      default:
        break;
    }
  }

  /** Control tick: lanes, pitch (slur, cents, vibrato, trim), delays, breath. */
  private control(n: number): void {
    const { note, sampleRate: sr, rate } = this;
    const t = n / sr;
    let p = this.settings;
    if (note.lane) {
      const next: Record<string, unknown> = { ...p };
      let changed = false;
      for (const key of ["breath", "noise", "wah", "growl", "flutter"]) {
        const value = note.lane(key, t);
        if (value !== undefined) {
          next[key] = clamp(value, 0, 1);
          changed = true;
        }
      }
      if (changed) p = this.settings = next as WindSettings;
    }
    // Slurs: a short log-frequency glide into each later segment.
    while (
      this.segment + 1 < note.segments.length &&
      note.segments[this.segment + 1]!.at <= n
    ) {
      this.segment += 1;
      this.slurFrom = this.hz;
      this.slurAt = note.segments[this.segment]!.at;
    }
    const target = note.segments[this.segment]!.hz;
    let hz = target;
    if (this.slurAt >= 0) {
      const u = (n - this.slurAt) / (SLUR_SECONDS * sr);
      if (u >= 1) this.slurAt = -1;
      else hz = this.slurFrom * (target / this.slurFrom) ** u;
    }
    this.hz = hz;
    this.gainTarget = this.trim.gain ? this.trim.gain(hz) : 1;
    if (this.gainNow < 0) this.gainNow = this.gainTarget;
    const cents = note.cents ? note.cents(t) : 0;
    const vib =
      p.vibmod > 0
        ? p.vibmod * Math.sin(2 * Math.PI * p.vib * t) * Math.min(1, t / 0.3)
        : 0;
    const f0 = hz * 2 ** (cents / 1200 + vib / 12);
    const f = f0 * 2 ** (this.trim.cents(f0) / 1200);
    const w = (2 * Math.PI * f) / rate;
    const period = rate / f;
    switch (p.model) {
      case "reed":
        // Closed-open cylinder: inverting reflection, round trip = 2 x loop;
        // the one-zero averager adds half a sample.
        this.d0.set(period / 2 - 0.5 - ADAA_DELAY, w);
        break;
      case "sax": {
        // Reed position 0.35 along the bore: measured over every semitone of
        // sax, altosax, barisax, oboe and bassoon at 22.05, 44.1 and 48 kHz
        // it never flips register (STK's 0.2 flips at 6 of 36 sax notes,
        // the spec's register guard).
        const position = 0.35;
        const total = period - 0.5;
        this.d0.set((1 - position) * total, w);
        this.d1.set(position * total, w);
        break;
      }
      case "jet": {
        // Loop low-pass corner tracks the pitch: brighter above.
        const corner = clamp(f * (3 + 9 * p.bright), 800, 0.4 * rate);
        this.loopLp.set(corner, rate);
        const filters =
          onePoleDelay(this.loopLp.p, w) +
          dcBlockDelay(this.dc.r, w) +
          ADAA_DELAY;
        if (p.stopped) {
          this.d0.set(0.5 * period - filters, w);
          this.d1.set(0.5 * period * (0.9 + 0.2 * p.reed), w);
        } else {
          this.d0.set(1.5 * period - filters, w);
          this.d1.set(0.5 * period * (0.9 + 0.2 * p.reed), w);
        }
        break;
      }
      case "lips":
        // STK Brass: a bore of two periods sounding its 2nd mode and a lip
        // resonance a little below f (constant Q 12, unit DC gain x 3 so
        // every register speaks); the trim removes the pull (+15..45 c).
        // Calibration 1 tunes the lips to f at Q 40 (see WindTrim.lips).
        this.d0.set(2 * period - dcBlockDelay(this.dc.r, w), w);
        if (this.trim.lips)
          this.lip.set(f * (1 + 0.04 * (p.reed - 0.5)), 40, 3, rate);
        else this.lip.set(f * (0.95 + 0.04 * (p.reed - 0.5)), 12, 3, rate);
        break;
    }
    // Brightness for the reed, sax and lip bores: a high shelf from about
    // the 4th harmonic, +-9 dB around bright 0.5. It sits outside the loop
    // (after the bore, before the mute), so pitch and the trims stay put;
    // the jet carries bright in its loop low-pass instead.
    if (p.model !== "jet")
      this.tone.set(
        "highshelf",
        clamp(4 * hz, 500, 0.4 * sr),
        0.7,
        (p.bright - 0.5) * 18,
        sr,
      );
    // Oscillation pressure keeps a floor; breath gain follows breath.
    const v = clamp(note.velocity + (note.push ?? 0), 0, 1);
    const drive = clamp(p.breath * (0.55 + 0.45 * v), 0, 1);
    const floor = 0.45;
    switch (p.model) {
      case "reed":
        this.pressure = floor + 0.45 * drive;
        break;
      case "sax":
        this.pressure = floor + 0.45 * drive;
        break;
      case "jet":
        this.pressure = 0.9 + 0.35 * drive;
        break;
      case "lips":
        this.pressure = 0.6 + 0.5 * drive;
        break;
    }
    this.breathGain = 10 ** ((30 * (p.breath - 0.6)) / 20);
    // Plunger: wah, opened per note by wahenv.
    if (p.mute === "plunger") {
      const open = Math.min(1, t / 0.15);
      this.wah = p.wah + p.wahenv * (1 - p.wah) * open;
      this.wahFilter.set("lpf", 400 + 4600 * this.wah * this.wah, 1.4, 0, sr);
    }
  }

  /** One internal-rate sample of the bore. */
  private tick(breath: number): number {
    const p = this.settings;
    switch (p.model) {
      case "reed": {
        const bore = this.d0.read();
        const oz = 0.5 * (bore + this.oz1);
        this.oz1 = bore;
        const pdiff = -0.95 * oz - breath;
        this.d0.push(breath + this.shaper!.process(pdiff));
        return bore;
      }
      case "sax": {
        const a = this.d0.read();
        const b = this.d1.read();
        const oz = 0.5 * (a + this.oz1);
        this.oz1 = a;
        const temp = -0.95 * oz;
        const frame = temp - b;
        const pdiff = breath - frame;
        this.d1.push(temp);
        // Plain reed table (no ADAA): measured, ADAA's half-sample average
        // destabilises the conical loop above ~300 Hz; 2x keeps aliasing low.
        this.d0.push(
          breath - pdiff * clamp(0.7 + this.reedSlope * pdiff, -1, 1) - temp,
        );
        return frame;
      }
      case "jet": {
        const boreOut = this.d0.read();
        const temp = this.dc.process(-this.loopLp.process(boreOut));
        const jet = this.d1.read();
        this.d1.push(breath - 0.5 * temp);
        // Jet offset: the jet hits the edge off-centre, giving even harmonics.
        const offset = p.stopped ? 0 : 0.12;
        const jt = this.shaper!.process(jet + offset) - jetG(offset);
        this.d0.push(jt + 0.5 * temp);
        // Edge tap (open pipes): some of the jet itself is heard.
        return 0.3 * boreOut + (p.stopped ? 0 : 0.12 * jt);
      }
      case "lips": {
        const bore = 0.85 * this.d0.read();
        const mouth = 0.3 * breath;
        let delta = this.lip.process(mouth - bore);
        delta *= delta;
        // Calibration 1: a soft opening (x / (1 + x)) in place of the hard
        // clamp, whose corner fed the warble.
        if (this.trim.lips) delta = delta / (1 + delta);
        else if (delta > 1) delta = 1;
        const frame = delta * mouth + (1 - delta) * bore;
        this.d0.push(this.dc.process(frame));
        return bore * 2;
      }
    }
  }

  /**
   * Adds `count` base-rate samples into `out` from `offset`; false once the
   * voice has finished.
   */
  process(out: Float64Array, offset: number, count: number): boolean {
    const { sampleRate: sr, note } = this;
    let p = this.settings;
    const attack = Math.max(1, p.attack * sr);
    const release = Math.max(1, p.release * sr);
    const level = this.trim.level * p.gain;
    for (let i = 0; i < count; i += 1) {
      const n = this.n;
      if (n >= this.endAt) return false;
      if (n % WIND_BLOCK === 0 && n > 0) {
        this.control(n);
        p = this.settings;
      }
      if (n < note.length)
        this.envelope = Math.min(1, this.envelope + 1 / attack);
      else this.envelope = Math.max(0, this.envelope - 1 / release);
      const t = n / sr;
      let amp = this.pressure * this.envelope;
      if (p.vibmod > 0) amp *= 1 + 0.04 * Math.sin(2 * Math.PI * p.vib * t);
      if (p.flutter > 0)
        amp *=
          1 - p.flutter * 0.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 26 * t));
      if (p.growl > 0)
        amp *= 1 + p.growl * 0.25 * Math.sin(2 * Math.PI * this.growlHz * t);
      let y: number;
      if (this.os) {
        const a = this.tick(this.breath(amp, p));
        const b = this.tick(this.breath(amp, p));
        y = this.decimate!.process(a, b);
      } else y = this.tick(this.breath(amp, p));
      if (p.growl > 0) y = Math.tanh(y * (1 + 2 * p.growl)) / (1 + p.growl);
      if (p.model !== "jet") y = this.tone.process(y);
      for (const filter of this.mutes) y = filter.process(y);
      if (p.mute === "plunger") y = this.wahFilter.process(y);
      y = this.shelf.process(y);
      this.gainNow += (this.gainTarget - this.gainNow) * 0.002;
      out[offset + i]! +=
        this.outDc.process(y) * level * this.gainNow * this.breathGain;
      this.n += 1;
    }
    return true;
  }

  /** Breath pressure with low-passed noise. */
  private breath(amp: number, p: WindSettings): number {
    const noise = this.noiseLp.process(this.random() * 2 - 1);
    return amp * (1 + p.noise * 1.6 * noise);
  }
}
