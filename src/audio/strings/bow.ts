/**
 * A bowed string (0.6.1 lane f061-bowed), ported from the 0.6 strings
 * prototype's `BowedString`: the STK `Bowed` topology (Cook and Scavone)
 * with a neck and a bridge delay line split at the bow point, the bow
 * table `(|dv| x slope + 0.75)^-4` and a one-pole bridge loss, plus the
 * review fixes:
 *
 * - Exact tuning: the neck line carries a first-order Thiran fraction and
 *   the loop length counts the loss filter's phase delay (the junction adds
 *   no measurable lag, so the prototype's bow-lag calibration is the
 *   frozen constant 0, not module state).
 * - Playable beta: `pos` maps onto 0.08..0.4 of the loop, and the bridge
 *   segment never falls under 4 samples. A period under 24 samples runs
 *   the loop at twice the rate through the shared half-band decimator.
 * - Schelleng window: bow force follows `pressure` between the minimum
 *   (proportional to v / beta^2) and maximum (proportional to v / beta)
 *   force for the bow speed and beta (Schelleng 1973; Woodhouse 2014), so
 *   every pressure stays in Helmholtz motion.
 * - Dynamics: `dyn` x velocity drives bow speed over 8:1, a per-voice gain
 *   law (28 dB across the range) and a tone filter whose corner rises with
 *   force and falls with beta and the mute (`sord`).
 * - Slur: `slurTo` retunes over 7 ms and keeps the bow (no new attack).
 * - Tremolo: `tremhz` reverses the bow that many times a second, with a
 *   seeded per-voice rate jitter. At each reversal the bow force eases off
 *   with the bow speed (the friction curve narrows as dir^2), so the
 *   string rings through the turn instead of sticking to a slow bow and
 *   flattening; the pitch lock averages each stroke's middle (one update
 *   per stroke) instead of chasing the turns' transient periods.
 */
import { Decimate2 } from "../dsp/oversample.ts";
import { thiranFor } from "../dsp/interp.ts";
import { unit } from "../dsp/rng.ts";
import { clamp, designLoss, onePoleDelay } from "./loop.ts";
import { C4 } from "./pluck.ts";

/** Control-rate step (base-rate samples), the same as dawg's lanes. */
const CONTROL = 32;
/** Playable bow positions (fraction of the loop from the bridge). */
export const BETA_MIN = 0.08;
export const BETA_MAX = 0.4;
/** Shortest bridge segment in loop samples. */
export const BRIDGE_FLOOR = 4;
/** Periods shorter than this (base-rate samples) run at 2x. */
export const OVERSAMPLE_BELOW = 24;
/** Slur retune time in seconds (the review asks for 5-10 ms). */
export const SLUR_SECONDS = 0.007;
/** Widest slur in semitones (the loop buffer holds two octaves down). */
export const SLUR_RANGE = 24;
/**
 * Pitch lock: the stick-slip corner travels the loop faster than the loss
 * filter's phase delay at f0 says (its high partials see less delay), so
 * an open loop plays up to 15 cents sharp. Each period the lock measures
 * the band-passed bridge velocity's zero-crossing period and moves the
 * loop length by LOCK_GAIN of the error, inside +-LOCK_RANGE. Its state is
 * per voice, so renders stay order-independent.
 */
const LOCK_GAIN = 0.25;
const LOCK_RANGE = 0.03;
/** Tremolo: |sin| of the reversal phase past which a stroke is steady. */
const STROKE_STEADY = 0.7;
/** Tremolo: lock step per stroke, on the stroke's mean period error. */
const STROKE_LOCK_GAIN = 0.2;
/** Tremolo: the friction slope widens at most 1 / FLOOR^2 at a turn. */
const TURN_FORCE_FLOOR = 0.05;
/** Speed ratio between dyn 0 and dyn 1 (the review's 8:1). */
const SPEED_RATIO = 8;
/** Extra gain law across dyn, in dB (with the 18 dB speed law: 28 dB). */
const GAIN_LAW_DB = 10;
/**
 * Schelleng window, measured. In the bow table's units the friction
 * capacity over bow speed is r = 0.25 / (slope x v); Schelleng's minimum
 * and maximum bow force bound r from below and above, and both move with
 * beta and the loop length (Schelleng 1973; Woodhouse 2014). Rather than
 * fit one constant (the prototype's guard, which the review showed stalls
 * the string over part of the range), the window is a frozen table. Each
 * cell covers a log2 loop length step of 0.25 from 4.5 (rows) and a beta
 * step of 0.02 from 0.08 (columns); it holds the steps i of
 * r = 0.01 x 2^(i/4) (one character each, i = code - 48) that stay
 * f0-dominant at velocity 0.15, 0.5 and 0.95, at 22.05 and 48 kHz, at all
 * four cell corners.
 * `pressure` moves log-linearly inside the window less a margin, so every
 * pressure stays in Helmholtz motion (bow.test.ts sweeps it).
 */
const WINDOW_LP0 = 4.5;
const WINDOW_LO: readonly string[] = [
  "CLLDC??<;:988GG7",
  "CCCJJ??>>;988887",
  "CCDJJEE>>;998888",
  "EELLEEE>>:999988",
  "EEMMEAA>>::99999",
  "FCMMEAA?>;:::999",
  "FFFFBBB@=;:::::9",
  "HFGGBBBAA;;;::::",
  "HFGGECCCB<<<;;;;",
  "HHHHFCDDB==<<<<;",
  "JHHHGCDDCB===<<<",
  "JIIIGDDDDC====<<",
  "JKKKHEEEDD>=====",
  "KKKKHGEEED>>====",
  "KLLJIGEEEE>>>===",
  "MMMLJHFFFF>>>===",
  "MMMLJIFGGF>>>>==",
  "KKKKJIGGGF?>>>==",
  "JJJJJIHOOH?>>>>=",
  "HHHHHHHOOI?>>>>=",
  "MMMMMMMMMJD>>>>=",
  "MMMMMMMMMKK>>>>=",
  "KKKKKKKKKKK>>>>=",
  ">>>>>>>>>>>>>>>=",
];
const WINDOW_HI: readonly string[] = [
  "KKKKIHEEEICCCFGA",
  "IIIIIIEEEFCCCGGA",
  "IIIIKKHHHFFFFHHA",
  "XLIIHHIIJLJJHHHB",
  "NLLNHHHHLLLLIIMB",
  "NNPMMSHHKXLHHIRC",
  "TXXMMKJJKXLHHKXC",
  "TVWRRKJJXXXXLLXD",
  "TVWXXJJKXXXXXXXD",
  "TVWXXJJKXXXXXXFD",
  "TVWXXJJLXXXXXKFD",
  "TVVWXJJLXXXXXJFE",
  "SUVWWLLMXXXXXJFE",
  "SUVVWXXXXXXXXJFE",
  "STUUVWWXXXXXXJFE",
  "TTTTUVWXXXXXXJFE",
  "TTTTTUVWXXXXXIFE",
  "TTTTTTUVXXXXXIFE",
  "TTTTTTTTXXXXXIFE",
  "RRRRRRRRTXXXXIFF",
  "OOOOOOOOOSXXXJFF",
  "OOOOOOOOOSXXXKFF",
  "XXXXXXXXXXXXXLGF",
  "XXXXXXXXXXXXXXGG",
];
/** Widest window used (steps of 2^(1/4)): pressure spans 8x at most. */
const WINDOW_SPAN = 10;
/** Margin inside each measured edge, in steps. */
const WINDOW_MARGIN = 3;

function cell(table: readonly string[], lp: number, beta: number): number {
  const y = clamp(Math.floor((lp - WINDOW_LP0) / 0.25), 0, table.length - 1);
  const row = table[y]!;
  const x = clamp(
    Math.floor((beta - BETA_MIN + 1e-9) / 0.02),
    0,
    row.length - 1,
  );
  return row.charCodeAt(x) - 48;
}

/** Resolved bowed-string parameters for one note. */
export type BowSpec = Readonly<{
  /** Free-string T60 (s) at C4 with the bow lifted. */
  decay: number;
  /** Decay key tracking: T60 x (f/C4)^-track. */
  track: number;
  /** 0..1 high-frequency loss. */
  damp: number;
  /** Bow position, 0.01..0.5 asked; played inside BETA_MIN..BETA_MAX. */
  pos: number;
  /** 0..1 of the Schelleng window. */
  pressure: number;
  /** 0..1 bow speed at full dynamics. */
  speed: number;
  /** Seconds of bow-speed ramp at the start of a stroke. */
  attack: number;
  /** Seconds for the bow to lift after note-off. */
  release: number;
  /** Bow reversals per second (0 = a sustained stroke). */
  tremhz: number;
  /** 0..1 practice mute. */
  sord: number;
}>;

/** The continuously read (every 32 samples) bow controls. */
export type BowControl = Readonly<{
  pressure: number;
  speed: number;
  sord: number;
  dyn: number;
}>;

export type BowNote = Readonly<{
  hz: number;
  /** 0..1 after the velocity curve and the preset's sensitivity. */
  velocity: number;
  /** Seconds to note-off. */
  hold: number;
  seed: number;
  /** The note's own pitch curve in cents at `t` seconds from its start. */
  cents?: (t: number) => number;
  /** Vibrato in cents at `t` seconds from the bow's start (kept by a slur). */
  vibrato?: (t: number) => number;
  /** Lane values at `t` seconds from the bow's start (absent: the spec). */
  control?: (t: number) => BowControl;
  /** Calibration only: a fixed friction capacity r (slope = 0.25 / (r v)). */
  capacity?: number;
}>;

/**
 * Playable bow positions, measured (0.6.1 review). Helmholtz motion holds
 * only on some bow positions, and which ones depends on the loop length
 * and on the loop's own loss: a long, slowly decaying loop (a cello or
 * double bass, `ring` 0.9-1.2) has holes in beta where the string flips
 * to its octave or goes raucous at every pressure. Each cell covers a
 * log2 loop length step of 0.25 from 5 (rows) and a loop T60 interval
 * between BETA_T60S (4 base-36 characters per interval); it holds a
 * bitmask of the betas 0.08 + 0.02 k that stay f0-dominant at pressure 0,
 * 0.5 and 1, speed 0.1 and 1, velocity 0.2 and 1, at 22.05 and 48 kHz,
 * at all four cell corners (a few cells with none hold the least bad).
 */
const BETA_LP0 = 5;
const BETA_T60S: readonly number[] = [0.4, 0.6, 1.0, 1.5, 2.2, 3.2, 4.5];
const BETA_SAFE: readonly string[] = [
  "2t4v2sjj1dvz1dvz1dvz118v",
  "2sqn2sqn1ekf1ekf1ehr1e3j",
  "2sql2sql1ejh1ejj1ea71dvz",
  "2t4t2sjg1dy40ov20olq0olq",
  "2t4v2sji0ony0ota0olq0olq",
  "2t4v2sqn0ov30osv0olr0olr",
  "2t4v2sqm1e660omn0oj30oj3",
  "2t4u2sqm1e260oj30oi70oi7",
  "2t4u2t4u0orz0oi70olr0olr",
  "2t4s2t4u0onj0olr0olr0omn",
  "2t4o2t4u0oi70oi70olr0olr",
  "2t4g2t4s0nq70npr0nta0npq",
  "1k2o2t0w1dem0npr0npq0npq",
  "00ow2t0g2rks0npq0npr0npq",
  "00lc2szk2rmg1czy0npq0npq",
  "06bk0k5c2se82rk01czq1czy",
  "06bk00e82shs2rk02rk61czq",
  "06bk0cn42shs2sg02rnm1d3a",
  "06bk06bk21hc2sg02rnk2rnq",
  "0cn40cn40cn42scg2scg2scg",
  "0cn40cn40cn42rk02rk02rk0",
  "0cn40cn42pz42rk02rk02rk0",
  "0cn40cn42pz42rk02rk02rk0",
];

function safeBetas(lp: number, t60: number): number {
  const y = clamp(Math.floor((lp - BETA_LP0) / 0.25), 0, BETA_SAFE.length - 1);
  let x = 0;
  while (x < BETA_T60S.length - 2 && t60 >= BETA_T60S[x + 1]!) x += 1;
  return parseInt(BETA_SAFE[y]!.slice(4 * x, 4 * x + 4), 36);
}

/**
 * Beta actually played for `pos` on a loop of `period` samples whose T60
 * is `t60` seconds: inside 0.08..0.4, at least 4 samples of bridge
 * segment, then the measured playable beta nearest to it (the review's
 * "playable beta per register").
 */
export function playableBeta(pos: number, period: number, t60 = 1): number {
  const floor = Math.min(BETA_MAX, BRIDGE_FLOOR / Math.max(1, period));
  const want = clamp(pos, Math.max(BETA_MIN, floor), BETA_MAX);
  const raw = safeBetas(Math.log2(Math.max(1, period)), t60);
  // Prefer a beta whose neighbours are playable too: the cells are
  // measured at their corners, and an isolated safe beta is a thin margin.
  const inner = raw & (raw << 1) & (raw >> 1);
  const mask = inner || raw;
  let best = want;
  let gap = Infinity;
  for (let k = 0; k < 17; k += 1) {
    if (!(mask & (1 << k))) continue;
    const beta = BETA_MIN + 0.02 * k;
    if (beta < floor - 1e-9) continue;
    const d = Math.abs(beta - want);
    if (d < gap - 1e-9) {
      gap = d;
      best = beta;
    }
  }
  return best;
}

/** Whether a bowed note at `hz` runs at twice the rate `sr`. */
export function bowOversample(hz: number, sr: number): 1 | 2 {
  return sr / hz < OVERSAMPLE_BELOW ? 2 : 1;
}

/**
 * Bow-table slope for `pressure` inside the Schelleng window at `beta` on
 * a loop of `period` samples, for bow speed `v`. Pressure 0 sits near the
 * minimum bow force (light, flautando), 1 near the maximum (gritty).
 */
export function schellengSlope(
  pressure: number,
  beta: number,
  v: number,
  period: number,
): number {
  const lp = Math.log2(Math.max(1, period));
  const lo = cell(WINDOW_LO, lp, beta);
  const hi = Math.min(cell(WINDOW_HI, lp, beta), lo + WINDOW_SPAN);
  const a = lo + WINDOW_MARGIN;
  const b = hi - WINDOW_MARGIN;
  const step = b > a ? a + (b - a) * clamp(pressure, 0, 1) : (lo + hi) / 2;
  const r = 0.01 * 2 ** (step / 4);
  return 0.25 / (r * Math.max(1e-6, v));
}

/** One bowed string, streamed in blocks. */
export class BowedString {
  private readonly os: 1 | 2;
  private readonly rate: number;
  private readonly nb: Float64Array;
  private readonly bb: Float64Array;
  private readonly mask: number;
  private nw = 0;
  private bw = 0;
  private Nn = 1;
  private Nb = 1;
  private a = 0;
  private tx1 = 0;
  private ty1 = 0;
  private sg: number;
  private sp: number;
  private sy = 0;
  private beta: number;
  private fromBeta = 0;
  private toBeta = 0;
  private slurLoss?: { g: number; p: number };
  private readonly f0: number;
  private hz: number;
  private fromHz: number;
  private slurAt = -1;
  private slurLen = 1;
  private cents?: (t: number) => number;
  private centsAt = 0;
  private readonly vibrato?: (t: number) => number;
  private readonly decim?: Decimate2;
  private readonly tremRate: number;
  private readonly tremPhase: number;
  /** Tremolo: between turns, and that stroke's lock measurements. */
  private steady = true;
  private strokeErr = 0;
  private strokeCount = 0;
  private strokeSkip = 0;
  /** Internal-rate sample count. */
  private n = 0;
  private off: number;
  private quiet = 0;
  // Control-rate state.
  private slope = 3;
  private vtarget = 0.1;
  private gain = 1;
  private toneA = 1;
  private toneY = 0;
  // Pitch lock: loop length x (1 + lock); band-pass at the target pitch.
  private lock = 0;
  private target = 1;
  private bpB = 0;
  private bpA1 = 0;
  private bpA2 = 0;
  private bpX1 = 0;
  private bpX2 = 0;
  private bpY1 = 0;
  private bpY2 = 0;
  private lastCross = -1;
  // Output DC blocker (10 Hz): a lifted loop with near-unity DC gain keeps
  // a tiny offset that would otherwise hold the voice open.
  private dcR = 1;
  private dcX = 0;
  private dcY = 0;
  done = false;

  constructor(
    readonly spec: BowSpec,
    readonly note: BowNote,
    readonly sr: number,
    readonly maxSeconds = 12,
  ) {
    const f0 = note.hz;
    this.f0 = f0;
    this.os = bowOversample(f0, sr);
    this.rate = sr * this.os;
    const loss = this.loss(f0);
    this.sg = loss.g;
    this.sp = loss.p;
    // Room for a two-octave slur down (SLUR_RANGE) and a wide vibrato.
    let size = 16;
    while (size < (this.rate / f0) * 4.5 + 16) size <<= 1;
    this.nb = new Float64Array(size);
    this.bb = new Float64Array(size);
    this.mask = size - 1;
    if (this.os === 2) this.decim = new Decimate2();
    this.hz = f0;
    this.fromHz = f0;
    this.beta = playableBeta(spec.pos, this.rate / f0, this.t60(f0));
    if (note.cents) this.cents = note.cents;
    if (note.vibrato) this.vibrato = note.vibrato;
    this.tremRate = spec.tremhz * (1 + 0.08 * (unit(note.seed, 0, 7) - 0.5));
    this.tremPhase = unit(note.seed, 0, 8);
    this.off = Math.round(note.hold * this.rate);
    this.dcR = 1 - (2 * Math.PI * 10) / sr;
    this.control(0);
    this.retune(f0, true);
  }

  /** Loop T60 (s) at `hz`: the free-string decay with key tracking. */
  private t60(hz: number): number {
    return this.spec.decay * (hz / C4) ** -this.spec.track;
  }

  /** The loop's loss filter at `hz` (sordino darkens it). */
  private loss(hz: number): { g: number; p: number } {
    const spec = this.spec;
    const t0 = this.t60(hz);
    const damp = clamp(spec.damp + (1 - spec.damp) * 0.5 * spec.sord, 0, 1);
    return designLoss(
      hz,
      t0,
      Math.max(3000, 2 * hz),
      t0 / (1 + 99 * damp * damp),
      this.rate,
    );
  }

  /**
   * Whether this string can slur to `hz` without a new stroke: within
   * SLUR_RANGE semitones of its first note and at the same internal rate
   * (a slur up into the oversampled register restarts the bow instead).
   */
  canSlurTo(hz: number): boolean {
    const semis = Math.abs(12 * Math.log2(hz / this.f0));
    return semis <= SLUR_RANGE && bowOversample(hz, this.sr) === this.os;
  }

  /** Note-off in base-rate samples from the string's start. */
  get offAt(): number {
    return Math.round(this.off / this.os);
  }

  /** Moves note-off to `at` base-rate samples (restrike, steal). */
  releaseAt(at: number): void {
    const n = at * this.os;
    if (n < this.off) this.off = Math.max(this.n, n);
  }

  /**
   * Slurs to `hz` at `at` base-rate samples from the start: the pitch moves
   * over SLUR_SECONDS, the bow keeps going, and note-off moves to `hold`
   * seconds after `at`. The new note's own pitch curve replaces the old.
   */
  slurTo(
    hz: number,
    at: number,
    hold: number,
    cents?: (t: number) => number,
  ): void {
    const n = Math.max(this.n, at * this.os);
    this.fromHz = this.currentHz();
    this.hz = hz;
    this.slurAt = n;
    this.slurLen = Math.max(1, Math.round(SLUR_SECONDS * this.rate));
    this.off = n + Math.round(hold * this.rate);
    this.cents = cents;
    this.centsAt = n;
    // The bow point, its gain and Schelleng slope, and the loop loss follow
    // the new pitch: the bridge tap glides with the pitch over the slur.
    this.fromBeta = this.beta;
    this.toBeta = playableBeta(this.spec.pos, this.rate / hz, this.t60(hz));
    this.slurLoss = this.loss(hz);
  }

  /** The loop's base pitch now (inside a slur, the glide position). */
  private currentHz(): number {
    if (this.slurAt < 0 || this.n >= this.slurAt + this.slurLen) return this.hz;
    if (this.n < this.slurAt) return this.fromHz;
    const k = (this.n - this.slurAt) / this.slurLen;
    return this.fromHz * (this.hz / this.fromHz) ** k;
  }

  /** Loop delay for `hz`: bridge segment at beta, Thiran on the neck. */
  private retune(hz: number, first = false): void {
    const rate = this.rate;
    const w0 = (2 * Math.PI * hz) / rate;
    const total = (rate / hz) * (1 + this.lock) - onePoleDelay(this.sp, w0);
    this.target = rate / hz;
    // Band-pass (Q 3) at the target pitch for the lock's period detector.
    const alpha = Math.sin(w0) / 6;
    const a0 = 1 + alpha;
    this.bpB = alpha / a0;
    this.bpA1 = (-2 * Math.cos(w0)) / a0;
    this.bpA2 = (1 - alpha) / a0;
    if (first) {
      this.beta = playableBeta(this.spec.pos, total, this.t60(hz));
      this.Nb = Math.max(1, Math.round(this.beta * total));
    } else if (this.slurAt >= 0 && this.n >= this.slurAt) {
      if (this.slurLoss) {
        this.sg = this.slurLoss.g;
        this.sp = this.slurLoss.p;
        this.slurLoss = undefined;
        this.lock = 0;
      }
      const k = Math.min(1, (this.n - this.slurAt) / this.slurLen);
      this.beta = this.fromBeta + (this.toBeta - this.fromBeta) * k;
      this.Nb = Math.max(1, Math.round(this.beta * total));
    }
    const rest = total - this.Nb;
    const Nn = Math.max(1, Math.floor(rest - 0.5));
    const D = clamp(rest - Nn, 0.5, 1.5);
    const a = thiranFor(D, w0);
    if (!first && Nn !== this.Nn) {
      const m = this.mask;
      this.tx1 = this.nb[(this.nw - 1 - Nn) & m]!;
      const pos = this.nw - 1 - Nn - D;
      const i0 = Math.floor(pos);
      const fr = pos - i0;
      this.ty1 = this.nb[i0 & m]! * (1 - fr) + this.nb[(i0 + 1) & m]! * fr;
    }
    this.Nn = Nn;
    this.a = a;
  }

  /** Reads the lanes and sets bow speed, slope, gain and tone. */
  private control(t: number): void {
    const spec = this.spec;
    const c = this.note.control?.(t);
    const pressure = c ? c.pressure : spec.pressure;
    const speed = c ? c.speed : spec.speed;
    const sord = clamp(c ? c.sord : spec.sord, 0, 1);
    const d = clamp(this.note.velocity * (c ? c.dyn : 1), 0, 1);
    const v =
      (0.05 + 0.25 * clamp(speed, 0, 1)) * SPEED_RATIO ** (d - 1) * 0.9 + 0.005;
    this.vtarget = v;
    this.slope =
      this.note.capacity !== undefined
        ? 0.25 / (this.note.capacity * v)
        : schellengSlope(pressure, this.beta, v, this.rate / this.hz);
    // Amplitude at the bridge is proportional to v / beta: undo the beta.
    this.gain =
      1.6 *
      (this.beta / 0.12) *
      10 ** ((-GAIN_LAW_DB * (1 - d)) / 20) *
      Math.min(1, d / 0.05) *
      (1 - 0.45 * sord);
    const fc = Math.min(
      0.45 * this.sr,
      1400 *
        2 ** (3 * d) *
        (0.6 + 0.8 * clamp(pressure, 0, 1)) *
        Math.sqrt(0.12 / this.beta) *
        (1 - 0.7 * sord),
    );
    this.toneA = 1 - Math.exp((-2 * Math.PI * fc) / this.sr);
  }

  /** One internal-rate sample of the bridge velocity. */
  private tick(attack: number, lift: number): number {
    const { nb, bb, mask } = this;
    const n = this.n;
    const off = this.off;
    const on = n < off;
    const env = on
      ? Math.min(1, (n + 1) / attack)
      : Math.max(0, 1 - (n - off) / lift);
    let dir = 1;
    if (this.tremRate > 0) {
      const s = Math.sin(
        Math.PI * (this.tremRate * (n / this.rate) + this.tremPhase),
      );
      dir = Math.tanh(4 * s);
      const steady = Math.abs(s) > STROKE_STEADY;
      if (steady !== this.steady) {
        // Leaving a stroke's middle: one lock step on its mean error.
        if (this.steady && this.strokeCount > 0)
          this.lock = clamp(
            this.lock - (STROKE_LOCK_GAIN * this.strokeErr) / this.strokeCount,
            -LOCK_RANGE,
            LOCK_RANGE,
          );
        this.steady = steady;
        this.strokeErr = 0;
        this.strokeCount = 0;
        this.strokeSkip = 0;
      }
    }
    // Note-off lifts the bow: the normal force falls over `release` (the
    // friction curve narrows, STK's bow pressure), with the bow still
    // moving, so the string leaves Helmholtz motion swinging and rings
    // freely (`ring`). Fading the contact instead would pass through a
    // half-reflecting junction that brakes the string.
    const bowVel = this.vtarget * (on ? env : 1) * dir;
    const contact = on || env > 0 ? 1 : 0;
    let slope = on ? this.slope : this.slope / Math.max(1e-3, env * env);
    // A turning bow presses less: the friction curve narrows with speed.
    if (this.tremRate > 0)
      slope /= Math.max(TURN_FORCE_FLOOR, Math.abs(dir)) ** 2;
    const bOut = bb[(this.bw - this.Nb) & mask]!;
    const raw = nb[(this.nw - this.Nn) & mask]!;
    const nOut = this.a * raw + this.tx1 - this.a * this.ty1;
    this.tx1 = raw;
    this.ty1 = nOut;
    this.sy = this.sg * (1 - this.sp) * bOut + this.sp * this.sy;
    const bridgeRefl = -this.sy;
    const nutRefl = -nOut;
    const dv = bowVel - (bridgeRefl + nutRefl);
    const r = 1 / (Math.abs(dv * slope) + 0.75);
    const r2 = r * r;
    let f = r2 * r2;
    if (f > 1) f = 1;
    const nv = contact * dv * f;
    nb[this.nw & mask] = bridgeRefl + nv;
    bb[this.bw & mask] = nutRefl + nv;
    this.nw += 1;
    this.bw += 1;
    if (on) this.track(bOut, n);
    this.n += 1;
    return bOut;
  }

  /** Pitch lock: one bridge sample into the period detector. */
  private track(x: number, n: number): void {
    const y =
      this.bpB * (x - this.bpX2) -
      this.bpA1 * this.bpY1 -
      this.bpA2 * this.bpY2;
    this.bpX2 = this.bpX1;
    this.bpX1 = x;
    const prev = this.bpY1;
    this.bpY2 = prev;
    this.bpY1 = y;
    if (!(prev < 0 && y >= 0)) return;
    const cross = n - 1 + prev / (prev - y);
    // Tremolo: only periods wholly inside a stroke's middle count.
    const last = this.steady ? this.lastCross : -1;
    this.lastCross = this.steady ? cross : -1;
    // Settle first: the attack and a slur's glide are not steady periods.
    if (last < 0 || n < 0.05 * this.rate) return;
    if (this.slurAt >= 0 && n < this.slurAt + this.slurLen + 0.02 * this.rate)
      return;
    const period = cross - last;
    const err = period / this.target - 1;
    if (Math.abs(err) > 0.1) return;
    if (this.tremRate > 0) {
      // The first period of a stroke still carries the turn.
      if ((this.strokeSkip += 1) > 1) {
        this.strokeErr += err;
        this.strokeCount += 1;
      }
      return;
    }
    this.lock = clamp(this.lock - LOCK_GAIN * err, -LOCK_RANGE, LOCK_RANGE);
  }

  /**
   * Adds `count` samples x `gain` into out[offset..] (and x `gainR` into
   * `right` when given); returns false once silent.
   */
  process(
    out: Float64Array,
    offset: number,
    count: number,
    gain = 1,
    right?: Float64Array,
    gainR = 0,
  ): boolean {
    if (this.done) return false;
    const os = this.os;
    const attack = Math.max(1, this.spec.attack * this.rate);
    const lift = Math.max(1, this.spec.release * this.rate);
    const decim = this.decim;
    let peak = 0;
    for (let i = 0; i < count; i += 1) {
      const base = this.n / os;
      if (base % CONTROL === 0) {
        const t = base / this.sr;
        this.control(t);
        let cents = this.vibrato ? this.vibrato(this.n / this.rate) : 0;
        if (this.cents)
          cents += this.cents((this.n - this.centsAt) / this.rate);
        this.retune(this.currentHz() * 2 ** (cents / 1200));
      }
      let y: number;
      if (decim) {
        const a = this.tick(attack, lift);
        y = decim.process(a, this.tick(attack, lift));
      } else y = this.tick(attack, lift);
      y *= this.gain;
      this.toneY += this.toneA * (y - this.toneY);
      const s = this.toneY - this.dcX + this.dcR * this.dcY;
      this.dcX = this.toneY;
      this.dcY = s;
      out[offset + i] = out[offset + i]! + s * gain;
      if (right) right[offset + i] = right[offset + i]! + s * gainR;
      const m = Math.abs(s);
      if (m > peak) peak = m;
    }
    if (this.n > this.off + this.spec.release * this.rate && peak < 1e-5) {
      this.quiet += count;
      if (this.quiet >= 2048) this.done = true;
    } else this.quiet = 0;
    if (this.n >= this.maxSeconds * this.rate) this.done = true;
    return !this.done;
  }
}
