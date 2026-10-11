/**
 * The machine-vox phone table (lane V1): every ARPAbet phone the built-in
 * formant voice can say, with its class, voicing, formant targets (F1-F3
 * for an adult male tract; the engine scales them per voice type), a
 * frication or burst spectrum for the parallel noise branch, and nominal
 * durations. Pure and import-free, like `core/lyrics.ts`.
 *
 * Values follow the published Klatt (1980) synthesis tables and standard
 * acoustic-phonetics vowel charts (Peterson and Barney 1952), rounded; the
 * noise spectra are a three-band reduction of Klatt's parallel branch.
 * The structure (cascade voicing branch plus parallel frication bands,
 * closure plus burst plus aspiration for stops, a nasal pole-zero pair)
 * follows klatt-syn by Christian d'Heureuse (MIT,
 * https://github.com/chdh/klatt-syn), used as a reference; no code was
 * copied.
 */
import { VOX_PHONES } from "./vox.ts";

/** Phone classes the engine synthesizes differently. */
export type VoxPhoneKind =
  | "vowel"
  | "stop"
  | "affricate"
  | "fricative"
  | "nasal"
  | "approximant"
  | "aspirate";

/** One parallel noise band: centre Hz, bandwidth Hz, level dB. */
export type VoxBand = readonly [hz: number, bw: number, db: number];

export type VoxPhone = Readonly<{
  kind: VoxPhoneKind;
  voiced: boolean;
  /** F1-F3 targets (Hz). For a stop, its locus. */
  f: readonly [number, number, number];
  /** Diphthongs: the F1-F3 the vowel glides to. */
  to?: readonly [number, number, number];
  /** Bandwidths of F1-F3 (Hz). */
  bw: readonly [number, number, number];
  /** Nominal length in seconds (a vowel's is its minimum in a coda). */
  dur: number;
  /** Frication (fricative, affricate release) or burst spectrum. */
  noise?: readonly VoxBand[];
  /** Noise level, 0..1, relative to a full vowel. */
  noiseLevel?: number;
  /** Stops and affricates: closure length in seconds. */
  closure?: number;
  /** Voiceless stops: aspiration after the burst (VOT), seconds. */
  aspiration?: number;
  /** Nasals: the anti-resonance (zero) Hz. */
  zero?: number;
  /** Voicing amplitude during the phone, 0..1. */
  av: number;
  /**
   * The sung-vowel spelling for the SATB singer tables (`a`..`u` or a
   * diphthong morph `a>i`), for vowels the tables hold.
   */
  sung?: string;
}>;

const ph = (p: VoxPhone): VoxPhone => Object.freeze(p);

const V = (
  f: [number, number, number],
  sung?: string,
  to?: [number, number, number],
): VoxPhone =>
  ph({
    kind: "vowel",
    voiced: true,
    f,
    ...(to ? { to } : {}),
    bw: [70, 90, 140],
    dur: 0.09,
    av: 1,
    ...(sung ? { sung } : {}),
  });

const S_BANDS: readonly VoxBand[] = [
  [5600, 1800, 0],
  [8000, 2400, -4],
  [3800, 1200, -18],
];
const SH_BANDS: readonly VoxBand[] = [
  [2600, 800, 0],
  [3600, 1200, -3],
  [5200, 2000, -10],
];
const F_BANDS: readonly VoxBand[] = [
  [1600, 2400, -6],
  [5000, 3500, 0],
  [8000, 3000, -4],
];
const TH_BANDS: readonly VoxBand[] = [
  [3200, 2400, -6],
  [6200, 3500, 0],
  [8500, 3000, -3],
];
const P_BURST: readonly VoxBand[] = [
  [900, 1200, 0],
  [2200, 1800, -10],
  [5000, 3000, -18],
];
const T_BURST: readonly VoxBand[] = [
  [4200, 2200, 0],
  [6500, 3000, -2],
  [2600, 1200, -12],
];
const K_BURST: readonly VoxBand[] = [
  [1900, 700, 0],
  [3100, 1400, -6],
  [5500, 2500, -16],
];

/**
 * Every phone, ARPAbet without stress digits, plus `ax` (schwa), `q`
 * (glottal stop) and `dx` (flap).
 */
export const VOX_PHONE_TABLE: Readonly<Record<string, VoxPhone>> =
  Object.freeze({
    // vowels
    iy: V([300, 2200, 2960], "i"),
    ih: V([400, 1850, 2560]),
    eh: V([530, 1680, 2500], "e"),
    ae: V([650, 1700, 2430]),
    aa: V([700, 1150, 2600], "a"),
    ah: V([620, 1200, 2550], "a"),
    ao: V([570, 900, 2550], "o"),
    uh: V([450, 1100, 2350]),
    uw: V([330, 900, 2300], "u"),
    er: V([470, 1300, 1600]),
    ax: V([500, 1450, 2450]),
    ey: V([480, 1750, 2520], "e>i", [330, 2150, 2700]),
    ay: V([680, 1200, 2550], "a>i", [380, 1950, 2600]),
    aw: V([680, 1150, 2550], "a>u", [400, 900, 2350]),
    oy: V([560, 900, 2400], "o>i", [360, 1850, 2500]),
    ow: V([520, 950, 2400], "o", [420, 850, 2350]),
    // approximants and glides: voiced, formant transitions into the vowel
    w: ph({
      kind: "approximant",
      voiced: true,
      f: [290, 620, 2150],
      bw: [50, 80, 160],
      dur: 0.06,
      av: 0.75,
    }),
    y: ph({
      kind: "approximant",
      voiced: true,
      f: [260, 2100, 3000],
      bw: [50, 100, 200],
      dur: 0.055,
      av: 0.8,
    }),
    r: ph({
      kind: "approximant",
      voiced: true,
      f: [310, 1100, 1450],
      bw: [70, 100, 140],
      dur: 0.065,
      av: 0.8,
    }),
    l: ph({
      kind: "approximant",
      voiced: true,
      f: [320, 1050, 2800],
      bw: [50, 120, 200],
      dur: 0.06,
      av: 0.75,
    }),
    // nasals: a low murmur pole plus a zero (pole-zero pair)
    m: ph({
      kind: "nasal",
      voiced: true,
      f: [260, 1100, 2150],
      bw: [60, 300, 400],
      dur: 0.075,
      zero: 900,
      av: 0.6,
    }),
    n: ph({
      kind: "nasal",
      voiced: true,
      f: [260, 1500, 2550],
      bw: [60, 300, 400],
      dur: 0.07,
      zero: 1500,
      av: 0.6,
    }),
    ng: ph({
      kind: "nasal",
      voiced: true,
      f: [260, 2000, 2800],
      bw: [60, 300, 400],
      dur: 0.075,
      zero: 2700,
      av: 0.6,
    }),
    // fricatives: noise through parallel band-passes
    s: ph({
      kind: "fricative",
      voiced: false,
      f: [320, 1400, 2550],
      bw: [200, 200, 300],
      dur: 0.1,
      noise: S_BANDS,
      noiseLevel: 0.5,
      av: 0,
    }),
    z: ph({
      kind: "fricative",
      voiced: true,
      f: [250, 1500, 2500],
      bw: [70, 200, 300],
      dur: 0.08,
      noise: S_BANDS,
      noiseLevel: 0.3,
      av: 0.4,
    }),
    sh: ph({
      kind: "fricative",
      voiced: false,
      f: [300, 1850, 2750],
      bw: [200, 200, 300],
      dur: 0.1,
      noise: SH_BANDS,
      noiseLevel: 0.5,
      av: 0,
    }),
    zh: ph({
      kind: "fricative",
      voiced: true,
      f: [300, 1850, 2750],
      bw: [70, 200, 300],
      dur: 0.08,
      noise: SH_BANDS,
      noiseLevel: 0.3,
      av: 0.4,
    }),
    f: ph({
      kind: "fricative",
      voiced: false,
      f: [340, 1100, 2100],
      bw: [200, 200, 300],
      dur: 0.09,
      noise: F_BANDS,
      noiseLevel: 0.25,
      av: 0,
    }),
    v: ph({
      kind: "fricative",
      voiced: true,
      f: [250, 1100, 2100],
      bw: [70, 200, 300],
      dur: 0.07,
      noise: F_BANDS,
      noiseLevel: 0.15,
      av: 0.5,
    }),
    th: ph({
      kind: "fricative",
      voiced: false,
      f: [320, 1300, 2550],
      bw: [200, 200, 300],
      dur: 0.09,
      noise: TH_BANDS,
      noiseLevel: 0.22,
      av: 0,
    }),
    dh: ph({
      kind: "fricative",
      voiced: true,
      f: [270, 1300, 2550],
      bw: [70, 200, 300],
      dur: 0.06,
      noise: TH_BANDS,
      noiseLevel: 0.12,
      av: 0.55,
    }),
    hh: ph({
      kind: "aspirate",
      voiced: false,
      f: [500, 1500, 2500],
      bw: [300, 300, 300],
      dur: 0.06,
      noiseLevel: 0.5,
      av: 0,
    }),
    // stops: closure silence, a burst, then (voiceless) aspiration
    p: ph({
      kind: "stop",
      voiced: false,
      f: [400, 1100, 2150],
      bw: [200, 200, 300],
      dur: 0.015,
      closure: 0.06,
      aspiration: 0.04,
      noise: P_BURST,
      noiseLevel: 0.6,
      av: 0,
    }),
    b: ph({
      kind: "stop",
      voiced: true,
      f: [200, 1100, 2150],
      bw: [70, 120, 200],
      dur: 0.01,
      closure: 0.05,
      noise: P_BURST,
      noiseLevel: 0.35,
      av: 0,
    }),
    t: ph({
      kind: "stop",
      voiced: false,
      f: [400, 1650, 2600],
      bw: [200, 200, 300],
      dur: 0.015,
      closure: 0.055,
      aspiration: 0.045,
      noise: T_BURST,
      noiseLevel: 0.7,
      av: 0,
    }),
    d: ph({
      kind: "stop",
      voiced: true,
      f: [200, 1650, 2600],
      bw: [70, 120, 200],
      dur: 0.01,
      closure: 0.045,
      noise: T_BURST,
      noiseLevel: 0.4,
      av: 0,
    }),
    k: ph({
      kind: "stop",
      voiced: false,
      f: [300, 1950, 2850],
      bw: [200, 200, 300],
      dur: 0.018,
      closure: 0.06,
      aspiration: 0.05,
      noise: K_BURST,
      noiseLevel: 0.6,
      av: 0,
    }),
    g: ph({
      kind: "stop",
      voiced: true,
      f: [200, 1950, 2850],
      bw: [70, 120, 200],
      dur: 0.012,
      closure: 0.05,
      noise: K_BURST,
      noiseLevel: 0.35,
      av: 0,
    }),
    // affricates: a stop closure released into frication
    ch: ph({
      kind: "affricate",
      voiced: false,
      f: [350, 1800, 2800],
      bw: [200, 200, 300],
      dur: 0.07,
      closure: 0.05,
      noise: SH_BANDS,
      noiseLevel: 0.5,
      av: 0,
    }),
    jh: ph({
      kind: "affricate",
      voiced: true,
      f: [260, 1800, 2800],
      bw: [70, 200, 300],
      dur: 0.06,
      closure: 0.045,
      noise: SH_BANDS,
      noiseLevel: 0.3,
      av: 0.35,
    }),
    // glottal stop: a short closure, no burst
    q: ph({
      kind: "stop",
      voiced: false,
      f: [500, 1500, 2500],
      bw: [200, 200, 300],
      dur: 0.005,
      closure: 0.04,
      av: 0,
    }),
    // flap: a brief voiced tap ("butter")
    dx: ph({
      kind: "stop",
      voiced: true,
      f: [250, 1650, 2600],
      bw: [70, 120, 200],
      dur: 0.008,
      closure: 0.018,
      noise: T_BURST,
      noiseLevel: 0.12,
      av: 0,
    }),
  });

/** Every phone name, in table order. */
export const VOX_PHONE_NAMES: readonly string[] = VOX_PHONES;

export function isVoxPhone(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(VOX_PHONE_TABLE, name);
}

export function isVoxVowel(name: string): boolean {
  return isVoxPhone(name) && VOX_PHONE_TABLE[name]!.kind === "vowel";
}

/**
 * A phone name as typed (`AH0`, `ah1`, `AX`) to the table's spelling, or
 * undefined if the table has no such phone.
 */
export function normalizePhone(text: string): string | undefined {
  const name = text
    .trim()
    .toLowerCase()
    .replace(/[0-2]$/, "");
  return isVoxPhone(name) ? name : undefined;
}

/**
 * Seconds a phone takes on its own: closure plus burst plus aspiration
 * for stops, the nominal length otherwise.
 */
export function phoneSeconds(name: string): number {
  const p = VOX_PHONE_TABLE[name];
  if (!p) return 0;
  return (p.closure ?? 0) + p.dur + (p.aspiration ?? 0);
}
