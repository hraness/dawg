/**
 * The shared hyperpop palette and arrangement moves behind the three
 * hyperpop demos (guides/hyperpop.md explains the reasoning). Each song
 * picks its own drum families, layers and moments; this file only holds the
 * sounds and the mechanical writers they share.
 */
import { bundledSample, bundledSampleRef } from "../bundled-samples.ts";
import type { AutomationPoint, NoteInput, TrackInput } from "../score.ts";
import { BAR, Composer, TPB, voice } from "./build.ts";

type Extra = Partial<NoteInput>;
type Bend = NonNullable<NoteInput["bend"]>;

/** A bar's harmony: the bass root and a close mid-register voicing. */
export type Chord = Readonly<{ bass: number; tones: readonly number[] }>;

// ---------------------------------------------------------------- lanes

const tick = (bar: number) => Math.round(bar * BAR);

/** Concatenate point lists, sort by tick, and keep the last value per tick. */
export function merge(
  ...lists: readonly (readonly AutomationPoint[])[]
): AutomationPoint[] {
  const byTick = new Map<number, number>();
  for (const list of lists)
    for (const point of list) byTick.set(point.tick, point.value);
  return [...byTick]
    .sort(([a], [b]) => a - b)
    .map(([tick, value]) => ({ tick, value }));
}

/** Each value holds until the next listed bar, then jumps. */
export const steps = (
  ...points: readonly (readonly [bar: number, value: number])[]
): AutomationPoint[] =>
  points.flatMap(([bar, value], i) =>
    i === 0
      ? [{ tick: tick(bar), value }]
      : [
          { tick: tick(bar) - 1, value: points[i - 1]![1] },
          { tick: tick(bar), value },
        ],
  );

/** Linear ramps between listed bars (a plain `lanes`, sorted). */
export const ramps = (
  ...points: readonly (readonly [bar: number, value: number])[]
): AutomationPoint[] =>
  merge(points.map(([bar, value]) => ({ tick: tick(bar), value })));

/**
 * Delay throws: the wet mix rests at `base` and opens to `peak` for
 * `beats` from each listed position (bar plus beat, as a fractional bar).
 */
export function throws(
  at: readonly number[],
  base: number,
  peak: number,
  beats = 1,
): AutomationPoint[] {
  const points: AutomationPoint[] = [{ tick: 0, value: base }];
  for (const bar of at) {
    const from = tick(bar);
    points.push(
      { tick: from - 1, value: base },
      { tick: from, value: peak },
      { tick: from + Math.round(beats * TPB) - 1, value: peak },
      { tick: from + Math.round(beats * TPB), value: base },
    );
  }
  return merge(points);
}

/** A lane resting at `base` that swells to `peak` across each [from, to). */
export function swells(
  base: number,
  peak: number,
  spans: readonly (readonly [from: number, to: number])[],
): AutomationPoint[] {
  const points: AutomationPoint[] = [{ tick: 0, value: base }];
  for (const [from, to] of spans)
    points.push(
      { tick: tick(from), value: base },
      { tick: tick(to) - 1, value: peak },
      { tick: tick(to), value: base },
    );
  return merge(points);
}

// ------------------------------------------------------------- sounds

const orbit = { orbit: { orbit: 2 } } as const;
const room = { mix: 0.12, size: 0.45, fade: 1.5, lowpass: 7500 };
const hall = { mix: 0.22, size: 0.8, fade: 3, lowpass: 6500 };

/** Recovery of the pump in seconds: a little over half a beat, as measured. */
const pump = (bpm: number, beats = 0.55) =>
  Math.round(((beats * 60) / bpm) * 1000) / 1000;

export const sounds = {
  /** The kick alone triggers the pump on orbit 2. */
  kick: (bpm: number, kit = "syn909", depth = 0.86, level = 0.62) =>
    voice("kick", "Kick", "kit", level, {
      kit,
      // Trim the boom under 45 Hz; the weight belongs at 60-120 Hz.
      filter: { type: "hpf", cutoff: 45, resonance: 0 },
      fx: { duck: { orbit: 2, depth, attack: pump(bpm), onset: 0.004 } },
    }),
  /** Muted, distorted snare: a dusty kit snare driven, then low-passed. */
  snare: (level = 0.4, kit = "lofi", extra: Partial<TrackInput> = {}) =>
    voice("snare", "Muted snare", "kit", level, {
      kit,
      filter: { type: "lpf", cutoff: 2600, resonance: 0.08 },
      fx: { distort: { type: "soft", drive: 3.2, tone: 2400, mix: 0.6 } },
      reverb: { mix: 0.07, size: 0.28, fade: 0.6 },
      humanize: { timing: 2, velocity: 4, seed: 31 },
      ...extra,
    }),
  /** Closed and open hats, rim clicks (37) for the computery taps. */
  hats: (level = 0.5, kit = "syn606", extra: Partial<TrackInput> = {}) =>
    voice("hats", "Hats & clicks", "kit", level, {
      kit,
      pan: 0.12,
      filter: { type: "hpf", cutoff: 600, resonance: 0 },
      // The hats carry the air; the references' drum stems hold far more
      // energy above 6 kHz than a 606 at full track volume gives, so a light
      // compressor adds makeup gain and a shelf brightens the top.
      fx: {
        compressor: {
          threshold: -18,
          ratio: 1.6,
          attack: 0.002,
          release: 0.08,
          makeup: 7,
        },
        eq: { high: 8, highfreq: 8000 },
      },
      humanize: { timing: 5, velocity: 6, seed: 32 },
      ...extra,
    }),
  /** Water drops: a sine with an upward bend and a dotted-eighth echo. */
  drops: (level = 0.22, extra: Partial<TrackInput> = {}) =>
    voice("drops", "Water drops", "sine", level, {
      pan: -0.26,
      synth: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.04 },
      delay: { beats: 0.75, feedback: 0.32, mix: 0.22, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** Soft sub: no click, long release, slides where a note asks. */
  sub: (level = 0.6, extra: Partial<TrackInput> = {}) =>
    voice("sub", "Sub", "sine", level, {
      synth: {
        attack: 0.05,
        decay: 0.4,
        sustain: 0.92,
        release: 0.16,
        lpf: 900,
      },
      glide: { time: 0.12, mode: "legato" },
      // Drive puts second and third harmonics over the sine so small speakers
      // hear the line; the low-pass keeps it under the chords.
      fx: { ...orbit, distort: { type: "soft", drive: 3.2, mix: 0.5 } },
      ...extra,
    }),
  /** A saw bass that swells in and lets go slowly; also the sub's harmonics. */
  sawBass: (level = 0.36, extra: Partial<TrackInput> = {}) =>
    voice("saw", "Saw bass", "sawtooth", level, {
      synth: {
        attack: 0.09,
        decay: 0.5,
        sustain: 0.8,
        release: 0.32,
        unison: 2,
        detune: 0.08,
        lpf: 1200,
      },
      glide: { time: 0.1, mode: "legato" },
      filter: { type: "hpf", cutoff: 70, resonance: 0 },
      fx: orbit,
      ...extra,
    }),
  /** A wide soft supersaw bed that pumps hard. */
  pad: (level = 0.3, extra: Partial<TrackInput> = {}) =>
    voice("pad", "Pumping pad", "supersaw", level, {
      synth: {
        attack: 0.3,
        decay: 1,
        sustain: 0.8,
        release: 1.2,
        unison: 6,
        detune: 0.16,
        spread: 0.9,
        lpf: 3000,
      },
      filter: { type: "hpf", cutoff: 130, resonance: 0 },
      fx: {
        ...orbit,
        eq: { mid: -1.5, midfreq: 600, high: -2, highfreq: 5000 },
      },
      reverb: hall,
      ...extra,
    }),
  /** Syncopated chord stabs that sit between the kicks. */
  stabs: (level = 0.3, extra: Partial<TrackInput> = {}) =>
    voice("stabs", "Chord stabs", "supersaw", level, {
      pan: 0.06,
      synth: {
        attack: 0.003,
        decay: 0.16,
        sustain: 0.22,
        release: 0.14,
        unison: 7,
        detune: 0.24,
        spread: 0.85,
        lpf: 5200,
      },
      filter: { type: "hpf", cutoff: 200, resonance: 0 },
      fx: {
        ...orbit,
        distort: { type: "soft", drive: 1.5, mix: 0 },
        eq: { high: -2, highfreq: 6000 },
      },
      delay: { beats: 0.75, feedback: 0.2, mix: 0.07, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** Subtle high plucks: a soft triangle with a ping-pong echo. */
  pluck: (level = 0.24, extra: Partial<TrackInput> = {}) =>
    voice("pluck", "Soft pluck", "triangle", level, {
      pan: -0.18,
      synth: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.12 },
      filter: { type: "hpf", cutoff: 500, resonance: 0 },
      fx: orbit,
      delay: { beats: 0.75, feedback: 0.28, mix: 0.16, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** The upper-mid gamelan colour. */
  bells: (level = 0.26, extra: Partial<TrackInput> = {}) =>
    voice("bells", "Gangsa", "gangsa", level, {
      pan: 0.24,
      filter: { type: "hpf", cutoff: 420, resonance: 0 },
      fx: orbit,
      reverb: room,
      ...extra,
    }),
  /** Reverb-heavy strings, far behind everything. */
  strings: (level = 0.32, extra: Partial<TrackInput> = {}) =>
    voice("strings", "Hall strings", "violins", level, {
      pan: -0.08,
      filter: { type: "hpf", cutoff: 260, resonance: 0 },
      reverb: { mix: 0.46, size: 0.94, fade: 5.5, lowpass: 6000 },
      ...extra,
    }),
  /** Hard saw lead: distorted, gliding, kept under the voice. */
  lead: (level = 0.28, extra: Partial<TrackInput> = {}) =>
    voice("lead", "Hard saw", "sawtooth", level, {
      pan: 0.04,
      synth: {
        attack: 0.004,
        decay: 0.25,
        sustain: 0.75,
        release: 0.14,
        unison: 3,
        detune: 0.14,
        spread: 0.5,
        lpf: 9000,
      },
      glide: { time: 0.07, mode: "legato" },
      filter: { type: "hpf", cutoff: 280, resonance: 0 },
      fx: {
        ...orbit,
        distort: { type: "hard", drive: 2, tone: 4800, mix: 0.4 },
      },
      delay: { beats: 0.75, feedback: 0.3, mix: 0.16, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** A subtle band-passed noise layer for sweeps under the drums. */
  sweep: (level = 0.12, extra: Partial<TrackInput> = {}) =>
    voice("sweep", "Noise sweep", "white", level, {
      pan: 0.1,
      synth: { attack: 0.2, decay: 0.2, sustain: 1, release: 0.5 },
      filter: { type: "bpf", cutoff: 900, resonance: 0.25 },
      reverb: hall,
      ...extra,
    }),
} as const;

// ------------------------------------------------------------- voices

/** Pitch slots of the vocal lines (oneshot voices sort by name). */
export const LINE_A = 36;
export const LINE_B = 37;
/** Pitch slots of the three chop syllables, in sung order. */
export const CHOP = [36, 37, 38] as const;
/** Beats of consonant kept ahead of a chop's vowel (slices hold 0.25). */
const CHOP_LEAD = 0.1;
/** The hook files are 20.5 beats long; a beat as a fraction of the file. */
const HOOK_BEAT = 1 / 20.5;
const frac = (x: number) => Math.round(x * 1e5) / 1e5;

const sliceOf = (id: string, name: string) => {
  const slice = bundledSample(id)?.slices.find((s) => s.name === name);
  if (!slice) throw new Error(`demo slice missing: ${id}/${name}`);
  return slice;
};

/** The two sung lines as oneshot slots, with delay throws and a room. */
export function vocalTrack(
  sample: string,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const ref = bundledSampleRef(sample);
  const window = (name: string) => {
    const { begin, end } = sliceOf(sample, name);
    return { ...ref, begin, end, fadeTime: 0.03, fadeInTime: 0.003 };
  };
  return voice("vox", "Hook vocal", "sampler", level, {
    sampler: {
      mode: "oneshot",
      voices: { lineA: window("line-a"), lineB: window("line-b") },
    },
    filter: { type: "hpf", cutoff: 170, resonance: 0 },
    // Presence and air, then levelled hard: the hook sits on top of the mix.
    fx: {
      eq: { mid: 2, midfreq: 3200, high: 5, highfreq: 8000 },
      compressor: {
        threshold: -24,
        ratio: 4,
        attack: 0.004,
        release: 0.1,
        makeup: 8,
      },
      // While a line sings, the bed on orbit 2 sits about 2.5 dB lower.
      duck: { orbit: 2, depth: 0.25, attack: 0.6, onset: 0.08, hold: true },
    },
    delay: { beats: 1, feedback: 0.38, mix: 0.04 },
    reverb: { mix: 0.16, size: 0.6, fade: 2.2, lowpass: 11000 },
    ...extra,
  });
}

/**
 * The three held syllables as cut-to-length oneshots: stutters, repitches
 * (note cents) and flicks (note bends) on a ducked, crushable track.
 */
export function chopTrack(
  sample: string,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const ref = bundledSampleRef(sample);
  const names = bundledSample(sample)!
    .slices.slice(2)
    .map((s) => s.name);
  const voices = Object.fromEntries(
    names.map((name, i) => {
      const { begin, end } = sliceOf(sample, name);
      return [
        `c${i + 1}_${name}`,
        {
          ...ref,
          begin: frac(begin + (0.25 - CHOP_LEAD) * HOOK_BEAT),
          end,
          clip: 1,
          fadeTime: 0.018,
          fadeInTime: 0.002,
        },
      ];
    }),
  );
  return voice("chops", "Vocal chops", "sampler", level, {
    sampler: { mode: "oneshot", voices },
    pan: -0.1,
    filter: { type: "hpf", cutoff: 260, resonance: 0 },
    fx: {
      ...orbit,
      crush: { bits: 16, coarse: 1, mix: 0 },
      eq: { mid: 2, midfreq: 3200, high: 3, highfreq: 8000 },
    },
    delay: { beats: 0.5, feedback: 0.28, mix: 0.07, pingpong: true },
    reverb: room,
    ...extra,
  });
}

/**
 * One sung vowel looped into a playable voice: keyed from its sung pitch,
 * so chords and lines stay clearly a voice while moving like a synth.
 */
export function vocalSynthTrack(
  sample: string,
  chop: 0 | 1 | 2,
  root: number,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const ref = bundledSampleRef(sample);
  const name = bundledSample(sample)!.slices[2 + chop]!.name;
  const { begin, end } = sliceOf(sample, name);
  // The vowel holds from about 0.3 to 0.75 beats after the syllable's beat
  // (the slice opens a quarter beat early); start just before the vowel.
  return voice("vsynth", "Voice synth", "sampler", level, {
    sampler: {
      mode: "keyed",
      voices: {
        [name]: {
          ...ref,
          root,
          begin: frac(begin + (0.25 - CHOP_LEAD) * HOOK_BEAT),
          end,
          loop: true,
          loopBegin: frac(begin + 0.55 * HOOK_BEAT),
          loopEnd: frac(begin + 0.95 * HOOK_BEAT),
          fadeTime: 0.22,
          fadeInTime: 0.012,
        },
      },
    },
    pan: 0.16,
    filter: { type: "hpf", cutoff: 300, resonance: 0 },
    fx: { ...orbit, eq: { high: 3, highfreq: 7000 } },
    delay: { beats: 0.75, feedback: 0.28, mix: 0.1, pingpong: true },
    reverb: hall,
    ...extra,
  });
}

// ------------------------------------------------------------- writers

/** Drum families measured in the reference set (see guides/hyperpop.md). */
export type DrumFamily =
  | "four" // four-floor, paired 16th offbeat hats
  | "house" // four-floor, offbeat open hats
  | "half" // half-time: snare on three
  | "trap" // syncopated kick, snare on two and four
  | "tresillo" // 3-3-2 kick with an open hat on step 12
  | "broken" // broken kick, single taps
  | "taps" // hat taps and clicks only
  | "none";

type Grid = Readonly<{
  kick?: string;
  snare?: string;
  hat?: string;
  open?: string;
  rim?: string;
}>;

const FAMILIES: Readonly<Record<DrumFamily, readonly Grid[]>> = {
  four: [
    {
      kick: "9...8...9...8...",
      snare: "....7.......8...",
      hat: "..74..74..75..74",
    },
    {
      kick: "9...8...9...8...",
      snare: "....7.......8...",
      hat: "..74..74..75.474",
      rim: ".............3..",
    },
  ],
  house: [
    {
      kick: "9...8...9...8...",
      snare: "....7.......8...",
      hat: "3.2.3.2.3.2.3.2.",
      open: "..6...6...6...6.",
    },
    {
      kick: "9...8...9...8..5",
      snare: "....7.......8...",
      hat: "3.2.3.2.3.223.2.",
      open: "..6...6...6...6.",
    },
  ],
  half: [
    {
      kick: "9......7..6.....",
      snare: "........8.......",
      hat: "5.3.4.3.5.3.4.3.",
    },
    {
      kick: "9......7..6...5.",
      snare: "........8.......",
      hat: "5.3.4.3.5.3.4334",
      rim: "...3.......3....",
    },
  ],
  trap: [
    {
      kick: "9......7..8.....",
      snare: "....8.......8...",
      hat: "4.3.4.3.4.3.4.3.",
    },
    {
      kick: "9......7..8...6.",
      snare: "....8.......8...",
      hat: "4.3.4.3.4.343434",
    },
  ],
  tresillo: [
    {
      kick: "9..7...8..7..6..",
      snare: "....7.......8...",
      hat: "6.4.6.4.6.4.4.4.",
      open: "............6...",
    },
    {
      kick: "9..7...8..7..6..",
      snare: "....7.......8..4",
      hat: "6.4.6.4.6.4.4.44",
      open: "............6...",
      rim: "......3.........",
    },
  ],
  broken: [
    {
      kick: "8...76....7.....",
      snare: "....7.......8...",
      hat: "6.3.6.3.6.3.6.3.",
    },
    {
      kick: "8...76....7...5.",
      snare: "....7..3....8...",
      hat: "6.3.6.3.6.336.3.",
    },
  ],
  taps: [
    { hat: "4.2.3.2.4.2.3.2.", rim: "......3.......3." },
    { hat: "4.2.3.234.2.3.2.", rim: "..3...........3." },
  ],
  none: [{}],
};

/**
 * One bar of a drum family at `energy` (velocity scale). `variant` picks the
 * family's alternate bar; `parts` restricts which voices play.
 */
export function drums(
  s: Composer,
  bar: number,
  family: DrumFamily,
  energy = 1,
  variant = 0,
  parts: readonly ("kick" | "snare" | "hat" | "open" | "rim")[] = [
    "kick",
    "snare",
    "hat",
    "open",
    "rim",
  ],
): void {
  const grids = FAMILIES[family];
  const g = grids[variant % grids.length]!;
  const on = (part: (typeof parts)[number]) => parts.includes(part);
  if (g.kick && on("kick")) s.grid("kick", bar, 36, g.kick, energy);
  if (g.snare && on("snare")) s.grid("snare", bar, 38, g.snare, energy);
  if (g.hat && on("hat")) s.grid("hats", bar, 42, g.hat, energy);
  if (g.open && on("open")) s.grid("hats", bar, 46, g.open, energy);
  if (g.rim && on("rim")) s.grid("hats", bar, 37, g.rim, energy);
}

/**
 * Notes on a 16-step grid; each runs to the next onset (or `hold` steps).
 * `pitches` gives one pitch per onset, cycling.
 */
export function rhythm(
  s: Composer,
  track: string,
  bar: number,
  grid: string,
  pitches: readonly number[],
  opts: Readonly<{
    velocity?: number;
    hold?: number;
    gap?: number;
    extra?: (i: number) => Extra;
  }> = {},
): void {
  const onsets = [...grid].flatMap((c, i) => (c === "." ? [] : [i]));
  onsets.forEach((step, i) => {
    const next = onsets[i + 1] ?? 16;
    const steps = opts.hold ?? next - step;
    const digit = Number(grid[step]);
    const velocity = Number.isFinite(digit)
      ? digit / 10
      : (opts.velocity ?? 0.6);
    s.note(
      track,
      bar,
      step / 4,
      pitches[i % pitches.length]!,
      Math.max(0.05, steps / 4 - (opts.gap ?? 0.02)),
      velocity * (Number.isFinite(digit) ? (opts.velocity ?? 1) : 1),
      opts.extra?.(i) ?? {},
    );
  });
}

/**
 * A one-bar cell repeated bar after bar over [from, to): the chop riff as an
 * instrument, the way the references loop a sliced phrase for a whole drop.
 * Every `every`th bar (counted from `from`) runs `turn` instead when given.
 */
export function loop(
  from: number,
  to: number,
  cell: (bar: number, i: number) => void,
  turn?: (bar: number, i: number) => void,
  every = 4,
): void {
  for (let bar = from, i = 0; bar < to; bar++, i++)
    if (turn && i % every === every - 1) turn(bar, i);
    else cell(bar, i);
}

/** A held chord (pads, strings, voice synth). */
export function hold(
  s: Composer,
  track: string,
  bar: number,
  beat: number,
  pitches: readonly number[],
  beats: number,
  velocity = 0.55,
): void {
  for (const pitch of pitches) s.note(track, bar, beat, pitch, beats, velocity);
}

/** A sung line, triggered a quarter beat early so its consonants lead in. */
export function line(
  s: Composer,
  bar: number,
  which: "a" | "b",
  velocity = 0.8,
): void {
  s.note("vox", bar, -0.25, which === "a" ? LINE_A : LINE_B, 8.25, velocity);
}

/**
 * A chop: syllable 0..2 with its vowel at bar/beat for `beats`, optionally
 * repitched (cents) and bent. The trigger leads by the consonant run-in.
 */
export function chop(
  s: Composer,
  bar: number,
  beat: number,
  syllable: 0 | 1 | 2,
  beats: number,
  velocity = 0.75,
  extra: Extra = {},
): void {
  s.note(
    "chops",
    bar,
    beat - CHOP_LEAD,
    CHOP[syllable],
    beats + CHOP_LEAD,
    velocity,
    extra,
  );
}

/** Stutter: `count` repeats of a syllable, each `step` beats, ramping. */
export function stutter(
  s: Composer,
  bar: number,
  beat: number,
  syllable: 0 | 1 | 2,
  count: number,
  step: number,
  from = 0.55,
  to = 0.8,
  cents: (i: number) => number = () => 0,
): void {
  for (let i = 0; i < count; i++)
    chop(
      s,
      bar,
      beat + i * step,
      syllable,
      step * 0.92,
      from + ((to - from) * i) / Math.max(1, count - 1),
      cents(i) ? { cents: cents(i) } : {},
    );
}

/** DJ-style ornaments as note bends. */
export const flick = {
  /** A fast scoop up into the note. */
  up: (cents = -1200, at = 0.06): Extra => ({
    bend: [
      { at: 0, cents },
      { at, cents: 0 },
    ] as Bend,
  }),
  /** A late fall off the end. */
  fall: (cents = -700, from = 0.75): Extra => ({
    bend: [
      { at: 0, cents: 0 },
      { at: from, cents: 0 },
      { at: 1, cents },
    ] as Bend,
  }),
  /** A pitch-shift wobble: quick alternations, as a controller flick. */
  wobble: (cents = 200, count = 6, from = 0.2): Extra => ({
    bend: [
      { at: 0, cents: 0 },
      { at: from, cents: 0 },
      ...Array.from({ length: count }, (_, i) => ({
        at: from + ((1 - from) * (i + 1)) / (count + 1),
        cents: i % 2 ? 0 : cents,
      })),
      { at: 1, cents: 0 },
    ] as Bend,
  }),
  /** Octave dive (tape stop). */
  dive: (cents = -1200, from = 0.3): Extra => ({
    bend: [
      { at: 0, cents: 0 },
      { at: from, cents: 0 },
      { at: 1, cents },
    ] as Bend,
  }),
};

/** A water drop: a tiny sine that bends up. */
export function drop(
  s: Composer,
  bar: number,
  beat: number,
  pitch: number,
  velocity = 0.6,
): void {
  s.note("drops", bar, beat, pitch, 0.18, velocity, {
    bend: [
      { at: 0, cents: -900 },
      { at: 0.35, cents: 150 },
      { at: 1, cents: 300 },
    ],
  });
}

/**
 * Short dropouts: notes of `tracks` starting inside [bar+beat, +beats) are
 * removed and notes sounding into the hole are cut at its start.
 */
export function dropout(
  s: Composer,
  bar: number,
  beat: number,
  beats: number,
  tracks: readonly string[],
): void {
  const from = tick(bar) + Math.round(beat * TPB);
  const to = from + Math.round(beats * TPB);
  const set = new Set(tracks);
  for (let i = s.notes.length - 1; i >= 0; i--) {
    const note = s.notes[i]!;
    if (!set.has(note.trackId)) continue;
    const start = note.startTick ?? 0;
    const end = start + (note.durationTicks ?? 0);
    if (start >= from && start < to) s.notes.splice(i, 1);
    else if (start < from && end > from)
      s.notes[i] = {
        ...note,
        durationTicks: Math.max(30, from - start - 12),
      };
  }
}
