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
 * Where `hold[i]` is non-zero, `curve` keeps its value from the sample
 * before (in place): a frozen vocoder keeps its gate where it was, so the
 * held vowel does not fade out once the modulator goes quiet.
 */
export function holdCurve(curve: Float64Array, hold: Uint8Array): void {
  for (let i = 1; i < curve.length && i < hold.length; i += 1)
    if (hold[i] !== 0) curve[i] = curve[i - 1]!;
}

/**
 * The static `freeze` hold: 1 wherever the modulator is quiet (under the
 * gate, or under -50 dBFS when the gate is lower or off), engaged
 * `lead` seconds before the voice falls quiet so the envelopes are caught
 * before their release. The carrier keeps the last sung vowel through every
 * rest and follows the voice while it sings. Before the first note it holds
 * silence. Local (the mod span plus its lookahead), so windows agree.
 */
export function quietHold(
  x: Float64Array,
  n: number,
  sampleRate: number,
  thresholdDb: number,
  lead = 0.03,
): Uint8Array {
  const level = follow(x, 0.001, 0.01, sampleRate);
  const floor = 10 ** (Math.max(thresholdDb, -50) / 20);
  const ahead = Math.max(0, Math.round(lead * sampleRate));
  const hold = new Uint8Array(n);
  let nextQuiet = Infinity;
  for (let i = Math.min(level.length, n + ahead) - 1; i >= 0; i -= 1) {
    if (level[i]! < floor) {
      // the start of a quiet run reaches back `ahead` samples
      if (i === 0 || level[i - 1]! >= floor) nextQuiet = i;
      if (i < n) hold[i] = 1;
    } else if (i < n && nextQuiet - i <= ahead) hold[i] = 1;
  }
  for (let i = level.length; i < n; i += 1) hold[i] = 1;
  return hold;
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
