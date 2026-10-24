/**
 * The song chart: a hyperpop song written section by section, the way the
 * demos are. Each section brings its own chords, sung lines, hooks, layers
 * and placed moves; the performer (`perform.ts`) plays it with the demos'
 * craft. A chart names notes by scale degree and chords by diatonic
 * numeral, so it cannot leave its key: there is no way to write a key change.
 */
import type { Grammar } from "../genome/genome.ts";
import { numeral } from "../genome/music.ts";
import {
  scaleOf,
  type Chord,
  type Mode,
  type Scale,
} from "../genome/theory.ts";

export const CHART_KINDS = [
  "intro",
  "verse",
  "pre",
  "chorus",
  "drop",
  "break",
  "bridge",
  "outro",
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Drum feels: a genome grammar, half time, hats and perc only, or none. */
export type Feel = Grammar | "half" | "taps" | "none";

export const LAYERS = [
  "pad", // the bed, held, voiced under the singer
  "keys", // the bed played as rolled chords
  "stabs", // short chords above the singer
  "arp", // a 16th arpeggio on the beat
  "arp2", // a second arpeggio between the first one's notes
  "lead", // the hook instrument
  "counter", // a line that answers in the singer's rests
  "chops", // the song's own syllables sung as a riff
  "harmony", // a backing singer a chord tone under the held words
  "double", // the lead line an octave up
  "vocoder", // the sung line back as a chord
  "cloud", // a held vowel as a grain cloud
  "spark", // glass hits on the downbeats
  "sub", // the bass
] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * A line of notes from `bar` (counted from the section's first bar):
 * `rhythm` is 16ths (`x` starts a note, `-` holds it, `.` rests, up to four
 * bars), `notes` the scale degree of each note (1-7; `'` an octave up, `,`
 * down; a trailing `~` adds vibrato, `>` falls off the end, `!` keeps a
 * suspension or appoggiatura the harmony guard would otherwise move) and
 * `words` its syllables (`ne- on` joins a word, `_` holds the last vowel).
 * A note runs on to the next one when that starts within half a beat, so
 * `x.x.` is two 8ths; a longer rest is a rest.
 */
export type Line = Readonly<{
  bar: number;
  rhythm: string;
  notes: string;
  words?: string;
}>;

/** A move placed by ear (bars are counted from the section's first bar). */
export type Move =
  /** A sung syllable repeated `count` times, `step` beats apart, on the given degrees. */
  | Readonly<{
      move: "stutter";
      bar: number;
      beat: number;
      count: number;
      step: number;
      notes: string;
      word: string;
    }>
  /** Everything but the singer drops out: a spotlight. */
  | Readonly<{
      move: "dropout";
      bar: number;
      beat: number;
      beats: number;
      keep?: readonly string[];
    }>
  /** One silent beat before this section, the lead scooping in reversed. */
  | Readonly<{ move: "silence" }>
  /** The last bar turns to the tonic on beat three under a crash. */
  | Readonly<{ move: "landing" }>
  /** Everything slows to a stop over the last beats. */
  | Readonly<{ move: "tapeStop"; beats?: number }>
  /** A riser and a speeding snare roll into the next section. */
  | Readonly<{ move: "riser" }>
  /** One layer drifts from pretty to harsh across the section. */
  | Readonly<{ move: "drift"; layer: Layer }>
  /** The bed is bit-crushed over the last bar, clean on the next downbeat. */
  | Readonly<{ move: "crush" }>
  /** The singer's formant lifts over the last half beat. */
  | Readonly<{ move: "formant" }>
  /** A held note on `track` dives an octave. */
  | Readonly<{ move: "dive"; track: string; bar: number; beat: number }>;

export type Sounds = Readonly<{
  pad: string;
  stab: string;
  arp: string;
  arp2: string;
  lead: string;
  counter: string;
  bass: string;
  singer: string;
  kit: Readonly<{ kick: string; snare: string; hats: string }>;
  /** Shading for every sound (0..1 each). */
  design: Readonly<{
    brightness: number;
    grit: number;
    space: number;
    width: number;
    echo: number;
  }>;
}>;

export type BassHabit =
  | "lock" // on the kick, sliding between roots, approach notes and octave pops
  | "hold" // the root held across the bar
  | "offbeat" // on the offbeat 8ths
  | "rolling" // 16ths with accents
  | "walk"; // held, each root reached by the nearest octave

export type ChartSection = Readonly<{
  kind: ChartKind;
  name: string;
  /** At most eight. */
  bars: number;
  /** One numeral per bar, cycling; `IV-V` splits a bar at beat three. */
  chords: string;
  drums: Feel;
  /** The second half's feel, when it changes. */
  drums2?: Feel;
  /** 0..1: how hard the drums hit. */
  energy?: number;
  play: readonly Layer[];
  sing?: readonly Line[];
  /** The lead's hook. */
  hook?: readonly Line[];
  counter?: readonly Line[];
  /** A riff the chops sing on the song's syllables. */
  chops?: readonly Line[];
  /** Stab grids (16 steps, digits are accents), cycling by bar. */
  stabs?: readonly string[];
  /** Arp orders over five chord tones, cycling by bar: 8 digits 0-4. */
  arp?: readonly string[];
  bass?: BassHabit;
  /** Kick grids, cycling by bar; the 808 locks to them. */
  kick?: readonly string[];
  snare?: readonly string[];
  hats?: readonly string[];
  moves?: readonly Move[];
}>;

export type Chart = Readonly<{
  title: string;
  /** Tonic name: C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B. */
  key: string;
  mode: Mode;
  bpm: number;
  sounds: Sounds;
  sections: readonly ChartSection[];
  /** What the arrangement does, for the song's notes. */
  notes?: readonly string[];
}>;

// ------------------------------------------------------------- reading

const TONICS: Readonly<Record<string, number>> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export function chartScale(chart: Chart): Scale {
  const tonic = TONICS[chart.key];
  if (tonic === undefined) throw new Error(`chart key ${chart.key} unknown`);
  return scaleOf(tonic, chart.mode);
}

/** A note of a line, in beats from the section's first downbeat. */
export type LineNote = {
  beat: number;
  length: number;
  pitch: number;
  lyric?: string;
  vibrato: boolean;
  fall: boolean;
  /** Written on purpose against the chord: the harmony guard leaves it. */
  keep: boolean;
};

const DEGREE = /^([1-7])([',]*)([~>!]*)$/;

/** A degree token as a pitch in `scale` (degree 1 is the tonic at `scale.root`). */
export function degreeOf(scale: Scale, token: string): number {
  const m = DEGREE.exec(token);
  if (!m) throw new Error(`chart note ${token} is not a degree like 5 or 1'`);
  const octave =
    [...m[2]!].filter((c) => c === "'").length -
    [...m[2]!].filter((c) => c === ",").length;
  return scale.root + scale.steps[Number(m[1]) - 1]! + 12 * octave;
}

/** A line's notes, or an error naming what doesn't fit. */
export function readLine(scale: Scale, line: Line): LineNote[] {
  const rhythm = line.rhythm.replace(/\s+/g, "");
  if (/[^x.\-]/.test(rhythm) || rhythm.length > 64)
    throw new Error(`rhythm ${line.rhythm} uses x - . over at most 64 steps`);
  const cells: { beat: number; length: number }[] = [];
  [...rhythm].forEach((c, i) => {
    if (c === "x") cells.push({ beat: i / 4, length: 0.25 });
    else if (c === "-" && cells.length) {
      const last = cells.at(-1)!;
      if (last.beat + last.length === i / 4) last.length += 0.25;
    }
  });
  const tokens = line.notes.trim().split(/\s+/);
  if (tokens.length !== cells.length)
    throw new Error(
      `line at bar ${line.bar}: ${cells.length} rhythm notes, ${tokens.length} degrees`,
    );
  const words = line.words?.trim().split(/\s+/);
  if (words && words.length !== cells.length)
    throw new Error(
      `line at bar ${line.bar}: ${cells.length} notes, ${words.length} syllables (${line.words})`,
    );
  return cells.map((cell, i) => {
    const token = tokens[i]!;
    return {
      beat: line.bar * 4 + cell.beat,
      length: cell.length,
      pitch: degreeOf(scale, token),
      ...(words ? { lyric: words[i]! } : {}),
      vibrato: token.includes("~"),
      fall: token.includes(">"),
      keep: token.includes("!"),
    };
  });
}

/** A section's chord at each half bar, from its numerals. */
export function readChords(scale: Scale, section: ChartSection): Chord[] {
  const bars = section.chords.trim().split(/\s+/);
  const halves: Chord[] = [];
  for (let b = 0; b < section.bars; b++) {
    const text = bars[b % bars.length]!;
    const [first, second] = text.split("-");
    const a = numeral(scale, first!);
    const z = second ? numeral(scale, second) : a;
    if (!a || !z)
      throw new Error(
        `${section.name}: ${text} is not a chord of ${scale.name} (write the mode's own chords)`,
      );
    halves.push(a, z);
  }
  return halves;
}

/** Everything wrong with a chart, as sentences; empty when it plays. */
export function checkChart(chart: Chart): string[] {
  const problems: string[] = [];
  let scale: Scale;
  try {
    scale = chartScale(chart);
  } catch (e) {
    return [(e as Error).message];
  }
  if (chart.bpm < 90 || chart.bpm > 200)
    problems.push(`tempo ${chart.bpm} is outside 90..200`);
  for (const section of chart.sections) {
    if (section.bars < 1 || section.bars > 8)
      problems.push(`${section.name}: ${section.bars} bars (1 to 8)`);
    try {
      readChords(scale, section);
    } catch (e) {
      problems.push((e as Error).message);
    }
    for (const list of [
      section.sing,
      section.hook,
      section.counter,
      section.chops,
    ])
      for (const line of list ?? []) {
        try {
          const notes = readLine(scale, line);
          const end = Math.max(...notes.map((n) => n.beat + n.length));
          if (end > section.bars * 4 + 2)
            problems.push(
              `${section.name}: a line at bar ${line.bar} runs past the section`,
            );
        } catch (e) {
          problems.push(`${section.name}: ${(e as Error).message}`);
        }
      }
  }
  return problems;
}
