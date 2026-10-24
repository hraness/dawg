/**
 * The hyperpop song sheet: the compact plan a small model writes. Pitches
 * are scale degrees, chords are roman numerals and every texture is a named
 * pattern from the library, so a sheet cannot ask for a wrong note, a
 * semitone rub or a key change. `validateSheet` turns any JSON into a sheet
 * or into fix-it messages a model can act on; `compile.ts` renders it.
 */
import type {
  DrumFamily,
  Layer,
  Part,
  SectionKind,
} from "../../demos/hyperpop.ts";
import { PARTS } from "../../demos/hyperpop.ts";
import { LIBRARY, PATTERN_SLOTS, type PatternSlot } from "./library.ts";

export const PALETTES = ["night", "glass", "candy"] as const;
export type Palette = (typeof PALETTES)[number];

/** Section kinds; the bridge is the candy palette's alone. */
export type SheetKind = SectionKind | "bridge";
export const KINDS: readonly SheetKind[] = [
  "intro",
  "verse",
  "pre",
  "chorus",
  "post",
  "break",
  "build",
  "bridge",
  "outro",
];
/** The candy palette's song form: every kind has its one length. */
export const CANDY_BARS: Readonly<Partial<Record<SheetKind, number>>> = {
  intro: 4,
  verse: 8,
  pre: 4,
  chorus: 8,
  break: 4,
  bridge: 8,
  outro: 4,
};
/** Parts only the candy palette sings: more chorus lines, the bridge, the tag. */
export const CANDY_PARTS = [
  "pre3",
  "pre4",
  "ch4",
  "ch5",
  "ch6",
  "br1",
  "br2",
  "br3",
  "br4",
  "end1",
  "end2",
] as const;
export type SheetPart = Part | (typeof CANDY_PARTS)[number];
export const DRUMS: readonly DrumFamily[] = [
  "euro",
  "bounce",
  "four",
  "house",
  "half",
  "trap",
  "tresillo",
  "broken",
  "skip",
  "dnb",
  "roller",
  "halfstep",
  "taps",
  "none",
];
/** Layers a sheet may play (the recorded-words double is the demos' own). */
export const LAYERS: readonly Layer[] = [
  "pad",
  "stabs",
  "arp",
  "bells",
  "lead",
  "sub",
  "growl",
  "riff",
  "cloud",
];

/**
 * A sung note: [beat inside the part, scale degree, length in beats,
 * syllable]. Degree 1 is the tonic, 8 the octave above, 0 the 7th below.
 * On the candy palette a beat from -1 is a pickup sung before the part's
 * bar.
 */
export type SheetNote = readonly [number, number, number, string];
/** A sung part, note by note: one bar (two for ch1..ch3, two for every candy part). */
export type SheetLine = readonly SheetNote[];

/** A lead hook: per bar, [beat, degree, beats] notes. */
export type SheetHook = readonly (readonly (readonly [
  number,
  number,
  number,
])[])[];

export type SheetSection = Readonly<{
  kind: SheetKind;
  name: string;
  bars: number;
  /** A progression name: one chord per bar, cycling. */
  chords: string;
  /** A drum family per four-bar phrase, cycling. */
  drums: readonly DrumFamily[];
  energy?: number;
  play: readonly Layer[];
  /** The part that starts on each bar (null: none); choruses take two bars. */
  lines?: readonly (SheetPart | null)[];
  riff?: string;
  arp?: string;
  bells?: string;
  stabs?: string;
  /** The moving bass line under the sub (and the growl in a drop). */
  line?: string;
  /** Hook names the lead plays, one bar after another, cycling. */
  lead?: readonly string[];
  /** The looped voice doubles the lead an octave down. */
  voiceLead?: boolean;
  /** Glitch bursts close each phrase where nothing else answers. */
  bursts?: boolean;
  /** Bars into the section each layer waits before it enters. */
  enter?: Readonly<Partial<Record<Layer, number>>>;
}>;

export type SongSheet = Readonly<{
  title: string;
  bpm: number;
  /** `F minor`, `A major`, `C# minor`. */
  key: string;
  palette: Palette;
  /** Named progressions of roman numerals (`i VI III VII`). */
  progressions: Readonly<Record<string, readonly string[]>>;
  lines: Readonly<Partial<Record<SheetPart, SheetLine>>>;
  hooks?: Readonly<Record<string, SheetHook>>;
  sections: readonly SheetSection[];
}>;

// ------------------------------------------------------------- theory

const NOTE_NAMES: Readonly<Record<string, number>> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export type Key = Readonly<{
  tonic: number;
  minor: boolean;
  /** Pitch classes of the scale, tonic first. */
  steps: readonly number[];
  /** The MIDI pitch of degree 1 (between 60 and 71). */
  base: number;
  /** Score key text: `Fm`, `A`. */
  label: string;
}>;

export function parseKey(text: string): Key | undefined {
  const match = /^\s*([A-G](?:#|b)?)\s*(major|minor|maj|min|m)?\s*$/i.exec(
    text,
  );
  if (!match) return undefined;
  const name = match[1]![0]!.toUpperCase() + match[1]!.slice(1);
  const tonic = NOTE_NAMES[name];
  if (tonic === undefined) return undefined;
  const mode = (match[2] ?? "major").toLowerCase();
  const minor = mode === "minor" || mode === "min" || mode === "m";
  return {
    tonic,
    minor,
    steps: minor ? MINOR : MAJOR,
    base: 60 + tonic,
    label: `${name}${minor ? "m" : ""}`,
  };
}

/** The scale's pitch classes (for thirds under a line). */
export const scaleOf = (key: Key): number[] =>
  key.steps.map((step) => (key.tonic + step) % 12);

/** Degree 1 is the tonic at `key.base`; 8 an octave up; 0 the 7th below. */
export function degreePitch(key: Key, degree: number): number {
  const index = degree - 1;
  const octave = Math.floor(index / 7);
  return key.base + key.steps[((index % 7) + 7) % 7]! + 12 * octave;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** The scale degree (1..7) a roman numeral names, ignoring case and suffixes. */
export function numeralDegree(numeral: string): number | undefined {
  const match = /^\s*(VII|VI|V|IV|III|II|I)/i.exec(numeral);
  if (!match) return undefined;
  return NUMERALS.indexOf(match[1]!.toUpperCase()) + 1;
}

export type ChordQuality = "major" | "minor" | "diminished";

export function chordQuality(key: Key, degree: number): ChordQuality {
  const at = (k: number) =>
    key.steps[(degree - 1 + k) % 7]! + (degree - 1 + k >= 7 ? 12 : 0);
  const root = at(0);
  const third = at(2) - root;
  const fifth = at(4) - root;
  if (fifth === 6) return "diminished";
  return third === 3 ? "minor" : "major";
}

/** A numeral ending in 6 is a first inversion: the bass takes the 3rd. */
export const isInversion = (numeral: string): boolean => /6\s*$/.test(numeral);

/** The numeral in its conventional case: `i`, `VI`. */
export function numeralFor(key: Key, degree: number): string {
  const text = NUMERALS[degree - 1]!;
  return chordQuality(key, degree) === "major" ? text : text.toLowerCase();
}

/**
 * Pitch classes of a degree's chord: minor chords take their seventh,
 * major chords their ninth, so no voicing holds a semitone.
 */
export function chordClasses(key: Key, degree: number): number[] {
  const root = (key.tonic + key.steps[degree - 1]!) % 12;
  const add =
    chordQuality(key, degree) === "minor" ? [0, 3, 7, 10] : [0, 2, 4, 7];
  return add.map((step) => (root + step) % 12);
}

// ------------------------------------------------------------- validation

export type Validated =
  | Readonly<{ ok: true; sheet: SongSheet; warnings: string[] }>
  | Readonly<{ ok: false; errors: string[] }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Bars a part takes: every candy part two, otherwise two for a chorus part. */
export const partBars = (part: SheetPart, palette?: Palette) =>
  palette === "candy" || part.startsWith("ch") ? 2 : 1;

export const partSpan = (part: SheetPart, palette?: Palette) =>
  partBars(part, palette) * 4;

/** The longest a note may be held (candy holds words across bar lines). */
const longest = (palette?: Palette) => (palette === "candy" ? 6 : 4);

/**
 * A line's notes in order, each held at most to the next onset and the end
 * of the part (a length of 0 holds it exactly that far).
 */
export function lineNotes(
  part: SheetPart,
  line: SheetLine,
  palette?: Palette,
): SheetNote[] {
  const span = partSpan(part, palette);
  const ring = palette === "candy" ? 6 : 3;
  const sorted = [...line].sort((a, b) => a[0] - b[0]);
  return sorted.map(([beat, degree, beats, syllable], k) => {
    const room = (sorted[k + 1]?.[0] ?? Math.min(span, beat + ring)) - beat;
    const len = beats > 0 ? Math.min(beats, room) : room;
    return [beat, degree, Math.max(0.1, len), syllable] as const;
  });
}

/**
 * Check and normalize a sheet. Errors name the field and how to fix it;
 * warnings are soft and never block a render.
 */
/** The pattern a layer plays when a section lists it with none named. */
const USUAL: Readonly<
  Record<
    "riff" | "arp" | "bells" | "stabs",
    Readonly<Partial<Record<SheetKind, string>>>
  >
> = {
  riff: {
    intro: "ostinato",
    verse: "answer",
    pre: "lift",
    chorus: "lift",
    post: "drop",
    break: "ostinato",
    build: "climb",
    outro: "ostinato",
  },
  arp: {
    intro: "eighths",
    verse: "skip",
    pre: "eighths",
    chorus: "high",
    post: "spread",
    break: "eighths",
    build: "sixteenths",
    outro: "eighths",
  },
  bells: {
    intro: "verse",
    verse: "verse",
    pre: "verse",
    chorus: "fall",
    post: "fall",
    break: "sparse",
    build: "sparse",
    outro: "fade",
  },
  stabs: {
    intro: "push",
    verse: "syncopate",
    pre: "push",
    chorus: "push",
    post: "drive",
    break: "push",
    build: "pulse",
    outro: "push",
  },
};

export function validateSheet(raw: unknown): Validated {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw))
    return { ok: false, errors: ["the sheet must be a JSON object"] };
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim().slice(0, 32)
      : "Untitled";
  const bpm = typeof raw.bpm === "number" ? Math.round(raw.bpm) : NaN;
  if (!(bpm >= 120 && bpm <= 180))
    errors.push("bpm: use a whole number from 120 to 180");
  const key = typeof raw.key === "string" ? parseKey(raw.key) : undefined;
  if (!key)
    errors.push('key: write a tonic and a mode, like "F minor" or "A major"');
  const palette = raw.palette;
  if (!(PALETTES as readonly unknown[]).includes(palette))
    errors.push(`palette: use one of ${PALETTES.join(", ")}`);

  const progressions: Record<string, string[]> = {};
  if (!isRecord(raw.progressions))
    errors.push(
      'progressions: an object of named numeral lists, like {"verse": ["i", "VI", "III", "VII"]}',
    );
  else
    for (const [name, list] of Object.entries(raw.progressions)) {
      if (!Array.isArray(list) || list.length < 1 || list.length > 8) {
        errors.push(`progressions.${name}: list 1 to 8 numerals`);
        continue;
      }
      const out: string[] = [];
      for (const numeral of list) {
        const degree =
          typeof numeral === "string" ? numeralDegree(numeral) : undefined;
        if (!degree) {
          errors.push(
            `progressions.${name}: "${String(numeral).slice(0, 12)}" is not a numeral (I to VII)`,
          );
          continue;
        }
        if (key && chordQuality(key, degree) === "diminished") {
          errors.push(
            `progressions.${name}: ${numeral} is diminished in ${raw.key}; use another chord`,
          );
          continue;
        }
        out.push(
          (key ? numeralFor(key, degree) : String(numeral)) +
            (isInversion(numeral as string) ? "6" : ""),
        );
      }
      progressions[name] = out;
    }

  const candy = palette === "candy";
  const partNames: readonly string[] = candy
    ? [...PARTS, ...CANDY_PARTS]
    : PARTS;
  const first = candy ? -1 : 0;
  const lines: Partial<Record<SheetPart, SheetLine>> = {};
  if (!isRecord(raw.lines))
    errors.push(
      `lines: an object of sung parts keyed ${candy ? partNames.join(", ") : "v1..v8, pre1, pre2, ch1..ch3"}`,
    );
  else
    for (const [part, value] of Object.entries(raw.lines)) {
      if (!partNames.includes(part)) {
        warnings.push(
          `lines.${part} was dropped: parts are ${partNames.join(", ")}`,
        );
        continue;
      }
      const p = part as SheetPart;
      const span = partSpan(p, palette as Palette);
      if (!Array.isArray(value)) {
        errors.push(
          `lines.${part}: a list of [beat, degree, beats, "syllable"] notes`,
        );
        continue;
      }
      const notes: SheetNote[] = [];
      let skipped = 0;
      for (const note of value) {
        if (
          !Array.isArray(note) ||
          note.length !== 4 ||
          ![note[0], note[1], note[2]].every(
            (n) => typeof n === "number" && Number.isFinite(n),
          ) ||
          typeof note[3] !== "string"
        ) {
          skipped++;
          continue;
        }
        const [beat, degree, beats, syllable] = note as [
          number,
          number,
          number,
          string,
        ];
        if (
          beat < first ||
          beat >= span ||
          notes.some(([b]) => Math.abs(b - beat) < 0.01)
        ) {
          skipped++;
          continue;
        }
        notes.push([
          Math.round(beat * 4) / 4,
          Math.max(-3, Math.min(15, Math.round(degree))),
          Math.max(0, Math.min(longest(palette as Palette), beats)),
          syllable.replace(/\s+/g, "").slice(0, 12) || "ah",
        ]);
      }
      if (skipped > 0)
        warnings.push(
          `lines.${part}: ${skipped} notes were dropped; each note is [beat ${first} to ${span - 0.25}, degree, beats, "syllable"] with its own beat`,
        );
      // The outro's tag may be one held word.
      if (notes.length < (candy && p.startsWith("end") ? 1 : 2)) {
        errors.push(
          `lines.${part}: give at least 2 notes as [beat, degree, beats, "syllable"]`,
        );
        continue;
      }
      lines[p] = lineNotes(p, notes, palette as Palette);
    }

  const hooks: Record<string, SheetHook> = {};
  if (raw.hooks !== undefined) {
    if (!isRecord(raw.hooks)) errors.push("hooks: an object of named hooks");
    else
      for (const [name, bars] of Object.entries(raw.hooks)) {
        if (!Array.isArray(bars) || bars.length < 1 || bars.length > 8) {
          errors.push(
            `hooks.${name}: list 1 to 8 bars, each a list of [beat, degree, beats]`,
          );
          continue;
        }
        const out: [number, number, number][][] = [];
        for (const bar of bars) {
          const notes: [number, number, number][] = [];
          if (Array.isArray(bar))
            for (const note of bar)
              if (
                Array.isArray(note) &&
                note.length === 3 &&
                note.every(
                  (n) => typeof n === "number" && Number.isFinite(n),
                ) &&
                note[0] >= 0 &&
                note[0] < 4 &&
                note[2] > 0 &&
                note[2] <= 4
              )
                notes.push([
                  note[0],
                  Math.round(note[1]),
                  Math.min(note[2], 4 - note[0]),
                ]);
              else {
                errors.push(
                  `hooks.${name}: each note is [beat 0-3.75, degree, beats]`,
                );
                break;
              }
          out.push(notes);
        }
        if (out.flat().some(([, d]) => d < 1 || d > 16))
          warnings.push(
            `hooks.${name}: degrees were clamped to 1..16; write hooks between degrees 8 and 15`,
          );
        hooks[name] = out.map((bar) =>
          bar.map(([beat, d, beats]) => [
            beat,
            Math.max(1, Math.min(16, d)),
            beats,
          ]),
        );
      }
  }

  const sections: SheetSection[] = [];
  const names = new Set<string>();
  if (!Array.isArray(raw.sections) || raw.sections.length < 4)
    errors.push("sections: list at least 4 sections, intro to outro");
  else
    raw.sections.forEach((value, index) => {
      const where = `sections[${index}]`;
      if (!isRecord(value)) {
        errors.push(`${where}: a section object`);
        return;
      }
      let kind = value.kind as SheetKind;
      if (!candy && kind === "bridge") {
        warnings.push(
          `${where}.kind: night and glass have no bridge, so it became a break`,
        );
        kind = "break";
      }
      const kinds = candy
        ? KINDS.filter((k) => CANDY_BARS[k])
        : KINDS.filter((k) => k !== "bridge");
      if (candy && KINDS.includes(kind) && !kinds.includes(kind)) {
        warnings.push(
          `${where} was dropped: the candy palette has no ${kind}; use ${kinds.join(", ")}`,
        );
        return;
      }
      if (!kinds.includes(kind))
        errors.push(`${where}.kind: use one of ${kinds.join(", ")}`);
      const name =
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim().slice(0, 24)
          : `${kind} ${index + 1}`;
      if (names.has(name.toLowerCase()))
        errors.push(
          `${where}.name: "${name}" is used twice; names must differ`,
        );
      names.add(name.toLowerCase());
      let bars = typeof value.bars === "number" ? Math.round(value.bars) : NaN;
      const fixed = candy ? CANDY_BARS[kind] : undefined;
      if (fixed !== undefined && bars !== fixed) {
        warnings.push(
          `${where}.bars: a candy ${kind} is ${fixed} bars, so it was made ${fixed}`,
        );
        bars = fixed;
      }
      if (!(bars >= 2 && bars <= 16))
        errors.push(`${where}.bars: 2 to 16 (4 or 8 is usual)`);
      const chords = typeof value.chords === "string" ? value.chords : "";
      if (!progressions[chords])
        errors.push(
          `${where}.chords: name one of the progressions (${Object.keys(progressions).join(", ") || "none given"})`,
        );
      const drums = Array.isArray(value.drums)
        ? (value.drums.filter((d) =>
            DRUMS.includes(d as DrumFamily),
          ) as DrumFamily[])
        : [];
      // The candy palette plays its own drums for each kind of section.
      if (
        !candy &&
        (drums.length === 0 ||
          drums.length !== (value.drums as unknown[]).length)
      )
        errors.push(
          `${where}.drums: a list of drum families from ${DRUMS.join(", ")}`,
        );
      const play = Array.isArray(value.play)
        ? (value.play.filter((l) => LAYERS.includes(l as Layer)) as Layer[])
        : [];
      if (
        !candy &&
        (!Array.isArray(value.play) || play.length !== value.play.length)
      )
        errors.push(`${where}.play: layers from ${LAYERS.join(", ")}`);
      const energy =
        typeof value.energy === "number"
          ? Math.max(0.5, Math.min(1, value.energy))
          : undefined;
      const section: Record<string, unknown> = {
        kind,
        name,
        bars,
        chords,
        drums,
        play,
        ...(energy !== undefined ? { energy } : {}),
      };
      if (value.lines !== undefined) {
        const list = Array.isArray(value.lines)
          ? value.lines.slice(0, bars)
          : [];
        const out: (SheetPart | null)[] = [];
        let busyUntil = 0;
        list.forEach((part, bar) => {
          if (part === null || part === "" || part === undefined)
            return out.push(null);
          if (typeof part !== "string" || !lines[part as SheetPart]) {
            warnings.push(
              `${where}.lines[${bar}]: "${String(part).slice(0, 8)}" is not in lines, so that bar is silent`,
            );
            return out.push(null);
          }
          if (bar < busyUntil) {
            warnings.push(
              `${where}.lines[${bar}]: ${part} was dropped because the part before it still sings; put null after each two-bar ${candy ? "" : "chorus "}part`,
            );
            return out.push(null);
          }
          const size = partBars(part as SheetPart, palette as Palette);
          if (bar + size > bars) {
            warnings.push(
              `${where}.lines[${bar}]: ${part} was dropped because it runs past the section's end`,
            );
            return out.push(null);
          }
          busyUntil = bar + size;
          out.push(part as SheetPart);
        });
        section.lines = out;
      }
      for (const slot of PATTERN_SLOTS) {
        const pick = value[slot];
        if (pick === undefined) continue;
        if (typeof pick !== "string" || !LIBRARY[slot][pick])
          warnings.push(
            `${where}.${slot} was dropped: use one of ${Object.keys(LIBRARY[slot]).join(", ")}`,
          );
        else section[slot] = pick;
      }
      for (const [slot, layer] of [
        ["riff", "riff"],
        ["arp", "arp"],
        ["bells", "bells"],
        ["stabs", "stabs"],
      ] as const)
        // A layer played with no pattern takes the usual one for the section.
        if (
          play.includes(layer) &&
          section[slot] === undefined &&
          USUAL[slot][kind]
        )
          section[slot] = USUAL[slot][kind];
      if (value.lead !== undefined) {
        const list = (
          typeof value.lead === "string"
            ? [value.lead]
            : Array.isArray(value.lead)
              ? value.lead
              : []
        ).filter((h): h is string => typeof h === "string");
        const known = list.filter((h) => hooks[h]);
        if (known.length < list.length)
          warnings.push(
            `${where}.lead: ${list.filter((h) => !hooks[h]).join(", ")} is not in hooks, so the lead skips it`,
          );
        if (known.length > 0) section.lead = known;
      }
      if (value.voiceLead === true) section.voiceLead = true;
      if (value.bursts === true) section.bursts = true;
      if (isRecord(value.enter)) {
        const enter: Partial<Record<Layer, number>> = {};
        for (const [layer, bar] of Object.entries(value.enter))
          if (
            LAYERS.includes(layer as Layer) &&
            typeof bar === "number" &&
            bar >= 0 &&
            bar < bars
          )
            enter[layer as Layer] = Math.round(bar);
          else
            errors.push(
              `${where}.enter.${layer}: a layer and a bar inside the section`,
            );
        section.enter = enter;
      }
      sections.push(section as SheetSection);
    });
  const total = sections.reduce(
    (n, s) => n + (Number.isFinite(s.bars) ? s.bars : 0),
    0,
  );
  if (sections.length >= 4 && (total < 48 || total > 160))
    errors.push(`sections: ${total} bars in all; aim for 64 to 120`);
  if (errors.length > 0)
    return { ok: false, errors: [...new Set(errors)].slice(0, 24) };
  return {
    ok: true,
    sheet: {
      title,
      bpm,
      key: `${key!.label.replace(/m$/, "")} ${key!.minor ? "minor" : "major"}`,
      palette: palette as Palette,
      progressions,
      lines,
      ...(Object.keys(hooks).length > 0 ? { hooks } : {}),
      sections,
    },
    warnings,
  };
}

export const isPatternSlot = (slot: string): slot is PatternSlot =>
  (PATTERN_SLOTS as string[]).includes(slot);

/**
 * Write a sung note that clashes on a beat as the chord tone the compiler
 * moves it to, so the sheet says what is heard. A short note stepping
 * straight on to its neighbour leans on the beat and stays.
 */
export function settleSheet(sheet: SongSheet): SongSheet {
  const key = parseKey(sheet.key);
  if (!key) return sheet;
  const lines = { ...sheet.lines };
  for (const section of sheet.sections) {
    const list = sheet.progressions[section.chords] ?? [];
    (section.lines ?? []).forEach((part, bar) => {
      const line = part ? lines[part] : undefined;
      if (!part || !line) return;
      lines[part] = line.map((note, k): SheetNote => {
        const [beat, degree, beats, lyric] = note;
        const next = line[k + 1];
        const leans =
          beats <= 0.5 &&
          next !== undefined &&
          next[0] - beat <= 0.5 &&
          Math.abs(next[1] - degree) === 1;
        if (beat % 1 !== 0 || leans) return note;
        const numeral = list[(bar + Math.floor(beat / 4)) % list.length] ?? "I";
        const tones = new Set(chordClasses(key, numeralDegree(numeral) ?? 1));
        const pc = degreePitch(key, degree) % 12;
        const rubs =
          !tones.has(pc) &&
          (tones.has((pc + 1) % 12) || tones.has((pc + 11) % 12));
        if (!rubs) return note;
        for (const d of [degree - 1, degree + 1])
          if (tones.has(degreePitch(key, d) % 12))
            return [beat, d, beats, lyric];
        return note;
      });
    });
  }
  return { ...sheet, lines };
}
