/**
 * A song's genome: a seeded draw over orthogonal axes (tempo and drum
 * grammar, mode and harmonic language, the sound of every role, the voice,
 * the form, the moves). The three demos are three points in this space; the
 * sampler reaches everywhere else. Every axis can be pinned, so a brief or a
 * model can steer the parts it cares about and leave the rest to chance.
 */
import { Rng } from "./rng.ts";
import { scaleOf, type Language, type Mode, type Scale } from "./theory.ts";

export const GRAMMARS = [
  "four",
  "break",
  "jersey",
  "trap",
  "gabber",
  "footwork",
  "twostep",
  "dembow",
  "bounce",
  "glitch",
] as const;
export type Grammar = (typeof GRAMMARS)[number];

export const BASSES = [
  "sub808",
  "growl",
  "reese",
  "fm",
  "pluck",
  "fold",
  "acid",
  "boom",
] as const;
export type BassSound = (typeof BASSES)[number];

export const LEADS = [
  "supersaw",
  "chip",
  "vowel",
  "bell",
  "square",
  "sync",
  "fmlead",
  "whistle",
  "talk",
  "brass",
  "glass",
  "screamer",
] as const;
export type LeadSound = (typeof LEADS)[number];

export const PADS = [
  "supersaw",
  "glass",
  "bloom",
  "pwm",
  "vowel",
  "choir",
  "strings",
  "ep",
  "rhodes",
  "organ",
  "felt",
] as const;
export type PadSound = (typeof PADS)[number];

export const STABS = [
  "hyper",
  "sugar",
  "brass",
  "pump",
  "house",
  "organ",
] as const;
export type StabSound = (typeof STABS)[number];

export const ARPS = [
  "pulse",
  "square",
  "bell",
  "harp",
  "kalimba",
  "marimba",
  "musicbox",
  "glock",
  "fmbells",
  "steelpan",
  "pizz",
  "koto",
  "vibes",
  "glasspluck",
] as const;
export type ArpSound = (typeof ARPS)[number];

export const VOICES = [
  "sung",
  "chipmunk",
  "robot",
  "whisper",
  "abstract",
  "chopped",
  "instrumental",
] as const;
export type VoiceStyle = (typeof VOICES)[number];

export const FORMS = [
  "classic",
  "dropFirst",
  "beatSwitch",
  "slowBurn",
  "falseEnding",
  "through",
  "miniature",
] as const;
export type Form = (typeof FORMS)[number];

export const DEVICES = [
  "tapestop",
  "dive",
  "stutter",
  "gap",
  "riser",
  "crush",
  "downlifter",
  "filter",
  "glitch",
  "octave",
  "halftime",
] as const;
export type Device = (typeof DEVICES)[number];

export const ARCS = ["rising", "wave", "plateau", "frontloaded"] as const;
export type Arc = (typeof ARCS)[number];

export type Genome = Readonly<{
  seed: number;
  bpm: number;
  /** Fraction of a 16th the off 16ths sit late. */
  swing: number;
  tonic: number;
  mode: Mode;
  scale: Scale;
  harmony: Readonly<{
    /** Drops and choruses. */
    main: Language;
    verse: Language;
    bridge: Language;
    /** Chance a chord carries a 7th or 9th. */
    color: number;
    /** Chords per bar in the drop: 0.5, 1 or 2. */
    rate: number;
  }>;
  drums: Readonly<{
    main: Grammar;
    verse: Grammar;
    /** The second grammar a beat switch flips to. */
    alt: Grammar;
    kick: string;
    snare: string;
    hats: string;
    /** Extra ghost notes and rolls, 0..1. */
    busy: number;
  }>;
  sounds: Readonly<{
    bass: BassSound;
    lead: LeadSound;
    pad: PadSound;
    stab: StabSound;
    arp: ArpSound;
  }>;
  voice: VoiceStyle;
  /** How much of the vocal is words rather than chopped syllables, 0..1. */
  words: number;
  form: Form;
  arc: Arc;
  devices: readonly Device[];
  /** Melodic DNA: notes per beat, offbeat pull, 3-3-2 habit. */
  rhythm: Readonly<{ density: number; syncopation: number; tresillo: number }>;
  /** How often melodies leap rather than step, 0..1. */
  leap: number;
  design: Readonly<{
    brightness: number;
    grit: number;
    space: number;
    width: number;
    /** Delay time in beats. */
    echo: number;
  }>;
  /** Chance a section gets a second, contrapuntal line, 0..1. */
  counterpoint: number;
  /** A baroque fugue break somewhere in the song. */
  fugue: boolean;
}>;

export type GenomePins = Partial<
  Omit<
    Genome,
    "seed" | "scale" | "harmony" | "drums" | "sounds" | "rhythm" | "design"
  >
> &
  Readonly<{
    harmony?: Partial<Genome["harmony"]>;
    drums?: Partial<Genome["drums"]>;
    sounds?: Partial<Genome["sounds"]>;
    rhythm?: Partial<Genome["rhythm"]>;
    design?: Partial<Genome["design"]>;
  }>;

/** Tempo ranges per grammar: where each groove lives. */
const TEMPO: Readonly<Record<Grammar, readonly [number, number]>> = {
  four: [128, 152],
  break: [160, 176],
  jersey: [136, 150],
  trap: [136, 160],
  gabber: [168, 190],
  footwork: [156, 162],
  twostep: [130, 140],
  dembow: [96, 108],
  bounce: [140, 162],
  glitch: [140, 172],
};

/** A lighter groove the verses can sit in under each drop grammar. */
const VERSE_OF: Readonly<Record<Grammar, Partial<Record<Grammar, number>>>> = {
  four: { four: 2, twostep: 2, bounce: 1, glitch: 1 },
  break: { trap: 2, break: 2, glitch: 1 },
  jersey: { trap: 2, bounce: 2, jersey: 1 },
  trap: { trap: 3, glitch: 1, bounce: 1 },
  gabber: { four: 2, break: 1, glitch: 2 },
  footwork: { footwork: 2, trap: 1, glitch: 1 },
  twostep: { twostep: 3, four: 1 },
  dembow: { dembow: 3, trap: 1 },
  bounce: { bounce: 2, trap: 2, glitch: 1 },
  glitch: { glitch: 2, trap: 1, bounce: 1 },
};

const KITS = [
  "syn808",
  "syn909",
  "acoustic",
  "lofi",
  "electro",
  "trap",
  "syn606",
  "syn707",
  "synlinn",
  "breaks",
];

function pinned<T>(pin: T | undefined, draw: () => T): T {
  return pin === undefined ? draw() : pin;
}

/**
 * Draw a genome from `seed`. Each axis has its own child generator, so
 * pinning one axis leaves every other axis exactly as the seed drew it.
 */
export function sampleGenome(seed: number, pins: GenomePins = {}): Genome {
  const root = new Rng(seed);
  const r = (label: string) => root.fork(label);
  const g = r("grammar");
  const main = pinned(pins.drums?.main, () =>
    g.weighted<Grammar>({
      four: 3,
      break: 2.5,
      jersey: 2,
      trap: 2,
      gabber: 1,
      footwork: 1,
      twostep: 1.2,
      dembow: 0.8,
      bounce: 2.5,
      glitch: 1.5,
    }),
  );
  const [lo, hi] = TEMPO[main];
  const bpm = pinned(pins.bpm, () => r("bpm").int(lo, hi));
  const verse = pinned(pins.drums?.verse, () =>
    r("verse-grammar").weighted(VERSE_OF[main]),
  );
  const alt = pinned(pins.drums?.alt, () => {
    const a = r("alt-grammar");
    // A switch keeps the tempo, so only grooves that live near it qualify.
    const near = GRAMMARS.filter(
      (x) => x !== main && TEMPO[x][0] - 12 <= bpm && bpm <= TEMPO[x][1] + 12,
    );
    return near.length ? a.pick(near) : "glitch";
  });
  const mode = pinned(pins.mode, () =>
    r("mode").weighted<Mode>({
      major: 3,
      minor: 3,
      lydian: 1.4,
      dorian: 1.2,
      mixolydian: 1,
      phrygian: 0.4,
    }),
  );
  const tonic = pinned(pins.tonic, () => r("tonic").int(0, 11));
  const h = r("harmony");
  const language = (): Language =>
    h.weighted<Language>({
      loop: 5,
      two: 1.2,
      pedal: 1.2,
      lament: 1,
      circle: 0.8,
      borrowed: mode === "major" || mode === "mixolydian" ? 1.5 : 0,
    });
  const harmony = {
    main: pins.harmony?.main ?? language(),
    verse: pins.harmony?.verse ?? (h.chance(0.45) ? "pedal" : language()),
    bridge:
      pins.harmony?.bridge ??
      h.pick<Language>(["circle", "lament", "loop", "two"]),
    color: pins.harmony?.color ?? h.pick([0, 0.15, 0.3, 0.5]),
    rate:
      pins.harmony?.rate ??
      Number(
        h.weighted({ "1": 5, "2": 1.5, "0.5": 1.5 } as Record<string, number>),
      ),
  };
  const k = r("kit");
  const drums = {
    main,
    verse,
    alt,
    kick: pins.drums?.kick ?? k.pick(KITS),
    snare: pins.drums?.snare ?? k.pick(KITS),
    hats: pins.drums?.hats ?? k.pick(KITS),
    busy: pins.drums?.busy ?? k.range(0.1, 0.9),
  };
  const s = r("sounds");
  const sounds = {
    bass:
      pins.sounds?.bass ??
      s.weighted<BassSound>({
        sub808:
          main === "trap" || main === "jersey" || main === "dembow" ? 4 : 1.5,
        boom: main === "trap" || main === "bounce" ? 2 : 0.6,
        reese: main === "break" || main === "twostep" ? 3 : 1,
        growl: 1.6,
        fm: 1.2,
        pluck: main === "four" || main === "footwork" ? 2 : 1,
        fold: 1,
        acid: main === "four" || main === "gabber" ? 1.6 : 0.6,
      }),
    lead:
      pins.sounds?.lead ??
      s.weighted<LeadSound>({
        supersaw: 3,
        chip: 2.5,
        vowel: 2,
        bell: 1.5,
        square: 1.5,
        sync: 1.2,
        fmlead: 1,
        whistle: 1,
        talk: 0.8,
        brass: 0.8,
        glass: 1.4,
        screamer: 0.8,
      }),
    pad:
      pins.sounds?.pad ??
      s.weighted<PadSound>({
        supersaw: 2.5,
        glass: 1.5,
        bloom: 1.5,
        pwm: 1.2,
        vowel: 1.2,
        choir: 1.5,
        strings: 1,
        ep: 1,
        rhodes: 1,
        organ: 0.6,
        felt: 0.8,
      }),
    stab:
      pins.sounds?.stab ??
      s.weighted<StabSound>({
        hyper: 2.5,
        sugar: 2,
        brass: 1,
        pump: 1.5,
        house: 1.5,
        organ: 0.8,
      }),
    arp:
      pins.sounds?.arp ??
      s.weighted<ArpSound>({
        pulse: 2,
        square: 2,
        bell: 1.5,
        harp: 1,
        kalimba: 1,
        marimba: 1,
        musicbox: 1,
        glock: 1,
        fmbells: 1,
        steelpan: 0.8,
        pizz: 1,
        koto: 0.6,
        vibes: 0.8,
        glasspluck: 1.2,
      }),
  };
  const v = r("voice");
  const voice = pinned(pins.voice, () =>
    v.weighted<VoiceStyle>({
      sung: 3,
      chipmunk: 2,
      robot: 1.5,
      whisper: 0.8,
      abstract: 2,
      chopped: 2,
      instrumental: 0.6,
    }),
  );
  const words = pinned(pins.words, () =>
    voice === "instrumental"
      ? 0
      : voice === "abstract" || voice === "chopped"
        ? v.range(0.1, 0.5)
        : v.range(0.5, 1),
  );
  const f = r("form");
  const form = pinned(pins.form, () =>
    f.weighted<Form>({
      classic: 2,
      dropFirst: 1.5,
      beatSwitch: 1.5,
      slowBurn: 1,
      falseEnding: 1,
      through: 1.2,
      miniature: 1.2,
    }),
  );
  const arc = pinned(pins.arc, () => f.pick(ARCS));
  const d = r("devices");
  const devices = pinned(pins.devices, () => {
    const count = d.int(3, 6);
    const weights: Record<Device, number> = {
      tapestop: 1.5,
      dive: 1.5,
      stutter: 2,
      gap: 2,
      riser: 2,
      crush: 1.5,
      downlifter: 1.2,
      filter: 1.5,
      glitch: 1.2,
      octave: 1,
      halftime: 1,
    };
    const out: Device[] = [];
    while (out.length < count) {
      const pick = d.weighted(weights);
      weights[pick] = 0;
      out.push(pick);
    }
    return out;
  });
  const m = r("rhythm");
  const rhythm = {
    density: pins.rhythm?.density ?? m.range(1, 2.6),
    syncopation: pins.rhythm?.syncopation ?? m.range(0.1, 0.8),
    tresillo: pins.rhythm?.tresillo ?? m.pick([0, 0.2, 0.5]),
  };
  const x = r("design");
  const design = {
    brightness: pins.design?.brightness ?? x.range(0.3, 1),
    grit: pins.design?.grit ?? x.range(0, 1),
    space: pins.design?.space ?? x.range(0.2, 1),
    width: pins.design?.width ?? x.range(0.5, 1),
    echo: pins.design?.echo ?? x.pick([0.75, 0.75, 0.5, 0.375, 1.5]),
  };
  const c = r("counterpoint");
  return Object.freeze({
    seed,
    bpm,
    swing:
      pins.swing ??
      (main === "twostep" || main === "footwork"
        ? r("swing").range(0.04, 0.1)
        : r("swing").pick([0, 0, 0.03])),
    tonic,
    mode,
    scale: scaleOf(tonic, mode),
    harmony,
    drums,
    sounds,
    voice,
    words,
    form,
    arc,
    devices,
    rhythm,
    leap: pins.leap ?? r("leap").range(0.1, 0.5),
    design,
    counterpoint: pins.counterpoint ?? c.pick([0, 0.2, 0.4, 0.6]),
    // A fugue break is a sometimes thing: about one song in four.
    fugue: pins.fugue ?? c.chance(0.25),
  });
}

const GRAMMAR_WORDS: Readonly<Record<Grammar, string>> = {
  four: "four-on-the-floor",
  break: "chopped breakbeat",
  jersey: "jersey club",
  trap: "half-time trap",
  gabber: "gabber kicks",
  footwork: "footwork",
  twostep: "2-step garage",
  dembow: "dembow",
  bounce: "hyper bounce",
  glitch: "glitch percussion",
};

/** The genome in plain words, for prompts, reports and song notes. */
export function describeGenome(g: Genome): string[] {
  return [
    `${g.bpm} BPM, ${g.scale.name}, no key change`,
    `drops: ${GRAMMAR_WORDS[g.drums.main]}; verses: ${GRAMMAR_WORDS[g.drums.verse]}${g.form === "beatSwitch" ? `; switches to ${GRAMMAR_WORDS[g.drums.alt]}` : ""}`,
    `harmony: ${g.harmony.main} drops, ${g.harmony.verse} verses, ${g.harmony.bridge} bridge`,
    `sounds: ${g.sounds.bass} bass, ${g.sounds.lead} lead, ${g.sounds.pad} pad, ${g.sounds.stab} stabs, ${g.sounds.arp} arp`,
    `voice: ${g.voice}${g.voice === "instrumental" ? "" : `, ${Math.round(g.words * 100)}% words`}`,
    `form: ${g.form}, ${g.arc} energy`,
    `moves: ${g.devices.join(", ")}${g.fugue ? ", fugue break" : ""}`,
  ];
}
