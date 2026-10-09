/**
 * Vowel formant tables shared by the `vowel` filter (and, from the sing
 * lane, the Klatt cascade): frequency (Hz), level (dB) and bandwidth (Hz)
 * per formant, plus a log-frequency morph between two vowels.
 */

export type Formants = readonly (readonly [number, number, number])[];

/**
 * Formant frequency (Hz), level (dB) and bandwidth (Hz). The five plain
 * vowels use the classic tenor formant table (published acoustic
 * phonetics data); the extended set approximates F1–F3 from standard
 * vowel charts with tenor-typical F4/F5.
 */
export const VOWEL_FORMANTS: Readonly<Record<string, Formants>> = Object.freeze(
  {
    a: [
      [650, 0, 80],
      [1080, -6, 90],
      [2650, -7, 120],
      [2900, -8, 130],
      [3250, -22, 140],
    ],
    e: [
      [400, 0, 70],
      [1700, -14, 80],
      [2600, -12, 100],
      [3200, -14, 120],
      [3580, -20, 120],
    ],
    i: [
      [290, 0, 40],
      [1870, -15, 90],
      [2800, -18, 100],
      [3250, -20, 120],
      [3540, -30, 120],
    ],
    o: [
      [400, 0, 40],
      [800, -10, 80],
      [2600, -12, 100],
      [2800, -12, 120],
      [3000, -26, 120],
    ],
    u: [
      [350, 0, 40],
      [600, -20, 60],
      [2700, -17, 100],
      [2900, -14, 120],
      [3300, -26, 120],
    ],
    ae: extended(660, 1720, 2410),
    aa: extended(710, 1100, 2540),
    oe: extended(390, 1680, 2400),
    ue: extended(300, 1600, 2200),
    y: extended(250, 1750, 2160),
    uh: extended(600, 1170, 2390),
    un: extended(500, 1400, 2500),
    en: extended(550, 1650, 2500),
    an: extended(650, 1050, 2550),
    on: extended(450, 850, 2550),
  },
);

function extended(f1: number, f2: number, f3: number): Formants {
  return [
    [f1, 0, 70],
    [f2, -8, 90],
    [f3, -14, 110],
    [3300, -16, 130],
    [3750, -24, 140],
  ];
}

/**
 * Formants `morph` (0..1) of the way from `from` to `to`: frequency and
 * bandwidth interpolate on a log scale (equal steps sound equal), level in
 * dB. 0 returns `from`'s values exactly, 1 returns `to`'s.
 */
export function morphFormants(
  from: Formants,
  to: Formants,
  morph: number,
): Array<[number, number, number]> {
  const m = Math.min(1, Math.max(0, morph));
  return from.map(([hz, level, bw], index) => {
    if (m === 0) return [hz, level, bw];
    const [toHz, toLevel, toBw] = to[index] ?? [hz, level, bw];
    if (m === 1) return [toHz, toLevel, toBw];
    return [
      hz * (toHz / hz) ** m,
      level + (toLevel - level) * m,
      bw * (toBw / bw) ** m,
    ];
  });
}
