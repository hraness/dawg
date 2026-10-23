/**
 * The named patterns a song sheet picks from, distilled from the hyperpop
 * demos. Every pattern is the demo's own constant, so a sheet that names
 * them plays exactly what the demo plays. Cells are 16 sixteenth steps over
 * a chord ladder (digits are rungs, `.` rests, `-` holds); stab and bass
 * grids are as `hyperpop.ts` reads them.
 */
import * as glass from "../../demos/glass-garden.ts";
import * as night from "../../demos/redline.ts";

type Cells = readonly (string | null)[];
type Slot = Readonly<Record<string, Readonly<{ cells: Cells; use: string }>>>;

export const RIFFS: Slot = {
  ostinato: {
    cells: night.RIFF_INTRO,
    use: "syllables arpeggiating the chord in eighths; intros",
  },
  answer: {
    cells: night.RIFF_VERSE,
    use: "eighth-note syllable ostinato between verse lines",
  },
  lift: {
    cells: night.RIFF_CHORUS,
    use: "falling eighths from the chord's top; choruses and builds",
  },
  drop: {
    cells: night.RIFF_DROP,
    use: "3-3-2 syllable riff; the first drop",
  },
  drop2: {
    cells: night.RIFF_DROP2,
    use: "denser 3-3-2 riff with pickups; later drops",
  },
  climb: {
    cells: glass.RIFF_CHORUS,
    use: "rising eighth triplets of syllables; builds",
  },
  bloom: {
    cells: glass.RIFF_POST,
    use: "a sixteenth run up the chord, then eighths; drops",
  },
  scatter: {
    cells: glass.RIFF_POST2,
    use: "syllables leaping in sixteenth pairs; later drops and last choruses",
  },
};

export const ARPS: Slot = {
  eighths: {
    cells: night.ARP_8,
    use: "a plain eighth arp in the middle; pre-choruses",
  },
  high: {
    cells: night.ARP_HI,
    use: "the arp on its top rungs, above the singer; choruses",
  },
  sixteenths: {
    cells: night.ARP_16,
    use: "running sixteenths up and down; pre-choruses and builds",
  },
  spread: {
    cells: glass.ARP_16,
    use: "sixteenths skipping rungs (wide); drops",
  },
  skip: {
    cells: glass.ARP_SKIP,
    use: "syncopated skipping arp; verses, builds",
  },
};

export const BELLS: Slot = {
  sparse: {
    cells: night.BELLS,
    use: "two bells a bar; breaks and outros",
  },
  fall: {
    cells: glass.BELLS,
    use: "a falling bell line; last choruses",
  },
  verse: {
    cells: glass.BELLS_VERSE,
    use: "slow bells stepping down; intros, verses, breaks",
  },
  fade: {
    cells: ["7...6...5.......", null],
    use: "three falling bells, then rest; outros",
  },
};

export const STABS: Slot = {
  push: {
    cells: night.STABS,
    use: "3-3-2 chord stabs; choruses",
  },
  drive: {
    cells: night.STABS_DROP,
    use: "harder 3-3-2 stabs; drops",
  },
  syncopate: {
    cells: glass.STABS,
    use: "offbeat stabs; choruses",
  },
  bloom: {
    cells: glass.STABS_POST,
    use: "busy syncopated stabs; drops",
  },
  pulse: {
    cells: ["8...8...8...8...", "8.8.8.8.8.8.8.8."],
    use: "quarters then eighths; builds",
  },
};

/** Bass lines: 0 root, 1 fifth, 2 octave, 3 octave fifth; `~` glides on. */
export const BASS: Slot = {
  pedal: {
    cells: night.LINE_INTRO,
    use: "a held root with one octave flick; intros",
  },
  walk: {
    cells: night.LINE_VERSE,
    use: "dotted roots; verses",
  },
  pulse: {
    cells: night.LINE_CHORUS,
    use: "long roots with octave glides; choruses",
  },
  roll: {
    cells: night.LINE_DROP,
    use: "a rolling reese line; the first drop",
  },
  roll2: {
    cells: night.LINE_DROP2,
    use: "a busier rolling line; later drops",
  },
  glide: {
    cells: glass.LINE_VERSE,
    use: "held roots gliding into the next bar; verses",
  },
  pump: {
    cells: glass.LINE_CHORUS,
    use: "an offbeat octave pump; choruses",
  },
  bounce: {
    cells: glass.LINE_BLOOM,
    use: "offbeat octaves bouncing; drops",
  },
  bounce2: {
    cells: glass.LINE_BLOOM2,
    use: "busier bounce with glides; later drops",
  },
};

export const LIBRARY = {
  riff: RIFFS,
  arp: ARPS,
  bells: BELLS,
  stabs: STABS,
  line: BASS,
} as const;
export type PatternSlot = keyof typeof LIBRARY;
export const PATTERN_SLOTS = Object.keys(LIBRARY) as PatternSlot[];

/**
 * The pattern a demo's cells play, if any (for the distiller): leading rest
 * bars become `enter`, then the cells must cycle one library pattern.
 */
export function patternName(
  slot: PatternSlot,
  cells: Cells,
): { name: string; enter: number } | undefined {
  let enter = 0;
  while (enter < cells.length && cells[enter] === null) enter++;
  const rest = cells.slice(enter);
  if (rest.length === 0) return undefined;
  for (const [name, entry] of Object.entries(LIBRARY[slot]))
    if (rest.every((cell, i) => cell === entry.cells[i % entry.cells.length]))
      return { name, enter };
  return undefined;
}
