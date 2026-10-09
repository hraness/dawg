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
import { TAXONOMY_ROWS } from "./taxonomy.ts";

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

/**
 * Melodic notes (lead and counter) relative to the plan's root key, in
 * semitones rounded the way the generator gates them (a quarter-tone note
 * cents offset rounds up: rast's 3.5 is 4).
 */
function melodicOffsets(g: GeneratedStyle): number[] {
  return (g.data.notes ?? [])
    .filter((n) => n.trackId === "lead" || n.trackId === "counter")
    .map((n) => Math.round(n.pitch + (n.cents ?? 0) / 100 - g.plan.rootKey));
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

  test("Thai and Khmer use the seven equidistant tones; Burmese and dangdut leave the slendro branch for 12-TET", () => {
    for (const id of ["thai-classical", "khmer"]) {
      const g = generateStyle(id, { seed: 1, bars: 8 });
      expect(g.plan.tuning?.name).toBe("thai");
      expect(g.plan.scale.period).toBe(7);
      expect(g.plan.scale.tones[1]!.semis).toBeCloseTo(12 / 7, 9);
    }
    // The two pitch levels leave different gaps in the seven.
    const thai = resolveStyle("thai-classical").pitch.degrees;
    const khmer = resolveStyle("khmer").pitch.degrees;
    expect(thai).toEqual([0, 1, 2, 4, 5]);
    expect(khmer).toEqual([0, 1, 3, 4, 5]);
    for (const id of ["burmese", "dangdut", "vietnamese"])
      expect(
        generateStyle(id, { seed: 1, bars: 4 }).plan.tuning,
      ).toBeUndefined();
    expect(
      generateStyle("balinese-gamelan", { seed: 1, bars: 4 }).plan.tuning?.name,
    ).toBe("pelog");
  });

  test("Vietnamese oán: xự and cống sound a quarter tone off the tempered third and seventh", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("vietnamese", { seed, bars: 16 });
      const quarter = (g.data.notes ?? []).filter(
        (n) => n.trackId === "lead" && Math.abs(n.cents ?? 0) === 50,
      );
      expect(quarter.length).toBeGreaterThan(0);
    }
  });

  test("Burmese si-wa: the si bell and the wa clapper alternate at the half bar", () => {
    for (const seed of SEEDS) {
      const g = generateStyle("burmese", { seed, bars: 8 });
      const half = g.plan.barTicks / 2;
      const perc = (g.data.notes ?? []).filter((n) => n.trackId === "perc");
      expect(perc.length).toBeGreaterThan(0);
      for (const n of perc)
        expect(mod(Math.round((n.startTick ?? 0) / (half / 4)), 4)).toBe(0);
      const pitches = new Set(perc.map((n) => n.pitch));
      expect(pitches.size).toBe(2);
    }
  });

  test("unaccompanied song leaves sound only the voice", () => {
    for (const id of ["sean-nos", "kulning", "joik", "honkyoku"]) {
      const g = generateStyle(id, { seed: 2, bars: 8 });
      expect(g.plan.tracks.map((t) => t.roles).flat()).not.toContain("chords");
      expect(g.plan.tracks.map((t) => t.roles).flat()).not.toContain("kick");
    }
  });
});

describe("europe-asia-pacific: critic", () => {
  test("an aksak grouping always fills its bar, and the drum strikes it", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = generateStyle("bulgarian-folk", { seed, bars: 2 });
      const { plan } = g;
      const groups = plan.grouping ?? [];
      expect(groups.reduce((a, b) => a + b, 0)).toBe(plan.beatsPerBar);
      const unit = plan.barTicks / plan.beatsPerBar;
      const starts = new Set<number>();
      let at = 0;
      for (const n of groups) {
        starts.add(at);
        at += n;
      }
      const perc = (g.data.notes ?? []).filter(
        (n) => plan.noteRoles.get(n.id) === "perc",
      );
      expect(perc.length).toBeGreaterThan(0);
      for (const n of perc) {
        const beat = ((n.startTick ?? 0) % plan.barTicks) / unit;
        expect(starts.has(mod(Math.round(beat), plan.beatsPerBar))).toBe(true);
      }
    }
  });

  test("Chinese zhi-mode leaves have the fourth and no major third; guqin the reverse", () => {
    const pcs = (id: string) => {
      const out = new Set<number>();
      for (const seed of [1, 2, 3]) {
        const g = generateStyle(id, { seed, bars: 4 });
        for (const n of g.data.notes ?? [])
          if (["lead", "counter"].includes(g.plan.noteRoles.get(n.id) ?? ""))
            out.add(mod(n.pitch - g.plan.tonic, 12));
      }
      return out;
    };
    for (const id of ["nanguan", "chinese-classical"]) {
      expect(pcs(id).has(4)).toBe(false);
      expect(pcs(id).has(5)).toBe(true);
    }
    expect(pcs("guqin").has(5)).toBe(false);
    expect(pcs("guqin").has(4)).toBe(true);
  });

  test("solo and chant leaves carry no bass; sevdalinka has no drum", () => {
    for (const id of ["guqin", "honkyoku", "shomyo", "chinese-classical"])
      expect(
        generateStyle(id, { seed: 1, bars: 2 }).plan.tracks.flatMap(
          (t) => t.roles,
        ),
      ).not.toContain("bass");
    for (const seed of [1, 2, 3])
      expect(
        generateStyle("sevdalinka", { seed, bars: 2 }).plan.tracks.flatMap(
          (t) => t.roles,
        ),
      ).not.toContain("perc");
  });

  test("siblings are told apart by onset, pitch-class and tempo fingerprints", () => {
    // Per leaf, three seeds; each fingerprint must sit nearer its own
    // centroid than any sibling's (with a 15% margin).
    const parent = new Map(TAXONOMY_ROWS.map((r) => [r[0], r[1]]));
    const RH = ["kick", "snare", "clap", "hat", "openhat", "rim", "tom"];
    RH.push("perc", "shaker", "bell", "bass", "chords", "lead");
    const PITCHED = ["bass", "chords", "lead", "counter", "pad", "arp"];
    const fp = (id: string, seed: number): number[] => {
      const g = generateStyle(id, { seed, bars: 8 });
      const { plan } = g;
      const v = [plan.bpm / 40, plan.stepsPerBar === 12 ? 2 : 0];
      const grid = RH.map(() => new Array<number>(16).fill(0));
      const pcs = new Array<number>(12).fill(0);
      let n = 0;
      for (const note of g.data.notes ?? []) {
        const role = plan.noteRoles.get(note.id) ?? "";
        const t = (note.startTick ?? 0) % plan.barTicks;
        const row = grid[RH.indexOf(role)];
        if (row) row[Math.floor((t / plan.barTicks) * 16)]! += 1 / plan.bars;
        if (PITCHED.includes(role)) {
          pcs[mod(note.pitch - plan.tonic, 12)]! += 1;
          n += 1;
        }
      }
      for (const row of grid) v.push(...row.map((x) => Math.min(x, 2) / 2));
      v.push(...pcs.map((x) => (6 * x) / (n || 1)));
      return v;
    };
    const dist = (a: number[], b: number[]) =>
      Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0));
    const prints = new Map(
      leaves.map((id) => [id, [1, 2, 3].map((s) => fp(id, s))]),
    );
    const centroid = new Map(
      [...prints].map(([id, fs]) => [
        id,
        fs[0]!.map((_, i) => fs.reduce((a, f) => a + f[i]!, 0) / fs.length),
      ]),
    );
    const close: string[] = [];
    for (const a of leaves)
      for (const b of leaves) {
        if (a === b || parent.get(a) !== parent.get(b)) continue;
        for (const f of prints.get(a)!)
          if (dist(f, centroid.get(b)!) <= dist(f, centroid.get(a)!) * 1.15) {
            close.push(`${a}~${b}`);
            break;
          }
      }
    expect(close).toEqual([]);
  }, 120_000);

  test("drumless traditions carry no inherited frame drum", () => {
    const quiet = ["gusle-epic", "albanian-iso", "rune-singing"];
    quiet.push("nordic-fiddle", "maltese", "tamburica", "breton");
    for (const id of quiet)
      for (const seed of SEEDS)
        expect({
          id,
          roles: generateStyle(id, { seed, bars: 2 }).plan.tracks.flatMap(
            (t) => t.roles,
          ),
        }).not.toMatchObject({ roles: expect.arrayContaining(["perc"]) });
  });
});
