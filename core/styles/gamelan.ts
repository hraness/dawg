/**
 * Gamelan theory data (quality-08, europe-asia-pacific lane): colotomic
 * gong cycles (gongan) and pathet degree sets, written as abstract
 * structure rather than material.
 *
 * Colotomy: a nested cycle of gong-chime punctuation over the balungan
 * (the skeletal melody, one note per keteg beat). The cycle is end-weighted:
 * the strongest stroke, the gong ageng, falls on the LAST beat of the
 * gongan, where the melody resolves (seleh). Kenong divides the gongan into
 * equal parts (nongan), kempul marks the middle of each part except the
 * first (whose place is wela, a deliberate silence), and kethuk fills the
 * off-positions. Strokes here use the instrument names; `gong`, `kempul`
 * and `kenong` sound the perc role's low voice, `kethuk` its high voice.
 *
 * Pathet: which tuning degrees a piece favours and which degree ends its
 * phrases (the gong tone). Pelog lima and nem omit pelog 4 and 7, barang
 * omits pelog 1 (and 4); slendro uses all five and differs only in its
 * finals, so its pathet are given by gong tone.
 *
 * References: Judith Becker, "Traditional Music in Modern Java" (1980);
 * Sumarsam, "Gamelan: Cultural Interaction and Musical Development in
 * Central Java" (1995); Michael Tenzer, "Gamelan Gong Kebyar" (2000).
 */

import type { CycleSpec } from "./schema.ts";

/** One stroke name per beat from a map of beat (1-based) to stroke. */
function strokes(beats: number, at: Record<number, string>): string[] {
  return Array.from({ length: beats }, (_, i) => at[i + 1] ?? ".");
}

/** Every `step`-th beat from `from` (1-based) up to `beats`, as a stroke map. */
function every(
  beats: number,
  from: number,
  step: number,
  name: string,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (let beat = from; beat <= beats; beat += step) out[beat] = name;
  return out;
}

/**
 * Lancaran: 16 beats, kenong every 4, kempul on 6, 10, 14 (wela at 2),
 * kethuk on the odd beats, gong on 16.
 */
export const LANCARAN: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "lancaran",
  beats: 16,
  divisions: [4, 4, 4, 4],
  strokes: Object.freeze(
    strokes(16, {
      ...every(16, 1, 2, "kethuk"),
      ...every(16, 4, 4, "kenong"),
      6: "kempul",
      10: "kempul",
      14: "kempul",
      16: "gong",
    }),
  ),
  low: Object.freeze(["gong", "kempul", "kenong"]),
  stress: Object.freeze([16]),
  release: Object.freeze([2]),
});

/**
 * Ketawang: 16 beats in two kenongan, kethuk on 2, 6, 10, 14, kempul on
 * 12 (wela at 4), kenong on 8 and 16, gong on 16.
 */
export const KETAWANG: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "ketawang",
  beats: 16,
  divisions: [8, 8],
  strokes: Object.freeze(
    strokes(16, {
      ...every(16, 2, 4, "kethuk"),
      8: "kenong",
      12: "kempul",
      16: "gong",
    }),
  ),
  low: Object.freeze(["gong", "kempul", "kenong"]),
  stress: Object.freeze([16]),
  release: Object.freeze([4]),
});

/**
 * Ladrang: 32 beats in four kenongan, kethuk on 2, 6, 10..., kempul on
 * 12, 20, 28 (wela at 4), kenong every 8, gong on 32.
 */
export const LADRANG: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "ladrang",
  beats: 32,
  divisions: [8, 8, 8, 8],
  strokes: Object.freeze(
    strokes(32, {
      ...every(32, 2, 4, "kethuk"),
      ...every(32, 8, 8, "kenong"),
      12: "kempul",
      20: "kempul",
      28: "kempul",
      32: "gong",
    }),
  ),
  low: Object.freeze(["gong", "kempul", "kenong"]),
  stress: Object.freeze([32]),
  release: Object.freeze([4]),
});

/**
 * Balinese gilak (gong kebyar, beleganjur): 8 beats, gong on 8 and 4
 * (the kempur half-way), kempli time-keeper on every beat between.
 */
export const GILAK: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "gilak",
  beats: 8,
  divisions: [4, 4],
  strokes: Object.freeze(
    strokes(8, {
      ...every(8, 1, 1, "kempli"),
      4: "kempur",
      8: "gong",
    }),
  ),
  low: Object.freeze(["gong", "kempur"]),
  stress: Object.freeze([8]),
});

/**
 * Sundanese degung: the goong closes a 16-beat cycle and the jengglong
 * (low gong-chimes) answers half-way.
 */
export const DEGUNG: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "degung",
  beats: 16,
  divisions: [8, 8],
  strokes: Object.freeze(
    strokes(16, {
      ...every(16, 2, 2, "bonang"),
      8: "jengglong",
      16: "gong",
    }),
  ),
  low: Object.freeze(["gong", "jengglong"]),
  stress: Object.freeze([16]),
});

/**
 * Thai and Khmer ching cycle (piphat, pinpeat): the small
 * cymbals alternate an open "ching" and a damped, stressed "chap" on
 * every beat; the chap closes each pair.
 */
export const CHING: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "ching-chap",
  beats: 4,
  divisions: [2, 2],
  strokes: Object.freeze(["ching", "chap", "ching", "chap"]),
  low: Object.freeze(["chap"]),
  stress: Object.freeze([2, 4]),
});

/**
 * Burmese si-wa (hsaing waing): the si bell and the wa clapper alternate
 * at the half bar in the slow nayi-se; the wa, the clapper, marks the
 * stronger beat.
 */
export const SI_WA: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "si-wa",
  beats: 4,
  divisions: [2, 2],
  strokes: Object.freeze(["si", ".", "wa", "."]),
  low: Object.freeze(["wa"]),
  stress: Object.freeze([3]),
});

/**
 * Kulintang (Maguindanao): the agung pair plays an off-beat 8-pulse
 * cell (low agung on the beat, high on the off-beat).
 */
export const AGUNG: CycleSpec = Object.freeze({
  kind: "gongan",
  name: "agung binalig",
  beats: 8,
  divisions: [4, 4],
  strokes: Object.freeze([
    "gong",
    "agung",
    "gong",
    "agung",
    "gong",
    "agung",
    "agung",
    ".",
  ]),
  low: Object.freeze(["gong"]),
  stress: Object.freeze([1, 5]),
});

/** All gongan cycles by name. */
export const GONGAN: Readonly<Record<string, CycleSpec>> = Object.freeze({
  lancaran: LANCARAN,
  ketawang: KETAWANG,
  ladrang: LADRANG,
  gilak: GILAK,
  degung: DEGUNG,
  "ching-chap": CHING,
  "agung binalig": AGUNG,
  "si-wa": SI_WA,
});

/**
 * Pathet: the pelog or slendro degrees (0-based tuning indices) a piece
 * uses, and its phrase-final degrees as indices into that set.
 */
export const PATHET = Object.freeze({
  /** Pelog lima: pelog 1 2 3 5 6, gong tone 1 (also 5). */
  "pelog-lima": Object.freeze({
    tuning: "pelog",
    degrees: Object.freeze([0, 1, 2, 4, 5]),
    finals: Object.freeze([0, 3]),
  }),
  /** Pelog nem: pelog 1 2 3 5 6, gong tone 6 (also 2). */
  "pelog-nem": Object.freeze({
    tuning: "pelog",
    degrees: Object.freeze([0, 1, 2, 4, 5]),
    finals: Object.freeze([4, 1]),
  }),
  /** Pelog barang: pelog 2 3 5 6 7, gong tone 6 (also 2). */
  "pelog-barang": Object.freeze({
    tuning: "pelog",
    degrees: Object.freeze([1, 2, 4, 5, 6]),
    finals: Object.freeze([3, 0]),
  }),
  /** Slendro nem: gong tone 2 (also 6). */
  "slendro-nem": Object.freeze({
    tuning: "slendro",
    degrees: Object.freeze([0, 1, 2, 3, 4]),
    finals: Object.freeze([1, 4]),
  }),
  /** Slendro sanga: gong tone 5 (also 1). */
  "slendro-sanga": Object.freeze({
    tuning: "slendro",
    degrees: Object.freeze([0, 1, 2, 3, 4]),
    finals: Object.freeze([3, 0]),
  }),
  /** Slendro manyura: gong tone 6 (also 3). */
  "slendro-manyura": Object.freeze({
    tuning: "slendro",
    degrees: Object.freeze([0, 1, 2, 3, 4]),
    finals: Object.freeze([4, 2]),
  }),
});

export type PathetName = keyof typeof PATHET;

/** A card `pitch` patch for a pathet. */
export function pathetPitch(name: PathetName) {
  const pathet = PATHET[name];
  return Object.freeze({
    tuning: pathet.tuning,
    degrees: pathet.degrees,
    scales: Object.freeze([Object.freeze(["major-pentatonic", 1] as const)]),
  });
}

/** Phrase-final weights for a pathet (gong tone first). */
export function pathetFinals(
  name: PathetName,
): readonly (readonly [number, number])[] {
  const [gong, second] = PATHET[name].finals;
  return Object.freeze([
    Object.freeze([gong!, 0.7] as const),
    Object.freeze([second!, 0.3] as const),
  ]);
}
