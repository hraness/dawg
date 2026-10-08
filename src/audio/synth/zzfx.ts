/**
 * ZzFX-style procedural voice for Strudel's `z_*` sounds (`z_sine`,
 * `z_triangle`, `z_sawtooth`, `z_square`, `z_tan`, `z_noise`).
 *
 * Clean-room: written from the public parameter descriptions on
 * strudel.cc/learn/synths ("ZZFX") and the published meaning of the ZzFX
 * controls, not from any implementation. Units are dawg's and documented
 * in DAWG.md "Synth":
 *
 *   frequency(t) = note · (1 ± zrand) + 500·slide·t + 250·deltaSlide·t²
 *                  (+ pitchJump Hz once t ≥ pitchJumpTime)
 *   `lfo` > 0 restarts slide and pitchJump every `lfo` seconds and sets
 *   the tremolo period; `zmod` is an FM rate in Hz (±50 % depth);
 *   `noise` jitters the phase increment; `curve` bends the wave
 *   (sign·|x|^curve; 0 squares it off); `zcrush` holds samples (0..1 →
 *   1..100 samples at 44.1 kHz); `zdelay` adds one echo `zdelay` seconds
 *   later at half level.
 *
 * Everything is a pure function of the note's parameters and its seeded
 * PRNG, so renders are deterministic.
 */
import { clamp } from "../effects/common.ts";

/** Strudel's ZzFX sound names. */
export const ZZFX_SOUNDS = Object.freeze([
  "z_sine",
  "z_triangle",
  "z_sawtooth",
  "z_square",
  "z_tan",
  "z_noise",
] as const);

export function isZzfxSound(sound: string): boolean {
  return (ZZFX_SOUNDS as readonly string[]).includes(sound);
}

export type ZzfxParams = Readonly<{
  sound: string;
  sampleRate: number;
  /** Note frequency in Hz. */
  frequency: number;
  zrand: number;
  curve: number;
  slide: number;
  deltaSlide: number;
  pitchJump: number;
  pitchJumpTime: number;
  lfo: number;
  noise: number;
  zmod: number;
  zcrush: number;
  zdelay: number;
  tremolo: number;
  random: () => number;
  /** Note expression: a pitch offset in cents at `t` seconds. */
  cents?: (t: number) => number;
  /** The note glides, so `slide` and `deltaSlide` are ignored. */
  slideOff?: boolean;
}>;

function wave(sound: string, phase: number, held: number): number {
  const p = phase - Math.floor(phase);
  switch (sound) {
    case "z_triangle":
      return 1 - 4 * Math.abs(p - 0.5);
    case "z_sawtooth":
      return 2 * p - 1;
    case "z_square":
      return p < 0.5 ? 1 : -1;
    case "z_tan":
      return clamp(Math.tan(Math.PI * p), -1, 1);
    case "z_noise":
      return held;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/**
 * Renders `count` samples of the raw voice (before the amplitude envelope,
 * which the caller applies) into `out`. Waves are deliberately naive, as
 * ZzFX's lo-fi character expects.
 */
export function renderZzfx(
  out: Float64Array,
  count: number,
  params: ZzfxParams,
): void {
  const { sampleRate, random } = params;
  const base = params.frequency * (1 + params.zrand * (random() * 2 - 1));
  const curve = Math.max(0, params.curve);
  const hold = Math.max(
    1,
    Math.round((1 + params.zcrush * 99) * (sampleRate / 44_100)),
  );
  let phase = 0;
  let held = random() * 2 - 1;
  let crushed = 0;
  let lastCycle = 0;
  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    // Slide and pitch jump restart every `lfo` seconds.
    const local = params.lfo > 0 ? t % params.lfo : t;
    let frequency = params.slideOff
      ? base
      : base +
        500 * params.slide * local +
        250 * params.deltaSlide * local * local;
    if (params.pitchJumpTime > 0 && local >= params.pitchJumpTime)
      frequency += params.pitchJump;
    if (params.zmod > 0)
      frequency *= 1 + 0.5 * Math.sin(2 * Math.PI * params.zmod * t);
    if (params.cents) frequency *= 2 ** (params.cents(t) / 1200);
    frequency = clamp(frequency, 0, sampleRate / 2);
    let increment = frequency / sampleRate;
    if (params.noise > 0) increment *= 1 + params.noise * (random() * 2 - 1);
    phase += increment;
    // Pitched noise: a new value every half cycle.
    const cycle = Math.floor(phase * 2);
    if (cycle !== lastCycle) {
      lastCycle = cycle;
      held = random() * 2 - 1;
    }
    let value = wave(params.sound, phase, held);
    if (curve !== 1)
      value =
        curve === 0
          ? Math.sign(value)
          : Math.sign(value) * Math.abs(value) ** curve;
    if (params.tremolo > 0 && params.lfo > 0)
      value *=
        1 -
        params.tremolo * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / params.lfo));
    if (index % hold === 0) crushed = value;
    out[index] = hold > 1 ? crushed : value;
  }
  if (params.zdelay > 0) {
    const lag = Math.round(params.zdelay * sampleRate);
    for (let index = count - 1; index >= lag; index -= 1)
      out[index] = out[index]! + 0.5 * out[index - lag]!;
  }
}
