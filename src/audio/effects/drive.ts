/**
 * Saturation stages on the mono track signal: bitcrush/coarse (sample-rate
 * and bit-depth reduction) and the distortion waveshaper.
 */
import type { Track } from "../../../core/score.ts";
import type { FxValues } from "../../../core/fx.ts";
import {
  CONTROL_SAMPLES,
  OnePole,
  clamp,
  fxReader,
  type EffectContext,
} from "./common.ts";

/**
 * Bitcrush: `coarse` holds every Nth sample (sample-rate reduction) and
 * `bits` quantizes to 2^(bits-1) levels per polarity. Fractional bits are
 * allowed so the amount can sweep smoothly.
 */
export function applyCrush(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "crush", values, context);
  const bits = read.param("bits");
  const mix = read.param("mix");
  const coarse = Math.max(1, Math.round(read.number("coarse")));
  let levels = 2 ** (bits.at(0) - 1);
  let wet = mix.at(0);
  let held = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      if (bits.automated) levels = 2 ** (bits.at(index) - 1);
      if (mix.automated) wet = mix.at(index);
    }
    const input = buffer[index]!;
    if (index % coarse === 0) held = input;
    const crushed = Math.round(held * levels) / levels;
    buffer[index] = input + (crushed - input) * wet;
  }
}

/** Waveshaper curves; each maps 0 → 0 and is odd unless noted. */
export function shapeCurve(type: string, x: number, amount: number): number {
  switch (type) {
    case "hard":
      return clamp(x, -1, 1);
    case "cubic": {
      const y = clamp(x, -1.5, 1.5);
      return y - (y * y * y) / 6.75;
    }
    case "diode":
      // Asymmetric: positive half saturates harder, like a forward-biased diode.
      return x >= 0 ? Math.tanh(1.5 * x) / 1.2 : Math.tanh(0.7 * x) / 0.85;
    case "asym":
      return Math.tanh(x + 0.3) - Math.tanh(0.3);
    case "fold": {
      // Triangle wavefolder: reflect at ±1.
      const folded = (((x + 1) % 4) + 4) % 4;
      return folded < 2 ? folded - 1 : 3 - folded;
    }
    case "sinefold":
      return Math.sin((Math.PI / 2) * x);
    case "chebyshev": {
      // T3 Chebyshev blended in: adds a strong third harmonic.
      const y = Math.tanh(x);
      return 0.6 * y + 0.4 * (4 * y * y * y - 3 * y);
    }
    case "scurve":
      return (2 / Math.PI) * Math.atan(x * 1.4);
    case "shape": {
      // Strudel `shape` amount 0..1 → k; the classic (1+k)x/(1+k|x|) shaper.
      const a = Math.min(0.99, amount);
      const k = (2 * a) / (1 - a);
      return ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    default:
      return Math.tanh(x);
  }
}

/** Reference level for automatic gain compensation (about -12 dBFS). */
const COMPENSATION_LEVEL = 0.25;
const COMPENSATION_RMS = COMPENSATION_LEVEL / Math.SQRT2;
const COMPENSATION_POINTS = 64;

/**
 * Distortion: pre-gain from `drive` (0..10 → 0..36 dB), the chosen curve,
 * gain compensation so louder drive does not mean a louder track, a
 * post-shaper `tone` low-pass, then `postgain` and the wet/dry `mix`.
 */
export function applyDistort(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "distort", values, context);
  const drive = read.param("drive");
  const tone = read.param("tone");
  const mix = read.param("mix");
  const type = read.text("type");
  const postgain = read.number("postgain");
  // `shape` takes the drive as its 0..1 amount; other curves use pre-gain.
  const setDrive = (value: number) => {
    const amount = value / 10;
    const pregain = type === "shape" ? 1 : 2 ** (value * 0.6);
    // RMS of the curve over one sine cycle at the reference level, so
    // folders (whose output is not monotonic in level) compensate too.
    let sum = 0;
    for (let k = 0; k < COMPENSATION_POINTS; k += 1) {
      const x =
        COMPENSATION_LEVEL * Math.sin((2 * Math.PI * k) / COMPENSATION_POINTS);
      sum += shapeCurve(type, pregain * x, amount) ** 2;
    }
    const reference = Math.sqrt(sum / COMPENSATION_POINTS);
    const compensation = clamp(
      COMPENSATION_RMS / Math.max(1e-3, reference),
      0.05,
      1.5,
    );
    return { amount, pregain, compensation };
  };
  let state = setDrive(drive.at(0));
  const lowpass = new OnePole(tone.at(0), context.sampleRate);
  let wet = mix.at(0);
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      if (drive.automated) state = setDrive(drive.at(index));
      if (tone.automated) lowpass.set(tone.at(index), context.sampleRate);
      if (mix.automated) wet = mix.at(index);
    }
    const input = buffer[index]!;
    const shaped =
      shapeCurve(type, input * state.pregain, state.amount) *
      state.compensation;
    const output = lowpass.process(shaped) * postgain;
    buffer[index] = input + (output - input) * wet;
  }
}
