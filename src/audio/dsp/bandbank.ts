/**
 * Band-pass banks (0.7 vocoder): RBJ biquads, their group delay and a
 * sample-rate-independent band layout. Band centres and widths depend only
 * on the band count, range and width, never on the sample rate: a band whose
 * centre lies above 0.45 sr is muted instead, so a 22 050 Hz audition and a
 * 48 kHz export have the same layout.
 */

export type Biquad = Readonly<{
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}>;

/** RBJ constant-0-dB-peak band-pass, bandwidth in octaves, pre-warped. */
export function bandpass(
  hz: number,
  octaves: number,
  sampleRate: number,
): Biquad {
  const w = (2 * Math.PI * hz) / sampleRate;
  const s = Math.sin(w);
  const alpha = s * Math.sinh(((Math.LN2 / 2) * octaves * w) / s);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w)) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ Butterworth high-pass (Q = 1/sqrt 2). */
export function highpass(hz: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + c) / 2 / a0,
    b1: -(1 + c) / a0,
    b2: (1 + c) / 2 / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Group delay in samples of one biquad at angle `w` (numeric phase slope). */
export function groupDelay(f: Biquad, w: number): number {
  const phase = (x: number): number => {
    const nr = f.b0 + f.b1 * Math.cos(x) + f.b2 * Math.cos(2 * x);
    const ni = -(f.b1 * Math.sin(x) + f.b2 * Math.sin(2 * x));
    const dr = 1 + f.a1 * Math.cos(x) + f.a2 * Math.cos(2 * x);
    const di = -(f.a1 * Math.sin(x) + f.a2 * Math.sin(2 * x));
    return Math.atan2(ni, nr) - Math.atan2(di, dr);
  };
  const d = 1e-5;
  let dp = phase(w + d) - phase(w - d);
  while (dp > Math.PI) dp -= 2 * Math.PI;
  while (dp < -Math.PI) dp += 2 * Math.PI;
  return -dp / (2 * d);
}

/** Runs a biquad over `x` in place (transposed direct form II). */
export function runBiquad(f: Biquad, x: Float64Array): void {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = f;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
}

export type BandLayout = Readonly<{
  bands: number;
  lo: number;
  hi: number;
  width: number;
}>;

/**
 * Log-spaced centres from `lo` to `hi`. Each of the two cascaded sections is
 * about 1.55x wider than the target so the pair's -3 dB width matches
 * spacing x width.
 */
export function bandLayout(p: BandLayout): {
  centres: number[];
  ratio: number;
  octaves: number;
} {
  const n = Math.max(2, Math.round(p.bands));
  const ratio = (p.hi / p.lo) ** (1 / (n - 1));
  const centres = Array.from({ length: n }, (_, k) => p.lo * ratio ** k);
  return { centres, ratio, octaves: Math.log2(ratio) * p.width * 1.55 };
}

export type BankBand = Readonly<{
  hz: number;
  live: boolean;
  filter: Biquad;
  /** Modulator advance: the pair's group delay at hz plus the attack. */
  advance: number;
}>;

/**
 * The bank at one sample rate. Each band's modulator advance cancels the
 * analysis filters' group delay and the follower attack, so consonants land
 * on the beat.
 */
export function bankDesign(
  p: BandLayout & { attack?: number },
  sampleRate: number,
): { bands: BankBand[]; ratio: number } {
  const { centres, ratio, octaves } = bandLayout(p);
  const bands = centres.map((hz) => {
    const live = hz <= 0.45 * sampleRate;
    const filter = bandpass(
      Math.min(hz, 0.45 * sampleRate),
      octaves,
      sampleRate,
    );
    const advance = live
      ? Math.round(
          2 * groupDelay(filter, (2 * Math.PI * hz) / sampleRate) +
            (p.attack ?? 0) * sampleRate,
        )
      : 0;
    return { hz, live, filter, advance };
  });
  return { bands, ratio };
}
