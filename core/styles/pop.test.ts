/**
 * Pop, hip hop and breakbeat cards (quality-08 family `pop`). The generic
 * cards test generates and validates every style; this file adds what a
 * generic check cannot see: every leaf of the lane has its own card with
 * a theory summary, grids match their meter (a mismatched grid would be
 * silently stretched), kit roles share one kit, every name resolves in its
 * registry, and the defining pattern of each style holds both in the card
 * and in generated notes.
 */

import { describe, expect, test } from "bun:test";
import { PROGRESSION_PRESETS, SCALES, MODES } from "../chords.ts";
import { TRACK_EFFECT_NAMES, FX_PRESETS, RIG_PRESETS } from "../fx.ts";
import { resolveInstrumentWord } from "../instruments.ts";
import { SYNTH_KIT_NAMES } from "../kits.ts";
import { generateStyle, parseSignature, stepsPerBarOf } from "./generate.ts";
import { STYLE_CARDS, STYLE_TREE, resolveStyle, stylePath } from "./index.ts";
import { POP_CARDS } from "./pop.ts";
import { KIT_ROLES, type RoleName } from "./schema.ts";

/** The lane's roots and branches (hip-hop is its own root). */
const BRANCHES = [
  "pop",
  "traditional-pop",
  "sixties-pop",
  "modern-pop",
  "hip-hop",
  "old-school",
  "regional-rap",
  "modern-rap",
  "breakbeat-family",
];

/** Leaves of this lane: children of the branches above. */
const LEAVES = [...STYLE_TREE.values()]
  .filter((node) => node.leaf && BRANCHES.includes(node.parent ?? ""))
  .map((node) => node.id);

const steps = (grid: readonly number[] | undefined) =>
  (grid ?? []).flatMap((p, i) => (p > 0 ? [i] : []));
const sure = (grid: readonly number[] | undefined) =>
  (grid ?? []).flatMap((p, i) => (p >= 1 ? [i] : []));

describe("pop family cards", () => {
  test("the lane has 100 leaves and every leaf and branch has a card", () => {
    expect(LEAVES.length).toBe(100);
    const ids = POP_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...BRANCHES, ...LEAVES]) expect(ids).toContain(id);
    for (const id of ids) expect(STYLE_CARDS.get(id)).toBeDefined();
    // Nothing here belongs to another lane.
    for (const id of ids)
      expect(
        ["pop", "hip-hop", "breakbeat-family"].some((top) =>
          stylePath(id).includes(top),
        ),
      ).toBe(true);
  });

  test("leaves carry a theory summary and their own seed salt", () => {
    const salts = new Set<number>();
    for (const c of POP_CARDS) {
      if (!LEAVES.includes(c.id)) continue;
      expect(typeof c.summary).toBe("string");
      expect((c.summary as string).length).toBeGreaterThan(40);
      expect(typeof c.seedSalt).toBe("number");
      salts.add(c.seedSalt as number);
    }
    expect(salts.size).toBeGreaterThan(40);
  });

  test("every role grid has exactly one bar of steps for its meter", () => {
    const bad: string[] = [];
    for (const id of [...BRANCHES, ...LEAVES]) {
      const style = resolveStyle(id);
      const subdivision = style.groove.subdivision;
      const lengths = new Set(
        style.meter.signatures.map(([sig]) => {
          const [top, bottom] = parseSignature(sig);
          return stepsPerBarOf(top, bottom, subdivision);
        }),
      );
      const grids: [string, readonly number[] | undefined][] = [
        ...Object.entries(style.rhythm.onsets),
        ["bass", style.bass.onsets],
      ];
      for (const [roleName, grid] of grids)
        if (grid && grid.length > 0 && !lengths.has(grid.length))
          bad.push(`${id}.${roleName}: ${grid.length} not in ${[...lengths]}`);
    }
    expect(bad).toEqual([]);
  });

  test("kit roles share one kit choice", () => {
    const bad: string[] = [];
    for (const id of [...BRANCHES, ...LEAVES]) {
      const roles = resolveStyle(id).texture.roles;
      const kits = new Set(
        KIT_ROLES.flatMap((r) => {
          const t = roles[r];
          return t ? [JSON.stringify(t.voices)] : [];
        }),
      );
      if (kits.size > 1) bad.push(id);
    }
    expect(bad).toEqual([]);
  });

  test("every name resolves in its registry", () => {
    const presets = new Set(PROGRESSION_PRESETS.map((p) => p.name));
    const scales = new Set([...Object.keys(SCALES), ...Object.keys(MODES)]);
    const bad: string[] = [];
    for (const id of [...BRANCHES, ...LEAVES]) {
      const s = resolveStyle(id);
      for (const [name] of s.harmony.presets ?? [])
        if (!presets.has(name)) bad.push(`${id} preset ${name}`);
      for (const [name] of s.pitch.scales)
        if (!scales.has(name)) bad.push(`${id} scale ${name}`);
      for (const [roleName, t] of Object.entries(s.texture.roles))
        for (const v of t?.voices ?? []) {
          if (v.kit && !SYNTH_KIT_NAMES.includes(v.kit))
            bad.push(`${id} kit ${v.kit}`);
          if (v.instrument !== "drums" && !resolveInstrumentWord(v.instrument))
            bad.push(`${id}.${roleName} instrument ${v.instrument}`);
          if (v.rig && !(v.rig in RIG_PRESETS)) bad.push(`${id} rig ${v.rig}`);
        }
      // Track fx: a preset of an effect that lives in `fx` (filter, delay
      // and reverb are track fields of their own, not fx entries).
      for (const [roleName, effects] of Object.entries(s.mix.fx ?? {}))
        for (const [effect, preset] of Object.entries(effects ?? {})) {
          const presets = (
            FX_PRESETS as Record<string, Record<string, unknown> | undefined>
          )[effect];
          if ((TRACK_EFFECT_NAMES as readonly string[]).includes(effect))
            bad.push(`${id}.${roleName} effect ${effect} is not a track fx`);
          else if (!presets?.[String(preset)])
            bad.push(`${id}.${roleName} ${effect} preset ${preset}`);
        }
    }
    expect(bad).toEqual([]);
  });
});

/** Bar steps of the generated notes a role plays. */
function roleSteps(id: string, role: RoleName, seed: number): number[] {
  const { plan, data } = generateStyle(id, { seed, bars: 8 });
  const every = plan.style.rhythm.fills?.every ?? 0;
  /** Fill bars (the last of each `every`) vary the grid on purpose. */
  const fillBar = (tick: number) =>
    every > 0 && Math.floor(tick / plan.barTicks) % every === every - 1;
  return (data.notes ?? [])
    .filter(
      (note) =>
        plan.noteRoles.get(note.id) === role && !fillBar(note.startTick ?? 0),
    )
    .map(
      (note) =>
        Math.round((note.startTick ?? 0) / plan.stepTicks) % plan.stepsPerBar,
    );
}

describe("pop family theory", () => {
  test("backbeat: pop and boom-bap snares land on 2 and 4", () => {
    for (const id of ["dance-pop", "golden-age", "jazz-rap", "drum-and-bass"])
      expect(sure(resolveStyle(id).rhythm.onsets.snare)).toEqual([4, 12]);
  });

  test("half-time feel: trap-era and dubstep snares land on beat 3 only", () => {
    for (const id of [
      "trap",
      "cloud-rap",
      "rage",
      "dubstep",
      "brostep",
      "halftime",
      "future-bass",
      "bass-music",
      "alt-pop",
      "hyperpop",
    ])
      expect(steps(resolveStyle(id).rhythm.onsets.snare)).toEqual([8]);
  });

  test("no leaf doubles a half-time snare with a 2-and-4 clap", () => {
    const bad: string[] = [];
    for (const id of LEAVES) {
      const o = resolveStyle(id).rhythm.onsets;
      if (o.snare?.length !== 16 || steps(o.snare).join() !== "8") continue;
      if (steps(o.clap).some((s) => s === 4 || s === 12)) bad.push(id);
    }
    expect(bad).toEqual([]);
  });

  test("drum and bass two-step: kick on 1 and the and-of-3", () => {
    expect(steps(resolveStyle("drum-and-bass").rhythm.onsets.kick)).toEqual([
      0, 10,
    ]);
    const { bpm } = resolveStyle("drum-and-bass").tempo;
    expect(bpm[0]).toBeGreaterThanOrEqual(160);
  });

  test("dembow: four-on-the-floor kick, snare on 3, 6, 11, 14 of 16", () => {
    const m = resolveStyle("moombahton").rhythm.onsets;
    expect(steps(m.kick)).toEqual([0, 4, 8, 12]);
    expect(steps(m.snare)).toEqual([3, 6, 11, 14]);
    expect(steps(resolveStyle("latin-trap").rhythm.onsets.rim)).toEqual([
      3, 6, 11, 14,
    ]);
  });

  test("tresillo 3+3+2 in latin pop kick and bass", () => {
    const s = resolveStyle("latin-pop");
    const cell = [0, 3, 6];
    const kick = steps(s.rhythm.onsets.kick);
    for (const half of [0, 8])
      for (const c of cell) expect(kick).toContain(half + c);
    expect(steps(s.bass.onsets)).toEqual(kick);
  });

  test("UK garage 2-step: no kick on beats 2 and 4", () => {
    const kick = steps(resolveStyle("uk-garage").rhythm.onsets.kick);
    expect(kick).not.toContain(4);
    expect(kick).not.toContain(12);
    expect(kick).toContain(0);
  });

  test("four-on-the-floor with off-beat hats in dance-pop, bassline, funkot", () => {
    for (const id of ["dance-pop", "bassline", "funkot"]) {
      const o = resolveStyle(id).rhythm.onsets;
      expect(steps(o.kick)).toEqual([0, 4, 8, 12]);
      expect(steps(o.hat)).toEqual([2, 6, 10, 14]);
    }
  });

  test("footwork and jersey club run on a triplet grid", () => {
    for (const id of ["footwork", "jersey-club", "southern-rap"])
      expect(resolveStyle(id).groove.subdivision).toBe(3);
  });

  test("swing: golden-age and lo-fi are swung, drill and trap are straight", () => {
    expect(resolveStyle("golden-age").groove.swingRatio[0]).toBeGreaterThan(
      1.3,
    );
    expect(resolveStyle("lofi-hip-hop").groove.swingRatio[0]).toBeGreaterThan(
      1.4,
    );
    expect(resolveStyle("trap").groove.swingRatio[1]).toBeLessThanOrEqual(1.1);
  });

  test("waltz meters: musette in 3/4, persian pop in 6/8", () => {
    expect(resolveStyle("musette").meter.signatures).toEqual([["3/4", 1]]);
    expect(resolveStyle("persian-pop").meter.signatures).toEqual([["6/8", 1]]);
  });

  test("royal road: J-pop forms use IVmaj7-V7-iii7-vi", () => {
    const forms = resolveStyle("j-pop").harmony.forms ?? [];
    expect(forms.map(([f]) => f.join(" "))).toContain("IVmaj7 V7 iii7 vi");
  });

  test("maqam pop leaves use maqam scales; kafi and khamaj for Indipop", () => {
    const names = (id: string) => resolveStyle(id).pitch.scales.map(([n]) => n);
    expect(names("arabic-pop")).toContain("hijaz");
    expect(names("turkish-pop")).toContain("hijaz");
    expect(names("indian-pop")).toEqual(
      expect.arrayContaining(["kafi", "khamaj"]),
    );
  });

  test("generated half-time leaves put the snare on beat 3", () => {
    for (const id of ["trap", "dubstep", "halftime"])
      for (const seed of [1, 7]) {
        const snare = roleSteps(id, "snare", seed);
        expect(snare.length).toBeGreaterThan(0);
        const onThree = snare.filter((s) => s === 8).length / snare.length;
        expect(onThree).toBeGreaterThan(0.8);
        // No clap doubles a half-time snare as a 2-and-4 backbeat.
        const clap = roleSteps(id, "clap", seed);
        expect(clap.filter((s) => s === 4 || s === 12).length).toBe(0);
      }
  });

  test("generated moombahton kicks are four-on-the-floor", () => {
    const kicks = roleSteps("moombahton", "kick", 3);
    expect(kicks.length).toBeGreaterThanOrEqual(8 * 4 * 0.8);
    const onBeat = kicks.filter((s) => s % 4 === 0).length / kicks.length;
    expect(onBeat).toBeGreaterThan(0.9);
  });

  test("generated boom bap snares sit on 2 and 4", () => {
    const snare = roleSteps("golden-age", "snare", 5);
    expect(snare.length).toBeGreaterThan(0);
    const back = snare.filter((s) => s === 4 || s === 12).length;
    expect(back / snare.length).toBeGreaterThan(0.8);
  });

  test("generation is deterministic per seed", () => {
    for (const id of ["hyperpop", "drill", "jungle"]) {
      const a = JSON.stringify(generateStyle(id, { seed: 11, bars: 4 }).data);
      const b = JSON.stringify(generateStyle(id, { seed: 11, bars: 4 }).data);
      expect(a).toBe(b);
    }
  });
});
