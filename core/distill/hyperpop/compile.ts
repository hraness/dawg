/**
 * Render a song sheet into a score through the hyperpop engine. writeSong
 * lays out the sections; the post pass then applies what every demo does by
 * hand, so a sheet only has to say what is particular to its song:
 *
 * - the synth singer leads; on the night palette a vocoder sings each line
 *   back over two chord tones under it
 * - a backing singer one chord tone under every chorus note
 * - chopped syllable chants down and up the chord in every drop
 * - glitch answers between the lines of later verses
 * - a hum of the chorus in a long intro, a stutter at the end of a break
 * - a breath before the last chorus, a falling pad in the outro
 * - delay throws on line ends, the singer and chops riding each section,
 *   the pad's filter opening into choruses, a riser over every build
 * - the voice bank's fixed-pitch syllables retuned to the song's chords
 */
import type { TrackScore } from "../../score.ts";
import { Composer } from "../../demos/build.ts";
import * as glassDemo from "../../demos/glass-garden.ts";
import * as nightDemo from "../../demos/redline.ts";
import {
  dropout,
  flick,
  glitch,
  kitTracks,
  ladder,
  patch,
  ramps,
  riserLane,
  singPart,
  singStutter,
  slot,
  steps,
  throws,
  trackOf,
  writeSong,
  type Book,
  type Chord,
  type KitOptions,
  type Part,
  type Song,
  type SongSection,
  type Sung,
} from "../../demos/hyperpop.ts";
import { demoInfo } from "../../demos/types.ts";
import { compileCandy } from "./candy.ts";
import { LIBRARY } from "./library.ts";
import {
  chordClasses,
  degreePitch,
  isInversion,
  numeralDegree,
  parseKey,
  scaleOf,
  type Key,
  type Palette,
  type SheetLine,
  type SongSheet,
} from "./sheet.ts";

const TPB = 480;
const BAR = TPB * 4;

type PaletteKit = Readonly<{
  book: Book;
  kit: Omit<KitOptions, "bpm">;
  vocoder: boolean;
  /** The chops' formant shift in the drops. */
  dropFormant: number;
  features: readonly string[];
}>;

// The singer leads a generated song (there are no recorded words to sit
// under it), so it comes up and takes the duck the recorded vocal had.
const leadDuck = {
  duck: { orbit: 2, depth: 0.3, attack: 0.5, onset: 0.06, hold: true },
};

const PALETTE_KITS: Readonly<Record<Exclude<Palette, "candy">, PaletteKit>> = {
  night: {
    book: nightDemo.BOOK,
    kit: {
      ...nightDemo.KIT,
      levels: { ...nightDemo.KIT.levels, sing: 0.5, harm: 0.3, vox: 0 },
      extra: {
        ...nightDemo.KIT.extra,
        sing: {
          ...nightDemo.KIT.extra?.sing,
          fx: {
            crush: { bits: 16, coarse: 1, mix: 0 },
            eq: { mid: 2, midfreq: 3000, high: 3, highfreq: 9000 },
            compressor: {
              threshold: -20,
              ratio: 3,
              attack: 0.006,
              release: 0.12,
              makeup: 2,
            },
            ...leadDuck,
          },
        },
      },
    },
    vocoder: true,
    dropFormant: -3,
    features: [
      "a synth singer on every line, a vocoder singing it back as chord stacks",
      "a backing singer a chord tone under every chorus note",
      "syllable ostinatos and chopped chants in the drops",
      "breakbeats and a rolling reese under the drops",
    ],
  },
  glass: {
    book: glassDemo.BOOK,
    kit: {
      ...glassDemo.KIT,
      levels: { ...glassDemo.KIT.levels, sing: 0.45, vox: 0 },
    },
    vocoder: false,
    dropFormant: 3,
    features: [
      "a glassy synth singer on every line",
      "a backing singer a chord tone under every chorus note",
      "syllable arps blooming through the chord after the lines",
      "FM bells and an offbeat octave bass",
    ],
  },
};

/** Cents folded by octaves into the sampler's ±1200 reach. */
const fold = (cents: number) =>
  cents > 1200
    ? cents - 1200 * Math.ceil((cents - 1200) / 1200)
    : cents < -1200
      ? cents + 1200 * Math.ceil((-1200 - cents) / 1200)
      : cents;

const partBars = (part: Part) => (part.startsWith("ch") ? 2 : 1);

/** Chord tones under `pitch`, nearest first, at least a minor third down. */
function under(chord: Chord, pitch: number, count: number): number[] {
  const pcs = new Set(chord.tones.map((t) => t % 12));
  const out: number[] = [];
  for (let p = pitch - 3; p > pitch - 15 && out.length < count; p--)
    if (pcs.has(p % 12)) out.push(p);
  return out;
}

/** The chord tone nearest `pitch` (ties go down). */
function nearestTone(chord: Chord, pitch: number): number {
  const pcs = new Set(chord.tones.map((t) => t % 12));
  for (let d = 0; d < 12; d++) {
    if (pcs.has((((pitch - d) % 12) + 12) % 12)) return pitch - d;
    if (pcs.has((pitch + d) % 12)) return pitch + d;
  }
  return pitch;
}

/** Voice a progression: each chord's tones in 53..72, nearest the last chord. */
export function voiceProgression(
  key: Key,
  numerals: readonly string[],
): Chord[] {
  let center = 62;
  return numerals.map((numeral) => {
    const degree = numeralDegree(numeral)!;
    const pcs = chordClasses(key, degree);
    const tones = pcs
      .map((pc) => {
        let best = 53 + ((pc - 53 + 120) % 12);
        for (let p = best; p <= 72; p += 12)
          if (Math.abs(p - center) < Math.abs(best - center)) best = p;
        return best;
      })
      .sort((a, b) => a - b);
    center = tones.reduce((a, b) => a + b, 0) / tones.length;
    // A first inversion (V6) puts the chord's 3rd in the bass.
    const root = pcs[isInversion(numeral) ? 2 : 0]!;
    const bass = 36 + ((root - 36 + 120) % 12);
    return { bass, tones };
  });
}

/** A sheet line as the engine's sung notes. */
const sungFor = (key: Key, line: SheetLine): Sung[] =>
  line.map(
    ([beat, degree, beats, syllable]) =>
      [beat, degreePitch(key, degree), beats, syllable] as const,
  );

/** Cells for a section: rests until the layer enters, then the pattern cycling. */
function cellsFor(
  pattern: readonly (string | null)[] | undefined,
  bars: number,
  enter = 0,
): readonly (string | null)[] | undefined {
  if (!pattern) return undefined;
  if (enter === 0) return pattern;
  return Array.from({ length: bars }, (_, i) =>
    i < enter ? null : pattern[(i - enter) % pattern.length]!,
  );
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

/** Lay a sheet out as engine sections. */
/**
 * The drum energy a section gets when the sheet leaves it out, from the
 * demos: verses sit back so the chorus and drop arrive.
 */
const USUAL_ENERGY: Partial<Record<SongSection["kind"], number>> = {
  intro: 0.8,
  verse: 0.85,
  pre: 0.9,
  build: 0.9,
};

export function planSections(sheet: SongSheet, key: Key): SongSection[] {
  const voiced = Object.fromEntries(
    Object.entries(sheet.progressions).map(([name, list]) => [
      name,
      voiceProgression(key, list),
    ]),
  );
  // Only the night and glass palettes reach the engine, so every kind and
  // part here is one it knows.
  return sheet.sections.map((section) => {
    const kind = section.kind as SongSection["kind"];
    const enter = section.enter ?? {};
    const pick = (slot: keyof typeof LIBRARY, layer: keyof typeof enter) => {
      const name = section[slot];
      const cells = name ? LIBRARY[slot][name]?.cells : undefined;
      return cellsFor(cells, section.bars, enter[layer] ?? 0);
    };
    const lead = section.lead?.flatMap((name) =>
      (sheet.hooks?.[name] ?? []).map((bar) =>
        bar.map(
          ([beat, degree, beats]) =>
            [beat, degreePitch(key, degree), beats] as const,
        ),
      ),
    );
    const line = pick("line", "sub");
    return {
      kind,
      name: section.name,
      bars: section.bars,
      chords: voiced[section.chords]!,
      drums: section.drums,
      ...((section.energy ?? USUAL_ENERGY[kind]) !== undefined
        ? { energy: section.energy ?? USUAL_ENERGY[kind] }
        : {}),
      play: section.play,
      ...(section.lines
        ? { lines: section.lines as SongSection["lines"] }
        : {}),
      ...(pick("riff", "riff") ? { riff: pick("riff", "riff") } : {}),
      ...(pick("arp", "arp") ? { arp: pick("arp", "arp") } : {}),
      ...(pick("bells", "bells") ? { bells: pick("bells", "bells") } : {}),
      ...(pick("stabs", "stabs") ? { stabs: pick("stabs", "stabs") } : {}),
      // Chorus stabs lift an octave, clear above the singer.
      ...(section.kind === "chorus" ? { stabShift: 12 } : {}),
      ...(line ? { line } : {}),
      ...(lead && lead.length > 0 ? { lead } : {}),
      ...(section.voiceLead ? { voiceLead: true } : {}),
      ...(section.bursts ? { bursts: true } : {}),
    };
  });
}

/** Render a validated sheet. */
export function compileSheet(sheet: SongSheet): TrackScore {
  const key = parseKey(sheet.key);
  if (!key) throw new Error(`hyperpop sheet: bad key "${sheet.key}"`);
  if (sheet.palette === "candy") return compileCandy(sheet, key);
  const palette = PALETTE_KITS[sheet.palette];
  const melody = Object.fromEntries(
    Object.keys(sheet.lines).map((part) => [
      part,
      sungFor(key, sheet.lines[part as Part]!),
    ]),
  ) as Record<Part, Sung[]>;
  const ends = Object.fromEntries(
    Object.entries(melody).map(([part, notes]) => [part, notes.at(-1)![0]]),
  ) as Record<Part, number>;
  const book: Book = {
    ...palette.book,
    melody: { ...palette.book.melody, ...melody },
    ends: { ...palette.book.ends, ...ends },
  };
  const sections = planSections(sheet, key);
  const bars = sections.reduce((n, s) => n + s.bars, 0);
  const firstChorus = (() => {
    let bar = 0;
    for (const s of sections) {
      if (s.kind === "chorus") return bar;
      bar += s.bars;
    }
    return 0;
  })();
  const s = new Composer(
    demoInfo({
      id: slug(sheet.title),
      title: sheet.title,
      style: "Hyperpop",
      description: `Hyperpop in ${sheet.key} at ${sheet.bpm}, written as a song sheet on the ${sheet.palette} palette.`,
      tempoBpm: sheet.bpm,
      key: key.label,
      bars,
      highlightBar: firstChorus,
      trackId: "chops",
      features: palette.features,
      arrangement: sections.map((p) => `${p.name} ${p.bars}`),
      mixNotes: [
        "the synth singer leads; the bed ducks about 3 dB while a line sings",
        "chorus stabs sit an octave above the singer",
        "delay throws open on the last word of every line",
      ],
    }),
  );
  kitTracks(s, book, { bpm: sheet.bpm, ...palette.kit });
  if (palette.vocoder) s.track(nightDemo.vocoderTrack("sing"));
  const song = writeSong(s, { book, scale: scaleOf(key), sections });
  postPass(s, song, book, palette, melody);
  return s.finish();
}

function postPass(
  s: Composer,
  song: Song,
  book: Book,
  palette: PaletteKit,
  melody: Readonly<Record<Part, readonly Sung[]>>,
): void {
  const { placed, chordAt } = song;
  const bars = placed.reduce((n, p) => n + p.bars, 0);
  const of = (kind: string) => placed.filter((p) => p.kind === kind);
  const sounding = (p: (typeof placed)[number], i: number) =>
    (p.lines ?? []).some((q, j) => q !== null && j <= i && i < j + partBars(q));

  // The harmony guard: a sung note on a whole beat a semitone from a tone of
  // its bar's chord moves onto the chord, so no sheet holds a minor-second
  // rub against the bed where it is heard most. Sixths and ninths stay.
  const guard = (bar: number, beat: number, pitch: number) => {
    if (beat % 1 !== 0) return pitch;
    const chord = chordAt(bar + Math.floor(beat / 4));
    const pcs = new Set(chord.tones.map((t) => t % 12));
    const rubs =
      !pcs.has(pitch % 12) &&
      (pcs.has((pitch + 1) % 12) || pcs.has((pitch + 11) % 12));
    return rubs ? nearestTone(chord, pitch) : pitch;
  };

  // Lines: the vocoder sings each one back over two chord tones held under
  // its lowest note; chorus notes get the backing singer a chord tone under.
  for (const p of placed)
    (p.lines ?? []).forEach((part, i) => {
      if (!part) return;
      const bar = p.start + i;
      const notes = melody[part].map(
        ([beat, pitch, beats, lyric]) =>
          [beat, guard(bar, beat, pitch), beats, lyric] as const,
      );
      if (palette.vocoder)
        for (let b = 0; b < partBars(part); b++) {
          const sung = notes.filter(([beat]) => Math.floor(beat / 4) === b);
          if (sung.length === 0) continue;
          const low = Math.min(...sung.map(([, pitch]) => pitch));
          const from = sung[0]![0];
          const to = Math.min(
            (b + 1) * 4,
            Math.max(...sung.map(([beat, , beats]) => beat + beats)),
          );
          for (const pitch of under(chordAt(bar + b), low, 2))
            s.note("voc", bar, from, pitch, to - from, 0.55);
        }
      for (const [beat, pitch, beats, lyric] of notes) {
        if (palette.vocoder) s.note("voc", bar, beat, pitch, beats, 0.62);
        if (p.kind === "chorus" && beats >= 0.45) {
          const below = under(chordAt(bar + Math.floor(beat / 4)), pitch, 1)[0];
          if (below !== undefined)
            s.note("harm", bar, beat, below, beats, 0.6, { lyric });
        }
      }
    });

  // A long, wordless intro hums the chorus's first line.
  const intro = placed[0];
  const hook = placed.find((p) => p.kind === "chorus")?.lines?.find(Boolean);
  if (
    intro?.kind === "intro" &&
    intro.bars >= 8 &&
    hook &&
    !intro.lines?.some(Boolean)
  )
    singPart(
      s,
      intro.start + 4,
      melody[hook].map(([b, pitch, l]) => [b, pitch, l, "ooh"] as const),
      { velocity: 0.45 },
    );

  // Drops: the first syllable chopped in 32nds down the chord, the third
  // climbing it in sixteenths into the turn.
  const [first, , third] = book.syllables;
  for (const p of of("post")) {
    if (p.bars < 4) continue;
    const tones = (bar: number) =>
      ladder(chordAt(bar), book.root - 12, book.root + 12)
        .filter((t) => t <= book.root + 7)
        .slice(-4)
        .reverse();
    const down = tones(p.start + 3);
    if (down.length >= 3)
      [0, 0, 1, 1, 2, 2, 1, 1].forEach((r, k) =>
        s.note(
          "stut",
          p.start + 3,
          3 + k * 0.125,
          song.stut(`s_${first}`),
          0.11,
          0.72 - k * 0.035,
          { cents: fold((down[r]! - book.root) * 100) },
        ),
      );
    if (p.bars >= 8) {
      const up = tones(p.start + 7).reverse();
      if (up.length >= 4)
        [0, 0, 1, 0, 1, 2, 1, 3].forEach((r, k) =>
          s.note(
            "stut",
            p.start + 7,
            2 + k * 0.25,
            song.stut(`s_${third}`),
            0.22,
            0.45 + k * 0.05,
            { cents: fold((up[r]! - book.root) * 100) },
          ),
        );
    }
  }

  // Later verses answer on the glitch track in bars where nothing sings.
  of("verse")
    .slice(1)
    .forEach((p) => {
      const answers = ["4.4.5.6.4.4.2...", "6.5.4.2.6.5.4..."];
      for (let i = 3; i < p.bars; i += 4)
        if (!sounding(p, i))
          glitch(s, song, book, p.start + i, answers[(i >> 2) % 2]!, [
            book.syllables[(i >> 2) % 2 ? 2 : 0]!,
            book.syllables[(i >> 2) % 2 ? 3 : 1]!,
          ]);
    });

  // A break ends on the singer stuttering the chord's top tones.
  for (const p of of("break")) {
    const bar = p.start + p.bars - 1;
    if (p.bars < 2 || sounding(p, p.bars - 1)) continue;
    const top = ladder(chordAt(bar), 72, 86).slice(-4);
    if (top.length >= 3)
      singStutter(
        s,
        bar,
        0,
        8,
        0.5,
        [top[2]!, top[0]!, top[2]!, top.at(-1)!],
        "ah",
        0.4,
        0.65,
      );
  }

  // One silent beat before the last chorus.
  const choruses = of("chorus");
  const last = choruses.at(-1);
  if (last && last.start > 0 && choruses.length > 1)
    dropout(s, last.start - 1, 3, 1, [
      "kick",
      "snare",
      "hats",
      "sub",
      "pad",
      "arp",
      "chops",
      "stabs",
    ]);
  // The outro's pad falls away.
  const outro = of("outro").at(-1);
  if (outro && outro.bars >= 4)
    s.note(
      "pad",
      outro.start + outro.bars - 2,
      0,
      chordAt(outro.start).tones[0]!,
      8,
      0.4,
      flick.dive(-1200, 0.5),
    );

  // The voice bank's reversed syllables and chorus heads were recorded at
  // fixed pitches; retune each to the chord tone nearest it.
  const stut = trackOf(s, "stut");
  const fixed = new Map<number, number>();
  for (const name of book.syllables)
    fixed.set(slot(stut, `r_${name}`), book.root);
  for (const part of ["ch1", "ch2", "ch3"] as const)
    fixed.set(slot(stut, `h_${part}`), palette.book.melody[part][0]![1]);
  s.notes.forEach((note, i) => {
    if (note.trackId !== "stut") return;
    const pitch = fixed.get(note.pitch);
    if (pitch === undefined) return;
    const end = (note.startTick ?? 0) + (note.durationTicks ?? 0);
    const bar = Math.min(bars - 1, Math.floor(Math.max(0, end - 1) / BAR));
    const shift = nearestTone(chordAt(bar), pitch) - pitch;
    if (shift !== 0)
      s.notes[i] = { ...note, cents: fold((note.cents ?? 0) + shift * 100) };
  });

  // The guard on what the singer actually sings (lines, the intro hum).
  s.notes.forEach((note, i) => {
    if (note.trackId !== "sing") return;
    const tick = note.startTick ?? 0;
    const pitch = guard(Math.floor(tick / BAR), (tick % BAR) / TPB, note.pitch);
    if (pitch !== note.pitch) s.notes[i] = { ...note, pitch };
  });

  // ---------------------------------------------------------- lanes
  const level = (by: Readonly<Record<string, number>>, fallback: number) =>
    placed.map((p) => [p.start, by[p.kind] ?? fallback] as const);
  for (const id of palette.vocoder ? ["sing", "voc"] : ["sing"])
    patch(s, id, { delayMixAutomation: throws(song.throwsAt, 0.06, 0.38, 1) });
  patch(s, "sing", {
    volumeAutomation: steps(
      ...level({ verse: 0.75, pre: 0.85, chorus: 1, break: 0.85 }, 0.8),
    ),
  });
  patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
  patch(s, "chops", {
    volumeAutomation: steps(
      ...level({ verse: 0.55, pre: 0.75, chorus: 0.7, post: 1, build: 1 }, 0.8),
    ),
    fxAutomation: {
      "formant-shift": steps(
        ...placed.map(
          (p) =>
            [p.start, p.kind === "post" ? palette.dropFormant : 0] as const,
        ),
      ),
    },
  });
  const cutoff: Readonly<Record<string, number>> = {
    intro: 900,
    verse: 1300,
    pre: 1500,
    chorus: 3200,
    post: 1600,
    break: 2000,
    build: 1000,
    outro: 1400,
  };
  patch(s, "pad", {
    filterAutomation: ramps(
      ...placed.flatMap((p) => {
        const at = cutoff[p.kind] ?? 1400;
        // Builds and pre-choruses open up toward the chorus.
        return p.kind === "build" || p.kind === "pre"
          ? [
              [p.start, at] as const,
              [p.start + p.bars - 0.01, at * 2.6] as const,
            ]
          : [[p.start, at] as const];
      }),
      [bars, 500],
    ),
  });
}
