/**
 * The modelled acoustic piano (0.6 keys lane, families grand, upright, felt,
 * honkytonk, prepared), ported from the reviewed prototype
 * (`.plans/dawg-06/proto/keys/keys.ts` round 2, `PianoVoice`): modal strings
 * after Bank (f_n = n f0 sqrt(1 + B n^2), partial 1 exactly at the tuned
 * pitch), a spectral felt-hammer pulse (Chaigne and Askenfelt 1994), 1-3
 * unison strings with prompt sound and aftersound (Weinreich 1977), dampers
 * that let F6 and up ring, knock and key-off mechanics, and seeded per-key
 * preparations. The numbers are the prototype's; only the octave stretch is
 * new (the review's fix): derived from each key's own B rather than a fixed
 * Railsback curve.
 */
import { seedHash, unit } from "../dsp/rng.ts";
import { seededRandom } from "../dsp/rng.ts";
import {
  Biquad2,
  Burst,
  clamp,
  hammerPulse,
  lerp,
  LN1000,
  MODE_CEILING,
  ModeBank,
  panGains,
  pulseMag,
  TAU,
} from "./dsp.ts";

/** Resolved voice parameters (core/keys.ts `KEYS_PARAMS`). */
export type PianoParams = Readonly<{
  hardness: number;
  touch: number;
  inharm: number;
  unison: number;
  decay: number;
  release: number;
  strike: number;
  after: number;
  knock: number;
  noise: number;
  felt: number;
  prep: number;
  width: number;
  stretch: number;
}>;

export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;
/** F6 and up have no dampers and ring on after key-up, as on a grand. */
export const NO_DAMPER_FROM = 89;

/** Inharmonicity coefficient B for a key (grand at mult 1): 1e-4 at A1, 0.02 at C8. */
export function pianoB(pitch: number, mult: number): number {
  const p = clamp(pitch, PIANO_LOW, PIANO_HIGH);
  const lg = p >= 33 ? -4 + ((p - 33) / 75) * 2.3 : -4 + ((33 - p) / 12) * 0.45;
  return mult * 10 ** lg;
}

/**
 * The physical key a frequency sounds at (12-TET place, fractional, on the
 * 88-key range). Everything physical (B, strings, decay, dampers) is read
 * here, so a 19-EDO degree near 750 Hz is voiced as the F#5 it sounds as,
 * not as the MIDI number it is stored under. Exact in 12-TET.
 */
export function physicalKey(hz: number): number {
  const key = 69 + 12 * Math.log2(hz / 440);
  const near = Math.round(key);
  return clamp(Math.abs(key - near) < 1e-6 ? near : key, PIANO_LOW, PIANO_HIGH);
}

/** True when a key has no damper (F6 and up). */
export const undamped = (key: number): boolean =>
  Math.round(key) >= NO_DAMPER_FROM;

/** Damper T60 of the fundamental at `f1` Hz when the key falls (seconds). */
export function damperT60(key: number, f1: number, release: number): number {
  const base = release * (0.12 + 0.55 * clamp((64 - key) / 43, 0, 1));
  return base / (1 + f1 / 2000);
}

export const stringsFor = (pitch: number): number =>
  pitch < 31 ? 1 : pitch < 42 ? 2 : 3;

/** Aftersound T60 of the fundamental in seconds (A0 28 s, A4 6.2 s, C8 1.8 s). */
export const pianoT60 = (pitch: number): number =>
  28 * 2 ** (-(clamp(pitch, PIANO_LOW, PIANO_HIGH) - 21) / 22);

/** Partial `n` of a string whose partial 1 sounds at `f1`. */
export function pianoPartial(f1: number, b: number, n: number): number {
  return ((n * f1) / Math.sqrt(1 + b)) * Math.sqrt(1 + b * n * n);
}

/**
 * Cents an octave from `low` to `low + 12` is widened so the upper key's
 * partial 1 meets the lower key's partials: pure 2:1 in the treble (from the
 * C5 octave up), blending in half of the 4:2 match below C4, as an aural
 * tuner does.
 */
function octaveWidening(low: number, inharm: number): number {
  const bl = pianoB(low, inharm);
  const bu = pianoB(low + 12, inharm);
  const c21 = 600 * Math.log2((1 + 4 * bl) / (1 + bl));
  const c42 =
    600 * Math.log2(((1 + 16 * bl) * (1 + bu)) / ((1 + bl) * (1 + 4 * bu)));
  const w42 = 0.5 * clamp((72 - (low + 12)) / 12, 0, 1);
  return (1 - w42) * c21 + w42 * c42;
}

const stretchTables = new Map<number, Float64Array>();

/**
 * Stretch in cents for each key 0..127 at an inharmonicity multiplier: the
 * temperament octave D#4..D5 stays put (A4 exact), every other key is tuned
 * by octaves from its own strings' B.
 */
export function stretchCents(pitch: number, inharm: number): number {
  let table = stretchTables.get(inharm);
  if (!table) {
    table = new Float64Array(128);
    for (let p = 75; p < 128; p += 1)
      table[p] = table[p - 12]! + octaveWidening(p - 12, inharm);
    for (let p = 62; p >= 0; p -= 1)
      table[p] = table[p + 12]! - octaveWidening(p, inharm);
    if (stretchTables.size > 32) stretchTables.clear();
    stretchTables.set(inharm, table);
  }
  return table[clamp(Math.round(pitch), 0, 127)]!;
}

/**
 * The pitch of partial 1 for a note at a resolved `hz` with stretch. The
 * stretch is read at the note's frequency (its 12-TET key position, linearly
 * interpolated), so it follows octaves in any tuning table: a 19-EDO key an
 * octave up gets the same widening as a 12-TET one.
 */
export function pianoF1(hz: number, p: PianoParams): number {
  if (!(p.stretch > 0)) return hz;
  const key = clamp(69 + 12 * Math.log2(hz / 440), 0, 127);
  const low = Math.floor(key);
  const high = Math.min(127, low + 1);
  const cents = lerp(
    stretchCents(low, p.inharm),
    stretchCents(high, p.inharm),
    key - low,
  );
  return hz * 2 ** ((p.stretch * cents) / 1200);
}

export type PianoNoteOn = Readonly<{
  pitch: number;
  /** Resolved frequency: noteHz(pitch, cents, table); > 0. */
  hz: number;
  /** 0..1 after the 0.5 velocity curve. */
  velocity: number;
  /** Track seed hash (preparations are per track and key). */
  trackSeed: number;
  /** Track seed plus note id (this strike's own randomness). */
  noteSeed: string;
}>;

type Rattle = {
  hz: number;
  gain: number;
  k: number;
  phase: number;
  random: () => number;
};

export class PianoVoice {
  private readonly bank: ModeBank;
  private readonly pulse: Float64Array;
  private pos = 0;
  private readonly bursts: Burst[] = [];
  readonly gl: number;
  readonly gr: number;
  private tmp = new Float64Array(0);
  private readonly key: number;
  private readonly rattle: Rattle | undefined;
  private age = 0;
  private releasedFlag = false;

  constructor(
    private readonly note: PianoNoteOn,
    private readonly p: PianoParams,
    private readonly sr: number,
  ) {
    const v = clamp(lerp(0.8, note.velocity, p.touch), 0.01, 1);
    // Physical place from the sounding frequency; the MIDI key only seeds
    // the preparation slot.
    const key = physicalKey(note.hz);
    this.key = key;
    const prepKey = clamp(note.pitch, PIANO_LOW, PIANO_HIGH);
    const keyPos = (key - 21) / 87;
    const random = seededRandom(`${note.noteSeed}:piano`);
    // Preparation: drawn per track and key, so a prepared key always
    // sounds the same in that track and differs between tracks.
    let slot = 0;
    const prep = () => unit(note.trackSeed, prepKey, slot++);
    const prepared = p.prep > 0 && prep() < p.prep;
    // 0 bolt, 1 rubber, 2 screw
    const prepKind = prepared ? Math.floor(prep() * 3) : -1;
    const B = pianoB(key, p.inharm);
    const f1 = pianoF1(note.hz, p);
    const f0 = f1 / Math.sqrt(1 + B);
    const T1 =
      pianoT60(key) *
      p.decay *
      (1 - 0.15 * p.felt) *
      (prepKind === 1 ? 0.12 : prepKind >= 0 ? 0.5 : 1);
    const after = clamp(p.after, 0, 0.95);
    const thMs =
      lerp(3.5, 0.8, keyPos) *
      lerp(1.6, 0.7, v) *
      (1 + 1.5 * p.felt) *
      (1.3 - 0.6 * p.hardness);
    this.pulse = hammerPulse(
      Math.max(2, Math.round(thMs * 1e-3 * sr)),
      1 + 2 * v * p.hardness,
    );
    const strings = stringsFor(key);
    const spread = strings === 1 ? 0.08 : p.unison;
    const maxHz = MODE_CEILING * sr;
    let partials = 0;
    while (partials < 160) {
      const n = partials + 1;
      if (n * f0 * Math.sqrt(1 + B * n * n) >= maxHz) break;
      partials = n;
    }
    const extra = prepKind === 0 || prepKind === 2 ? 4 : 0;
    const bank = new ModeBank(
      Math.min(12, partials) * 3 + Math.max(0, partials - 12) + extra,
    );
    const xb = 0.1 + 0.3 * prep();
    const shift = prepKind === 0 || prepKind === 2 ? 0.04 + 0.1 * prep() : 0;
    const candidates: { hz: number; t60: number; u: number }[] = [];
    let energy = 0;
    for (let n = 1; n <= partials; n += 1) {
      let fn = n * f0 * Math.sqrt(1 + B * n * n);
      if (shift && n > 1) fn *= 1 - shift * Math.sin(n * Math.PI * xb) ** 2;
      const shape = Math.sin(n * Math.PI * p.strike);
      if (Math.abs(shape) < 1e-3) continue;
      const tn = 1 / (1 / T1 + (fn / 3000) ** 2 / (1.2 * p.decay));
      const damped = prepKind === 1 && n > 3 ? 0.3 : 1;
      const u = shape * damped;
      energy += u * u;
      if (n <= 12) {
        // Prompt sound at the centre, aftersound split into a symmetric pair.
        const d = (spread / 2) * (1 + 0.3 * (random() - 0.5));
        candidates.push({ hz: fn, t60: tn * 0.3, u: u * (1 - after) });
        candidates.push({
          hz: fn * 2 ** (-d / 1200),
          t60: tn,
          u: (u * after) / 2,
        });
        candidates.push({
          hz: fn * 2 ** (d / 1200),
          t60: tn,
          u: (u * after) / 2,
        });
      } else candidates.push({ hz: fn, t60: tn * 0.6, u });
    }
    if (extra)
      for (const r of [2.76, 5.4, 8.93, 13.34])
        candidates.push({
          hz: f1 * r * (1 + 0.05 * (prep() - 0.5)),
          t60: 0.6 + 1.2 * prep(),
          u: 0.35,
        });
    const loud = v ** 1.4 * (1 - 0.4 * p.felt);
    const G = (0.35 * loud) / Math.sqrt(Math.max(energy, 1e-9));
    const mags = candidates.map(
      (c) => pulseMag(this.pulse, (TAU * c.hz) / sr) * Math.abs(c.u),
    );
    const peak = Math.max(0, ...mags);
    candidates.forEach((c, i) => {
      // Below -80 dB after the hammer filter: not worth a mode.
      if (mags[i]! >= peak * 1e-4) bank.add(c.hz, c.t60, c.u * G, 1, sr);
    });
    this.bank = bank;
    const pan = p.width * clamp((key - 64) / 44, -1, 1) * 0.8;
    [this.gl, this.gr] = panGains(pan);
    const s = note.noteSeed;
    if (p.knock > 0) {
      this.bursts.push(
        new Burst(
          `${s}:knock`,
          lerp(90, 250, keyPos),
          1.0,
          0.02 + 0.03 * (1 - keyPos),
          p.knock * 0.05 * v ** 1.5 * (prepKind === 1 ? 2 : 1),
          sr,
        ),
        new Burst(
          `${s}:click`,
          2800,
          1.5,
          0.002,
          0.02 * v * v * p.hardness * (1 - p.felt),
          sr,
        ),
      );
    }
    if (p.felt > 0 && p.noise > 0)
      this.bursts.push(
        new Burst(`${s}:thud`, 300, 0.9, 0.03, 0.04 * p.felt * p.noise * v, sr),
      );
    this.rattle =
      prepKind === 2
        ? {
            hz: f1,
            gain: 0.05 * v,
            k: Math.exp(-1 / (0.35 * sr)),
            phase: 0,
            random: seededRandom(`${s}:rattle`),
          }
        : undefined;
  }

  get released(): boolean {
    return this.releasedFlag;
  }

  /** Key up: the damper falls (none from F6 up), with key-off noise. */
  noteOff(): void {
    if (this.releasedFlag) return;
    this.releasedFlag = true;
    if (undamped(this.key)) return;
    const base =
      this.p.release * (0.12 + 0.55 * clamp((64 - this.key) / 43, 0, 1));
    this.bank.damp((hz) => base / (1 + hz / 2000), this.sr);
    if (this.p.noise > 0)
      this.bursts.push(
        new Burst(
          `${this.note.noteSeed}:keyoff`,
          500,
          1.2,
          0.015,
          0.012 * this.p.noise,
          this.sr,
        ),
      );
  }

  /** Pitch offset in cents (bend, vibrato); modes above the ceiling mute. */
  setCents(cents: number): void {
    this.bank.retune(2 ** (cents / 1200));
  }

  /** Half pedal (0.5 `damp`): every mode decays with time constant `tau`. */
  damp(tau: number): void {
    this.bank.damp(() => LN1000 * tau, this.sr);
  }

  /** Adds `count` mono samples at `offset`; false once the voice is silent. */
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
    for (const b of this.bursts)
      if (!b.done) for (let i = 0; i < count; i += 1) tmp[i]! += b.next();
    const r = this.rattle;
    if (r)
      for (let i = 0; i < count; i += 1) {
        r.phase += r.hz / this.sr;
        const gate = Math.abs(Math.sin(Math.PI * r.phase)) ** 16;
        tmp[i]! += (r.random() * 2 - 1) * gate * r.gain;
        r.gain *= r.k;
      }
    for (let i = 0; i < count; i += 1) out[offset + i]! += tmp[i]!;
    this.age += count;
    if (this.age % 256 < count) this.bank.cull(2e-6);
    return (
      this.bank.n > 0 ||
      this.bursts.some((b) => !b.done) ||
      (r !== undefined && r.gain > 1e-6)
    );
  }
}

export type PianoBodyKind =
  "grand" | "upright" | "felt" | "honkytonk" | "prepared";

/** Piano body: a fixed EQ per body type (soundboard and case colour). */
export function pianoBody(kind: string, sr: number): Biquad2[] {
  const q = (
    t: Parameters<Biquad2["set"]>[0],
    hz: number,
    qq: number,
    db: number,
  ) => new Biquad2().set(t, hz, qq, db, sr);
  switch (kind) {
    case "upright":
      return [
        q("lowshelf", 120, 0.7, -4),
        q("peak", 380, 1.2, 3),
        q("peak", 1500, 1, 2),
        q("highshelf", 5000, 0.7, -3),
      ];
    case "honkytonk":
      return [
        q("lowshelf", 120, 0.7, -4),
        q("peak", 1200, 1, 4),
        q("highshelf", 5000, 0.7, 1),
      ];
    case "felt":
      return [
        q("lowshelf", 150, 0.7, 2),
        q("peak", 400, 0.9, 1.5),
        q("highshelf", 2500, 0.7, -7),
      ];
    case "prepared":
      return [q("lowshelf", 120, 0.7, 1), q("peak", 250, 0.8, 2)];
    default:
      return [
        q("lowshelf", 120, 0.7, 1.5),
        q("peak", 250, 0.8, 2),
        q("peak", 2500, 1, -2),
        q("highshelf", 6000, 0.7, -2),
      ];
  }
}

/** Track seed hash for preparations. */
export const trackSeedOf = (trackId: string): number =>
  seedHash(`keys:${trackId}`);
