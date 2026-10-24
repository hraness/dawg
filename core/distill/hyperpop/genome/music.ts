/**
 * The music a model writes for a song: the material where taste lives. The
 * seed has already drawn the constraints (tempo, mode, beats, form, sounds,
 * voice); the model writes chords for each section, the motifs every line
 * grows from, and the arranging habits. The arranger performs it: strong
 * notes still land on chord tones, the key never changes, and anything the
 * model leaves out is drawn from the seed.
 */
import type { Cell, Motif } from "./melody.ts";
import {
  diatonic,
  isDiminished,
  over,
  type Chord,
  type Ext,
  type Scale,
} from "./theory.ts";

/** A motif as text: a rhythm grid and the scale steps between its notes. */
export type MotifText = Readonly<{
  /** 16ths: `x` starts a note, `-` holds it, `.` rests. 16, 32 or 64 long. */
  rhythm: string;
  /** Scale steps from each note to the next, one fewer than the notes. */
  steps: readonly number[];
}>;

export const MOTIF_ROLES = [
  "hook",
  "verse",
  "pre",
  "bridge",
  "switch",
] as const;
export type MotifRole = (typeof MOTIF_ROLES)[number];
export const CHORD_ROLES = ["drop", "verse", "pre", "bridge"] as const;
export type ChordRole = (typeof CHORD_ROLES)[number];
export const PLANS = ["AABA", "ABAC", "AAAB", "ABAB", "AA'AB", "ABCA"] as const;
export const DROP_LEADS = [
  "vox+lead",
  "lead+chops",
  "chops+vox",
  "vox",
] as const;
export const DROP_BASSES = ["kick", "offbeat", "rolling", "syncop"] as const;
export const VERSE_BASSES = ["sustain", "kick", "pulse"] as const;

export type Music = Readonly<{
  /** Roman numerals in the song's mode, 2 to 8 per loop: "vi IV I V". */
  chords?: Partial<Record<ChordRole, readonly string[]>>;
  motifs?: Partial<Record<MotifRole, MotifText>>;
  hookPlan?: (typeof PLANS)[number];
  versePlan?: (typeof PLANS)[number];
  dropLead?: (typeof DROP_LEADS)[number];
  dropBass?: (typeof DROP_BASSES)[number];
  verseBass?: (typeof VERSE_BASSES)[number];
  /** The lead doubles the hook an octave up. */
  leadOctave?: boolean;
  stabsInDrop?: boolean;
  /** A harmony a third under the held words. */
  harmonyThirds?: boolean;
}>;

const NUMERAL = /^(vii|vi|iv|v|iii|ii|i)(°|o|dim)?(7|9|add9)?(?:\/(\d))?$/i;
const DEGREE: Readonly<Record<string, number>> = {
  i: 0,
  ii: 1,
  iii: 2,
  iv: 3,
  v: 4,
  vi: 5,
  vii: 6,
};

/**
 * A numeral as a chord in `scale`. The mode decides the quality, so "iv" and
 * "IV" are the same chord; borrowed chords are not written here. "V/3" puts
 * the chord's 3rd in the bass; a diminished chord always passes over its 3rd.
 */
export function numeral(scale: Scale, text: string): Chord | undefined {
  const m = NUMERAL.exec(text.trim());
  if (!m) return undefined;
  const degree = DEGREE[m[1]!.toLowerCase()]!;
  const ext: Ext =
    m[3] === "7"
      ? "seven"
      : m[3] === "9"
        ? "nine"
        : m[3] === "add9"
          ? "add9"
          : "triad";
  const dim = isDiminished(scale, degree);
  const chord = diatonic(scale, degree, dim ? "triad" : ext);
  const inv = m[4] === "3" || dim ? 1 : m[4] === "5" ? 2 : 0;
  return inv ? over(chord, chord.triad[inv]!) : chord;
}

/** A motif from its text, or why it can't be one. */
export function motifOf(text: MotifText, longest = 64): Motif | string {
  let r = text.rhythm.replace(/\s+/g, "").toLowerCase();
  if (/[^x.\-]/.test(r)) return "a rhythm uses only x, - and .";
  const size = Math.min(
    longest,
    r.length <= 16 ? 16 : r.length <= 32 ? 32 : 64,
  );
  r = r.slice(0, size).padEnd(size, ".");
  const cell: { beat: number; len: number }[] = [];
  for (let i = 0; i < r.length; i++) {
    if (r[i] === "x") cell.push({ beat: i / 4, len: 0.25 });
    else if (
      r[i] === "-" &&
      cell.length &&
      cell.at(-1)!.beat + cell.at(-1)!.len === i / 4
    )
      cell.at(-1)!.len += 0.25;
  }
  if (cell.length < 2) return "a motif needs at least two notes";
  const steps = cell
    .slice(1)
    .map((_, i) =>
      Math.max(-4, Math.min(4, Math.round(Number(text.steps[i] ?? 0)) || 0)),
    );
  return { cell: cell as Cell, steps, beats: size / 4 };
}

export type ReadMusic = Readonly<{
  loops: Partial<Record<ChordRole, Chord[]>>;
  motifs: Partial<Record<MotifRole, Motif>>;
  warnings: readonly string[];
}>;

/** The chords and motifs `music` asks for in `scale`, with a note for each part dropped. */
export function readMusic(music: Music | undefined, scale: Scale): ReadMusic {
  const warnings: string[] = [];
  const loops: Partial<Record<ChordRole, Chord[]>> = {};
  const motifs: Partial<Record<MotifRole, Motif>> = {};
  for (const role of CHORD_ROLES) {
    const list = music?.chords?.[role];
    if (!list) continue;
    const chords = list.flatMap((t) => {
      const c = numeral(scale, t);
      if (!c)
        warnings.push(`${role} chord ${t} is not a numeral like vi or V7`);
      return c ? [c] : [];
    });
    if (chords.length >= 2) loops[role] = chords.slice(0, 8);
    else
      warnings.push(
        `${role} chords need at least two numerals; the composer drew them`,
      );
  }
  for (const role of MOTIF_ROLES) {
    const text = music?.motifs?.[role];
    if (!text) continue;
    // Only the hook may run past one bar; every other line repeats bar by bar.
    const m = motifOf(text, role === "hook" ? 64 : 16);
    if (typeof m === "string")
      warnings.push(`${role} motif: ${m}; the composer drew it`);
    else motifs[role] = m;
  }
  return { loops, motifs, warnings };
}

/** `raw` as music: known fields only, each checked for shape, with a note for each dropped. */
export function validateMusic(raw: unknown): {
  music?: Music;
  warnings: string[];
} {
  if (raw === undefined) return { warnings: [] };
  if (!raw || typeof raw !== "object")
    return { warnings: ["music must be an object"] };
  const r = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};
  if (r.chords && typeof r.chords === "object") {
    const chords: Record<string, string[]> = {};
    for (const role of CHORD_ROLES) {
      const v = (r.chords as Record<string, unknown>)[role];
      const list =
        typeof v === "string"
          ? v.split(/[\s,|-]+/)
          : Array.isArray(v)
            ? v
            : undefined;
      if (list)
        chords[role] = list.filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        );
    }
    out.chords = chords;
  }
  if (r.motifs && typeof r.motifs === "object") {
    const motifs: Record<string, MotifText> = {};
    for (const role of MOTIF_ROLES) {
      const v = (r.motifs as Record<string, unknown>)[role] as
        Record<string, unknown> | undefined;
      if (!v || typeof v !== "object") continue;
      if (typeof v.rhythm !== "string" || !Array.isArray(v.steps)) {
        warnings.push(`${role} motif needs a rhythm and steps`);
        continue;
      }
      motifs[role] = {
        rhythm: v.rhythm,
        steps: v.steps.filter((x): x is number => typeof x === "number"),
      };
    }
    out.motifs = motifs;
  }
  const choose = <T extends string>(name: string, list: readonly T[]) => {
    const v = r[name];
    if (v === undefined) return;
    if (typeof v === "string" && (list as readonly string[]).includes(v))
      out[name] = v;
    else
      warnings.push(
        `${name} ${String(v).slice(0, 16)} is not one of ${list.join(", ")}`,
      );
  };
  choose("hookPlan", PLANS);
  choose("versePlan", PLANS);
  choose("dropLead", DROP_LEADS);
  choose("dropBass", DROP_BASSES);
  choose("verseBass", VERSE_BASSES);
  for (const name of ["leadOctave", "stabsInDrop", "harmonyThirds"])
    if (typeof r[name] === "boolean") out[name] = r[name];
  return { music: out as Music, warnings };
}

export function musicSchema(): Record<string, unknown> {
  const motif = {
    type: "object",
    properties: {
      rhythm: { type: "string", pattern: "^[x.\\-]{16,64}$" },
      steps: {
        type: "array",
        items: { type: "integer", minimum: -4, maximum: 4 },
        maxItems: 40,
      },
    },
    required: ["rhythm", "steps"],
    additionalProperties: false,
  };
  const loop = {
    type: "array",
    items: { type: "string", maxLength: 8 },
    minItems: 2,
    maxItems: 8,
  };
  return {
    type: "object",
    properties: {
      chords: {
        type: "object",
        properties: Object.fromEntries(CHORD_ROLES.map((r) => [r, loop])),
        additionalProperties: false,
      },
      motifs: {
        type: "object",
        properties: Object.fromEntries(MOTIF_ROLES.map((r) => [r, motif])),
        additionalProperties: false,
      },
      hookPlan: { enum: [...PLANS] },
      versePlan: { enum: [...PLANS] },
      dropLead: { enum: [...DROP_LEADS] },
      dropBass: { enum: [...DROP_BASSES] },
      verseBass: { enum: [...VERSE_BASSES] },
      leadOctave: { type: "boolean" },
      stabsInDrop: { type: "boolean" },
      harmonyThirds: { type: "boolean" },
    },
    additionalProperties: false,
  };
}
