/**
 * Melodies grown from a motif. A motif is a rhythm cell plus a contour in
 * scale steps; a phrase repeats, sequences, answers and varies it under the
 * chords. Strong beats land on chord tones and weak ones never rub (the
 * melodic set leaves out any note a semitone from the chord), so every line
 * is new and every line is consonant. The same tools write countermelodies
 * and fugues.
 */
import type { Rng } from "./rng.ts";
import {
  consonant,
  ic,
  ladder,
  melodicSet,
  nearest,
  type Chord,
  type Scale,
} from "./theory.ts";

/** A written note: beats from the phrase start, length in beats. */
export type MNote = {
  beat: number;
  len: number;
  pitch: number;
  vel: number;
  lyric?: string;
};

export type Cell = readonly { beat: number; len: number }[];

export type RhythmDNA = Readonly<{
  density: number;
  syncopation: number;
  tresillo: number;
}>;

/** The chord sounding at a beat of the phrase. */
export type ChordAt = (beat: number) => Chord;

const METRIC = (i: number) =>
  i % 16 === 0 ? 1 : i % 4 === 0 ? 0.75 : i % 2 === 0 ? 0.45 : 0.22;
const OFFBEAT = (i: number) =>
  i % 4 === 2 ? 0.75 : i % 4 === 3 ? 0.6 : i % 4 === 1 ? 0.45 : 0.2;

/**
 * A rhythm cell over `beats`: onsets drawn by metric weight, pulled
 * offbeat by syncopation and toward 3-3-2 by tresillo.
 */
export function rhythmCell(
  rng: Rng,
  dna: RhythmDNA,
  beats: number,
  o: Readonly<{
    density?: number;
    late?: boolean;
    hold?: boolean;
    legato?: number;
  }> = {},
): Cell {
  const steps = Math.round(beats * 4);
  const density = o.density ?? dna.density;
  const want = Math.max(
    2,
    Math.min(
      Math.round(steps * 0.7),
      Math.round(density * beats * rng.range(0.8, 1.2)),
    ),
  );
  const weights = Array.from({ length: steps }, (_, i) => {
    const t = i % 8;
    const tres = t === 0 || t === 3 || t === 6 ? dna.tresillo : 0;
    return (
      METRIC(i) * (1 - dna.syncopation) + OFFBEAT(i) * dna.syncopation + tres
    );
  });
  const chosen = new Set<number>();
  const first = o.late ? rng.pick([1, 2, 3, 2]) : 0;
  chosen.add(first);
  for (let i = 0; i < first; i++) weights[i] = 0;
  while (chosen.size < want) {
    const w = weights.map((x, i) => (chosen.has(i) ? 0 : x));
    if (w.every((x) => x <= 0)) break;
    chosen.add(rng.index(w));
  }
  const onsets = [...chosen].sort((a, b) => a - b);
  const legato = o.legato ?? 0.9;
  return onsets.map((step, i) => {
    const next = onsets[i + 1] ?? steps;
    const gap = (next - step) / 4;
    const last = i === onsets.length - 1;
    const len = last && o.hold ? Math.max(gap, 0.75) : gap * legato;
    return { beat: step / 4, len: Math.max(0.2, Math.min(len, gap)) };
  });
}

/** A contour in steps of the melodic set: mostly steps, a leap now and then, leaps filled. */
export function contour(
  rng: Rng,
  count: number,
  leap: number,
  shape: Shape,
): number[] {
  const out: number[] = [];
  let pos = 0;
  for (let i = 1; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const target = shapeAt(shape, t) * 4;
    const toward = Math.sign(target - pos) || (rng.chance(0.5) ? 1 : -1);
    const prev = out.at(-1) ?? 0;
    let move: number;
    if (Math.abs(prev) >= 2)
      move = -Math.sign(prev); // fill the gap a leap left
    else if (rng.chance(leap)) move = toward * rng.int(2, 4);
    else if (rng.chance(0.18)) move = 0;
    else move = rng.chance(0.75) ? toward : -toward;
    out.push(move);
    pos += move;
  }
  return out;
}

export type Shape = "arch" | "rise" | "fall" | "wave" | "valley" | "flat";

function shapeAt(shape: Shape, t: number): number {
  switch (shape) {
    case "arch":
      return Math.sin(Math.PI * t);
    case "rise":
      return t;
    case "fall":
      return -t;
    case "wave":
      return Math.sin(2 * Math.PI * t) * 0.7;
    case "valley":
      return -Math.sin(Math.PI * t);
    default:
      return 0;
  }
}

export type Motif = Readonly<{
  cell: Cell;
  steps: readonly number[];
  beats: number;
}>;

export function motif(
  rng: Rng,
  dna: RhythmDNA,
  beats: number,
  leap: number,
  o: Parameters<typeof rhythmCell>[3] = {},
): Motif {
  const cell = rhythmCell(rng, dna, beats, o);
  const shape = rng.pick<Shape>([
    "arch",
    "rise",
    "fall",
    "wave",
    "valley",
    "arch",
  ]);
  return { cell, steps: contour(rng, cell.length, leap, shape), beats };
}

const isStrong = (beat: number, len: number) =>
  Math.abs(beat - Math.round(beat)) < 1e-6 || len >= 0.74;

/** Move `k` steps through `set` from the nearest member of it to `pitch`. */
function stepIn(set: readonly number[], pitch: number, k: number): number {
  const at = set.indexOf(nearest(set, pitch));
  const i = Math.max(0, Math.min(set.length - 1, at + k));
  return set[i]!;
}

export type Range = Readonly<{ low: number; high: number }>;

/**
 * Play `m` from `start` beats at about `pitch`, under `chordAt`. Strong
 * notes take the nearest chord tone; the line folds back inside `range`.
 */
export function render(
  m: Motif,
  start: number,
  pitch: number,
  scale: Scale,
  chordAt: ChordAt,
  range: Range,
  vel = 0.8,
): MNote[] {
  const out: MNote[] = [];
  let p = pitch;
  m.cell.forEach(({ beat, len }, i) => {
    const at = start + beat;
    const chord = chordAt(at);
    const set = ladder(melodicSet(scale, chord), range.low, range.high);
    const tones = ladder(chord.triad, range.low, range.high);
    let step = i === 0 ? 0 : m.steps[i - 1]!;
    // Turn around before the edge rather than pinning to it.
    const here = stepIn(set, p, 0);
    if (
      set.indexOf(here) + step < 1 ||
      set.indexOf(here) + step > set.length - 2
    )
      step = -step;
    p = stepIn(set, p, step);
    if (isStrong(beat, len) && tones.length) p = nearest(tones, p);
    out.push({
      beat: at,
      len,
      pitch: p,
      vel: vel * (isStrong(beat, len) ? 1 : 0.86),
    });
  });
  return out;
}

/** The motif with its last `tail` notes re-drawn: the classic A' ending. */
export function varyTail(
  rng: Rng,
  m: Motif,
  tail: number,
  leap: number,
): Motif {
  const keep = m.steps.slice(0, Math.max(0, m.steps.length - tail));
  const fresh = contour(
    rng,
    tail + 1,
    leap,
    rng.pick<Shape>(["fall", "rise", "arch"]),
  );
  return { ...m, steps: [...keep, ...fresh].slice(0, m.cell.length - 1) };
}

/** The motif upside down. */
export const invert = (m: Motif): Motif => ({
  ...m,
  steps: m.steps.map((s) => -s),
});

/** The motif shifted later by `by` beats inside its own span (a displacement). */
export function displace(m: Motif, by: number): Motif {
  const cell = m.cell
    .map(({ beat, len }) => ({ beat: beat + by, len }))
    .filter(({ beat }) => beat < m.beats);
  return { ...m, cell, steps: m.steps.slice(0, Math.max(0, cell.length - 1)) };
}

export type PhrasePlan =
  "AABA" | "ABAC" | "AAAB" | "ABAB" | "AA'AB" | "ABCA" | "AB" | "AA'" | "A";

/**
 * A phrase of `units` motif-lengths from motif `a`. B and C are new cells
 * of the same length; A' changes the tail. Each unit starts on a chord tone
 * near where the last one began, so repeats sequence with the harmony.
 */
export function phrase(
  rng: Rng,
  a: Motif,
  plan: PhrasePlan,
  dna: RhythmDNA,
  leap: number,
  scale: Scale,
  chordAt: ChordAt,
  range: Range,
  startPitch: number,
  o: Readonly<{ vel?: number; endHold?: boolean }> = {},
): MNote[] {
  const b = motif(rng, dna, a.beats, leap, {
    density: dna.density * rng.range(0.6, 1.3),
    hold: true,
  });
  const c = rng.chance(0.5)
    ? invert(a)
    : motif(rng, dna, a.beats, leap, { late: true });
  const aa = varyTail(rng, a, Math.min(3, a.cell.length - 1), leap);
  const units: Motif[] = plan
    .replace("A'", "a")
    .split("")
    .map((ch) => (ch === "A" ? a : ch === "a" ? aa : ch === "B" ? b : c));
  const out: MNote[] = [];
  let anchor = startPitch;
  units.forEach((m, i) => {
    const start = i * a.beats;
    const tones = ladder(chordAt(start).triad, range.low, range.high);
    const from = tones.length ? nearest(tones, anchor) : anchor;
    const notes = render(m, start, from, scale, chordAt, range, o.vel ?? 0.8);
    out.push(...notes);
    if (i === 0) anchor = from;
  });
  if (o.endHold && out.length) {
    // The phrase breathes: its last note holds toward the end of the span.
    const last = out.at(-1)!;
    const end = units.length * a.beats;
    last.len = Math.max(last.len, Math.min(end - last.beat - 0.25, 2));
    const tones = ladder(chordAt(last.beat).triad, range.low, range.high);
    if (tones.length) last.pitch = nearest(tones, last.pitch);
  }
  return out;
}

// ------------------------------------------------------- counterpoint

/** Notes sounding at `beat` across `voices`. */
function sounding(
  voices: readonly (readonly MNote[])[],
  beat: number,
): number[] {
  const out: number[] = [];
  for (const v of voices)
    for (const n of v)
      if (n.beat <= beat + 1e-6 && n.beat + n.len > beat + 1e-6)
        out.push(n.pitch);
  return out;
}

const prevAt = (voice: readonly MNote[], beat: number) =>
  [...voice].reverse().find((n) => n.beat < beat - 1e-6);

/**
 * A line against `against`: on strong beats consonant with every sounding
 * note (no 4th over the bass), on weak beats stepwise; contrary motion and
 * steps preferred, parallel 5ths and octaves avoided. `heat` is the
 * sampling temperature: 0 always takes the best note, 1 picks loosely.
 */
export function counterLine(
  rng: Rng,
  cell: Cell,
  start: number,
  against: readonly (readonly MNote[])[],
  pcs: (beat: number) => readonly number[],
  range: Range,
  first: number,
  heat = 0.35,
  vel = 0.7,
): MNote[] {
  const out: MNote[] = [];
  let p = first;
  for (const { beat, len } of cell) {
    const at = start + beat;
    const set = ladder(pcs(at), range.low, range.high);
    const others = sounding(against, at);
    const strong = isStrong(beat, len);
    const lowest = others.length ? Math.min(...others) : undefined;
    const scored = set
      .filter((q) => Math.abs(q - p) <= 7)
      .map((q) => {
        let score = 0;
        const move = q - p;
        score -= Math.abs(move) <= 2 ? 0 : Math.abs(move) <= 4 ? 1 : 2.5;
        if (move === 0) score -= 0.8;
        for (const o of others) {
          const cons = q > o ? consonant(q, o) : consonant(o, q);
          if (q === o) score -= 3;
          if (strong && !cons) score -= 8;
          else if (!strong && !cons && Math.abs(move) > 2) score -= 4;
          if ([1, 11].includes(ic(q, o))) score -= 6;
        }
        if (strong && lowest !== undefined && q > lowest && ic(q, lowest) === 5)
          score -= 5;
        for (const v of against) {
          const before = prevAt(v, at);
          const now = v.find((n) => Math.abs(n.beat - at) < 1e-6);
          if (before && now && out.length) {
            const was = ic(out.at(-1)!.pitch, before.pitch);
            const is = ic(q, now.pitch);
            if ((was === 7 && is === 7) || (was === 0 && is === 0)) score -= 6;
            const mine = Math.sign(q - out.at(-1)!.pitch);
            const theirs = Math.sign(now.pitch - before.pitch);
            if (mine && theirs && mine !== theirs) score += 0.8;
          }
        }
        return { q, score };
      })
      .sort((x, y) => y.score - x.score);
    if (!scored.length) continue;
    const top = scored
      .filter((s) => s.score >= scored[0]!.score - 2 * heat - 1e-6)
      .slice(0, heat > 0 ? 3 : 1);
    const weights = top.map((s) =>
      Math.exp((s.score - scored[0]!.score) / Math.max(0.05, heat)),
    );
    p = top[rng.index(weights)]!.q;
    out.push({ beat: at, len, pitch: p, vel: vel * (strong ? 1 : 0.85) });
  }
  return out;
}

/** A rhythm that moves where `line` holds and holds where it moves. */
export function complement(
  rng: Rng,
  line: readonly MNote[],
  start: number,
  beats: number,
): Cell {
  const out: { beat: number; len: number }[] = [];
  for (let b = 0; b < beats; b += 0.5) {
    const at = start + b;
    const busy = line.some(
      (n) => n.beat >= at - 1e-6 && n.beat < at + 0.5 - 1e-6 && n.len < 0.5,
    );
    if (busy) {
      if (Math.abs(b - Math.round(b)) < 1e-6)
        out.push({ beat: b, len: rng.chance(0.5) ? 1 : 0.5 });
    } else {
      out.push({ beat: b, len: 0.25 });
      if (rng.chance(0.5)) out.push({ beat: b + 0.25, len: 0.25 });
    }
  }
  // Merge notes swallowed by the long ones.
  const merged: { beat: number; len: number }[] = [];
  for (const n of out) {
    const prev = merged.at(-1);
    if (prev && n.beat < prev.beat + prev.len - 1e-6) continue;
    merged.push(n);
  }
  return merged.map((n, i) => ({
    ...n,
    len: Math.min(n.len, (merged[i + 1]?.beat ?? beats) - n.beat) * 0.92,
  }));
}

// --------------------------------------------------------------- fugue

export type Fugue = Readonly<{
  /** Voices from the top down. */
  voices: readonly MNote[][];
  bars: number;
  subject: readonly MNote[];
}>;

/** A degree-space transposition inside the scale (an answer at the fifth is +4). */
function transpose(
  scale: Scale,
  notes: readonly MNote[],
  degrees: number,
  shift = 0,
): MNote[] {
  const all = ladder(scale.pcs, 24, 108);
  return notes.map((n) => {
    const i = all.indexOf(nearest(all, n.pitch));
    return {
      ...n,
      beat: n.beat + shift,
      pitch: all[Math.max(0, Math.min(all.length - 1, i + degrees))]!,
    };
  });
}

/**
 * A fugue exposition for `count` voices over `bars` (4 or 8): the subject,
 * the answer at the fifth over a countersubject, the subject again in the
 * bass, then an episode in sequence that cadences home. Every line stays in
 * the song's key; only the voices' scale degrees move.
 */
export function fugue(
  rng: Rng,
  scale: Scale,
  dna: RhythmDNA,
  bars: 4 | 8,
  count: 2 | 3,
): Fugue {
  const unit = bars === 8 ? 8 : 4; // subject length in beats
  const top: Range = { low: scale.root + 7, high: scale.root + 26 };
  const pcs = () => scale.pcs;
  // The subject: a clear head (a leap or a held note), a running tail
  // that falls to the fifth so the answer can enter on it.
  const head = rng.pick([
    [
      { beat: 0, len: 1 },
      { beat: 1, len: 0.5 },
      { beat: 1.5, len: 0.5 },
    ],
    [
      { beat: 0, len: 0.5 },
      { beat: 0.5, len: 0.5 },
      { beat: 1, len: 1 },
    ],
    [
      { beat: 0.5, len: 0.5 },
      { beat: 1, len: 0.5 },
      { beat: 1.5, len: 0.5 },
    ],
    [
      { beat: 0, len: 1.5 },
      { beat: 1.5, len: 0.25 },
      { beat: 1.75, len: 0.25 },
    ],
  ]);
  const tail = rhythmCell(
    rng,
    { ...dna, density: 3.2, syncopation: 0.1, tresillo: 0 },
    unit - 2,
    { legato: 0.95 },
  ).map((n) => ({ beat: n.beat + 2, len: n.len }));
  const cell = [...head, ...tail];
  const degrees: number[] = [];
  let d = rng.pick([0, 0, 4]);
  const headLeap = rng.pick([2, 4, 3, -3]);
  cell.forEach((_, i) => {
    if (i === 1) d += headLeap;
    else if (i > 1) {
      const left = cell.length - i;
      const goal = 4 - d; // drift toward the fifth
      d +=
        left <= 3
          ? Math.sign(goal) || -1
          : rng.chance(0.25)
            ? rng.pick([2, -2, 3])
            : rng.chance(0.62)
              ? -1
              : 1;
    }
    degrees.push(d);
  });
  const ladderTop = ladder(scale.pcs, 24, 108);
  const base = ladderTop.indexOf(nearest(ladderTop, scale.root + 12));
  const subject: MNote[] = cell.map((n, i) => ({
    beat: n.beat,
    len: n.len * 0.95,
    pitch: ladderTop[base + degrees[i]!]!,
    vel: i === 0 ? 0.9 : 0.75,
  }));
  const answer = transpose(scale, subject, 4, unit);
  // Countersubject: written against the subject, so it can sit under the answer.
  const csCell = complement(rng, subject, 0, unit);
  const cs = counterLine(
    rng,
    csCell,
    0,
    [subject],
    pcs,
    { low: scale.root, high: scale.root + 14 },
    scale.root + 4,
    0.25,
    0.65,
  );
  const voices: MNote[][] = [[], [], []];
  voices[0]!.push(...subject);
  voices[1]!.push(...answer.map((n) => ({ ...n, pitch: n.pitch - 12 })));
  voices[0]!.push(
    ...transpose(scale, cs, 4, unit).map((n) => ({
      ...n,
      pitch: n.pitch + 12,
    })),
  );
  const totalBeats = bars * 4;
  if (count === 3) {
    const bass = transpose(scale, subject, -7, 2 * unit);
    voices[2]!.push(...bass);
    voices[1]!.push(
      ...counterLine(
        rng,
        complement(rng, bass, 2 * unit, unit),
        2 * unit,
        [bass],
        pcs,
        { low: scale.root - 3, high: scale.root + 12 },
        scale.root + 4,
        0.3,
        0.62,
      ),
    );
    voices[0]!.push(
      ...counterLine(
        rng,
        rhythmCell(rng, { ...dna, density: 1.6 }, unit, { legato: 0.95 }),
        2 * unit,
        [bass, voices[1]!.filter((n) => n.beat >= 2 * unit)],
        pcs,
        top,
        voices[0]!.at(-1)!.pitch,
        0.3,
        0.7,
      ),
    );
  }
  // Episode: the subject's head in falling sequence, imitated a beat later.
  const from = (count === 3 ? 3 : 2) * unit;
  const headNotes = subject.filter((n) => n.beat < 2);
  for (let k = 0; from + k * 2 < totalBeats - 2; k++) {
    voices[0]!.push(...transpose(scale, headNotes, -k, from + k * 2));
    const imitation = transpose(
      scale,
      headNotes,
      -k - 2,
      from + k * 2 + 1,
    ).filter((n) => n.beat < totalBeats - 2);
    voices[1]!.push(...imitation.map((n) => ({ ...n, pitch: n.pitch - 12 })));
  }
  // Cadence: a held tonic chord across the voices on the last two beats.
  const tonic = scale.root + 12;
  voices[0]!.push({
    beat: totalBeats - 2,
    len: 1.9,
    pitch: nearest(ladder([scale.pcs[2]!], tonic - 2, tonic + 10), tonic + 4),
    vel: 0.8,
  });
  voices[1]!.push({
    beat: totalBeats - 2,
    len: 1.9,
    pitch: nearest(ladder([scale.pcs[4]!], tonic - 12, tonic), tonic - 5),
    vel: 0.75,
  });
  if (count === 3)
    voices[2]!.push({
      beat: totalBeats - 2,
      len: 1.9,
      pitch: tonic - 24 < 36 ? tonic - 12 : tonic - 24,
      vel: 0.75,
    });
  const used = voices
    .slice(0, count)
    .map((v) =>
      v.filter((n) => n.beat < totalBeats).sort((a, b) => a.beat - b.beat),
    );
  return { voices: settleVoices(used, scale.pcs), bars, subject };
}

/**
 * Remove overlaps inside each voice, then walk the beats: where two voices
 * clash on a beat, the note that starts there moves to the nearest scale
 * tone that agrees with the rest, and a note held into the clash ends.
 */
function settleVoices(voices: MNote[][], pcs: readonly number[]): MNote[][] {
  for (const v of voices)
    for (let i = 0; i < v.length - 1; i++) {
      const gap = v[i + 1]!.beat - v[i]!.beat;
      if (v[i]!.len > gap) v[i]!.len = Math.max(0.1, gap * 0.95);
    }
  const agrees = (p: number, others: readonly number[]) =>
    others.every((o) => o !== p && (o > p ? consonant(o, p) : consonant(p, o)));
  const end = Math.max(
    0,
    ...voices.flatMap((v) => v.map((n) => n.beat + n.len)),
  );
  for (let beat = 0; beat < end; beat++) {
    // Lower voices give way first: the subject in the top voice keeps its shape.
    for (let vi = voices.length - 1; vi >= 0; vi--) {
      const n = voices[vi]!.find(
        (x) => x.beat <= beat + 1e-6 && x.beat + x.len > beat + 1e-6,
      );
      if (!n) continue;
      const others = sounding(
        voices.filter((_, j) => j !== vi),
        beat,
      );
      if (agrees(n.pitch, others)) continue;
      if (Math.abs(n.beat - beat) < 1e-6) {
        for (const delta of [1, -1, 2, -2, 3, -3, 4, -4]) {
          const q = n.pitch + delta;
          if (pcs.includes(((q % 12) + 12) % 12) && agrees(q, others)) {
            n.pitch = q;
            break;
          }
        }
      } else n.len = Math.max(0.1, beat - n.beat - 0.02);
    }
  }
  return voices;
}
