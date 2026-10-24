/**
 * The candy palette: Candy Fault's production as rules, so any sheet in its
 * pop form (intro, verses, pre-choruses, choruses, a glitch break, a bridge
 * and an outro, each of one fixed length) is arranged the way the demo is.
 * The sheet brings the chords, the sung lines and the hooks; everything the
 * demo does around them is computed here from the chords:
 *
 * - Candy Fault's own instruments and mix (`candyTracks`), with automation
 *   placed where this song's sections fall
 * - an 808 locked to the kick that slides, pops an octave and walks by step,
 *   lets go before each chorus and dives on the break's tape stop
 * - Rhodes voicings that move by the smallest step, a pre-chorus stack with
 *   4-3 suspensions, an open chorus stack with octave stabs above the singer
 * - two chip arpeggios on interlocking sixteenths, a pluck that answers the
 *   verse lines and finishes the chorus lines where the singer rests
 * - the singer scooped and held, a chord-aware harmony under held chorus
 *   notes, an octave-up double in the last chorus, a stuttered peak word
 * - a kick-less glitch break of stuttered syllables, a silent beat before the
 *   last chorus, whose final bar turns to the tonic under a crash
 */
import type { AutomationPoint, NoteInput, TrackScore } from "../../score.ts";
import { BAR, Composer, lanes, TPB, type Phrase } from "../../demos/build.ts";
import {
  candyTracks,
  fall,
  HATS_DRIVE,
  HATS_HALF,
  KICK,
  scoop,
  SNAP_CHORUS,
  steps,
  sweeps,
  throws,
} from "../../demos/candy-fault.ts";
import { demoInfo } from "../../demos/types.ts";
import {
  chordClasses,
  chordQuality,
  degreePitch,
  isInversion,
  numeralDegree,
  partBars,
  type Key,
  type SheetKind,
  type SheetNote,
  type SheetPart,
  type SongSheet,
} from "./sheet.ts";

type Extra = Partial<NoteInput>;
type Role =
  | "boot"
  | "verse"
  | "lift"
  | "chorus"
  | "glitch"
  | "verse2"
  | "lift2"
  | "return"
  | "bridge"
  | "over"
  | "last";

/** A bar's chord, voiced for every instrument that plays it. */
type Chord = Readonly<{
  degree: number;
  /** Root, 3rd and 5th as pitch classes. */
  triad: readonly number[];
  /** The colour tones the parts may hold: the triad plus a 7th or 9th. */
  colour: ReadonlySet<number>;
  /** The 808 note. */
  root: number;
  /** Four Rhodes notes in 50..67. */
  keys: readonly number[];
  /** The open supersaw stack under the singer. */
  saw: readonly number[];
  /** Two octave stabs above the singer. */
  stab: readonly number[];
  /** Two five-note chip arpeggio sets. */
  lo: readonly number[];
  hi: readonly number[];
}>;

type Placed = Readonly<{
  role: Role;
  kind: SheetKind;
  name: string;
  start: number;
  bars: number;
  lines: readonly (SheetPart | null)[];
  lead: readonly string[];
}>;

/** A sung note at its place in the song. */
type Sung = {
  bar: number;
  beat: number;
  pitch: number;
  length: number;
  velocity: number;
  lyric: string;
};

const pc = (pitch: number) => ((pitch % 12) + 12) % 12;
/** The lowest pitch at or above `low` with this pitch class. */
const from = (cls: number, low: number) => low + pc(cls - low);
/** Chord tones from `low` upward, `count` of them. */
const ladder = (cls: Iterable<number>, low: number, count: number) => {
  const set = new Set(cls);
  const out: number[] = [];
  for (let p = low; out.length < count && p < low + 48; p++)
    if (set.has(pc(p))) out.push(p);
  return out;
};
/** The chord tone nearest a pitch (down first on a tie). */
const nearest = (cls: ReadonlySet<number>, pitch: number) => {
  for (let d = 0; d < 12; d++) {
    if (cls.has(pc(pitch - d))) return pitch - d;
    if (cls.has(pc(pitch + d))) return pitch + d;
  }
  return pitch;
};
/** A semitone from a chord tone and not one itself. */
const rubs = (cls: ReadonlySet<number>, pitch: number) =>
  !cls.has(pc(pitch)) && (cls.has(pc(pitch + 1)) || cls.has(pc(pitch - 1)));

function rolesOf(kinds: readonly SheetKind[]): Role[] {
  const choruses = kinds.filter((k) => k === "chorus").length;
  const seen: Partial<Record<SheetKind, number>> = {};
  return kinds.map((kind) => {
    const n = (seen[kind] = (seen[kind] ?? 0) + 1);
    switch (kind) {
      case "intro":
        return "boot";
      case "verse":
        return n === 1 ? "verse" : "verse2";
      case "pre":
        return n === 1 ? "lift" : "lift2";
      case "chorus":
        return choruses >= 2 && n === choruses
          ? "over"
          : n === 1
            ? "chorus"
            : "return";
      case "break":
        return "glitch";
      case "bridge":
        return "bridge";
      default:
        return "last";
    }
  });
}

/** Rhodes: one note of each colour tone in 50..67, nearest the last voicing. */
function keysFor(colour: readonly number[], prev: readonly number[]) {
  let best: number[] | undefined;
  let cost = Infinity;
  const options = colour.map((c) =>
    [from(c, 50), from(c, 50) + 12].filter((p) => p <= 67),
  );
  const walk = (i: number, picked: number[]) => {
    if (i === options.length) {
      const v = [...picked].sort((a, b) => a - b);
      if (v.at(-1)! - v[0]! > 14) return;
      const c = v.reduce((n, p, k) => n + Math.abs(p - (prev[k] ?? 58)), 0);
      if (c < cost) [best, cost] = [v, c];
      return;
    }
    for (const p of options[i]!) walk(i + 1, [...picked, p]);
  };
  walk(0, []);
  return best ?? colour.map((c) => from(c, 52)).sort((a, b) => a - b);
}

/** The open chorus stack: root, 5th, octave, 3rd, 5th, under about B4. */
function sawFor(triad: readonly number[]) {
  const [r, third, fifth] = triad as [number, number, number];
  const bottom = from(r, 45);
  const stack = [
    bottom,
    from(fifth, bottom + 1),
    bottom + 12,
    from(third, bottom + 13),
    from(fifth, bottom + 13),
  ].sort((a, b) => a - b);
  const set = new Set(triad);
  // Keep the top voice just under the singer, near A4..B4.
  while (stack.at(-1)! < 66) {
    stack.shift();
    stack.push(ladder(set, stack.at(-1)! + 1, 1)[0]!);
  }
  while (stack.at(-1)! > 72) {
    stack.pop();
    let p = stack[0]! - 1;
    while (!set.has(pc(p))) p--;
    stack.unshift(p);
  }
  return stack;
}

function chordsFor(key: Key, numerals: readonly string[], walk: boolean) {
  let keys: readonly number[] = [52, 56, 59, 63];
  let bass = 35;
  return numerals.map((numeral): Chord => {
    const degree = numeralDegree(numeral) ?? 1;
    const triad = [0, 2, 4].map(
      (k) => (key.tonic + key.steps[(degree - 1 + k) % 7]!) % 12,
    );
    const colour = chordClasses(key, degree);
    const low = triad[isInversion(numeral) ? 1 : 0]!;
    if (walk) {
      // The bridge bass walks: the nearest octave to the last note.
      const options = [from(low, 28), from(low, 28) + 12].filter(
        (p) => p <= 40,
      );
      bass = options.reduce((a, b) =>
        Math.abs(b - bass) < Math.abs(a - bass) ? b : a,
      );
    } else bass = from(low, 28);
    keys = keysFor(colour, keys);
    return {
      degree,
      triad,
      colour: new Set(colour),
      root: bass,
      keys,
      saw: sawFor(triad),
      stab: ladder(triad, 82, 2),
      lo: ladder(colour, 81, 5),
      hi: ladder(colour, 84, 5),
    };
  });
}

/** Render a validated candy-palette sheet. */
export function compileCandy(sheet: SongSheet, key: Key): TrackScore {
  const roles = rolesOf(sheet.sections.map((s) => s.kind));
  let at = 0;
  const placed: Placed[] = sheet.sections.map((section, i) => {
    const p: Placed = {
      role: roles[i]!,
      kind: section.kind,
      name: section.name,
      start: at,
      bars: section.bars,
      lines: section.lines ?? [],
      lead: section.lead ?? [],
    };
    at += section.bars;
    return p;
  });
  const BARS = at;
  const chords: Chord[] = placed.flatMap((p) => {
    const list = sheet.progressions[sheet.sections[placed.indexOf(p)]!.chords]!;
    return chordsFor(
      key,
      Array.from({ length: p.bars }, (_, k) => list[k % list.length]!),
      p.role === "bridge",
    );
  });
  const tonic = chordsFor(key, [key.minor ? "i" : "I"], false)[0]!;
  const partAt = (b: number) =>
    placed.find((p) => b >= p.start && b < p.start + p.bars)!;
  const first = (role: Role) => placed.find((p) => p.role === role);
  const over = first("over");
  const landing = over ? over.start + over.bars - 1 : -1;
  /** The chord sounding at a beat (the landing bar turns to I on beat three). */
  const chordAt = (bar: number, beat = 0) =>
    bar === landing && beat >= 2
      ? tonic
      : chords[Math.max(0, Math.min(BARS - 1, bar))]!;
  const base = key.base;
  const deg = (d: number) => degreePitch(key, d);
  const scale = new Set(key.steps.map((step) => (key.tonic + step) % 12));

  const s = new Composer(
    demoInfo({
      id: slug(sheet.title),
      title: sheet.title,
      style: "Hyperpop",
      description: `Hyperpop in ${sheet.key} at ${sheet.bpm}, written as a song sheet on the candy palette (Candy Fault's production).`,
      tempoBpm: sheet.bpm,
      key: key.label,
      bars: BARS,
      highlightBar: (first("chorus") ?? placed[0]!).start,
      trackId: "chops",
      features: [
        "a pitched-up singer with chord-aware harmony under the held words",
        "a chip pluck that finishes the singer's lines where the singer rests",
        "two interlocking chip arpeggios on complementary sixteenths",
        "an 808 that slides, pops an octave and walks by step",
        "a kick-less glitch break and a silent beat before the last chorus",
      ],
      arrangement: placed.map((p) => `${p.name} ${p.bars}`),
      mixNotes: [
        "Candy Fault's instruments, mix and automation, placed on this song's form",
        "the last chorus doubles the singer an octave up and lands on the tonic",
      ],
    }),
  );
  for (const p of placed) s.section(p.name, p.start, p.bars);
  candyTracks(s, candyLanes(placed, BARS));

  /** A note, skipped when it falls outside the song. */
  const put = (
    track: string,
    bar: number,
    beat: number,
    pitch: number,
    length: number,
    velocity: number,
    extra: Extra = {},
  ) => {
    const tick = bar * BAR + beat * TPB;
    if (tick < 0 || tick >= BARS * BAR - 1) return;
    s.note(track, bar, beat, pitch, length, velocity, extra);
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
    pitch: number | readonly number[],
    lo: number,
    hi: number,
    skip: readonly number[] = [],
  ) => {
    for (let i = 0; i < count; i++) {
      if (skip.includes(i)) continue;
      hit(
        track,
        bar,
        beat + i * step,
        typeof pitch === "number" ? pitch : pitch[i]!,
        lo + ((hi - lo) * i) / Math.max(1, count - 1),
        Math.min(0.13, step * 0.9),
      );
    }
  };
  const rolled = (
    track: string,
    bar: number,
    beat: number,
    pitches: readonly number[],
    length: number,
    velocity: number,
    spread = 0.035,
  ) =>
    pitches.forEach((pitch, i) =>
      put(
        track,
        bar,
        beat + i * spread,
        pitch,
        length - i * spread,
        velocity * (i === pitches.length - 1 ? 1.06 : 0.9),
      ),
    );
  const chord = (
    track: string,
    bar: number,
    beat: number,
    pitches: readonly number[],
    length: number,
    velocity: number,
  ) =>
    pitches.forEach((pitch, i) =>
      put(
        track,
        bar,
        beat + i * 0.008,
        pitch,
        length,
        velocity * (i === pitches.length - 1 ? 1 : 0.88),
      ),
    );
  const stutter = (
    track: string,
    bar: number,
    beat: number,
    count: number,
    step: number,
    pitches: readonly number[],
    lo: number,
    hi: number,
    extra: Extra = {},
  ) => {
    for (let i = 0; i < count; i++)
      put(
        track,
        bar,
        beat + i * step,
        pitches[i % pitches.length]!,
        step * 0.9,
        lo + ((hi - lo) * i) / Math.max(1, count - 1),
        extra,
      );
  };
  const ARP_UP = [0, 1, 2, 3, 1, 2, 3, 4];
  const ARP_DOWN = [4, 3, 2, 1, 3, 2, 1, 0];
  const ARP_ROCK = [2, 3, 4, 3, 2, 1, 0, 1];
  const arp = (
    track: "arp" | "arp2",
    bar: number,
    tones: readonly number[],
    gain: number,
    order: readonly number[],
    offset = 0,
  ) =>
    order.forEach((index, i) =>
      put(
        track,
        bar,
        offset + i * 0.5,
        tones[index]!,
        0.2,
        (i % 2 === 0 ? 0.78 : 0.56) * gain,
      ),
    );

  // ── the topline, placed ────────────────────────────────────────────────
  const sung: Sung[] = [];
  const sungBy = new Map<Placed, Sung[]>();
  for (const p of placed) {
    const list: Sung[] = [];
    p.lines.forEach((part, i) => {
      if (!part) return;
      const notes = sheet.lines[part] ?? [];
      const pitches = notes.map(([, d]) => deg(d));
      const low = Math.min(...pitches);
      const span = Math.max(1, Math.max(...pitches) - low);
      const gain =
        p.role === "bridge"
          ? 0.74
          : p.role === "last"
            ? 0.78
            : p.kind === "chorus"
              ? 1.04
              : 0.94;
      notes.forEach(([beat, degree, length, lyric]: SheetNote, k) => {
        const next = notes[k + 1];
        // A short note stepping straight on leans on the beat; it stays.
        const leans =
          length <= 0.5 &&
          next !== undefined &&
          next[0] - beat <= 0.5 &&
          Math.abs(next[1] - degree) === 1;
        const bar = p.start + i + Math.floor(beat / 4);
        const b = beat - 4 * Math.floor(beat / 4);
        let pitch = deg(degree);
        // The harmony guard: no whole-beat semitone against the bar's chord.
        if (b % 1 === 0 && !leans && rubs(chordAt(bar, b).colour, pitch))
          pitch = nearest(chordAt(bar, b).colour, pitch);
        list.push({
          bar,
          beat: b,
          pitch,
          length,
          velocity: Math.min(
            0.9,
            (0.6 +
              (0.1 * (deg(degree) - low)) / span +
              (length >= 0.85 ? 0.1 : 0)) *
              gain,
          ),
          lyric,
        });
      });
    });
    sungBy.set(p, list);
    sung.push(...list);
  }
  const at16 = (n: Sung) => n.bar * 16 + n.beat * 4;
  sung.sort((a, b) => at16(a) - at16(b));
  /** Whether the singer sounds anywhere in [from, to) beats of a bar. */
  const singing = (bar: number, lo: number, hi: number) =>
    sung.some((n) => {
      const start = (n.bar - bar) * 4 + n.beat;
      return start < hi && start + n.length > lo;
    });

  // The last chorus: its peak word stutters and its last bar lands on I.
  if (over) {
    const mine = sungBy.get(over)!;
    const lastPart = Math.max(...over.lines.flatMap((q, i) => (q ? [i] : [])));
    const tail = mine.filter(
      (n) => n.bar >= over.start + lastPart && n.bar < landing,
    );
    const peak = tail.reduce<Sung | undefined>(
      (a, n) => (!a || n.pitch > a.pitch ? n : a),
      undefined,
    );
    if (peak && peak.length <= 0.5) {
      const next = tail.find((n) => at16(n) > at16(peak));
      if (!next || at16(next) - at16(peak) >= 3) {
        const word = peak.lyric.replace(/-$/, "");
        for (const k of [1, 2]) {
          const extra: Sung = {
            ...peak,
            beat: peak.beat + 0.25 * k,
            length: 0.2,
            velocity: peak.velocity * (k === 1 ? 0.84 : 0.9),
            lyric: k === 2 ? peak.lyric : word,
          };
          sung.push(extra);
          mine.push(extra);
        }
        peak.length = 0.2;
        peak.lyric = word;
      }
    }
    const inLanding = mine.filter((n) => n.bar === landing);
    const held = inLanding.filter((n) => n.beat < 2).at(-1);
    if (held && !inLanding.some((n) => n.beat >= 2)) {
      held.length = Math.max(held.length, 2.5 - held.beat);
      let to = held.pitch;
      while (!new Set(tonic.triad).has(pc(to)) && to > held.pitch - 5) to--;
      const resolve: Sung = {
        bar: landing,
        beat: 2.5,
        pitch: new Set(tonic.triad).has(pc(to)) ? to : held.pitch,
        length: 1.5,
        velocity: held.velocity,
        lyric: "_",
      };
      held.length = 2.5 - held.beat;
      sung.push(resolve);
      mine.push(resolve);
    }
    sung.sort((a, b) => at16(a) - at16(b));
  }

  for (const p of placed)
    for (const n of sungBy.get(p)!) {
      const gain = p.role === "over" ? 1.1 : 1;
      const long = n.length >= 1.4;
      put("vocal", n.bar, n.beat, n.pitch, n.length, n.velocity * gain, {
        ...(n.lyric ? { lyric: n.lyric } : {}),
        ...(n.length >= 0.85 && n.lyric !== "_" ? scoop(-80, 0.1) : {}),
        ...(long && n.pitch >= base + 11
          ? { vibrato: { rate: 5.8, depth: 32, delay: 0.28 } }
          : {}),
      });
    }

  /**
   * The backing singer: under each held note, the nearest chord tone a
   * third (or a fourth, or a sixth) below. A word held over the bar line is
   * heard against the next bar's chord, so that is the one it fits.
   */
  const below = (n: Sung) => {
    const c =
      n.beat >= 3 && n.beat + n.length > 4.5
        ? chordAt(n.bar + 1, 0)
        : chordAt(n.bar, n.beat);
    const on = chordAt(n.bar, n.beat);
    for (const gap of [3, 4, 5, 8, 9]) {
      const p = n.pitch - gap;
      if (!scale.has(pc(p)) || !new Set(c.triad).has(pc(p))) continue;
      if (rubs(c.colour, p) || rubs(on.colour, p)) continue;
      return p;
    }
    return undefined;
  };
  for (const p of placed) {
    const liftLike = p.role === "lift" || p.role === "lift2";
    const chorusLike = p.kind === "chorus";
    if (!liftLike && !chorusLike && p.role !== "bridge") continue;
    for (const n of sungBy.get(p)!) {
      if (n.length < 0.8 || n.lyric === "") continue;
      // In the pre-chorus only its second half is doubled.
      if (liftLike && n.bar < p.start + 2) continue;
      const h = below(n);
      if (h !== undefined)
        put(
          "harm",
          n.bar,
          n.beat,
          h,
          n.length,
          n.velocity * (p.role === "bridge" ? 0.9 : 0.64),
          { lyric: n.lyric },
        );
    }
    // The octave-up double sings all of the last chorus's lines.
    if (p.role === "over")
      for (const n of sungBy.get(p)!)
        if (n.pitch <= base + 16)
          put("high", n.bar, n.beat, n.pitch + 12, n.length, n.velocity * 0.9, {
            lyric: n.lyric,
          });
  }

  // The glitch break stutters the chorus's peak word.
  const chorusNotes = placed
    .filter((p) => p.kind === "chorus")
    .flatMap((p) => sungBy.get(p)!);
  const peakNote = chorusNotes.reduce<Sung | undefined>(
    (a, n) => (!a || n.pitch > a.pitch ? n : a),
    undefined,
  );
  const peak = peakNote?.pitch ?? deg(12);
  const peakWord = (peakNote?.lyric ?? "pix").replace(/-$/, "") || "pix";
  const stepDown = (pitch: number, steps: number) => {
    let p = pitch;
    for (let k = 0; k < steps; k++) {
      p--;
      while (!scale.has(pc(p))) p--;
    }
    return p;
  };

  // ── hook material, computed from the chords ────────────────────────────
  const hookBars = (name: string): Phrase[] =>
    (sheet.hooks?.[name] ?? []).map((bar) =>
      bar.map(
        ([beat, d, beats], i) =>
          [
            beat,
            deg(d),
            beats,
            i === 0 || i === bar.length - 1 ? 0.78 : i % 2 ? 0.63 : 0.68,
          ] as const,
      ),
    );
  const hookNames = Object.keys(sheet.hooks ?? {});
  const leadOf = (p: Placed, fallback: string) =>
    p.lead[0] ?? (hookNames.includes(fallback) ? fallback : hookNames[0]);
  /** Rubbing hook notes move onto the chord sounding under them. */
  const fit = (bar: number, phrase: Phrase): Phrase =>
    phrase.map(([beat, pitch, length, velocity]) => {
      const c = chordAt(bar + Math.floor(beat / 4), beat % 4);
      return [
        beat,
        rubs(c.colour, pitch) ? nearest(c.colour, pitch) : pitch,
        length,
        velocity,
      ] as const;
    });
  const hook = (bar: number, phrase: Phrase, gain = 1) => {
    const notes = fit(bar, phrase).filter(([beat]) => beat >= 0 && beat < 4);
    notes.forEach(([beat, pitch, length, velocity = 0.7], i) => {
      const last = i === notes.length - 1;
      put("hook", bar, beat, pitch, length, velocity * gain, {
        ...(i > 0 && !last ? { glide: 0.035 } : {}),
        ...(last ? scoop(-140, 0.18) : {}),
        ...(last && length >= 0.7
          ? { vibrato: { rate: 6.2, depth: 24, delay: 0.12 } }
          : {}),
      });
    });
  };
  /** A climbing scale run that lands on a chord tone: the pluck's answer. */
  const climb = (bar: number, variant: number, start = 2): Phrase => {
    const c = chordAt(bar);
    let p = nearest(new Set(c.triad), base + 7);
    const run = [p];
    for (let k = 0; k < 3; k++) run.push((p = stepDown(p, -1) + 0));
    const land = ladder(c.triad, p + 3, 1)[0]!;
    const beats =
      variant % 2 === 0 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 0.75, 1, 1.25];
    return [...run, land].map(
      (pitch, k) =>
        [
          start + beats[k]!,
          pitch,
          k === 4 ? 0.8 : 0.22,
          k === 4 ? 0.82 : k % 2 ? 0.6 : 0.7,
        ] as const,
    );
  };
  /** Verse two's counter-line: three chord tones falling, or rising at the end. */
  const counter = (bar: number, rise: boolean): Phrase => {
    const c = chordAt(bar);
    if (rise) {
      const up = ladder(c.triad, base + 9, 4);
      return up.map(
        (pitch, k) => [2 + k * 0.5, pitch, k === 3 ? 0.6 : 0.22, 0.6] as const,
      );
    }
    const top = nearest(new Set(c.triad), base + 12);
    const down = [top];
    for (let k = 0; k < 2; k++) {
      let q = down.at(-1)! - 1;
      while (!new Set(c.triad).has(pc(q))) q--;
      down.push(q);
    }
    return down.map(
      (pitch, k) =>
        [
          2.5 + k * 0.5,
          pitch,
          k === 2 ? 0.6 : 0.22,
          k === 1 ? 0.54 : 0.6,
        ] as const,
    );
  };
  /** Drop the pluck's notes that would land on the singer. */
  const clear = (bar: number, phrase: Phrase): Phrase =>
    phrase.filter(
      ([beat, , length]) => !singing(bar, beat - 0.1, beat + length),
    );

  // ── the 808 and the kick ────────────────────────────────────────────────
  const rootAt = (b: number) => chordAt(b).root;
  /** The scale step just under the next root: the 808's approach note. */
  const approach = (b: number) => {
    const next = rootAt(b + 1);
    return scale.has(pc(next - 1)) ? next - 1 : next - 2;
  };
  const kickBar = (
    b: number,
    grid: string,
    opts: {
      drop?: boolean;
      last?: "pop" | number;
      hold?: boolean;
      rest?: readonly number[];
      cut?: number;
      level?: number;
    } = {},
  ) => {
    if (!grid) return;
    const level = opts.level ?? 1;
    s.grid("kick", b, 36, grid, level);
    const root = rootAt(b);
    const next = b + 1 < BARS ? rootAt(b + 1) : root;
    const prev = b > 0 ? rootAt(b - 1) : root;
    const onsets = [...grid].flatMap((c, i) => (c === "." ? [] : [i]));
    const entry: Extra = opts.drop
      ? {
          bend: [
            { at: 0, cents: 1200 },
            { at: 0.3, cents: 0 },
          ],
        }
      : prev !== root
        ? { glide: 0.07 }
        : {};
    if (opts.hold) {
      const step = onsets[0] ?? 0;
      put(
        "sub",
        b,
        step * 0.25,
        root,
        (16 - step) * 0.25 - 0.04,
        Math.min(0.9, (Number(grid[step]) / 10) * 0.95 * level),
        entry,
      );
      return;
    }
    const last = opts.last;
    onsets.forEach((step, k) => {
      if (opts.rest?.includes(step)) return;
      const end = k + 1 < onsets.length ? onsets[k + 1]! : (opts.cut ?? 16);
      const velocity = Number(grid[step]) / 10;
      const lastHit = k === onsets.length - 1;
      const leaves =
        lastHit && step >= 10 && next !== root && last !== undefined;
      const pitch =
        !leaves || last === undefined
          ? root
          : last === "pop"
            ? root + 12
            : last;
      const length =
        (end - step) * 0.25 - (lastHit && next !== root ? -0.02 : 0.06);
      put(
        "sub",
        b,
        step * 0.25,
        pitch,
        length,
        Math.min(0.9, velocity * 0.95 * level),
        k === 0 ? entry : leaves ? { glide: 0.05 } : {},
      );
    });
  };

  const top = base + 24;
  for (let b = 0; b < BARS; b++) {
    const p = partAt(b);
    const part = p.role;
    const inPart = b - p.start;
    const h = chordAt(b);
    const chorusLike = p.kind === "chorus";
    const verseLike = part === "verse" || part === "verse2";
    const liftLike = part === "lift" || part === "lift2";
    const lastBar = inPart === p.bars - 1;

    // ── drums ─────────────────────────────────────────────────────────
    if (part === "boot" && lastBar) {
      s.grid("hats", b, 42, "1122334455667788", 0.75);
      hit("snap", b, 3.5, 39, 0.5);
    }
    if (verseLike) {
      kickBar(b, KICK.verse![inPart % 4]!, {
        drop: inPart === 0,
        hold: inPart % 4 === 0,
        last: inPart % 4 === 1 ? "pop" : inPart === 3 ? approach(b) : undefined,
      });
      s.grid("snap", b, 38, "........9.......");
      s.grid("snap", b, 39, "........7.......");
      if (inPart % 4 === 1) s.grid("snap", b, 38, "..........2....3");
      if (inPart % 4 === 3) s.grid("snap", b, 38, "...2..........3.");
      const busy = part === "verse2" && inPart >= 4;
      s.grid(
        "hats",
        b,
        42,
        busy ? "7465746574657465" : HATS_HALF[inPart % 4]!,
        busy ? 0.74 : 0.92,
      );
      if (inPart % 4 === 1) roll("hats", b, 3.5, 4, 0.125, 42, 0.35, 0.6);
      if (inPart % 4 === 2) roll("hats", b, 3, 6, 1 / 6, 42, 0.3, 0.62, [3]);
      if (inPart % 4 === 3) hit("hats", b, 3.5, 46, 0.5, 0.4);
      if (inPart === 3 && part === "verse")
        roll("snap", b, 3.5, 8, 1 / 16, 38, 0.55, 0.2);
      if (inPart === 3 && part === "verse2")
        roll("snap", b, 3, 4, 0.25, 39, 0.35, 0.72);
      if (part === "verse2" && lastBar)
        roll(
          "snap",
          b,
          3,
          8,
          0.125,
          [38, 38, 41, 41, 43, 45, 47, 48],
          0.4,
          0.8,
        );
    }
    if (liftLike) {
      kickBar(b, KICK.lift![inPart % 4]!, {
        last: inPart === 3 ? "pop" : undefined,
      });
      if (inPart < 2) {
        s.grid("snap", b, 38, inPart ? "....7.......7.4." : "....7.......7...");
        s.grid("snap", b, 39, "....5.......5...");
      } else if (inPart === 2) s.grid("snap", b, 38, "3.4.4.5.5.6.6.7.");
      else {
        s.grid("snap", b, 38, "4455667788......");
        roll(
          "snap",
          b,
          2.5,
          12,
          0.125,
          [41, 41, 43, 43, 45, 45, 47, 47, 48, 48, 50, 50],
          0.4,
          0.9,
        );
      }
      s.grid("hats", b, 42, "6363636363636363", 0.48 + inPart * 0.08);
      if (inPart === 3) roll("hats", b, 2, 8, 0.125, 42, 0.4, 0.8);
    }
    if (chorusLike) {
      const grids = part === "over" ? KICK.over! : KICK.chorus!;
      const last = lastBar;
      const dropout = part === "return" && inPart === 3;
      const half = part === "over" && inPart === 6;
      const land = b === landing;
      if (land) {
        s.grid("kick", b, 36, "9...8...9...8...");
        put("sub", b, 0, h.root, 1.94, 0.85);
        put("sub", b, 1, h.root, 0.94, 0.76);
        put("sub", b, 2, tonic.root, 1.98, 0.88, { glide: 0.07 });
      } else
        kickBar(
          b,
          dropout || half
            ? "9...8..........."
            : last
              ? "9...8...9......."
              : grids[inPart % 4]!,
          {
            drop: inPart === 0,
            last:
              inPart % 4 === 3
                ? "pop"
                : inPart % 4 === 2
                  ? approach(b)
                  : undefined,
            rest: inPart % 4 === 1 && part !== "over" ? [8] : [],
            cut: half ? 8 : undefined,
            level: part === "chorus" ? 0.9 : 1,
          },
        );
      const shift = part === "return" ? 1 : part === "over" ? 2 : 0;
      s.grid(
        "snap",
        b,
        38,
        dropout || half
          ? "....9..........."
          : SNAP_CHORUS[(inPart + shift) % 4]!,
      );
      s.grid(
        "snap",
        b,
        39,
        dropout || half ? "....8..........." : "....8.......8...",
      );
      if (inPart % 4 === 3 && !last && !dropout && !half)
        s.grid("snap", b, 38, "..............45");
      if (part === "over" && inPart === 3) {
        s.grid("snap", b, 39, ".....3.......3..");
        roll("snap", b, 3.5, 8, 1 / 16, 38, 0.6, 0.18);
      }
      if (inPart === 3 && part === "chorus")
        roll(
          "snap",
          b,
          3,
          8,
          0.125,
          [38, 38, 41, 43, 45, 47, 48, 50],
          0.5,
          0.88,
        );
      if (dropout) {
        roll("hats", b, 2, 4, 0.25, 42, 0.3, 0.5);
        roll("hats", b, 3, 8, 1 / 16, 42, 0.5, 0.9);
        hit("hats", b, 3.5, 46, 0.7, 0.5);
      }
      if (land) {
        roll("snap", b, 0.5, 12, 0.125, 38, 0.35, 0.95);
        hit("snap", b, 2, 38, 0.95);
        hit("snap", b, 2, 39, 0.8);
        hit("hats", b, 2, 49, 0.9, 2);
      }
      if (last && part === "chorus")
        roll(
          "snap",
          b,
          3,
          8,
          0.125,
          [50, 48, 47, 45, 43, 41, 41, 41],
          0.8,
          0.4,
        );
      if (last && part === "return") roll("snap", b, 2, 4, 0.25, 38, 0.6, 0.85);
      if (inPart === 0)
        hit("hats", b, 0, 49, part === "chorus" ? 0.75 : 0.85, 2);
      if (!dropout) {
        s.grid(
          "hats",
          b,
          42,
          half
            ? "84658465........"
            : land
              ? "8465846584658465"
              : last
                ? "8465846584658..."
                : HATS_DRIVE[inPart % 4]!,
          part === "over" ? 1.18 : 1,
        );
        const variant = (inPart + shift) % 4;
        if (inPart % 4 === 1)
          variant % 2
            ? roll("hats", b, 3.25, 6, 0.125, 42, 0.38, 0.78, [3])
            : roll("hats", b, 3, 6, 1 / 6, 42, 0.35, 0.75);
        if (inPart % 4 === 3 && !last && !half) {
          roll("hats", b, 2.75, 10, 0.125, 42, 0.4, 0.82, [4, 9]);
          hit("hats", b, 3.5, 46, 0.55, 0.45);
        }
        if (part === "over" && !half)
          roll(
            "hats",
            b,
            inPart % 2 === 0 ? 1.5 : 3.5,
            4,
            0.125,
            42,
            0.32,
            0.6,
          );
      }
    }
    if (part === "glitch") {
      s.grid(
        "snap",
        b,
        39,
        inPart === 3 ? "........6..5..4." : "........7.......",
      );
      s.grid(
        "hats",
        b,
        42,
        [
          "4.3.4.3.4.3.4.3.",
          "4.3...3.4.3...3.",
          "4.3.4.3.4.3.4.3.",
          "4.3.4.3.4.3.....",
        ][inPart % 4]!,
        0.95,
      );
      if (inPart === 1) roll("hats", b, 3, 8, 0.125, 42, 0.2, 0.5, [2, 5]);
      if (inPart === 3) roll("hats", b, 2, 8, 0.125, 46, 0.5, 0.15);
      put("sub", b, 0, h.root, inPart === 3 ? 2.4 : 3.6, 0.42, {
        ...(inPart > 0 && h.root !== rootAt(b - 1) ? { glide: 0.12 } : {}),
      });
    }
    if (part === "bridge") {
      put(
        "sub",
        b,
        0,
        h.root,
        lastBar ? 2.4 : 3.8,
        inPart < 6 ? 0.4 : 0.46,
        inPart > 0 ? { glide: 0.1 } : {},
      );
      if (inPart === 0) hit("hats", b, 0, 49, 0.42, 2);
      if (inPart >= 4) {
        s.grid(
          "hats",
          b,
          42,
          lastBar ? "3.2.3.2.4.3....." : "3.2.3.2.3.2.3.2.",
          0.9,
        );
        if (inPart === 5) roll("hats", b, 3, 6, 1 / 6, 42, 0.18, 0.4);
        s.grid("snap", b, 37, "........4.......");
        if (lastBar) roll("snap", b, 1.5, 4, 0.25, 38, 0.15, 0.5);
      }
    }
    if (part === "last") {
      kickBar(b, KICK.last![inPart % 4]!, {});
      if (inPart < 2) {
        s.grid("snap", b, 38, "........6.......", 0.8);
        s.grid("hats", b, 42, "5.3.4.3.5.3.4.3.", 0.7 - inPart * 0.15);
      }
      if (inPart === 0) hit("hats", b, 0, 49, 0.6, 2);
      if (inPart === 2) put("sub", b, 0, h.root, 3.9, 0.55);
      if (inPart === 3) put("sub", b, 0, h.root, 3.6, 0.55, fall(-1200, 0.45));
    }

    // ── harmony ───────────────────────────────────────────────────────
    if (part === "boot") rolled("keys", b, 0, h.keys, 3.85, 0.42);
    if (verseLike && inPart % 2 === 0) {
      rolled("keys", b, 0, h.keys, 2.9, 0.46);
      rolled("keys", b, 3, h.keys.slice(1), 0.9, 0.34, 0.02);
      rolled("keys", b + 1, 1.5, chordAt(b + 1).keys.slice(1), 2.3, 0.38, 0.02);
    }
    if (part === "bridge") {
      rolled("keys", b, 0, h.keys, 2.4, inPart < 4 ? 0.58 : 0.54, 0.045);
      rolled("keys", b, 2.5, h.keys.slice(1), lastBar ? 0.4 : 1.4, 0.4, 0.03);
    }
    if (part === "last" && inPart < 3)
      rolled("keys", b, 0, h.keys, 3.85, 0.44 - inPart * 0.04);
    if (part === "last" && inPart === 3)
      rolled(
        "keys",
        b,
        0,
        [...h.keys, ladder(h.colour, h.keys.at(-1)! + 1, 1)[0]!],
        3.9,
        0.4,
        0.05,
      );
    if (liftLike) {
      // A close stack under the singer, its top voice climbing a step a bar;
      // a major chord holds its 4th over the downbeat and resolves to the 3rd.
      const gain = 0.4 + inPart * 0.03;
      const triad = new Set(h.triad);
      const peakTone = nearest(triad, base + 5 + inPart * 2);
      const close = [peakTone];
      while (close.length < 3) {
        let q = close[0]! - 1;
        while (!triad.has(pc(q))) q--;
        close.unshift(q);
      }
      const third = close.find((q) => pc(q) === h.triad[1]);
      const major = chordQuality(key, h.degree) === "major";
      if (major && third !== undefined) {
        const fourth = stepDown(third, -1);
        chord(
          "chords",
          b,
          0,
          close.filter((q) => q !== third),
          3.9,
          gain,
        );
        put("chords", b, 0, fourth, 0.95, gain);
        put("chords", b, 1, third, 2.9, gain * 0.95);
      } else {
        chord("chords", b, 0, close, 3.9, gain);
        // Minor: the 7th joins on two, over the top of the stack.
        const seventh = ladder(h.colour, close.at(-1)! + 1, 1)[0]!;
        if (seventh - close.at(-1)! > 1)
          put("chords", b, 1, seventh, 2.9, gain * 0.9);
      }
    }
    if (chorusLike) {
      const isOver = part === "over";
      const stack = [...h.saw, ...(isOver ? [h.stab[1]!] : [])];
      const gain = part === "chorus" ? 0.58 : part === "return" ? 0.7 : 0.96;
      const land = b === landing;
      if (land) {
        chord("chords", b, 0, stack, 1.9, gain);
        chord(
          "chords",
          b,
          2,
          [...tonic.saw, ...tonic.stab],
          1.95,
          Math.min(1, gain * 1.08),
        );
      } else if (inPart % 4 === 3) {
        chord("chords", b, 0, stack, 1.9, gain);
        chord("chords", b, 2, stack, 0.9, gain * 0.92);
        chord("chords", b, 3, stack, 0.95, gain * 1.02);
      } else chord("chords", b, 0, stack, 3.8, gain);
      const beats =
        part === "chorus" && inPart < 4
          ? [1.5, 3.5]
          : inPart === 6
            ? [0.5, 1.5, 3.5]
            : [0.5, 1.5, 2.5, 3.5];
      for (const beat of beats)
        chord(
          "chords",
          b,
          beat,
          land && beat > 2 ? tonic.stab : h.stab,
          0.22,
          part === "chorus" ? 0.36 : isOver ? 0.56 : 0.44,
        );
    }
    if (part === "glitch") {
      const low = h.saw;
      if (inPart === 1) chord("chords", b, 2, low, 1.9, 0.56);
      if (inPart === 2) {
        stutter(
          "chords",
          b,
          0,
          8,
          1 / 8,
          [low[2]! + 12, low[3]! + 12],
          0.7,
          0.3,
        );
        chord("chords", b, 2, low, 1.9, 0.58);
      }
      if (inPart === 3) {
        stutter("chords", b, 0, 4, 0.25, [low[2]! + 12], 0.62, 0.4);
        stutter(
          "chords",
          b,
          1,
          8,
          1 / 8,
          [low[2]! + 12, low[2]! + 24],
          0.68,
          0.35,
        );
        chord("chords", b, 2, low, 1.95, 0.62);
      }
    }

    // ── chip arps ───────────────────────────────────────────────────────
    if (part === "boot" && inPart >= p.bars - 2) {
      const k = inPart - (p.bars - 2);
      arp("arp", b, h.lo, 0.45 + k * 0.15, ARP_UP);
      if (lastBar) arp("arp2", b, h.hi, 0.4, ARP_DOWN, 0.25);
    }
    if (chorusLike) {
      const phraseEnd = inPart % 4 === 3;
      const tones = inPart < 4 ? h.lo : h.hi;
      const gain = part === "chorus" ? 0.74 : part === "return" ? 0.9 : 1.24;
      if (b === landing) {
        arp("arp", b, tones, gain, ARP_DOWN.slice(0, 4));
        arp("arp", b, tonic.hi, gain, ARP_DOWN.slice(4), 2);
        arp("arp2", b, tones, gain * 0.9, ARP_UP.slice(0, 4), 0.25);
        arp("arp2", b, tonic.hi, gain * 0.95, ARP_UP.slice(4), 2.25);
      } else {
        arp("arp", b, tones, gain, phraseEnd ? ARP_DOWN : ARP_UP);
        if (part !== "chorus" || inPart >= 4)
          arp(
            "arp2",
            b,
            tones,
            gain * 0.9,
            phraseEnd ? ARP_UP : ARP_ROCK,
            0.25,
          );
      }
    }
    if (part === "glitch")
      arp(
        "arp",
        b,
        h.lo,
        0.5 - inPart * 0.06,
        inPart === 3 ? ARP_DOWN.slice(0, 6) : inPart % 2 ? ARP_DOWN : ARP_UP,
      );
    if (part === "lift2")
      arp("arp2", b, h.hi, 0.42 + inPart * 0.08, ARP_UP, 0.25);
    if (part === "bridge" && inPart >= 4)
      for (const [beat, index] of [
        [0.5, 3],
        [1.25, 2],
        [2, 1],
        [2.75, 2],
        [3.5, 3],
      ] as const)
        if (!lastBar || beat < 2.5)
          put(
            "spark",
            b,
            beat,
            h.keys[index]! + 24,
            0.5,
            0.26 + (inPart - 4) * 0.04,
          );

    // ── hook: the motif in the intro, answers in the verses, hockets in the chorus
    const motif = hookBars(leadOf(p, "hook") ?? "");
    const tune = hookBars(
      hookNames.includes("hook") ? "hook" : (hookNames[0] ?? ""),
    );
    if (part === "boot") {
      if (inPart % 2 === 0 && motif.length > 0)
        hook(b, motif[(inPart / 2) % motif.length]!, 0.72);
      else
        hook(
          b,
          climb(b, inPart === 1 ? 0 : 1).map(
            ([beat, pitch, length, velocity]) =>
              [beat - 1.5, pitch, length, velocity] as const,
          ),
          0.66,
        );
    }
    if (part === "verse" && (inPart === 5 || inPart === 7))
      hook(b, clear(b, climb(b, inPart === 5 ? 0 : 1)), 0.5);
    if (part === "verse2" && inPart % 2 === 1)
      hook(b, clear(b, counter(b, lastBar)), 0.95);
    if (part === "lift2" && inPart % 2 === 1) {
      const up = ladder(h.triad, base + 7, 3);
      const at = inPart === 1 ? 2 : 1.5;
      hook(
        b,
        clear(
          b,
          up.map(
            (pitch, k) =>
              [
                at + k * 0.5,
                pitch,
                k === 2 ? 0.9 : 0.22,
                0.56 + k * 0.03,
              ] as const,
          ),
        ),
        0.8,
      );
    }
    if (part === "lift" && inPart === 1) hook(b, clear(b, climb(b, 0)), 0.62);
    if (chorusLike && inPart % 2 === 1 && !lastBar) {
      const chip = hookBars(leadOf(p, "chip") ?? "");
      if (chip.length > 0)
        hook(
          b,
          clear(b, chip[((inPart - 1) / 2) % chip.length]!),
          part === "chorus" ? 0.9 : 1,
        );
      if (part === "over" && inPart === 3) {
        const [x, y] = ladder(h.colour, base + 16, 3);
        stutter("hook", b, 3.5, 4, 0.125, [x!, y! + 0], 0.7, 0.5);
      }
    }
    if (chorusLike && lastBar && tune.length > 0)
      hook(
        b,
        tune[0]!.map(
          ([beat, pitch, length, velocity]) =>
            [beat + 1, pitch, length, velocity] as const,
        ),
        part === "over" ? 1 : 0.85,
      );
    if (b === landing) {
      const up = ladder(h.colour, base + 21, 3);
      stutter(
        "hook",
        b,
        0,
        4,
        0.25,
        [up[0]!, up[0]!, up[1]!, up[2]!],
        0.5,
        0.78,
      );
    }
    if (b === BARS - 1 && tune.length > 0) hook(b, tune[0]!, 0.5);

    // ── chops: pitched fragments, beat repeats and stutters ───────────────
    const frag = ladder(h.colour, base + 15, 6);
    if (part === "boot" && inPart % 2 === 1)
      s.phrase(
        "chops",
        b,
        inPart === 1
          ? [
              [1.75, frag[0]!, 0.2, 0.5],
              [2.25, frag[2]!, 0.2, 0.52],
              [2.75, frag[4]!, 0.2, 0.56],
              [3.25, frag[2]!, 0.45, 0.5],
            ]
          : [
              [0.75, frag[0]!, 0.2, 0.52],
              [1.25, frag[4]!, 0.2, 0.56],
              [1.75, frag[1]!, 0.2, 0.5],
              [2.25, frag[2]!, 0.2, 0.54],
              [2.75, frag[4]!, 0.6, 0.58],
            ],
      );
    if (verseLike && inPart === 3)
      s.phrase("chops", b, [
        [2.5, frag[0]!, 0.25, 0.6],
        [3, frag[1]!, 0.25, 0.62],
        [3.5, frag[2]!, 0.25, 0.58],
      ]);
    if (verseLike && lastBar)
      roll(
        "chops",
        b,
        2,
        8,
        0.25,
        [0, 1, 1, 2, 2, 3, 4, 5].map((k) => frag[k]!),
        0.45,
        0.7,
      );
    if (liftLike && inPart === 3) {
      const r = from(h.triad[0]!, base + 17);
      stutter("chops", b, 2.5, 4, 0.125, [r, r + 7], 0.6, 0.7);
      stutter("chops", b, 3, 8, 1 / 16, [r, r + 7, r + 12, r + 7], 0.72, 0.3);
    }
    if (part === "glitch") {
      const g = from(tonic.triad[1]!, base + 14);
      if (inPart === 0) {
        stutter("chops", b, 0, 4, 0.25, [g, g + 7], 0.66, 0.5);
        stutter("chops", b, 2, 8, 0.125, [g + 12, g + 7, g, g + 12], 0.7, 0.35);
      }
      if (inPart === 1) {
        stutter("chops", b, 0.5, 6, 0.125, [g + 5, g], 0.55, 0.66);
        stutter(
          "chops",
          b,
          2.5,
          8,
          1 / 16,
          [g + 12, g + 12, g + 7, g + 7],
          0.72,
          0.3,
        );
      }
      if (inPart === 2) {
        stutter("chops", b, 0, 8, 0.125, [g, g + 7, g + 12, g + 7], 0.3, 0.72);
        stutter("chops", b, 2, 4, 0.25, [g + 12], 0.7, 0.4);
      }
      if (inPart === 3) {
        stutter("chops", b, 0, 16, 1 / 16, [g + 7, g + 12], 0.72, 0.25);
        stutter("chops", b, 1.5, 4, 0.125, [g, g - 5], 0.6, 0.3);
      }
    }
    if (chorusLike && lastBar) {
      const fallTones = ladder(h.colour, base + 13, 4).reverse();
      s.phrase("chops", b, [
        [2, fallTones[0]!, 0.25, 0.66],
        [2.5, fallTones[0]!, 0.25, 0.6],
        [2.75, fallTones[1]!, 0.25, 0.62],
        [3.25, fallTones[2]!, 0.22, 0.6],
      ]);
      if (part === "over") {
        const [x, y] = ladder(tonic.colour, top, 2);
        stutter("chops", b, 3.5, 4, 0.125, [x!, x!, y!, x!], 0.66, 0.42);
      }
    }
    if (part === "return" && inPart === 3) {
      const [x, y] = ladder(h.colour, base + 28, 2);
      s.phrase("chops", b, [
        [3.5, x!, 0.2, 0.58],
        [3.75, y!, 0.3, 0.62],
      ]);
    }
    if (part === "over" && (inPart === 3 || (inPart % 2 === 0 && inPart < 6))) {
      const [x, y] = ladder(h.colour, top, 2);
      if (inPart === 3)
        stutter("chops", b, 3.5, 4, 0.125, [x!, x!, y!, x!], 0.66, 0.42);
      else stutter("chops", b, 3.5, 4, 0.125, [x!, y!], 0.48, 0.32);
    }
    if (b === BARS - 1) {
      const t = ladder(tonic.triad, top, 1)[0]!;
      stutter(
        "chops",
        b,
        1.5,
        6,
        0.125,
        [t, stepDown(t, 2), stepDown(t, 4)],
        0.5,
        0.2,
      );
    }

    // ── sparkle ───────────────────────────────────────────────────────
    if (inPart === 0) put("spark", b, part === "boot" ? 0.5 : 0, top, 1.2, 0.6);
    if (b === 1) put("spark", b, 2.5, deg(12), 1, 0.42);
  }

  // The glitch break stutters the chorus's peak word down its scale.
  for (const g of placed.filter((p) => p.role === "glitch"))
    for (const [k, beat, count, step, down] of [
      [0, 0, 4, 0.25, 0],
      [0, 2, 6, 0.125, 0],
      [1, 1, 8, 1 / 16, 2],
      [2, 0, 3, 0.5, 3],
      [2, 2.5, 6, 0.125, 0],
      [3, 0, 8, 1 / 16, 0],
    ] as const) {
      const bar = g.start + k;
      const c = chordAt(bar, beat);
      let pitch = stepDown(peak, down);
      if (!c.colour.has(pc(pitch))) pitch = nearest(c.colour, pitch);
      stutter("vocal", bar, beat, count, step, [pitch], 0.88, 0.42, {
        lyric: peakWord,
      });
    }

  // Transitions: a tape tear closing each section, risers into the choruses.
  for (const p of placed) {
    const end = p.start + p.bars - 1;
    if (p.role === "boot" || p.role === "chorus" || p.role === "return")
      put("tear", end, 3, 60, 0.45, 0.78);
    if (p.role === "verse" || p.role === "verse2")
      put("tear", end, 3.5, 60, 0.45, 0.78);
    if (p.role === "bridge") {
      put("tear", end, 2.5, 60, 0.45, 0.78);
      put("tear", p.start + p.bars - 2, 2, 48, 5, 0.6);
    }
    if (p.role === "over") put("tear", end, 3, 60, 0.45, 0.78);
    if (p.role === "lift" || p.role === "lift2")
      put(
        "tear",
        p.start + p.bars - 2,
        2.75,
        48,
        5.2,
        p.role === "lift" ? 0.62 : 0.66,
      );
  }

  // The 808 lets go for the last beat of each pre-chorus so the chorus lands.
  for (const p of placed.filter(
    (q) => q.role === "lift" || q.role === "lift2",
  )) {
    const suck = (p.start + p.bars - 1) * BAR + 3 * TPB;
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i]!;
      if (
        n.trackId === "sub" &&
        n.startTick! < suck &&
        n.startTick! + n.durationTicks! > suck
      )
        s.notes[i] = { ...n, durationTicks: suck - n.startTick! };
    }
  }

  /** A tape stop: what rings into [lo, hi) dives an octave and is cut at hi. */
  const powerDown = (lo: number, hi: number, silent: boolean) => {
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i]!;
      const start = n.startTick!;
      if (start >= lo && start < hi) {
        if (silent) s.notes.splice(i, 1);
        continue;
      }
      if (start < lo && start + n.durationTicks! > lo) {
        const duration = Math.min(start + n.durationTicks!, hi) - start;
        const dive = Math.max(0, (duration - TPB) / duration);
        s.notes[i] = {
          ...n,
          durationTicks: duration,
          ...(["kick", "snap", "hats", "tear"].includes(n.trackId!)
            ? {}
            : {
                bend: [
                  { at: 0, cents: 0 },
                  ...(dive > 0 ? [{ at: dive, cents: 0 }] : []),
                  { at: 1, cents: -1200 },
                ],
              }),
        };
      }
    }
  };
  for (const g of placed.filter((p) => p.role === "glitch")) {
    const end = (g.start + g.bars) * BAR;
    powerDown(end - TPB, end, false);
  }
  // A silent beat before the last chorus: nothing starts or rings in it.
  if (over && over.start > 0)
    powerDown(over.start * BAR - TPB, over.start * BAR, true);
  return s.finish();
}

/** Candy Fault's automation, placed where this song's sections fall. */
function candyLanes(placed: readonly Placed[], bars: number) {
  const starts = (role: Role) =>
    placed.filter((p) => p.role === role).map((p) => p.start);
  const startOf = (role: Role) => starts(role)[0];
  const lifts = placed.filter((p) => p.role === "lift" || p.role === "lift2");
  const glitches = placed.filter((p) => p.role === "glitch");
  const over = placed.find((p) => p.role === "over");
  const ret = startOf("return");
  const HATS: Record<Role, number> = {
    boot: 0.86,
    verse: 0.86,
    lift: 0.86,
    chorus: 0.88,
    glitch: 0.7,
    verse2: 0.86,
    lift2: 0.86,
    return: 1,
    bridge: 1,
    over: 1,
    last: 0.86,
  };
  const PW: Partial<Record<Role, number>> = {
    boot: 0.22,
    chorus: 0.37,
    glitch: 0.18,
    verse2: 0.3,
    return: 0.28,
    over: 0.42,
    last: 0.12,
  };
  const byBar = <T>(list: readonly (readonly [number, T])[]) =>
    [...list].sort((a, b) => a[0] - b[0]);
  const stepsOf = (points: readonly (readonly [number, number])[]) =>
    steps(...byBar(points));
  const lanesOf = (points: readonly (readonly [number, number])[]) =>
    lanes(...byBar(points));
  // Throws on the last word of each line: the first pre-chorus line, every
  // chorus line and the bridge's first two.
  const throwBars: number[] = [];
  for (const p of placed) {
    const parts = p.lines.flatMap((q, i) => (q ? [i] : []));
    const pick =
      p.kind === "chorus"
        ? parts
        : p.kind === "pre"
          ? parts.slice(0, 1)
          : p.kind === "bridge"
            ? parts.slice(0, 2)
            : [];
    for (const i of pick)
      throwBars.push(p.start + i + partBars(p.lines[i]!, "candy") - 1);
  }
  const formant: AutomationPoint[] = [];
  for (const p of lifts) {
    const end = p.start + p.bars;
    formant.push(...lanes([end - 0.5, 2.5], [end - 0.05, 7], [end, 2.5]));
  }
  for (const g of glitches) {
    const a = g.start;
    formant.push(
      ...lanes(
        [a, 2.5],
        [a + 1, -2],
        [a + 2, 6],
        [a + 3, -1],
        [a + 3.9, 5],
        [a + 4, 2.5],
      ),
    );
  }
  if (over)
    formant.push(
      ...lanes(
        [over.start - 1, 2.5],
        [over.start - 0.4, 5.5],
        [over.start, 2.5],
      ),
    );
  formant.sort((a, b) => a.tick - b.tick);
  const crush = (rest: number, points: (g: number) => [number, number][]) =>
    lanesOf([
      [0, rest],
      ...glitches.flatMap((g) => points(g.start)),
      [bars, rest],
    ]);
  return {
    hatsVolume: stepsOf(placed.map((p) => [p.start, HATS[p.role]] as const)),
    hookPw: lanesOf([
      [0, 0.22],
      ...placed.flatMap((p) =>
        PW[p.role] !== undefined && p.start > 0
          ? [[p.start, PW[p.role]!] as const]
          : [],
      ),
      [bars, 0.3],
    ]),
    chordsVolume: stepsOf([
      [0, 0.8],
      ...(ret !== undefined ? [[ret, 0.9] as const] : []),
      ...(over ? [[over.start, 0.8] as const] : []),
    ]),
    chordsLpf: lanesOf([
      [0, 5200],
      ...lifts.flatMap((p, i) => [
        [p.start, 900] as const,
        [p.start + p.bars - 0.1, i === 0 ? 5200 : 5600] as const,
      ]),
      ...(over ? [[over.start, 6400] as const] : []),
      [bars, 6400],
    ]),
    chordsDetune: lanesOf([
      [0, 0.26],
      ...(ret !== undefined ? [[ret, 0.32] as const] : []),
      ...(over
        ? [
            [over.start, 0.4] as const,
            [over.start + over.bars - 0.5, 0.85] as const,
            [over.start + over.bars, 0.3] as const,
          ]
        : []),
    ]),
    chordsCrushBits: sweeps(
      16,
      3,
      lifts.map((p) => p.start + p.bars - 1),
      0.25,
      1,
    ),
    chordsCrushMix: sweeps(
      0,
      0.85,
      lifts.map((p) => p.start + p.bars - 1),
      0.25,
      1,
    ),
    arpVolume: stepsOf([
      [0, 0.82],
      ...(ret !== undefined ? [[ret, 0.9] as const] : []),
      ...(over ? [[over.start, 1] as const] : []),
    ]),
    arpCrushBits: crush(16, (a) => [
      [a, 12],
      [a + 3.9, 4],
      [a + 4, 16],
    ]),
    arpCrushMix: crush(0, (a) => [
      [a, 0.5],
      [a + 3.9, 0.9],
      [a + 4, 0],
    ]),
    arp2Volume: stepsOf([
      [0, 0.85],
      ...(over ? [[over.start, 1] as const] : []),
    ]),
    vocalThrows: throws(throwBars, 0.07, 0.34),
    vocalFormant: formant.length > 0 ? formant : lanes([0, 2.5]),
    vocalCrushMix: crush(0, (a) => [
      [a, 0.2],
      [a + 2, 0.6],
      [a + 3.9, 0.7],
      [a + 4, 0],
    ]),
    vocalCrushBits: crush(16, (a) => [
      [a, 10],
      [a + 3.9, 5],
      [a + 4, 16],
    ]),
  };
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "song"
  );
}
