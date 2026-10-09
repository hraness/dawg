/**
 * Writes src/audio/winds/trims.ts: per render rate and wind preset, a pitch
 * correction per semitone of the preset's range (measure the untrimmed
 * error, apply it, fold the residual in, and scan around it where it is
 * still over half a cent, since the jet pitch steps where the Thiran
 * fraction wraps), then an output level and a per-semitone loudness curve
 * that put the sustain RMS (0.3-1 s) at WIND_HOUSE_RMS_DB at velocity 0.8,
 * measured with the pitch trim applied. Vibrato and breath noise are off
 * while measuring. Deterministic; run `bun scripts/calibrate-winds.ts`
 * after changing src/audio/winds/voice.ts or a preset (`--levels` keeps
 * the committed pitch trims and redoes only the loudness, for changes that
 * sit outside the loop), then `bunx prettier --write
 * src/audio/winds/trims.ts`.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  WIND_PRESET_NAMES,
  WIND_PRESETS,
  type WindPresetName,
} from "../core/winds.ts";
import { measurePitch } from "../src/audio/winds/pitch.ts";
import {
  rowCents,
  WIND_HOUSE_RMS_DB,
  WIND_TRIM_RATES,
  type WindTrimRow,
} from "../src/audio/winds/trim.ts";
import { WIND_TRIM_TABLE } from "../src/audio/winds/trims.ts";
import { WIND_TRIM_TABLE_1 } from "../src/audio/winds/trims1.ts";
import { WindVoice, type WindTrim } from "../src/audio/winds/voice.ts";

const LEVELS_ONLY = process.argv.includes("--levels");
/**
 * `--lips1` writes src/audio/winds/trims1.ts instead: calibration 1 rows
 * for the lip-model presets only, measured with the calibrated lips.
 */
const LIPS1 = process.argv.includes("--lips1");
const LIPS: Partial<WindTrim> = LIPS1 ? { lips: 1 } : {};
/** Semitones calibrated beyond each end of a preset's range. */
const MARGIN = 2;

function render(
  preset: WindPresetName,
  hz: number,
  sampleRate: number,
  trim: WindTrim,
): Float64Array {
  const settings = { ...WIND_PRESETS[preset].settings, vibmod: 0, noise: 0 };
  const voice = new WindVoice(
    settings,
    {
      segments: [{ at: 0, hz }],
      length: sampleRate,
      velocity: 0.8,
      seed: "calibrate",
    },
    sampleRate,
    trim,
  );
  const out = new Float64Array(Math.round(1.1 * sampleRate));
  voice.process(out, 0, out.length);
  return out;
}

function errorCents(
  preset: WindPresetName,
  midi: number,
  sampleRate: number,
  correction: number,
): { cents: number } {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  const out = render(preset, hz, sampleRate, {
    cents: () => correction,
    level: 1,
    ...LIPS,
  });
  const reading = measurePitch(out, sampleRate, hz, 0.35, 1, 300);
  return { cents: 1200 * Math.log2(reading.hz / hz) };
}

/** Sustain RMS in dBFS of `midi` with the pitch correction applied. */
function sustainDb(
  preset: WindPresetName,
  midi: number,
  sampleRate: number,
  correction: number,
): number {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  const out = render(preset, hz, sampleRate, {
    cents: () => correction,
    level: 1,
    ...LIPS,
  });
  let sum = 0;
  const from = Math.floor(0.3 * sampleRate);
  const to = sampleRate;
  for (let i = from; i < to; i += 1) sum += out[i]! * out[i]!;
  return 10 * Math.log10(Math.max(1e-20, sum / (to - from)));
}

/** Level and loudness curve putting every semitone at the house RMS. */
function loudness(
  preset: WindPresetName,
  lo: number,
  cents: readonly number[],
  sampleRate: number,
): { level: number; gains: number[] } {
  const offsets = cents.map(
    (c, i) =>
      WIND_HOUSE_RMS_DB - sustainDb(preset, lo + i, sampleRate, c / 100),
  );
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const level = Math.round(10 ** (median / 20) * 1e4) / 1e4;
  const applied = 20 * Math.log10(level);
  // Curve residual, held within +-15 dB so a dead note never blows up.
  const gains = offsets.map((o) =>
    Math.round(Math.max(-15, Math.min(15, o - applied)) * 100),
  );
  return { level, gains };
}

const table: Record<number, Record<string, unknown>> = {};
for (const sampleRate of WIND_TRIM_RATES) {
  const rows: Record<string, unknown> = {};
  for (const preset of WIND_PRESET_NAMES) {
    if (LIPS1 && WIND_PRESETS[preset].settings.model !== "lips") continue;
    const [low, high] = WIND_PRESETS[preset].range;
    const lo = low - MARGIN;
    const cents: number[] = [];
    const kept = LEVELS_ONLY
      ? ((LIPS1 ? WIND_TRIM_TABLE_1 : WIND_TRIM_TABLE)[sampleRate]?.[preset] as
          WindTrimRow | undefined)
      : undefined;
    if (LEVELS_ONLY && (!kept || kept.lo !== lo))
      throw new Error(`no committed trims for ${preset} at ${sampleRate}`);
    if (kept) cents.push(...kept.cents);
    else
      for (let midi = lo; midi <= high + MARGIN; midi += 1) {
        const first = errorCents(preset, midi, sampleRate, 0);
        let correction = -first.cents;
        let best = errorCents(preset, midi, sampleRate, correction);
        let bestCorrection = correction;
        // Fold the residual in once more; keep whichever lands closer.
        correction -= best.cents;
        const next = errorCents(preset, midi, sampleRate, correction);
        if (Math.abs(next.cents) < Math.abs(best.cents)) {
          best = next;
          bestCorrection = correction;
        }
        // The jet's pitch steps by a few cents where the loop's Thiran
        // fraction wraps, so Newton steps can straddle the gap. Where the
        // residual is still over half a cent, scan around it instead.
        if (Math.abs(best.cents) > 0.5) {
          const centre = bestCorrection;
          for (let d = -8; d <= 8; d += 0.25) {
            const trial = errorCents(preset, midi, sampleRate, centre + d);
            if (Math.abs(trial.cents) < Math.abs(best.cents)) {
              best = trial;
              bestCorrection = centre + d;
            }
          }
        }
        cents.push(Math.round(bestCorrection * 100));
      }
    const { level, gains } = loudness(preset, lo, cents, sampleRate);
    rows[preset] = { lo, cents, level, gains };
    const check = rowCents({ lo, cents, level }, 440 * 2 ** ((low - 69) / 12));
    console.log(
      sampleRate,
      preset,
      `low ${check.toFixed(1)} c`,
      `level ${level}`,
    );
  }
  table[sampleRate] = rows;
}

const name = LIPS1 ? "WIND_TRIM_TABLE_1" : "WIND_TRIM_TABLE";
const source = `// Generated by scripts/calibrate-winds.ts${LIPS1 ? " --lips1" : ""}; do not edit.
export const ${name}: Readonly<
  Record<
    number,
    Readonly<
      Record<string, Readonly<{ lo: number; cents: readonly number[]; level: number; gains?: readonly number[] }>>
    >
  >
> = ${JSON.stringify(table)};
`;
await writeFile(
  join(
    import.meta.dir,
    `../src/audio/winds/${LIPS1 ? "trims1.ts" : "trims.ts"}`,
  ),
  source,
);
