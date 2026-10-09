/**
 * Timelines (quality-08): the asymmetric bell, clave and stick patterns
 * that organise a groove, written as abstract one-bar step grids (`x` hit,
 * `.` rest; see `grid` in parts.ts). They are theory, not material: each is
 * a rhythmic cell named and analysed in the literature, not a transcription
 * of a recording.
 *
 * 16-step patterns are one 4/4 bar of sixteenths (two cut-time bars, the
 * way clave is felt). 12-step patterns are one 12/8 bar of eighths, or one
 * 6/8 or 3/4 bar of sixteenths.
 *
 * References: David Peñalosa, "The Clave Matrix" (2009); Godfried
 * Toussaint, "The Geometry of Musical Rhythm" (2013).
 */

import type { CycleSpec } from "./schema.ts";

export const TIMELINES = Object.freeze({
  /** Son clave, three side first: 3+3+4 | 2+4 (onsets 0 3 6 10 12). */
  sonClave32: "x..x..x...x.x...",
  /** Son clave, two side first (the 3-2 rotated by half a bar). */
  sonClave23: "..x.x...x..x..x.",
  /** Rumba clave: the third stroke of the three side delayed to 7. */
  rumbaClave32: "x..x...x..x.x...",
  rumbaClave23: "..x.x...x..x...x",
  /** Bossa nova clave: the son clave with the last stroke moved to 13. */
  bossaClave: "x..x..x...x..x..",
  /** Tresillo 3+3+2 twice: the Afro-Latin cell under habanera and dembow. */
  tresillo: "x..x..x.x..x..x.",
  /** Habanera (contradanza): tresillo with the middle stroke split. */
  habanera: "x..xx.x.x..xx.x.",
  /** Cinquillo: five strokes in a 2/4 bar, x.xx.xx. (danzon, kompa, biguine). */
  cinquillo: "x.xx.xx.x.xx.xx.",
  /** Danzon baqueteo: cinquillo bar answered by a plain eighths bar. */
  baqueteo: "x.xx.xx.x.x.x.x.",
  /** Cascara (shell of the timbal), 2-3 side. */
  cascara: "x.x.xx.x.xx.x.x.",
  /** Dembow / tresillo off-beat snare: 3 6 11 14. */
  dembowSnare: "...x..x....x..x.",
  /** Four on the floor. */
  fourFloor: "x...x...x...x...",
  /** Off-beat eighths (skank, llamador, upstroke). */
  offbeats: "..x...x...x...x.",
  /** One drop: kick and rim together on beat three only. */
  oneDrop: "........x.......",
  /** Partido alto: the syncopated samba cell (2+3, anticipated). */
  partidoAlto: ".x..x.x..x..x.x.",
  /** Guira / guacharaca scrape: long-short-short per beat. */
  scrape: "x.xxx.xxx.xxx.xx",
  /** Tumbao bass: the and of two and beat four, never the one. */
  tumbao: "......x.....x...",
  /** Conga tumbao: open tones on 4 and 4-and, slap on two. */
  congaTumbao: "x.x.x.xxx.x.x.xx",
  /** Huayno short-long: sixteenth then dotted eighth on every beat. */
  huayno: "xx..xx..xx..xx..",
  /** Standard 12/8 bell (bembe): 2+2+1+2+2+2+1, seven strokes. */
  bembe12: "x.x.xx.x.x.x",
  /** 6/8 sesquialtera: 6/8 accents (0, 6) against 3/4 (0, 4, 8). */
  sixEight12: "x.....x.....",
  threeFour12: "x...x...x...",
} as const);

export type TimelineName = keyof typeof TIMELINES;

/** The onset steps of a timeline (or any `x.` grid string). */
export function onsetSteps(pattern: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const char of pattern) {
    if (char === " " || char === "|") continue;
    if (char === "x" || char === "X") out.push(i);
    i += 1;
  }
  return out;
}

/**
 * A timeline as a cycle the perc role plays one stroke per pulse (the
 * meter's beat unit: an eighth in 6/8 and 12/8). Hits on `low` steps play
 * the low voice; `stress` steps are accented (1-based, like a tala).
 */
export function timelineCycle(
  name: string,
  pattern: string,
  low: readonly number[] = [0],
  stress: readonly number[] = [1],
): CycleSpec {
  const steps = [...pattern].filter((c) => c !== " " && c !== "|");
  const strokes = steps.map((c, i) =>
    c === "." ? "." : low.includes(i) ? "bum" : "ka",
  );
  return Object.freeze({
    kind: "timeline",
    name,
    beats: strokes.length,
    divisions: Object.freeze([strokes.length]),
    strokes: Object.freeze(strokes),
    low: Object.freeze(["bum"]),
    stress: Object.freeze([...stress]),
  });
}
