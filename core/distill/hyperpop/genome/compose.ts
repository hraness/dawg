/**
 * Genome in, song out. The form archetype lays out the sections; each
 * section kind writes its layers from the song's own material (a hook
 * motif, a verse motif, chord loops, a groove, a bass habit), and the
 * song's moves (gaps, tape stops, dives, stutters, risers, a fugue) land on
 * the seams. Nothing here is copied from a demo: the demos' sounds are in
 * the sound tables, but every note is grown from the genome.
 */
import { BAR, Composer, TPB } from "../../../demos/build.ts";
import { demoInfo } from "../../../demos/types.ts";
import { merge, ramps } from "../../../demos/hyperpop.ts";
import type {
  AutomationPoint,
  NoteInput,
  TrackInput,
  TrackScore,
} from "../../../score.ts";
import { describeGenome, type Device, type Genome } from "./genome.ts";
import { buildRoll, drumBar, groove, type Groove } from "./drums.ts";
import { line, THEME_NAMES, title as makeTitle, vocables } from "./lyrics.ts";
import {
  complement,
  counterLine,
  fugue,
  motif,
  phrase,
  render,
  rhythmCell,
  type Cell,
  type ChordAt,
  type MNote,
  type Motif,
  type PhrasePlan,
  type Range,
} from "./melody.ts";
import { SOUND_TRIMS } from "./levels.ts";
import { readMusic, type Music } from "./music.ts";
import { Rng } from "./rng.ts";
import {
  ARP,
  BAROQUE,
  BASS,
  LEAD,
  PAD,
  SINGERS,
  STAB,
  chopTrack,
  cloudTrack,
  drumTracks,
  fxTrack,
  harmonySinger,
  singer,
  sparkTrack,
  subTrack,
} from "./sounds.ts";
import {
  bassPitch,
  ladder,
  melodicSet,
  nearest,
  progression,
  voicing,
  type Chord,
} from "./theory.ts";

export type Kind =
  | "intro"
  | "verse"
  | "pre"
  | "drop"
  | "break"
  | "bridge"
  | "fugue"
  | "switch"
  | "outro";

export type Section = Readonly<{
  kind: Kind;
  name: string;
  bars: number;
  energy: number;
  start: number;
  /** Index among sections of its kind (Drop 1 is 0). */
  nth: number;
  last: boolean;
}>;

/** Words a model (or a person) can hand the composer; the rest is generated. */
export type Content = Readonly<{
  title?: string;
  theme?: string;
  /** The hook's words, one syllable per note (repeated every drop). */
  hook?: readonly string[];
  /** Verse lines; each a string of syllables separated by spaces. */
  verses?: readonly string[];
  /** Chords, motifs and arranging habits a model wrote; the seed draws the rest. */
  music?: Music;
}>;

export type GenSong = Readonly<{
  title: string;
  genome: Genome;
  sections: readonly Section[];
  score: TrackScore;
  /** One line per choice the composer made beyond the genome. */
  notes: readonly string[];
}>;

const sameKind = (list: readonly { kind: Kind }[], kind: Kind) =>
  list.filter((s) => s.kind === kind).length;

/** The sections a genome's song will have, as the composer lays them out. */
export function songSections(g: Genome): Section[] {
  return layout(new Rng(g.seed).fork("compose").fork("layout"), g);
}

/** The form archetype as a section list, its bar counts drawn per song. */
function layout(rng: Rng, g: Genome): Section[] {
  const v = () => rng.pick([8, 8, 16, 4]);
  const d = () => rng.pick([8, 8, 16]);
  const p = () => rng.pick([4, 4, 2, 8]);
  const intro = () => rng.pick([2, 4, 4, 8]);
  const plan: [Kind, number][] = (() => {
    switch (g.form) {
      case "dropFirst":
        return [
          ["drop", 8],
          ["verse", v()],
          ["pre", p()],
          ["drop", d()],
          ["break", rng.pick([4, 8])],
          ["pre", 2],
          ["drop", d()],
          ["outro", 4],
        ];
      case "beatSwitch":
        return [
          ["intro", intro()],
          ["verse", v()],
          ["pre", p()],
          ["drop", 8],
          ["verse", rng.pick([4, 8])],
          ["pre", p()],
          ["drop", 8],
          ["switch", rng.pick([8, 16])],
          ["outro", 4],
        ];
      case "slowBurn":
        return [
          ["intro", 8],
          ["verse", 8],
          ["verse", 8],
          ["pre", 8],
          ["drop", 16],
          ["break", 4],
          ["drop", 8],
          ["outro", 4],
        ];
      case "falseEnding":
        return [
          ["intro", intro()],
          ["verse", v()],
          ["drop", d()],
          ["verse", 8],
          ["pre", p()],
          ["drop", 8],
          ["outro", 4],
          ["drop", 8],
          ["outro", 2],
        ];
      case "through":
        return [
          ["intro", intro()],
          ["verse", 8],
          ["pre", p()],
          ["drop", 8],
          ["bridge", 8],
          ["switch", 8],
          ["drop", 8],
          ["outro", 4],
        ];
      case "miniature":
        return [
          ["intro", 2],
          ["verse", 8],
          ["drop", 8],
          ["verse", 4],
          ["pre", 2],
          ["drop", 8],
          ["outro", 2],
        ];
      default:
        return [
          ["intro", intro()],
          ["verse", v()],
          ["pre", p()],
          ["drop", d()],
          ["verse", v()],
          ["pre", p()],
          ["drop", d()],
          [rng.chance(0.5) ? "bridge" : "break", 8],
          ["drop", d()],
          ["outro", 4],
        ];
    }
  })();
  if (g.fugue) {
    // The fugue takes the place of a break or bridge, or comes before the last drop.
    const at = plan.findIndex(([k]) => k === "break" || k === "bridge");
    const bars = rng.pick([8, 8, 4]);
    if (at >= 0) plan[at] = ["fugue", bars];
    else {
      const lastDrop = plan.map(([k]) => k).lastIndexOf("drop");
      plan.splice(Math.max(1, lastDrop), 0, ["fugue", bars]);
    }
  }
  const base: Record<Kind, number> = {
    intro: 0.3,
    verse: 0.55,
    pre: 0.68,
    drop: 0.92,
    break: 0.35,
    bridge: 0.5,
    fugue: 0.3,
    switch: 0.95,
    outro: 0.3,
  };
  const out: Section[] = [];
  let start = 0;
  plan.forEach(([kind, bars], i) => {
    const t = i / Math.max(1, plan.length - 1);
    const lift =
      g.arc === "rising"
        ? 0.1 * t - 0.05
        : g.arc === "frontloaded"
          ? 0.05 - 0.1 * t
          : g.arc === "wave"
            ? 0.05 * Math.sin(t * 6)
            : 0;
    const nth = sameKind(out, kind);
    const label =
      kind === "pre" ? "Build" : kind[0]!.toUpperCase() + kind.slice(1);
    const count = plan.filter(([k]) => k === kind).length;
    out.push({
      kind,
      name: count > 1 ? `${label} ${nth + 1}` : label,
      bars,
      energy: Math.max(0.15, Math.min(1, base[kind] + lift)),
      start,
      nth,
      last: plan.slice(i + 1).every(([k]) => k !== kind),
    });
    start += bars;
  });
  return out;
}

/** The chord at a beat of a section, looping `loop` at `rate` chords per bar. */
const timeline =
  (loop: readonly Chord[], rate: number): ChordAt =>
  (beat) => {
    const index = Math.floor((beat / 4) * rate + 1e-6);
    return loop[((index % loop.length) + loop.length) % loop.length]!;
  };

type Lane = Record<string, AutomationPoint[]>;

/** Everything a section writer needs. */
type Ctx = Readonly<{
  s: Composer;
  g: Genome;
  rng: Rng;
  lanes: Map<string, Lane>;
  grooves: Readonly<{ main: Groove; verse: Groove; alt: Groove }>;
  loops: Readonly<{
    main: Chord[];
    verse: Chord[];
    bridge: Chord[];
    pre: Chord[];
  }>;
  style: Style;
  ranges: Readonly<{ vox: Range; lead: Range; chops: Range }>;
  motifs: Readonly<{
    hook: Motif;
    verse: Motif;
    pre: Motif;
    bridge: Motif;
    switch: Motif;
  }>;
  words: Readonly<{
    theme: string;
    hook: readonly string[];
    verses: readonly string[];
  }>;
  /** The next verse line to sing; verses carry on where the last one stopped. */
  cursor: { line: number };
}>;

/** Per-song habits drawn once, so the song is consistent with itself. */
type Style = Readonly<{
  hookPlan: PhrasePlan;
  versePlan: PhrasePlan;
  /** Who carries the hook in a drop. */
  dropLead: "vox+lead" | "lead+chops" | "chops+vox" | "vox";
  /** The lead doubles the hook this many semitones up (0 or 12). */
  leadOctave: number;
  dropBass: "kick" | "offbeat" | "rolling" | "syncop";
  verseBass: "sustain" | "kick" | "pulse";
  stabCell: Cell;
  stabsInDrop: boolean;
  arpOrder: readonly number[];
  arpRate: number;
  arpInVerse: boolean;
  chopCell: Motif;
  rollingSteps: string;
  harmonyThirds: boolean;
  fugueVox: boolean;
}>;

function drawStyle(rng: Rng, g: Genome): Style {
  const dna = g.rhythm;
  const instrumental = g.voice === "instrumental";
  return {
    hookPlan: rng.pick<PhrasePlan>(["AABA", "ABAC", "AA'AB", "ABAB", "AAAB"]),
    versePlan: rng.pick<PhrasePlan>(["AABA", "ABAB", "AA'AB", "ABAC"]),
    dropLead: instrumental
      ? "lead+chops"
      : g.voice === "chopped"
        ? rng.pick(["lead+chops", "chops+vox"] as const)
        : rng.weighted({
            "vox+lead": 4,
            "chops+vox": 2,
            vox: 1,
            "lead+chops": 1,
          }),
    leadOctave: rng.pick([0, 12, 12]),
    dropBass:
      g.sounds.bass === "sub808" || g.sounds.bass === "boom"
        ? "kick"
        : rng.pick(["kick", "offbeat", "rolling", "syncop"] as const),
    verseBass: rng.pick(["sustain", "kick", "pulse"] as const),
    stabCell: rhythmCell(rng, { ...dna, density: rng.range(0.5, 1.1) }, 4, {
      legato: 0.5,
    }),
    stabsInDrop: rng.chance(0.75),
    arpOrder: rng.pick([
      [0, 1, 2, 3],
      [0, 2, 1, 3],
      [3, 2, 1, 0],
      [0, 1, 2, 3, 2, 1],
      [0, 2, 3, 1],
      [0, 3, 1, 2],
    ]),
    arpRate: rng.pick([0.25, 0.25, 0.5, 1 / 3]),
    arpInVerse: rng.chance(0.5),
    chopCell: motif(rng, { ...dna, density: rng.range(2, 3.4) }, 4, 0.3, {
      legato: 0.7,
    }),
    rollingSteps: rng.pick([
      "r.o.r.ro.r.o.rr.",
      "rrorrrorrrorrror",
      "r.r.o.r.r.r.o.r.",
      "r..r..r.o..r..r.",
    ]),
    harmonyThirds: rng.chance(0.6),
    fugueVox: g.voice !== "instrumental" && rng.chance(0.5),
  };
}

// ---------------------------------------------------------------- notes

function put(
  c: Ctx,
  track: string,
  bar: number,
  notes: readonly MNote[],
  extra: (n: MNote) => Partial<NoteInput> = () => ({}),
): void {
  const end = c.s.info.bars * 4;
  for (const n of notes) {
    if (bar * 4 + n.beat >= end) continue;
    c.s.note(track, bar, n.beat, n.pitch, n.len, n.vel, {
      ...(n.lyric ? { lyric: n.lyric } : {}),
      ...extra(n),
    });
  }
}

const scoop = (n: MNote): Partial<NoteInput> =>
  n.len >= 0.85
    ? {
        bend: [
          { at: 0, cents: -80 },
          { at: 0.1, cents: 0 },
        ] as NoteInput["bend"],
      }
    : {};

/** Lyrics onto notes: words where the song wants words, vocables elsewhere. */
function sung(notes: readonly MNote[], syllables: readonly string[]): MNote[] {
  return notes.map((n, i) => ({
    ...n,
    lyric: syllables[i % Math.max(1, syllables.length)] ?? "ah",
  }));
}

/**
 * Words set the way a singer phrases them: one syllable per note in order,
 * starting the line again only at a unit boundary, so a repeat begins where
 * the motif does; notes past the line's end become rests.
 */
function fit(
  notes: readonly MNote[],
  syllables: readonly string[],
  unit: number,
  from = 0,
): MNote[] {
  if (!syllables.length) return [...notes];
  const out: MNote[] = [];
  let j = 0;
  let at = -1;
  for (const n of notes) {
    const u = Math.floor((n.beat - from + 1e-6) / unit);
    if (u !== at) {
      at = u;
      if (j >= syllables.length) j = 0;
    }
    if (j < syllables.length) out.push({ ...n, lyric: syllables[j++]! });
  }
  return out;
}

function wordsFor(
  c: Ctx,
  rng: Rng,
  count: number,
  kind: "verse" | "hook",
  index = 0,
): string[] {
  if (kind === "hook") {
    const hook = c.words.hook;
    return Array.from({ length: count }, (_, i) => hook[i % hook.length]!);
  }
  const given = c.words.verses[index];
  if (given) {
    const syl = given.split(/\s+/).filter(Boolean);
    return Array.from({ length: count }, (_, i) => syl[i % syl.length]!);
  }
  return rng.chance(c.g.words)
    ? line(rng, c.words.theme, count)
    : vocables(rng, count);
}

/** The vocal line on the song's singer, doubled a third below where the style asks. */
function voxLine(
  c: Ctx,
  bar: number,
  notes: readonly MNote[],
  o: Readonly<{ harmony?: boolean; high?: boolean }> = {},
): void {
  const shift = SINGERS[c.g.voice]?.shift ?? 0;
  put(
    c,
    "vox",
    bar,
    notes.map((n) => ({ ...n, pitch: n.pitch + shift })),
    scoop,
  );
  if (o.harmony) {
    const scale = c.g.scale.pcs;
    const thirds = notes
      .filter((n) => n.len >= 0.7)
      .map((n) => {
        const below = ladder(scale, n.pitch - 5, n.pitch - 1);
        return {
          ...n,
          pitch: below.find((p) => n.pitch - p >= 3) ?? n.pitch - 12,
          vel: n.vel * 0.75,
        };
      });
    put(c, "harm", bar, thirds);
  }
  if (o.high)
    put(
      c,
      "high",
      bar,
      notes.map((n) => ({ ...n, pitch: n.pitch + 12, vel: n.vel * 0.7 })),
    );
}

// ----------------------------------------------------------------- beds

function padBars(
  c: Ctx,
  sec: Section,
  chordAt: ChordAt,
  low = 50,
  high = 72,
  vel = 0.55,
  track = "pad",
): void {
  let prev: number[] | undefined;
  const rate = Math.max(1, c.g.harmony.rate);
  for (let b = 0; b < sec.bars * rate; b++) {
    const beat = (b * 4) / rate;
    const chord = chordAt(beat);
    const notes = voicing(chord, low, high, 4, prev);
    prev = notes;
    for (const p of notes)
      c.s.note(track, sec.start, beat + 0.01, p, (4 / rate) * 0.98, vel);
  }
}

function stabBars(c: Ctx, sec: Section, chordAt: ChordAt, vel = 0.7): void {
  let prev: number[] | undefined;
  for (let b = 0; b < sec.bars; b++)
    for (const { beat, len } of c.style.stabCell) {
      const at = b * 4 + beat;
      const notes = voicing(chordAt(at), 62, 79, 3, prev, false);
      prev = notes;
      for (const p of notes)
        c.s.note(
          "stabs",
          sec.start,
          at,
          p,
          Math.max(0.12, Math.min(len, 0.4)),
          vel * (beat % 1 === 0 ? 1 : 0.88),
        );
    }
}

function arpBars(
  c: Ctx,
  sec: Section,
  chordAt: ChordAt,
  vel = 0.55,
  from = 0,
  bars = sec.bars,
): void {
  const order = c.style.arpOrder;
  const step = c.style.arpRate;
  let k = 0;
  for (let beat = from * 4; beat < (from + bars) * 4 - 1e-6; beat += step) {
    const chord = chordAt(beat);
    const tones = ladder(chord.triad, 67, 88);
    const pool = tones.slice(0, 4);
    const idx = order[k % order.length]! % pool.length;
    c.s.note(
      "arp",
      sec.start,
      beat,
      pool[idx]!,
      step * 0.8,
      vel * (k % 4 === 0 ? 1 : 0.82),
    );
    k++;
  }
}

function bassBars(
  c: Ctx,
  sec: Section,
  chordAt: ChordAt,
  habit: Style["dropBass"] | Style["verseBass"],
  groove: Groove,
): void {
  const is808 = c.g.sounds.bass === "sub808" || c.g.sounds.bass === "boom";
  const low = is808 ? 31 : 36;
  const write = (
    beat: number,
    len: number,
    chord: Chord,
    octave = 0,
    vel = 0.85,
  ) => {
    const p = bassPitch(chord, low) + octave;
    c.s.note("bass", sec.start, beat, p, len, vel);
    if (!is808)
      c.s.note("sub", sec.start, beat, bassPitch(chord, 28), len, vel * 0.9);
  };
  for (let b = 0; b < sec.bars; b++) {
    const bar = b * 4;
    if (habit === "sustain") {
      write(bar, 3.9, chordAt(bar), 0, 0.7);
      continue;
    }
    if (habit === "pulse") {
      for (let q = 0; q < 4; q++)
        write(bar + q, 0.45, chordAt(bar + q), 0, q ? 0.62 : 0.78);
      continue;
    }
    if (habit === "kick") {
      const grid = (b % 4 === 3 ? groove.kick[1] : groove.kick[0])!;
      const hits = [...grid]
        .map((h, i) => (h === "." ? -1 : i))
        .filter((i) => i >= 0);
      hits.forEach((step, i) => {
        const beat = bar + step / 4;
        const next =
          hits[i + 1] !== undefined ? bar + hits[i + 1]! / 4 : bar + 4;
        // An 808 now and then leaps the octave on the last hit: the glide is the hook.
        const up =
          is808 && i === hits.length - 1 && hits.length > 2 && b % 2 === 1
            ? 12
            : 0;
        write(
          beat,
          Math.max(0.2, (next - beat) * (is808 ? 1.02 : 0.85)),
          chordAt(beat),
          up,
        );
      });
      continue;
    }
    if (habit === "offbeat") {
      for (let q = 0; q < 4; q++)
        write(bar + q + 0.5, 0.4, chordAt(bar + q), 0, 0.8);
      continue;
    }
    if (habit === "rolling") {
      [...c.style.rollingSteps].forEach((ch, i) => {
        if (ch === ".") return;
        write(
          bar + i / 4,
          0.22,
          chordAt(bar + i / 4),
          ch === "o" ? 12 : 0,
          i % 4 === 0 ? 0.9 : 0.72,
        );
      });
      continue;
    }
    // syncop: the stab cell, low.
    for (const { beat, len } of c.style.stabCell)
      write(
        bar + beat,
        Math.max(0.25, len * 1.6),
        chordAt(bar + beat),
        0,
        0.85,
      );
  }
}

function drumSection(
  c: Ctx,
  sec: Section,
  gr: Groove,
  o: Readonly<{
    sparse?: boolean;
    half?: boolean;
    energy?: number;
    fromBar?: number;
  }> = {},
): void {
  for (let b = o.fromBar ?? 0; b < sec.bars; b++)
    drumBar(c.s, sec.start + b, gr, {
      energy: o.energy ?? sec.energy,
      phraseBar: b % 4,
      last: b === sec.bars - 1,
      half: o.half,
      sparse: o.sparse,
    });
}

// ------------------------------------------------------------- sections

function hookNotes(c: Ctx, chordAt: ChordAt, range: Range): MNote[] {
  const rng = c.rng.fork("hook-phrase");
  const units = 16 / c.motifs.hook.beats;
  const plan =
    units === 4
      ? c.style.hookPlan
      : units === 2
        ? rng.pick<PhrasePlan>(["AB", "AA'"])
        : "A";
  const notes = phrase(
    rng,
    c.motifs.hook,
    plan,
    c.g.rhythm,
    c.g.leap,
    c.g.scale,
    chordAt,
    range,
    (range.low + range.high) / 2 + 2,
    { endHold: true },
  );
  return notes;
}

function writeDrop(c: Ctx, sec: Section, devices: ReadonlySet<Device>): void {
  const chordAt = timeline(c.loops.main, c.g.harmony.rate);
  const rng = c.rng.fork(`drop-${sec.nth}`);
  const octave = sec.last && devices.has("octave") ? 12 : 0;
  const half = sec.last && devices.has("halftime");
  const gr = c.grooves.main;
  drumSection(c, sec, gr, { half: half && sec.bars > 8 ? false : half });
  if (half && sec.bars > 8)
    drumSection(c, { ...sec, bars: sec.bars }, gr, { fromBar: sec.bars / 2 });
  bassBars(c, sec, chordAt, c.style.dropBass, gr);
  if (c.style.stabsInDrop) stabBars(c, sec, chordAt);
  padBars(c, sec, chordAt, 55, 76, c.style.stabsInDrop ? 0.45 : 0.62);
  if (!c.style.stabsInDrop || (sec.last && rng.chance(0.5)))
    arpBars(c, sec, chordAt, 0.5);
  const hook = hookNotes(c, chordAt, c.ranges.vox);
  const lead = c.style.dropLead;
  for (let p = 0; p < sec.bars / 4; p++) {
    const bar = sec.start + p * 4;
    const leadHook = hookNotes(c, chordAt, c.ranges.lead);
    if (lead.includes("vox")) {
      voxLine(c, bar, fit(hook, c.words.hook, c.motifs.hook.beats), {
        harmony: c.style.harmonyThirds && p % 2 === 1,
        high: octave > 0,
      });
    }
    if (lead.includes("lead")) {
      const up = lead === "vox+lead" ? c.style.leadOctave : 0;
      put(
        c,
        "lead",
        bar,
        (lead === "vox+lead" ? hook : leadHook).map((n) => ({
          ...n,
          pitch: n.pitch + up + octave,
          vel: n.vel * 0.85,
        })),
      );
    }
    if (lead.includes("chops")) {
      const riff = render(
        c.style.chopCell,
        0,
        c.ranges.chops.low + 7,
        c.g.scale,
        chordAt,
        c.ranges.chops,
        0.8,
      );
      for (let b = 0; b < 4; b++)
        put(
          c,
          "chops",
          bar + b,
          riff.map((n) => ({ ...n })),
          () => ({}),
        );
    }
    // A second line against the hook, now and then: the counterpoint habit.
    if (rng.chance(c.g.counterpoint)) {
      const against = lead.includes("vox") ? hook : leadHook;
      const cell = complement(rng, against, 0, 16);
      const counter = counterLine(
        rng,
        cell,
        0,
        [against],
        (beat) => melodicSet(c.g.scale, chordAt(beat)),
        { low: c.ranges.vox.low - 10, high: c.ranges.vox.low + 4 },
        c.ranges.vox.low - 3,
        0.3,
        0.62,
      );
      put(c, "counter", bar, counter);
    }
  }
  if (devices.has("glitch") && sec.bars >= 8)
    glitchBar(c, sec.start + sec.bars - 5, rng);
  if (rng.chance(0.5))
    c.s.note("spark", sec.start, 0, 84 + (c.g.tonic % 12) - 12, 1, 0.7);
  c.s.note("fx", sec.start, 0, 60, 1, 0.75); // tape thump on the one
  if (devices.has("downlifter")) c.s.note("fx", sec.start, 0, 40, 4, 0.5);
}

function writeVerse(c: Ctx, sec: Section): void {
  const chordAt = timeline(c.loops.verse, Math.min(1, c.g.harmony.rate));
  const rng = c.rng.fork(`verse-${sec.nth}`);
  const gr = c.grooves.verse;
  const sparseStart = sec.nth === 0 && sec.bars >= 8 && rng.chance(0.5);
  drumSection(c, sec, gr, { energy: sec.energy, fromBar: sparseStart ? 4 : 0 });
  if (sparseStart) drumSection(c, { ...sec, bars: 4 }, gr, { sparse: true });
  bassBars(c, sec, chordAt, c.style.verseBass, gr);
  padBars(c, sec, chordAt, 50, 70, 0.45);
  if (c.style.arpInVerse) arpBars(c, sec, chordAt, 0.42);
  const melody = phrase(
    c.rng.fork("verse-phrase"),
    c.motifs.verse,
    c.style.versePlan,
    c.g.rhythm,
    c.g.leap,
    c.g.scale,
    chordAt,
    { low: c.ranges.vox.low - 3, high: c.ranges.vox.high - 5 },
    c.ranges.vox.low + 4,
    { endHold: true },
  );
  for (let p = 0; p < sec.bars / 4; p++) {
    const bar = sec.start + p * 4;
    // Every other line rests its last bar, so the verse breathes.
    const notes = melody.filter((n) => p % 2 === 0 || n.beat < 12);
    if (c.g.voice === "instrumental")
      put(
        c,
        "lead",
        bar,
        notes.map((n) => ({ ...n, vel: n.vel * 0.8 })),
      );
    else if (c.words.verses.length) {
      // Two lines a phrase, a line every two bars, as the demos sing them.
      const lines = c.words.verses;
      const next = () => lines[c.cursor.line++ % lines.length]!.split(/\s+/);
      const first = next();
      const second = next();
      voxLine(c, bar, [
        ...fit(
          notes.filter((n) => n.beat < 8),
          first,
          8,
        ),
        ...fit(
          notes.filter((n) => n.beat >= 8),
          second,
          8,
          8,
        ),
      ]);
    } else
      voxLine(
        c,
        bar,
        sung(notes, wordsFor(c, rng, notes.length, "verse", sec.nth * 4 + p)),
      );
  }
  if (rng.chance(c.g.counterpoint)) {
    const cell = rhythmCell(rng, { ...c.g.rhythm, density: 0.9 }, 16, {
      hold: true,
    });
    const counter = counterLine(
      rng,
      cell,
      0,
      [melody],
      (beat) => melodicSet(c.g.scale, chordAt(beat)),
      { low: c.ranges.lead.low, high: c.ranges.lead.high },
      c.ranges.lead.low + 7,
      0.35,
      0.5,
    );
    for (let p = 0; p < sec.bars / 4; p++)
      if (p % 2 === 1) put(c, "counter", sec.start + p * 4, counter);
  }
}

function writePre(c: Ctx, sec: Section, devices: ReadonlySet<Device>): void {
  const chordAt = timeline(c.loops.pre, Math.max(1, c.g.harmony.rate));
  const rng = c.rng.fork(`pre-${sec.nth}`);
  const gr = c.grooves.verse;
  drumSection(c, { ...sec, bars: Math.max(0, sec.bars - 1) }, gr, {
    energy: sec.energy,
  });
  buildRoll(c.s, sec.start + sec.bars - 1, 0.3, 0.85);
  for (let b = 0; b < sec.bars; b++)
    c.s.grid(
      "kick",
      sec.start + b,
      36,
      b === sec.bars - 1 ? "9...9...9.9.9999" : "9...9...9...9...",
      0.75,
    );
  padBars(c, sec, chordAt, 52, 74, 0.55);
  arpBars(c, sec, chordAt, 0.5);
  for (let b = 0; b < sec.bars; b++)
    c.s.note("bass", sec.start + b, 0, bassPitch(chordAt(b * 4), 36), 3.8, 0.7);
  const units = Math.max(1, sec.bars);
  const notes: MNote[] = [];
  for (let u = 0; u < units; u++) {
    const r = render(
      c.motifs.pre,
      u * 4,
      c.ranges.vox.low + 3 + u * 2,
      c.g.scale,
      chordAt,
      c.ranges.vox,
      0.78,
    );
    notes.push(...r);
  }
  if (c.g.voice === "instrumental") put(c, "lead", sec.start, notes);
  else
    voxLine(
      c,
      sec.start,
      sung(notes, wordsFor(c, rng, notes.length, "verse", 40 + sec.nth)),
      { harmony: c.style.harmonyThirds },
    );
  // The build's lanes: the bed opens from dark, the noise rises.
  const from = sec.start;
  const to = sec.start + sec.bars;
  for (const id of ["pad", "arp", "stabs"])
    lane(
      c,
      id,
      "djf-value",
      ramps(
        [0, 0.5],
        [from, 0.5],
        [from + 0.01, 0.22],
        [to - 0.05, 0.5],
        [to, 0.5],
      ),
    );
  if (devices.has("riser") || devices.has("filter")) {
    c.s.note("sweep", sec.start, 0, 60, sec.bars * 4, 0.5);
    lane(
      c,
      "sweep",
      "filterAutomation",
      ramps([0, 600], [from, 600], [to, 7000], [to + 0.01, 600]),
    );
  }
  if (devices.has("crush")) {
    lane(
      c,
      "vox",
      "crush-mix",
      ramps([0, 0], [to - 1, 0], [to - 0.05, 0.7], [to, 0]),
    );
    lane(
      c,
      "vox",
      "crush-bits",
      ramps([0, 16], [to - 1, 12], [to - 0.05, 5], [to, 16]),
    );
  }
}

function writeBreak(c: Ctx, sec: Section): void {
  const chordAt = timeline(c.loops.verse, 0.5);
  const rng = c.rng.fork(`break-${sec.nth}`);
  padBars(c, sec, chordAt, 52, 76, 0.5);
  for (let b = 0; b < sec.bars; b += 2)
    c.s.note(
      "cloud",
      sec.start + b,
      0,
      nearest(ladder(chordAt(b * 4).triad, 60, 72), 66),
      7.8,
      0.6,
    );
  if (sec.bars >= 4)
    drumSection(
      c,
      { ...sec, start: sec.start + sec.bars - 2, bars: 2 },
      c.grooves.verse,
      { sparse: true },
    );
  // A ghost of the hook on chopped syllables, or vocables over the pad.
  const hook = hookNotes(
    c,
    timeline(c.loops.main, c.g.harmony.rate),
    c.ranges.vox,
  );
  if (c.g.voice === "instrumental")
    put(
      c,
      "lead",
      sec.start,
      hook.map((n) => ({ ...n, vel: n.vel * 0.6 })),
    );
  else
    voxLine(
      c,
      sec.start,
      sung(
        hook.filter((n) => n.beat < 8),
        vocables(rng, hook.length),
      ),
      { harmony: true },
    );
}

function writeBridge(c: Ctx, sec: Section): void {
  const chordAt = timeline(c.loops.bridge, 1);
  const rng = c.rng.fork(`bridge-${sec.nth}`);
  drumSection(c, sec, c.grooves.verse, { half: true, energy: sec.energy });
  padBars(c, sec, chordAt, 50, 74, 0.55);
  for (let b = 0; b < sec.bars; b++)
    c.s.note("bass", sec.start + b, 0, bassPitch(chordAt(b * 4), 36), 3.8, 0.7);
  const melody = phrase(
    rng,
    c.motifs.bridge,
    "ABAC",
    c.g.rhythm,
    c.g.leap,
    c.g.scale,
    chordAt,
    c.ranges.vox,
    c.ranges.vox.high - 4,
    { endHold: true },
  );
  for (let p = 0; p < sec.bars / 4; p++) {
    if (c.g.voice === "instrumental") put(c, "lead", sec.start + p * 4, melody);
    else
      voxLine(
        c,
        sec.start + p * 4,
        sung(melody, wordsFor(c, rng, melody.length, "verse", 60 + p)),
        { harmony: p === 1 },
      );
    // The bridge is where counterpoint lives: always a second line.
    const counter = counterLine(
      rng,
      complement(rng, melody, 0, 16),
      0,
      [melody],
      (beat) => melodicSet(c.g.scale, chordAt(beat)),
      { low: c.ranges.lead.low - 5, high: c.ranges.lead.high },
      c.ranges.lead.low + 3,
      0.3,
      0.55,
    );
    put(c, "counter", sec.start + p * 4, counter);
  }
}

function writeSwitch(c: Ctx, sec: Section): void {
  // The beat switch: the alt groove, a new riff, the same key and chords.
  const chordAt = timeline(c.loops.main, c.g.harmony.rate);
  const rng = c.rng.fork("switch");
  const gr = c.grooves.alt;
  drumSection(c, sec, gr);
  bassBars(c, sec, chordAt, "kick", gr);
  stabBars(c, sec, chordAt, 0.62);
  const riff = phrase(
    rng,
    c.motifs.switch,
    rng.pick<PhrasePlan>(["AAAB", "ABAB"]),
    { ...c.g.rhythm, density: c.g.rhythm.density * 1.3 },
    c.g.leap,
    c.g.scale,
    chordAt,
    c.ranges.lead,
    c.ranges.lead.low + 7,
  );
  for (let p = 0; p < sec.bars / 4; p++) {
    put(c, "lead", sec.start + p * 4, riff);
    if (c.g.voice !== "instrumental" && p % 2 === 1) {
      const chops = render(
        c.style.chopCell,
        0,
        c.ranges.chops.low + 5,
        c.g.scale,
        chordAt,
        c.ranges.chops,
        0.75,
      );
      for (let b = 0; b < 4; b++) put(c, "chops", sec.start + p * 4 + b, chops);
    }
  }
}

function writeFugue(c: Ctx, sec: Section): void {
  const rng = c.rng.fork("fugue");
  const bars = sec.bars >= 8 ? 8 : 4;
  const count = rng.chance(0.7) ? 3 : 2;
  const f = fugue(rng, c.g.scale, c.g.rhythm, bars, count);
  f.voices.forEach((notes, i) => {
    if (i === 0 && c.style.fugueVox) {
      const syl = vocables(rng, notes.length);
      put(
        c,
        "vox",
        sec.start,
        notes.map((n, k) => ({
          ...n,
          lyric: syl[k]!,
          pitch: n.pitch + (SINGERS[c.g.voice]?.shift ?? 0),
        })),
      );
    } else put(c, `fg${i + 1}`, sec.start, notes);
  });
  // A held tonic under the cadence, and the bed creeps back in for the drop.
  const last = sec.start + sec.bars - 1;
  c.s.note(
    "sub",
    last,
    2,
    c.g.scale.root - 24 + (c.g.scale.root - 24 < 28 ? 12 : 0),
    2,
    0.7,
  );
  drumSection(c, { ...sec, start: last, bars: 1 }, c.grooves.main, {
    sparse: true,
    energy: 0.5,
  });
}

function writeIntro(c: Ctx, sec: Section): void {
  const chordAt = timeline(c.loops.main, c.g.harmony.rate);
  padBars(c, sec, chordAt, 52, 74, 0.45);
  if (sec.bars >= 4)
    arpBars(
      c,
      sec,
      chordAt,
      0.4,
      Math.floor(sec.bars / 2),
      Math.ceil(sec.bars / 2),
    );
  lane(
    c,
    "pad",
    "djf-value",
    ramps(
      [0, 0.2],
      [sec.start + sec.bars - 0.01, 0.42],
      [sec.start + sec.bars, 0.5],
    ),
  );
  lane(
    c,
    "arp",
    "djf-value",
    ramps(
      [0, 0.25],
      [sec.start + sec.bars - 0.01, 0.45],
      [sec.start + sec.bars, 0.5],
    ),
  );
  if (sec.bars >= 4)
    drumSection(
      c,
      { ...sec, start: sec.start + sec.bars - 2, bars: 2 },
      c.grooves.verse,
      { sparse: true },
    );
  // A preview of the hook's first bar on the chops, filtered.
  if (c.g.voice !== "instrumental") {
    const riff = render(
      c.style.chopCell,
      0,
      c.ranges.chops.low + 7,
      c.g.scale,
      chordAt,
      c.ranges.chops,
      0.55,
    );
    put(c, "chops", sec.start + sec.bars - 1, riff);
  }
}

function writeOutro(c: Ctx, sec: Section): void {
  const chordAt = timeline(c.loops.main, c.g.harmony.rate);
  padBars(c, sec, chordAt, 52, 74, 0.45);
  const rng = c.rng.fork(`outro-${sec.nth}`);
  const hook = hookNotes(c, chordAt, c.ranges.vox).filter(
    (n) => n.beat < Math.min(8, sec.bars * 4 - 2),
  );
  if (c.g.voice === "instrumental")
    put(
      c,
      "lead",
      sec.start,
      hook.map((n) => ({ ...n, vel: n.vel * 0.6 })),
    );
  else voxLine(c, sec.start, fit(hook, c.words.hook, c.motifs.hook.beats));
  if (sec.bars >= 4)
    drumSection(c, { ...sec, bars: 2 }, c.grooves.main, { energy: 0.5 });
  lane(
    c,
    "pad",
    "djf-value",
    ramps([sec.start, 0.5], [sec.start + sec.bars, 0.18]),
  );
}

function glitchBar(c: Ctx, bar: number, rng: Rng): void {
  const beat = rng.pick([2, 3]);
  for (let i = 0; i < 8; i++) {
    c.s.note("snare", bar, beat + i / 8, 38, 0.06, 0.4 + 0.06 * i);
    if (i % 2 === 0) c.s.note("kick", bar, beat + i / 8, 36, 0.06, 0.6);
  }
  const keep = c.s.notes.filter(
    (n) =>
      n.trackId === "vox" &&
      on(n) >= Math.round(bar * BAR) &&
      on(n) < Math.round((bar + 1) * BAR),
  );
  const first = keep[0];
  if (first)
    for (let i = 0; i < 6; i++)
      c.s.note("vox", bar, beat + i / 8, first.pitch, 0.1, 0.7, {
        lyric: first.lyric ?? "ah",
      });
}

function lane(
  c: Ctx,
  track: string,
  key: string,
  points: AutomationPoint[],
): void {
  const l = c.lanes.get(track) ?? {};
  l[key] = merge(l[key] ?? [], points);
  c.lanes.set(track, l);
}

// --------------------------------------------------------------- seams

const tickOf = (bar: number, beat = 0) => Math.round(bar * BAR + beat * TPB);
const on = (n: NoteInput): number => n.startTick ?? 0;
const dur = (n: NoteInput): number => n.durationTicks ?? 0;
const DRUM_IDS = new Set(["kick", "snare", "hats", "perc"]);

/** Silence everything but the singer's pickup across [from, to) ticks. */
function gap(s: Composer, from: number, to: number): void {
  for (let i = s.notes.length - 1; i >= 0; i--) {
    const n = s.notes[i]!;
    if (n.trackId === "vox" || n.trackId === "fx" || n.trackId === "sweep")
      continue;
    if (on(n) >= from && on(n) < to) s.notes.splice(i, 1);
    else if (on(n) < from && on(n) + dur(n) > from)
      s.notes[i] = { ...n, durationTicks: from - on(n) };
  }
}

/** Everything sounding in [from, to) bends down an octave; drums stop. */
function tapeStop(s: Composer, from: number, to: number): void {
  for (let i = s.notes.length - 1; i >= 0; i--) {
    const n = s.notes[i]!;
    const end = on(n) + dur(n);
    if (end <= from || on(n) >= to) continue;
    if (DRUM_IDS.has(n.trackId)) {
      if (on(n) >= from) s.notes.splice(i, 1);
      continue;
    }
    if (n.trackId === "fx" || n.trackId === "sweep") continue;
    const stop = Math.min(end, to);
    const at = Math.max(0, (from - on(n)) / Math.max(1, stop - on(n)));
    s.notes[i] = {
      ...n,
      durationTicks: stop - on(n),
      bend: [
        { at, cents: 0 },
        { at: 1, cents: -1200 },
      ] as NoteInput["bend"],
    };
  }
}

/** The last held note of `track` before `tick` dives an octave. */
function dive(s: Composer, track: string, tick: number): void {
  const cands = s.notes
    .map((n, i) => ({ n, i }))
    .filter(
      ({ n }) =>
        n.trackId === track &&
        on(n) < tick &&
        on(n) >= tick - 2 * BAR &&
        dur(n) >= TPB / 2,
    );
  const last = cands.at(-1);
  if (last)
    s.notes[last.i] = {
      ...last.n,
      bend: [
        { at: 0, cents: 0 },
        { at: 0.5, cents: 0 },
        { at: 1, cents: -1200 },
      ] as NoteInput["bend"],
    };
}

/** The last beat before `bar` ratchets: chords in 16ths then 32nds. */
function stutter(c: Ctx, bar: number, chordAt: ChordAt): void {
  const chord = voicing(chordAt(0), 62, 79, 3, undefined, false);
  for (let i = 0; i < 12; i++) {
    const beat = 3 + (i < 4 ? i * 0.125 : 0.5 + (i - 4) * 0.0625);
    for (const p of chord)
      c.s.note("stabs", bar - 1, beat, p, 0.05, 0.45 + 0.04 * i);
  }
}

function seams(
  c: Ctx,
  sections: readonly Section[],
  devices: ReadonlySet<Device>,
): void {
  const rng = c.rng.fork("seams");
  sections.forEach((sec, i) => {
    const next = sections[i + 1];
    if (!next || (next.kind !== "drop" && next.kind !== "switch")) return;
    const end = sec.start + sec.bars;
    // Each seam into a drop uses one move; the song cycles through its own.
    const moves = (["gap", "tapestop", "stutter", "dive"] as const).filter(
      (d) => devices.has(d),
    );
    const move = moves.length
      ? moves[(next.nth + rng.int(0, moves.length - 1)) % moves.length]
      : undefined;
    if (move === "gap")
      gap(c.s, tickOf(end - 1, rng.pick([2, 3, 3.5])), tickOf(end));
    else if (move === "tapestop")
      tapeStop(c.s, tickOf(end - 1, 2), tickOf(end));
    else if (move === "stutter")
      stutter(c, end, timeline(c.loops.main, c.g.harmony.rate));
    else if (move === "dive")
      dive(c.s, c.g.voice === "instrumental" ? "lead" : "vox", tickOf(end));
    // Into the last drop the singer stutters the hook's first word, the
    // peak-word move the demos make, unless the seam is silence.
    const lastDrop = !sections.slice(i + 2).some((x) => x.kind === "drop");
    if (
      next.kind === "drop" &&
      lastDrop &&
      c.g.voice !== "instrumental" &&
      move !== "gap" &&
      move !== "tapestop"
    ) {
      const word = (c.words.hook[0] ?? "ah").replace(/-$/, "");
      const tones = ladder(
        c.loops.main[0]!.triad,
        c.ranges.vox.low + 5,
        c.ranges.vox.high,
      );
      const pitch = tones[Math.floor(tones.length / 2)] ?? c.ranges.vox.high;
      const shift = SINGERS[c.g.voice]?.shift ?? 0;
      for (let k = 0; k < 6; k++)
        c.s.note(
          "high",
          end - 1,
          2.5 + k * 0.25,
          pitch + shift,
          0.18,
          0.5 + 0.07 * k,
          {
            lyric: word,
          },
        );
    }
    if (devices.has("riser") && sec.kind !== "pre")
      c.s.note("fx", Math.max(sec.start, end - 2), 0, 48, 8, 0.6);
  });
}

/**
 * Section dynamics: verses and breaks sit back, builds swell, drops land
 * at full strength, so the drop is the loudest thing in the song.
 */
function dynamics(s: Composer, sections: readonly Section[]): void {
  const gain = (sec: Section, t: number): number => {
    switch (sec.kind) {
      case "drop":
      case "switch":
        return 1;
      case "pre":
        return 0.46 + 0.36 * t;
      case "verse":
        return 0.64;
      case "bridge":
        return 0.64;
      case "intro":
      case "outro":
        return 0.6;
      default:
        return 0.64;
    }
  };
  for (let i = 0; i < s.notes.length; i++) {
    const n = s.notes[i]!;
    if (n.trackId === "fx" || n.trackId === "sweep" || n.trackId === "spark")
      continue;
    const bar = on(n) / BAR;
    const sec = sections.find((x) => bar >= x.start && bar < x.start + x.bars);
    if (!sec) continue;
    s.notes[i] = {
      ...n,
      velocity: n.velocity * gain(sec, (bar - sec.start) / sec.bars),
    };
  }
}

/** A stored score holds at most 4096 notes; the busiest layers give way first. */
const BUDGET = 4000;
function thin(s: Composer): void {
  const passes: ((n: NoteInput, i: number) => boolean)[] = [
    (n) => n.trackId === "hats" && n.velocity < 0.6,
    (n) => n.trackId === "arp" && Math.round(on(n) / (TPB / 4)) % 2 === 1,
    (n) => n.trackId === "perc",
    (n) => n.trackId === "hats" && Math.round(on(n) / (TPB / 4)) % 2 === 1,
    (n) => n.trackId === "stabs" && on(n) % TPB !== 0,
    (n) => n.trackId === "arp" && Math.round(on(n) / (TPB / 2)) % 2 === 1,
  ];
  for (const drop of passes) {
    if (s.notes.length <= BUDGET) return;
    for (let i = s.notes.length - 1; i >= 0 && s.notes.length > BUDGET; i--)
      if (drop(s.notes[i]!, i)) s.notes.splice(i, 1);
  }
}

// ---------------------------------------------------------------- tracks

const LEVELS: Readonly<Record<string, number>> = {
  bass: 0.52,
  sub: 0.48,
  pad: 0.3,
  stabs: 0.34,
  arp: 0.26,
  lead: 0.34,
  counter: 0.26,
  vox: 0.74,
  harm: 0.42,
  high: 0.3,
  chops: 0.34,
  cloud: 0.24,
  fx: 0.24,
  spark: 0.16,
  fg1: 0.42,
  fg2: 0.4,
  fg3: 0.44,
};

/** The palette trim that puts `sound` at its role's loudness. */
const trim = (role: string, sound: string) => SOUND_TRIMS[role]?.[sound] ?? 1;

function tracksFor(c: Ctx, used: ReadonlySet<string>): TrackInput[] {
  const g = c.g;
  const d = g.design;
  const rng = c.rng.fork("tracks");
  const s = SINGERS[g.voice] ?? SINGERS.sung!;
  const baroque = rng.shuffle(Object.keys(BAROQUE));
  const counterSound = rng.pick(
    Object.keys(ARP).filter((k) => k !== g.sounds.arp),
  );
  const make: Record<string, () => TrackInput> = {
    bass: () =>
      BASS[g.sounds.bass]!(
        "bass",
        "Bass",
        LEVELS.bass! * trim("bass", g.sounds.bass),
        d,
      ),
    sub: () => subTrack(LEVELS.sub!),
    pad: () =>
      PAD[g.sounds.pad]!(
        "pad",
        "Pad",
        LEVELS.pad! * trim("pad", g.sounds.pad),
        d,
      ),
    stabs: () =>
      STAB[g.sounds.stab]!(
        "stabs",
        "Stabs",
        LEVELS.stabs! * trim("stab", g.sounds.stab),
        d,
      ),
    arp: () =>
      ARP[g.sounds.arp]!(
        "arp",
        "Arp",
        LEVELS.arp! * trim("arp", g.sounds.arp),
        d,
      ),
    lead: () =>
      LEAD[g.sounds.lead]!(
        "lead",
        "Lead",
        LEVELS.lead! * trim("lead", g.sounds.lead),
        d,
      ),
    counter: () => ({
      ...ARP[counterSound]!(
        "counter",
        "Counter line",
        LEVELS.counter! * trim("arp", counterSound),
        d,
      ),
      pan: 0.28,
    }),
    vox: () => singer("vox", "Singer", LEVELS.vox!, s, d),
    harm: () => harmonySinger("harm", "Harmony", LEVELS.harm!, s, d),
    high: () =>
      singer(
        "high",
        "High double",
        LEVELS.high!,
        { ...s, preset: "glass", formant: s.formant + 2 },
        d,
        { pan: -0.28 },
      ),
    chops: () => chopTrack("chops", rng, rng.int(2, 4), LEVELS.chops!, d),
    cloud: () =>
      cloudTrack("cloud", LEVELS.cloud!, d, rng.pick(["vowel-ah", "vowel-oh"])),
    fx: () => fxTrack("fx", LEVELS.fx!),
    spark: () => sparkTrack("spark", LEVELS.spark!, d),
    fg1: () => ({
      ...BAROQUE[baroque[0]!]!(
        "fg1",
        "Fugue I",
        LEVELS.fg1! * trim("baroque", baroque[0]!),
        d,
      ),
      pan: 0.3,
    }),
    fg2: () => ({
      ...BAROQUE[baroque[1]!]!(
        "fg2",
        "Fugue II",
        LEVELS.fg2! * trim("baroque", baroque[1]!),
        d,
      ),
      pan: -0.3,
    }),
    fg3: () =>
      BAROQUE[baroque[2]!]!(
        "fg3",
        "Fugue III",
        LEVELS.fg3! * trim("baroque", baroque[2]!),
        d,
      ),
  };
  const out: TrackInput[] = drumTracks(g.bpm, g.drums, d).filter((t) =>
    used.has(t.id),
  );
  for (const [id, build] of Object.entries(make))
    if (used.has(id)) out.push(build());
  // Lanes land on the tracks; any track with a dj-filter lane gets the filter.
  return out.map((track) => {
    const thrown =
      track.id === "vox"
        ? throwLane(c.s.notes, track.delay?.mix ?? 0.08)
        : undefined;
    const t = thrown ? { ...track, delayMixAutomation: thrown } : track;
    const l = c.lanes.get(t.id);
    if (!l) return t;
    const fxAutomation: Record<string, AutomationPoint[]> = {
      ...(t.fxAutomation as Record<string, AutomationPoint[]> | undefined),
    };
    let extra: Partial<TrackInput> = {};
    for (const [key, points] of Object.entries(l)) {
      if (key === "filterAutomation")
        extra = { ...extra, filterAutomation: points };
      else fxAutomation[key] = points;
    }
    const fx = { ...(t.fx ?? {}) } as Record<string, unknown>;
    if (l["djf-value"]) fx.djf = { value: 0.5 };
    if ((l["crush-mix"] || l["crush-bits"]) && !fx.crush)
      fx.crush = { bits: 16, coarse: 1, mix: 0 };
    return {
      ...t,
      ...extra,
      fx: fx as TrackInput["fx"],
      fxAutomation: fxAutomation as TrackInput["fxAutomation"],
    };
  });
}

/**
 * Delay throws, as the demos do them: the echo opens on the held word that
 * ends a line and closes before the next one starts, at most once in four bars.
 */
function throwLane(
  notes: readonly NoteInput[],
  base: number,
): AutomationPoint[] | undefined {
  const vox = notes
    .filter((n) => n.trackId === "vox")
    .sort((a, b) => on(a) - on(b));
  const points: AutomationPoint[] = [{ tick: 0, value: base }];
  let last = -Infinity;
  vox.forEach((n, i) => {
    const end = on(n) + dur(n);
    const next = vox[i + 1];
    if (dur(n) < TPB || on(n) - last < 4 * BAR) return;
    // The word must be the line's last: the next one waits until it ends.
    if (next && on(next) < end - TPB / 8) return;
    last = on(n);
    const close = Math.min(end + TPB, next ? on(next) : Infinity);
    points.push(
      { tick: on(n), value: base },
      { tick: on(n) + Math.round(dur(n) / 2), value: 0.36 },
      { tick: close - 1, value: 0.36 },
      { tick: close, value: base },
    );
  });
  return points.length > 1 ? merge(points) : undefined;
}

// ------------------------------------------------------------------ song

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "song";

export function compileGenome(g: Genome, content: Content = {}): GenSong {
  const rng = new Rng(g.seed).fork("compose");
  const theme = content.theme ?? rng.fork("theme").pick(THEME_NAMES);
  const songTitle = content.title ?? makeTitle(rng.fork("title"), theme);
  const sections = layout(rng.fork("layout"), g);
  const bars = sections.reduce((n, s) => n + s.bars, 0);
  const firstDrop = sections.find((s) => s.kind === "drop")?.start ?? 0;
  const s = new Composer(
    demoInfo({
      id: slug(songTitle),
      title: songTitle,
      style: "Hyperpop",
      description: `Generated hyperpop: ${describeGenome(g).join("; ")}.`,
      tempoBpm: g.bpm,
      key: g.scale.label,
      bars,
      highlightBar: firstDrop,
      trackId: "lead",
      features: describeGenome(g),
      arrangement: sections.map((x) => `${x.name} ${x.bars}`),
      mixNotes: [
        "the kick pumps every melodic bus on orbit 2",
        "the singer ducks the bed while a line sings",
      ],
    }),
  );
  const h = rng.fork("harmony");
  const mainLen =
    g.harmony.main === "circle" || g.harmony.main === "lament" ? 8 : 4;
  const loops = {
    main: progression(h, g.scale, g.harmony.main, mainLen, g.harmony.color),
    verse: progression(h, g.scale, g.harmony.verse, 4, g.harmony.color),
    bridge: progression(
      h,
      g.scale,
      g.harmony.bridge,
      g.harmony.bridge === "circle" ? 8 : 4,
      g.harmony.color,
    ),
    pre: progression(h, g.scale, "loop", 4, g.harmony.color),
  };
  const gr = rng.fork("grooves");
  const grooves = {
    main: groove(gr, g.drums.main, g.drums.busy, g.swing),
    verse: groove(gr, g.drums.verse, g.drums.busy * 0.6, g.swing),
    alt: groove(gr, g.drums.alt, g.drums.busy, g.swing),
  };
  const root = g.scale.root;
  const ranges = {
    vox: { low: root + 3, high: root + 19 },
    lead: { low: root + 7, high: root + 26 },
    chops: { low: root + 10, high: root + 24 },
  };
  const m = rng.fork("motifs");
  const dna = g.rhythm;
  const motifs = {
    hook: motif(
      m,
      { ...dna, density: dna.density * 0.8 },
      m.pick([4, 4, 8]),
      g.leap,
      { hold: true },
    ),
    verse: motif(
      m,
      {
        ...dna,
        density: dna.density * 1.25,
        syncopation: Math.min(1, dna.syncopation + 0.15),
      },
      4,
      g.leap * 0.6,
      { late: m.chance(0.4) },
    ),
    pre: motif(m, dna, 4, g.leap, { hold: true }),
    bridge: motif(m, { ...dna, density: dna.density * 0.7 }, 4, g.leap, {
      hold: true,
    }),
    switch: motif(m, { ...dna, density: dna.density * 1.4 }, 4, g.leap),
  };
  const w = rng.fork("words");
  const hookCount = 12;
  const titleWords = songTitle.toLowerCase().split(/\s+/);
  const hook =
    content.hook ??
    (g.words > 0.3
      ? [
          ...titleWords.flatMap(
            (x) =>
              x.match(
                /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/g,
              ) ?? [x],
          ),
          ...line(w, theme, hookCount),
        ].slice(0, hookCount)
      : vocables(w, hookCount));
  // What the model wrote replaces what the seed drew, part by part.
  const music = content.music;
  const read = readMusic(music, g.scale);
  const drawn = drawStyle(rng.fork("style"), g);
  const style: Style = {
    ...drawn,
    ...(music?.hookPlan ? { hookPlan: music.hookPlan } : {}),
    ...(music?.versePlan ? { versePlan: music.versePlan } : {}),
    ...(music?.dropLead && g.voice !== "instrumental"
      ? { dropLead: music.dropLead }
      : {}),
    ...(music?.dropBass ? { dropBass: music.dropBass } : {}),
    ...(music?.verseBass ? { verseBass: music.verseBass } : {}),
    ...(music?.leadOctave !== undefined
      ? { leadOctave: music.leadOctave ? 12 : 0 }
      : {}),
    ...(music?.stabsInDrop !== undefined
      ? { stabsInDrop: music.stabsInDrop }
      : {}),
    ...(music?.harmonyThirds !== undefined
      ? { harmonyThirds: music.harmonyThirds }
      : {}),
  };
  const c: Ctx = {
    s,
    g,
    rng,
    lanes: new Map(),
    grooves,
    loops: {
      main: read.loops.drop ?? loops.main,
      verse: read.loops.verse ?? loops.verse,
      bridge: read.loops.bridge ?? loops.bridge,
      pre: read.loops.pre ?? loops.pre,
    },
    style,
    ranges,
    motifs: { ...motifs, ...read.motifs },
    words: { theme, hook, verses: content.verses ?? [] },
    cursor: { line: 0 },
  };
  const devices = new Set<Device>(g.devices);
  for (const sec of sections) {
    s.section(sec.name, sec.start, sec.bars);
    if (sec.kind === "drop") writeDrop(c, sec, devices);
    else if (sec.kind === "verse") writeVerse(c, sec);
    else if (sec.kind === "pre") writePre(c, sec, devices);
    else if (sec.kind === "break") writeBreak(c, sec);
    else if (sec.kind === "bridge") writeBridge(c, sec);
    else if (sec.kind === "switch") writeSwitch(c, sec);
    else if (sec.kind === "fugue") writeFugue(c, sec);
    else if (sec.kind === "intro") writeIntro(c, sec);
    else writeOutro(c, sec);
  }
  seams(c, sections, devices);
  dynamics(s, sections);
  thin(s);
  const used = new Set(s.notes.map((n) => n.trackId));
  for (const t of tracksFor(c, used)) s.track(t);
  const notes = [
    ...describeGenome(g),
    `title: ${songTitle} (${theme})`,
    `form: ${sections.map((x) => `${x.name} ${x.bars}`).join(", ")}`,
    `chords: drop ${c.loops.main.map((x) => x.name).join(" ")}; verse ${c.loops.verse.map((x) => x.name).join(" ")}; bridge ${c.loops.bridge.map((x) => x.name).join(" ")}`,
    `hook carried by ${c.style.dropLead}; drop bass ${c.style.dropBass}; verse bass ${c.style.verseBass}`,
  ];
  if (music)
    notes.push(
      `music: ${Object.keys(read.loops).length} chord loops and ${Object.keys(read.motifs).length} motifs from the card`,
      ...read.warnings,
    );
  return { title: songTitle, genome: g, sections, score: s.finish(), notes };
}
