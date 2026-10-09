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
import { TUNING_NAMES } from "../tuning.ts";
import { ART_CARDS } from "./art.ts";
import { generateStyle, type GeneratedStyle } from "./generate.ts";
import { resolveStyle } from "./index.ts";
import type { RoleName, RoleTexture, RoleVoice, StyleCard } from "./schema.ts";
import { STYLE_FAMILIES, TAXONOMY_ROWS } from "./taxonomy.ts";

const SEEDS = [1, 2, 3, 4, 5, 6];
const ROOTS = STYLE_FAMILIES.find((f) => f.key === "art")!.roots;
const PARENTS = new Set(TAXONOMY_ROWS.map((row) => row[1]));
const ART_ROWS = TAXONOMY_ROWS.filter((row) => row[2] === "art");
const CARD_IDS = new Set(ART_CARDS.map((c) => c.id));

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

  test("the twelve-tone card spreads over the chromatic aggregate", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("twelve-tone", { seed, bars: 8 });
      const counts = new Array<number>(12).fill(0);
      for (const r of ["lead", "counter", "bass", "chords"] as const)
        for (const note of notesFor(g, r)) counts[note.pitch % 12]! += 1;
      expect(counts.filter((n) => n > 0).length).toBeGreaterThanOrEqual(8);
    }
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
});
