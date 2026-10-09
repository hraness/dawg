/**
 * Caribbean and Latin America (quality-08): style-specific assertions the
 * generic cards test is too weak to catch. The timelines are checked as
 * theory (exact onset sets) and then in generated notes: across seeds the
 * clave, dembow, one-drop and sesquialtera roles land exactly on their
 * cells, never off them.
 */

import { describe, expect, test } from "bun:test";
import { AMERICAS_CARDS } from "./americas.ts";
import { onsetSteps, TIMELINES, timelineCycle } from "./cycles.ts";
import { generateStyle, KIT_PITCH } from "./generate.ts";
import { resolveStyle } from "./index.ts";
import { TAXONOMY_ROWS } from "./taxonomy.ts";
import { validateGenerated } from "./validate.ts";

const SEEDS = [1, 2, 3, 4, 5];
const BARS = 8;

const family = (id: string): string[] => resolveStyle(id).lineage.slice();
const leaves = AMERICAS_CARDS.filter((c) => !c.abstract).map((c) => c.id);

/**
 * Step positions (within one bar) of a role's notes, rounded to the grid
 * so humanize offsets do not count, unioned across seeds. Bars that end a
 * fill period (`rhythm.fills.every`) are skipped: fills are meant to break
 * the pattern.
 */
function onsets(id: string, role: string): number[] {
  const out = new Set<number>();
  for (const seed of SEEDS) {
    const { plan, data } = generateStyle(id, { seed, bars: BARS });
    const track = plan.tracks.find((t) => t.roles.includes(role as never));
    if (!track) throw new Error(`${id}: no ${role} track`);
    const onKit = track.instrument === "drums";
    const every = plan.style.rhythm.fills?.every ?? 0;
    for (const note of data.notes ?? []) {
      if (note.trackId !== track.trackId) continue;
      if (onKit && note.pitch !== KIT_PITCH[role]) continue;
      const tick = note.startTick ?? 0;
      const bar = Math.floor(tick / plan.barTicks + 0.01);
      if (every > 0 && bar % every === every - 1) continue;
      const step = Math.round((tick % plan.barTicks) / plan.stepTicks);
      out.add(step % plan.stepsPerBar);
    }
  }
  return [...out].sort((a, b) => a - b);
}

describe("americas timelines (theory)", () => {
  test("claves, tresillo and their rotations", () => {
    expect(onsetSteps(TIMELINES.sonClave32)).toEqual([0, 3, 6, 10, 12]);
    expect(onsetSteps(TIMELINES.sonClave23)).toEqual([2, 4, 8, 11, 14]);
    expect(onsetSteps(TIMELINES.rumbaClave32)).toEqual([0, 3, 7, 10, 12]);
    expect(onsetSteps(TIMELINES.rumbaClave23)).toEqual([2, 4, 8, 11, 15]);
    expect(onsetSteps(TIMELINES.bossaClave)).toEqual([0, 3, 6, 10, 13]);
    // 2-3 is the 3-2 clave rotated by half a cycle.
    const rotate = (steps: number[]) =>
      steps.map((s) => (s + 8) % 16).sort((a, b) => a - b);
    expect(rotate(onsetSteps(TIMELINES.sonClave32))).toEqual(
      onsetSteps(TIMELINES.sonClave23),
    );
    // Tresillo: 3+3+2 per half bar.
    expect(onsetSteps(TIMELINES.tresillo)).toEqual([0, 3, 6, 8, 11, 14]);
    expect(onsetSteps(TIMELINES.dembowSnare)).toEqual([3, 6, 11, 14]);
    // Tumbao: bombo (and of two) and ponche (four) of each 4/4 bar.
    expect(onsetSteps(TIMELINES.tumbao)).toEqual([3, 6, 11, 14]);
    // Cascara: 2 side x.x.xx.x, 3 side x.xx.x.x; 3-2 swaps the halves.
    expect(onsetSteps(TIMELINES.cascara)).toEqual([
      0, 2, 4, 5, 7, 8, 10, 11, 13, 15,
    ]);
    const rotate8 = (steps: number[]) =>
      steps.map((s) => (s + 8) % 16).sort((a, b) => a - b);
    expect(rotate8(onsetSteps(TIMELINES.cascara))).toEqual(
      onsetSteps(TIMELINES.cascara32),
    );
    // Each cascara half holds its clave half (rumba clave under 3-2).
    for (const step of onsetSteps(TIMELINES.rumbaClave32))
      expect(onsetSteps(TIMELINES.cascara32)).toContain(step);
    expect(onsetSteps(TIMELINES.cinquillo)).toEqual([
      0, 2, 3, 5, 6, 8, 10, 11, 13, 14,
    ]);
  });

  test("12-pulse cells: bembe bell and the 3:2 sesquialtera", () => {
    expect(onsetSteps(TIMELINES.bembe12)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(onsetSteps(TIMELINES.sixEight12)).toEqual([0, 6]);
    expect(onsetSteps(TIMELINES.threeFour12)).toEqual([0, 4, 8]);
    const cycle = timelineCycle("bembe", TIMELINES.bembe12);
    expect(cycle.beats).toBe(12);
    expect(cycle.strokes.filter((s) => s !== ".").length).toBe(7);
  });
});

describe("americas cards", () => {
  test("every leaf has a theory note and resolves under its family", () => {
    expect(leaves.length).toBe(98);
    for (const id of leaves) {
      const style = resolveStyle(id);
      expect(style.summary.length).toBeGreaterThan(40);
      const root = family(id)[0];
      expect(["caribbean", "latin-america"]).toContain(root!);
    }
  });

  test("clave styles keep the clave exactly", () => {
    expect(onsets("son-cubano", "bell")).toEqual([0, 3, 6, 10, 12]);
    expect(onsets("salsa", "bell")).toEqual([2, 4, 8, 11, 14]);
    expect(onsets("rumba-cubana", "bell")).toEqual([0, 3, 7, 10, 12]);
    expect(onsets("bossa-nova", "chords")).toEqual([0, 3, 6, 10, 13]);
    expect(onsets("candombe", "bell")).toEqual([0, 3, 6, 10, 12]);
  });

  test("salsa bass is the anticipated tumbao (and of two, four)", () => {
    // A 4/4 bar is eight steps: the and of two is step 3, four is step 6.
    expect(onsets("salsa", "bass")).toEqual([3, 6, 11, 14]);
    expect(onsets("salsa", "bass")).not.toContain(0);
  });

  test("reggaeton is the dembow: kick on every beat, snare on 3 6 11 14", () => {
    expect(onsets("reggaeton", "kick")).toEqual([0, 4, 8, 12]);
    expect(onsets("reggaeton", "snare")).toEqual([3, 6, 11, 14]);
  });

  test("roots reggae is a one drop: kick and rim only on three", () => {
    expect(onsets("roots-reggae", "kick")).toEqual([8]);
    expect(onsets("roots-reggae", "rim")).toEqual([8]);
    // and the skank sits on the off-beats, never on a beat
    for (const step of onsets("roots-reggae", "chords"))
      expect(step % 4).toBe(2);
  });

  test("ragga and baile funk kicks ride the tresillo", () => {
    const tresillo = onsetSteps(TIMELINES.tresillo);
    for (const id of ["ragga", "bubbling", "baile-funk"])
      for (const step of onsets(id, "kick")) expect(tresillo).toContain(step);
  });

  test("soca: four on the floor with off-beat open hats", () => {
    expect(onsets("soca", "kick")).toEqual([0, 4, 8, 12]);
    expect(onsets("soca", "openhat")).toEqual([2, 6, 10, 14]);
  });

  test("tango marcato accents all four beats", () => {
    expect(onsets("tango", "chords")).toEqual([0, 4, 8, 12]);
  });

  test("sesquialtera: 6/8 dotted pulse against 3/4 strum", () => {
    for (const id of ["chacarera", "cueca", "guajira", "mariachi"]) {
      const { plan } = generateStyle(id, { seed: 1, bars: 2 });
      expect(plan.signature).toBe("6/8");
      expect(plan.stepsPerBar).toBe(12);
    }
    expect(onsets("chacarera", "kick")).toEqual([0, 6]);
    expect(onsets("chacarera", "chords")).toEqual([0, 4, 8]);
    expect(onsets("cueca", "clap")).toEqual([0, 6]);
    expect(onsets("mariachi", "bass")).toEqual([0, 6]);
  });

  test("santeria plays the seven-stroke bembe bell as its cycle", () => {
    const { plan } = generateStyle("santeria", { seed: 1, bars: 2 });
    expect(plan.signature).toBe("12/8");
    expect(onsets("santeria", "perc")).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  test("bossa nova harmony uses the tritone substitute and sevenths", () => {
    const style = resolveStyle("bossa-nova");
    const numerals = (style.harmony.forms ?? []).flatMap(([form]) => form);
    expect(numerals).toContain("bII7");
    expect(style.harmony.sevenths).toBeGreaterThan(0.9);
  });

  test("drone and chant traditions carry no chord track", () => {
    for (const id of [
      "rumba-cubana",
      "santeria",
      "bomba",
      "gwo-ka",
      "capoeira",
    ]) {
      const { plan } = generateStyle(id, { seed: 1, bars: 2 });
      expect(plan.tracks.some((t) => t.roles.includes("chords"))).toBe(false);
    }
  });

  test("every leaf passes every pattern check for five seeds", () => {
    const failures: string[] = [];
    for (const id of leaves)
      for (const seed of SEEDS) {
        const report = validateGenerated(
          generateStyle(id, { seed, bars: BARS }),
        );
        for (const c of report.checks)
          if (!c.ok) failures.push(`${id}#${seed} ${c.name}: ${c.detail}`);
      }
    expect(failures).toEqual([]);
  }, 120_000);

  test("critic fixes: mambo campana, lovers rock major sevenths, banda tuba", () => {
    expect(onsets("mambo", "bell")).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    const lovers = resolveStyle("lovers-rock");
    expect(lovers.pitch.scales.map(([s]) => s)).toEqual(["major"]);
    const numerals = (lovers.harmony.forms ?? []).flatMap(([f]) => f);
    expect(numerals).toContain("Imaj7");
    // banda tuba moves every eighth; norteno keeps the oom-pah on beats
    expect(onsets("banda", "bass")).toEqual([0, 2, 4, 6]);
    expect(onsets("norteno", "bass")).toEqual([0, 4]);
    const { plan } = generateStyle("corrido", { seed: 1, bars: 2 });
    expect(plan.tracks.some((t) => t.roles.includes("counter"))).toBe(true);
  });

  test("new leaves: songo, conga, dembow, son huasteco", () => {
    expect(onsets("songo", "bell")).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(onsets("songo", "rim")).toEqual([0, 3, 7, 10, 12]);
    expect(onsets("conga", "kick")).toEqual([7, 15]);
    expect(onsets("dembow", "kick")).toEqual([0, 4, 8, 12]);
    expect(onsets("dembow", "snare")).toEqual([3, 6, 11, 14]);
    const dembow = generateStyle("dembow", { seed: 1, bars: 2 }).plan.bpm;
    const reggaeton = generateStyle("reggaeton", { seed: 1, bars: 2 }).plan;
    expect(dembow).toBeGreaterThan(reggaeton.bpm + 10);
    const huasteco = generateStyle("son-huasteco", { seed: 1, bars: 2 }).plan;
    expect(huasteco.signature).toBe("6/8");
    const lead = huasteco.tracks.find((t) => t.roles.includes("lead"));
    expect(lead?.instrument).toBe("violin");
  });

  test("siblings are told apart by onset, pitch-class and tempo fingerprints", () => {
    // Per leaf, three seeds; each fingerprint must sit nearer its own
    // centroid than any sibling's (with a 15% margin).
    const parent = new Map(TAXONOMY_ROWS.map((r) => [r[0], r[1]]));
    const RH = ["kick", "snare", "clap", "hat", "openhat", "rim", "tom"];
    RH.push("perc", "shaker", "bell", "bass", "chords");
    const PITCHED = ["bass", "chords", "lead", "counter", "pad", "arp"];
    const fp = (id: string, seed: number): number[] => {
      const g = generateStyle(id, { seed, bars: BARS });
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
          pcs[(((note.pitch - plan.tonic) % 12) + 12) % 12]! += 1;
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
});
