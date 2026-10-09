/**
 * Electronic family assertions beyond the generic cards test: every card
 * names only effects a score accepts, siblings never resolve to the same
 * style, and the defining patterns (four-on-the-floor, off-beat open hat,
 * the psytrance rolling bass that never sits on the kick, half-time witch
 * house, electro's broken kick, ambient's missing kit) hold in the
 * generated notes.
 */

import { describe, expect, test } from "bun:test";
import { createScore } from "../score.ts";
import { ELECTRONIC_CARDS } from "./electronic.ts";
import { generateStyle, type GeneratedStyle } from "./generate.ts";
import { STYLE_IDS, resolveStyle, stylePath } from "./index.ts";
import { validateGenerated } from "./validate.ts";

const OWN = STYLE_IDS.filter(
  (id) =>
    stylePath(id)[0] === "electronic" &&
    !stylePath(id).includes("breakbeat-family"),
);
const SEEDS = [1, 2, 3, 4];

/** Steps within the bar (16ths) where `role` notes start, over all bars. */
function stepsOf(g: GeneratedStyle, role: string): number[] {
  const { plan, data } = g;
  const out: number[] = [];
  for (const note of data.notes ?? []) {
    if (plan.noteRoles.get(note.id) !== role) continue;
    const step = Math.round((note.startTick ?? 0) / plan.stepTicks);
    out.push(step);
  }
  return out;
}
const inBar = (g: GeneratedStyle, steps: number[]) =>
  steps.map((s) => s % g.plan.stepsPerBar);
/** Bars whose section plays `role` (the dance breakdown drops the kit). */
function barsWith(g: GeneratedStyle, role: string): Set<number> {
  const out = new Set<number>();
  for (const s of stepsOf(g, role)) out.add(Math.floor(s / g.plan.stepsPerBar));
  return out;
}

describe("electronic cards", () => {
  test("cover every electronic node outside breakbeat-family", () => {
    const ids = new Set(ELECTRONIC_CARDS.map((c) => c.id));
    expect([...ids].sort()).toEqual([...OWN].sort());
    expect(ids.size).toBe(ELECTRONIC_CARDS.length);
    expect(OWN.length).toBe(108);
  });

  test("every card carries a theory note", () => {
    for (const c of ELECTRONIC_CARDS) {
      const summary = (c as { summary?: string }).summary ?? "";
      expect(summary.length, c.id).toBeGreaterThan(30);
    }
  });

  test("generated scores load (fx are real track effects) and validate", () => {
    const bad: string[] = [];
    for (const id of OWN)
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        try {
          createScore(g.data);
        } catch (error) {
          bad.push(`${id}#${seed}: ${String(error).slice(0, 80)}`);
          continue;
        }
        for (const c of validateGenerated(g).checks)
          if (!c.ok) bad.push(`${id}#${seed} ${c.name}: ${c.detail}`);
      }
    expect(bad).toEqual([]);
  });

  test("no two leaves resolve to the same style", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const id of OWN) {
      const {
        id: _id,
        title: _t,
        lineage: _l,
        ...body
      } = resolveStyle(id) as unknown as Record<string, unknown>;
      delete body.summary;
      delete body.seedSalt;
      const key = JSON.stringify(body);
      const other = seen.get(key);
      if (other) dupes.push(`${other} = ${id}`);
      seen.set(key, id);
    }
    expect(dupes).toEqual([]);
  });
});

describe("electronic defining patterns", () => {
  test("house and trance keep a kick on every beat and none between", () => {
    for (const id of ["deep-house", "chicago-house", "trance", "gabber"])
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        const kicks = inBar(g, stepsOf(g, "kick"));
        expect(kicks.length, id).toBeGreaterThan(0);
        expect(
          kicks.filter((s) => s % 4 !== 0),
          id,
        ).toEqual([]);
        // In a bar that has a kick, all four beats have one.
        for (const bar of barsWith(g, "kick")) {
          const beats = new Set(
            stepsOf(g, "kick")
              .filter((s) => Math.floor(s / 16) === bar)
              .map((s) => s % 16),
          );
          expect(
            [...beats].sort((a, b) => a - b),
            `${id} bar ${bar}`,
          ).toEqual([0, 4, 8, 12]);
        }
      }
  });

  test("house open hat sits only on the off-beat 8ths", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("deep-house", { seed, bars: 8 });
      const hats = inBar(g, stepsOf(g, "openhat"));
      for (const s of hats) expect([2, 6, 10, 14]).toContain(s);
    }
  });

  test("psytrance bass rolls between kicks and never on them", () => {
    for (const id of ["psytrance", "dark-psy", "goa-trance"])
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        const bass = inBar(g, stepsOf(g, "bass"));
        expect(bass.length, id).toBeGreaterThan(0);
        expect(
          bass.filter((s) => s % 4 === 0),
          id,
        ).toEqual([]);
      }
  });

  test("trance and hardstyle bass is off-beat", () => {
    for (const id of ["hardstyle", "happy-hardcore", "eurodance"])
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        const bass = inBar(g, stepsOf(g, "bass"));
        expect(bass.length, id).toBeGreaterThan(0);
        for (const s of bass) expect([2, 6, 10, 14], id).toContain(s);
      }
  });

  test("electro kick is syncopated, not four-on-the-floor", () => {
    const g = generateStyle("electro", { seed: 3, bars: 8 });
    const kicks = new Set(inBar(g, stepsOf(g, "kick")));
    expect([...kicks].sort((a, b) => a - b)).toEqual([0, 6, 10, 12]);
  });

  test("witch house is half-time: the snare lands only on beat 3", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("witch-house", { seed, bars: 8 });
      expect(g.plan.subdivision).toBe(3);
      const snares = inBar(g, stepsOf(g, "snare"));
      expect(snares.length).toBeGreaterThan(0);
      for (const s of snares) expect(s).toBe(6);
    }
  });

  test("ambient leaves have no kit and a pedal bass", () => {
    const kit = ["kick", "snare", "clap", "hat", "openhat", "rim", "tom"];
    for (const id of ["ambient", "dark-ambient", "space-ambient", "new-age"])
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 8 });
        for (const role of kit)
          expect(stepsOf(g, role), `${id} ${role}`).toEqual([]);
        expect(resolveStyle(id).bass.behaviour[0]?.[0]).toBe("pedal");
      }
  });

  test("dance breakdowns drop the kick", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("trance", { seed, bars: 16 });
      const kickBars = barsWith(g, "kick");
      for (let bar = 0; bar < g.plan.bars; bar += 1) {
        const section = g.plan.sections.find(
          (s) => bar >= s.startBar && bar < s.startBar + s.bars,
        );
        if (section?.kind === "breakdown")
          expect(kickBars.has(bar), `bar ${bar}`).toBe(false);
      }
    }
  });

  test("tempo ranges match the style's theory", () => {
    const within = (id: string, lo: number, hi: number) => {
      const [a, b] = resolveStyle(id).tempo.bpm;
      expect(a, id).toBeGreaterThanOrEqual(lo);
      expect(b, id).toBeLessThanOrEqual(hi);
    };
    within("speedcore", 250, 300);
    within("gabber", 150, 220);
    within("deep-house", 115, 128);
    within("psytrance", 138, 150);
    within("trip-hop", 60, 100);
    within("amapiano", 105, 120);
    within("eurobeat", 145, 165);
  });

  test("electro swing swings triplet 8ths", () => {
    const style = resolveStyle("electro-swing");
    expect(style.groove.subdivision).toBe(2);
    expect(style.groove.swingRatio[0]).toBeGreaterThanOrEqual(1.7);
  });
});
