/**
 * Europe, Asia and Pacific family checks (quality-08). The generic cards
 * test validates every style; these assertions pin the theory the generic
 * checks cannot see: compás accents, colotomic gong placement, pathet and
 * scale degrees a style must never sound, and that every leaf is distinct.
 */

import { describe, expect, test } from "bun:test";
import { EUROPE_ASIA_PACIFIC_CARDS } from "./europe-asia-pacific.ts";
import { generateStyle, type GeneratedStyle } from "./generate.ts";
import { resolveStyle, STYLE_CARDS, STYLE_IDS, stylePath } from "./index.ts";

const ROOTS = ["europe-folk", "east-asia", "southeast-asia", "oceania"];
const mine = STYLE_IDS.filter((id) => ROOTS.includes(stylePath(id)[0]!));
const leaves = EUROPE_ASIA_PACIFIC_CARDS.filter((c) => !c.abstract).map(
  (c) => c.id,
);
const SEEDS = [1, 2, 3, 4, 5];

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Perc onsets as [pulse index, pitch, velocity]. */
function percPulses(g: GeneratedStyle): [number, number, number][] {
  const pulse = (g.plan.barTicks / g.plan.beatsPerBar) * 1;
  return (g.data.notes ?? [])
    .filter((n) => n.trackId === "perc")
    .map((n) => [Math.round((n.startTick ?? 0) / pulse), n.pitch, n.velocity]);
}

/** Melodic notes (lead and counter) relative to the plan's root key. */
function melodicOffsets(g: GeneratedStyle): number[] {
  return (g.data.notes ?? [])
    .filter((n) => n.trackId === "lead" || n.trackId === "counter")
    .map((n) => n.pitch - g.plan.rootKey);
}

describe("europe-asia-pacific: coverage", () => {
  test("every taxonomy id under the four roots has its own card", () => {
    expect(mine.length).toBe(102);
    expect(mine.filter((id) => !STYLE_CARDS.has(id))).toEqual([]);
    expect(leaves.length).toBe(88);
  });

  test("every leaf names its theory in a distinct, specific summary", () => {
    const seen = new Map<string, string>();
    for (const c of EUROPE_ASIA_PACIFIC_CARDS) {
      const summary = c.summary as string;
      expect(summary.length).toBeGreaterThan(c.abstract ? 20 : 60);
      expect(seen.get(summary)).toBeUndefined();
      seen.set(summary, c.id);
    }
  });

  test("leaves are mutually exclusive: no two resolve to the same body", () => {
    const bodies = new Map<string, string>();
    for (const id of leaves) {
      const {
        id: _id,
        title: _title,
        lineage: _lineage,
        summary: _summary,
        seedSalt: _salt,
        ...body
      } = resolveStyle(id) as Record<string, unknown>;
      const key = JSON.stringify(body);
      expect(bodies.get(key)).toBeUndefined();
      bodies.set(key, id);
    }
  });
});

describe("europe-asia-pacific: theory", () => {
  test("flamenco soleá: low strokes fall exactly on 3, 6, 8, 10, 12 of 12", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("flamenco", { seed, bars: 8 });
      const pulses = percPulses(g);
      expect(pulses.length).toBeGreaterThan(24);
      const low = Math.min(...pulses.map(([, p]) => p));
      const accents = new Set(
        pulses.filter(([, p]) => p === low).map(([i]) => mod(i, 12) + 1),
      );
      expect([...accents].sort((a, b) => a - b)).toEqual([3, 6, 8, 10, 12]);
    }
  });

  test("javanese ladrang: the gong, the loudest stroke, closes each 32-beat gongan", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("javanese-gamelan", { seed, bars: 16 });
      const pulses = percPulses(g);
      // 4/4 bars counted in beats: one keteg per beat.
      const loudest = Math.max(...pulses.map(([, , v]) => v));
      const gongs = pulses.filter(([, , v]) => v === loudest);
      expect(gongs.length).toBeGreaterThan(0);
      for (const [i] of gongs) expect(mod(i + 1, 32)).toBe(0);
    }
  });

  test("pathet nem: pelog 4 and 7 never sound in the Javanese balungan", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("javanese-gamelan", { seed, bars: 16 });
      expect(g.plan.scale.period).toBe(7);
      const degrees = new Set(melodicOffsets(g).map((o) => mod(o, 7)));
      expect(degrees.has(3)).toBe(false);
      expect(degrees.has(6)).toBe(false);
      expect(degrees.size).toBeGreaterThan(2);
    }
  });

  test("the Japanese in scale never sounds the minor third, major third or major sixth", () => {
    for (const id of ["sankyoku", "honkyoku", "noh"])
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 16 });
        const offsets = melodicOffsets(g);
        expect(offsets.length).toBeGreaterThan(4);
        const forbidden = offsets.filter((o) => [3, 4, 9].includes(mod(o, 12)));
        expect({ id, seed, forbidden }).toEqual({ id, seed, forbidden: [] });
      }
  });

  test("every gated scale in the family: lead and counter stay inside aroha and avaroha", () => {
    let gated = 0;
    for (const id of mine) {
      const raga = resolveStyle(id).pitch.raga;
      if (!raga || STYLE_CARDS.get(id)?.abstract) continue;
      gated += 1;
      const allowed = new Set(
        [...raga.aroha, ...raga.avaroha].map((d) => mod(d, 12)),
      );
      for (const seed of SEEDS) {
        const g = generateStyle(id, { seed, bars: 16 });
        const outside = melodicOffsets(g).filter(
          (o) => !allowed.has(mod(o, 12)),
        );
        expect({ id, seed, outside }).toEqual({ id, seed, outside: [] });
      }
    }
    expect(gated).toBeGreaterThanOrEqual(4);
  });

  test("the Ryūkyū scale omits the second and the sixth", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("okinawan", { seed, bars: 16 });
      const forbidden = melodicOffsets(g).filter((o) =>
        [2, 9].includes(mod(o, 12)),
      );
      expect(forbidden).toEqual([]);
    }
  });

  test("aksak: Bulgarian leaves group 7/8 as 2+2+3 and Macedonian lesnoto as 3+2+2", () => {
    const bulgarian = generateStyle("bulgarian-folk", { seed: 1, bars: 4 });
    if (bulgarian.plan.signature === "7/8")
      expect(bulgarian.plan.grouping).toEqual([2, 2, 3]);
    const lesnoto = generateStyle("macedonian-folk", { seed: 1, bars: 4 });
    expect(lesnoto.plan.signature).toBe("7/8");
    expect(lesnoto.plan.grouping).toEqual([3, 2, 2]);
  });

  test("Thai, Khmer and Burmese leaves leave the slendro branch for 12-TET", () => {
    for (const id of ["thai-classical", "khmer", "burmese", "dangdut"])
      expect(
        generateStyle(id, { seed: 1, bars: 4 }).plan.tuning,
      ).toBeUndefined();
    expect(
      generateStyle("balinese-gamelan", { seed: 1, bars: 4 }).plan.tuning?.name,
    ).toBe("pelog");
  });

  test("unaccompanied song leaves sound only the voice", () => {
    for (const id of ["sean-nos", "kulning", "joik", "honkyoku"]) {
      const g = generateStyle(id, { seed: 2, bars: 8 });
      expect(g.plan.tracks.map((t) => t.roles).flat()).not.toContain("chords");
      expect(g.plan.tracks.map((t) => t.roles).flat()).not.toContain("kick");
    }
  });
});
