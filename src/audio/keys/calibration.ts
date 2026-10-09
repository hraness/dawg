/**
 * Calibration 1 (q08): per-preset, key-tracked level trims for the keys
 * engine and the harpsichord. The modelled pianos, electric pianos and
 * clavs were levelled one family at a time, so at velocity 0.8 they sat 2
 * to 40 dB under the `piano` synth and fell steeply up the keyboard (the
 * hammer and tangent pulses filter the upper keys' partials hard). Each
 * row is the gain in dB, fitted from renders, that brings one note at
 * velocity 0.8 to the `piano` reference (-18 LUFS momentary maximum), at
 * keys 24, 36, ... 108, capped so the note's sample peak stays at or under
 * -4 dBFS; the top keys' hammer click is all crest, so there the cap wins
 * and they sit a few dB under. Between keys the trim is interpolated in
 * dB, and outside it holds the end value. Trims are linear, so velocity
 * response is kept. Legacy songs (no calibration) never read this table.
 *
 * Pinned: never edit a row; a later revision appends a new table.
 */
export const KEYS_TRIM_KEYS = Object.freeze([
  24, 36, 48, 60, 72, 84, 96, 108,
] as const);

/** Highest boost at any key, so the top octave is not pulled out of noise. */
export const KEYS_TRIM_MAX_DB = 40;

export const KEYS_TRIM_DB_1: Readonly<Record<string, readonly number[]>> =
  Object.freeze({
    harpsichord: [4.1, 7.0, 9.9, 13.1, 16.2, 18.6, 18.2, 17.5],
    grand: [-1.4, -1.5, -0.6, 0.8, 3.8, 4.8, 5.5, 8.3],
    ballad: [-4.1, -4.7, -3.4, -2.9, -0.5, 3.1, 5.4, 8.2],
    upright: [1.4, 0.4, 0.5, 2.2, 4.0, 4.2, 4.8, 8.7],
    felt: [3.9, 4.1, 4.5, 5.2, 6.6, 8.9, 10.6, 15.4],
    lofi: [4.1, 4.1, 4.3, 5.7, 7.8, 8.2, 9.2, 15.0],
    honkytonk: [1.2, 2.9, 3.2, 4.1, 4.0, 3.5, 3.6, 6.2],
    prepared: [2.3, -1.5, 1.2, 5.7, 2.0, 6.2, 4.5, 7.6],
    epiano: [6.0, 5.2, 4.8, 5.3, 7.3, 7.6, 6.5, 8.5],
    suitcase: [7.6, 6.3, 5.6, 5.9, 7.7, 7.9, 6.6, 8.5],
    dyno: [3.0, 4.1, 4.5, 5.1, 6.6, 7.5, 6.2, 7.7],
    wurli: [9.6, 6.1, 5.3, 6.0, 7.8, 6.1, 7.6, 11.1],
    clav: [8.1, 8.8, 8.9, 10.4, 11.2, 10.8, 8.5, 2.7],
    funkclav: [7.1, 7.9, 9.0, 9.1, 9.0, 5.1, 7.8, 5.9],
  });

/** Linear gain for a preset at a key under calibration 1. */
export function keysTrim(preset: string, key: number): number {
  const row = KEYS_TRIM_DB_1[preset];
  if (!row || row.length !== KEYS_TRIM_KEYS.length) return 1;
  const keys = KEYS_TRIM_KEYS;
  let db: number;
  if (key <= keys[0]) db = row[0]!;
  else if (key >= keys[keys.length - 1]!) db = row[row.length - 1]!;
  else {
    const i = Math.min(keys.length - 2, Math.floor((key - keys[0]) / 12));
    const t = (key - keys[i]!) / 12;
    db = row[i]! + (row[i + 1]! - row[i]!) * t;
  }
  return 10 ** (Math.min(KEYS_TRIM_MAX_DB, db) / 20);
}
