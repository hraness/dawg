/**
 * Filter stages: the track filter (`track.filter`, lpf/hpf/bpf with 12db,
 * 24db or ladder slope), the one-knob DJ filter, the LFO auto filter and the
 * vowel formant bank. All run on the mono track signal before pan.
 */
import { SCORE_LIMITS, type Track } from "../../../core/score.ts";
import type { FxValues } from "../../../core/fx.ts";
import { morphFormants, VOWEL_FORMANTS } from "../dsp/formant.ts";
import {
  Biquad,
  CONTROL_SAMPLES,
  OnePole,
  Phasor,
  clamp,
  fxReader,
  interpolateAutomation,
  lfo,
  lfoHz,
  tempoAtSample,
  resonanceQ,
  tickAtSample,
  type EffectContext,
  type FilterType,
} from "./common.ts";

/** Butterworth stage Qs for a 4-pole response; the second carries resonance. */
const BUTTERWORTH_Q1 = 0.5412;
const BUTTERWORTH_Q2_SCALE = 1.3066 / 0.707;

/**
 * A filter of any type and slope whose cutoff and resonance may change at
 * control rate. `12db` is exactly the original track filter (one RBJ
 * biquad), so documents without `type`/`ftype` render unchanged.
 */
export class SlopeFilter {
  private readonly first = new Biquad();
  private readonly second = new Biquad();
  private readonly ladder = new Float64Array(4);
  private ladderG = 0;
  private ladderK = 0;

  constructor(
    private readonly type: FilterType,
    private readonly slope: string,
    private readonly sampleRate: number,
  ) {}

  private get isLadder(): boolean {
    return this.slope === "ladder" && this.type === "lpf";
  }

  update(cutoff: number, resonance: number): void {
    if (this.isLadder) {
      const frequency = clamp(cutoff, 20, this.sampleRate * 0.45);
      this.ladderG = 1 - Math.exp((-2 * Math.PI * frequency) / this.sampleRate);
      this.ladderK = 3.9 * clamp(resonance, 0, 1);
      return;
    }
    if (this.slope === "12db") {
      this.first.set(this.type, cutoff, resonanceQ(resonance), this.sampleRate);
      return;
    }
    this.first.set(this.type, cutoff, BUTTERWORTH_Q1, this.sampleRate);
    this.second.set(
      this.type,
      cutoff,
      resonanceQ(resonance) * BUTTERWORTH_Q2_SCALE,
      this.sampleRate,
    );
  }

  process(input: number): number {
    if (this.isLadder) {
      // Four one-pole stages with a saturated global feedback path
      // (Moog-style ladder after Stilson & Smith / Huovilainen).
      const stages = this.ladder;
      const g = this.ladderG;
      const k = this.ladderK;
      const driven = Math.tanh(input - k * stages[3]!);
      stages[0]! += g * (driven - stages[0]!);
      stages[1]! += g * (stages[0]! - stages[1]!);
      stages[2]! += g * (stages[1]! - stages[2]!);
      stages[3]! += g * (stages[2]! - stages[3]!);
      return stages[3]! * (1 + 0.5 * k);
    }
    const once = this.first.process(input);
    return this.slope === "12db" ? once : this.second.process(once);
  }
}

/**
 * The track filter with static or automated cutoff and resonance (lanes
 * `filter` and `resonance`). A lane alone, with no static filter, filters
 * from a fully open low-pass, as the original renderer did.
 */
export function applyTrackFilter(
  buffer: Float64Array,
  track: Track,
  context: EffectContext,
): void {
  const automation = track.filterAutomation ?? [];
  const resonanceLane = track.resonanceAutomation ?? [];
  if (!track.filter && automation.length === 0 && resonanceLane.length === 0)
    return;
  const { sampleRate } = context;
  const staticCutoff = track.filter?.cutoff ?? SCORE_LIMITS.maxFilterCutoff;
  const staticResonance = track.filter?.resonance ?? 0;
  const automated = automation.length > 0 || resonanceLane.length > 0;
  const filter = new SlopeFilter(
    track.filter?.type ?? "lpf",
    track.filter?.ftype ?? "12db",
    sampleRate,
  );
  filter.update(staticCutoff, staticResonance);
  for (let index = 0; index < buffer.length; index += 1) {
    if (automated && index % CONTROL_SAMPLES === 0) {
      const tick = tickAtSample(context, index);
      filter.update(
        interpolateAutomation(automation, tick, staticCutoff),
        interpolateAutomation(resonanceLane, tick, staticResonance),
      );
    }
    buffer[index] = filter.process(buffer[index]!);
  }
}

/** Cutoff for a DJ-filter position: 0 → 20 Hz low-pass … 1 → 20 kHz high-pass. */
function djCutoff(value: number): { type: FilterType; cutoff: number } {
  return value < 0.5
    ? { type: "lpf", cutoff: 20 * 1000 ** (value / 0.5) }
    : { type: "hpf", cutoff: 20 * 1000 ** ((value - 0.5) / 0.5) };
}

/**
 * One-knob DJ filter (Strudel `djf`): below 0.5 a low-pass closes toward
 * 20 Hz, above 0.5 a high-pass rises toward 20 kHz; 0.5 passes unchanged.
 */
export function applyDjFilter(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const value = fxReader(track, "djf", values, context).param("value");
  const lowpass = new Biquad();
  const highpass = new Biquad();
  let position = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      const next = value.at(index);
      if (next !== position) {
        position = next;
        const { type, cutoff } = djCutoff(position);
        // Both filters stay warm so sweeping across 0.5 never clicks.
        lowpass.set(
          "lpf",
          type === "lpf" ? cutoff : 20_000,
          0.8,
          context.sampleRate,
        );
        highpass.set(
          "hpf",
          type === "hpf" ? cutoff : 20,
          0.8,
          context.sampleRate,
        );
      }
    }
    buffer[index] = highpass.process(lowpass.process(buffer[index]!));
  }
}

/**
 * Auto filter: an LFO sweeps the cutoff `depth` octaves around `cutoff`
 * (half above, half below). `follow` adds an envelope follower that moves
 * the cutoff by up to `follow` octaves at full input level.
 */
export function applyAutoFilter(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "autofilter", values, context);
  const cutoff = read.param("cutoff");
  const resonance = read.param("resonance");
  const depth = read.param("depth");
  const follow = read.param("follow");
  const rate = read.param("rate");
  const sync = read.number("sync");
  const shape = read.text("shape");
  const filter = new SlopeFilter(
    read.text("type") as FilterType,
    "12db",
    context.sampleRate,
  );
  const phasor = new Phasor(read.number("phase"));
  const attack = Math.exp(-1 / (0.005 * context.sampleRate));
  const release = Math.exp(-1 / (0.12 * context.sampleRate));
  let envelope = 0;
  let followOctaves = follow.at(0);
  for (let index = 0; index < buffer.length; index += 1) {
    const input = buffer[index]!;
    const level = Math.abs(input);
    envelope =
      level > envelope
        ? attack * envelope + (1 - attack) * level
        : release * envelope + (1 - release) * level;
    if (index % CONTROL_SAMPLES === 0) {
      phasor.setHz(
        lfoHz(sync, rate.at(index), tempoAtSample(context, index)),
        context.sampleRate,
      );
      followOctaves = follow.at(index);
      const sweep = lfo(shape, phasor.phase, 0x5eed) * depth.at(index) * 0.5;
      const envelopeOctaves = followOctaves * Math.min(1, envelope * 2);
      filter.update(
        cutoff.at(index) * 2 ** (sweep + envelopeOctaves),
        resonance.at(index),
      );
    }
    phasor.next();
    buffer[index] = filter.process(input);
  }
}

/** Gain that brings the summed formant bank near unity for speech-band input. */
const VOWEL_GAIN = 2.2;

/** Vowel formant filter (Strudel `vowel`): five parallel band-passes. */
export function applyVowel(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "vowel", values, context);
  const formants = VOWEL_FORMANTS[read.text("vowel")] ?? VOWEL_FORMANTS.a!;
  const mix = read.param("mix");
  const bank = formants.map(([frequency, level, bandwidth]) => {
    const filter = new Biquad();
    filter.set("bpf", frequency, frequency / bandwidth, context.sampleRate);
    return { filter, gain: 10 ** (level / 20) };
  });
  // 0.7 morph: present only with `to`; absent keeps the static bank exactly.
  const toName = values.to as string | undefined;
  const to = toName === undefined ? undefined : VOWEL_FORMANTS[toName];
  const morph =
    to && values.morph !== undefined ? read.param("morph") : undefined;
  const moving = morph !== undefined && (morph.automated || morph.fallback > 0);
  let at = -1;
  const retune = (position: number) => {
    if (position === at) return;
    at = position;
    morphFormants(formants, to!, position).forEach(
      ([frequency, level, bandwidth], index) => {
        const band = bank[index]!;
        band.filter.set(
          "bpf",
          frequency,
          frequency / bandwidth,
          context.sampleRate,
        );
        band.gain = 10 ** (level / 20);
      },
    );
  };
  if (moving) retune(morph.at(0));
  // Formant peaks are narrow; a gentle pre-emphasis keeps the vowel bright.
  const tilt = new OnePole(8000, context.sampleRate);
  let wet = mix.at(0);
  for (let index = 0; index < buffer.length; index += 1) {
    if (mix.automated && index % CONTROL_SAMPLES === 0) wet = mix.at(index);
    if (moving && morph.automated && index % CONTROL_SAMPLES === 0)
      retune(morph.at(index));
    const input = buffer[index]!;
    const emphasized = input + 0.5 * (input - tilt.process(input));
    let sum = 0;
    for (const band of bank) sum += band.filter.process(emphasized) * band.gain;
    buffer[index] = input + (sum * VOWEL_GAIN - input) * wet;
  }
}
