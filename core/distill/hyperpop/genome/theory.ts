/**
 * Harmony for generated songs: one mode per song (never a key change),
 * chord loops grown from functional moves rather than copied from a demo,
 * and voicings that move as little as they can.
 */
import type { Rng } from "./rng.ts";

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;
export type Mode = keyof typeof MODES;

const NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export type Scale = Readonly<{
  tonic: number;
  mode: Mode;
  steps: readonly number[];
  /** Pitch classes, tonic first. */
  pcs: readonly number[];
  /** MIDI pitch of the tonic in the middle register (54..65). */
  root: number;
  /** Score key text (`F#m`, `Bb`): modes report their parent's quality. */
  label: string;
  name: string;
}>;

export function scaleOf(tonic: number, mode: Mode): Scale {
  const steps = MODES[mode];
  const pcs = steps.map((s) => (tonic + s) % 12);
  const minorish = steps[2] === 3;
  const root = 60 + tonic > 65 ? 48 + tonic : 60 + tonic;
  return {
    tonic,
    mode,
    steps,
    pcs,
    root,
    label: `${NAMES[tonic]}${minorish ? "m" : ""}`,
    name: `${NAMES[tonic]} ${mode}`,
  };
}

/** A diatonic degree (0-based, any octave) as a MIDI pitch. */
export function degreePitch(scale: Scale, degree: number): number {
  const octave = Math.floor(degree / 7);
  return scale.root + scale.steps[((degree % 7) + 7) % 7]! + 12 * octave;
}

/** A chord as pitch classes: the bass and the tones above it. */
export type Chord = Readonly<{
  name: string;
  /** Root degree in the mode, or -1 for a borrowed chord. */
  degree: number;
  bass: number;
  /** Root, third, fifth (pitch classes). */
  triad: readonly number[];
  /** Colour tones a pad may add (7th, 9th); melodies never land on them. */
  color: readonly number[];
}>;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function quality(pcs: readonly number[]): "maj" | "min" | "dim" | "aug" {
  const third = (pcs[1]! - pcs[0]! + 12) % 12;
  const fifth = (pcs[2]! - pcs[0]! + 12) % 12;
  if (fifth === 6) return "dim";
  if (fifth === 8) return "aug";
  return third === 3 ? "min" : "maj";
}

export function diatonic(scale: Scale, degree: number, ext = "triad"): Chord {
  const pc = (k: number) => scale.pcs[(degree + k) % 7]!;
  const triad = [pc(0), pc(2), pc(4)];
  const q = quality(triad);
  const color =
    ext === "seven"
      ? [pc(6)]
      : ext === "add9"
        ? [pc(1)]
        : ext === "nine"
          ? [pc(6), pc(1)]
          : [];
  const numeral = q === "maj" ? ROMAN[degree]! : ROMAN[degree]!.toLowerCase();
  return {
    name: `${numeral}${q === "dim" ? "°" : ""}${ext === "triad" ? "" : ext === "seven" ? "7" : ext === "add9" ? "add9" : "9"}`,
    degree,
    bass: triad[0]!,
    triad,
    color,
  };
}

/** A chord borrowed from the parallel mode (iv, bVI, bVII in major). */
function borrowed(scale: Scale, semis: number, minor: boolean, name: string) {
  const root = (scale.tonic + semis) % 12;
  const triad = [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
  return { name, degree: -1, bass: root, triad, color: [] } as Chord;
}

/** The same chord over another bass note (a pedal or a passing inversion). */
export const over = (chord: Chord, bass: number, label?: string): Chord => ({
  ...chord,
  bass,
  name: label ?? `${chord.name}/${NAMES[bass]}`,
});

export const isDiminished = (scale: Scale, degree: number) =>
  quality(diatonic(scale, degree).triad) !== "maj" &&
  quality(diatonic(scale, degree).triad) !== "min";

// Functional moves between root degrees, read as "from: [to, weight]...".
// Loops grow from these, so they sound like pop without being any one song.
const MOVES: Readonly<Record<number, readonly (readonly [number, number])[]>> =
  {
    0: [
      [3, 4],
      [4, 3],
      [5, 3],
      [1, 2],
      [2, 1.2],
      [6, 1],
    ],
    1: [
      [4, 4],
      [3, 1.5],
      [6, 1],
      [0, 1],
    ],
    2: [
      [5, 3],
      [3, 2.5],
      [1, 1],
      [0, 0.6],
    ],
    3: [
      [4, 3],
      [0, 3],
      [1, 2],
      [5, 1.5],
      [6, 1.2],
      [2, 0.7],
    ],
    4: [
      [0, 4],
      [5, 3],
      [3, 1.8],
      [6, 0.8],
    ],
    5: [
      [3, 4],
      [1, 2.5],
      [4, 2.2],
      [6, 1.5],
      [2, 1.2],
      [0, 1],
    ],
    6: [
      [0, 3],
      [2, 2],
      [5, 1.5],
      [3, 1],
    ],
  };

/** Loops in these modes like to start on their colour chord too. */
const COLOR: Readonly<Record<Mode, number>> = {
  major: 5,
  minor: 5,
  dorian: 3,
  mixolydian: 6,
  lydian: 1,
  phrygian: 1,
};

export type Language =
  "loop" | "two" | "pedal" | "lament" | "circle" | "borrowed";

export type Ext = "triad" | "seven" | "add9" | "nine";

/**
 * A chord loop of `length` chords in `language`. Diminished chords only
 * appear where the circle of fifths walks through them.
 */
export function progression(
  rng: Rng,
  scale: Scale,
  language: Language,
  length: number,
  colorful: number,
): Chord[] {
  const ext = (): Ext =>
    rng.chance(colorful)
      ? rng.weighted({ seven: 3, add9: 3, nine: 1 })
      : "triad";
  const usable = [0, 1, 2, 3, 4, 5, 6].filter((d) => !isDiminished(scale, d));
  const starts = [0, 3, 5, COLOR[scale.mode]].filter((d) => usable.includes(d));
  const start = (): number =>
    starts[rng.index(starts.map((d) => (d ? 3 : 5)))]!;
  if (language === "circle") {
    // Falling fifths through the mode: a baroque sequence.
    const from = rng.pick([0, 5, 2]);
    return Array.from({ length }, (_, i) => {
      const d = (((from + i * 3) % 7) + 7) % 7;
      const chord = diatonic(
        scale,
        d,
        isDiminished(scale, d) ? "triad" : ext(),
      );
      // A diminished chord passes in first inversion, as Corelli would.
      return isDiminished(scale, d) ? over(chord, chord.triad[1]!) : chord;
    });
  }
  if (language === "lament") {
    // The bass walks down the scale; each chord holds the bass note.
    const top = rng.pick([0, 0, 5, 3]);
    return Array.from({ length }, (_, i) => {
      const bassDegree = (((top - i) % 7) + 7) % 7;
      const bass = scale.pcs[bassDegree]!;
      const holders = usable
        .map((d) => diatonic(scale, d, ext()))
        .filter((c) => c.triad.slice(0, 2).includes(bass));
      const chord = holders.find((c) => c.triad[0] === bass) ?? holders[0];
      if (!chord || rng.chance(0.4)) {
        const inv = holders.find((c) => c.triad[1] === bass);
        if (inv) return over(inv, bass);
      }
      return chord ? over(chord, bass, chord.name) : diatonic(scale, 0);
    });
  }
  if (language === "two") {
    const a = start();
    const choices = (MOVES[a] ?? MOVES[0]!).filter(([d]) => usable.includes(d));
    const b = choices[rng.index(choices.map(([, w]) => w))]![0];
    const ca = diatonic(scale, a, ext());
    const cb = diatonic(scale, b, ext());
    const shape = rng.pick([
      [ca, cb],
      [ca, ca, cb, cb],
      [ca, cb, ca, cb],
    ]);
    return Array.from({ length }, (_, i) => shape[i % shape.length]!);
  }
  // Walk the functional moves; retry until the loop closes sensibly.
  let best: number[] = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    const degrees = [start()];
    while (degrees.length < length) {
      const prev = degrees.at(-1)!;
      const choices = (MOVES[prev] ?? MOVES[0]!).filter(
        ([d]) => usable.includes(d) && d !== prev,
      );
      degrees.push(choices[rng.index(choices.map(([, w]) => w))]![0]);
    }
    const closes = (MOVES[degrees.at(-1)!] ?? []).some(
      ([d]) => d === degrees[0],
    );
    const distinct = new Set(degrees).size;
    best = degrees;
    if (closes && distinct >= Math.min(3, length)) break;
  }
  let chords = best.map((d) => diatonic(scale, d, ext()));
  if (language === "pedal") {
    const tonicPedal = rng.chance(0.75);
    const pedal = scale.pcs[tonicPedal ? 0 : 4]!;
    // Chords that hold the pedal, plus the classic rubs: IV, V and VII over
    // the tonic, IV and ii over the fifth (the pop "IV/V").
    const rubs = tonicPedal ? [3, 4, 6] : [1, 3];
    const pool = usable.filter(
      (d) => diatonic(scale, d).triad.includes(pedal) || rubs.includes(d),
    );
    const ok = (c: Chord) => c.degree >= 0 && pool.includes(c.degree);
    let prev = -1;
    chords = chords.map((c, i) => {
      const d =
        ok(c) && c.degree !== prev
          ? c.degree
          : rng.pick(
              pool.filter(
                (x) => x !== prev && (i > 0 || x === 0 || !tonicPedal),
              ),
            );
      prev = d;
      return over(
        ok(c) && c.degree === d ? c : diatonic(scale, d, ext()),
        pedal,
      );
    });
  }
  if (
    language === "borrowed" &&
    (scale.mode === "major" || scale.mode === "mixolydian")
  ) {
    // Swap one chord for its darker cousin from the parallel minor.
    const at = rng.int(1, Math.max(1, length - 1));
    const swap = rng.weighted({ iv: 3, bVI: 2, bVII: 2 });
    chords[at] =
      swap === "iv"
        ? borrowed(scale, 5, true, "iv")
        : swap === "bVI"
          ? borrowed(scale, 8, false, "bVI")
          : borrowed(scale, 10, false, "bVII");
  }
  return chords;
}

/** Pitches in [low, high] whose pitch class is in `pcs`, ascending. */
export function ladder(
  pcs: readonly number[],
  low: number,
  high: number,
): number[] {
  const out: number[] = [];
  for (let p = low; p <= high; p++)
    if (pcs.includes(((p % 12) + 12) % 12)) out.push(p);
  return out;
}

/**
 * The scale a melody may use over `chord`: chord tones replace any scale
 * note a semitone from one, so no melody note can rub against the chord.
 */
export function melodicSet(scale: Scale, chord: Chord): number[] {
  const tones = chord.triad;
  const out = new Set<number>(tones);
  for (const pc of scale.pcs) {
    const rubs = tones.some(
      (t) =>
        !tones.includes(pc) &&
        (Math.abs(t - pc) % 12 === 1 || Math.abs(t - pc) % 12 === 11),
    );
    if (!rubs) out.add(pc);
  }
  return [...out].sort((a, b) => a - b);
}

/** The pitch in `set` nearest `pitch` (ties go up). */
export function nearest(set: readonly number[], pitch: number): number {
  let best = set[0]!;
  for (const p of set)
    if (
      Math.abs(p - pitch) < Math.abs(best - pitch) ||
      (Math.abs(p - pitch) === Math.abs(best - pitch) && p > best)
    )
      best = p;
  return best;
}

/**
 * Voice `chord` inside [low, high] with `count` notes, moving as little as
 * possible from `previous` (close position when there is none).
 */
export function voicing(
  chord: Chord,
  low: number,
  high: number,
  count: number,
  previous?: readonly number[],
  colors = true,
): number[] {
  const pcs = [...chord.triad, ...(colors ? chord.color : [])];
  const pool = ladder(pcs, low, high);
  if (!previous || previous.length === 0) {
    const first =
      pool.find((p) => ((p % 12) + 12) % 12 === chord.triad[0]) ?? pool[0]!;
    const out = pool.filter((p) => p >= first).slice(0, count);
    return out.length === count ? out : pool.slice(-count);
  }
  // Each voice moves to its nearest chord tone; then fill missing tones.
  const out = new Set<number>();
  for (const p of previous) {
    const options = pool.filter((q) => !out.has(q));
    if (options.length) out.add(nearest(options, p));
  }
  const have = new Set([...out].map((p) => p % 12));
  for (const pc of chord.triad)
    if (!have.has(pc)) {
      const options = ladder([pc], low, high);
      const mid = [...out].reduce((a, b) => a + b, 0) / Math.max(1, out.size);
      if (options.length) {
        const pick = nearest(options, mid);
        // Replace the voice doubling another pitch class, if any.
        const doubled = [...out].find(
          (p) => [...out].filter((q) => q % 12 === p % 12).length > 1,
        );
        if (doubled !== undefined) out.delete(doubled);
        out.add(pick);
      }
    }
  return [...out].sort((a, b) => a - b).slice(0, Math.max(count, out.size));
}

/** The MIDI bass for a chord, in [low, low + 11]. */
export function bassPitch(chord: Chord, low: number): number {
  return low + ((((chord.bass - low) % 12) + 12) % 12);
}

/** The semitone class of an interval, folded into an octave. */
export const ic = (a: number, b: number) => (((a - b) % 12) + 12) % 12;

/** Consonant against a lower voice: 3rds, 6ths, 5ths, octaves. */
export const consonant = (upper: number, lower: number) =>
  [0, 3, 4, 7, 8, 9].includes(ic(upper, lower));
