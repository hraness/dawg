/**
 * The synth voice: renders one note of a track with `track.synth` (or a
 * sound only the voice knows, like `supersaw` or `white`) into the dry
 * buffer(s). Clean-room DSP from public documentation and standard
 * literature; parameter names and meanings follow Strudel's documentation.
 *
 * Signal path per note, per unison voice:
 *
 *   pitch (note · detune · vibrato · pitch envelope)
 *     → oscillator (resolveOscillator; phase-modulated by FM operators)
 *     → + pink noise (`noise`)
 *   summed over unison voices (panned by `spread` when stereo)
 *     → lpf → hpf → bpf (per note, each with its own envelope)
 *     → amplitude ADSR · velocity · gain · track volume
 *
 * Controls are read once at the note onset (stored value, or the
 * `synth-<param>` lane at that tick); envelopes and LFOs run per sample,
 * filter coefficients every CONTROL_SAMPLES. Everything is a pure function
 * of the score and the note, so cold, cached and worker renders agree.
 */
import type { Note, Track } from "../../../core/score.ts";
import type { PerformedNote } from "../../../core/expression.ts";
import type { FxLane } from "../../../core/fx.ts";
import {
  LEGACY_SOUNDS,
  SOUND_ALIASES,
  SYNTH_PARAMS,
  FM_OPERATORS,
  type TrackSynth,
} from "../../../core/synth.ts";
import {
  Biquad,
  CONTROL_SAMPLES,
  clamp,
  interpolateAutomation,
} from "../effects/common.ts";
import { seededRandom } from "../random.ts";
import { isZzfxSound, renderZzfx } from "./zzfx.ts";
import {
  makePinkNoise,
  resolveOscillator,
  type Oscillator,
  type OscillatorFactory,
} from "./oscillators.ts";

/** Same base level as the legacy voice, so switching keeps loudness. */
const VOICE_LEVEL = 0.28;
const NOISE_SOUNDS = new Set(["white", "pink", "brown", "crackle"]);

/** Stored instrument name for a Strudel spelling (`sawtooth`, `sin`, …). */
export function canonicalSound(instrument: string): string {
  const name = instrument.trim().toLowerCase();
  return SOUND_ALIASES[name] ?? name;
}

/**
 * Whether a track renders through this voice: it sets `synth`, or its
 * instrument is a sound the legacy voice never had (supersaw, pulse,
 * noise, user, or one added through `registerOscillatorResolver`).
 * Tracks without `synth` on a legacy name keep the original voice and
 * render byte-identically.
 */
export function usesSynthVoice(track: Track | undefined): boolean {
  if (!track) return false;
  if (track.synth) return true;
  const sound = canonicalSound(track.instrument);
  if ((LEGACY_SOUNDS as readonly string[]).includes(sound)) return false;
  return resolveOscillator(sound) !== undefined;
}

export type VoiceContext = Readonly<{
  sampleRate: number;
  samples: number;
  samplesPerTick: number;
  tempoBpm: number;
  ticksPerBeat: number;
  /**
   * Wavetable hook: a note's oscillator when the track supplies its own
   * (a wavetable track's table); otherwise the sound's resolver is used.
   */
  oscillatorFor?: (note: Note) => OscillatorFactory | undefined;
}>;

/** Track gain at a tick (volume × volume lane), supplied by the renderer. */
export type GainAt = (tick: number) => number;

/** Reads every control at one note's onset. */
function controls(track: Track, tick: number) {
  const synth: TrackSynth = track.synth ?? {};
  const lanes = track.fxAutomation;
  const lane = (name: string) => lanes?.[`synth-${name}` as FxLane];
  const has = (name: string): boolean =>
    synth[name] !== undefined || (lane(name)?.length ?? 0) > 0;
  const number = (name: string, fallback?: number): number => {
    const stored = synth[name];
    const base =
      typeof stored === "number"
        ? stored
        : (fallback ?? (SYNTH_PARAMS[name]!.default as number));
    const points = lane(name);
    return points && points.length > 0
      ? interpolateAutomation(points, tick, base)
      : base;
  };
  const text = (name: string): string => {
    const stored = synth[name];
    return typeof stored === "string"
      ? stored
      : (SYNTH_PARAMS[name]!.default as string);
  };
  const list = (name: string): readonly number[] | undefined => {
    const stored = synth[name];
    return Array.isArray(stored) ? (stored as readonly number[]) : undefined;
  };
  return { has, number, text, list };
}

type Controls = ReturnType<typeof controls>;

/** Linear attack, linear decay to sustain, held until the gate closes. */
function attackDecay(t: number, a: number, d: number, s: number): number {
  if (t < a) return t / a;
  const u = t - a;
  if (u < d) return 1 - ((1 - s) * u) / d;
  return s;
}

/** An ADSR envelope; after the gate it releases linearly from its level. */
class Envelope {
  private readonly gateLevel: number;
  constructor(
    private readonly a: number,
    private readonly d: number,
    private readonly s: number,
    private readonly r: number,
    private readonly gate: number,
  ) {
    this.gateLevel = attackDecay(gate, a, d, s);
  }

  at(t: number): number {
    if (t < this.gate) return attackDecay(t, this.a, this.d, this.s);
    if (this.r <= 0) return 0;
    const u = t - this.gate;
    return u >= this.r ? 0 : this.gateLevel * (1 - u / this.r);
  }
}

function envelopeFor(
  c: Controls,
  prefix: string,
  suffix: string,
  gate: number,
): Envelope {
  return new Envelope(
    c.number(`${prefix}attack${suffix}`),
    c.number(`${prefix}decay${suffix}`),
    c.number(`${prefix}sustain${suffix}`),
    c.number(`${prefix}release${suffix}`),
    gate,
  );
}

/** Seconds a note sounds after its gate closes. */
export function releaseSeconds(track: Track, tick: number): number {
  return controls(track, tick).number("release");
}

/** Longest release across a track's synth controls and lanes. */
export function synthTailSeconds(track: Track): number {
  if (!usesSynthVoice(track)) return 0;
  const stored = track.synth?.release;
  let tail =
    typeof stored === "number"
      ? stored
      : (SYNTH_PARAMS.release!.default as number);
  for (const point of track.fxAutomation?.["synth-release" as FxLane] ?? [])
    tail = Math.max(tail, point.value);
  return tail;
}

const FILTERS = [
  { prefix: "lp", type: "lpf", param: "lpf" },
  { prefix: "hp", type: "hpf", param: "hpf" },
  { prefix: "bp", type: "bpf", param: "bpf" },
] as const;

const BUTTERWORTH_Q1 = 0.5412;
const BUTTERWORTH_Q2 = 1.3066;

/** One per-note filter with its envelope, for one channel. */
class NoteFilter {
  private readonly first = new Biquad();
  private readonly second = new Biquad();
  private readonly ladder = new Float64Array(4);
  private ladderG = 0;
  private ladderK = 0;

  constructor(
    readonly type: "lpf" | "hpf" | "bpf",
    readonly slope: string,
    readonly cutoff: number,
    readonly q: number,
    readonly depth: number,
    readonly anchor: number,
    readonly envelope: Envelope,
    private readonly sampleRate: number,
  ) {}

  private get isLadder(): boolean {
    return this.slope === "ladder" && this.type === "lpf";
  }

  /** Recompute coefficients for the envelope at time `t` (seconds). */
  update(t: number): void {
    const e = this.depth === 0 ? 0 : this.envelope.at(t);
    const frequency = clamp(
      this.cutoff * 2 ** (this.depth * (e - this.anchor)),
      20,
      this.sampleRate * 0.45,
    );
    const q = Math.max(0.1, this.q);
    if (this.isLadder) {
      this.ladderG = 1 - Math.exp((-2 * Math.PI * frequency) / this.sampleRate);
      // Q 0.7..12 spans the ladder's feedback up to just below oscillation.
      this.ladderK = 3.9 * clamp((q - 0.707) / 11.3, 0, 1);
      return;
    }
    if (this.slope === "24db") {
      this.first.set(this.type, frequency, BUTTERWORTH_Q1, this.sampleRate);
      this.second.set(
        this.type,
        frequency,
        (q * BUTTERWORTH_Q2) / 0.707,
        this.sampleRate,
      );
      return;
    }
    this.first.set(this.type, frequency, q, this.sampleRate);
  }

  process(input: number): number {
    if (this.isLadder) {
      const stages = this.ladder;
      const g = this.ladderG;
      const driven = Math.tanh(input - this.ladderK * stages[3]!);
      stages[0]! += g * (driven - stages[0]!);
      stages[1]! += g * (stages[0]! - stages[1]!);
      stages[2]! += g * (stages[1]! - stages[2]!);
      stages[3]! += g * (stages[2]! - stages[3]!);
      return stages[3]! * (1 + 0.5 * this.ladderK);
    }
    const once = this.first.process(input);
    return this.slope === "24db" ? this.second.process(once) : once;
  }
}

function noteFilters(
  c: Controls,
  gate: number,
  sampleRate: number,
  accent = false,
): (() => NoteFilter)[] {
  const out: (() => NoteFilter)[] = [];
  for (const { prefix, type, param } of FILTERS) {
    const written = c.number(`${prefix}env`);
    if (!c.has(param) && written === 0) continue;
    // TB-303 accent: an accented note opens the low-pass further and its
    // filter envelope decays faster.
    const boost = accent && prefix === "lp" ? c.number("faccent") : 0;
    const depth = written + boost;
    const cutoff = c.number(param);
    const q = c.number(`${prefix}q`);
    const slope = type === "lpf" ? c.text("ftype") : "12db";
    const anchor = c.number("fanchor");
    out.push(
      () =>
        new NoteFilter(
          type,
          slope,
          cutoff,
          q,
          depth,
          anchor,
          boost > 0
            ? new Envelope(
                c.number(`${prefix}attack`),
                c.number(`${prefix}decay`) / 2,
                c.number(`${prefix}sustain`),
                c.number(`${prefix}release`),
                gate,
              )
            : envelopeFor(c, prefix, "", gate),
          sampleRate,
        ),
    );
  }
  return out;
}

type FmOperator = Readonly<{
  index: number;
  ratio: number;
  envelope: Envelope;
  exp: boolean;
  wave: string;
}>;

function fmOperators(c: Controls, gate: number): FmOperator[] {
  const out: FmOperator[] = [];
  for (let op = 1; op <= FM_OPERATORS; op += 1) {
    const n = op === 1 ? "" : String(op);
    const index = c.number(`fm${n}`);
    if (index <= 0) continue;
    out.push({
      index,
      ratio: c.number(`fmh${n}`),
      envelope: envelopeFor(c, "fm", n, gate),
      exp: c.text(`fmenv${n}`) === "exp",
      wave: c.text(`fmwave${n}`),
    });
  }
  return out;
}

/** A naive (unaliased-enough at modulator rates) waveform for FM. */
function modulatorWave(wave: string, phase: number): number {
  const t = phase - Math.floor(phase);
  if (wave === "sawtooth") return 2 * t - 1;
  if (wave === "square") return t < 0.5 ? 1 : -1;
  if (wave === "triangle") return 1 - 4 * Math.abs(t - 0.5);
  return Math.sin(2 * Math.PI * phase);
}

/**
 * Render one note. `left` always receives the voice; `right` is given
 * only for stereo tracks (unison spread), in which case `left`/`right`
 * hold the two channels before the (dual-mono) track chain.
 */
export function renderSynthNote(
  left: Float64Array,
  right: Float64Array | undefined,
  note: Note,
  track: Track,
  start: number,
  length: number,
  context: VoiceContext,
  gainAt: GainAt,
): void {
  const { sampleRate, samples, samplesPerTick } = context;
  const c = controls(track, note.startTick);
  const sound = canonicalSound(track.instrument);
  const gate = length / sampleRate;
  const release = Math.max(0, c.number("release"));
  const end = Math.min(
    samples,
    start + length + Math.ceil(release * sampleRate),
  );
  if (end <= start) return;
  const random = seededRandom(`${note.id}:${note.startTick}:synth`);
  const amp = envelopeFor(c, "", "", gate);
  const velocity = clamp(note.velocity, 0, 1);
  const gain = c.number("gain");
  // Note expression (core/expression.ts): absent for plain notes, which
  // keeps their output byte-identical.
  const performance = (note as PerformedNote).performance;
  const cents = performance?.cents;
  const damp = performance?.damp;
  const dampAt = (t: number): number =>
    damp && t > damp.from ? Math.exp(-(t - damp.from) / damp.tau) : 1;

  // Pitch.
  const base = 440 * 2 ** ((note.pitch - 69) / 12);

  if (isZzfxSound(sound) && !context.oscillatorFor) {
    const count = end - start;
    const raw = new Float64Array(count);
    renderZzfx(raw, count, {
      sound,
      sampleRate,
      frequency: base,
      zrand: c.number("zrand"),
      curve: c.number("curve"),
      slide: c.number("slide"),
      deltaSlide: c.number("deltaSlide"),
      pitchJump: c.number("pitchJump"),
      pitchJumpTime: c.number("pitchJumpTime"),
      lfo: c.number("lfo"),
      noise: c.number("noise"),
      zmod: c.number("zmod"),
      zcrush: c.number("zcrush"),
      zdelay: c.number("zdelay"),
      tremolo: c.number("tremolo"),
      random,
      ...(cents ? { cents } : {}),
      ...(performance?.replaceSlide ? { slideOff: true } : {}),
    });
    const filters = noteFilters(
      c,
      gate,
      sampleRate,
      performance?.accent === true,
    ).map((make) => make());
    for (let elapsed = 0; elapsed < count; elapsed += 1) {
      const t = elapsed / sampleRate;
      if (elapsed % CONTROL_SAMPLES === 0)
        for (const filter of filters) filter.update(t);
      let value = raw[elapsed]!;
      for (const filter of filters) value = filter.process(value);
      let level =
        amp.at(t) *
        velocity *
        gain *
        VOICE_LEVEL *
        gainAt(note.startTick + elapsed / samplesPerTick);
      if (damp) level *= dampAt(t);
      left[start + elapsed]! += value * level;
      if (right) right[start + elapsed]! += value * level;
    }
    return;
  }
  // A note's own vibrato or bend replaces the synth's (note over track).
  const vib = performance?.replaceVibrato ? 0 : c.number("vib");
  const vibmod = c.number("vibmod");
  const penv = performance?.replacePitchEnvelope ? 0 : c.number("penv");
  const pitchEnv =
    penv === 0
      ? undefined
      : new Envelope(
          c.number("pattack"),
          c.number("pdecay"),
          c.number("psustain"),
          c.number("prelease"),
          gate,
        );
  const panchor = c.has("panchor") ? c.number("panchor") : c.number("psustain");
  const pcurve = c.number("pcurve");

  // Unison.
  const supersaw = sound === "supersaw";
  const unison = Math.max(
    1,
    Math.round(c.has("unison") ? c.number("unison") : supersaw ? 5 : 1),
  );
  const detune = c.number("detune");
  const spread = right ? c.number("spread") : 0;
  const voiceRatios: number[] = [];
  const voicePans: [number, number][] = [];
  const phases: number[] = [];
  for (let v = 0; v < unison; v += 1) {
    const position = unison === 1 ? 0 : v / (unison - 1) - 0.5;
    voiceRatios.push(2 ** ((detune * position) / 12));
    const pan = clamp(spread * position * 2, -1, 1);
    const theta = ((pan + 1) * Math.PI) / 4;
    // Equal-power, scaled so a centred voice gets 1 in each channel.
    voicePans.push([
      Math.cos(theta) * Math.SQRT2,
      Math.sin(theta) * Math.SQRT2,
    ]);
    phases.push(unison === 1 && !supersaw ? 0 : random());
  }
  const unisonGain = 1 / Math.sqrt(unison);

  // Oscillators (one per unison voice) through the seam.
  const factory =
    context.oscillatorFor?.(note) ??
    resolveOscillator(sound) ??
    resolveOscillator("sine")!;
  const pw = c.number("pw");
  const pwrate = c.number("pwrate");
  const pwsweep = c.number("pwsweep");
  let width = pw;
  const partials = c.list("partials");
  const phaseList = c.list("phases");
  let noteTime = 0;
  const oscillators: Oscillator[] = [];
  for (let v = 0; v < unison; v += 1)
    oscillators.push(
      factory({
        sound,
        sampleRate,
        random,
        ...(partials ? { partials } : {}),
        ...(phaseList ? { phases: phaseList } : {}),
        width: () => width,
        density: c.number("density"),
        param: (name) => track.synth?.[name],
        time: () => noteTime,
      }),
    );
  const noise = NOISE_SOUNDS.has(sound) ? 0 : c.number("noise");
  const pink = noise > 0 ? makePinkNoise(random) : undefined;

  const fm = fmOperators(c, gate);
  const fmPhases = fm.map(() => new Float64Array(unison));
  const filterMakers = noteFilters(
    c,
    gate,
    sampleRate,
    performance?.accent === true,
  );
  const filtersL = filterMakers.map((make) => make());
  const filtersR = right ? filterMakers.map((make) => make()) : [];

  for (let index = start; index < end; index += 1) {
    const elapsed = index - start;
    const t = elapsed / sampleRate;
    noteTime = t;
    if (elapsed % CONTROL_SAMPLES === 0) {
      for (const filter of filtersL) filter.update(t);
      for (const filter of filtersR) filter.update(t);
    }
    // Instantaneous frequency multiplier from vibrato and pitch envelope.
    let semitones = 0;
    if (vib > 0) semitones += vibmod * Math.sin(2 * Math.PI * vib * t);
    if (pitchEnv) {
      let e = pitchEnv.at(t);
      if (pcurve >= 1) e = e * e * e;
      semitones += penv * (e - panchor);
    }
    if (cents) semitones += cents(t) / 100;
    const frequency = semitones === 0 ? base : base * 2 ** (semitones / 12);
    if (pwsweep > 0)
      width = clamp(
        pw + pwsweep * 0.5 * (1 - 4 * Math.abs(((pwrate * t) % 1) - 0.5)),
        0.01,
        0.99,
      );
    let sampleL = 0;
    let sampleR = 0;
    for (let v = 0; v < unison; v += 1) {
      const f = frequency * voiceRatios[v]!;
      const increment = f / sampleRate;
      let offset = 0;
      for (let op = 0; op < fm.length; op += 1) {
        const operator = fm[op]!;
        const modPhases = fmPhases[op]!;
        let e = operator.envelope.at(t);
        if (operator.exp) e *= e;
        offset +=
          (operator.index * e * modulatorWave(operator.wave, modPhases[v]!)) /
          (2 * Math.PI);
        modPhases[v] = modPhases[v]! + increment * operator.ratio;
      }
      const value = oscillators[v]!(phases[v]! + offset, increment);
      phases[v] = phases[v]! + increment;
      if (right) {
        sampleL += value * voicePans[v]![0];
        sampleR += value * voicePans[v]![1];
      } else sampleL += value;
    }
    sampleL *= unisonGain;
    sampleR *= unisonGain;
    if (pink) {
      const n = pink();
      sampleL = sampleL * (1 - noise) + n * noise;
      sampleR = sampleR * (1 - noise) + n * noise;
    }
    for (const filter of filtersL) sampleL = filter.process(sampleL);
    for (const filter of filtersR) sampleR = filter.process(sampleR);
    let level =
      amp.at(t) *
      velocity *
      gain *
      VOICE_LEVEL *
      gainAt(note.startTick + elapsed / samplesPerTick);
    if (damp) level *= dampAt(t);
    left[index]! += sampleL * level;
    if (right) right[index]! += sampleR * level;
  }
}

/** Whether a track's voice is stereo (unison voices spread apart). */
export function isStereoVoice(track: Track | undefined): boolean {
  if (!track || !usesSynthVoice(track)) return false;
  const c = controls(track, 0);
  const sound = canonicalSound(track.instrument);
  const unison = c.has("unison")
    ? c.number("unison")
    : sound === "supersaw"
      ? 5
      : 1;
  // Lanes may raise either at a later note, so check them too.
  const lanes = track.fxAutomation;
  const laneMax = (name: string) =>
    Math.max(
      0,
      ...(lanes?.[`synth-${name}` as FxLane] ?? []).map((p) => p.value),
    );
  const spread = Math.max(c.number("spread"), laneMax("spread"));
  return Math.max(unison, laneMax("unison")) > 1 && spread > 0;
}
