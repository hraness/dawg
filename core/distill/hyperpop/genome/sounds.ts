/**
 * The sound of every role, drawn per song. Each role has hand-built voices
 * (the demo palette's) and the preset catalog's, and every voice is shaded
 * by the genome's design knobs (brightness, grit, space, width, echo), so
 * two songs that draw the same lead still sound unlike each other.
 */
import { bundledSample, bundledSampleRef } from "../../../bundled-samples.ts";
import type { SampleRef, TrackInput } from "../../../score.ts";
import { orbit, preset, voice } from "../../../demos/build.ts";
import { sounds as demo } from "../../../demos/hyperpop.ts";
import type { Rng } from "./rng.ts";

export type Design = Readonly<{
  brightness: number;
  grit: number;
  space: number;
  width: number;
  echo: number;
}>;

type Make = (id: string, name: string, level: number, d: Design) => TrackInput;

const space = (d: Design, base = 0.14) => ({
  mix: base * (0.5 + d.space),
  size: 0.35 + 0.5 * d.space,
  fade: 1 + 2.4 * d.space,
  lowpass: 5500 + 5000 * d.brightness,
});
const echo = (d: Design, mix = 0.14, feedback = 0.3) => ({
  beats: d.echo,
  feedback,
  mix,
  pingpong: true,
});
const drive = (d: Design, base = 1.2) => ({
  type: "soft" as const,
  drive: base + 2 * d.grit,
  tone: 4000 + 4000 * d.brightness,
  mix: 0.15 + 0.35 * d.grit,
});
const fromPreset =
  (
    source: string,
    extra: (d: Design) => Partial<TrackInput> = () => ({}),
  ): Make =>
  (id, name, level, d) =>
    preset(id, name, source, level, {
      fx: { ...orbit },
      reverb: space(d),
      ...extra(d),
    });

// ----------------------------------------------------------------- bass

export const BASS: Readonly<Record<string, Make>> = {
  /** A long sine 808 that slides where notes overlap, driven for phones. */
  sub808: (id, name, level, d) =>
    voice(id, name, "sine", level, {
      synth: {
        attack: 0.003,
        decay: 1.4,
        sustain: 0.55,
        release: 0.25,
        lpf: 700 + 500 * d.brightness,
        penv: 7,
        pattack: 0,
        pdecay: 0.04,
        psustain: 0,
      },
      glide: { time: 0.07, mode: "legato" },
      fx: {
        ...orbit,
        distort: {
          type: "soft",
          drive: 2.4 + 2.5 * d.grit,
          tone: 2200,
          mix: 0.45,
        },
      },
    }),
  growl: (id, name, level, d) => ({
    ...demo.saw(level, {
      synth: {
        attack: 0.004,
        decay: 0.3,
        sustain: 0.6,
        release: 0.1,
        unison: 3,
        detune: 0.15 + 0.15 * d.grit,
        spread: 0.3,
        lpf: 380 + 400 * d.brightness,
        lpenv: 2.5,
        lpdecay: 0.18,
        lpsustain: 0.2,
        lpq: 4,
      },
    }),
    id,
    name,
  }),
  reese: fromPreset("reese"),
  fm: fromPreset("fm-bass"),
  pluck: fromPreset("pluck-bass"),
  fold: fromPreset("fold-bass"),
  acid: fromPreset("acid-squelch"),
  boom: fromPreset("808-boom"),
};

/** A clean sine under a characterful bass, so the low end stays solid. */
export const subTrack = (level: number): TrackInput =>
  demo.sub(level, {
    synth: { attack: 0.01, decay: 0.4, sustain: 0.9, release: 0.1, lpf: 500 },
  });

// ----------------------------------------------------------------- lead

export const LEAD: Readonly<Record<string, Make>> = {
  supersaw: fromPreset("supersaw-lead", (d) => ({ delay: echo(d, 0.14) })),
  /** Candy Fault's plastic pulse hook, its width set by the song. */
  chip: (id, name, level, d) =>
    voice(id, name, "pulse", level, {
      synth: {
        attack: 0.003,
        decay: 0.1,
        sustain: 0.32,
        release: 0.08,
        pw: 0.12 + 0.25 * d.brightness,
        lpf: 5000 + 3000 * d.brightness,
      },
      filter: { type: "hpf", cutoff: 200, resonance: 0 },
      fx: {
        ...orbit,
        distort: {
          type: "fold",
          drive: 1 + 0.6 * d.grit,
          mix: 0.2 + 0.2 * d.grit,
          tone: 6200,
        },
      },
      delay: echo(d, 0.14, 0.24),
      reverb: space(d, 0.1),
    }),
  vowel: (id, name, level, d) => ({
    ...demo.lead(level, { delay: echo(d, 0.16, 0.32), reverb: space(d, 0.12) }),
    id,
    name,
  }),
  bell: (id, name, level, d) => ({
    ...demo.bells(level, { delay: echo(d, 0.14), reverb: space(d) }),
    id,
    name,
  }),
  square: fromPreset("square-lead"),
  sync: fromPreset("sync-lead"),
  fmlead: fromPreset("fm-lead"),
  whistle: fromPreset("whistle-lead"),
  talk: fromPreset("talk-lead"),
  brass: fromPreset("synth-brass"),
  glass: fromPreset("glass-pluck", (d) => ({ delay: echo(d, 0.2) })),
  screamer: fromPreset("screamer"),
};

// ------------------------------------------------------------------ pad

export const PAD: Readonly<Record<string, Make>> = {
  supersaw: (id, name, level, d) => ({
    ...demo.pad(level, {
      filter: {
        type: "lpf",
        cutoff: 1600 + 2400 * d.brightness,
        resonance: 0.1,
      },
      reverb: space(d, 0.2),
    }),
    id,
    name,
  }),
  glass: fromPreset("glass-pad"),
  bloom: fromPreset("bloom-pad"),
  pwm: fromPreset("pwm-pad"),
  vowel: fromPreset("vowel-pad"),
  choir: fromPreset("choir-pad"),
  strings: fromPreset("synth-strings"),
  ep: fromPreset("dx-ep"),
  rhodes: fromPreset("rhodes"),
  organ: fromPreset("church-organ"),
  felt: fromPreset("felt-piano"),
};

// ------------------------------------------------------- stabs (chords)

export const STAB: Readonly<Record<string, Make>> = {
  hyper: (id, name, level, d) => ({
    ...demo.stabs(level, { delay: echo(d, 0.08, 0.22), reverb: space(d, 0.1) }),
    id,
    name,
  }),
  /** Candy Fault's sugar stack: wide, bright, a touch of crush. */
  sugar: (id, name, level, d) =>
    voice(id, name, "supersaw", level, {
      synth: {
        attack: 0.01,
        decay: 0.35,
        sustain: 0.55,
        release: 0.14,
        unison: 7,
        detune: 0.2 + 0.15 * d.grit,
        spread: 0.6 + 0.35 * d.width,
        lpf: 3200 + 3000 * d.brightness,
      },
      filter: { type: "hpf", cutoff: 160, resonance: 0 },
      fx: { ...orbit, crush: { bits: 16, coarse: 1, mix: 0 } },
      reverb: space(d, 0.1),
    }),
  brass: fromPreset("brass-stab"),
  pump: fromPreset("pumping-chords"),
  house: fromPreset("house-pluck"),
  organ: fromPreset("combo-organ"),
};

// ------------------------------------------------------------------ arp

export const ARP: Readonly<Record<string, Make>> = {
  pulse: (id, name, level, d) => ({
    ...demo.arp(level, { delay: echo(d, 0.18, 0.32), reverb: space(d, 0.1) }),
    id,
    name,
  }),
  square: (id, name, level, d) =>
    voice(id, name, "square", level, {
      pan: -0.24,
      synth: {
        attack: 0.002,
        decay: 0.09,
        sustain: 0.12,
        release: 0.05,
        lpf: 5000 + 3500 * d.brightness,
      },
      filter: { type: "hpf", cutoff: 600, resonance: 0 },
      delay: echo(d, 0.22, 0.3),
      fx: {
        ...orbit,
        chorus: { rate: 0.45, depth: 0.35, mix: 0.45 },
        crush: { bits: 16, coarse: 1, mix: 0 },
      },
    }),
  bell: (id, name, level, d) => ({
    ...demo.bells(level, { delay: echo(d, 0.16), reverb: space(d) }),
    id,
    name,
  }),
  harp: fromPreset("harp"),
  kalimba: fromPreset("kalimba"),
  marimba: fromPreset("marimba"),
  musicbox: fromPreset("music-box"),
  glock: fromPreset("glockenspiel"),
  fmbells: fromPreset("fm-bells"),
  steelpan: fromPreset("steelpan"),
  pizz: fromPreset("pizzicato"),
  koto: fromPreset("koto"),
  vibes: fromPreset("vibraphone"),
  glasspluck: fromPreset("glass-pluck"),
};

/** Fugue voices: the dry, articulate timbres counterpoint needs. */
export const BAROQUE: Readonly<Record<string, Make>> = {
  chip: LEAD.chip!,
  square: ARP.square!,
  organ: fromPreset("church-organ"),
  harp: fromPreset("harp"),
  pizz: fromPreset("pizzicato"),
  musicbox: fromPreset("music-box"),
  fmbells: fromPreset("fm-bells"),
  flute: fromPreset("flute-pipes"),
  glass: fromPreset("glass-pluck"),
};

// --------------------------------------------------------------- voices

export type Singer = Readonly<{
  formant: number;
  bright: number;
  breath: number;
  jitter: number;
  vib: number;
  ring: number;
  voice: "soprano" | "alto" | "tenor";
  preset: string;
  /** Semitones the lead line is sung above its written pitch. */
  shift: number;
}>;

export const SINGERS: Readonly<Record<string, Singer>> = {
  sung: {
    formant: 2.5,
    bright: 0.72,
    breath: 0.06,
    jitter: 0.25,
    vib: 5.6,
    ring: 0.38,
    voice: "soprano",
    preset: "aah",
    shift: 0,
  },
  chipmunk: {
    formant: 5.5,
    bright: 0.8,
    breath: 0.05,
    jitter: 0.15,
    vib: 6.2,
    ring: 0.3,
    voice: "soprano",
    preset: "aah",
    shift: 12,
  },
  robot: {
    formant: 1.5,
    bright: 0.85,
    breath: 0.02,
    jitter: 0,
    vib: 0,
    ring: 0.75,
    voice: "tenor",
    preset: "aah",
    shift: 0,
  },
  whisper: {
    formant: 3,
    bright: 0.45,
    breath: 0.55,
    jitter: 0.3,
    vib: 4.5,
    ring: 0.1,
    voice: "alto",
    preset: "ooh",
    shift: 0,
  },
  abstract: {
    formant: 3.5,
    bright: 0.7,
    breath: 0.08,
    jitter: 0.35,
    vib: 5.8,
    ring: 0.45,
    voice: "soprano",
    preset: "glass",
    shift: 0,
  },
  chopped: {
    formant: 2.5,
    bright: 0.72,
    breath: 0.06,
    jitter: 0.25,
    vib: 5.6,
    ring: 0.38,
    voice: "soprano",
    preset: "aah",
    shift: 0,
  },
};

export function singer(
  id: string,
  name: string,
  level: number,
  s: Singer,
  d: Design,
  extra: Partial<TrackInput> = {},
): TrackInput {
  return voice(id, name, "sing", level, {
    sing: {
      preset: s.preset,
      voice: s.voice,
      formant: s.formant,
      bright: s.bright,
      articulate: 1,
      breath: s.breath,
      jitter: s.jitter,
      vib: s.vib,
      vibmod: s.vib ? 0.14 : 0,
      vibdelay: 0.3,
      ring: s.ring,
    } as TrackInput["sing"],
    filter: { type: "hpf", cutoff: 230, resonance: 0 },
    fx: {
      crush: { bits: 16, coarse: 1, mix: 0 },
      eq: { mid: 2, midfreq: 3000, high: 2, highfreq: 9000 },
      compressor: {
        threshold: -20,
        ratio: 3,
        attack: 0.006,
        release: 0.12,
        makeup: 4,
      },
      duck: { orbit: 2, depth: 0.22, attack: 0.6, onset: 0.08, hold: true },
    },
    delay: echo(d, 0.08, 0.28),
    reverb: space(d, 0.12),
    humanize: { timing: 6, velocity: 5, length: 4, seed: 16 },
    ...extra,
  });
}

export function harmonySinger(
  id: string,
  name: string,
  level: number,
  s: Singer,
  d: Design,
): TrackInput {
  return voice(id, name, "sing", level, {
    pan: 0.3,
    sing: {
      preset: s.preset === "glass" ? "glass" : "aah",
      voice: "alto",
      formant: Math.max(1, s.formant - 0.5),
      bright: 0.55,
      articulate: 1,
      breath: 0.12,
      voices: 3,
      spread: 10 + 10 * d.width,
      vib: 5.2,
      vibmod: 0.1,
      vibdelay: 0.35,
    } as TrackInput["sing"],
    filter: { type: "hpf", cutoff: 300, resonance: 0 },
    fx: { ...orbit },
    reverb: space(d, 0.2),
    humanize: { timing: 9, velocity: 6, seed: 17 },
  });
}

// ---------------------------------------------------------------- chops

/** Single sung syllables from the bundled phrases, for chopped hooks. */
const SYLLABLES: readonly (readonly [sample: string, slice: string])[] = [
  ["stay-up", "stay"],
  ["stay-up", "up"],
  ["hold-on", "hold"],
  ["hold-on", "on"],
  ["stay-tonight", "night"],
  ["stay-tonight", "go"],
  ["lights-out", "lights"],
  ["lights-out", "out"],
  ["lights-out", "on"],
  ["all-i-need", "need"],
  ["all-i-need", "oh"],
  ["all-i-need", "name"],
];

/** A keyed round-robin of `count` syllables: each hit sings the next one. */
export function chopTrack(
  id: string,
  rng: Rng,
  count: number,
  level: number,
  d: Design,
): TrackInput {
  const picks = rng.shuffle(SYLLABLES).slice(0, count);
  const voices: Record<string, SampleRef> = {};
  for (const [sample, name] of picks) {
    const slice = bundledSample(sample)?.slices.find((s) => s.name === name);
    if (!slice) continue;
    voices[`${sample}_${name}`.replaceAll("-", "_")] = {
      ...bundledSampleRef(sample),
      begin: slice.begin,
      end: slice.end,
      root: 60,
      rr: "syllables",
      clip: 1,
      fadeTime: 0.02,
      fadeInTime: 0.002,
    } as SampleRef;
  }
  return voice(id, "Vocal chops", "sampler", level, {
    sampler: { mode: "keyed", voices },
    pan: -0.08,
    filter: { type: "hpf", cutoff: 280, resonance: 0 },
    fx: {
      ...orbit,
      crush: {
        bits: 10 + Math.round(6 * (1 - d.grit)),
        coarse: 1,
        mix: 0.1 * d.grit,
      },
      eq: { mid: 2, midfreq: 3000, high: 3, highfreq: 8000 },
    },
    delay: echo(d, 0.22, 0.4),
    reverb: space(d, 0.1),
  });
}

/** A held vowel as a grain cloud under the chords. */
export function cloudTrack(
  id: string,
  level: number,
  d: Design,
  vowel = "vowel-ah",
): TrackInput {
  return voice(id, "Voice cloud", "granular", level, {
    granular: {
      src: bundledSampleRef(vowel),
      root: 60,
      begin: 0.15,
      end: 0.85,
      grain: 0.09,
      overlap: 3,
      pos: 0.4,
      scan: 0.2,
      spread: 0.6 + 0.35 * d.width,
      spray: 0.05,
      jitter: 0.2,
      sync: "1/16",
      quant: "chord",
      attack: 0.3,
      release: 0.9,
      gain: 0.6,
    } as TrackInput["granular"],
    filter: { type: "lpf", cutoff: 3500 + 3000 * d.brightness, resonance: 0.1 },
    fx: { ...orbit, chorus: { rate: 0.3, depth: 0.6, mix: 0.4 } },
    reverb: space(d, 0.25),
  });
}

/** Risers and tape hits: notes from 48 rise, from 60 thump. */
export function fxTrack(id: string, level: number): TrackInput {
  return voice(id, "Risers & tape", "sampler", level, {
    sampler: {
      mode: "keyed",
      voices: {
        rise: { ...bundledSampleRef("riser"), root: 48, fadeTime: 0.05 },
        tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.006 },
      },
    },
    filter: { type: "hpf", cutoff: 190, resonance: 0 },
  });
}

/** Tuned glass hits for sparkle. */
export function sparkTrack(id: string, level: number, d: Design): TrackInput {
  return voice(id, "Glass pixels", "sampler", level, {
    sampler: {
      mode: "keyed",
      voices: { glass: { ...bundledSampleRef("glass-hit"), fadeTime: 0.012 } },
    },
    pan: -0.31,
    reverb: space(d, 0.25),
    fx: { crush: { bits: 7, coarse: 2, mix: 0.1 + 0.2 * d.grit } },
  });
}

// ---------------------------------------------------------------- drums

export function drumTracks(
  bpm: number,
  kits: Readonly<{ kick: string; snare: string; hats: string }>,
  d: Design,
): TrackInput[] {
  return [
    demo.kick(bpm, kits.kick, 0.8 + 0.1 * d.grit, 0.62),
    demo.snare(0.42, kits.snare, { reverb: space(d, 0.08) }),
    demo.hats(0.44, kits.hats),
    voice("perc", "Perc & toms", "kit", 0.34, {
      kit: kits.snare,
      pan: -0.16,
      filter: { type: "hpf", cutoff: 200, resonance: 0 },
      reverb: space(d, 0.1),
      humanize: { timing: 4, velocity: 6, seed: 33 },
    }),
    demo.sweep(0.12),
  ];
}
