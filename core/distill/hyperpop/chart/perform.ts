/**
 * Chart in, song out: the demos' craft applied to any chart. The chart owns
 * the material (chords, sung lines, hooks, riffs, which layers play, where
 * the moves land); everything a producer does around it is computed here:
 *
 * - drums from the section's feel, ornamented at phrase ends, with a
 *   different fill at every section end and a crash on each arrival
 * - an 808 locked to the kick that slides between roots, approaches the next
 *   root by step and pops an octave before a phrase turns
 * - a bed voiced by common tones with its top voice under the singer's
 *   lowest held note, 4-3 and 9-8 suspensions in the pre-chorus, stabs above
 *   the singer that grow denser on each pass, two interlocking arpeggios
 * - the singer scooped and held, a harmony a chord tone under the held
 *   words, an octave double, a vocoder that sings the line back as a chord,
 *   chops on the song's own syllables, delay throws on line ends
 * - a lead that answers in the singer's rests when no hook is written, and
 *   a counter-line that does the same an octave up
 * - every repeat of a section adds a layer, unless the chart already did
 * - given a vocal book that sings the chart's lines (`phrases`), the demos'
 *   sampled stack on top: every line as a oneshot, the chipmunk double in
 *   the big sections, chops re-pitched from the book's syllables, the held
 *   vowel doubling the hook and as a grain cloud on the chords
 */
import { BAR, Composer, TPB } from "../../../demos/build.ts";
import {
  LINE_LEAD,
  chopTrack,
  doubleTrack,
  grainTrack,
  merge,
  slot,
  vocalTrack,
  voiceLeadTrack,
  type Sung,
  type VoxBank,
} from "../../../demos/hyperpop.ts";
import { demoInfo } from "../../../demos/types.ts";
import type {
  AutomationPoint,
  NoteInput,
  TrackInput,
  TrackScore,
} from "../../../score.ts";
import { buildRoll, groove, type Fill, type Groove } from "../genome/drums.ts";
import { DRUM_TRIMS, SOUND_TRIMS } from "../genome/levels.ts";
import { Rng } from "../genome/rng.ts";
import {
  ARP,
  BASS,
  LEAD,
  PAD,
  SINGERS,
  STAB,
  cloudTrack,
  drumTracks,
  fxTrack,
  harmonySinger,
  singer,
  sparkTrack,
  subTrack,
  withGain,
} from "../genome/sounds.ts";
import {
  bassPitch,
  ladder,
  voicing,
  type Chord,
  type Scale,
} from "../genome/theory.ts";
import {
  chartScale,
  checkChart,
  readChords,
  readLine,
  type Chart,
  type ChartKind,
  type ChartSection,
  type Feel,
  type Layer,
  type LineNote,
} from "./format.ts";

type Extra = Partial<NoteInput>;

/** A section placed on the song's timeline. */
export type Placed = ChartSection &
  Readonly<{
    start: number;
    /** Which pass of its kind this is (0 for the first). */
    nth: number;
    /** The last pass of its kind. */
    final: boolean;
    halves: readonly Chord[];
    /** The layers it plays once development has had its say. */
    layers: ReadonlySet<Layer>;
    energy: number;
  }>;

export type Performed = Readonly<{
  title: string;
  score: TrackScore;
  placed: readonly Placed[];
  /** The share of each track's notes dropped to fit the note budget. */
  thinned: Readonly<Record<string, number>>;
  notes: readonly string[];
  /** Every distinct sung line, for a vocal book to sing (first use first). */
  phrases: readonly Phrase[];
}>;

/**
 * A sung line as a vocal book records it: notes from the line's downbeat
 * (`_` holds join the note before), keyed by its content so a repeat of the
 * line reuses the take.
 */
export type Phrase = Readonly<{
  key: string;
  /** The kind of section that first sings it. */
  kind: ChartKind;
  beats: number;
  notes: readonly Sung[];
}>;

/** A placed note of a line, in song bars and beats. */
type Note = {
  bar: number;
  beat: number;
  pitch: number;
  length: number;
  velocity: number;
  lyric?: string;
  vibrato: boolean;
  fall: boolean;
  keep: boolean;
};

const pc = (pitch: number) => ((pitch % 12) + 12) % 12;
const tickOf = (bar: number, beat = 0) => Math.round(bar * BAR + beat * TPB);
const on = (n: NoteInput) => n.startTick ?? 0;
const dur = (n: NoteInput) => n.durationTicks ?? 0;
const BUDGET = 4000;
const DRUMS = new Set(["kick", "snare", "hats", "perc"]);
const FILLS: readonly Fill[] = ["roll", "toms", "ratchet", "flam", "drop"];

const ENERGY: Readonly<Record<ChartKind, number>> = {
  intro: 0.45,
  verse: 0.62,
  pre: 0.72,
  chorus: 0.88,
  drop: 1,
  break: 0.3,
  bridge: 0.5,
  outro: 0.45,
};

/** What a repeat adds when the chart plays it exactly as before. */
const LADDER: Readonly<Record<ChartKind, readonly Layer[]>> = {
  intro: [],
  verse: ["counter", "arp", "harmony"],
  pre: ["arp", "harmony", "stabs"],
  chorus: ["arp2", "harmony", "double", "stabs", "counter"],
  drop: ["counter", "arp2", "chops", "stabs"],
  break: ["cloud"],
  bridge: ["counter"],
  outro: [],
};

/** Stab grids by pass: two a bar, then four, then a pushing eight. */
const STAB_PASSES = [
  ["......8.......7.", "......8.....7..."],
  ["..8...7...8...7.", "..8...7...8.7..."],
  ["..8.7.8...8.7.8.", "..8.7.8..78.7.8."],
];
/** The chops' riff cells: onsets in beats and steps up the chord. */
const CHOP_CELLS = [
  { beats: [0, 0.75, 1.5, 2.5, 3], steps: [0, 2, 1, 3, 2] },
  { beats: [0, 0.5, 0.75, 1.5, 3], steps: [2, 2, 3, 1, 0] },
  { beats: [0, 0.75, 1.5, 2, 2.75, 3.5], steps: [0, 2, 1, 2, 3, 4] },
  { beats: [0.5, 1, 1.75, 2.5, 3], steps: [3, 2, 1, 2, 0] },
];
const ARP_ORDERS = ["01231234", "43213210", "23432101", "01234321"];

/** An 8-hex FNV-1a digest. */
const hash = (text: string) =>
  (
    [...text].reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
      2166136261,
    ) >>> 0
  )
    .toString(16)
    .padStart(8, "0");
/** The octave of `pitch` nearest `center`. */
const near = (pitch: number, center: number) =>
  pitch + 12 * Math.round((center - pitch) / 12);
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "song";

function place(chart: Chart, scale: Scale): Placed[] {
  const seen = new Map<ChartKind, number>();
  const total = new Map<ChartKind, number>();
  for (const s of chart.sections)
    total.set(s.kind, (total.get(s.kind) ?? 0) + 1);
  const last = new Map<ChartKind, ReadonlySet<Layer>>();
  let start = 0;
  return chart.sections.map((section) => {
    const nth = seen.get(section.kind) ?? 0;
    seen.set(section.kind, nth + 1);
    const layers = new Set(section.play);
    // Development by default: a pass that plays what the last one did adds
    // the next layer on its kind's ladder.
    const before = last.get(section.kind);
    if (before && [...layers].every((l) => before.has(l)))
      for (const l of LADDER[section.kind])
        if (!layers.has(l)) {
          layers.add(l);
          break;
        }
    last.set(section.kind, layers);
    const placed: Placed = {
      ...section,
      start,
      nth,
      final: nth === total.get(section.kind)! - 1,
      halves: readChords(scale, section),
      layers,
      energy: Math.min(
        1,
        (section.energy ?? ENERGY[section.kind]) + (nth > 0 ? 0.05 : 0),
      ),
    };
    start += section.bars;
    return placed;
  });
}

export function performChart(chart: Chart, book?: VoxBank): Performed {
  const problems = checkChart(chart);
  if (problems.length) throw new Error(problems.join("\n"));
  const scale = chartScale(chart);
  const placed = place(chart, scale);
  const BARS = placed.reduce((n, p) => n + p.bars, 0);
  const rng = new Rng(
    [...chart.title].reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
      2166136261,
    ) >>> 0,
  );
  const singerKind = SINGERS[chart.sounds.singer] ?? SINGERS.sung!;
  const root = scale.root;
  const tonic = readChords(scale, {
    ...chart.sections[0]!,
    bars: 1,
    chords: scale.steps[2] === 3 ? "i" : "I",
  })[0]!;

  const sectionAt = (bar: number) =>
    placed.find((p) => bar >= p.start && bar < p.start + p.bars) ??
    placed.at(-1)!;
  const landings = new Set(
    placed
      .filter((p) => p.moves?.some((m) => m.move === "landing"))
      .map((p) => p.start + p.bars - 1),
  );
  /** The chord sounding at a beat (a landing bar turns to the tonic on three). */
  const chordAt = (bar: number, beat = 0): Chord => {
    const b = Math.max(0, Math.min(BARS - 1, bar));
    if (landings.has(b) && beat >= 2) return tonic;
    const p = sectionAt(b);
    return p.halves[(b - p.start) * 2 + (beat >= 2 ? 1 : 0)]!;
  };
  const tones = (c: Chord) => new Set([...c.triad, ...c.color]);
  const rubs = (c: Chord, pitch: number) => {
    const set = tones(c);
    return (
      !set.has(pc(pitch)) && (set.has(pc(pitch + 1)) || set.has(pc(pitch - 1)))
    );
  };
  const nearestTone = (c: Chord, pitch: number, triadOnly = false) => {
    const set = triadOnly ? new Set(c.triad) : tones(c);
    for (let d = 0; d < 12; d++) {
      if (set.has(pc(pitch - d))) return pitch - d;
      if (set.has(pc(pitch + d))) return pitch + d;
    }
    return pitch;
  };
  const inScale = new Set(scale.pcs);
  const stepFrom = (pitch: number, steps: number) => {
    let p = pitch;
    const dir = Math.sign(steps);
    for (let k = 0; k < Math.abs(steps); k++) {
      p += dir;
      while (!inScale.has(pc(p))) p += dir;
    }
    return p;
  };

  const s = new Composer(
    demoInfo({
      id: slug(chart.title),
      title: chart.title,
      style: "Hyperpop",
      description: `Hyperpop in ${scale.name} at ${chart.bpm}, written as a song chart.`,
      tempoBpm: chart.bpm,
      key: scale.label,
      bars: BARS,
      highlightBar: (placed.find((p) => p.kind === "chorus") ?? placed[0]!)
        .start,
      trackId: "vox",
      features: chart.notes ?? [],
      arrangement: placed.map((p) => `${p.name} ${p.bars}`),
      mixNotes: [],
    }),
  );
  for (const p of placed) s.section(p.name, p.start, p.bars);

  /** A note, dropped when it falls outside the song. */
  const put = (
    track: string,
    bar: number,
    beat: number,
    pitch: number,
    length: number,
    velocity: number,
    extra: Extra = {},
  ) => {
    const tick = tickOf(bar, beat);
    if (tick < 0 || tick >= BARS * BAR - 1 || length <= 0) return;
    s.note(track, bar, beat, pitch, length, Math.min(1, velocity), extra);
  };
  const hit = (
    track: string,
    bar: number,
    beat: number,
    pitch: number,
    velocity: number,
    length = 0.13,
  ) => put(track, bar, beat, pitch, length, velocity);
  const roll = (
    track: string,
    bar: number,
    beat: number,
    count: number,
    step: number,
    pitch: number,
    lo: number,
    hi: number,
    skip: readonly number[] = [],
  ) => {
    for (let i = 0; i < count; i++)
      if (!skip.includes(i))
        hit(
          track,
          bar,
          beat + i * step,
          pitch,
          lo + ((hi - lo) * i) / Math.max(1, count - 1),
          Math.min(0.13, step * 0.9),
        );
  };
  const lanes = new Map<string, Record<string, AutomationPoint[]>>();
  const lane = (track: string, key: string, points: AutomationPoint[]) => {
    const l = lanes.get(track) ?? {};
    l[key] = [...(l[key] ?? []), ...points];
    lanes.set(track, l);
  };

  // ── the lines, placed ──────────────────────────────────────────────────
  /**
   * A line's notes in song time. A note runs on to the next one when that
   * starts within half a beat (`x.x.` sings two 8ths, not two clipped 16ths):
   * a singer by `legato` of the gap, an instrument a little shorter.
   */
  const read = (
    p: Placed,
    list: ChartSection["sing"],
    legato: number,
  ): Note[] =>
    (list ?? []).flatMap((line) => {
      const notes = readLine(scale, line);
      return notes.map((n: LineNote, k) => {
        const next = notes[k + 1];
        const gap = next ? next.beat - n.beat : Infinity;
        const length = gap <= 0.5 && gap > n.length ? gap * legato : n.length;
        return {
          ...n,
          length,
          bar: p.start + Math.floor(n.beat / 4),
          beat: n.beat % 4,
          velocity: 0.7,
        };
      });
    });
  /** The harmony guard: a whole-beat note a semitone off the chord moves onto it. */
  const guard = (notes: Note[]) =>
    notes.forEach((n, k) => {
      if (n.keep || n.beat % 1 !== 0) return;
      const next = notes[k + 1];
      const leans =
        n.length <= 0.5 &&
        next !== undefined &&
        (next.bar - n.bar) * 4 + next.beat - n.beat <= 0.5 &&
        Math.abs(next.pitch - n.pitch) <= 2;
      const c = chordAt(n.bar, n.beat);
      if (!leans && rubs(c, n.pitch)) n.pitch = nearestTone(c, n.pitch);
    });
  const sungBy = new Map<Placed, Note[]>();
  const hookBy = new Map<Placed, Note[]>();
  const counterBy = new Map<Placed, Note[]>();
  const chopsBy = new Map<Placed, Note[]>();
  for (const p of placed) {
    const sung = read(p, p.sing, 0.95);
    guard(sung);
    if (sung.length) {
      const low = Math.min(...sung.map((n) => n.pitch));
      const span = Math.max(1, Math.max(...sung.map((n) => n.pitch)) - low);
      const gain = p.kind === "chorus" ? 1.04 : p.kind === "bridge" ? 0.86 : 1;
      for (const n of sung)
        n.velocity = Math.min(
          0.92,
          (0.66 +
            (0.1 * (n.pitch - low)) / span +
            (n.length >= 0.85 ? 0.1 : 0)) *
            gain,
        );
    }
    sungBy.set(p, sung);
    const hook = read(p, p.hook, 0.8);
    guard(hook);
    hookBy.set(p, hook);
    const counter = read(p, p.counter, 0.8);
    guard(counter);
    counterBy.set(p, counter);
    const chops = read(p, p.chops, 0.85);
    guard(chops);
    chopsBy.set(p, chops);
  }
  const allSung = placed
    .flatMap((p) => sungBy.get(p)!)
    .sort((a, b) => a.bar * 4 + a.beat - (b.bar * 4 + b.beat));
  /** Whether the singer sounds anywhere in [lo, hi) beats of a bar. */
  const singing = (bar: number, lo: number, hi: number) =>
    allSung.some((n) => {
      const start = (n.bar - bar) * 4 + n.beat;
      return start < hi && start + n.length > lo;
    });
  /** The song's syllables, for chops that sing its own words. */
  const hookWords =
    (placed.find((p) => p.kind === "chorus" && sungBy.get(p)!.length) ??
    placed.find((p) => sungBy.get(p)!.length))
      ? sungBy
          .get(
            placed.find((p) => p.kind === "chorus" && sungBy.get(p)!.length) ??
              placed.find((p) => sungBy.get(p)!.length)!,
          )!
          .map((n) => n.lyric?.replace(/-$/, "") ?? "")
          .filter((w) => w && w !== "_")
      : ["ah", "oh"];
  /** Each section's register: the singer's lowest and highest held notes. */
  const register = (p: Placed) => {
    const held = sungBy.get(p)!.filter((n) => n.length >= 0.5);
    const list = held.length ? held : sungBy.get(p)!;
    return list.length
      ? {
          low: Math.min(...list.map((n) => n.pitch)),
          high: Math.max(...list.map((n) => n.pitch)),
        }
      : { low: root + 7, high: root + 16 };
  };
  /** The same, as heard: a chipmunk singer sounds an octave over her notes. */
  const heard = (p: Placed) => {
    const r = register(p);
    return { low: r.low + singerKind.shift, high: r.high + singerKind.shift };
  };
  // One ceiling for the bed across the song, just under where the singer
  // usually sits, so the bed never jumps register at a section change.
  const lows = placed
    .filter((p) => sungBy.get(p)!.length)
    .map((p) => heard(p).low)
    .sort((a, b) => a - b);
  const bedTop = Math.max(
    62,
    Math.min(72, (lows[Math.floor(lows.length / 2)] ?? 70) - 1),
  );

  // ── the 808 and the drums ──────────────────────────────────────────────
  const grooves = new Map<string, Groove>();
  const grooveOf = (feel: Feel): Groove | undefined => {
    if (feel === "none" || feel === "taps") return undefined;
    const grammar = feel === "half" ? "trap" : feel;
    if (!grooves.has(feel))
      grooves.set(feel, groove(rng.fork(`groove-${feel}`), grammar, 0.3, 0));
    return grooves.get(feel)!;
  };
  let fillTurn = 0;
  const rootAt = (bar: number, beat = 0) => bassPitch(chordAt(bar, beat), 28);
  /** The scale step under the next root: the 808's approach note. */
  const approach = (bar: number) => {
    const next = rootAt(bar + 1);
    return inScale.has(pc(next - 1)) ? next - 1 : next - 2;
  };
  let walked = 0;

  for (const p of placed) {
    const fill = FILLS[fillTurn++ % FILLS.length]!;
    const bassOn = p.layers.has("sub");
    const habit = p.bass ?? (p.kind === "bridge" ? "walk" : "lock");
    const after = placed[placed.indexOf(p) + 1];
    const beforeChorus =
      p.kind === "pre" && after && ["chorus", "drop"].includes(after.kind);
    const arrives =
      ["chorus", "drop"].includes(p.kind) &&
      placed[placed.indexOf(p) - 1]?.kind === "pre";
    for (let i = 0; i < p.bars; i++) {
      const b = p.start + i;
      const feel = p.drums2 && i >= p.bars / 2 ? p.drums2 : p.drums;
      const g = grooveOf(feel);
      const e = p.energy;
      const phrase = i % 4;
      const lastBar = i === p.bars - 1;
      const fillHere = lastBar && fill !== "drop" && feel !== "none";
      const cut = (grid: string) =>
        fillHere ? grid.slice(0, 12) + "...." : grid;
      const turn = phrase === 3;
      // Kick.
      let kick = "";
      if (p.kick) kick = p.kick[i % p.kick.length]!;
      else if (g && feel !== "taps" && e >= 0.35) {
        kick = turn ? g.kick[1]! : g.kick[0]!;
        if (feel === "half")
          kick = turn ? "9.....8...9....." : "9.......9.8.....";
        if (lastBar && fill === "drop") kick = kick.slice(0, 8) + "........";
        else kick = cut(kick);
      }
      if (landings.has(b)) kick = "9...8...9...8...";
      // A busy grid (footwork, gabber) keeps its weight on the beat: the
      // kicks between beats are ghosts, and every hit a little softer.
      const hits = [...kick].filter((c) => c !== ".").length;
      if (hits > 4)
        kick = [...kick].map((c, k) => (c !== "." && k % 4 ? "5" : c)).join("");
      if (kick)
        s.grid(
          "kick",
          b,
          36,
          kick,
          (0.75 + 0.25 * e) * Math.min(1, Math.sqrt(4 / Math.max(1, hits))),
        );
      // Snare.
      if (p.snare) s.grid("snare", b, 38, p.snare[i % p.snare.length]!);
      else if (g && feel !== "taps" && e >= 0.45) {
        let sn = turn && g.snare[1] ? g.snare[1] : g.snare[0]!;
        if (feel === "half")
          sn = turn ? "........9.....5." : "........9.......";
        const pitches =
          g.hit === "snare" ? [38] : g.hit === "clap" ? [39] : [38, 39];
        // Busy backbeats (dembow) and layered snare-and-clap play softer.
        const busy = Math.min(
          1,
          Math.sqrt(3 / Math.max(1, [...sn].filter((c) => c !== ".").length)),
        );
        for (const pitch of pitches)
          s.grid(
            "snare",
            b,
            pitch,
            cut(sn),
            (g.hit === "both" ? (pitch === 39 ? 0.55 : 0.85) : 1) *
              busy *
              (0.7 + 0.3 * e),
          );
      }
      // Hats, ornamented at phrase turns the way Candy Fault's are.
      if (p.hats) s.grid("hats", b, 42, p.hats[i % p.hats.length]!);
      else if (feel !== "none" && e >= 0.2) {
        const grid = g
          ? e > 0.75 && g.hats[1]
            ? g.hats[1]
            : g.hats[0]!
          : phrase % 2
            ? "4.3.4.3.4.3...3."
            : "4.3.4.3.4.3.4.3.";
        const ticks = [...grid].filter((c) => c !== ".").length;
        s.grid(
          "hats",
          b,
          42,
          cut(grid),
          (0.6 + 0.4 * e) * Math.min(1, Math.sqrt(8 / Math.max(1, ticks))),
        );
        if (g && e > 0.8 && g.open[0])
          s.grid("hats", b, 46, cut(g.open[0]), 0.8);
        if (g && e >= 0.55 && g.perc[0])
          s.grid("perc", b, 37, cut(g.perc[0]), 0.8);
        if (!lastBar && phrase === 1)
          (p.nth + i) % 2
            ? roll("hats", b, 3.25, 6, 0.125, 42, 0.38, 0.78, [3])
            : roll("hats", b, 3, 6, 1 / 6, 42, 0.35, 0.75);
        if (!lastBar && turn && e >= 0.6) {
          roll("hats", b, 2.75, 10, 0.125, 42, 0.4, 0.82, [4, 9]);
          hit("hats", b, 3.5, 46, 0.55, 0.45);
        }
      }
      // The section's fill on its last beat.
      if (fillHere && e >= 0.35) {
        const gain = 0.6 + 0.4 * e;
        if (fill === "roll")
          for (let k = 0; k < 8; k++)
            hit("snare", b, 3 + k / 8, 38, gain * (0.4 + 0.07 * k));
        else if (fill === "toms")
          [3, 3.25, 3.5, 3.75].forEach((beat, k) =>
            put("perc", b, beat, 45, 0.2, gain * (0.85 - 0.08 * k), {
              bend: [
                { at: 0, cents: 300 - 150 * k },
                { at: 1, cents: 0 },
              ] as NoteInput["bend"],
            }),
          );
        else if (fill === "ratchet")
          for (let k = 0; k < 12; k++)
            hit("hats", b, 3 + k / 12, 42, gain * (0.35 + 0.05 * k), 0.06);
        else if (fill === "flam") {
          hit("snare", b, 3, 38, gain * 0.6, 0.15);
          hit("snare", b, 3.5, 38, gain * 0.8, 0.15);
          hit("snare", b, 3.53, 39, gain * 0.8, 0.15);
          hit("snare", b, 3.75, 38, gain, 0.15);
        }
      }
      // A crash on every arrival.
      if (i === 0 && ["chorus", "drop"].includes(p.kind))
        hit("hats", b, 0, 49, 0.8, 2);

      // The 808.
      if (!bassOn) continue;
      const rootNow = rootAt(b);
      const next = b + 1 < BARS ? rootAt(b + 1) : rootNow;
      const prev = b > 0 ? rootAt(b - 1) : rootNow;
      const level = 0.55 + 0.35 * e;
      const lets = beforeChorus && lastBar;
      const entry: Extra =
        arrives && i === 0
          ? {
              bend: [
                { at: 0, cents: 1200 },
                { at: 0.3, cents: 0 },
              ] as NoteInput["bend"],
            }
          : prev !== rootNow
            ? { glide: 0.07 }
            : {};
      const split = chordAt(b, 2) !== chordAt(b, 0);
      if (landings.has(b)) {
        put("bass", b, 0, rootNow, 1.94, 0.85);
        put("bass", b, 1, rootNow, 0.94, 0.76);
        put("bass", b, 2, bassPitch(tonic, 28), 1.98, 0.88, { glide: 0.07 });
        continue;
      }
      if (habit === "walk" || habit === "hold" || !kick) {
        let pitch = rootNow;
        if (habit === "walk") {
          const options = [rootNow, rootNow + 12].filter((q) => q <= 42);
          if (walked)
            pitch = options.reduce((a, q) =>
              Math.abs(q - walked) < Math.abs(a - walked) ? q : a,
            );
          walked = pitch;
        }
        if (split) {
          put("bass", b, 0, pitch, 1.94, level * 0.8, entry);
          put("bass", b, 2, rootAt(b, 2), lets ? 0.9 : 1.94, level * 0.8, {
            glide: 0.07,
          });
        } else put("bass", b, 0, pitch, lets ? 2 : 3.9, level * 0.8, entry);
        continue;
      }
      if (habit === "offbeat" || habit === "rolling") {
        const grid =
          habit === "offbeat" ? "..9...8...9...8." : "9.69.69.9.69.69.";
        [...grid].forEach((c, k) => {
          if (c === "." || (lets && k >= 8)) return;
          const beat = k / 4;
          const r = rootAt(b, beat);
          const pop = habit === "rolling" && k % 8 === 6 ? 12 : 0;
          put(
            "bass",
            b,
            beat,
            r + pop,
            habit === "offbeat" ? 0.4 : 0.2,
            (Number(c) / 10) * level,
          );
        });
        continue;
      }
      // Locked to the kick: each hit holds to the next; the last hit of a
      // phrase's turn pops an octave, the bar before approaches by step.
      const onsets = [...kick].flatMap((c, k) => (c === "." ? [] : [k]));
      const holdIt = p.kind === "verse" && phrase === 0 && !split;
      if (holdIt) {
        put(
          "bass",
          b,
          onsets[0]! * 0.25,
          rootNow,
          4 - onsets[0]! * 0.25 - 0.04,
          level,
          entry,
        );
        continue;
      }
      onsets.forEach((step, k) => {
        if (lets && step >= 8) return;
        const end = k + 1 < onsets.length ? onsets[k + 1]! : 16;
        const lastHit = k === onsets.length - 1;
        const beat = step * 0.25;
        const r = rootAt(b, beat);
        const leaves = lastHit && step >= 10 && next !== r;
        const pitch = !leaves
          ? r
          : phrase === 3
            ? r + 12
            : phrase === 2
              ? approach(b)
              : r;
        put(
          "bass",
          b,
          beat,
          pitch,
          (end - step) * 0.25 - (lastHit && next !== r ? -0.02 : 0.06),
          Math.min(0.9, (Number(kick[step]) / 10) * 0.95 * level),
          k === 0
            ? entry
            : leaves
              ? { glide: 0.05 }
              : r !== rootAt(b, (onsets[k - 1] ?? 0) * 0.25)
                ? { glide: 0.06 }
                : {},
        );
      });
    }
  }

  // A characterful bass plays an octave up with a clean sine under it; the
  // sine holds through repeated roots in a bar rather than retriggering.
  if (!["sub808", "boom"].includes(chart.sounds.bass)) {
    const subs: NoteInput[] = [];
    s.notes.forEach((n, k) => {
      if (n.trackId !== "bass") return;
      s.notes[k] = { ...n, pitch: n.pitch + 12 };
      const pitch = 28 + ((((n.pitch - 28) % 12) + 12) % 12);
      const start = n.startTick ?? 0;
      const last = subs.at(-1);
      const lastEnd = (last?.startTick ?? 0) + (last?.durationTicks ?? 0);
      if (
        last?.pitch === pitch &&
        Math.floor(start / BAR) === Math.floor((last.startTick ?? 0) / BAR) &&
        start - lastEnd < TPB / 2
      ) {
        subs[subs.length - 1] = {
          ...last,
          durationTicks: start + (n.durationTicks ?? 0) - (last.startTick ?? 0),
        };
        return;
      }
      subs.push({
        ...n,
        id: `${n.id}-sub`,
        trackId: "sub",
        pitch,
        velocity: (n.velocity ?? 0.8) * 0.9,
        glide: undefined,
      });
    });
    s.notes.push(...subs);
  }

  // ── the bed: voiced by common tones, under the singer ─────────────────
  let padPrev: number[] | undefined;
  let keysPrev: number[] | undefined;
  for (const p of placed) {
    const reg = heard(p);
    const top = bedTop;
    const gain = 0.38 + 0.14 * p.energy;
    for (let i = 0; i < p.bars; i++) {
      const b = p.start + i;
      for (const half of [0, 1]) {
        const c = chordAt(b, half * 2);
        if (half === 1 && c === chordAt(b, 0)) continue;
        const long = half === 0 && chordAt(b, 2) === c;
        const v = voiceLead(c, top - 22, top, padPrev);
        padPrev = v;
        if (p.layers.has("pad")) {
          const length = long ? 3.95 : 1.95;
          const third = v.find((q) => pc(q) === c.triad[1]);
          const major = pc(c.triad[1]! - c.triad[0]!) === 4;
          // The pre-chorus leans: a 4th over a major chord's downbeat
          // resolving to its 3rd, a 9th over a minor chord's root.
          if (p.kind === "pre" && half === 0 && third !== undefined) {
            if (major) {
              const fourth = stepFrom(third, 1);
              for (const q of v)
                if (q !== third) put("pad", b, 0, q, length, gain);
              put("pad", b, 0, fourth, 0.95, gain);
              put("pad", b, 1, third, length - 1, gain);
            } else {
              const rootTone = [...v]
                .reverse()
                .find((q) => pc(q) === c.triad[0]);
              for (const q of v)
                if (q !== rootTone) put("pad", b, 0, q, length, gain);
              if (rootTone !== undefined) {
                put("pad", b, 0, stepFrom(rootTone, 1), 0.95, gain);
                put("pad", b, 1, rootTone, length - 1, gain);
              }
            }
          } else for (const q of v) put("pad", b, half * 2, q, length, gain);
        }
        if (p.layers.has("keys") && half === 0) {
          const k = voiceLead(c, 50, Math.min(67, top), keysPrev);
          keysPrev = k;
          const roll = (
            beat: number,
            notes: readonly number[],
            length: number,
            vel: number,
          ) =>
            notes.forEach((q, j) =>
              put(
                "keys",
                b,
                beat + j * 0.03,
                q,
                length - j * 0.03,
                vel * (j === notes.length - 1 ? 1.06 : 0.9),
              ),
            );
          roll(0, k, long ? 2.9 : 1.9, 0.46);
          if (long) roll(3, k.slice(1), 0.9, 0.34);
          else {
            keysPrev = voiceLead(chordAt(b, 2), 50, Math.min(67, top), k);
            roll(2, keysPrev, 1.9, 0.42);
          }
        }
      }
      // Stabs above the singer, denser on each pass.
      if (p.layers.has("stabs")) {
        const grids =
          p.stabs ??
          STAB_PASSES[Math.min(2, p.nth + (p.final && p.nth > 0 ? 1 : 0))]!;
        const grid = grids[i % grids.length]!;
        [...grid].forEach((ch, k) => {
          if (ch === "." || ch === "-") return;
          const c = chordAt(b, k / 4);
          const low = Math.max(72, Math.min(79, reg.high + 3));
          const pair = ladder(c.triad, low, low + 14).slice(0, 2);
          for (const q of pair)
            put(
              "stabs",
              b,
              k / 4,
              q,
              0.22,
              (Number(ch) / 10) * (0.7 + 0.2 * p.energy),
            );
        });
      }
      // Two arpeggios on interlocking 16ths: one on the beat, one between.
      for (const id of ["arp", "arp2"] as const) {
        if (!p.layers.has(id)) continue;
        const orders = p.arp ?? [
          ARP_ORDERS[(i + (id === "arp2" ? 1 : 0)) % 4]!,
        ];
        const order = orders[i % orders.length]!;
        for (let k = 0; k < 8; k++) {
          const beat = k * 0.5 + (id === "arp2" ? 0.25 : 0);
          const c = chordAt(b, beat);
          const set = ladder(
            [...c.triad, ...c.color],
            id === "arp" ? root + 15 : root + 19,
            root + 40,
          ).slice(0, 5);
          const q = set[Number(order[k])] ?? set[0]!;
          put(
            id,
            b,
            beat,
            q,
            0.2,
            (k % 2 === 0 ? 0.78 : 0.56) * (id === "arp" ? 0.8 : 0.7),
          );
        }
      }
      if (p.layers.has("cloud")) {
        const v = voicing(chordAt(b), root - 2, root + 14, 3);
        for (const q of v) put("cloud", b, 0, q, 3.9, 0.5);
      }
      if (p.layers.has("spark") && i % 2 === 0) {
        const c = chordAt(b);
        put("spark", b, 0, ladder(c.triad, root + 24, root + 36)[0]!, 1, 0.5);
      }
    }
  }

  // ── the singer and the vocal stack ─────────────────────────────────────
  const shift = singerKind.shift;
  const scoop = (cents = -80, at = 0.1): Extra => ({
    bend: [
      { at: 0, cents },
      { at, cents: 0 },
    ] as NoteInput["bend"],
  });
  const fallOff: Extra = {
    bend: [
      { at: 0, cents: 0 },
      { at: 0.7, cents: 0 },
      { at: 1, cents: -250 },
    ] as NoteInput["bend"],
  };
  const sing = (track: string, n: Note, transpose: number, gain: number) =>
    put(
      track,
      n.bar,
      n.beat,
      n.pitch + transpose,
      n.length,
      n.velocity * gain,
      {
        ...(n.lyric ? { lyric: n.lyric } : {}),
        ...(n.fall
          ? fallOff
          : n.length >= 0.85 && n.lyric !== "_"
            ? scoop()
            : {}),
        ...(n.vibrato || (n.length >= 1.4 && n.pitch >= root + 11)
          ? { vibrato: { rate: 5.8, depth: 32, delay: 0.28 } }
          : {}),
      },
    );
  /** A chord tone a third (or a fourth, or a sixth) under a held note. */
  const below = (n: Note) => {
    const c =
      n.beat >= 3 && n.beat + n.length > 4.5
        ? chordAt(n.bar + 1, 0)
        : chordAt(n.bar, n.beat);
    for (const gap of [3, 4, 5, 8, 9]) {
      const q = n.pitch - gap;
      if (!inScale.has(pc(q)) || !c.triad.includes(pc(q))) continue;
      if (rubs(c, q) || rubs(chordAt(n.bar, n.beat), q)) continue;
      return q;
    }
    return undefined;
  };
  const under = (c: Chord, pitch: number, count: number) => {
    const out: number[] = [];
    for (let q = pitch - 1; out.length < count && q > pitch - 24; q--)
      if (c.triad.includes(pc(q))) out.push(q);
    return out;
  };
  for (const p of placed) {
    const sung = sungBy.get(p)!;
    const gain = p.kind === "chorus" && p.final && p.nth > 0 ? 1.08 : 1;
    for (const n of sung) sing("vox", n, shift, gain);
    if (p.layers.has("harmony"))
      for (const n of sung) {
        // Held words get a chord tone under them; in a chorus or pre the
        // shorter words move in thirds under the line, so the stack holds.
        const stacked = p.kind === "chorus" || p.kind === "pre";
        if (n.length < (stacked ? 0.45 : 0.8) || !n.lyric || n.lyric === "_")
          continue;
        const third = stepFrom(n.pitch, -2);
        const h =
          stacked && n.length < 0.8 && !rubs(chordAt(n.bar, n.beat), third)
            ? third
            : below(n);
        if (h !== undefined)
          put(
            "harm",
            n.bar,
            n.beat,
            h + shift,
            n.length,
            n.velocity * (p.kind === "bridge" ? 0.9 : 0.66),
            { lyric: n.lyric },
          );
      }
    if (p.layers.has("double"))
      for (const n of sung)
        if (n.pitch <= root + 19)
          put(
            "high",
            n.bar,
            n.beat,
            n.pitch + 12 + shift,
            n.length,
            n.velocity * 0.9,
            n.lyric ? { lyric: n.lyric } : {},
          );
    if (p.layers.has("vocoder")) {
      for (const n of sung) put("voc", n.bar, n.beat, n.pitch, n.length, 0.62);
      for (let i = 0; i < p.bars; i++) {
        const bar = p.start + i;
        const inBar = sung.filter((n) => n.bar === bar);
        if (!inBar.length) continue;
        const low = Math.min(...inBar.map((n) => n.pitch));
        const from = inBar[0]!.beat;
        const to = Math.min(
          4,
          Math.max(...inBar.map((n) => n.beat + n.length)),
        );
        for (const q of under(chordAt(bar, from), low, 2))
          put("voc", bar, from, q, to - from, 0.55);
      }
    }
  }

  // ── the book: each sung line as the vocal book sings it ───────────────
  const phrases = new Map<string, Phrase>();
  const takes: { p: Placed; key: string; bar: number }[] = [];
  for (const p of placed) {
    const sung = sungBy.get(p)!;
    let k = 0;
    for (const line of p.sing ?? []) {
      const count = readLine(scale, line).length;
      const mine = sung.slice(k, k + count);
      k += count;
      if (!mine.length) continue;
      const bar = p.start + line.bar;
      const notes: [number, number, number, string][] = [];
      for (const n of mine) {
        const at = (n.bar - bar) * 4 + n.beat;
        const prev = notes.at(-1);
        if (prev && (!n.lyric || n.lyric === "_"))
          prev[2] = Math.round((at + n.length - prev[0]) * 1000) / 1000;
        else if (n.lyric && n.lyric !== "_")
          notes.push([
            at,
            n.pitch,
            Math.round(n.length * 1000) / 1000,
            n.lyric,
          ]);
      }
      if (!notes.length) continue;
      const last = notes.at(-1)!;
      const beats = 4 * Math.max(1, Math.ceil((last[0] + last[2]) / 4 - 1e-9));
      const key = `l_${hash(JSON.stringify(notes))}`;
      if (!phrases.has(key))
        phrases.set(key, { key, kind: p.kind, beats, notes });
      takes.push({ p, key, bar });
    }
  }
  const bookTracks: TrackInput[] = [];
  if (book) {
    const has = (key: string) => book.lines?.[key] !== undefined;
    const lead = vocalTrack(book, BOOK_LEVELS.bvox!, {
      id: "bvox",
      name: "Lead vocal",
    });
    const dbl = doubleTrack(book, BOOK_LEVELS.bdbl!, { id: "bdbl" });
    bookTracks.push(
      lead,
      dbl,
      chopTrack(book, BOOK_LEVELS.bchops!, { id: "bchops" }),
      voiceLeadTrack(book, BOOK_LEVELS.vlead!),
      grainTrack(book, BOOK_LEVELS.vgrain!),
    );
    for (const { p, key, bar } of takes) {
      if (!has(key)) continue;
      const { beats } = phrases.get(key)!;
      const big = p.kind === "chorus" || p.kind === "drop";
      const velocity = big ? (p.final && p.nth > 0 ? 0.95 : 0.9) : 0.82;
      const from = Math.max(0, bar * 4 - LINE_LEAD);
      const play = (track: TrackInput, gain: number) =>
        s.note(
          track.id,
          Math.floor(from / 4),
          from % 4,
          slot(track, key),
          beats + LINE_LEAD - (bar * 4 - LINE_LEAD < 0 ? LINE_LEAD : 0),
          velocity * gain,
        );
      play(lead, 1);
      if (big || p.layers.has("double")) play(dbl, 1);
    }
  }

  // ── the hook, the answers, the counter-line and the chops ─────────────
  const hookNote = (
    track: string,
    notes: readonly Note[],
    gain: number,
    transpose = 0,
  ) =>
    notes.forEach((n, i) => {
      const last =
        i === notes.length - 1 ||
        (notes[i + 1]!.bar - n.bar) * 4 + notes[i + 1]!.beat - n.beat >
          n.length + 0.5;
      put(
        track,
        n.bar,
        n.beat,
        n.pitch + transpose,
        n.length,
        n.velocity * gain,
        {
          ...(i > 0 && !last ? { glide: 0.035 } : {}),
          ...(last ? scoop(-140, 0.18) : {}),
          ...(last && n.length >= 0.7
            ? { vibrato: { rate: 6.2, depth: 24, delay: 0.12 } }
            : {}),
          ...(n.fall ? fallOff : {}),
        },
      );
    });
  for (const p of placed) {
    const reg = register(p);
    const hook = hookBy.get(p)!;
    if (p.layers.has("lead") && hook.length)
      hookNote("lead", hook, p.kind === "drop" ? 0.95 : 0.85);
    else if (p.layers.has("lead") && sungBy.get(p)!.length) {
      // The lead answers: a climbing run in the singer's rests that lands
      // on a chord tone, at the end of every other bar.
      for (let i = 1; i < p.bars; i += 2) {
        const b = p.start + i;
        if (singing(b, 2, 4)) continue;
        const c = chordAt(b, 2);
        let q = nearestTone(c, Math.min(84, heard(p).high - 2), true);
        const run = [q];
        for (let k = 0; k < 3; k++) run.push((q = stepFrom(q, 1)));
        run.push(ladder(c.triad, q + 1, q + 12)[0]!);
        const beats =
          i % 4 === 1 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 0.75, 1, 1.25];
        run.forEach((pitch, k) =>
          put(
            "lead",
            b,
            2 + beats[k]!,
            pitch,
            k === 4 ? 0.8 : 0.22,
            k === 4 ? 0.8 : k % 2 ? 0.6 : 0.7,
            k === 4 ? scoop(-140, 0.18) : {},
          ),
        );
      }
    }
    const counter = counterBy.get(p)!;
    if (p.layers.has("counter") && counter.length)
      hookNote("counter", counter, 0.8);
    else if (p.layers.has("counter")) {
      // An answer in the singer's rests: chord tones falling from above her.
      for (let i = 0; i < p.bars; i++) {
        const b = p.start + i;
        if (singing(b, 2.4, 4) && sungBy.get(p)!.length) continue;
        const c = chordAt(b, 2.5);
        const topTone = nearestTone(c, Math.min(88, heard(p).high + 5), true);
        const down = [topTone];
        for (let k = 0; k < 2; k++) {
          let q = down.at(-1)! - 1;
          while (!c.triad.includes(pc(q))) q--;
          down.push(q);
        }
        if (i % 4 === 3) down.reverse();
        down.forEach((pitch, k) =>
          put(
            "counter",
            b,
            2.5 + k * 0.5,
            pitch,
            k === 2 ? 0.6 : 0.22,
            k === 1 ? 0.54 : 0.6,
          ),
        );
      }
    }
    const chops = chopsBy.get(p)!;
    if (p.layers.has("chops")) {
      let w = 0;
      const notes: Note[] = chops.length
        ? chops
        : Array.from({ length: p.bars }, (_, i) => {
            // Four cells over a phrase, turned a step on each pass, so the
            // riff answers itself instead of looping one bar.
            const cell =
              CHOP_CELLS[(i + (i >> 2) + 2 * p.nth) % CHOP_CELLS.length]!;
            return cell.beats.map((beat, k) => {
              const c = chordAt(p.start + i, beat);
              const set = ladder(c.triad, reg.high - 5, reg.high + 9);
              return {
                bar: p.start + i,
                beat,
                pitch: set[cell.steps[k]! % set.length]!,
                length: k === cell.beats.length - 1 ? 0.7 : 0.4,
                velocity: 0.62,
                vibrato: false,
                fall: false,
                keep: false,
              };
            });
          }).flat();
      for (const n of notes)
        put(
          "chop",
          n.bar,
          n.beat,
          n.pitch + shift,
          Math.min(n.length, 0.9),
          n.velocity * 0.85,
          {
            lyric:
              n.lyric && n.lyric !== "_"
                ? n.lyric
                : hookWords[w++ % hookWords.length]!,
          },
        );
      if (book)
        for (const n of notes)
          put(
            "bchops",
            n.bar,
            n.beat,
            near(n.pitch, book.root + 7),
            Math.min(n.length, 0.9),
            n.velocity * 0.9,
          );
    }
    if (book && (p.kind === "chorus" || p.kind === "drop")) {
      // The held vowel doubles the hook, and its grains sit on each chord.
      for (const n of hookBy.get(p)!)
        put(
          "vlead",
          n.bar,
          n.beat,
          near(n.pitch, book.root + 5),
          n.length,
          n.velocity * 0.8,
        );
      for (let i = 0; i < p.bars; i++)
        put(
          "vgrain",
          p.start + i,
          0,
          near(chordAt(p.start + i).bass, book.root),
          4,
          0.5,
        );
    }
  }

  // ── moves ──────────────────────────────────────────────────────────────
  /** Silence everything but the listed tracks across [from, to) ticks. */
  const gap = (from: number, to: number, keep: ReadonlySet<string>) => {
    for (let k = s.notes.length - 1; k >= 0; k--) {
      const n = s.notes[k]!;
      if (keep.has(n.trackId)) continue;
      if (on(n) >= from && on(n) < to) s.notes.splice(k, 1);
      else if (on(n) < from && on(n) + dur(n) > from)
        s.notes[k] = { ...n, durationTicks: from - on(n) };
    }
  };
  const vocalIds = new Set([
    "vox",
    "harm",
    "high",
    "voc",
    "fx",
    "bvox",
    "bdbl",
    "bchops",
    "vlead",
  ]);
  for (const p of placed) {
    const end = p.start + p.bars;
    for (const m of p.moves ?? []) {
      if (m.move === "stutter") {
        const pitches = m.notes
          .trim()
          .split(/\s+/)
          .map((t) => degreeOfScale(scale, t));
        for (let k = 0; k < m.count; k++)
          put(
            "vox",
            p.start + m.bar,
            m.beat + k * m.step,
            pitches[k % pitches.length]! + shift,
            m.step * 0.8,
            0.55 + (0.3 * k) / Math.max(1, m.count - 1),
            { lyric: m.word },
          );
      } else if (m.move === "dropout") {
        const from = tickOf(p.start + m.bar, m.beat);
        gap(
          from,
          from + Math.round(m.beats * TPB),
          new Set([...vocalIds, "chop", ...(m.keep ?? [])]),
        );
      } else if (m.move === "silence") {
        const from = tickOf(p.start - 1, 3);
        gap(from, tickOf(p.start), new Set(["vox", "fx"]));
        hit("fx", p.start, 0, 60, 0.7, 0.5);
        hit("hats", p.start, 0, 49, 0.9, 2);
      } else if (m.move === "landing") {
        const b = end - 1;
        roll("snare", b, 0.5, 12, 0.125, 38, 0.35, 0.95);
        hit("snare", b, 2, 39, 0.8);
        hit("hats", b, 2, 49, 0.9, 2);
        const mine = sungBy.get(p)!.filter((n) => n.bar === b);
        const held = mine.filter((n) => n.beat < 2).at(-1);
        if (held && !mine.some((n) => n.beat >= 2)) {
          let to = held.pitch;
          while (!tonic.triad.includes(pc(to)) && to > held.pitch - 5) to--;
          if (tonic.triad.includes(pc(to)))
            put("vox", b, 2.5, to + shift, 1.5, held.velocity, { lyric: "_" });
        }
      } else if (m.move === "tapeStop") {
        const from = tickOf(end) - Math.round((m.beats ?? 2) * TPB);
        const to = tickOf(end);
        for (let k = s.notes.length - 1; k >= 0; k--) {
          const n = s.notes[k]!;
          const stop = on(n) + dur(n);
          if (stop <= from || on(n) >= to) continue;
          if (DRUMS.has(n.trackId)) {
            if (on(n) >= from) s.notes.splice(k, 1);
            continue;
          }
          if (n.trackId === "fx") continue;
          const at = Math.max(
            0,
            (from - on(n)) / Math.max(1, Math.min(stop, to) - on(n)),
          );
          s.notes[k] = {
            ...n,
            durationTicks: Math.min(stop, to) - on(n),
            bend: [
              { at, cents: 0 },
              { at: 1, cents: -1200 },
            ] as NoteInput["bend"],
          };
        }
      } else if (m.move === "riser") {
        put("fx", p.start, 0, 48, p.bars * 4, 0.6);
        buildRoll(s, end - 1, 0.25, 0.8);
      } else if (m.move === "drift") {
        const id = trackFor(m.layer);
        lane(id, "crush-mix", ramp(p.start, end, 0, 0.55));
        lane(id, "crush-bits", ramp(p.start, end, 16, 6));
      } else if (m.move === "crush") {
        for (const id of ["pad", "stabs", "keys"]) {
          lane(id, "crush-mix", ramp(end - 1, end, 0, 0.85));
          lane(id, "crush-bits", ramp(end - 1, end, 16, 3));
        }
      } else if (m.move === "formant") {
        const base = singerKind.formant;
        lane("vox", "sing-formant", [
          { tick: tickOf(end - 1, 3.5), value: base },
          { tick: tickOf(end - 1, 3.95), value: base + 4.5 },
          { tick: tickOf(end), value: base },
        ]);
      } else if (m.move === "dive") {
        const tick = tickOf(p.start + m.bar, m.beat);
        const found = s.notes
          .map((n, k) => ({ n, k }))
          .filter(
            ({ n }) =>
              n.trackId === m.track && on(n) <= tick && on(n) + dur(n) > tick,
          )
          .at(-1);
        if (found)
          s.notes[found.k] = {
            ...found.n,
            bend: [
              { at: 0, cents: 0 },
              {
                at: (tick - on(found.n)) / Math.max(1, dur(found.n)),
                cents: 0,
              },
              { at: 1, cents: -1200 },
            ] as NoteInput["bend"],
          };
      }
    }
  }

  // ── tracks ─────────────────────────────────────────────────────────────
  const used = new Set(s.notes.map((n) => n.trackId));
  for (const t of tracksFor(chart, used, lanes, s.notes, !!book?.entry))
    // Under a book the synth singer and its chops blend in behind the takes.
    s.track(book && SUNG_UNDER[t.id] ? withGain(t, SUNG_UNDER[t.id]!) : t);
  for (const t of bookTracks) {
    if (!used.has(t.id)) continue;
    const thrown =
      t.id === "bvox" ? throwLane(s.notes, t.delay?.mix ?? 0.05) : undefined;
    s.track(thrown ? { ...t, delayMixAutomation: thrown } : t);
  }
  // The score holds 4096 notes: past the budget the quietest half of the
  // second arp goes first, then closed-hat ghosts, then the first arp. A
  // sung book's doubles go before any of them: the synth chops it covers,
  // half the vocal-synth double, then the synth line under the sung lead.
  const written = new Map<string, number>();
  for (const n of s.notes)
    written.set(n.trackId, (written.get(n.trackId) ?? 0) + 1);
  for (const [id, share] of [
    ...(book
      ? ([
          ["chop", 1],
          ["vlead", 0.5],
          ["vox", 1],
        ] as const)
      : []),
    ["arp2", 0.5],
    ["hats", 0.4],
    ["arp", 0.4],
    ["arp2", 1],
    ["hats", 1],
  ] as const) {
    const over = s.notes.length - BUDGET;
    if (over <= 0) break;
    const mine = s.notes.filter((n) => n.trackId === id && n.pitch !== 49);
    const quiet = new Set(
      mine
        .sort((a, b) => (a.velocity ?? 1) - (b.velocity ?? 1))
        .slice(0, Math.min(over, Math.floor(mine.length * share))),
    );
    for (let k = s.notes.length - 1; k >= 0; k--)
      if (quiet.has(s.notes[k]!)) s.notes.splice(k, 1);
  }
  const thinned: Record<string, number> = {};
  const kept = new Map<string, number>();
  for (const n of s.notes) kept.set(n.trackId, (kept.get(n.trackId) ?? 0) + 1);
  for (const [id, count] of written)
    if ((kept.get(id) ?? 0) < count)
      thinned[id] = 1 - (kept.get(id) ?? 0) / count;
  const score = s.finish();
  return {
    title: chart.title,
    score,
    placed,
    thinned,
    phrases: [...phrases.values()],
    notes: [
      `${scale.name} at ${chart.bpm}`,
      `form: ${placed.map((p) => `${p.name} ${p.bars}`).join(", ")}`,
      ...placed
        .filter((p) => p.layers.size > p.play.length)
        .map(
          (p) =>
            `${p.name} adds ${[...p.layers].filter((l) => !p.play.includes(l)).join(", ")}`,
        ),
      ...(chart.notes ?? []),
    ],
  };
}

/**
 * Four voices for `chord` in [low, high] that move least from `prev`: every
 * set holding the root and the third (the fifth or a color for the rest),
 * upper voices no more than a sixth apart, ties going to the set nearer
 * the ceiling. With nothing to lead from, the closest set under the ceiling.
 */
export function voiceLead(
  chord: Chord,
  low: number,
  high: number,
  prev?: readonly number[],
): number[] {
  const pool = ladder([...chord.triad, ...chord.color], low, high);
  let best: number[] | undefined;
  let bestCost = Infinity;
  const n = pool.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const v = [pool[a]!, pool[b]!, pool[c]!, pool[d]!];
          const pcs = new Set(v.map(pc));
          if (!pcs.has(chord.triad[0]!) || !pcs.has(chord.triad[1]!)) continue;
          if (pcs.size < 3) continue;
          if (v[2]! - v[1]! > 9 || v[3]! - v[2]! > 9) continue;
          const lead =
            prev && prev.length === 4
              ? v.reduce((sum, q, k) => sum + Math.abs(q - prev[k]!), 0)
              : 0;
          const cost = lead + 0.15 * (high - v[3]!) + 0.05 * (v[3]! - v[0]!);
          if (cost < bestCost) {
            bestCost = cost;
            best = v;
          }
        }
  return best ?? voicing(chord, low, high, 4, prev);
}

const degreeOfScale = (scale: Scale, token: string) => {
  const m = /^([1-7])([',]*)/.exec(token);
  if (!m) throw new Error(`chart note ${token} is not a degree`);
  const octave =
    [...m[2]!].filter((c) => c === "'").length -
    [...m[2]!].filter((c) => c === ",").length;
  return scale.root + scale.steps[Number(m[1]) - 1]! + 12 * octave;
};

const ramp = (
  from: number,
  to: number,
  a: number,
  b: number,
): AutomationPoint[] => [
  // A ramp from the first downbeat has nothing before it to hold.
  ...(from > 0 ? [{ tick: tickOf(from) - 1, value: a }] : []),
  { tick: tickOf(from), value: a },
  { tick: tickOf(to) - 1, value: b },
  { tick: tickOf(to), value: a },
];

const trackFor = (layer: Layer) =>
  layer === "double"
    ? "high"
    : layer === "harmony"
      ? "harm"
      : layer === "vocoder"
        ? "voc"
        : layer === "chops"
          ? "chop"
          : layer === "sub"
            ? "bass"
            : layer;

// ---------------------------------------------------------------- mix

const LEVELS: Readonly<Record<string, number>> = {
  bass: 0.52,
  sub: 0.48,
  pad: 0.3,
  keys: 0.3,
  stabs: 0.34,
  arp: 0.32,
  arp2: 0.26,
  lead: 0.34,
  counter: 0.24,
  vox: 0.76,
  harm: 0.42,
  high: 0.26,
  voc: 0.4,
  chop: 0.36,
  cloud: 0.24,
  fx: 0.24,
  spark: 0.16,
};
/** The sampled stack at the demos' balance, a notch under the chart's bed. */
const BOOK_LEVELS: Readonly<Record<string, number>> = {
  bvox: 1,
  bdbl: 0.5,
  bchops: 0.7,
  vlead: 0.36,
  vgrain: 0.26,
};
/** What the synth voices keep under a book, as the demos blend theirs. */
const SUNG_UNDER: Readonly<Record<string, number>> = {
  vox: 0.32,
  chop: 0.6,
};
/** The genome's kits sit at Redline's balance; a chart's busier grids run hotter. */
const DRUM_BALANCE: Readonly<Record<string, number>> = {
  kick: 0.72,
  snare: 0.78,
  hats: 0.55,
};
const trim = (role: string, sound: string) => SOUND_TRIMS[role]?.[sound] ?? 1;

function tracksFor(
  chart: Chart,
  used: ReadonlySet<string>,
  lanes: ReadonlyMap<string, Record<string, AutomationPoint[]>>,
  notes: readonly NoteInput[],
  localBook = false,
): TrackInput[] {
  const d = chart.sounds.design;
  const sound = chart.sounds;
  const kind = SINGERS[sound.singer] ?? SINGERS.sung!;
  const make: Record<string, () => TrackInput> = {
    bass: () => BASS[sound.bass]!("bass", "Bass", LEVELS.bass!, d),
    pad: () => PAD[sound.pad]!("pad", "Pad", LEVELS.pad!, d),
    keys: () => ({ ...PAD.ep!("keys", "Keys", LEVELS.keys!, d), pan: -0.18 }),
    stabs: () => STAB[sound.stab]!("stabs", "Stabs", LEVELS.stabs!, d),
    arp: () => ({
      ...ARP[sound.arp]!("arp", "Arp", LEVELS.arp!, d),
      pan: -0.24,
    }),
    arp2: () => ({
      ...ARP[sound.arp2]!("arp2", "Arp II", LEVELS.arp2!, d),
      pan: 0.3,
    }),
    lead: () => ({
      ...LEAD[sound.lead]!("lead", "Lead", LEVELS.lead!, d),
      pan: 0.08,
    }),
    counter: () => ({
      ...(ARP[sound.counter] ?? LEAD[sound.counter]!)(
        "counter",
        "Counter line",
        LEVELS.counter!,
        d,
      ),
      pan: 0.28,
    }),
    vox: () => singer("vox", "Singer", LEVELS.vox!, kind, d),
    harm: () => harmonySinger("harm", "Harmony", LEVELS.harm!, kind, d),
    high: () =>
      singer(
        "high",
        "High double",
        LEVELS.high!,
        { ...kind, preset: "glass", formant: kind.formant + 2 },
        d,
        { pan: -0.28 },
      ),
    chop: () =>
      singer(
        "chop",
        "Chops",
        LEVELS.chop!,
        { ...kind, formant: kind.formant + 1, ring: 0.5 },
        d,
        {
          pan: 0.22,
          filter: { type: "hpf", cutoff: 400, resonance: 0 },
          fx: { crush: { bits: 10, coarse: 2, mix: 0.15 + 0.2 * d.grit } },
          delay: { beats: 0.75, feedback: 0.35, mix: 0.2, pingpong: true },
        },
      ),
    voc: () =>
      ({
        id: "voc",
        name: "Vocoder",
        instrument: "vocoder",
        volume: LEVELS.voc!,
        vocoder: {
          src: "vox",
          preset: "classic",
          follow: "notes",
          carrier: "supersaw",
          bands: 20,
          spread: 0.2,
          release: 0.07,
          unvoiced: 0.35,
        },
        filter: { type: "hpf", cutoff: 240, resonance: 0 },
        fx: {
          chorus: { rate: 0.5, depth: 0.5, mix: 0.4 },
          double: { time: 14, drift: 1.5, width: 0.9 },
          eq: { mid: -2, midfreq: 500, high: 2, highfreq: 7000 },
        },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.12, pingpong: true },
        reverb: { mix: 0.22, size: 0.75, fade: 2.8, lowpass: 8000 },
      }) as TrackInput,
    cloud: () => cloudTrack("cloud", LEVELS.cloud!, d),
    fx: () => fxTrack("fx", LEVELS.fx!),
    spark: () => sparkTrack("spark", LEVELS.spark!, d),
  };
  const trims: Record<string, number> = {
    bass: trim("bass", sound.bass),
    pad: trim("pad", sound.pad),
    keys: trim("pad", "ep"),
    stabs: trim("stab", sound.stab),
    arp: trim("arp", sound.arp),
    arp2: trim("arp", sound.arp2),
    lead: trim("lead", sound.lead),
    counter: SOUND_TRIMS.arp?.[sound.counter] ?? trim("lead", sound.counter),
  };
  const kitOf: Record<string, string> = {
    kick: sound.kit.kick,
    snare: sound.kit.snare,
    hats: sound.kit.hats,
    perc: sound.kit.snare,
  };
  // Normalized local books retain the released stock path's drum balance.
  const out: TrackInput[] = drumTracks(
    chart.bpm,
    sound.kit,
    d,
    localBook ? { snareBody: false, hatAir: 8 } : undefined,
  )
    .filter((t) => used.has(t.id))
    .map((t) =>
      withGain(
        t,
        (DRUM_TRIMS[t.id === "perc" ? "snare" : t.id]?.[kitOf[t.id] ?? ""] ??
          1) * (DRUM_BALANCE[t.id] ?? 1),
      ),
    );
  for (const [id, build] of Object.entries(make))
    if (used.has(id)) out.push(withGain(build(), trims[id] ?? 1));
  // A characterful bass gets a clean sine under it.
  if (used.has("bass") && !["sub808", "boom"].includes(sound.bass)) {
    out.push(subTrack(LEVELS.sub!));
  }
  return out.map((track) => {
    let t = track;
    if (t.id === "vox" || t.id === "voc") {
      const thrown = throwLane(notes, t.delay?.mix ?? 0.08);
      if (thrown) t = { ...t, delayMixAutomation: thrown };
    }
    const l = lanes.get(t.id);
    if (!l) return t;
    const fx = { ...(t.fx ?? {}) } as Record<string, unknown>;
    if ((l["crush-mix"] || l["crush-bits"]) && !fx.crush)
      fx.crush = { bits: 16, coarse: 1, mix: 0 };
    const fxAutomation: Record<string, AutomationPoint[]> = {
      ...(t.fxAutomation as Record<string, AutomationPoint[]> | undefined),
    };
    for (const [key, points] of Object.entries(l))
      fxAutomation[key] = merge([...points].sort((a, b) => a.tick - b.tick));
    return {
      ...t,
      fx: fx as TrackInput["fx"],
      fxAutomation: fxAutomation as TrackInput["fxAutomation"],
    };
  });
}

/**
 * Delay throws, as the demos do them: the echo opens on the held word that
 * ends a line and closes before the next one starts, at most once in two bars.
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
    if (dur(n) < TPB || on(n) - last < 2 * BAR) return;
    if (next && on(next) < end - TPB / 8) return;
    last = on(n);
    const close = Math.min(end + TPB, next ? on(next) : Infinity);
    points.push(
      { tick: on(n), value: base },
      { tick: on(n) + Math.round(dur(n) / 2), value: 0.34 },
      { tick: close - 1, value: 0.34 },
      { tick: close, value: base },
    );
  });
  return points.length > 1 ? merge(points) : undefined;
}
