/**
 * Style-specific checks for the africa-mena-southasia family, where the
 * generic cards test is too coarse: every leaf has a written card, the
 * cycles add up, a raga's forbidden svaras never sound, the Ewe bell
 * keeps its seven strokes, and a tala's rests stay silent.
 */

import { describe, expect, test } from "bun:test";
import * as FAMILY from "./africa-mena-southasia.ts";
import { generateStyle } from "./generate.ts";
import { LEAF_IDS, STYLE_CARDS, resolveStyle, stylePath } from "./index.ts";
import type { CycleSpec } from "./schema.ts";

const ROOTS = ["africa", "mena", "south-asia"];
const SEEDS = [1, 2, 3, 4, 5];
const BARS = 16;

const mod = (n: number, m: number) => ((n % m) + m) % m;

function notesOn(id: string, seed: number, trackIds: readonly string[]) {
  const generated = generateStyle(id, { seed, bars: BARS });
  const notes = (generated.data.notes ?? []).filter((note) =>
    trackIds.includes(note.trackId),
  );
  return { generated, notes };
}

describe("africa-mena-southasia cards", () => {
  test("every taxonomy leaf under the family's roots has a written card", () => {
    const mine = LEAF_IDS.filter((id) =>
      ROOTS.includes(resolveStyle(id).lineage[0]!),
    );
    expect(mine.length).toBe(78);
    expect(mine.filter((id) => !STYLE_CARDS.has(id))).toEqual([]);
  });

  test("every leaf carries a theory note naming its concepts", () => {
    const thin = LEAF_IDS.filter(
      (id) =>
        ROOTS.includes(resolveStyle(id).lineage[0]!) &&
        (STYLE_CARDS.get(id)?.summary ?? "").length < 60,
    );
    expect(thin).toEqual([]);
  });

  test("every cycle's strokes fill its divisions; stress and release lie inside", () => {
    const cycles = Object.values(FAMILY).filter(
      (value): value is CycleSpec =>
        typeof value === "object" &&
        value !== null &&
        "strokes" in value &&
        "divisions" in value,
    );
    expect(cycles.length).toBeGreaterThan(20);
    for (const cycle of cycles) {
      expect(cycle.strokes.length).toBe(cycle.beats);
      expect(cycle.divisions.reduce((a, b) => a + b, 0)).toBe(cycle.beats);
      for (const at of [...cycle.stress, ...(cycle.release ?? [])]) {
        expect(at).toBeGreaterThanOrEqual(1);
        expect(at).toBeLessThanOrEqual(cycle.beats);
      }
    }
    // Teental: 4+4+4+4, sam on 1, khali (the open, bayan-less vibhag) on 9.
    expect(FAMILY.TEENTAL.divisions).toEqual([4, 4, 4, 4]);
    expect(FAMILY.TEENTAL.stress[0]).toBe(1);
    expect(FAMILY.TEENTAL.release).toContain(9);
    expect(FAMILY.TEENTAL.stress).not.toContain(9);
    // Rupak is the tala whose sam is khali.
    expect(FAMILY.RUPAK.release).toContain(1);
  });

  test("a raga's forbidden svaras never sound", () => {
    // dhrupad and thillana: malkauns/hindolam (no Re, Ga, Pa, Dha, Ni
    // shuddha); kriti: mayamalavagowla; hindustani-instrumental: kafi.
    for (const id of [
      "dhrupad",
      "thillana",
      "kriti",
      "hindustani-instrumental",
      "carnatic-instrumental",
    ]) {
      const raga = resolveStyle(id).pitch.raga!;
      const allowed = new Set(
        [...raga.aroha, ...raga.avaroha].map((d) => mod(d, 12)),
      );
      for (const seed of SEEDS) {
        const { generated, notes } = notesOn(id, seed, ["lead", "counter"]);
        expect(notes.length).toBeGreaterThan(0);
        const root = generated.plan.rootKey;
        const bad = notes.filter((n) => !allowed.has(mod(n.pitch - root, 12)));
        expect(bad.map((n) => `${id}#${seed} ${n.pitch}`)).toEqual([]);
      }
    }
    // Malkauns has neither Re (2) nor Pa (7).
    for (const seed of SEEDS) {
      const { generated, notes } = notesOn("dhrupad", seed, ["lead"]);
      const pcs = new Set(
        notes.map((n) => mod(n.pitch - generated.plan.rootKey, 12)),
      );
      expect(pcs.has(2) || pcs.has(7)).toBe(false);
    }
  });

  test("the Ewe bell keeps the 2-2-1-2-2-2-1 standard pattern", () => {
    for (const seed of SEEDS) {
      const { generated, notes } = notesOn("ewe-drumming", seed, ["bell"]);
      const { barTicks } = generated.plan;
      const step = barTicks / 12;
      const steps = new Set(
        notes.map((n) => mod(Math.round(n.startTick! / step), 12)),
      );
      expect([...steps].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    }
  });

  test("a tala's rests stay silent (deepchandi 3+4+3+4 in thumri)", () => {
    const cycle = FAMILY.DEEPCHANDI;
    const rests = cycle.strokes
      .map((stroke, i) => (stroke === "." ? i : -1))
      .filter((i) => i >= 0);
    expect(rests).toEqual([2, 6, 9, 13]);
    for (const seed of SEEDS) {
      const { generated, notes } = notesOn("thumri", seed, ["perc"]);
      expect(notes.length).toBeGreaterThan(0);
      const pulse = generated.plan.barTicks / generated.plan.beatsPerBar;
      const hit = notes.map((n) =>
        mod(Math.round(n.startTick! / pulse), cycle.beats),
      );
      expect(hit.filter((at) => rests.includes(at))).toEqual([]);
    }
  });

  test("maqam leaves sound in their quarter-tone tuning", () => {
    for (const [id, tuning] of [
      ["arabic-classical", "bayati"],
      ["muwashshah", "rast"],
      ["persian-classical", "shur"],
      ["mugham", "segah"],
    ] as const) {
      const generated = generateStyle(id, { seed: 1, bars: 8 });
      expect(generated.data.tuning?.name).toBe(tuning);
    }
  });
});

describe("africa-mena-southasia: defining patterns", () => {
  const steps16 = (id: string, track: string, seed: number) => {
    const { generated, notes } = notesOn(id, seed, [track]);
    const step = generated.plan.barTicks / 16;
    return [
      ...new Set(notes.map((n) => mod(Math.round(n.startTick! / step), 16))),
    ].sort((a, b) => a - b);
  };

  test("afrobeat's bell is Tony Allen's clave, not straight eighths", () => {
    for (const seed of [1, 2, 3])
      expect(steps16("afrobeat", "bell", seed)).toEqual([0, 3, 6, 10, 12]);
  });

  test("the djembe ensemble's kenkeni bell sits on the off-beats", () => {
    for (const seed of [1, 2, 3])
      expect(steps16("west-african-drum", "bell", seed)).toEqual([
        2, 6, 10, 14,
      ]);
  });

  test("mande pop and the Ewe ensemble lope in 12/8", () => {
    for (const id of ["mande-pop", "ewe-drumming"])
      expect(generateStyle(id, { seed: 1, bars: 8 }).plan.signature).toBe(
        "12/8",
      );
  });

  test("afrobeats leaves the log drum to amapiano", () => {
    expect(resolveStyle("afrobeats").summary).not.toContain("log");
  });
});

/**
 * A listener could tell sibling leaves apart: each leaf's generated output
 * (tempo, per-role onset grid, pitch-class histogram over three seeds) sits
 * nearer its own centroid than any sibling's.
 */
describe("africa-mena-southasia: siblings are distinguishable", () => {
  const MINE = LEAF_IDS.filter((id) => ROOTS.includes(stylePath(id)[0]!));
  const RHYTHM = ["kick", "snare", "clap", "hat", "openhat", "rim", "tom"];
  const RHYTHM2 = [...RHYTHM, "perc", "shaker", "bell", "bass", "chords"];
  const PITCHED = ["bass", "chords", "lead", "counter", "pad", "arp"];
  const print = (id: string, seed: number): number[] => {
    const g = generateStyle(id, { seed, bars: 8 });
    const { plan } = g;
    const v = [plan.bpm / 40, plan.stepsPerBar === 12 ? 2 : 0];
    const rows = RHYTHM2.map(() => new Array<number>(16).fill(0));
    const pcs = new Array<number>(12).fill(0);
    let pitched = 0;
    for (const note of g.data.notes ?? []) {
      const role = plan.noteRoles.get(note.id) ?? "";
      const tick = (note.startTick ?? 0) % plan.barTicks;
      const row = rows[RHYTHM2.indexOf(role)];
      if (row) row[Math.floor((tick / plan.barTicks) * 16)]! += 1 / plan.bars;
      if (PITCHED.includes(role)) {
        pcs[mod(note.pitch - plan.tonic, 12)]! += 1;
        pitched++;
      }
    }
    for (const row of rows) v.push(...row.map((x) => Math.min(x, 2) / 2));
    v.push(...pcs.map((x) => (6 * x) / (pitched || 1)));
    return v;
  };
  const dist = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]!) ** 2, 0));

  test("every leaf is nearer its own centroid than a sibling's", () => {
    const parent = new Map(
      MINE.map((id) => [id, stylePath(id).at(-2) ?? ""] as const),
    );
    const prints = new Map(
      MINE.map((id) => [id, [1, 2, 3].map((s) => print(id, s))]),
    );
    const centre = new Map(
      [...prints].map(([id, fs]) => [
        id,
        fs[0]!.map((_, i) => fs.reduce((sum, f) => sum + f[i]!, 0) / fs.length),
      ]),
    );
    const close: string[] = [];
    for (const a of MINE)
      for (const b of MINE) {
        if (a === b || parent.get(a) !== parent.get(b)) continue;
        for (const f of prints.get(a)!)
          if (dist(f, centre.get(a)!) >= dist(f, centre.get(b)!))
            close.push(`${a}~${b}`);
      }
    expect(close).toEqual([]);
  }, 120_000);
});
