/**
 * Organs on the keys engine (0.6.1 f061-organ), ported from the design
 * prototype (proto/keys/keys.ts TonewheelVoice, OrganPost, ComboVoice,
 * PipeVoice):
 *
 * - `tonewheel`: nine drawbars on 91 free-running tonewheels whose phase
 *   is a function of song time (never reset per key), foldback at both
 *   ends, single-trigger percussion that mutes the 1' bar, key click.
 * - `combo`: divider-style registers (16' 8' 4' 2⅔' 2') of band-limited
 *   pulse or saw waves, with the `vib`/`vibmod` vibrato.
 * - `pipe`: band-limited additive wavetable ranks, 19 stops with
 *   registrations, per-pipe seeded detune, wind, chiff and tremulant.
 *
 * Every organ track runs one `OrganPost` on its sum: scanner vibrato or
 * chorus, preamp drive (2x oversampled) and a two-rotor rotary speaker
 * whose rotors glide between speeds with inertia (lane `keys-rotary`).
 * Randomness is seeded only; nothing reads the clock.
 */
import type { PerformedNote } from "../../../core/expression.ts";
import type { FxLane } from "../../../core/fx.ts";
import {
  isOrganFamily,
  pipeStops,
  resolvedKeys,
  rotarySpeed,
  type OrganFamily,
} from "../../../core/keys.ts";
import type { Track } from "../../../core/score.ts";
import { noteHz, type TuningTable } from "../../../core/tuning.ts";
import { seedHash, seededRandom } from "../dsp/rng.ts";
import { OnePole } from "../dsp/filters.ts";
import { interpolateAutomation } from "../effects/common.ts";
import { sampleWarpFor } from "../warp.ts";
import type { TimeScore } from "../../../core/tempo.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import { polyBlep } from "../synth/oscillators.ts";
import { Biquad2, Burst, clamp, CONTROL, TAU } from "./dsp.ts";

/** Polyphony per organ track; the oldest voice is stolen past it. */
export const ORGAN_VOICES = 64;
const STEAL_SECONDS = 0.005;

/** Drawbar offsets in semitones: 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'. */
export const DRAWBAR_SEMITONES = Object.freeze([
  -12, 7, 0, 12, 19, 24, 28, 31, 36,
]);

/** The 91 wheels span keys 24..114 (C1 to F#8); keys outside fold back. */
export const WHEEL_LOW = 24;
export const WHEEL_HIGH = 114;

/**
 * The tonewheel a drawbar footage of `pitch` sounds: the 16' folds back up
 * an octave below C1 and the top footages fold down above the 91st wheel.
 */
export function wheelPitch(pitch: number): number {
  let wheel = pitch;
  while (wheel < WHEEL_LOW) wheel += 12;
  while (wheel > WHEEL_HIGH) wheel -= 12;
  return wheel;
}

/** One wheel at full drawbar (the level trim for every tonewheel preset). */
const WHEEL_GAIN = 0.11;
/** One full pipe rank (scaled by the registration's power). */
const PIPE_GAIN = 0.1;

/** Drawbar level: each step below 8 is 3 dB down; 0 is silent. */
function drawbarGain(digit: number): number {
  return digit <= 0 ? 0 : 10 ** ((-(8 - digit) * 3) / 20);
}

function digitsOf(text: unknown, count: number, fallback: string): number[] {
  const value = typeof text === "string" ? text : fallback;
  return value
    .padEnd(count, "0")
    .slice(0, count)
    .split("")
    .map((digit) => clamp(Number(digit) || 0, 0, 8));
}

/** One wheel's phase at song time `seconds`, free-running per track. */
function wheelPhase(
  trackSeed: string,
  wheel: number,
  hz: number,
  seconds: number,
) {
  const phase0 = seedHash(`${trackSeed}:wheel:${wheel}`) / 4294967296;
  return TAU * ((phase0 + hz * seconds) % 1);
}

/** What a voice needs about its note. */
export type OrganNote = Readonly<{
  pitch: number;
  hz: number;
  /** Hz of any key in the track's tuning (unmapped keys give 0). */
  hzOf: (pitch: number) => number;
  /** Song seconds at the note's first sample (wheels are phase-locked). */
  startSec: number;
  trackSeed: string;
  noteSeed: string;
  /**
   * The track's shared percussion envelope at this key's onset, 0..1: 1 when
   * the key (or a chord struck with it) retriggers it, the decayed level for
   * a key added while others are held, 0 for none (single-trigger).
   */
  perc: number;
  /**
   * The key that sounds `semis` 12-TET semitones above `pitch` in the
   * track's tuning (the nearest degree in a table that is not 12 steps per
   * octave); absent adds the semitones as keys.
   */
  keyAt?: (pitch: number, semis: number) => number;
}>;

/**
 * Footage intervals for a tuning: 12-step tables (and keymapped ones) add
 * semitones as keys so temperaments still bend the organ; any other table
 * takes the degree nearest the 12-TET interval, so octave footages land on
 * the table's octave and mutations on its nearest fifth or third.
 */
export function footageKeys(
  table: TuningTable | undefined,
): ((pitch: number, semis: number) => number) | undefined {
  if (!table || !table.linear || table.size === 12) return undefined;
  const step = table.period / table.size;
  return (pitch, semis) => {
    const base = table.hz[pitch] ?? 0;
    if (!(base > 0)) return pitch + semis;
    const guess = pitch + Math.round((semis * 100) / step);
    let best = guess;
    let error = Infinity;
    for (let key = guess - 3; key <= guess + 3; key += 1) {
      const hz = table.hz[key];
      if (!hz || !(hz > 0)) continue;
      const miss = Math.abs(1200 * Math.log2(hz / base) - semis * 100);
      if (miss < error) {
        error = miss;
        best = key;
      }
    }
    return best;
  };
}

/** Lowest and highest wheel in Hz (C1, F#8) for folding non-12 tables. */
const WHEEL_LOW_HZ = 440 * 2 ** ((24 - 69) / 12);
const WHEEL_HIGH_HZ = 440 * 2 ** ((114 - 69) / 12);

/** The wheel a footage key sounds in the note's tuning (folded). */
function foldedWheel(note: OrganNote, key: number): number {
  if (!note.keyAt) return wheelPitch(key);
  let wheel = key;
  for (let guard = 0; guard < 12; guard += 1) {
    const hz = note.hzOf(wheel);
    if (!(hz > 0)) break;
    if (hz < WHEEL_LOW_HZ * 0.999) wheel = note.keyAt(wheel, 12);
    else if (hz > WHEEL_HIGH_HZ * 1.001) wheel = note.keyAt(wheel, -12);
    else break;
  }
  return wheel;
}

function footage(note: OrganNote, semis: number): number {
  return note.keyAt ? note.keyAt(note.pitch, semis) : note.pitch + semis;
}

type Values = Readonly<Record<string, number | string>>;

const num = (values: Values, name: string, fallback = 0): number => {
  const value = values[name];
  return typeof value === "number" ? value : fallback;
};

const str = (values: Values, name: string, fallback: string): string => {
  const value = values[name];
  return typeof value === "string" ? value : fallback;
};

/** An organ voice: mono samples added into `out`. */
export interface OrganVoice {
  readonly released: boolean;
  noteOff(): void;
  setCents(cents: number): void;
  /** Adds `count` samples at `offset`; false once silent for good. */
  process(out: Float64Array, offset: number, count: number): boolean;
}

// ---------------------------------------------------------------------------
// Tonewheel

export class TonewheelVoice implements OrganVoice {
  private readonly c = new Float64Array(9);
  private readonly s = new Float64Array(9);
  private readonly rc = new Float64Array(9);
  private readonly rs = new Float64Array(9);
  private readonly baseW = new Float64Array(9);
  private readonly amp = new Float64Array(9);
  private readonly on = new Int32Array(9);
  private off: Int32Array | undefined;
  private n = 0;
  private readonly bursts: Burst[] = [];
  private perc = 0;
  private readonly percK: number;
  private percC = 0;
  private percS = 0;
  private percRc = 1;
  private percRs = 0;
  private percW = 0;
  private fade = 1;
  private fadeStep = 0;
  private gateOpen = true;
  private readonly click: number;
  /** The wheel pitches of the nine drawbars (for tests and the docs). */
  readonly wheels: readonly number[];
  /** The wheel frequencies of the nine drawbars, in Hz. */
  readonly wheelHz: readonly number[];

  constructor(
    private readonly note: OrganNote,
    values: Values,
    private readonly sr: number,
  ) {
    const ratio = note.hz / (note.hzOf(note.pitch) || note.hz);
    const levels = digitsOf(values.drawbars, 9, "888000000");
    const perc = str(values, "perc", "off");
    const percOn = perc !== "off";
    const percSoft = str(values, "percvol", "normal") === "soft";
    // A B3 mutes the 1' with percussion on and, at normal percussion
    // volume, drops the drawbars 3 dB; soft keeps them at full level.
    const percDrop = percOn && !percSoft ? 0.7 : 1;
    if (percOn) levels[8] = 0;
    this.click = clamp(num(values, "click", 0.5), 0, 1);
    const rng = seededRandom(`${note.noteSeed}:contacts`);
    const wheels: number[] = [];
    const wheelHz: number[] = [];
    for (let d = 0; d < 9; d += 1) {
      const wheel = foldedWheel(note, footage(note, DRAWBAR_SEMITONES[d]!));
      const hz = note.hzOf(wheel) * ratio;
      wheels.push(wheel);
      wheelHz.push(hz);
      const w = (TAU * hz) / sr;
      const ph = wheelPhase(note.trackSeed, wheel, hz, note.startSec);
      this.c[d] = Math.cos(ph);
      this.s[d] = Math.sin(ph);
      this.baseW[d] = w;
      this.rc[d] = Math.cos(w);
      this.rs[d] = Math.sin(w);
      this.amp[d] =
        hz > 0 && hz < 0.45 * sr
          ? WHEEL_GAIN * percDrop * drawbarGain(levels[d]!)
          : 0;
      // Nine bus contacts close a few ms apart (the click's character).
      const draw = rng();
      this.on[d] = this.click > 0 ? Math.floor(draw * 0.003 * sr) : 0;
    }
    this.wheels = Object.freeze(wheels);
    this.wheelHz = Object.freeze(wheelHz);
    if (this.click === 0) {
      this.fade = 0;
      this.fadeStep = 1 / (0.004 * sr);
    } else
      this.bursts.push(
        new Burst(
          `${note.noteSeed}:click`,
          3200,
          0.7,
          0.0012,
          this.click * 0.06,
          sr,
        ),
      );
    const percFast = resolvedPercFast(values);
    this.percK = Math.exp(-6.907755 / ((percFast ? 0.6 : 1.8) * sr));
    if (percOn && note.perc > 1e-4) {
      const wheel = foldedWheel(note, footage(note, perc === "2nd" ? 12 : 19));
      const hz = note.hzOf(wheel) * ratio;
      if (hz > 0 && hz < 0.45 * sr) {
        const w = (TAU * hz) / sr;
        const ph = wheelPhase(note.trackSeed, wheel, hz, note.startSec);
        this.percC = Math.cos(ph);
        this.percS = Math.sin(ph);
        this.percW = w;
        this.percRc = Math.cos(w);
        this.percRs = Math.sin(w);
        this.perc = WHEEL_GAIN * (percSoft ? 0.5 : 1) * note.perc;
      }
    }
  }

  get released(): boolean {
    return !this.gateOpen;
  }

  noteOff(): void {
    if (!this.gateOpen) return;
    this.gateOpen = false;
    if (this.click === 0) {
      // No contacts to bounce: the wheels stay on and the sum fades out.
      this.fadeStep = -1 / (0.006 * this.sr);
      return;
    }
    const rng = seededRandom(`${this.note.noteSeed}:open`);
    this.off = new Int32Array(9);
    for (let d = 0; d < 9; d += 1) {
      const draw = rng();
      this.off[d] = this.n + Math.floor(draw * 0.0015 * this.sr);
    }
    this.bursts.push(
      new Burst(
        `${this.note.noteSeed}:clickoff`,
        3200,
        0.7,
        0.001,
        this.click * 0.03,
        this.sr,
      ),
    );
  }

  setCents(cents: number): void {
    const r = 2 ** (cents / 1200);
    for (let d = 0; d < 9; d += 1) {
      this.rc[d] = Math.cos(this.baseW[d]! * r);
      this.rs[d] = Math.sin(this.baseW[d]! * r);
    }
    if (this.percW > 0) {
      this.percRc = Math.cos(this.percW * r);
      this.percRs = Math.sin(this.percW * r);
    }
  }

  process(out: Float64Array, offset: number, count: number): boolean {
    const { c, s, rc, rs, amp, on } = this;
    const off = this.off;
    for (let i = 0; i < count; i += 1) {
      const t = this.n++;
      let y = 0;
      for (let d = 0; d < 9; d += 1) {
        if (amp[d] === 0) continue;
        const cc = c[d]!;
        const ss = s[d]!;
        c[d] = cc * rc[d]! - ss * rs[d]!;
        s[d] = ss * rc[d]! + cc * rs[d]!;
        if (t < on[d]! || (off && t >= off[d]!)) continue;
        y += amp[d]! * ss;
      }
      if (this.perc > 1e-6) {
        const cc = this.percC;
        const ss = this.percS;
        this.percC = cc * this.percRc - ss * this.percRs;
        this.percS = ss * this.percRc + cc * this.percRs;
        y += this.perc * ss;
        this.perc *= this.percK;
      }
      if (this.fadeStep !== 0) {
        this.fade = clamp(this.fade + this.fadeStep, 0, 1);
        y *= this.fade;
      }
      for (const burst of this.bursts) if (!burst.done) y += burst.next();
      out[offset + i]! += y;
    }
    // Renormalise the rotations so the wheels never drift in level.
    if ((this.n & 511) < count)
      for (let d = 0; d < 9; d += 1) {
        const m = Math.hypot(c[d]!, s[d]!) || 1;
        c[d]! /= m;
        s[d]! /= m;
      }
    if (this.gateOpen) return true;
    if (this.bursts.some((burst) => !burst.done)) return true;
    if (this.fadeStep < 0) return this.fade > 0;
    let last = 0;
    for (let d = 0; d < 9; d += 1) last = Math.max(last, off![d]!);
    return this.n <= last;
  }
}

// ---------------------------------------------------------------------------
// Combo (divider organ: Farfisa, Vox)

const COMBO_RATIOS = Object.freeze([0.5, 1, 2, 3, 4]);
/** One full combo register (the level trim shared with the other organs). */
const COMBO_GAIN = 0.046;

export class ComboVoice implements OrganVoice {
  private readonly ph = new Float64Array(5);
  private readonly dts = new Float64Array(5);
  private readonly lv: number[];
  private readonly f = new Biquad2();
  private readonly f2 = new Biquad2();
  private readonly tone: string;
  private readonly vib: number;
  private readonly vibmod: number;
  private env = 0;
  private gate = true;
  private n = 0;
  private cents = 0;
  private ratio = 1;

  constructor(
    private readonly note: OrganNote,
    values: Values,
    private readonly sr: number,
  ) {
    this.lv = digitsOf(values.registers, 5, "08800").map((digit) =>
      digit === 0 ? 0 : COMBO_GAIN * drawbarGain(digit),
    );
    this.tone = str(values, "voice", "reed");
    this.vib = num(values, "vib", 0);
    this.vibmod = num(values, "vibmod", 0);
    // The dividers run all the time: the phase is a function of song time.
    for (let r = 0; r < 5; r += 1)
      this.ph[r] = (note.hz * COMBO_RATIOS[r]! * note.startSec) % 1;
    const f = note.hz;
    if (this.tone === "flute")
      this.f.set("lpf", clamp(3 * f, 300, 7000), 0.7, 0, sr);
    else if (this.tone === "reed") this.f.set("peak", 1400, 1.1, 6, sr);
    else this.f.set("hpf", 300, 0.7, 0, sr);
    this.f2.set("lpf", this.tone === "bright" ? 9000 : 5000, 0.7, 0, sr);
  }

  get released(): boolean {
    return !this.gate;
  }

  noteOff(): void {
    this.gate = false;
  }

  setCents(cents: number): void {
    this.cents = cents;
  }

  process(out: Float64Array, offset: number, count: number): boolean {
    const sr = this.sr;
    const attack = 0.02 * (48_000 / sr);
    const release = 0.004 * (48_000 / sr);
    // Hoisted out of the sample loop (same arithmetic, so the same output).
    const hz = this.note.hz;
    const bright = this.tone === "bright";
    const width = this.tone === "reed" ? 0.3 : 0.5;
    const { ph, lv, dts } = this;
    const setDts = () => {
      for (let r = 0; r < 5; r += 1)
        dts[r] = (hz * COMBO_RATIOS[r]! * this.ratio) / sr;
    };
    setDts();
    for (let i = 0; i < count; i += 1) {
      if ((this.n & (CONTROL - 1)) === 0) {
        const t = this.note.startSec + this.n / sr;
        const vib =
          this.vib > 0 ? this.vibmod * 100 * Math.sin(TAU * this.vib * t) : 0;
        this.ratio = 2 ** ((this.cents + vib) / 1200);
        setDts();
      }
      this.n += 1;
      let y = 0;
      for (let r = 0; r < 5; r += 1) {
        const dt = dts[r]!;
        if (!(dt > 0) || dt >= 0.45) continue;
        let t = ph[r]! + dt;
        if (t >= 1) t -= 1;
        ph[r] = t;
        const level = lv[r]!;
        if (level === 0) continue;
        y +=
          level *
          (bright ? 2 * t - 1 - polyBlep(t, dt) : blepPulse(t, dt, width));
      }
      this.env +=
        ((this.gate ? 1 : 0) - this.env) * (this.gate ? attack : release);
      y = this.f2.process(this.f.process(y)) * this.env;
      out[offset + i]! += y;
    }
    return this.gate || this.env > 1e-5;
  }
}

/** A band-limited pulse of `width` (0..1) at phase `t` (cycles). */
function blepPulse(t: number, dt: number, width: number): number {
  let y = t < width ? 1 : -1;
  y += polyBlep(t, dt);
  let t2 = t - width;
  if (t2 < 0) t2 += 1;
  y -= polyBlep(t2, dt);
  return y - (2 * width - 1);
}

// ---------------------------------------------------------------------------
// Pipe

type Spectrum =
  | "principal"
  | "flute"
  | "stopped"
  | "string"
  | "trumpet"
  | "oboe"
  | "krummhorn";

const SPECTRA: Readonly<Record<Spectrum, (n: number) => number>> = {
  principal: (n) => (n === 2 ? 0.55 : 1 / n ** 1.15),
  flute: (n) => [1, 0.3, 0.1, 0.04][n - 1] ?? 0.01 / n,
  stopped: (n) => (n % 2 ? 1 / n ** 1.6 : 0.03 / n),
  string: (n) => 0.8 / n ** 0.7,
  trumpet: (n) => (n <= 5 ? 0.5 + 0.12 * n : 1.1 / (n / 5) ** 1.1),
  oboe: (n) => Math.exp(-(((n - 4) / 3) ** 2)) + 0.25 / n,
  krummhorn: (n) => (n % 2 ? 0.9 / n ** 0.6 : 0.08 / n),
};

const SPECTRUM_MAX: Readonly<Record<Spectrum, number>> = {
  principal: 24,
  flute: 8,
  stopped: 12,
  string: 40,
  trumpet: 40,
  oboe: 24,
  krummhorn: 30,
};

type Stop = Readonly<{
  spectrum: Spectrum;
  semis: number;
  gain: number;
  /** Cents sharp (the celeste rank's beat). */
  celeste?: number;
  /** A flue pipe (chiff); reeds speak without it. */
  flue: boolean;
}>;

const flue = (spectrum: Spectrum, semis: number, gain: number): Stop => ({
  spectrum,
  semis,
  gain,
  flue: true,
});

/** The ranks each stop sounds (core/keys.ts PIPE_STOPS names them). */
export const STOPS: Readonly<Record<string, readonly Stop[]>> = Object.freeze({
  subbass16: [flue("stopped", -12, 1)],
  bourdon16: [flue("stopped", -12, 0.8)],
  principal8: [flue("principal", 0, 1)],
  flute8: [flue("flute", 0, 0.9)],
  gedackt8: [flue("stopped", 0, 0.9)],
  gamba8: [flue("string", 0, 0.5)],
  celeste8: [{ ...flue("string", 0, 0.5), celeste: 7 }],
  octave4: [flue("principal", 12, 0.8)],
  flute4: [flue("flute", 12, 0.7)],
  nazard: [flue("flute", 19, 0.45)],
  fifteenth2: [flue("principal", 24, 0.6)],
  piccolo2: [flue("flute", 24, 0.5)],
  tierce: [flue("flute", 28, 0.4)],
  larigot: [flue("flute", 31, 0.35)],
  mixture: [19, 24, 31, 36].map((semis) => flue("principal", semis, 0.35)),
  trumpet8: [{ spectrum: "trumpet", semis: 0, gain: 0.7, flue: false }],
  oboe8: [{ spectrum: "oboe", semis: 0, gain: 0.6, flue: false }],
  krummhorn8: [{ spectrum: "krummhorn", semis: 0, gain: 0.6, flue: false }],
  trombone16: [{ spectrum: "trumpet", semis: -12, gain: 0.8, flue: false }],
});

/** Highest key a rank sounds before mixtures and mutations break back. */
const PIPE_TOP = 103;
const PIPE_TOP_HZ = 440 * 2 ** ((PIPE_TOP - 69) / 12);

/**
 * A rank's pitch as a pure harmonic of the key: octaves 2^k, quints 3·2^k,
 * tierces 5·2^k, so mutation and mixture ranks fuse with the foundation
 * instead of beating against it (in any tuning).
 */
export function rankRatio(semis: number): number {
  const octave = Math.floor(semis / 12);
  const within = semis - octave * 12;
  const pure = within === 7 ? 1.5 : within === 4 ? 1.25 : 2 ** (within / 12);
  return 2 ** octave * pure;
}
const TABLE = 2048;
const tables = new Map<string, Float64Array>();

/** A band-limited single-cycle table of `harmonics` partials (cached). */
function table(spectrum: Spectrum, harmonics: number): Float64Array {
  const key = `${spectrum}:${harmonics}`;
  const cached = tables.get(key);
  if (cached) return cached;
  const out = new Float64Array(TABLE + 1);
  let peak = 0;
  for (let i = 0; i < TABLE; i += 1) {
    let y = 0;
    for (let n = 1; n <= harmonics; n += 1)
      y += SPECTRA[spectrum](n) * Math.sin((TAU * n * i) / TABLE);
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  let power = 0;
  for (let i = 0; i < TABLE; i += 1) {
    out[i]! /= peak || 1;
    power += out[i]! ** 2;
  }
  // Even loudness across spectra: a thin string table (high crest) gets
  // up to 2x so a gamba registration is not buried under the flutes.
  const loud = Math.min(2, Math.max(1, 0.6 / Math.sqrt(power / TABLE)));
  for (let i = 0; i < TABLE; i += 1) out[i]! *= loud;
  out[TABLE] = out[0]!;
  tables.set(key, out);
  return out;
}

type Rank = {
  t: Float64Array;
  ph: number;
  hz: number;
  gain: number;
  ta: number;
  wob: number;
  wobHz: number;
  inc: number;
  /** The wind's level wobble (control rate). */
  level: number;
};

export class PipeVoice implements OrganVoice {
  /** The ranks this key sounds (for tests). */
  readonly ranks: Rank[] = [];
  private n = 0;
  private gate = true;
  private relEnv = 1;
  private readonly relK: number;
  private readonly bursts: Burst[] = [];
  private cents = 0;
  private amp = 1;
  private readonly trem: number;
  private readonly wind: number;

  constructor(
    private readonly note: OrganNote,
    values: Values,
    private readonly sr: number,
  ) {
    const ratio = note.hz / (note.hzOf(note.pitch) || note.hz);
    const keyPos = clamp((note.pitch - 24) / 84, 0, 1);
    this.trem = clamp(num(values, "trem"), 0, 1);
    this.wind = clamp(num(values, "wind", 0.3), 0, 1);
    const chiff = clamp(num(values, "chiff", 0.4), 0, 1);
    let flueGain = 0;
    let power = 0;
    // One voicing error per key (every rank of a key shares it, so their
    // partials coincide); only the celeste rank is tuned apart.
    const key = seededRandom(`${note.trackSeed}:pipe:${note.pitch}`);
    const shared = (key() - 0.5) * 2;
    const f1 = note.hzOf(note.pitch);
    for (const id of pipeStops(str(values, "stops", "principal8"))) {
      for (const stop of STOPS[id] ?? []) {
        let semis = stop.semis;
        while (f1 * rankRatio(semis) > PIPE_TOP_HZ && semis > 0) semis -= 12;
        const pipe = seededRandom(
          `${note.trackSeed}:pipe:${id}:${semis}:${note.pitch}`,
        );
        const detune = shared + (stop.celeste ?? 0);
        const hz = f1 * rankRatio(semis) * ratio * 2 ** (detune / 1200);
        // Phase on the song clock, like the wheels: an arranged window that
        // re-strikes a held key there lands on the same waveform.
        const ph = (pipe() + ((hz * note.startSec) % 1)) % 1;
        const wob = pipe() * TAU;
        const wobHz = 0.2 + 0.3 * pipe();
        if (!(hz > 0) || hz >= 0.45 * sr) continue;
        const h = Math.max(
          1,
          Math.min(SPECTRUM_MAX[stop.spectrum], Math.floor((0.45 * sr) / hz)),
        );
        const ta =
          (stop.flue ? 0.02 + 0.06 * (1 - keyPos) : 0.012) *
          (semis < 0 ? 1.5 : 1);
        this.ranks.push({
          t: table(stop.spectrum, h),
          ph,
          hz,
          gain: stop.gain,
          ta,
          wob,
          wobHz,
          inc: hz / sr,
          level: 1,
        });
        if (stop.flue) flueGain += stop.gain;
        power += stop.gain * stop.gain;
      }
    }
    // Registrations sum to a similar loudness: scale by the ranks' summed
    // power (adding stops still adds level, by about half its dB).
    const norm = PIPE_GAIN / Math.max(0.25, power) ** 0.35;
    for (const rank of this.ranks) rank.gain *= norm;
    if (chiff > 0 && flueGain > 0)
      this.bursts.push(
        new Burst(
          `${note.noteSeed}:chiff`,
          Math.min(0.4 * sr, note.hz * 4),
          3,
          0.025,
          chiff * 0.05 * Math.min(2, flueGain),
          sr,
          0.002,
        ),
      );
    this.relK = Math.exp(-1 / (0.035 * sr));
  }

  get released(): boolean {
    return !this.gate;
  }

  noteOff(): void {
    this.gate = false;
  }

  setCents(cents: number): void {
    this.cents = cents;
  }

  process(out: Float64Array, offset: number, count: number): boolean {
    const sr = this.sr;
    for (let i = 0; i < count; i += 1) {
      const t = this.n / sr;
      if ((this.n & (CONTROL - 1)) === 0 || i === 0) {
        const abs = this.note.startSec + t;
        const trem = this.trem > 0 ? Math.sin(TAU * 5.6 * abs) : 0;
        for (const rank of this.ranks) {
          const wind =
            this.wind * 0.6 * Math.sin(rank.wob + TAU * rank.wobHz * abs);
          rank.inc =
            (rank.hz *
              2 ** ((this.cents + wind + this.trem * 4 * trem) / 1200)) /
            sr;
        }
        this.amp = 1 + this.trem * 0.12 * trem;
        for (const rank of this.ranks)
          rank.level =
            1 + this.wind * 0.03 * Math.sin(rank.wob + TAU * rank.wobHz * abs);
      }
      let y = 0;
      for (const rank of this.ranks) {
        rank.ph += rank.inc;
        if (rank.ph >= 1) rank.ph -= Math.floor(rank.ph);
        const x = rank.ph * TABLE;
        const j = Math.floor(x);
        const s = rank.t[j]! + (rank.t[j + 1]! - rank.t[j]!) * (x - j);
        // Past 40 time constants 1 - exp(-t/ta) rounds to exactly 1.
        const speak = t > 40 * rank.ta ? 1 : 1 - Math.exp(-t / rank.ta);
        y += s * rank.gain * rank.level * speak;
      }
      if (!this.gate) this.relEnv *= this.relK;
      y *= this.amp * this.relEnv;
      for (const burst of this.bursts) if (!burst.done) y += burst.next();
      out[offset + i]! += y;
      this.n += 1;
    }
    return this.gate || this.relEnv > 1e-5;
  }
}

// ---------------------------------------------------------------------------
// OrganPost: scanner, drive, rotary on the track sum

/** Rotor speeds in Hz at stop, slow (chorale) and fast (tremolo). */
export const HORN_HZ = Object.freeze([0, 0.8, 6.8]);
export const DRUM_HZ = Object.freeze([0, 0.66, 5.9]);

const SCANNER_DEPTH: Readonly<Record<string, number>> = {
  off: 0,
  v1: 0.25,
  v2: 0.5,
  v3: 0.9,
  c1: 0.25,
  c2: 0.5,
  c3: 0.9,
};

function readHermite(
  buffer: Float64Array,
  write: number,
  delay: number,
): number {
  const size = buffer.length;
  const pos = write - delay;
  const i = Math.floor(pos);
  const f = pos - i;
  const at = (j: number) => buffer[((j % size) + size) % size]!;
  const xm1 = at(i - 1);
  const x0 = at(i);
  const x1 = at(i + 1);
  const x2 = at(i + 2);
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/**
 * Makeup for the preamp at `k`: the RMS a -18 dBFS sine keeps through
 * tanh(k·x)/k, so drive changes the timbre at a steady loudness.
 */
const makeups = new Map<number, number>();
function driveMakeup(k: number): number {
  const key = Math.round(k * 1000);
  const cached = makeups.get(key);
  if (cached !== undefined) return cached;
  const a = 10 ** (-18 / 20) * Math.SQRT2;
  let dry = 0;
  let wet = 0;
  for (let i = 0; i < 256; i += 1) {
    const x = a * Math.sin((TAU * (i + 0.5)) / 256);
    const y = Math.tanh(k * x) / k;
    dry += x * x;
    wet += y * y;
  }
  const makeup = Math.sqrt(dry / wet);
  makeups.set(key, makeup);
  return makeup;
}

/** The rotors' state at a window origin (`organRotorSeed`). */
export type RotorState = Readonly<{
  horn: number;
  drum: number;
  hornHz: number;
  drumHz: number;
}>;

export type OrganPostSettings = Readonly<{
  scanner: string;
  /** Preamp drive 0..1 (the `keys-drive` lane overrides per block). */
  drive: number;
  /** Rotary speed at the start: 0 stop, 1 slow, 2 fast. */
  rotary: number;
  /** Run the rotary stage (false bypasses it: combo, pipe, or `stop`). */
  rotor: boolean;
}>;

/**
 * Scanner vibrato/chorus, then preamp drive, then a two-rotor rotary
 * speaker with Doppler, amplitude modulation, stereo mics and inertia
 * (horn about 0.7 s up / 1.1 s down, drum 3.5 s / 4.5 s). State carries
 * across `process` calls, so a live player can feed it block by block.
 */
export class OrganPost {
  private readonly line: Float64Array;
  private w = 0;
  private readonly hornLine: Float64Array;
  private hw = 0;
  private horn = 0;
  private drum = 0;
  private n = 0;
  private hornTarget: number;
  private drumTarget: number;
  /** Current horn rotor speed in Hz (tests read the spin-up). */
  hornHz: number;
  drumHz: number;
  private readonly lo1: OnePole;
  private readonly lo2: OnePole;
  private prev = 0;

  constructor(
    private readonly settings: OrganPostSettings,
    private readonly sr: number,
    private readonly startSec = 0,
    seed?: RotorState,
  ) {
    this.line = new Float64Array(Math.ceil(0.004 * sr) + 8);
    this.hornLine = new Float64Array(Math.ceil(0.004 * sr) + 8);
    this.lo1 = new OnePole(800, sr);
    this.lo2 = new OnePole(800, sr);
    const speed = clamp(Math.round(settings.rotary), 0, 2);
    this.hornHz = this.hornTarget = HORN_HZ[speed]!;
    this.drumHz = this.drumTarget = DRUM_HZ[speed]!;
    // The rotors run on the song clock: a render starting at `startSec`
    // (an arranged window, a live key) finds them where a whole-song pass
    // at a steady speed would, so live notes share one speaker image.
    this.horn = (TAU * ((this.hornHz * startSec) % 1)) % TAU;
    this.drum = (TAU * ((this.drumHz * startSec) % 1)) % TAU;
    // With a rotary lane the speeds before the window are not constant:
    // the arranged render hands in the rotors integrated from song start.
    if (seed) {
      this.horn = seed.horn;
      this.drum = seed.drum;
      this.hornHz = this.hornTarget = seed.hornHz;
      this.drumHz = this.drumTarget = seed.drumHz;
    }
  }

  /** The rotors now (an arranged window's seed). */
  rotor(): RotorState {
    return {
      horn: this.horn,
      drum: this.drum,
      hornHz: this.hornHz,
      drumHz: this.drumHz,
    };
  }

  /**
   * Runs only the rotors for `count` samples at control rate, in closed
   * form per block (exactly what `process` does per sample): the cheap path
   * an arranged window uses to find the rotors at its origin.
   */
  spin(count: number, speedAt: (i: number) => number): void {
    const sr = this.sr;
    const glide = (
      hz: number,
      target: number,
      up: number,
      down: number,
      n: number,
    ): [number, number] => {
      if (hz === target) return [hz, (n * hz) / sr];
      const r = 1 - 1 / ((target > hz ? up : down) * sr);
      const rn = r ** n;
      const sum = n * target + ((hz - target) * r * (1 - rn)) / (1 - r);
      return [target + (hz - target) * rn, sum / sr];
    };
    for (let i = 0; i < count; i += CONTROL) {
      const n = Math.min(CONTROL, count - i);
      const speed = clamp(Math.round(speedAt(i)), 0, 2);
      const [hornHz, hornTurns] = glide(
        this.hornHz,
        HORN_HZ[speed]!,
        0.7,
        1.1,
        n,
      );
      const [drumHz, drumTurns] = glide(
        this.drumHz,
        DRUM_HZ[speed]!,
        3.5,
        4.5,
        n,
      );
      this.hornHz = hornHz;
      this.drumHz = drumHz;
      this.horn = (this.horn + TAU * hornTurns) % TAU;
      this.drum = (this.drum + TAU * drumTurns) % TAU;
    }
  }

  /**
   * Processes the mono sum in `left` into `left`/`right`. `speedAt(i)` gives
   * the rotary speed (0..2) at sample `i` of this call, `driveAt(i)` the
   * drive; both are read once per control block.
   */
  process(
    left: Float64Array,
    right: Float64Array,
    count = left.length,
    speedAt?: (i: number) => number,
    driveAt?: (i: number) => number,
  ): void {
    const sr = this.sr;
    const scanner = this.settings.scanner;
    const depth = (SCANNER_DEPTH[scanner] ?? 0) * 1e-3 * sr;
    const chorus = scanner.startsWith("c");
    let drive = this.settings.drive;
    let k = 1 + 6 * drive;
    let tk = driveMakeup(k) / k;
    const base = 0.0012 * sr;
    const dop = 0.00045 * sr;
    for (let i = 0; i < count; i += 1) {
      if (i % CONTROL === 0) {
        if (driveAt) {
          drive = clamp(driveAt(i), 0, 1);
          k = 1 + 6 * drive;
          tk = driveMakeup(k) / k;
        }
        if (speedAt) {
          const speed = clamp(Math.round(speedAt(i)), 0, 2);
          this.hornTarget = HORN_HZ[speed]!;
          this.drumTarget = DRUM_HZ[speed]!;
        }
      }
      let x = left[i]!;
      if (depth > 0) {
        const t = this.startSec + this.n / sr;
        const d = 0.3e-3 * sr + depth * 0.5 * (1 + Math.sin(TAU * 6.9 * t));
        this.line[this.w] = x;
        const vib = readHermite(this.line, this.w, d);
        this.w = (this.w + 1) % this.line.length;
        x = chorus ? 0.5 * (x + vib) : vib;
      }
      this.n += 1;
      if (drive > 0) {
        // 2x oversampled tanh: the midpoint and the sample, averaged.
        const mid = 0.5 * (x + this.prev);
        this.prev = x;
        x = 0.5 * (Math.tanh(k * mid) + Math.tanh(k * x)) * tk;
      } else this.prev = x;
      if (!this.settings.rotor) {
        left[i] = x;
        right[i] = x;
        continue;
      }
      const hornTau = this.hornTarget > this.hornHz ? 0.7 : 1.1;
      const drumTau = this.drumTarget > this.drumHz ? 3.5 : 4.5;
      this.hornHz += (this.hornTarget - this.hornHz) / (hornTau * sr);
      this.drumHz += (this.drumTarget - this.drumHz) / (drumTau * sr);
      this.horn = (this.horn + (TAU * this.hornHz) / sr) % TAU;
      this.drum = (this.drum + (TAU * this.drumHz) / sr) % TAU;
      const lo = this.lo2.process(this.lo1.process(x));
      const hi = x - lo;
      this.hornLine[this.hw] = hi;
      const cl = Math.cos(this.horn + Math.PI / 2);
      const cr = Math.cos(this.horn - Math.PI / 2);
      const hl =
        readHermite(this.hornLine, this.hw, base + dop * 0.5 * (1 - cl)) *
        (0.6 + 0.4 * cl);
      const hr =
        readHermite(this.hornLine, this.hw, base + dop * 0.5 * (1 - cr)) *
        (0.6 + 0.4 * cr);
      this.hw = (this.hw + 1) % this.hornLine.length;
      const dl = lo * (0.75 + 0.25 * Math.cos(this.drum + Math.PI / 2));
      const dr = lo * (0.75 + 0.25 * Math.cos(this.drum - Math.PI / 2));
      left[i] = hl + dl;
      right[i] = hr + dr;
    }
  }
}

/** The post settings of an organ track (no lanes). */
export function organPostSettings(
  family: OrganFamily,
  values: Values,
  laned = false,
): OrganPostSettings {
  const rotary = family === "pipe" ? 0 : rotarySpeed(values.rotary);
  return {
    scanner: family === "tonewheel" ? str(values, "scanner", "c3") : "off",
    drive: family === "pipe" ? 0 : clamp(num(values, "drive"), 0, 1),
    rotary,
    rotor: family !== "pipe" && (rotary > 0 || laned),
  };
}

// ---------------------------------------------------------------------------
// Track render

type Live = {
  voice: OrganVoice;
  start: number;
  off: number;
  order: number;
  cents?: (seconds: number) => number;
  stolen: boolean;
  fade: number;
  fadeLength: number;
};

/**
 * A note's first and note-off samples. `origin` is the render's first
 * sample on the song's own sample grid (an arranged window's exact start):
 * onsets round on that grid, so a window lands each key on the sample a
 * single pass does.
 */
function spanOf(
  note: PerformedNote,
  context: EngineContext,
  origin = 0,
): { start: number; off: number } {
  const { warp, samplesPerTick } = context;
  const base = Math.round(origin);
  const at = (tick: number) =>
    Math.floor((warp ? warp.sample(tick) : tick * samplesPerTick) + origin) -
    base;
  if (warp) {
    const start = Math.max(0, at(note.startTick));
    const end = at(note.startTick + note.durationTicks);
    return { start, off: Math.max(start + 1, end) };
  }
  const start = Math.max(0, at(note.startTick));
  const length = Math.max(1, Math.floor(note.durationTicks * samplesPerTick));
  return { start, off: start + length };
}

function tickAt(context: EngineContext, sample: number): number {
  return context.warp
    ? context.warp.tick(sample)
    : sample / context.samplesPerTick;
}

/** A voice of `family` for one note. */
export function organVoice(
  family: OrganFamily,
  note: OrganNote,
  values: Values,
  sr: number,
): OrganVoice {
  if (family === "tonewheel") return new TonewheelVoice(note, values, sr);
  if (family === "combo") return new ComboVoice(note, values, sr);
  return new PipeVoice(note, values, sr);
}

/**
 * Renders an organ track: voices into `left` (mono), then the track's
 * OrganPost into `left`/`right`, then the track volume.
 */
export function renderOrganTrack(
  left: Float64Array,
  right: Float64Array,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const family = track.instrument;
  if (!isOrganFamily(family)) return;
  const sr = context.sampleRate;
  const total = left.length;
  const values = resolvedKeys(family, track.keys);
  const trackSeed = `organ:${track.id}`;
  const seedTick = context.seedTick ?? 0;
  // Song seconds at this render's first sample: an arranged window's origin
  // in real time (a tempo map makes it more than ticks at the base tempo).
  const originSec =
    context.seedSeconds ?? (seedTick * context.samplesPerTick) / sr;
  const hzOf = (pitch: number) => noteHz(pitch, undefined, context.tuning);
  const keyAt = footageKeys(context.tuning);
  const percTau = (resolvedPercFast(values) ? 0.6 : 1.8) / 6.907755;
  let percAt = -Infinity;
  const onsets = notes
    .map((note) => {
      const hz = noteHz(note.pitch, note.cents, context.tuning);
      return { note, hz, ...spanOf(note, context, originSec * sr) };
    })
    .filter((x) => x.hz > 0 && Number.isFinite(x.hz) && x.start < total)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.note.startTick - b.note.startTick ||
        (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
    );
  const mono = new Float64Array(total);
  const live: Live[] = [];
  let next = 0;
  let order = 0;
  for (let i = 0; i < total; i += CONTROL) {
    const count = Math.min(CONTROL, total - i);
    while (next < onsets.length && onsets[next]!.start < i + count) {
      const onset = onsets[next]!;
      next += 1;
      const playing = live.filter((x) => !x.stolen);
      if (playing.length >= ORGAN_VOICES) {
        const released = playing.filter((x) => x.voice.released);
        const pool = released.length > 0 ? released : playing;
        let victim = pool[0]!;
        for (const x of pool) if (x.order < victim.order) victim = x;
        victim.fadeLength = Math.max(1, Math.round(STEAL_SECONDS * sr));
        victim.fade = victim.fadeLength;
        victim.stolen = true;
      }
      // Single-trigger percussion is one envelope per track: a key struck
      // with nothing held fires it; keys that join (a chord, a legato line)
      // sound it at the level it has decayed to.
      const held = live.some((x) => !x.voice.released && x.off > onset.start);
      if (!held) percAt = onset.start;
      const perc = Math.exp(-(onset.start - percAt) / sr / percTau);
      const { note } = onset;
      const voice = organVoice(
        family,
        {
          pitch: note.pitch,
          hz: onset.hz,
          hzOf,
          startSec: originSec + onset.start / sr,
          trackSeed,
          noteSeed: `${track.id}:${note.id}:${note.startTick + seedTick}`,
          perc,
          ...(keyAt ? { keyAt } : {}),
        },
        values,
        sr,
      );
      const bend = note.performance?.cents;
      live.push({
        voice,
        start: onset.start,
        off: onset.off,
        order: order++,
        ...(bend ? { cents: bend } : {}),
        stolen: false,
        fade: 0,
        fadeLength: 0,
      });
    }
    for (let k = live.length - 1; k >= 0; k -= 1) {
      const x = live[k]!;
      const from = Math.max(i, x.start);
      const n = i + count - from;
      if (n <= 0) continue;
      if (x.cents) x.voice.setCents(x.cents((from - x.start) / sr));
      if (!x.voice.released && x.off < from + n) x.voice.noteOff();
      let alive: boolean;
      if (x.stolen) {
        const block = new Float64Array(n);
        alive = x.voice.process(block, 0, n);
        for (let s = 0; s < n; s += 1) {
          mono[from + s]! += (block[s]! * Math.max(0, x.fade)) / x.fadeLength;
          x.fade -= 1;
        }
        if (x.fade <= 0) alive = false;
      } else alive = x.voice.process(mono, from, n);
      if (!alive) live.splice(k, 1);
    }
  }
  const lane = (name: string) => {
    const points = track.fxAutomation?.[`keys-${name}` as FxLane];
    return points && points.length > 0 ? points : undefined;
  };
  const rotaryLane = family === "pipe" ? undefined : lane("rotary");
  const driveLane = family === "pipe" ? undefined : lane("drive");
  const settings = organPostSettings(family, values, rotaryLane !== undefined);
  const seed = rotaryLane ? context.seedState?.[track.id] : undefined;
  const post = new OrganPost(
    settings,
    sr,
    originSec,
    seed ? (JSON.parse(seed) as RotorState) : undefined,
  );
  const monoR = new Float64Array(total);
  post.process(
    mono,
    monoR,
    total,
    rotaryLane
      ? (s) =>
          interpolateAutomation(rotaryLane, tickAt(context, s), settings.rotary)
      : undefined,
    driveLane
      ? (s) =>
          interpolateAutomation(driveLane, tickAt(context, s), settings.drive)
      : undefined,
  );
  applyVolume(mono, monoR, track, context);
  for (let s = 0; s < total; s += 1) {
    left[s]! += mono[s]!;
    right[s]! += monoR[s]!;
  }
}

function applyVolume(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EngineContext,
): void {
  const volume = clamp(track.volume ?? 1, 0, 1);
  const points = track.volumeAutomation ?? [];
  if (points.length === 0 && volume === 1) return;
  for (let i = 0; i < left.length; i += CONTROL) {
    const gain =
      points.length === 0
        ? volume
        : volume * interpolateAutomation(points, tickAt(context, i), 1);
    const end = Math.min(left.length, i + CONTROL);
    for (let s = i; s < end; s += 1) {
      left[s]! *= gain;
      right[s]! *= gain;
    }
  }
}

/** Ring-out after the last note (the voices' release plus the rotor delay). */
export function organTailSeconds(family: OrganFamily): number {
  return family === "pipe" ? 0.6 : family === "combo" ? 0.15 : 0.1;
}

/** The live note-off fade per family (a linear fade of the same energy). */
export function organReleaseSeconds(family: OrganFamily): number {
  return family === "pipe" ? 0.15 : family === "combo" ? 0.03 : 0.012;
}

function resolvedPercFast(values: Values): boolean {
  return str(values, "percdecay", "fast") === "fast";
}

/**
 * The rotors at sample `frames` of `history` (the song before an arranged
 * window), integrated from song start along the track's `keys-rotary`
 * lane. Undefined without a lane: steady rotors follow from song time.
 */
export function organRotorSeed(
  history: TimeScore & Readonly<{ ticksPerBeat: number; tempoBpm: number }>,
  track: Track,
  frames: number,
  sampleRate: number,
): string | undefined {
  const family = track.instrument;
  if (!isOrganFamily(family) || family === "pipe") return undefined;
  const lane = track.fxAutomation?.["keys-rotary" as FxLane];
  if (!lane || lane.length === 0) return undefined;
  const values = resolvedKeys(family, track.keys);
  const settings = organPostSettings(family, values, true);
  const post = new OrganPost(settings, sampleRate);
  const warp = sampleWarpFor(history, sampleRate);
  const perTick = (sampleRate * 60) / (history.tempoBpm * history.ticksPerBeat);
  post.spin(frames, (s) =>
    interpolateAutomation(
      lane,
      warp ? warp.tick(s) : s / perTick,
      settings.rotary,
    ),
  );
  return JSON.stringify(post.rotor());
}

function organEngine(id: OrganFamily): InstrumentEngine {
  return {
    id,
    field: "keys",
    render(dry, dryR, notes, track, context) {
      if (dryR) {
        renderOrganTrack(dry, dryR, notes, track, context);
        return;
      }
      const left = new Float64Array(dry.length);
      const right = new Float64Array(dry.length);
      renderOrganTrack(left, right, notes, track, context);
      for (let i = 0; i < dry.length; i += 1)
        dry[i]! += 0.5 * (left[i]! + right[i]!);
    },
    windowSeed: organRotorSeed,
    tailSeconds: () => organTailSeconds(id),
    releaseSeconds: () => organReleaseSeconds(id),
    stereo: () => true,
  };
}

/** One engine per organ family (KEYS_ENGINES appends them). */
export const ORGAN_ENGINES: readonly InstrumentEngine[] = Object.freeze(
  (["tonewheel", "combo", "pipe"] as const).map(organEngine),
);
