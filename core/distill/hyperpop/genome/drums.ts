/**
 * Drum grammars. Each grammar is a family of 16-step grids per voice; a
 * song draws one variant of each and mutates it a little, so two songs in
 * the same grammar still groove differently. Energy decides which voices
 * play and how busy they are; the last bar of a phrase gets the song's fill.
 */
import type { Composer } from "../../../demos/build.ts";
import type { Grammar } from "./genome.ts";
import type { Rng } from "./rng.ts";

const KICK = 36;
const SNARE = 38;
const RIM = 37;
const CLAP = 39;
const HAT = 42;
const OPEN = 46;
const TOM = 45;

type Pattern = Readonly<{
  kick: readonly string[];
  snare: readonly string[];
  hats: readonly string[];
  open?: readonly string[];
  perc?: readonly string[];
  /** Snare voice: snare, clap or both. */
  hit?: "snare" | "clap" | "both";
}>;

const GRIDS: Readonly<Record<Exclude<Grammar, "glitch">, Pattern>> = {
  four: {
    kick: ["9...9...9...9...", "9...9...9...9..6", "9...9...9..69..."],
    snare: ["....9.......9...", "....9.......9..5"],
    hats: ["..7...7...7...7.", "5.7.5.7.5.7.5.7.", "..7.5.7...7.5.76"],
    open: ["..6...6...6...6."],
    hit: "clap",
  },
  gabber: {
    kick: ["9...9...9...9...", "9...9...9...9.7.", "9...9...9..79..."],
    snare: ["....8.......8...", "................"],
    hats: ["..8...8...8...8.", "..8.6.8...8.6.8."],
    open: ["..7...7...7...7."],
    hit: "clap",
  },
  break: {
    kick: [
      "9.........9.....",
      "9.7.......98....",
      "9.........7.9...",
      "9......7..9.....",
    ],
    snare: ["....9.......9...", "....9..6.6..9..6", "....9.5....59.5."],
    hats: ["7.6.7.6.7.6.7.6.", "8.6.7.6.8.6.7.66", "7...7...7...7.7."],
    perc: ["......5.......5.", "...5.......5...."],
    hit: "snare",
  },
  jersey: {
    kick: ["9..9..9...9.9...", "9...9..9..9.9...", "9..9..9.9...9..."],
    snare: ["....9.......9...", "....9.......9.9."],
    hats: ["..6...6...6...6.", "6.6.6.6.6.6.6.6."],
    perc: ["...5..5....5..5.", ".5...5...5...5.."],
    hit: "clap",
  },
  trap: {
    kick: [
      "9......8..9.....",
      "9.....8...9..8..",
      "9..8......9....8",
      "9.......9.8.....",
    ],
    snare: ["........9.......", "........9......5"],
    hats: ["6.6.6.6.6.6.6.6.", "6.6.6.666.6.6.66", "6.5.6.5.6.5.6656"],
    open: ["..............6."],
    hit: "both",
  },
  footwork: {
    kick: ["9..9..9...9..9..", "9..9..9..9..9...", "9...9..9..9..9.."],
    snare: ["............9...", "....9.......9..."],
    hats: ["7.7.7.7.7.7.7.7.", "7.67.67.67.67.6."],
    perc: ["..5..5..5..5..5.", "5..5..5..5..5..."],
    hit: "clap",
  },
  twostep: {
    kick: ["9.........9.....", "9......8..9.....", "9.........9..8.."],
    snare: ["....9.......9...", "....9.......9.5."],
    hats: ["..6.5.6...6.5.6.", "6.5.6.5.6.5.6.5."],
    perc: [".....5.....5..5.", "...5.....5......"],
    hit: "snare",
  },
  dembow: {
    kick: ["9...9...9...9...", "9...9...9...9..7"],
    snare: ["...9..9....9..9.", "...9..9....9.79."],
    hats: ["6.6.6.6.6.6.6.6.", "6.56.56.6.56.56."],
    hit: "snare",
  },
  bounce: {
    kick: ["9.....9...9.....", "9.....9..9..9...", "9..9......9....."],
    snare: ["....9.......9...", "....9.......9.5."],
    hats: ["..6...6.6.6...6.", "6.6.6.6.6.6.6.6."],
    perc: ["..........5....5"],
    hit: "both",
  },
};

/** Euclidean rhythm: `hits` spread over `steps`, rotated. */
export function euclid(hits: number, steps: number, rotate = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < steps; i++)
    out.push(((i + rotate) * hits) % steps < hits);
  return out;
}

const toGrid = (on: readonly boolean[], v: string) =>
  on.map((x) => (x ? v : ".")).join("");

/** A glitch grammar is grown, not chosen: euclidean kicks around a fixed backbeat. */
function glitchPattern(rng: Rng): Pattern {
  const kicks = Array.from({ length: 3 }, () => {
    const g = toGrid(euclid(rng.int(3, 6), 16, rng.int(0, 15)), "8").split("");
    g[0] = "9";
    return g.join("");
  });
  const hats = Array.from({ length: 2 }, () =>
    toGrid(euclid(rng.int(5, 11), 16, rng.int(0, 3)), "6"),
  );
  return {
    kick: kicks,
    snare: ["....9.......9...", "........9......."],
    hats,
    perc: [toGrid(euclid(rng.int(2, 5), 16, rng.int(1, 7)), "5")],
    hit: rng.pick(["snare", "clap", "both"] as const),
  };
}

/** Move one hit a 16th, or add a ghost: the song's own accent. */
function mutate(rng: Rng, grid: string, amount: number): string {
  const steps = grid.split("");
  if (rng.chance(amount)) {
    const empty = steps
      .map((s, i) => (s === "." && i % 4 !== 0 ? i : -1))
      .filter((i) => i >= 0);
    if (empty.length) steps[rng.pick(empty)] = String(rng.int(4, 6));
  }
  if (rng.chance(amount * 0.5)) {
    const hits = steps
      .map((s, i) => (s !== "." && i % 4 !== 0 ? i : -1))
      .filter((i) => i >= 0);
    if (hits.length) {
      const from = rng.pick(hits);
      const to = from + (rng.chance(0.5) ? 1 : -1);
      if (to > 0 && to < 16 && steps[to] === ".")
        [steps[to], steps[from]] = [steps[from]!, "."];
    }
  }
  return steps.join("");
}

export type Groove = Readonly<{
  grammar: Grammar;
  kick: readonly string[];
  snare: readonly string[];
  hats: readonly string[];
  open: readonly string[];
  perc: readonly string[];
  hit: "snare" | "clap" | "both";
  fill: Fill;
  swing: number;
}>;

export type Fill = "roll" | "toms" | "ratchet" | "drop" | "flam";

/** The song's version of `grammar`: drawn variants, lightly mutated. */
export function groove(
  rng: Rng,
  grammar: Grammar,
  busy: number,
  swing: number,
): Groove {
  const base = grammar === "glitch" ? glitchPattern(rng) : GRIDS[grammar];
  const pickSome = (list: readonly string[] | undefined, n: number) =>
    list?.length
      ? rng
          .shuffle(list)
          .slice(0, n)
          .map((g) => mutate(rng, g, busy))
      : [];
  // The first kick variant is the anchor; the others are phrase-end answers.
  const kick = pickSome(base.kick, 2);
  return {
    grammar,
    kick: kick.length > 1 ? kick : [...kick, ...kick],
    snare: pickSome(base.snare, 2),
    hats: pickSome(base.hats, 2),
    open: base.open ? [...base.open] : [],
    perc: pickSome(base.perc, 1),
    hit: base.hit ?? "snare",
    fill: rng.weighted<Fill>({
      roll: 3,
      toms: 1.5,
      ratchet: 2,
      drop: 1.5,
      flam: 1,
    }),
    swing,
  };
}

/** Per-bar options a section passes in. */
export type BarDrums = Readonly<{
  energy: number;
  /** Bar within its 4-bar phrase (3 is the turnaround). */
  phraseBar: number;
  /** Last bar of the section: play the fill. */
  last: boolean;
  /** Halftime: the snare moves to beat 3. */
  half?: boolean;
  /** Just hats and perc (an intro or a break). */
  sparse?: boolean;
}>;

/**
 * One bar of `g` at `bar`. Tracks: kick, snare (snare and clap), hats
 * (closed, open, rim), perc (toms, rim).
 */
export function drumBar(
  s: Composer,
  bar: number,
  g: Groove,
  o: BarDrums,
): void {
  const e = Math.min(1, Math.max(0, o.energy));
  const sw = g.swing / 4;
  const turn = o.phraseBar === 3;
  const fillHere = o.last && g.fill !== "drop";
  const cut = (grid: string) => (fillHere ? grid.slice(0, 12) + "...." : grid);
  if (!o.sparse && e >= 0.35) {
    const k = turn ? g.kick[1]! : g.kick[0]!;
    s.grid(
      "kick",
      bar,
      KICK,
      o.last && g.fill === "drop" ? k.slice(0, 8) + "........" : cut(k),
      0.75 + 0.25 * e,
    );
  }
  if (!o.sparse && e >= 0.45) {
    let sn = turn && g.snare[1] ? g.snare[1] : g.snare[0]!;
    if (o.half) sn = "........9.......";
    const pitches =
      g.hit === "snare" ? [SNARE] : g.hit === "clap" ? [CLAP] : [SNARE, CLAP];
    for (const p of pitches)
      s.grid(
        "snare",
        bar,
        p,
        cut(sn),
        (p === CLAP && g.hit === "both" ? 0.7 : 1) * (0.7 + 0.3 * e),
        sw,
      );
  }
  if (e >= 0.2) {
    const hats = e > 0.75 && g.hats[1] ? g.hats[1] : g.hats[0]!;
    s.grid("hats", bar, HAT, cut(hats), 0.6 + 0.4 * e, sw);
    if (e > 0.8 && g.open[0])
      s.grid("hats", bar, OPEN, cut(g.open[0]), 0.8, sw);
  }
  if (e >= 0.55 && g.perc[0]) s.grid("perc", bar, RIM, cut(g.perc[0]), 0.8, sw);
  if (fillHere) fill(s, bar, g.fill, e);
}

/** The last beat of a section. */
function fill(s: Composer, bar: number, kind: Fill, e: number): void {
  const gain = 0.6 + 0.4 * e;
  if (kind === "roll")
    for (let i = 0; i < 8; i++)
      s.note("snare", bar, 3 + i / 8, SNARE, 0.1, gain * (0.4 + 0.07 * i));
  else if (kind === "toms")
    [3, 3.25, 3.5, 3.75].forEach((b, i) =>
      s.note("perc", bar, b, TOM, 0.2, gain * (0.85 - 0.08 * i), {
        bend: [
          { at: 0, cents: 300 - 150 * i },
          { at: 1, cents: 0 },
        ] as never,
      }),
    );
  else if (kind === "ratchet")
    for (let i = 0; i < 12; i++)
      s.note("hats", bar, 3 + i / 12, HAT, 0.06, gain * (0.35 + 0.05 * i));
  else if (kind === "flam") {
    s.note("snare", bar, 3, SNARE, 0.15, gain * 0.6);
    s.note("snare", bar, 3.5, SNARE, 0.15, gain * 0.8);
    s.note("snare", bar, 3.53, CLAP, 0.15, gain * 0.8);
    s.note("snare", bar, 3.75, SNARE, 0.15, gain);
  }
}

/** A roll that speeds up over a build bar: 8ths, then 16ths, then 32nds. */
export function buildRoll(
  s: Composer,
  bar: number,
  from = 0.3,
  to = 0.9,
): void {
  const hits: number[] = [];
  for (let b = 0; b < 2; b += 0.5) hits.push(b);
  for (let b = 2; b < 3; b += 0.25) hits.push(b);
  for (let b = 3; b < 4; b += 0.125) hits.push(b);
  hits.forEach((b, i) =>
    s.note("snare", bar, b, SNARE, 0.1, from + ((to - from) * i) / hits.length),
  );
}
