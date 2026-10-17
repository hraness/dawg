/**
 * The shared hyperpop palette and song engine behind the three hyperpop
 * demos (guides/hyperpop.md explains the reasoning). A song is a list of
 * sections, each naming its chords, drum families, sung lines and the
 * 16-step cells its layers play; the engine writes the bars and the moves
 * every section kind shares (fills, reversed lead-ins, stutter builds, delay
 * throws), and each song adds its own moments on top.
 *
 * The voice is the centre of the kit and is used as an instrument as much
 * as a singer: every song has a studio "vocal book" (all its sung lines plus
 * a bank of single syllables on one pitch and a held vowel). The lines play
 * whole; the syllables play as a keyed round-robin instrument, so a riff
 * of chord tones comes out as a different syllable on every hit, doubling
 * the arps and leads; the line heads and syllables also stutter, reverse and
 * crush; and the held vowel becomes a grain cloud under the pads and a
 * looped voice-lead.
 */
import { bundledSample, bundledSampleRef } from "../bundled-samples.ts";
import {
  samplerVoiceSlots,
  type AutomationPoint,
  type NoteInput,
  type SampleRef,
  type TrackInput,
} from "../score.ts";
import { BAR, Composer, TPB, orbit, voice } from "./build.ts";

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
  for (const bar of [...at].sort((a, b) => a - b)) {
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

// ------------------------------------------------------------- sounds

const room = { mix: 0.12, size: 0.45, fade: 1.5, lowpass: 7500 };
const hall = { mix: 0.22, size: 0.8, fade: 3, lowpass: 6500 };

/** Recovery of the pump in seconds: a little over half a beat. */
const pump = (bpm: number, beats = 0.55) =>
  Math.round(((beats * 60) / bpm) * 1000) / 1000;

export const sounds = {
  /** The kick alone triggers the pump on orbit 2. */
  kick: (bpm: number, kit = "syn909", depth = 0.86, level = 0.62) =>
    voice("kick", "Kick", "kit", level, {
      kit,
      filter: { type: "hpf", cutoff: 45, resonance: 0 },
      fx: {
        distort: { type: "soft", drive: 1.6, tone: 6000, mix: 0.25 },
        duck: { orbit: 2, depth, attack: pump(bpm), onset: 0.004 },
      },
    }),
  /** A driven snare with a short room, cracking above the bed. */
  snare: (level = 0.42, kit = "syn909", extra: Partial<TrackInput> = {}) =>
    voice("snare", "Snare", "kit", level, {
      kit,
      filter: { type: "hpf", cutoff: 160, resonance: 0 },
      fx: {
        distort: { type: "soft", drive: 2.6, tone: 5200, mix: 0.45 },
        compressor: {
          threshold: -16,
          ratio: 3,
          attack: 0.003,
          release: 0.09,
          makeup: 3,
        },
      },
      reverb: { mix: 0.1, size: 0.3, fade: 0.7 },
      humanize: { timing: 2, velocity: 4, seed: 31 },
      ...extra,
    }),
  /** Closed and open hats, rim clicks (37) for the computery taps. */
  hats: (level = 0.46, kit = "syn606", extra: Partial<TrackInput> = {}) =>
    voice("hats", "Hats & clicks", "kit", level, {
      kit,
      pan: 0.12,
      filter: { type: "hpf", cutoff: 600, resonance: 0 },
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
  /** Soft sub: no click, slides where a note asks, driven for small speakers. */
  sub: (level = 0.58, extra: Partial<TrackInput> = {}) =>
    voice("sub", "Sub", "sine", level, {
      synth: {
        attack: 0.02,
        decay: 0.4,
        sustain: 0.92,
        release: 0.12,
        lpf: 900,
      },
      glide: { time: 0.1, mode: "legato" },
      fx: { ...orbit, distort: { type: "soft", drive: 3.2, mix: 0.5 } },
      ...extra,
    }),
  /** A growling detuned saw for the drops, its filter snapping per note. */
  saw: (level = 0.3, extra: Partial<TrackInput> = {}) =>
    voice("saw", "Growl bass", "sawtooth", level, {
      synth: {
        attack: 0.004,
        decay: 0.3,
        sustain: 0.6,
        release: 0.1,
        unison: 3,
        detune: 0.2,
        spread: 0.3,
        lpf: 500,
        lpenv: 2.5,
        lpdecay: 0.18,
        lpsustain: 0.2,
        lpq: 4,
      },
      glide: { time: 0.06, mode: "legato" },
      filter: { type: "hpf", cutoff: 60, resonance: 0 },
      fx: {
        ...orbit,
        distort: { type: "hard", drive: 2.4, tone: 3200, mix: 0.45 },
      },
      ...extra,
    }),
  /** A wide supersaw bed with chorus; songs move its filter by section. */
  pad: (level = 0.26, extra: Partial<TrackInput> = {}) =>
    voice("pad", "Pumping pad", "supersaw", level, {
      synth: {
        attack: 0.18,
        decay: 1,
        sustain: 0.8,
        release: 1.1,
        unison: 7,
        detune: 0.18,
        spread: 0.95,
        lpf: 4000,
      },
      filter: { type: "lpf", cutoff: 2400, resonance: 0.1 },
      fx: {
        ...orbit,
        chorus: { rate: 0.4, depth: 0.6, mix: 0.5 },
        eq: { low: -4, lowfreq: 220, mid: -1.5, midfreq: 600 },
      },
      reverb: hall,
      ...extra,
    }),
  /**
   * Hyper stabs: a seven-voice supersaw with a pitch zap and a filter snap
   * on every hit, driven and chorused, so offbeat chords cut and sparkle.
   */
  stabs: (level = 0.28, extra: Partial<TrackInput> = {}) =>
    voice("stabs", "Hyper stabs", "supersaw", level, {
      pan: 0.06,
      synth: {
        attack: 0.001,
        decay: 0.13,
        sustain: 0.12,
        release: 0.08,
        unison: 7,
        detune: 0.24,
        spread: 0.9,
        lpf: 1600,
        lpenv: 3.5,
        lpdecay: 0.12,
        lpsustain: 0.15,
        penv: 12,
        pattack: 0,
        pdecay: 0.018,
        psustain: 0,
      },
      filter: { type: "hpf", cutoff: 220, resonance: 0 },
      fx: {
        ...orbit,
        distort: { type: "soft", drive: 2.2, tone: 7000, mix: 0.3 },
        chorus: { rate: 0.8, depth: 0.55, mix: 0.45 },
        eq: { high: 1.5, highfreq: 7000 },
      },
      delay: { beats: 0.75, feedback: 0.22, mix: 0.08, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** A narrow pulse arp with a filter blip, bouncing on a dotted echo. */
  arp: (level = 0.22, extra: Partial<TrackInput> = {}) =>
    voice("arp", "Pulse arp", "pulse", level, {
      pan: -0.35,
      synth: {
        attack: 0.001,
        decay: 0.11,
        sustain: 0.05,
        release: 0.07,
        pw: 0.28,
        pwsweep: 0.25,
        pwrate: 0.3,
        lpf: 2400,
        lpenv: 2.5,
        lpdecay: 0.07,
      },
      filter: { type: "hpf", cutoff: 400, resonance: 0 },
      fx: orbit,
      delay: { beats: 0.75, feedback: 0.32, mix: 0.18, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** FM bells: an inharmonic modulator that rings, then dies to a sine. */
  bells: (level = 0.2, extra: Partial<TrackInput> = {}) =>
    voice("bells", "FM bells", "sine", level, {
      pan: 0.35,
      synth: {
        attack: 0.001,
        decay: 0.7,
        sustain: 0,
        release: 0.5,
        fm: 3.2,
        fmh: 3.5,
        fmdecay: 0.35,
        fmsustain: 0.05,
      },
      filter: { type: "hpf", cutoff: 500, resonance: 0 },
      fx: orbit,
      delay: { beats: 0.75, feedback: 0.3, mix: 0.14, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /**
   * The lead: the built-in vowel wavetable swept by an envelope, so the
   * synth says "ah-oh" like the vocal it doubles; gliding, driven, chorused.
   */
  lead: (level = 0.24, extra: Partial<TrackInput> = {}) =>
    voice("lead", "Vowel lead", "wavetable", level, {
      pan: 0.04,
      wavetable: {
        table: { src: "builtin:formant" },
        wt: 0.2,
        wtenv: 0.5,
        wtattack: 0.01,
        wtdecay: 0.25,
        wtsustain: 0.35,
        wtrate: 5.5,
        wtdepth: 0.05,
      },
      synth: {
        attack: 0.004,
        decay: 0.3,
        sustain: 0.75,
        release: 0.14,
        lpf: 7000,
      },
      glide: { time: 0.05, mode: "legato" },
      filter: { type: "hpf", cutoff: 300, resonance: 0 },
      fx: {
        ...orbit,
        distort: { type: "soft", drive: 1.8, tone: 6000, mix: 0.3 },
        chorus: { rate: 0.6, depth: 0.5, mix: 0.3 },
      },
      delay: { beats: 0.75, feedback: 0.32, mix: 0.16, pingpong: true },
      reverb: room,
      ...extra,
    }),
  /** A band-passed noise riser for builds. */
  sweep: (level = 0.14, extra: Partial<TrackInput> = {}) =>
    voice("sweep", "Noise riser", "white", level, {
      pan: 0.1,
      synth: { attack: 0.2, decay: 0.2, sustain: 1, release: 0.5 },
      filter: { type: "bpf", cutoff: 900, resonance: 0.25 },
      reverb: hall,
      ...extra,
    }),
} as const;

// ------------------------------------------------------------- voices

/** The sung parts of a vocal book, in sung order. */
export const PARTS = [
  "v1",
  "v2",
  "v3",
  "v4",
  "v5",
  "v6",
  "v7",
  "v8",
  "pre1",
  "pre2",
  "ch1",
  "ch2",
  "ch3",
] as const;
export type Part = (typeof PARTS)[number];
const partBeats = (part: Part) => (part.startsWith("ch") ? 8 : 4);

/**
 * A song's studio vocal book: the sample, the pitch its syllables were sung
 * on, the syllable names, and the beat each sung part's last word lands on
 * (where its delay throw opens).
 */
export type Book = Readonly<{
  sample: string;
  root: number;
  syllables: readonly string[];
  ends: Readonly<Record<Part, number>>;
}>;

/** Parts carry a quarter beat of lead-in before their first downbeat. */
const LEAD = 0.25;
/** Beats of consonant kept ahead of a syllable's vowel. */
const CHOP_LEAD = 0.08;
const frac = (x: number) => Math.round(x * 1e6) / 1e6;

const sliceOf = (book: Book, name: string) => {
  const slice = bundledSample(book.sample)?.slices.find((s) => s.name === name);
  if (!slice) throw new Error(`demo slice missing: ${book.sample}/${name}`);
  const beats = name === "hold" ? 4 : PARTS.includes(name as Part) ? 0 : 1;
  const span = (beats || partBeats(name as Part)) + LEAD;
  return { ...slice, beat: (slice.end - slice.begin) / span };
};

/** A syllable window: from just before its vowel to the end of its slot. */
function syllable(book: Book, name: string, extra: Partial<SampleRef> = {}) {
  const { begin, end, beat } = sliceOf(book, name);
  return {
    ...bundledSampleRef(book.sample),
    begin: frac(begin + (LEAD - CHOP_LEAD) * beat),
    end,
    clip: 1,
    fadeTime: 0.02,
    fadeInTime: 0.002,
    ...extra,
  };
}

const lineVoices = (book: Book, extra: Partial<SampleRef> = {}) =>
  Object.fromEntries(
    PARTS.map((part) => {
      const { begin, end } = sliceOf(book, part);
      return [
        part,
        {
          ...bundledSampleRef(book.sample),
          begin,
          end,
          fadeTime: 0.05,
          fadeInTime: 0.003,
          ...extra,
        },
      ];
    }),
  );

/** The pitch slot a oneshot voice plays on. */
export function slot(track: TrackInput, name: string): number {
  const found = samplerVoiceSlots({
    mode: "oneshot",
    voices: track.sampler!.voices,
  }).get(name);
  if (found === undefined) throw new Error(`demo voice missing: ${name}`);
  return found;
}

/** The lead vocal: every sung line as a oneshot, on top of the mix. */
export function vocalTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  return voice("vox", "Lead vocal", "sampler", level, {
    sampler: { mode: "oneshot", voices: lineVoices(book) },
    filter: { type: "hpf", cutoff: 170, resonance: 0 },
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
    delay: { beats: 0.75, feedback: 0.42, mix: 0.05, pingpong: true },
    reverb: { mix: 0.16, size: 0.6, fade: 2.2, lowpass: 11000 },
    ...extra,
  });
}

/** The pitched-up double: the same lines an octave up, formants half-raised. */
export function doubleTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  return voice("dbl", "Chipmunk double", "sampler", level, {
    sampler: {
      mode: "oneshot",
      voices: lineVoices(book, { shift: 12, formant: 5 }),
    },
    pan: 0.18,
    filter: { type: "hpf", cutoff: 400, resonance: 0 },
    fx: {
      ...orbit,
      eq: { high: 3, highfreq: 9000 },
      chorus: { rate: 1.1, depth: 0.5, mix: 0.4 },
    },
    delay: { beats: 0.5, feedback: 0.3, mix: 0.12, pingpong: true },
    reverb: room,
    ...extra,
  });
}

/**
 * The syllables as one keyed instrument: every syllable sits on the book's
 * root in one round-robin group, so a riff of chord tones plays a new
 * syllable on each hit and each note is cut to its own length.
 */
export function chopTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  return voice("chops", "Vocal chops", "sampler", level, {
    sampler: {
      mode: "keyed",
      voices: Object.fromEntries(
        book.syllables.map((name) => [
          name,
          { ...syllable(book, name), root: book.root, rr: "syllables" },
        ]),
      ),
    },
    pan: -0.08,
    filter: { type: "hpf", cutoff: 280, resonance: 0 },
    fx: {
      ...orbit,
      formant: { shift: 0, mix: 1 },
      crush: { bits: 10, coarse: 1, mix: 0 },
      eq: { mid: 2, midfreq: 3000, high: 3, highfreq: 8000 },
    },
    delay: { beats: 0.75, feedback: 0.4, mix: 0.22, pingpong: true },
    reverb: room,
    ...extra,
  });
}

/**
 * Stutters and reversals: each syllable cut to its note (`s_`), each played
 * backwards (`r_`), and each chorus line's head cut to its note (`h_`) for
 * "st-st-stay" pickups. Pitches are note cents.
 */
export function stutterTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const voices: Record<string, SampleRef> = {};
  for (const name of book.syllables) {
    voices[`s_${name}`] = syllable(book, name);
    const { begin, end } = sliceOf(book, name);
    voices[`r_${name}`] = {
      ...bundledSampleRef(book.sample),
      begin,
      end,
      speed: -1,
      fadeTime: 0.01,
      fadeInTime: 0.08,
    };
  }
  for (const part of ["ch1", "ch2", "ch3"] as const)
    voices[`h_${part}`] = {
      ...lineVoices(book)[part]!,
      clip: 1,
      fadeTime: 0.015,
    };
  return voice("stut", "Glitch vox", "sampler", level, {
    sampler: { mode: "oneshot", voices },
    pan: 0.12,
    filter: { type: "hpf", cutoff: 300, resonance: 0 },
    fx: {
      ...orbit,
      crush: { bits: 8, coarse: 2, mix: 0 },
      eq: { mid: 2, midfreq: 3000, high: 3, highfreq: 8000 },
    },
    delay: { beats: 0.5, feedback: 0.4, mix: 0.1, pingpong: true },
    reverb: room,
    ...extra,
  });
}

/** The held vowel looped into a playable voice that doubles the lead. */
export function voiceLeadTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const { begin, end, beat } = sliceOf(book, "hold");
  return voice("vlead", "Voice lead", "sampler", level, {
    sampler: {
      mode: "keyed",
      voices: {
        hold: {
          ...bundledSampleRef(book.sample),
          root: book.root,
          begin: frac(begin + (LEAD - CHOP_LEAD) * beat),
          end,
          loop: true,
          loopBegin: frac(begin + (LEAD + 1) * beat),
          loopEnd: frac(begin + (LEAD + 3) * beat),
          fadeTime: 0.08,
          fadeInTime: 0.006,
        },
      },
    },
    pan: -0.14,
    glide: { time: 0.05, mode: "legato" },
    filter: { type: "hpf", cutoff: 320, resonance: 0 },
    fx: { ...orbit, eq: { high: 3, highfreq: 7000 } },
    delay: { beats: 0.75, feedback: 0.3, mix: 0.14, pingpong: true },
    reverb: room,
    ...extra,
  });
}

/** The held vowel as a grain cloud, grains locked to 16ths and the chord. */
export function grainTrack(
  book: Book,
  level: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const { begin, end } = sliceOf(book, "hold");
  return voice("vgrain", "Voice cloud", "granular", level, {
    granular: {
      src: bundledSampleRef(book.sample),
      root: book.root,
      begin: frac(begin + (end - begin) * 0.2),
      end: frac(end - (end - begin) * 0.1),
      grain: 0.09,
      overlap: 3,
      pos: 0.4,
      scan: 0.2,
      spread: 0.9,
      spray: 0.05,
      jitter: 0.2,
      sync: "1/16",
      quant: "chord",
      attack: 0.3,
      release: 0.9,
      gain: 0.6,
    },
    filter: { type: "lpf", cutoff: 5200, resonance: 0.1 },
    fx: { ...orbit, chorus: { rate: 0.3, depth: 0.6, mix: 0.4 } },
    reverb: hall,
    ...extra,
  });
}

// ------------------------------------------------------------- writers

/** Drum families (see guides/hyperpop.md). */
export type DrumFamily =
  | "euro" // four-floor, a snare or clap on every beat, offbeat open hats
  | "bounce" // half-time bounce: a syncopated kick around one snare
  | "four" // four-floor, offbeat 16th hat pairs
  | "house" // four-floor, offbeat open hats
  | "half" // half-time: snare on three
  | "trap" // syncopated kick, rolling hats
  | "tresillo" // 3-3-2 kick
  | "broken" // broken kick, single taps
  | "skip" // two-step: skipping kick, ghosted snares
  | "taps" // hat taps and clicks only
  | "none";

type Grid = Readonly<{
  kick?: string;
  snare?: string;
  hat?: string;
  open?: string;
  rim?: string;
  clap?: string;
}>;

const FAMILIES: Readonly<Record<DrumFamily, readonly Grid[]>> = {
  euro: [
    {
      kick: "9...8...9...8...",
      snare: "....8.......8...",
      clap: "....7.......7...",
      open: "..7...7...7...7.",
    },
    {
      kick: "9...8...9...8..5",
      snare: "....8.......8.5.",
      clap: "....7.......7...",
      hat: "..........43....",
      open: "..7...7...7...7.",
    },
  ],
  bounce: [
    {
      kick: "9..7......8.....",
      snare: "........8.......",
      hat: "5.3.5.3.5.3.5.3.",
      rim: "......3.......3.",
    },
    {
      kick: "9..7......8..6..",
      snare: "........8.....4.",
      clap: "........6.......",
      hat: "5.3.5.3.5.3.5334",
    },
  ],
  four: [
    {
      kick: "9...8...9...8...",
      snare: "....8.......8...",
      hat: "..64..64..65..64",
    },
    {
      kick: "9...8...9...8..5",
      snare: "....8.......8.4.",
      hat: "..64..64..65.464",
      rim: "...........3....",
    },
  ],
  house: [
    {
      kick: "9...8...9...8...",
      snare: "....8.......8...",
      hat: "4...3...4...3...",
      open: "..6...6...6...6.",
    },
    {
      kick: "9...8...9...8...",
      snare: "....8.......8..4",
      hat: "4...3...4..23...",
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
      snare: "........8.....4.",
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
      kick: "9.....7...8...6.",
      snare: "....8.......8...",
      hat: "4.3.4.3.4.343434",
    },
  ],
  tresillo: [
    {
      kick: "9..7...8..7..6..",
      snare: "....8.......8...",
      hat: "6.4.6.4.6.4.4.4.",
      open: "............6...",
    },
    {
      kick: "9..7...8..7..6..",
      snare: "....8.......8..4",
      hat: "6.4.6.4.6.4.4.44",
      open: "............6...",
      rim: "......3.........",
    },
  ],
  broken: [
    {
      kick: "8...76....7.....",
      snare: "....8.......8...",
      hat: "6.3.6.3.6.3.6.3.",
    },
    {
      kick: "8...76....7...5.",
      snare: "....8..3....8...",
      hat: "6.3.6.3.6.336.3.",
    },
  ],
  skip: [
    {
      kick: "9.....7...8.....",
      snare: "....8..3....8...",
      hat: "5.35.3.35.35.3.3",
    },
    {
      kick: "9.....7.7.......",
      snare: "....8.......8.3.",
      hat: "5.35.3.35.35.335",
    },
  ],
  taps: [
    { hat: "4.2.3.2.4.2.3.2.", rim: "......3.......3." },
    { hat: "4.2.3.234.2.3.2.", rim: "..3...........3." },
  ],
  none: [{}],
};

/** One bar of a drum family at `energy`; `variant` picks the alternate bar. */
export function drums(
  s: Composer,
  bar: number,
  family: DrumFamily,
  energy = 1,
  variant = 0,
): void {
  const g = FAMILIES[family][variant % FAMILIES[family].length]!;
  if (g.kick) s.grid("kick", bar, 36, g.kick, energy);
  if (g.snare) s.grid("snare", bar, 38, g.snare, energy);
  if (g.hat) s.grid("hats", bar, 42, g.hat, energy);
  if (g.open) s.grid("hats", bar, 46, g.open, energy);
  if (g.rim) s.grid("hats", bar, 37, g.rim, energy);
  if (g.clap) s.grid("snare", bar, 39, g.clap, energy);
}

/** A snare roll over the bar: quarters to eighths to 16ths to 32nds. */
export function roll(s: Composer, bar: number, from = 0.3, to = 0.85): void {
  const hits = [0, 1, 2, 2.5, 3, 3.25, 3.5, 3.625, 3.75, 3.875];
  hits.forEach((beat, i) =>
    s.note("snare", bar, beat, 38, 0.1, from + ((to - from) * i) / hits.length),
  );
}

/**
 * Bass-line steps above the bar's root: 0 root, 1 fifth, 2 octave, 3 the
 * octave's fifth, 4 two octaves, 5 flat seventh, 6 fourth, 7 a tone below,
 * 8 ninth.
 */
const BASS_STEPS = [0, 7, 12, 19, 24, 10, 5, -2, 14] as const;

/**
 * A moving bass bar: digits pick a `BASS_STEPS` step over `root`, `-` holds,
 * `.` rests and `~` after a note slides it into the next one (an 808 glide).
 * Returns whether the bar's last note slides into the next bar.
 */
export function bassLine(
  s: Composer,
  track: string,
  bar: number,
  seq: string,
  root: number,
  velocity = 0.85,
  slideIn = false,
): boolean {
  const steps = [...seq];
  let slide = slideIn;
  steps.forEach((c, i) => {
    const r = Number(c);
    if (c === "." || c === "-" || c === "~" || !Number.isFinite(r)) return;
    let length = 1;
    while (steps[i + length] === "-") length++;
    const slides = steps[i + length] === "~";
    if (slides) length++;
    const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.88 : 0.8;
    s.note(
      track,
      bar,
      i / 4,
      root + BASS_STEPS[r]!,
      Math.max(0.1, length / 4 - (slides ? 0 : 0.03)),
      velocity * accent,
      slide ? { glide: 0.09 } : {},
    );
    slide = slides;
  });
  return slide;
}

/**
 * Glitch-burst shapes: twelve 32nds over a chord ladder that spans four
 * octaves (rungs), so a burst flies past the singer's range in a beat and
 * a half.
 */
const BURSTS: readonly (readonly number[])[] = [
  [0, 2, 4, 6, 8, 10, 12, 14, 13, 15, 17, 19],
  [19, 17, 15, 12, 14, 10, 8, 9, 5, 3, 1, 0],
  [6, 13, 2, 16, 8, 1, 12, 4, 15, 7, 10, 18],
  [10, 10, 10, 10, 12, 12, 12, 12, 15, 15, 17, 19],
  [14, 7, 14, 7, 12, 5, 12, 5, 16, 9, 18, 11],
];

/** A glitch burst on the chops from `from`, shape `n` of `BURSTS`. */
export function burst(
  s: Composer,
  bar: number,
  chord: Chord,
  n: number,
  from = 2.5,
  velocity = 0.8,
): void {
  const rungs = ladder(chord, 46, 98);
  const shape = BURSTS[n % BURSTS.length]!;
  shape.forEach((r, k) =>
    s.note(
      "chops",
      bar,
      from + k * 0.125,
      rungs[Math.min(r, rungs.length - 1)]!,
      0.1,
      velocity * (0.6 + (0.4 * k) / shape.length),
    ),
  );
}

/** Every chord tone in [low, high], ascending. */
export function ladder(chord: Chord, low: number, high: number): number[] {
  const pcs = new Set(chord.tones.map((t) => ((t % 12) + 12) % 12));
  const out: number[] = [];
  for (let p = low; p <= high; p++) if (pcs.has(p % 12)) out.push(p);
  return out;
}

/** Rung `r` of a ladder; rungs past the top climb on by octaves. */
export function rung(rungs: readonly number[], r: number): number {
  if (r < rungs.length) return rungs[r]!;
  const size = new Set(rungs.map((p) => p % 12)).size;
  return rung(rungs, r - size) + 12;
}

/**
 * A 16-step cell over a chord ladder: digits 0-9 pick a ladder rung, `-`
 * holds the previous note, `.` rests. Downbeats speak a little louder.
 */
export function cell(
  s: Composer,
  track: string,
  bar: number,
  seq: string,
  rungs: readonly number[],
  opts: Readonly<{
    velocity?: number;
    gap?: number;
    from?: number;
    lead?: number;
    extra?: (i: number, pitch: number) => Extra;
  }> = {},
): void {
  const velocity = opts.velocity ?? 0.7;
  const steps = [...seq];
  steps.forEach((c, i) => {
    if (c === "." || c === "-" || i < (opts.from ?? 0) * 4) return;
    const r = Number(c);
    if (!Number.isFinite(r)) return;
    let length = 1;
    while (steps[i + length] === "-") length++;
    const pitch = rung(rungs, r);
    const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.9 : 0.82;
    const beat = i / 4 - (opts.lead ?? 0);
    s.note(
      track,
      bar,
      bar === 0 ? Math.max(0, beat) : beat,
      pitch,
      Math.max(0.06, length / 4 - (opts.gap ?? 0.03)),
      velocity * accent,
      opts.extra?.(i, pitch) ?? {},
    );
  });
}

/** Chord stabs on a 16-step grid; digits are velocities. */
export function stab(
  s: Composer,
  track: string,
  bar: number,
  grid: string,
  tones: readonly number[],
  gain = 1,
): void {
  [...grid].forEach((c, i) => {
    const v = Number(c);
    if (c === "." || !Number.isFinite(v)) return;
    for (const pitch of tones)
      s.note(track, bar, i / 4, pitch, 0.2, (v / 10) * gain);
  });
}

/** A held chord (pads, clouds). */
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

/** DJ-style ornaments as note bends. */
export const flick = {
  /** A fast scoop up into the note. */
  up: (cents = -1200, at = 0.06): Extra => ({
    bend: [
      { at: 0, cents },
      { at, cents: 0 },
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
};

/**
 * Notes of `tracks` starting inside [bar+beat, +beats) are removed and notes
 * sounding into the hole are cut at its start.
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

// ------------------------------------------------------------- engine

export type SectionKind =
  "intro" | "verse" | "pre" | "chorus" | "post" | "break" | "build" | "outro";

/** Cells cycle bar by bar through a section; `null` rests that bar. */
type Cells = readonly (string | null)[];

export type SongSection = Readonly<{
  kind: SectionKind;
  name: string;
  bars: number;
  /** One chord per bar, cycling. */
  chords: readonly Chord[];
  /** Drum family per four-bar phrase, cycling. */
  drums: readonly DrumFamily[];
  energy?: number;
  /** The sung part starting on each bar (`null`: none), by bar. */
  lines?: readonly (Part | null)[];
  /** Layers the section plays. */
  play: readonly Layer[];
  /** Vocal-chop riff cells (ladder 55-84), cycling by bar. */
  riff?: Cells;
  /** Arp cells (ladder 69-93). */
  arp?: Cells;
  /** Bell cells (ladder 74-98). */
  bells?: Cells;
  /** Stab grids (16 digits). */
  stabs?: Cells;
  /** Sub grids (16 digits; held to the next onset). */
  bass?: Cells;
  /** Moving bass lines (`bassLine` steps); replaces `bass` where given. */
  line?: Cells;
  /** Glitch bursts on the chops close each four-bar phrase. */
  bursts?: boolean;
  /** Growl-bass cells over the bass ladder (31-55). */
  growl?: Cells;
  /** A lead phrase per bar-cycle: [beat, pitch, beats] triples. */
  lead?: readonly (readonly (readonly [number, number, number])[] | null)[];
  /** The voice lead doubles the lead an octave down. */
  voiceLead?: boolean;
}>;

export type Layer =
  | "pad"
  | "stabs"
  | "arp"
  | "bells"
  | "lead"
  | "sub"
  | "growl"
  | "riff"
  | "cloud"
  | "double";

/** Where a section sits once the song is laid out. */
export type Placed = SongSection & Readonly<{ start: number; index: number }>;

export type SongPlan = Readonly<{
  book: Book;
  sections: readonly SongSection[];
}>;

export type Song = Readonly<{
  placed: readonly Placed[];
  chordAt: (bar: number) => Chord;
  sectionAt: (bar: number) => Placed;
  /** The first bar of the section with this name. */
  at: (name: string) => number;
  /** Delay-throw positions on the lead vocal (fractional bars). */
  throwsAt: number[];
  /** Pre-chorus and build spans [from, to) the riser climbs over. */
  builds: (readonly [number, number])[];
  /** The syllable-voice slots, the line-head slots. */
  stut: (name: string) => number;
}>;

/** A composer's track by id; a missing one is a song-writing bug. */
export function trackOf(s: Composer, id: string): TrackInput {
  const track = s.tracks.find((t) => t.id === id);
  if (!track) throw new Error(`hyperpop: no track "${id}"`);
  return track;
}

const cycle = <T>(list: readonly T[] | undefined, i: number) =>
  list && list.length > 0 ? list[i % list.length] : undefined;

/**
 * Lay out a song and write every section's shared material. Tracks must
 * already be on the composer (the stutter track is read for its slots).
 */
export function writeSong(s: Composer, plan: SongPlan): Song {
  const { book } = plan;
  let start = 0;
  const placed: Placed[] = plan.sections.map((section, index) => {
    const out = { ...section, start, index };
    start += section.bars;
    return out;
  });
  const sectionAt = (bar: number) => {
    const p = placed.find((q) => bar >= q.start && bar < q.start + q.bars);
    if (!p) throw new Error(`hyperpop: bar ${bar} is outside the song`);
    return p;
  };
  const at = (name: string) => {
    const p = placed.find((q) => q.name === name);
    if (!p) throw new Error(`hyperpop: no section "${name}"`);
    return p.start;
  };
  const chordAt = (bar: number) => {
    const p = sectionAt(bar);
    return p.chords[(bar - p.start) % p.chords.length]!;
  };
  const stutTrack = trackOf(s, "stut");
  const stut = (name: string) => slot(stutTrack, name);
  const voxTrack = trackOf(s, "vox");
  const throwsAt: number[] = [];
  const builds: (readonly [number, number])[] = [];
  let slideSub = false;
  let slideSaw = false;
  let bursts = 0;

  for (const p of placed) {
    s.section(p.name, p.start, p.bars);
    const on = (layer: Layer) => p.play.includes(layer);
    const next = placed[p.index + 1];
    for (let i = 0; i < p.bars; i++) {
      const bar = p.start + i;
      const chord = chordAt(bar);
      const family = cycle(p.drums, Math.floor(i / 4)) ?? "none";
      const energy = p.energy ?? 1;
      const last = i === p.bars - 1;
      // Drums: the alternate bar every other bar; the phrase's last bar
      // turns around into the next section.
      if (family !== "none") {
        drums(s, bar, family, energy, i % 2);
        const rolls = p.kind === "pre" || p.kind === "build";
        if (
          last &&
          !rolls &&
          next &&
          next.kind !== "break" &&
          next.kind !== "outro"
        ) {
          // The fill replaces the pattern's own last-beat snares.
          dropout(s, bar, 3, 1, ["snare"]);
          for (const [beat, v] of [
            [3, 0.5],
            [3.25, 0.62],
            [3.5, 0.74],
            [3.75, 0.86],
          ] as const)
            s.note("snare", bar, beat, 38, 0.1, v * energy);
        }
      }
      // A moving line on the sub, doubled an octave up on the growl bass
      // where the section plays it; otherwise the sub holds to each onset,
      // gliding when the root moves.
      const line = cycle(p.line, i);
      if (on("sub") && p.line) {
        if (line) {
          slideSub = bassLine(s, "sub", bar, line, chord.bass, 0.85, slideSub);
          if (on("growl") && !p.growl)
            slideSaw = bassLine(
              s,
              "saw",
              bar,
              line,
              chord.bass + 12,
              0.72,
              slideSaw,
            );
        }
      } else if (on("sub")) {
        const grid = cycle(p.bass, i) ?? "9...............";
        const onsets = [...grid].flatMap((c, k) => (c === "." ? [] : [k]));
        const prev = bar > 0 ? chordAt(bar - 1).bass : chord.bass;
        onsets.forEach((k, j) => {
          const to = onsets[j + 1] ?? 16;
          s.note(
            "sub",
            bar,
            k / 4,
            chord.bass,
            (to - k) / 4 + (j === onsets.length - 1 ? 0.03 : -0.02),
            Number(grid[k]) / 10,
            j === 0 && prev !== chord.bass ? { glide: 0.08 } : {},
          );
        });
      }
      const growl = cycle(p.growl, i);
      if (on("growl") && growl)
        cell(s, "saw", bar, growl, ladder(chord, 31, 55), { velocity: 0.75 });
      if (on("pad")) hold(s, "pad", bar, 0, chord.tones, 4, 0.5);
      if (on("cloud"))
        hold(s, "vgrain", bar, 0, [chord.tones[0]! + 12], 4, 0.55);
      const stabGrid = cycle(p.stabs, i);
      if (on("stabs") && stabGrid)
        // The chord's top three tones an octave up; two where the pad
        // already holds the whole chord.
        stab(
          s,
          "stabs",
          bar,
          stabGrid,
          chord.tones.slice(on("pad") ? -2 : -3).map((t) => t + 12),
        );
      // Where the lead and the chop riff both play, the arp sits out and the
      // chops drop a fourth, so the three never pile into one register.
      const lead = cycle(p.lead, i);
      const leads = on("lead") && !!lead;
      const crowded = leads && on("riff") && !!cycle(p.riff, i);
      const arp = cycle(p.arp, i);
      if (on("arp") && arp && !crowded)
        cell(s, "arp", bar, arp, ladder(chord, 69, 93));
      const bells = cycle(p.bells, i);
      if (on("bells") && bells)
        cell(s, "bells", bar, bells, ladder(chord, 74, 98), { velocity: 0.6 });
      if (leads)
        for (const [beat, pitch, beats] of lead) {
          s.note("lead", bar, beat, pitch, beats, 0.72);
          if (p.voiceLead) s.note("vlead", bar, beat, pitch - 12, beats, 0.7);
        }
      // Sung lines; the double sings with them where the section asks.
      const part = p.lines?.[i] ?? null;
      if (part) {
        s.note(
          "vox",
          bar,
          -LEAD,
          slot(voxTrack, part),
          partBeats(part) + LEAD,
          0.82,
        );
        if (on("double"))
          s.note(
            "dbl",
            bar,
            -LEAD,
            slot(voxTrack, part),
            partBeats(part) + LEAD,
            0.7,
          );
        throwsAt.push(bar + book.ends[part] / 4);
      }
      // The chop riff answers the singer: in a bar a line is singing, only
      // the steps from just after its last word play.
      const riff = cycle(p.riff, i);
      if (on("riff") && riff) {
        let k = -1;
        (p.lines ?? []).forEach((q, j) => {
          if (q !== null && j <= i) k = j;
        });
        const owner = k >= 0 ? p.lines![k]! : null;
        const busy = owner !== null && i < k + partBeats(owner) / 4;
        const from = busy
          ? Math.max(0, book.ends[owner] - (i - k) * 4 + 0.75)
          : 0;
        if (from < 4)
          cell(
            s,
            "chops",
            bar,
            riff,
            crowded ? ladder(chord, 50, 79) : ladder(chord, 55, 84),
            {
              velocity: busy ? 0.66 : 0.78,
              from,
              lead: CHOP_LEAD,
            },
          );
      }
      // A glitch burst closes each phrase where no riff plays and no line
      // is still singing at beat 2.5.
      if (p.bursts && i % 4 === 3 && !(on("riff") && riff)) {
        const singing = (p.lines ?? []).some(
          (q, j) =>
            q !== null && j <= i && (i - j) * 4 + 2.5 < book.ends[q] + 0.5,
        );
        if (!singing) burst(s, bar, chord, bursts++);
      }
    }
    // Section seams: a reversed syllable swells into each new section but a verse,
    // and pre-choruses and builds end on a stutter of the chorus head.
    if (p.start > 0 && p.kind !== "verse") {
      const syl = book.syllables[p.index % book.syllables.length]!;
      s.note("stut", p.start - 1, 2.7, stut(`r_${syl}`), 1.3, 0.62);
    }
    if (p.kind === "pre" || p.kind === "build") {
      const bar = p.start + p.bars - 1;
      const head = stut(
        next?.lines?.[0]?.startsWith("ch") ? `h_${next.lines[0]}` : "h_ch1",
      );
      const hits = [
        0, 0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.125, 3.25, 3.375, 3.5, 3.625,
      ];
      hits.forEach((beat, k) =>
        s.note(
          "stut",
          bar,
          beat,
          head,
          (hits[k + 1] ?? 3.75) - beat - 0.02,
          0.5 + k * 0.025,
          {
            cents: Math.round((k / hits.length) * 500),
          },
        ),
      );
      dropout(s, bar, 0, 4, ["snare"]);
      roll(s, bar);
      s.note("sweep", p.start, 0, 60, p.bars * 4, 0.5);
      builds.push([p.start, p.start + p.bars]);
    }
  }
  return { placed, chordAt, sectionAt, at, throwsAt, builds, stut };
}

/** The riser's band-pass climbing across each build. */
export const riserLane = (builds: Song["builds"]): AutomationPoint[] =>
  merge(
    [{ tick: 0, value: 600 }],
    ...builds.map(([from, to]) =>
      ramps([from, 500], [to - 0.02, 7000], [to, 600]),
    ),
  );

/** Replace a track's fields once the song (and its lanes) is known. */
export function patch(
  s: Composer,
  id: string,
  extra: Partial<TrackInput>,
): void {
  const i = s.tracks.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`demo track missing: ${id}`);
  s.tracks[i] = { ...s.tracks[i]!, ...extra };
}

/** Per-song levels and patch tweaks for the kit's tracks. */
export type KitOptions = Readonly<{
  bpm: number;
  kick?: string;
  snare?: string;
  hats?: string;
  levels?: Readonly<Partial<Record<string, number>>>;
  extra?: Readonly<Partial<Record<string, Partial<TrackInput>>>>;
}>;

/** Every track the engine writes to, in mixer order. */
export function kitTracks(s: Composer, book: Book, o: KitOptions): void {
  const lv = (id: string, fallback: number) => o.levels?.[id] ?? fallback;
  const ex = (id: string) => o.extra?.[id] ?? {};
  // The voice is the lead instrument: the singer sits about 5 dB under the
  // drums and the chops and stutters about 8, over a darker bed pumped
  // harder than the kit's stand-alone defaults, the sub driven into
  // harmonics so it reads on small speakers.
  const sub: Partial<TrackInput> = {
    synth: {
      attack: 0.02,
      decay: 0.4,
      sustain: 0.92,
      release: 0.12,
      lpf: 1400,
    },
    fx: { ...orbit, distort: { type: "soft", drive: 4.5, mix: 0.6 } },
  };
  const pad: Partial<TrackInput> = {
    filter: { type: "lpf", cutoff: 1800, resonance: 0.1 },
  };
  for (const track of [
    sounds.kick(o.bpm, o.kick, 0.92, lv("kick", 0.44)),
    sounds.snare(lv("snare", 0.3), o.snare, ex("snare")),
    sounds.hats(lv("hats", 0.3), o.hats, ex("hats")),
    sounds.sub(lv("sub", 0.42), { ...sub, ...ex("sub") }),
    sounds.saw(lv("saw", 0.2), ex("saw")),
    sounds.pad(lv("pad", 0.24), { ...pad, ...ex("pad") }),
    sounds.stabs(lv("stabs", 0.28), ex("stabs")),
    sounds.arp(lv("arp", 0.2), ex("arp")),
    sounds.bells(lv("bells", 0.18), ex("bells")),
    sounds.lead(lv("lead", 0.24), ex("lead")),
    vocalTrack(book, lv("vox", 1), ex("vox")),
    doubleTrack(book, lv("dbl", 0.5), ex("dbl")),
    chopTrack(book, lv("chops", 1), ex("chops")),
    stutterTrack(book, lv("stut", 0.95), ex("stut")),
    voiceLeadTrack(book, lv("vlead", 0.5), ex("vlead")),
    grainTrack(book, lv("vgrain", 0.35), ex("vgrain")),
    sounds.sweep(lv("sweep", 0.12), ex("sweep")),
  ])
    s.track(track);
}

/**
 * A syllable riff on the stutter track: `seq` steps over the chord ladder
 * (as `cell`), each hit a named syllable re-pitched by cents from the root.
 */
export function glitch(
  s: Composer,
  song: Song,
  book: Book,
  bar: number,
  seq: string,
  syllables: readonly string[],
  velocity = 0.7,
): void {
  const rungs = ladder(song.chordAt(bar), book.root - 12, book.root + 12);
  let k = 0;
  [...seq].forEach((c, i) => {
    const r = Number(c);
    if (c === "." || c === "-" || !Number.isFinite(r)) return;
    let length = 1;
    while (seq[i + length] === "-") length++;
    let pitch = rung(rungs, r);
    while (pitch > book.root + 12) pitch -= 12;
    const name = syllables[k++ % syllables.length]!;
    s.note(
      "stut",
      bar,
      i / 4,
      song.stut(`s_${name}`),
      length / 4 - 0.02,
      velocity,
      {
        cents: (pitch - book.root) * 100,
      },
    );
  });
}

/** `count` repeats of a voice on the stutter track, ramping up in pitch. */
export function stutter(
  s: Composer,
  song: Song,
  name: string,
  bar: number,
  beat: number,
  count: number,
  step: number,
  rise = 0,
  from = 0.5,
  to = 0.8,
): void {
  for (let i = 0; i < count; i++)
    s.note(
      "stut",
      bar,
      beat + i * step,
      song.stut(name),
      step * 0.9,
      from + ((to - from) * i) / Math.max(1, count - 1),
      {
        cents: Math.round((rise * i) / Math.max(1, count - 1)),
      },
    );
}
