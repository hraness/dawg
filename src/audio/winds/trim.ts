/**
 * Pitch and level trims for the wind voice, looked up from the generated
 * table (`trims.ts`, written by `bun scripts/calibrate-winds.ts`). The
 * waveguides' residual pitch error (loop-filter group delay the closed
 * forms miss, the lip resonance pull) is deterministic, so each preset
 * carries a correction in cents per semitone of its range at each render
 * rate, interpolated linearly in pitch, plus an output level and a per-semitone
 * loudness curve that put the sustain RMS at WIND_HOUSE_RMS_DB at velocity
 * 0.8 (the engine's soft knee guards the peaks). Rates without a table use the nearest
 * one (pitch then within a few cents).
 */
import type { WindPresetName } from "../../../core/winds.ts";
import { WIND_TRIM_TABLE } from "./trims.ts";
import type { WindTrim } from "./voice.ts";

/** House sustain level of every preset at velocity 0.8, dBFS RMS. */
export const WIND_HOUSE_RMS_DB = -14;

/** Rates the calibration writes tables for. */
export const WIND_TRIM_RATES = Object.freeze([22_050, 44_100, 48_000]);

export type WindTrimRow = Readonly<{
  /** MIDI note of `cents[0]`; one entry per semitone. */
  lo: number;
  /** Correction in hundredths of a cent. */
  cents: readonly number[];
  level: number;
  /**
   * Loudness curve in hundredths of a dB per semitone on the `cents` grid
   * (absent: flat), so the sustain RMS stays on the house level across the
   * range.
   */
  gains?: readonly number[];
}>;

function nearestRate(sampleRate: number): number {
  let best = WIND_TRIM_RATES[0]!;
  for (const rate of WIND_TRIM_RATES)
    if (Math.abs(rate - sampleRate) < Math.abs(best - sampleRate)) best = rate;
  return best;
}

/** The trim row of `preset` at `sampleRate`, undefined before calibration. */
export function windTrimRow(
  preset: WindPresetName,
  sampleRate: number,
): WindTrimRow | undefined {
  return WIND_TRIM_TABLE[nearestRate(sampleRate)]?.[preset];
}

function interpolate(lo: number, grid: readonly number[], hz: number): number {
  const midi = 69 + 12 * Math.log2(hz / 440) - lo;
  const last = grid.length - 1;
  if (last < 0) return 0;
  if (midi <= 0) return grid[0]! / 100;
  if (midi >= last) return grid[last]! / 100;
  const i = Math.floor(midi);
  const u = midi - i;
  return ((1 - u) * grid[i]! + u * grid[i + 1]!) / 100;
}

/** Interpolated correction of a row at `hz`, in cents. */
export function rowCents(row: WindTrimRow, hz: number): number {
  return interpolate(row.lo, row.cents, hz);
}

/** Interpolated loudness gain of a row at `hz`, as a factor. */
export function rowGain(row: WindTrimRow, hz: number): number {
  return row.gains ? 10 ** (interpolate(row.lo, row.gains, hz) / 20) : 1;
}

export function windTrim(preset: WindPresetName, sampleRate: number): WindTrim {
  const row = windTrimRow(preset, sampleRate);
  if (!row) return { cents: () => 0, level: 1 };
  return {
    cents: (hz) => rowCents(row, hz),
    level: row.level,
    gain: (hz) => rowGain(row, hz),
  };
}
