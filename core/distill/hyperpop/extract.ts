/**
 * The distiller: a hand-written hyperpop demo's plan as a song sheet. The
 * examples a small model learns from are the large model's demos read back
 * through this, so they always say exactly what the demos play (less the
 * recorded words, which a sheet cannot ask for).
 */
import type { Book, Chord, Part, SongSection } from "../../demos/hyperpop.ts";
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
  type SheetSection,
  type SongSheet,
} from "./sheet.ts";

type Hook = readonly (readonly (readonly [number, number, number])[])[];

export type DemoSource = Readonly<{
  title: string;
  bpm: number;
  key: string;
  palette: Palette;
  book: Book;
  sections: readonly SongSection[];
  hooks: Readonly<Record<string, Hook>>;
}>;

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
