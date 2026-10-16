/**
 * Three-band EQ (`fx.eq`): an RBJ low shelf, a peaking mid and a high shelf
 * on the mono track signal after the amp and cab. Bands at 0 dB are skipped,
 * so an EQ with only `high` set costs one biquad.
 */
import type { Track } from "../../../core/score.ts";
import type { FxValues } from "../../../core/fx.ts";
import {
  Biquad,
  CONTROL_SAMPLES,
  clamp,
  fxReader,
  type EffectContext,
} from "./common.ts";

type Band = "low" | "peak" | "high";

/** Shelf slope 1 (steepest without overshoot) and a ~1.5 octave peak. */
const SHELF_S = 1;
const PEAK_Q = 0.9;

/** RBJ cookbook shelf and peaking coefficients into a `Biquad`. */
export function setEqBand(
  filter: Biquad,
  band: Band,
  frequency: number,
  gainDb: number,
  sampleRate: number,
): void {
  const f = clamp(frequency, 20, sampleRate * 0.45);
  const a = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(omega);
  const sin = Math.sin(omega);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (band === "peak") {
    const alpha = sin / (2 * PEAK_Q);
    b0 = 1 + alpha * a;
    b1 = -2 * cos;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cos;
    a2 = 1 - alpha / a;
  } else {
    const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / SHELF_S - 1) + 2);
    const root = 2 * Math.sqrt(a) * alpha;
    const sign = band === "low" ? -1 : 1;
    b0 = a * (a + 1 + sign * (a - 1) * cos + root);
    b1 = -2 * sign * a * (a - 1 + sign * (a + 1) * cos);
    b2 = a * (a + 1 + sign * (a - 1) * cos - root);
    a0 = a + 1 - sign * (a - 1) * cos + root;
    a1 = 2 * sign * (a - 1 - sign * (a + 1) * cos);
    a2 = a + 1 - sign * (a - 1) * cos - root;
  }
  filter.b0 = b0 / a0;
  filter.b1 = b1 / a0;
  filter.b2 = b2 / a0;
  filter.a1 = a1 / a0;
  filter.a2 = a2 / a0;
}

export function applyEq(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "eq", values, context);
  const bands = [
    { band: "low", gain: read.param("low"), freq: read.number("lowfreq") },
    { band: "peak", gain: read.param("mid"), freq: read.param("midfreq") },
    { band: "high", gain: read.param("high"), freq: read.number("highfreq") },
  ] as const;
  const live = bands
    .filter(({ gain }) => gain.automated || gain.at(0) !== 0)
    .map((spec) => ({ ...spec, filter: new Biquad(), gainDb: NaN, hz: NaN }));
  if (live.length === 0) return;
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0)
      for (const stage of live) {
        const gainDb = stage.gain.at(index);
        const hz =
          typeof stage.freq === "number" ? stage.freq : stage.freq.at(index);
        if (gainDb === stage.gainDb && hz === stage.hz) continue;
        stage.gainDb = gainDb;
        stage.hz = hz;
        setEqBand(stage.filter, stage.band, hz, gainDb, context.sampleRate);
      }
    let sample = buffer[index]!;
    for (const stage of live) sample = stage.filter.process(sample);
    buffer[index] = sample;
  }
}
