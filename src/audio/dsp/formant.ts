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

// ---- sing lane: SATB tables, Klatt cascade, morph and tuning ----

/**
 * Vowel formant tables and the resonators that sing them.
 *
 * Tables: F1-F5 frequency (Hz), level (dB), bandwidth (Hz) for soprano,
 * alto, tenor and bass singers on a e i o u: the Csound manual's "Formant
 * Values" appendix (the FOF table, after Sundberg's singer data). The tenor
 * rows equal VOWEL_FORMANTS above.
 *
 * Resonator: Klatt 1980 ("Software for a cascade/parallel formant
 * synthesizer", JASA 67(3)) two-pole digital resonator with unity DC gain:
 *   C = -exp(-2 pi BW T), B = 2 exp(-pi BW T) cos(2 pi F T), A = 1 - B - C,
 *   y[n] = A x[n] + B y[n-1] + C y[n-2].
 * In cascade the relative formant levels come out right on their own.
 */

export type Formant = readonly [hz: number, db: number, bw: number];
export type VowelTable = readonly Formant[];
export const VOICE_TYPES = ["soprano", "alto", "tenor", "bass"] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];
export const VOWELS = ["a", "e", "i", "o", "u"] as const;

const row = (f: number[], db: number[], bw: number[]): VowelTable =>
  f.map((hz, i) => [hz, db[i]!, bw[i]!] as const);

export const SINGER_FORMANTS: Readonly<
  Record<VoiceType, Record<string, VowelTable>>
> = {
  soprano: {
    a: row(
      [800, 1150, 2900, 3900, 4950],
      [0, -6, -32, -20, -50],
      [80, 90, 120, 130, 140],
    ),
    e: row(
      [350, 2000, 2800, 3600, 4950],
      [0, -20, -15, -40, -56],
      [60, 100, 120, 150, 200],
    ),
    i: row(
      [270, 2140, 2950, 3900, 4950],
      [0, -12, -26, -26, -44],
      [60, 90, 100, 120, 120],
    ),
    o: row(
      [450, 800, 2830, 3800, 4950],
      [0, -11, -22, -22, -50],
      [70, 80, 100, 130, 135],
    ),
    u: row(
      [325, 700, 2700, 3800, 4950],
      [0, -16, -35, -40, -60],
      [50, 60, 170, 180, 200],
    ),
  },
  alto: {
    a: row(
      [800, 1150, 2800, 3500, 4950],
      [0, -4, -20, -36, -60],
      [80, 90, 120, 130, 140],
    ),
    e: row(
      [400, 1600, 2700, 3300, 4950],
      [0, -24, -30, -35, -60],
      [60, 80, 120, 150, 200],
    ),
    i: row(
      [350, 1700, 2700, 3700, 4950],
      [0, -20, -30, -36, -60],
      [50, 100, 120, 150, 200],
    ),
    o: row(
      [450, 800, 2830, 3500, 4950],
      [0, -9, -16, -28, -55],
      [70, 80, 100, 130, 135],
    ),
    u: row(
      [325, 700, 2530, 3500, 4950],
      [0, -12, -30, -40, -64],
      [50, 60, 170, 180, 200],
    ),
  },
  tenor: {
    a: row(
      [650, 1080, 2650, 2900, 3250],
      [0, -6, -7, -8, -22],
      [80, 90, 120, 130, 140],
    ),
    e: row(
      [400, 1700, 2600, 3200, 3580],
      [0, -14, -12, -14, -20],
      [70, 80, 100, 120, 120],
    ),
    i: row(
      [290, 1870, 2800, 3250, 3540],
      [0, -15, -18, -20, -30],
      [40, 90, 100, 120, 120],
    ),
    o: row(
      [400, 800, 2600, 2800, 3000],
      [0, -10, -12, -12, -26],
      [40, 80, 100, 120, 120],
    ),
    u: row(
      [350, 600, 2700, 2900, 3300],
      [0, -20, -17, -14, -26],
      [40, 60, 100, 120, 120],
    ),
  },
  bass: {
    a: row(
      [600, 1040, 2250, 2450, 2750],
      [0, -7, -9, -9, -20],
      [60, 70, 110, 120, 130],
    ),
    e: row(
      [400, 1620, 2400, 2800, 3100],
      [0, -12, -9, -12, -18],
      [40, 80, 100, 120, 120],
    ),
    i: row(
      [250, 1750, 2600, 3050, 3340],
      [0, -30, -16, -22, -28],
      [60, 90, 100, 120, 120],
    ),
    o: row(
      [400, 750, 2400, 2600, 2900],
      [0, -11, -21, -20, -40],
      [40, 80, 100, 120, 120],
    ),
    u: row(
      [350, 600, 2400, 2675, 2950],
      [0, -20, -32, -28, -36],
      [40, 80, 100, 120, 120],
    ),
  },
};

/** Morph two tables: frequencies and bandwidths in log Hz, levels in dB. */
export function morphVowel(a: VowelTable, b: VowelTable, t: number): Formant[] {
  return a.map(([fa, da, ba], i) => {
    const [fb, db, bb] = b[i]!;
    return [
      fa * (fb / fa) ** t,
      da + (db - da) * t,
      ba * (bb / ba) ** t,
    ] as const;
  });
}

/**
 * Vowel position along a sequence, e.g. "a>o>u" at t in [0,1]; plain "a"
 * is constant. Unknown letters fall back to "a".
 */
export function vowelAt(voice: VoiceType, spec: string, t: number): Formant[] {
  const table = SINGER_FORMANTS[voice];
  const names = spec.split(">").map((s) => (table[s] ? s : "a"));
  if (names.length === 1) return [...table[names[0]!]!];
  if (t >= 1) return [...table[names[names.length - 1]!]!];
  const x = Math.min(0.999999, Math.max(0, t)) * (names.length - 1);
  const i = Math.floor(x);
  return morphVowel(table[names[i]!]!, table[names[i + 1]!]!, x - i);
}

/** Klatt resonator with coefficient updates at control rate. */
export class Resonator {
  private a = 1;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  set(hz: number, bw: number, sampleRate: number): void {
    const t = 1 / sampleRate;
    const f = Math.min(hz, sampleRate * 0.45);
    this.c = -Math.exp(-2 * Math.PI * bw * t);
    this.b = 2 * Math.exp(-Math.PI * bw * t) * Math.cos(2 * Math.PI * f * t);
    this.a = 1 - this.b - this.c;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Constant-peak-gain band-pass (RBJ, 0 dB at centre) for parallel banks. */
export class Bandpass {
  private b0 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  set(hz: number, bw: number, sampleRate: number): void {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
    const q = Math.max(0.3, hz / Math.max(1, bw));
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    const y =
      this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Five-formant cascade (the Klatt voicing branch). */
export class Cascade {
  readonly res = [
    new Resonator(),
    new Resonator(),
    new Resonator(),
    new Resonator(),
    new Resonator(),
  ];
  set(formants: readonly Formant[], scale: number, sampleRate: number): void {
    for (let i = 0; i < 5; i += 1) {
      const [hz, , bw] = formants[i]!;
      this.res[i]!.set(hz * scale, bw * Math.sqrt(scale), sampleRate);
    }
  }
  process(x: number): number {
    let y = x;
    for (const r of this.res) y = r.process(y);
    return y;
  }
}

/**
 * Formant tuning for high voices (review fix; Sundberg 1987, Joliveau,
 * Smith and Wolfe 2004): when f0 rises above F1 (and 2 f0 above F2), the
 * singer opens the jaw so F1 tracks f0 and F2 tracks 2 f0. Applied to the
 * effective (formant-scaled) frequencies; bandwidths widen in proportion.
 * A no-op below the crossing, so low voices keep the table exactly.
 */
export function tuneToPitch(
  formants: readonly Formant[],
  f0: number,
  scale: number,
): readonly Formant[] {
  const need1 = (1.05 * f0) / scale;
  if (
    formants[0]![0] >= need1 &&
    formants[1]![0] >= Math.max((2.05 * f0) / scale, formants[0]![0] * 1.25)
  )
    return formants; // below the crossing: the table as-is, no allocation
  const out = formants.map((f) => [...f] as [number, number, number]);
  const f1 = out[0]!;
  const want1 = (1.05 * f0) / scale;
  if (f1[0] < want1) {
    f1[2] *= want1 / f1[0];
    f1[0] = want1;
  }
  const f2 = out[1]!;
  const want2 = Math.max((2.05 * f0) / scale, f1[0] * 1.25);
  if (f2[0] < want2) {
    f2[2] *= want2 / f2[0];
    f2[0] = want2;
  }
  return out;
}
