/**
 * The sing engine (0.7): a built-in singing voice for a `sing` track.
 *
 * - Source: an LF glottal pulse (`dsp/glottal.ts`, band-limited by f0) with
 *   per-period jitter and shimmer and aspiration noise gated to the open
 *   phase. `bright` and velocity set the voice quality (Rd): louder is more
 *   pressed and brighter, as in a real voice (Fant 1995).
 * - Tract: a five-formant Klatt cascade (`dsp/formant.ts`) on the SATB
 *   tables, the vowel morphing in log frequency across each note, with
 *   F1/F2 tuning above the crossing for high voices and an optional
 *   singer's-formant "ring" near 3 kHz.
 * - Lines: as winds, a lone note entering under a lone held note slurs on
 *   (no glottal phase reset, a short portamento) unless the track has its
 *   own `glide`; chords stay separate voices.
 * - Ensemble: `voices` > 1 sings each line with seeded, slightly detuned,
 *   late and differently sized members, summed into two shared tracts per
 *   line (formant buckets at -0.3 and +0.3 st), panned apart.
 * - Throat: with a `drone`, each phrase is one drone voice; the melody
 *   steers a sharp overtone filter onto the octave-folded harmonic of the
 *   drone nearest each note (khoomei, sygyt), and `sub` weakens every
 *   other pulse for a kargyraa subharmonic.
 *
 * Deterministic: seeds come from each note id and start, never Math.random.
 * Causal: a window render is an exact prefix of the full render.
 */
import { parseKey } from "../../../core/chords.ts";
import type { PerformedNote } from "../../../core/expression.ts";
import {
  SCORE_LIMITS,
  type AutomationPoint,
  type Track,
} from "../../../core/score.ts";
import {
  SING_LANE_PARAMS,
  SING_VERSION,
  autoVoice,
  parseVowel,
  resolveSing,
  singPresetOf,
  singTailSeconds,
  vowelOf,
  type SingSettings,
} from "../../../core/sing.ts";
import { noteHz } from "../../../core/tuning.ts";
import {
  Bandpass,
  Cascade,
  tuneToPitch,
  vowelAt,
  type Formant,
  type VoiceType,
} from "../dsp/formant.ts";
import { glottal, glottalSpectrum, openWeight } from "../dsp/glottal.ts";
import { seededRandom } from "../dsp/rng.ts";
import { interpolateAutomation } from "../effects/common.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import { applyModalKnee } from "../resonators.ts";
import { windLines } from "../winds/engine.ts";

/** Control-rate period in samples (tract, vibrato and lanes). */
export const SING_CONTROL = 32;
/** Lines sounding at once before the oldest is stolen. */
export const MAX_SING_LINES = 16;
/** Portamento between slurred notes, seconds (time constant). */
const SLUR_SECONDS = 0.03;
/** A throat phrase ends at a gap longer than this, seconds. */
const THROAT_GAP_SECONDS = 0.25;
/** Overtone glide, seconds (time constant). */
const OVERTONE_GLIDE_SECONDS = 0.04;
/** Steal fade, seconds. */
const STEAL_FADE_SECONDS = 0.08;
/** Rd push per articulation (accent and marcato press harder). */
const PUSH: Readonly<Record<string, number>> = Object.freeze({
  accent: 0.3,
  marcato: 0.5,
  ghost: -0.6,
});

/** A standard normal draw (Box-Muller) from a uniform source. */
export function gauss(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const SQRT12 = Math.sqrt(12);
/** Harmonics the level normalization sums (the rest carry under 2%). */
const NORM_HARMONICS = 40;
/**
 * Level normalization time constants. Gain falls fast (a formant landing
 * on a harmonic is loud at once) and rises slowly: a narrow filter that
 * glides off a harmonic keeps ringing at its old level for a while, so a
 * fast rise would overshoot by 10 dB and more.
 */
const LEVEL_FALL_SECONDS = 0.003;
const LEVEL_RISE_SECONDS = 0.12;
/** Gaussian line smear: offsets in standard deviations, and weights. */
const SMEAR_AT = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2] as const;
const SMEAR = ((w) => w.map((x) => x / w.reduce((a, b) => a + b, 0)))(
  SMEAR_AT.map((x) => Math.exp((-x * x) / 2)),
);
/** Control periods between level re-aims. */
const NORM_EVERY = 4;
let reference = 0;
/** Harmonic power of the reference voice (Rd 1.3) through a flat tract. */
function referencePower(): number {
  if (reference === 0) {
    const ref = glottalSpectrum(1.3, NORM_HARMONICS);
    for (let h = 1; h <= NORM_HARMONICS; h += 1) reference += ref[h]!;
  }
  return reference;
}

/** One-pole low-passed unit-variance noise: slow pitch drift. */
class Drift {
  private y = 0;
  private readonly a: number;
  private readonly g: number;
  constructor(
    private readonly rand: () => number,
    cutoffHz: number,
    controlRate: number,
  ) {
    this.a = Math.exp((-2 * Math.PI * cutoffHz) / controlRate);
    this.g = Math.sqrt(1 - this.a * this.a);
  }
  next(): number {
    this.y = this.a * this.y + this.g * gauss(this.rand);
    return this.y;
  }
}

type Source = Pick<SingSettings, "breath" | "jitter" | "shimmer" | "sub">;
type Shape = Pick<SingSettings, "ring" | "overtone">;

/** One glottis plus a vocal tract; `step` returns one sample. */
export class VoiceCore {
  private phase: number;
  private amp = 1;
  private periodScale = 1;
  private odd = false;
  private hp = 0;
  /** Smoothed loudness normalization; -1 until `aimLevel` first runs. */
  private level = -1;
  private levelTarget = 1;
  private readonly riseRate: number;
  private readonly fallRate: number;
  readonly tract = new Cascade();
  private readonly ringBand = new Bandpass();
  private readonly ot1 = new Bandpass();
  private readonly ot2 = new Bandpass();
  constructor(
    private readonly rand: () => number,
    private readonly sampleRate: number,
  ) {
    this.phase = rand();
    this.riseRate = 1 - Math.exp(-1 / (LEVEL_RISE_SECONDS * sampleRate));
    this.fallRate = 1 - Math.exp(-1 / (LEVEL_FALL_SECONDS * sampleRate));
  }
  setTract(formants: readonly Formant[], scale: number, ringHz: number): void {
    this.tract.set(formants, scale, this.sampleRate);
    this.ringBand.set(ringHz * scale, 400, this.sampleRate);
  }
  setOvertone(hz: number, bw: number): void {
    this.ot1.set(hz, bw, this.sampleRate);
    this.ot2.set(hz, bw, this.sampleRate);
  }
  /** Glottal source plus open-phase breath, before the tract. */
  source(f0: number, rd: number, s: Source): number {
    let src = 0;
    if (f0 > 0) {
      const inc = (f0 * this.periodScale) / this.sampleRate;
      this.phase += inc;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        // per-period perturbations (Klatt and Klatt 1990)
        this.periodScale = 1 + s.jitter * 0.01 * gauss(this.rand);
        this.amp = 1 + s.shimmer * 0.12 * gauss(this.rand);
        this.odd = !this.odd;
      }
      // kargyraa: alternate pulses weaker (period doubling, f0/2 appears)
      const alt = s.sub > 0 && this.odd ? 1 - 0.7 * s.sub : 1;
      src = glottal(this.phase, rd, inc) * this.amp * alt;
    }
    // Unit-variance uniform noise: as white as a Gaussian for aspiration
    // and a fifth of the cost (one draw, no log or trig per sample).
    const n = (this.rand() - 0.5) * SQRT12;
    const white = n - this.hp; // first difference: a bright aspiration
    this.hp = n;
    return (
      src + white * s.breath * 0.35 * (f0 > 0 ? openWeight(this.phase, rd) : 1)
    );
  }
  /**
   * Re-aims the loudness normalization at the current filters: the power
   * the tract, ring and overtone filters give the glottal source (`rd`)
   * at `f0`, against the reference source (Rd 1.3) through a flat
   * response. Narrow formants landing on or between harmonics swing
   * that power by 10 dB and more, so without this a vowel, a note or a
   * throat preset changes the level as much as velocity does.
   */
  aimLevel(
    f0: number,
    rd: number,
    s: Shape & Pick<SingSettings, "sub" | "jitter">,
  ): void {
    // With `sub`, every other pulse is weaker by `a`: a period of 2/f0 whose
    // lines at k f0/2 carry (1+a)/2 (even k) and (1-a)/2 (odd k).
    const a = s.sub > 0 ? 1 - 0.7 * s.sub : 1;
    const step = a < 1 ? 0.5 : 1;
    const top = Math.min(
      NORM_HARMONICS,
      Math.floor((0.45 * this.sampleRate) / f0),
    );
    if (!(f0 > 0) || top < 1) return;
    const source = glottalSpectrum(rd, NORM_HARMONICS);
    const spread = Math.max(0.006, s.jitter * 0.01);
    let power = 0;
    for (let h = step; h <= top; h += step) {
      const whole = Number.isInteger(h);
      const g = whole
        ? source[h]! * ((1 + a) / 2) ** 2
        : (h < 1 ? source[1]! : (source[h - 0.5]! + source[h + 0.5]!) / 2) *
          ((1 - a) / 2) ** 2;
      const w = (2 * Math.PI * h * f0) / this.sampleRate;
      // Jitter and drift smear each line over about +-spread; a narrow
      // overtone filter sees that average, not the exact harmonic.
      let r = 0;
      for (let k = 0; k < SMEAR.length; k += 1)
        r += SMEAR[k]! * this.responsePower(w * (1 + SMEAR_AT[k]! * spread), s);
      power += g * r;
    }
    this.levelTarget = Math.min(
      8,
      Math.max(0.001, Math.sqrt(referencePower() / power)),
    );
    if (this.level < 0) this.level = this.levelTarget;
  }
  /** |H|^2 of the tract, ring and overtone filters at `w` rad/sample. */
  private responsePower(w: number, s: Shape): number {
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const c2w = 2 * cw * cw - 1;
    const s2w = 2 * sw * cw;
    let re = 1;
    let im = 0;
    for (const r of this.tract.res) {
      const [hr, hi] = r.response(cw, sw, c2w, s2w);
      const nr = re * hr - im * hi;
      im = re * hi + im * hr;
      re = nr;
    }
    let addRe = 1;
    let addIm = 0;
    if (s.ring > 0) {
      const [rr, ri] = this.ringBand.response(cw, sw, c2w, s2w);
      addRe += rr * s.ring * 3;
      addIm += ri * s.ring * 3;
    }
    if (s.overtone > 0) {
      const [ar, ai] = this.ot1.response(cw, sw, c2w, s2w);
      const [br, bi] = this.ot2.response(cw, sw, c2w, s2w);
      addRe += (ar * br - ai * bi) * s.overtone * 40;
      addIm += (ar * bi + ai * br) * s.overtone * 40;
    }
    const yr = re * addRe - im * addIm;
    const yi = re * addIm + im * addRe;
    return yr * yr + yi * yi;
  }
  /** Tract, singer's formant and overtone filter (shared by a bucket). */
  shape(x: number, s: Shape): number {
    let y = this.tract.process(x);
    if (s.ring > 0) y += this.ringBand.process(y) * s.ring * 3;
    if (s.overtone > 0)
      y += this.ot2.process(this.ot1.process(y)) * s.overtone * 40;
    if (this.level < 0) return y;
    this.level +=
      (this.levelTarget - this.level) *
      (this.levelTarget > this.level ? this.riseRate : this.fallRate);
    return y * this.level;
  }
  step(f0: number, rd: number, s: Source & Shape): number {
    return this.shape(this.source(f0, rd, s), s);
  }
}

/** Raised-cosine attack, smoothstep release at `t` s of a `len` s note. */
function envelope(
  t: number,
  len: number,
  attack: number,
  release: number,
): number {
  if (t < 0) return 0;
  const a = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
  const r = t > len ? Math.max(0, 1 - (t - len) / release) : 1;
  return a * (r * r * (3 - 2 * r));
}

/**
 * The harmonic of `droneHz` a melody note selects: the note is
 * octave-folded into the [lo, hi] harmonic band (the octave inside the band
 * nearest the written pitch, else the nearest band edge), then rounded, so
 * any melody in any register maps by pitch class.
 */
export function overtoneFor(
  noteHz: number,
  droneHz: number,
  lo: number,
  hi: number,
): number {
  const bandLo = Math.log2(lo * droneHz);
  const bandHi = Math.log2(hi * droneHz);
  const x = Math.log2(noteHz);
  let best = x;
  let bestDist = Infinity;
  let bestShift = Infinity;
  for (let o = -10; o <= 10; o += 1) {
    const y = x + o;
    const dist = y < bandLo ? bandLo - y : y > bandHi ? y - bandHi : 0;
    if (
      dist < bestDist - 1e-9 ||
      (Math.abs(dist - bestDist) < 1e-9 && Math.abs(o) < bestShift)
    ) {
      best = y;
      bestDist = dist;
      bestShift = Math.abs(o);
    }
  }
  return Math.min(hi, Math.max(lo, Math.round(2 ** best / droneHz)));
}

/** The vowel a note sings: its own, then its lyric's, then the track's. */
export function noteVowel(
  note: Readonly<{ vowel?: string; lyric?: string }>,
  fallback: string,
): string {
  const spec = note.vowel ?? vowelOf(note.lyric) ?? fallback;
  try {
    const [a, b] = parseVowel(spec);
    return b ? `${a}>${b}` : a;
  } catch {
    return fallback;
  }
}

/**
 * Melisma: a note whose lyric is `_` (the lyric grammar's hold) keeps
 * singing the vowel of the note before it, in time order.
 */
export function heldVowels(
  notes: readonly PerformedNote[],
  fallback: string,
): Map<PerformedNote, string> {
  const held = new Map<PerformedNote, string>();
  if (!notes.some((note) => note.lyric === "_")) return held;
  const ordered = [...notes].sort(
    (a, b) => a.startTick - b.startTick || b.pitch - a.pitch,
  );
  let last = fallback;
  for (const note of ordered) {
    if (note.lyric === "_" && note.vowel === undefined) held.set(note, last);
    else last = noteVowel(note, fallback);
  }
  return held;
}

function ringHzOf(voice: VoiceType): number {
  return voice === "soprano" || voice === "alto" ? 3100 : 2800;
}

type Lanes = Map<string, readonly AutomationPoint[]>;

function lanesOf(track: Track): Lanes {
  const lanes: Lanes = new Map();
  const all = track.fxAutomation as
    Readonly<Record<string, readonly AutomationPoint[]>> | undefined;
  if (!all) return lanes;
  for (const { param } of SING_LANE_PARAMS) {
    const points = all[`sing-${param}`];
    if (points && points.length > 0) lanes.set(param, points);
  }
  return lanes;
}

/** Mutable per-tick settings: the resolved values with lanes applied. */
type Live = {
  -readonly [K in keyof SingSettings]: SingSettings[K];
};

type Segment = { at: number; end: number; hz: number; vowel: string };

type Planned = {
  start: number;
  length: number;
  head: PerformedNote;
  segments: Segment[];
  steal: number;
};

/** Everything a render shares across lines. */
type Setup = {
  s: SingSettings;
  lanes: Lanes;
  sampleRate: number;
  samples: number;
  tickAt: (index: number) => number;
  gainAt: (index: number) => number;
  seedTick: number;
};

/** Applies the automation lanes at sample `index` onto `live`. */
function applyLanes(live: Live, setup: Setup, index: number): void {
  if (setup.lanes.size === 0) return;
  const tick = setup.tickAt(index);
  for (const [param, points] of setup.lanes)
    (live as Record<string, unknown>)[param] = interpolateAutomation(
      points,
      tick,
      setup.s[param as keyof SingSettings] as number,
    );
}

/** The ensemble member count a line may use under the per-track cap. */
export function singMembers(voices: number): number {
  const v = Math.max(1, Math.round(voices));
  return Math.max(1, Math.min(v, SCORE_LIMITS.singVoicesPerTrack));
}

/** Lines that may sound at once for `members` singers each. */
function lineCap(members: number): number {
  return Math.max(
    1,
    Math.min(
      MAX_SING_LINES,
      Math.floor(SCORE_LIMITS.singVoicesPerTrack / members),
    ),
  );
}

/**
 * Renders one line (a note or a slurred chain) with `members` singers,
 * into `left` (and `right` when stereo).
 */
function renderLine(
  line: Planned,
  setup: Setup,
  left: Float64Array,
  right: Float64Array | undefined,
): void {
  const { s, sampleRate, samples } = setup;
  const head = line.head;
  const seed = `${head.id}:${head.startTick + setup.seedTick}`;
  const voice: VoiceType =
    s.voice === "auto" ? autoVoice(head.pitch) : (s.voice as VoiceType);
  const ringHz = ringHzOf(voice);
  const lengthSec = line.length / sampleRate;
  const members = singMembers(s.voices);
  const ens = members > 1;
  const buckets = ens ? 2 : 0;
  const level = s.gain / Math.sqrt(members);
  const baseRd = 2.5 - 2 * s.bright;
  const push = PUSH[head.articulation ?? ""] ?? 0;
  const bend = head.performance?.cents;
  const ownVibrato = head.performance?.replaceVibrato === true;
  const damp = head.performance?.damp;
  const releaseFrames = Math.ceil((s.release + 0.03) * sampleRate);
  const lineEnd = Math.min(
    samples,
    line.start + line.length + releaseFrames + Math.ceil(0.03 * sampleRate),
    line.steal + Math.round(STEAL_FADE_SECONDS * sampleRate),
  );
  if (lineEnd <= line.start) return;
  const frames = lineEnd - line.start;
  const stealFade = Math.max(1, Math.round(STEAL_FADE_SECONDS * sampleRate));
  const slur = Math.exp(-SING_CONTROL / (SLUR_SECONDS * sampleRate));
  const segmentAt = (offset: number): Segment => {
    let k = 0;
    while (k + 1 < line.segments.length && line.segments[k + 1]!.at <= offset)
      k += 1;
    return line.segments[k]!;
  };
  const vowelTable = (
    offset: number,
    live: Live,
    scale: number,
    hz: number,
  ) => {
    const seg = segmentAt(offset);
    const len = Math.max(1, seg.end - seg.at);
    const t = (Math.min(offset, seg.end) - seg.at) / len;
    return tuneToPitch(vowelAt(voice, seg.vowel, t * live.morph), hz, scale);
  };

  // Shared tracts: one per bucket, fed by the sum of its members' sources.
  const shared: {
    core: VoiceCore;
    st: number;
    buf: Float64Array;
    pan: number;
  }[] = [];
  const panRandom = seededRandom(`${seed}:pan`);
  const width = (0.35 * (members - 1)) / 7;
  for (let b = 0; b < buckets; b += 1) {
    const st = -0.3 + (0.6 * b) / (buckets - 1);
    shared.push({
      core: new VoiceCore(seededRandom(`${seed}:bucket:${b}`), sampleRate),
      st,
      buf: new Float64Array(frames),
      pan: (b === 0 ? -1 : 1) * width * (0.6 + 0.4 * panRandom()),
    });
  }
  const live: Live = { ...s };
  for (let m = 0; m < members; m += 1) {
    const rand = seededRandom(m === 0 ? seed : `${seed}:${m}`);
    const core = new VoiceCore(rand, sampleRate);
    const detune = ens ? gauss(rand) * s.spread * 0.5 : 0;
    const late = ens ? Math.round(rand() * 0.03 * sampleRate) : 0;
    const vibRate = s.vib * (ens ? 1 + 0.08 * gauss(rand) : 1);
    const vibPhase = ens ? rand() * 2 * Math.PI : 0;
    const memberSt = ens ? gauss(rand) * 0.4 : 0;
    const drift = new Drift(rand, 0.8, sampleRate / SING_CONTROL);
    // Slow drift (0.8 Hz) is part of a solo voice's unsteadiness, so it
    // scales with jitter (3 cents at the default 0.3; jitter 0 is a still
    // voice that holds its pitch); a choir always scatters by 6.
    const driftCents = ens ? 6 : 3 * Math.min(1, s.jitter / 0.3);
    const bucket = buckets > 0 ? shared[m % buckets] : undefined;
    let ratio = 1;
    let hz = line.segments[0]!.hz;
    let rd = baseRd;
    for (let j = late; j < frames; j += 1) {
      const offset = j - late;
      const index = line.start + j;
      if (offset % SING_CONTROL === 0) {
        applyLanes(live, setup, index);
        const t = offset / sampleRate;
        const seg = segmentAt(offset);
        hz = offset === 0 ? seg.hz : seg.hz + (hz - seg.hz) * slur;
        const scale = 2 ** ((live.formant + memberSt) / 12);
        if (!bucket)
          core.setTract(vowelTable(offset, live, scale, hz), scale, ringHz);
        // A note's own vibrato (performance.cents) replaces the voice's.
        const vibDepth = ownVibrato
          ? 0
          : live.vibmod *
            100 *
            Math.min(1, Math.max(0, (t - s.vibdelay) / 0.3));
        const cents =
          detune +
          vibDepth * Math.sin(2 * Math.PI * vibRate * t + vibPhase) +
          drift.next() * driftCents +
          (bend ? bend(t) : 0);
        ratio = 2 ** (cents / 1200);
        rd = Math.min(
          2.7,
          Math.max(
            0.3,
            2.5 - 2 * live.bright - 1.2 * (head.velocity - 0.6) - push,
          ),
        );
        if (!bucket && offset % (SING_CONTROL * NORM_EVERY) === 0)
          core.aimLevel(hz, rd, live);
      }
      let g =
        level *
        head.velocity *
        envelope(offset / sampleRate, lengthSec, s.attack, s.release);
      // Half pedal: the level fades from damp.from with time constant tau.
      if (damp && offset / sampleRate > damp.from)
        g *= Math.exp(-(offset / sampleRate - damp.from) / damp.tau);
      if (index >= line.steal)
        g *=
          index - line.steal >= stealFade
            ? 0
            : 0.5 +
              0.5 * Math.cos((Math.PI * (index - line.steal)) / stealFade);
      if (bucket)
        bucket.buf[j] = bucket.buf[j]! + core.source(hz * ratio, rd, live) * g;
      else {
        const y = core.step(hz * ratio, rd, live) * g * setup.gainAt(index);
        left[index] = left[index]! + y;
        if (right) right[index] = right[index]! + y;
      }
    }
  }
  let hz = line.segments[0]!.hz;
  for (const b of shared) {
    const pl = Math.cos(((b.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const pr = Math.sin(((b.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    hz = line.segments[0]!.hz;
    for (let j = 0; j < frames; j += 1) {
      const index = line.start + j;
      if (j % SING_CONTROL === 0) {
        applyLanes(live, setup, index);
        const seg = segmentAt(j);
        hz = j === 0 ? seg.hz : seg.hz + (hz - seg.hz) * slur;
        const scale = 2 ** ((live.formant + b.st) / 12);
        b.core.setTract(vowelTable(j, live, scale, hz), scale, ringHz);
        if (j % (SING_CONTROL * NORM_EVERY) === 0) {
          const rd = Math.min(
            2.7,
            Math.max(
              0.3,
              2.5 - 2 * live.bright - 1.2 * (head.velocity - 0.6) - push,
            ),
          );
          b.core.aimLevel(hz, rd, live);
        }
      }
      const y = b.core.shape(b.buf[j]!, live) * setup.gainAt(index);
      if (right) {
        left[index] = left[index]! + y * pl;
        right[index] = right[index]! + y * pr;
      } else left[index] = left[index]! + y;
    }
  }
}

/**
 * Throat singing: each phrase (notes closer than a quarter second) is one
 * drone voice from its first note to its last; each note steers the
 * overtone filter (and F2) to its octave-folded harmonic of the drone.
 */
function renderThroat(
  lines: readonly Planned[],
  setup: Setup,
  context: EngineContext,
  left: Float64Array,
): void {
  const { s, sampleRate, samples } = setup;
  if (lines.length === 0 || s.drone === undefined) return;
  const droneHz = noteHz(s.drone, undefined, context.tuning);
  const voice: VoiceType =
    s.voice === "auto" ? autoVoice(s.drone) : (s.voice as VoiceType);
  const ringHz = ringHzOf(voice);
  const [lo, hi] = s.harmonics;
  const gap = Math.round(THROAT_GAP_SECONDS * sampleRate);
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  const phrases: Planned[][] = [];
  let phraseEnd = -Infinity;
  for (const line of sorted) {
    if (line.start > phraseEnd + gap) phrases.push([]);
    phrases[phrases.length - 1]!.push(line);
    phraseEnd = Math.max(phraseEnd, line.start + line.length);
  }
  const glide = Math.exp(-SING_CONTROL / (OVERTONE_GLIDE_SECONDS * sampleRate));
  for (const phrase of phrases) {
    const head = phrase[0]!.head;
    const seed = `${head.id}:${head.startTick + setup.seedTick}:throat`;
    const rand = seededRandom(seed);
    const core = new VoiceCore(rand, sampleRate);
    const drift = new Drift(rand, 0.5, sampleRate / SING_CONTROL);
    const start = phrase[0]!.start;
    const last = Math.max(...phrase.map((l) => l.start + l.length));
    const lengthSec = (last - start) / sampleRate;
    const end = Math.min(
      samples,
      last + Math.ceil((s.release + 0.03) * sampleRate),
    );
    const live: Live = { ...s };
    const velocity = Math.max(...phrase.map((l) => l.head.velocity));
    let target = droneHz * lo;
    let current = target;
    let ratio = 1;
    let rd = 2.5 - 2 * s.bright;
    let vowel = s.vowel;
    let k = 0;
    for (let i = start; i < end; i += 1) {
      if ((i - start) % SING_CONTROL === 0) {
        applyLanes(live, setup, i);
        while (k + 1 < phrase.length && phrase[k + 1]!.start <= i) k += 1;
        const line = phrase[k]!;
        if (i < line.start + line.length) {
          const seg =
            [...line.segments]
              .reverse()
              .find((sg) => sg.at <= i - line.start) ?? line.segments[0]!;
          target = overtoneFor(seg.hz, droneHz, lo, hi) * droneHz;
          vowel = seg.vowel;
        }
        current = target + (current - target) * glide;
        const scale = 2 ** (live.formant / 12);
        core.setTract(vowelAt(voice, vowel, 0), scale, ringHz);
        // F2 follows the selected overtone (merged F1/F2 resonance,
        // Bloothooft et al. 1992; Levin and Edgerton 1999).
        core.tract.res[1]!.set(current, 60, sampleRate);
        core.setOvertone(current, 8 + 30 * (1 - live.overtone));
        ratio = 2 ** ((drift.next() * 2) / 1200);
        rd = Math.min(
          2.7,
          Math.max(0.3, 2.5 - 2 * live.bright - 1.2 * (velocity - 0.6)),
        );
        if ((i - start) % (SING_CONTROL * NORM_EVERY) === 0)
          core.aimLevel(droneHz, rd, live);
      }
      const t = (i - start) / sampleRate;
      const y = core.step(droneHz * ratio, rd, live);
      left[i] =
        left[i]! +
        y *
          live.gain *
          velocity *
          envelope(t, lengthSec, s.attack, s.release) *
          setup.gainAt(i);
    }
  }
}

let horizon = Infinity;
/**
 * Runs `render` with sing voices computed only up to `frames` (silent after).
 * The live first window needs 0.75 s but the renderer's shortest one-shot
 * is 1 s: a quarter of the ensemble cost was spent on audio that is cut.
 * Every voice is causal, so the frames kept are the full render's prefix.
 */
export function withSingHorizon<T>(frames: number, render: () => T): T {
  const previous = horizon;
  horizon = Math.max(1, Math.floor(frames));
  try {
    return render();
  } finally {
    horizon = previous;
  }
}

/**
 * Output trim that puts one sung note at velocity 0.8 on the same reference
 * as the other engines (about -18 LUFS, like `piano`), so a choir in a mix
 * sits beside the band instead of 15 dB over it and into the clip.
 */
export const SING_OUTPUT_TRIM = 1.25;

/** Renders a sing track's performed notes into `dry` (and `dryR`). */
export function renderSingTrack(
  dry: Float64Array,
  dryR: Float64Array | undefined,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const { sampleRate, samples } = context;
  const keyRoot = parseKey(context.score.key ?? undefined)?.tonic;
  const s = resolveSing(track.sing, keyRoot);
  const tickAt = (index: number): number =>
    context.warp ? context.warp.tick(index) : index / context.samplesPerTick;
  const volumeLane = track.volumeAutomation ?? [];
  const volume = Math.max(0, Math.min(1, track.volume ?? 1));
  const gainAt = (index: number): number =>
    SING_OUTPUT_TRIM *
    volume *
    (volumeLane.length > 0
      ? interpolateAutomation(volumeLane, tickAt(index), 1)
      : 1);
  const setup: Setup = {
    s,
    lanes: lanesOf(track),
    sampleRate,
    samples: Math.min(samples, horizon),
    tickAt,
    gainAt,
    seedTick: context.seedTick ?? 0,
  };
  const throat = s.drone !== undefined;
  const melisma = heldVowels(notes, s.vowel);
  const lines = windLines(notes, context, track.glide === undefined);
  const planned: Planned[] = lines.map((line) => ({
    start: line.start,
    length: line.length,
    head: line.notes[0]!,
    steal: Infinity,
    segments: line.segments.map((seg, k) => ({
      at: seg.at,
      end:
        k + 1 < line.segments.length ? line.segments[k + 1]!.at : line.length,
      hz: seg.hz,
      vowel: ((note) => melisma.get(note) ?? noteVowel(note, s.vowel))(
        line.notes[k] ?? line.notes[0]!,
      ),
    })),
  }));
  if (throat) {
    renderThroat(planned, setup, context, dry);
  } else {
    const cap = lineCap(singMembers(s.voices));
    const sounding: Planned[] = [];
    const tail = Math.ceil((s.release + 0.03) * sampleRate);
    for (const entry of [...planned].sort((a, b) => a.start - b.start)) {
      for (let k = sounding.length - 1; k >= 0; k -= 1) {
        const other = sounding[k]!;
        if (
          Math.min(other.steal, other.start + other.length + tail) <=
          entry.start
        )
          sounding.splice(k, 1);
      }
      while (sounding.length >= cap) sounding.shift()!.steal = entry.start;
      sounding.push(entry);
    }
    for (const line of planned) renderLine(line, setup, dry, dryR);
  }
  // The modal engine's soft knee keeps chords from clipping; causal and
  // stateless, so window renders stay exact prefixes.
  applyModalKnee(dry, samples);
  if (dryR) applyModalKnee(dryR, samples);
}

/** Whether a sing track renders stereo (an ensemble outside throat mode). */
export function singStereo(track: Track): boolean {
  const s = resolveSing(track.sing);
  return s.drone === undefined && singMembers(s.voices) > 1;
}

/** The sing engine as registered in `src/audio/instruments.ts`. */
export const SING_ENGINE: InstrumentEngine = Object.freeze({
  id: "sing",
  field: "sing",
  render(dry, dryR, notes, track, context) {
    renderSingTrack(dry, dryR, notes, track, context);
  },
  tailSeconds: (track: Track) => singTailSeconds(track.sing),
  releaseSeconds: (track: Track) => resolveSing(track.sing).release,
  stereo: singStereo,
  assetDigests: (track: Track) => [
    `sing:${SING_VERSION}:${singPresetOf(track.sing)}`,
  ],
});
