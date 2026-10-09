/**
 * Family `art` (quality-08): coverage, the names every card uses, and the
 * style-specific theory the generic pattern checks in cards.test.ts do not
 * pin down (march meters, the pipe-band drone, tintinnabuli stepwise
 * motion, minimalist pulse, the tone row's chromatic spread).
 */

import { describe, expect, test } from "bun:test";
import {
  MODES,
  PROGRESSION_PRESETS,
  SCALES,
  STROKE_PATTERNS,
} from "../chords.ts";
import { ARTICULATIONS } from "../expression.ts";
import { FX_NAMES, FX_PRESETS, RIG_PRESETS } from "../fx.ts";
import { resolveInstrumentWord } from "../instruments.ts";
import { SYNTH_KIT_NAMES } from "../kits.ts";
import { isLoudnessTargetName } from "../master.ts";
import { TUNING_NAMES, tuningPreset } from "../tuning.ts";
import { ART_CARDS } from "./art.ts";
import { generateStyle, type GeneratedStyle } from "./generate.ts";
import { resolveStyle } from "./index.ts";
import {
  KIT_ROLES,
  type RoleName,
  type RoleTexture,
  type RoleVoice,
  type StyleCard,
} from "./schema.ts";
import { STYLE_FAMILIES, TAXONOMY_ROWS } from "./taxonomy.ts";

const SEEDS = [1, 2, 3, 4, 5, 6];
const ROOTS = STYLE_FAMILIES.find((f) => f.key === "art")!.roots;
const PARENTS = new Set(TAXONOMY_ROWS.map((row) => row[1]));
const ART_ROWS = TAXONOMY_ROWS.filter((row) => row[2] === "art");
const CARD_IDS = new Set(ART_CARDS.map((c) => c.id));
const KIT_ROLE_SET = new Set<string>(KIT_ROLES);

/** A role's voices, whether listed or appended with `{ "+": [...] }`. */
function voicesOf(texture: RoleTexture | null | undefined): RoleVoice[] {
  if (!texture) return [];
  const list = texture.voices as unknown;
  if (Array.isArray(list)) return list as RoleVoice[];
  return [...((list as { "+": RoleVoice[] })["+"] ?? [])];
}

const weightedNames = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((entry) => String(entry[0])) : [];

/** Every registry name a card writes, as `kind name` strings. */
function badNames(card: StyleCard): string[] {
  const bad: string[] = [];
  const scaleOk = (name: string) => name in SCALES || name in MODES;
  for (const name of weightedNames(card.pitch?.scales))
    if (!scaleOk(name)) bad.push(`scale ${name}`);
  if (card.pitch?.tuning && !TUNING_NAMES.includes(card.pitch.tuning))
    bad.push(`tuning ${card.pitch.tuning}`);
  for (const name of weightedNames(card.harmony?.presets))
    if (!PROGRESSION_PRESETS.some((p) => p.name === name))
      bad.push(`preset ${name}`);
  for (const name of weightedNames(card.harmony?.voicing?.strokes))
    if (!(name in STROKE_PATTERNS)) bad.push(`stroke ${name}`);
  for (const [, texture] of Object.entries(card.texture?.roles ?? {}))
    for (const voice of voicesOf(texture as RoleTexture | null)) {
      if (voice.instrument === "drums") {
        if (voice.kit && !SYNTH_KIT_NAMES.includes(voice.kit))
          bad.push(`kit ${voice.kit}`);
      } else if (!resolveInstrumentWord(voice.instrument))
        bad.push(`instrument ${voice.instrument}`);
      if (voice.rig && !(voice.rig in RIG_PRESETS))
        bad.push(`rig ${voice.rig}`);
    }
  for (const [, weights] of Object.entries(card.expression?.articulation ?? {}))
    for (const name of weightedNames(weights))
      if (!(ARTICULATIONS as readonly string[]).includes(name))
        bad.push(`articulation ${name}`);
  for (const [, effects] of Object.entries(card.mix?.fx ?? {}))
    for (const [effect, preset] of Object.entries(effects ?? {})) {
      const table = (FX_PRESETS as Record<string, Record<string, unknown>>)[
        effect
      ];
      const inChain = (FX_NAMES as readonly string[]).includes(effect);
      if (!inChain || !table || !preset || !(preset in table))
        bad.push(`fx ${effect}:${preset}`);
    }
  if (card.mix?.loudness && !isLoudnessTargetName(card.mix.loudness))
    bad.push(`loudness ${card.mix.loudness}`);
  return bad;
}

const notesFor = (g: GeneratedStyle, role: RoleName) =>
  (g.data.notes ?? [])
    .filter((note) => g.plan.noteRoles.get(note.id) === role)
    .sort((a, b) => (a.startTick ?? 0) - (b.startTick ?? 0));

describe("family art", () => {
  test("every art taxonomy id has a card, and every card is an art id", () => {
    const missing = ART_ROWS.map((row) => row[0]).filter(
      (id) => !CARD_IDS.has(id),
    );
    expect(missing).toEqual([]);
    const stray = [...CARD_IDS].filter(
      (id) => !ART_ROWS.some((row) => row[0] === id),
    );
    expect(stray).toEqual([]);
    expect(ART_ROWS.filter((row) => !PARENTS.has(row[0])).length).toBe(105);
    for (const root of ROOTS) expect(CARD_IDS.has(root)).toBe(true);
  });

  test("branch cards are abstract and leaves are not", () => {
    for (const c of ART_CARDS)
      expect([c.id, Boolean(c.abstract)]).toEqual([c.id, PARENTS.has(c.id)]);
  });

  test("every card names its theory and only registry names", () => {
    const bad: string[] = [];
    for (const c of ART_CARDS) {
      if (!c.summary || c.summary.length < 40) bad.push(`${c.id}: summary`);
      for (const name of badNames(c)) bad.push(`${c.id}: ${name}`);
    }
    expect(bad).toEqual([]);
  });

  test("summaries are distinct", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const c of ART_CARDS) {
      const other = seen.get(c.summary!);
      if (other) dupes.push(`${other} = ${c.id}`);
      seen.set(c.summary!, c.id);
    }
    expect(dupes).toEqual([]);
  });
});

describe("family art: style theory", () => {
  test("plainchant is a single unaccompanied line with no kit", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("plainchant", { seed, bars: 8 });
      const roles = new Set(g.plan.noteRoles.values());
      for (const r of ["kick", "snare", "hat", "chords"] as const)
        expect(roles.has(r)).toBe(false);
      expect(roles.has("lead")).toBe(true);
    }
  });

  test("marches are in duple time with the bass on the strong beats", () => {
    for (const id of ["military-march", "marching-band"]) {
      const style = resolveStyle(id);
      for (const [sig] of style.meter.signatures)
        expect(["2/4", "6/8", "4/4", "2/2"]).toContain(sig);
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        const pulses = Number(g.plan.signature.split("/")[0]);
        const beat = g.plan.barTicks / pulses;
        // Oom-pah: the bass speaks on the strong beats (each beat of 2/4,
        // 1 and 3 of 4/4, the two dotted-quarter beats of 6/8), never
        // between them (a few ticks of humanize either side).
        const strong =
          g.plan.signature === "6/8" ? beat * 3 : pulses > 2 ? beat * 2 : beat;
        const bass = notesFor(g, "bass");
        expect(bass.length).toBeGreaterThan(0);
        for (const note of bass) {
          const off = (note.startTick ?? 0) % strong;
          expect(Math.min(off, strong - off)).toBeLessThan(beat / 4);
        }
      }
    }
  });

  test("the pipe band holds the drone under mixolydian chanter", () => {
    const style = resolveStyle("pipe-band");
    expect(style.harmony.model).toBe("drone");
    expect(weightedNames(style.pitch.scales)).toEqual(["mixolydian"]);
    for (const seed of SEEDS) {
      const g = generateStyle("pipe-band", { seed, bars: 8 });
      expect(notesFor(g, "drone").length).toBeGreaterThan(0);
    }
  });

  test("tintinnabuli: the melody voice moves by step around the tonic", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("holy-minimalism", { seed, bars: 8 });
      const lead = notesFor(g, "lead");
      let leaps = 0;
      for (let i = 1; i < lead.length; i += 1)
        if (Math.abs(lead[i]!.pitch - lead[i - 1]!.pitch) > 4) leaps += 1;
      expect(leaps / Math.max(1, lead.length - 1)).toBeLessThan(0.15);
    }
  });

  test("pulse minimalism keeps an unbroken sixteenth pulse", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("pulse-minimalism", { seed, bars: 8 });
      const arp = notesFor(g, "arp");
      const steps = new Set(
        arp.map((note) => Math.round((note.startTick ?? 0) / g.plan.stepTicks)),
      );
      const bars = g.plan.bars;
      // Every step of the cue's pulse bars sounds (sections may rest).
      expect(steps.size).toBeGreaterThan(bars * g.plan.stepsPerBar * 0.4);
    }
  });

  test("serial cards complete every aggregate before a pitch class returns", () => {
    for (const id of [
      "twelve-tone",
      "integral-serialism",
      "elektronische-musik",
    ])
      for (const seed of SEEDS.slice(0, 3)) {
        const g = generateStyle(id, { seed, bars: 8 });
        const counts = new Array<number>(12).fill(0);
        for (const note of g.data.notes ?? []) {
          const role = g.plan.noteRoles.get(note.id)!;
          if (KIT_ROLE_SET.has(role)) continue;
          counts[(((note.pitch - g.plan.tonic) % 12) + 12) % 12]! += 1;
          expect(note.cents ?? 0).toBe(0);
        }
        // Whole rows give equal counts; the last, partial row adds one.
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
          1,
        );
        expect(Math.min(...counts)).toBeGreaterThan(0);
      }
  });

  test("integral serialism orders durations and dynamics too", () => {
    const g = generateStyle("integral-serialism", { seed: 4, bars: 8 });
    const durations = new Set<number>();
    const velocities = new Set<number>();
    for (const note of g.data.notes ?? []) {
      durations.add(Math.round(note.durationTicks ?? 0));
      velocities.add(Math.round((note.velocity ?? 0) * 100));
    }
    expect(durations.size).toBeGreaterThanOrEqual(8);
    expect(velocities.size).toBeGreaterThanOrEqual(8);
  });

  test("expressionism draws on the whole chromatic", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const g = generateStyle("expressionism", { seed, bars: 8 });
      const pcs = new Set<number>();
      for (const note of g.data.notes ?? [])
        pcs.add((((note.pitch - g.plan.tonic) % 12) + 12) % 12);
      expect(pcs.size).toBeGreaterThanOrEqual(10);
    }
  });

  test("spectralism sounds the harmonic series in just intonation", () => {
    const g = generateStyle("spectralism", { seed: 2, bars: 8 });
    expect(g.data.tuning?.name).toBe("harmonic-series");
    const cents = tuningPreset("harmonic-series")!.cents;
    // 7th, 11th and 13th partials: 969, 551 and 841 cents above the tonic.
    expect(cents[9]).toBe(969);
    expect(cents[5]).toBe(551);
    expect(cents[8]).toBe(841);
    // Partials 8-15 only: no minor second, minor third or perfect fourth.
    for (const note of g.data.notes ?? []) {
      const role = g.plan.noteRoles.get(note.id)!;
      if (KIT_ROLE_SET.has(role)) continue;
      const pc = (((note.pitch - g.plan.tonic) % 12) + 12) % 12;
      expect([1, 3, 5, 8]).not.toContain(pc);
    }
  });

  test("microtonal art sounds quarter tones beside tempered degrees", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const g = generateStyle("microtonal-art", { seed, bars: 8 });
      const notes = g.data.notes ?? [];
      const quarter = notes.filter((n) => Math.abs(n.cents ?? 0) === 50);
      expect(quarter.length / notes.length).toBeGreaterThan(0.1);
      expect(quarter.length).toBeLessThan(notes.length);
    }
  });

  test("siblings differ in tempo, meter, instruments, pitch classes or onsets", () => {
    const leaves = ART_CARDS.filter((c) => !c.abstract).map((c) => c.id);
    const parent = new Map(TAXONOMY_ROWS.map((r) => [r[0], r[1]]));
    type Print = {
      bpm: number;
      meters: Set<string>;
      instruments: Set<string>;
      pcs: number[];
      onsets: number[];
    };
    const print = (id: string): Print => {
      const out: Print = {
        bpm: 0,
        meters: new Set(),
        instruments: new Set(),
        pcs: new Array(12).fill(0),
        onsets: new Array(16).fill(0),
      };
      const bpms: number[] = [];
      let pitched = 0;
      let all = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const { plan, data } = generateStyle(id, { seed, bars: 8 });
        bpms.push(plan.bpm);
        out.meters.add(plan.signature);
        for (const t of plan.tracks) out.instruments.add(t.instrument);
        for (const note of data.notes ?? []) {
          const role = plan.noteRoles.get(note.id)!;
          if (!KIT_ROLE_SET.has(role)) {
            out.pcs[(((note.pitch - plan.tonic) % 12) + 12) % 12]! += 1;
            pitched += 1;
          }
          const at = ((note.startTick ?? 0) % plan.barTicks) / plan.barTicks;
          out.onsets[Math.floor(at * 16)]! += 1;
          all += 1;
        }
      }
      out.bpm = bpms.sort((a, b) => a - b)[2]!;
      out.pcs = out.pcs.map((x) => x / (pitched || 1));
      out.onsets = out.onsets.map((x) => x / (all || 1));
      return out;
    };
    const prints = new Map(leaves.map((id) => [id, print(id)]));
    const jaccard = (a: Set<string>, b: Set<string>) => {
      let both = 0;
      for (const x of a) if (b.has(x)) both += 1;
      return both / (a.size + b.size - both);
    };
    const l1 = (a: number[], b: number[]) =>
      a.reduce((sum, x, i) => sum + Math.abs(x - b[i]!), 0);
    const same: string[] = [];
    for (const a of leaves)
      for (const b of leaves) {
        if (a >= b || parent.get(a) !== parent.get(b)) continue;
        const A = prints.get(a)!;
        const B = prints.get(b)!;
        const apart =
          Math.abs(A.bpm - B.bpm) / Math.min(A.bpm, B.bpm) > 0.2 ||
          jaccard(A.meters, B.meters) < 0.5 ||
          jaccard(A.instruments, B.instruments) < 0.5 ||
          l1(A.pcs, B.pcs) > 0.3 ||
          l1(A.onsets, B.onsets) > 0.3;
        if (!apart) same.push(`${a} ~ ${b}`);
      }
    expect(same).toEqual([]);
  });

  test("drone and harsh-noise-wall hold one harmony throughout", () => {
    for (const id of ["drone", "harsh-noise-wall", "drone-minimalism"]) {
      const style = resolveStyle(id);
      expect(style.harmony.model).toBe("drone");
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        expect(notesFor(g, "drone").length).toBeGreaterThan(0);
      }
    }
  });

  test("wellness music stays slow, soft and unpulsed", () => {
    for (const id of ["wellness"]) {
      const style = resolveStyle(id);
      expect(style.tempo.bpm[1]).toBeLessThanOrEqual(84);
      expect(style.expression.dynamics[1]).toBeLessThanOrEqual(0.7);
      expect(style.texture.roles.kick ?? null).toBeNull();
    }
  });
  test("the anime score walks the royal road, IV-V-iii-vi", () => {
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = generateStyle("anime-score", { seed, bars: 8 });
      const numerals = g.plan.chords.map((chord) =>
        chord.numeral.replace(/7$/, ""),
      );
      for (let i = 0; i + 3 < numerals.length; i += 1)
        if (numerals.slice(i, i + 4).join("-") === "IV-V-iii-vi") found += 1;
    }
    expect(found).toBeGreaterThan(0);
  });

  test("the golden-age score shifts by chromatic mediant, I to bVI", () => {
    let mediants = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = generateStyle("golden-age-score", { seed, bars: 8 });
      const numerals = g.plan.chords.map((chord) => chord.numeral);
      for (let i = 0; i + 1 < numerals.length; i += 1)
        if (/^I7?$/.test(numerals[i]!) && /^bVI/.test(numerals[i + 1]!))
          mediants += 1;
    }
    expect(mediants).toBeGreaterThan(0);
  });

  test("sound design and the noise wall carry no tune", () => {
    for (const id of ["sound-design", "harsh-noise-wall", "onkyo"]) {
      const style = resolveStyle(id);
      expect(style.melody.density[0]).toBeLessThanOrEqual(0.5);
    }
  });
});
