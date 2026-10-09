/**
 * Envelope followers (0.7 vocoder): one-pole attack/release on |x|, and the
 * gate curve built on one. Pure functions of the input buffer, so a render
 * window with enough pre-roll settles to the full render's values.
 */

/** One-pole coefficient for a time constant in seconds (0 = instant). */
export function followCoef(seconds: number, sampleRate: number): number {
  return seconds <= 0 ? 0 : Math.exp(-1 / (seconds * sampleRate));
}

/**
 * Follows |x| with separate attack and release times. Where `hold[i]` is
 * non-zero the envelope keeps its last value (the vocoder's freeze).
 */
export function follow(
  x: Float64Array,
  attack: number,
  release: number,
  sampleRate: number,
  hold?: Uint8Array,
): Float64Array {
  const a = followCoef(attack, sampleRate);
  const r = followCoef(release, sampleRate);
  const out = new Float64Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (!hold || hold[i] === 0) {
      const v = Math.abs(x[i]!);
      const c = v > e ? a : r;
      e = c * e + (1 - c) * v;
    }
    out[i] = e;
  }
  return out;
}

/**
 * Gate gain 0..1 per sample: a broadband follower against `thresholdDb`
 * with a 6 dB soft knee, smoothed over 5 ms. Undefined when the gate is off
 * (threshold at or below -119 dBFS).
 */
export function gateCurve(
  x: Float64Array,
  sampleRate: number,
  thresholdDb: number,
): Float64Array | undefined {
  if (thresholdDb <= -119) return undefined;
  const level = follow(x, 0.001, 0.05, sampleRate);
  const out = new Float64Array(x.length);
  const c = followCoef(0.005, sampleRate);
  let s = 0;
  for (let i = 0; i < x.length; i += 1) {
    const db = 20 * Math.log10(level[i]! + 1e-12);
    const t = Math.min(1, Math.max(0, (db - thresholdDb) / 6));
    s = c * s + (1 - c) * t;
    out[i] = s;
  }
  return out;
}

/**
 * Auto gate threshold for a whole asset: the 10th-percentile 10 ms frame
 * level plus 6 dB (the mean-abs follower reads about 1 dB under RMS). A
 * property of the asset, so every render window agrees. -120 when silent.
 */
export function autoGateDb(asset: Float64Array, sampleRate: number): number {
  const hop = Math.max(1, Math.round(0.01 * sampleRate));
  const levels: number[] = [];
  for (let s = 0; s + hop <= asset.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i += 1) e += asset[i]! * asset[i]!;
    const db = 10 * Math.log10(e / hop + 1e-24);
    if (db > -100) levels.push(db);
  }
  if (levels.length === 0) return -120;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.1)]! + 6;
}
