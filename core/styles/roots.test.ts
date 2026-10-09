/**
 * Style-specific checks for the roots lane (jazz, blues, R&B/soul/funk,
 * gospel, country, North American folk). cards.test.ts runs the generic
 * pattern checks on every card; this file pins the theory each card names
 * where a generic check is too weak.
 */

import { describe, expect, test } from "bun:test";
import { generateStyle, stripSeventh, type StylePlan } from "./generate.ts";
import { LEAF_IDS, STYLE_CARDS, resolveStyle, stylePath } from "./index.ts";
import {
  BLUES_FORM,
  EIGHT_BAR_BLUES,
  ENDING_FORM,
  QUICK_CHANGE_FORM,
  ROOTS_CARDS,
  SON_CLAVE,
  TRESILLO,
} from "./roots.ts";

const FAMILIES = [
  "jazz",
  "blues",
  "rnb-soul",
  "gospel-sacred",
  "country",
  "north-american-folk",
];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MINE = LEAF_IDS.filter((id) => FAMILIES.includes(stylePath(id)[0]!));

const onsets = (grid: readonly number[]) =>
  grid.flatMap((v, i) => (v > 0 ? [i] : []));

type Generated = ReturnType<typeof generateStyle>;
const gen = (id: string, seed: number, bars = 12): Generated =>
  generateStyle(id, { seed, bars });

/** Note start steps per bar for one role. */
function stepsOf(g: Generated, role: string): Map<number, Set<number>> {
  const plan: StylePlan = g.plan;
  const out = new Map<number, Set<number>>();
  for (const note of g.data.notes ?? []) {
    if (plan.noteRoles.get(note.id) !== role) continue;
    const tick = note.startTick ?? 0;
    const bar = Math.floor(tick / plan.barTicks);
    const step = Math.round((tick - bar * plan.barTicks) / plan.stepTicks);
    if (!out.has(bar)) out.set(bar, new Set());
    out.get(bar)!.add(step);
  }
  return out;
}

const roleNotes = (g: Generated, role: string) =>
  (g.data.notes ?? []).filter((note) => g.plan.noteRoles.get(note.id) === role);

describe("roots lane: coverage", () => {
  test("all 99 roots leaves carry their own card", () => {
    expect(MINE.length).toBe(99);
    expect(MINE.filter((id) => !STYLE_CARDS.has(id))).toEqual([]);
  });

  test("every roots card names its theory in a real summary", () => {
    for (const card of ROOTS_CARDS) {
      expect(FAMILIES).toContain(stylePath(card.id)[0]!);
      expect(card.summary?.length ?? 0).toBeGreaterThan(40);
    }
  });

  test("blues and old-time leaves never fall back to pop axis loops", () => {
    const pop = new Set(["axis", "canon", "sad-pop"]);
    const strict = MINE.filter((id) => {
      const path = stylePath(id);
      return (
        path[0] === "blues" ||
        [
          "old-time",
          "bluegrass",
          "honky-tonk",
          "bakersfield",
          "western-swing",
        ].includes(id) ||
        [
          "appalachian",
          "sacred-harp",
          "cajun",
          "zydeco",
          "barbershop",
        ].includes(id)
      );
    });
    expect(strict.length).toBeGreaterThan(20);
    const bad = strict.filter((id) =>
      (resolveStyle(id).harmony.presets ?? []).some(([name]) => pop.has(name)),
    );
    expect(bad).toEqual([]);
  });
});

describe("roots lane: rhythm cells", () => {
  test("son clave 3-2 sits on 0, 3, 6 | 10, 12", () => {
    expect(onsets(SON_CLAVE)).toEqual([0, 3, 6, 10, 12]);
  });

  test("tresillo is 3+3+2 twice per bar", () => {
    expect(onsets(TRESILLO)).toEqual([0, 3, 6, 8, 11, 14]);
  });

  test("backbeat styles put the snare on beats 2 and 4 of every bar", () => {
    for (const id of ["motown", "northern-soul", "honky-tonk", "country-pop"])
      for (const seed of SEEDS.slice(0, 3)) {
        const g = gen(id, seed, 8);
        const per = g.plan.stepsPerBar / 4;
        for (const [bar, steps] of stepsOf(g, "snare")) {
          expect(`${id}#${seed} bar ${bar}: ${steps.has(per)}`).toBe(
            `${id}#${seed} bar ${bar}: true`,
          );
          expect(steps.has(3 * per)).toBe(true);
        }
      }
  });

  test("swing-era and bebop jazz swing their eighths", () => {
    for (const id of [
      "big-band-swing",
      "kansas-city-jazz",
      "bebop",
      "hard-bop",
    ])
      for (const seed of SEEDS)
        expect(gen(id, seed).plan.swing).toBeGreaterThan(1.4);
  });

  test("bluegrass has no kit, a sixteenth banjo roll and backbeat chop", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const g = gen("bluegrass", seed, 8);
      for (const role of ["kick", "snare", "hat"])
        expect(roleNotes(g, role)).toEqual([]);
      for (const steps of stepsOf(g, "chords").values())
        for (const step of steps) expect([4, 12]).toContain(step);
      expect(roleNotes(g, "arp").length).toBeGreaterThan(8 * 8);
    }
  });

  test("katajjaq answers the voiced motif with off-beat pulses", () => {
    for (const seed of SEEDS) {
      const g = gen("inuit-throat", seed, 8);
      let pulses = 0;
      for (const steps of stepsOf(g, "arp").values())
        for (const step of steps) {
          pulses += 1;
          expect(step % 2).toBe(1);
        }
      expect(pulses).toBeGreaterThan(8);
      const lead = [...stepsOf(g, "lead").values()].flatMap((s) => [...s]);
      const onBeat = lead.filter((step) => step % 2 === 0).length;
      expect(onBeat / lead.length).toBeGreaterThan(0.6);
    }
  });
});

describe("roots lane: harmony", () => {
  const plain = (numerals: readonly string[]) =>
    numerals.map((n) => stripSeventh(n.replace("[7]", "")));
  const tile = (form: readonly string[], bars: number) =>
    Array.from({ length: bars }, (_, i) => form[i % form.length]!);

  test("the blues forms are the textbook changes", () => {
    expect(plain(BLUES_FORM).join(" ")).toBe("I I I I IV IV I I V IV I V");
    expect(plain(QUICK_CHANGE_FORM).join(" ")).toBe(
      "I IV I I IV IV I I V IV I V",
    );
    expect(plain(ENDING_FORM).join(" ")).toBe("I I I I IV IV I I V IV I I");
    expect(plain(EIGHT_BAR_BLUES).join(" ")).toBe("I V IV IV I V I V");
  });

  test("functional blues leaves play a blues form bar for bar", () => {
    const forms = [BLUES_FORM, QUICK_CHANGE_FORM, ENDING_FORM, EIGHT_BAR_BLUES];
    const blues = MINE.filter(
      (id) =>
        stylePath(id)[0] === "blues" &&
        resolveStyle(id).harmony.model === "functional" &&
        (resolveStyle(id).harmony.forms?.length ?? 0) > 0,
    );
    expect(blues.length).toBeGreaterThan(10);
    for (const id of blues) {
      let formed = 0;
      for (const seed of SEEDS) {
        const g = gen(id, seed);
        if (g.plan.harmonySource !== "form") continue;
        formed += 1;
        const got = plain(g.plan.chords.map((c) => c.numeral)).join(" ");
        const match = forms.some(
          (form) => plain(tile(form, 12)).join(" ") === got,
        );
        expect(`${id}#${seed} ${got} ${match}`).toBe(
          `${id}#${seed} ${got} true`,
        );
      }
      expect(`${id} formed ${formed >= SEEDS.length / 2}`).toBe(
        `${id} formed true`,
      );
    }
  });

  test("blues chords are dominant sevenths", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const g = gen("chicago-blues", seed);
      if (g.plan.harmonySource !== "form") continue;
      for (const chord of g.plan.chords) expect(chord.pcs.length).toBe(4);
    }
  });

  test("barbershop circles the dominant sevenths III7-VI7-II7-V7", () => {
    const chain = resolveStyle("barbershop").harmony.chain!;
    expect(chain["III7"]!.map(([n]) => n)).toEqual(["VI7"]);
    expect(chain["VI7"]!.map(([n]) => n)).toEqual(["II7"]);
    expect(chain["II7"]!.map(([n]) => n)).toEqual(["V7"]);
    expect(chain["V7"]!.map(([n]) => n)).toEqual(["I"]);
  });

  test("drone and unharmonised traditions play no chords", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      expect(gen("appalachian", seed, 8).plan.harmonySource).toBe("drone");
      for (const id of ["native-american", "inuit-throat"]) {
        const g = gen(id, seed, 8);
        expect(g.plan.harmonySource).toBe("none");
        expect(roleNotes(g, "chords")).toEqual([]);
        expect(roleNotes(g, "bass")).toEqual([]);
      }
    }
  });
});

describe("roots lane: meter", () => {
  test("each meter-defined style keeps its meter", () => {
    const want: Record<string, string[]> = {
      ragtime: ["2/4"],
      "swamp-pop": ["12/8"],
      cajun: ["2/4", "3/4"],
      "old-time": ["2/4", "4/4"],
      "traditional-gospel": ["12/8"],
    };
    for (const [id, meters] of Object.entries(want))
      for (const seed of SEEDS)
        expect(meters).toContain(gen(id, seed, 8).plan.signature);
  });
});

describe("roots lane: critic fixes", () => {
  // Late swung off-beats can round onto the next barline: fold them back.
  const steps = (g: Generated, role: string) =>
    [...stepsOf(g, role).values()].flatMap((set) =>
      [...set].map((step) => step % g.plan.stepsPerBar),
    );
  const fourFour = (id: string) =>
    SEEDS.map((seed) => gen(id, seed, 8)).filter(
      (g) => g.plan.signature === "4/4" && g.plan.stepsPerBar === 8,
    );

  test("the jazz ride plays spang-a-lang: 1, 2 &, 3, 4 &", () => {
    const allowed = new Set([0, 2, 3, 4, 6, 7]);
    const gs = fourFour("bebop");
    expect(gs.length).toBeGreaterThan(0);
    for (const g of gs) {
      const ride = steps(g, "openhat");
      expect(ride.length).toBeGreaterThan(0);
      for (const step of ride) expect(allowed).toContain(step);
      for (const beat of [0, 2, 4, 6]) expect(ride).toContain(beat);
    }
  });

  test("boogie-woogie bass is eight to the bar", () => {
    for (const seed of SEEDS) {
      const g = gen("boogie-woogie", seed, 8);
      // Every eighth of every bar but perhaps the final cadence.
      expect(roleNotes(g, "bass").length).toBeGreaterThanOrEqual(
        g.plan.stepsPerBar * (g.plan.bars - 1),
      );
    }
  });

  test("cool jazz plays brushes with no bass drum", () => {
    for (const seed of SEEDS) {
      const g = gen("cool-jazz", seed, 8);
      expect(roleNotes(g, "kick")).toHaveLength(0);
      expect(roleNotes(g, "snare").length).toBeGreaterThan(0);
    }
  });

  test("funk revue ghosts the snare; P-Funk keeps a plain backbeat", () => {
    const perBar = (id: string) => {
      let hits = 0;
      let bars = 0;
      for (const seed of SEEDS) {
        const g = gen(id, seed, 8);
        hits += roleNotes(g, "snare").length;
        bars += g.plan.bars;
      }
      return hits / bars;
    };
    expect(perBar("funk-band")).toBeGreaterThan(perBar("p-funk") * 1.8);
  });

  test("Nashville sound swaps the snare for a cross-stick", () => {
    for (const seed of SEEDS) {
      const g = gen("nashville-sound", seed, 8);
      expect(roleNotes(g, "snare")).toHaveLength(0);
      expect(roleNotes(g, "rim").length).toBeGreaterThan(0);
    }
  });

  test("outlaw country thumps the kick on every beat", () => {
    for (const g of SEEDS.map((seed) => gen("outlaw-country", seed, 8))) {
      const beat = g.plan.stepsPerBar / 4;
      const kicks = steps(g, "kick");
      for (const b of [0, 1, 2, 3]) expect(kicks).toContain(b * beat);
    }
  });

  test("honky-tonk walks; red dirt two-steps faster on root-fifth", () => {
    const bpm = (id: string) =>
      SEEDS.reduce((sum, seed) => sum + gen(id, seed, 4).plan.bpm, 0) /
      SEEDS.length;
    expect(bpm("texas-red-dirt")).toBeGreaterThan(bpm("honky-tonk"));
    expect(bpm("honky-tonk")).toBeGreaterThan(bpm("nashville-sound"));
  });
});

/**
 * A listener could tell sibling leaves apart: each leaf's generated output
 * (tempo, per-role onset grid, pitch-class histogram over three seeds) sits
 * nearer its own centroid than any sibling's.
 */
describe("roots lane: siblings are distinguishable", () => {
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
        pcs[(((note.pitch - plan.tonic) % 12) + 12) % 12]! += 1;
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
