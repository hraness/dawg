/**
 * The distiller: a hand-written hyperpop demo's plan as a song sheet. The
 * examples a small model learns from are the large model's demos read back
 * through this, so they always say exactly what the demos play (less the
 * recorded words, which a sheet cannot ask for).
 */
import type { Book, Chord, Part, SongSection } from "../../demos/hyperpop.ts";
import type { Phrase } from "../../demos/build.ts";
import * as candyDemo from "../../demos/candy-fault.ts";
import * as glassDemo from "../../demos/glass-garden.ts";
import * as nightDemo from "../../demos/redline.ts";
import { PATTERN_SLOTS, patternName } from "./library.ts";
import {
  numeralFor,
  parseKey,
  type Key,
  type Palette,
  type SheetHook,
  type SheetLine,
  type SheetNote,
  type SheetPart,
  type SheetSection,
  type SongSheet,
} from "./sheet.ts";

type Hook = readonly (readonly (readonly [number, number, number])[])[];

/** A demo built on the hyperpop engine, read back from its plan. */
export type EngineSource = Readonly<{
  title: string;
  bpm: number;
  key: string;
  palette: Palette;
  book: Book;
  sections: readonly SongSection[];
  hooks: Readonly<Record<string, Hook>>;
}>;
/** A demo with a build of its own, whose sheet is written out by hand. */
export type BuiltSource = Readonly<{
  title: string;
  palette: Palette;
  build: () => Extracted;
}>;
export type DemoSource = EngineSource | BuiltSource;

export const DEMO_SOURCES: readonly DemoSource[] = [
  {
    title: "Redline",
    bpm: nightDemo.BPM,
    key: "F minor",
    palette: "night",
    book: nightDemo.BOOK,
    sections: nightDemo.SECTIONS,
    hooks: { hook: nightDemo.HOOK },
  },
  {
    title: "Glass Garden",
    bpm: glassDemo.BPM,
    key: "A major",
    palette: "glass",
    book: glassDemo.BOOK,
    sections: glassDemo.SECTIONS,
    hooks: { hook: glassDemo.HOOK, answer: glassDemo.ANSWER },
  },
  { title: "Candy Fault", palette: "candy", build: candySheet },
];

/** A scale pitch as a degree (1 the tonic at key.base); off-scale snaps down. */
export function pitchDegree(key: Key, pitch: number): number {
  for (let p = pitch; p > pitch - 12; p--) {
    const rel = p - key.base;
    const octave = Math.floor(rel / 12);
    const index = key.steps.indexOf(rel - 12 * octave);
    if (index >= 0) return index + 1 + 7 * octave;
  }
  return 1;
}

function chordNumeral(key: Key, chord: Chord): string {
  const pc = chord.bass % 12;
  const index = key.steps.findIndex((step) => (key.tonic + step) % 12 === pc);
  if (index < 0)
    throw new Error(`extract: bass ${chord.bass} is off the scale`);
  return numeralFor(key, index + 1);
}

const sheetLine = (key: Key, book: Book, part: Part): SheetLine =>
  book.melody[part].map(
    ([beat, pitch, len, lyric]) =>
      [beat, pitchDegree(key, pitch), len, lyric] as const,
  );

const hookSheet = (key: Key, hook: Hook): SheetHook =>
  hook.map((bar) =>
    bar.map(
      ([beat, pitch, beats]) => [beat, pitchDegree(key, pitch), beats] as const,
    ),
  );

/** Split a lead (hooks laid end to end) back into hook names. */
function leadNames(
  lead: NonNullable<SongSection["lead"]>,
  hooks: Readonly<Record<string, Hook>>,
): string[] | undefined {
  const names: string[] = [];
  let at = 0;
  while (at < lead.length) {
    const match = Object.entries(hooks).find(
      ([, hook]) =>
        at + hook.length <= lead.length &&
        hook.every((bar, i) => lead[at + i] === bar),
    );
    if (!match) return undefined;
    names.push(match[0]);
    at += match[1].length;
  }
  return names;
}

export type Extracted = Readonly<{ sheet: SongSheet; notes: string[] }>;

/** A demo plan as a sheet, with notes on anything the sheet cannot say. */
export function extractSheet(source: DemoSource): Extracted {
  if ("build" in source) return source.build();
  const key = parseKey(source.key)!;
  const notes: string[] = [];
  const progressions: Record<string, string[]> = {};
  const progressionName = (chords: readonly Chord[], kind: string) => {
    const numerals = chords.map((c) => chordNumeral(key, c));
    for (const [name, list] of Object.entries(progressions))
      if (list.join(" ") === numerals.join(" ")) return name;
    let name = kind;
    for (let n = 2; progressions[name]; n++) name = `${kind}${n}`;
    progressions[name] = numerals;
    return name;
  };
  const parts = new Set<Part>();
  const sections: SheetSection[] = source.sections.map((section) => {
    const where = section.name;
    const enter: Record<string, number> = {};
    const out: Record<string, unknown> = {
      kind: section.kind,
      name: section.name,
      bars: section.bars,
      chords: progressionName(section.chords, section.kind),
      drums: section.drums,
      ...(section.energy !== undefined ? { energy: section.energy } : {}),
      play: section.play.filter((layer) => layer !== "double"),
    };
    if (section.lines) {
      out.lines = section.lines;
      for (const part of section.lines) if (part) parts.add(part);
    }
    for (const slot of PATTERN_SLOTS) {
      const cells = section[slot];
      if (!cells) continue;
      const found = patternName(slot, cells);
      if (!found) {
        notes.push(`${where}: its ${slot} is not a library pattern`);
        continue;
      }
      out[slot] = found.name;
      if (found.enter > 0) enter[slot === "line" ? "sub" : slot] = found.enter;
    }
    if (section.lead) {
      const names = leadNames(section.lead, source.hooks);
      if (names) out.lead = names;
      else notes.push(`${where}: its lead is not made of named hooks`);
    }
    if (section.voiceLead) out.voiceLead = true;
    if (section.bursts) out.bursts = true;
    if (section.thirds)
      notes.push(`${where}: thirds become the compiled chord-tone harmony`);
    if (section.transpose) notes.push(`${where}: a sheet never transposes`);
    if (Object.keys(enter).length > 0) out.enter = enter;
    return out as SheetSection;
  });
  const lines: Partial<Record<Part, SheetLine>> = {};
  for (const part of parts) lines[part] = sheetLine(key, source.book, part);
  const hooks: Record<string, SheetHook> = {};
  for (const [name, hook] of Object.entries(source.hooks))
    if (sections.some((s) => s.lead?.includes(name)))
      hooks[name] = hookSheet(key, hook);
  return {
    sheet: {
      title: source.title,
      bpm: source.bpm,
      key: source.key,
      palette: source.palette,
      progressions,
      lines,
      ...(Object.keys(hooks).length > 0 ? { hooks } : {}),
      sections,
    },
    notes,
  };
}

/**
 * Candy Fault as a candy-palette sheet. Its topline is written as lines at
 * absolute bars; each section's lines become two-bar parts, and a word sung
 * on the last half-beat of a part is the next part's pickup. What a sheet
 * cannot say: the bVII under verse two (it sings over V here), the half-step
 * lift into the last chorus, and the hand-placed harmony and answers, which
 * the candy compiler derives from the chords.
 */
export function candySheet(): Extracted {
  const key = parseKey("E major")!;
  const c = candyDemo;
  const notesOf = (line: candyDemo.Line, start: number, bars: number) => {
    const out: SheetNote[] = [];
    for (const [bar, phrase] of line)
      for (const [beat, pitch, length, , lyric] of phrase) {
        let at = (bar - start) * 4 + beat;
        // A pickup into the next part.
        if (at >= bars * 4 - 0.5) continue;
        if (at < -1) continue;
        out.push([at, pitchDegree(key, pitch), length, lyric ?? ""]);
      }
    return out.sort((a, b) => a[0] - b[0]);
  };
  /** Cut a line into two-bar parts starting at `start`. */
  const cut = (
    line: candyDemo.Line,
    start: number,
    names: readonly SheetPart[],
  ) =>
    Object.fromEntries(
      names.map((name, i) => [name, notesOf(line, start + 2 * i, 2)]),
    );
  const verseTwo = c.withWords(
    28,
    [...c.VERSE_SLOTS, ...c.VERSE_END_V],
    c.syllables(c.VERSE_TWO_WORDS),
  );
  const chorusTwo = c.CHORUS_TWO;
  const lines: Partial<Record<SheetPart, SheetLine>> = {
    ...cut(c.VERSE_ONE, 4, ["v1", "v2", "v3", "v4"]),
    ...cut(verseTwo, 28, ["v5", "v6", "v7", "v8"]),
    ...cut(c.lift(12), 12, ["pre1", "pre2"]),
    ...cut(c.CHORUS_ONE, 16, ["ch1", "ch2", "ch3", "ch4"]),
    ...cut(chorusTwo, 42, ["ch5"]),
    ...cut(chorusTwo, 46, ["ch6"]),
    ...cut(c.BRIDGE, 48, ["br1", "br2", "br3", "br4"]),
    ...cut(c.LAST, 64, ["end1", "end2"]),
  };
  const hookOf = (phrase: Phrase): SheetHook => [
    phrase.map(
      ([beat, pitch, length]) =>
        [beat, pitchDegree(key, pitch), length] as const,
    ),
  ];
  const chorus = ["ch1", null, "ch2", null, "ch3", null, "ch4", null] as const;
  const section = (
    kind: SheetSection["kind"],
    name: string,
    bars: number,
    chords: string,
    lines?: readonly (SheetPart | null)[],
    lead?: readonly string[],
  ): SheetSection => ({
    kind,
    name,
    bars,
    chords,
    drums: [],
    play: [],
    ...(lines ? { lines } : {}),
    ...(lead ? { lead } : {}),
  });
  return {
    sheet: {
      title: "Candy Fault",
      bpm: 156,
      key: "E major",
      palette: "candy",
      progressions: {
        intro: ["I", "I", "IV", "V"],
        verse: ["vi", "vi", "IV", "IV", "I", "I", "V", "V"],
        pre: ["IV", "V", "vi", "V"],
        chorus: ["I", "V", "vi", "IV"],
        break: ["I", "I", "IV", "V"],
        bridge: ["I", "V6", "vi", "V", "IV", "I6", "ii", "V"],
        outro: ["I", "V", "IV", "I"],
      },
      lines,
      hooks: {
        hook: hookOf(c.MOTIF),
        chip: [...hookOf(c.CHIP.B!), ...hookOf(c.CHIP.A!)],
      },
      sections: [
        section("intro", "Boot", 4, "intro", undefined, ["hook"]),
        section("verse", "Verse 1", 8, "verse", [
          "v1",
          null,
          "v2",
          null,
          "v3",
          null,
          "v4",
          null,
        ]),
        section("pre", "Pre 1", 4, "pre", ["pre1", null, "pre2", null]),
        section("chorus", "Chorus 1", 8, "chorus", chorus, ["chip"]),
        section("break", "Glitch", 4, "break"),
        section("verse", "Verse 2", 8, "verse", [
          "v5",
          null,
          "v6",
          null,
          "v7",
          null,
          "v8",
          null,
        ]),
        section("pre", "Pre 2", 4, "pre", ["pre1", null, "pre2", null]),
        section(
          "chorus",
          "Chorus 2",
          8,
          "chorus",
          ["ch1", null, "ch5", null, "ch3", null, "ch6", null],
          ["chip"],
        ),
        section("bridge", "Bridge", 8, "bridge", [
          "br1",
          null,
          "br2",
          null,
          "br3",
          null,
          "br4",
          null,
        ]),
        section("chorus", "Overload", 8, "chorus", chorus, ["chip"]),
        section("outro", "Shutdown", 4, "outro", ["end1", null, "end2", null]),
      ],
    },
    notes: [],
  };
}
