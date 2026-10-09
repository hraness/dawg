/**
 * Rock, punk and metal cards (quality-08): style-specific assertions where
 * the generic checks in cards.test.ts are too weak. Each test names the
 * theory concept it pins (backbeat, skank beat, d-beat, blast beat, gallop,
 * power chord, 12-bar form, motorik, additive meter, phrygian bII).
 */

import { describe, expect, test } from "bun:test";
import { generateStyle, type GeneratedStyle } from "./generate.ts";
import { resolveStyle, STYLE_CARDS, styleNode, stylePath } from "./index.ts";
import { ROCK_CARDS } from "./rock.ts";
import type { RoleName, StyleId } from "./schema.ts";
import { TAXONOMY_ROWS } from "./taxonomy.ts";

const SEEDS = [1, 2, 3, 4, 5];
const BARS = 8;

const rockIds = TAXONOMY_ROWS.map((row) => row[0] as StyleId).filter((id) =>
  stylePath(id).includes("rock-family" as StyleId),
);
const parents = new Set(TAXONOMY_ROWS.map((row) => row[1] as string));
const rockLeaves = rockIds.filter((id) => !parents.has(id));
const cardIds = new Set(ROCK_CARDS.map((c) => c.id as string));

/** Steps of each note of `role`, within the bar (straight-feel styles). */
function stepsOf(g: GeneratedStyle, roleName: RoleName): number[][] {
  const { plan } = g;
  const bars: number[][] = Array.from({ length: plan.bars }, () => []);
  for (const note of g.data.notes ?? []) {
    if (plan.noteRoles.get(note.id) !== roleName) continue;
    const step = Math.round((note.startTick ?? 0) / plan.stepTicks);
    const bar = Math.floor(step / plan.stepsPerBar);
    if (bar < plan.bars) bars[bar]!.push(step % plan.stepsPerBar);
  }
  return bars.map((b) => [...new Set(b)].sort((x, y) => x - y));
}

/** Bars that are not phrase-final (fills live in the last bar of a phrase). */
function plainBars(g: GeneratedStyle): number[] {
  const every = g.plan.style.rhythm.fills?.every ?? 0;
  return Array.from({ length: g.plan.bars }, (_, i) => i).filter(
    (i) => every <= 0 || (i + 1) % every !== 0,
  );
}

function each(id: string, run: (g: GeneratedStyle) => void) {
  for (const seed of SEEDS)
    run(generateStyle(id as StyleId, { seed, bars: BARS }));
}

describe("rock family: coverage", () => {
  test("the family has its 93 leaves and every one has a written card", () => {
    expect(rockLeaves.length).toBe(93);
    expect(rockLeaves.filter((id) => !cardIds.has(id))).toEqual([]);
  });

  test("every card id is in the rock family and registered", () => {
    for (const c of ROCK_CARDS) {
      expect(rockIds).toContain(c.id);
      expect(STYLE_CARDS.has(c.id)).toBe(true);
      expect(styleNode(c.id)).toBeDefined();
    }
  });

  test("every leaf names its own theory: a distinct, specific summary", () => {
    const seen = new Map<string, string>();
    for (const id of rockLeaves) {
      const card = ROCK_CARDS.find((c) => c.id === id)!;
      expect(typeof card.summary).toBe("string");
      const summary = card.summary as string;
      expect(summary.length).toBeGreaterThan(40);
      expect(seen.get(summary)).toBeUndefined();
      seen.set(summary, id);
    }
  });

  test("leaves are mutually exclusive: no two resolve to the same body", () => {
    const bodies = new Map<string, string>();
    for (const id of rockLeaves) {
      const {
        summary: _s,
        seedSalt: _salt,
        ...body
      } = resolveStyle(id) as Record<string, unknown>;
      const key = JSON.stringify({
        ...body,
        id: undefined,
        title: undefined,
        lineage: undefined,
      });
      expect(bodies.get(key)).toBeUndefined();
      bodies.set(key, id);
    }
  });
});

describe("rock family: shared patterns", () => {
  test("the root backbeat: snare on beats 2 and 4, eighth hats", () => {
    const style = resolveStyle("punk-rock" as StyleId);
    const snare = style.rhythm.onsets.snare!;
    expect(
      snare.map((p, i) => (p >= 1 ? i : -1)).filter((i) => i >= 0),
    ).toEqual([2, 6]);
  });

  test("punk-rock (straight eighths) hits the backbeat in every plain bar", () => {
    each("punk-rock", (g) => {
      const snare = stepsOf(g, "snare");
      for (const bar of plainBars(g)) {
        expect(snare[bar]).toContain(2);
        expect(snare[bar]).toContain(6);
      }
    });
  });

  test("metal plays only power chords: root and fifth pitch classes", () => {
    for (const id of [
      "heavy-metal",
      "thrash",
      "doom-metal",
      "death-metal",
      "groove-metal",
    ])
      each(id, (g) => {
        const byStart = new Map<number, number[]>();
        for (const note of g.data.notes ?? []) {
          if (g.plan.noteRoles.get(note.id) !== "chords") continue;
          const list = byStart.get(note.startTick ?? 0) ?? [];
          list.push(note.pitch);
          byStart.set(note.startTick ?? 0, list);
        }
        expect(byStart.size).toBeGreaterThan(0);
        for (const pitches of byStart.values()) {
          // Root and fifth, either way up (a fifth inverted is a fourth).
          const pcs = [...new Set(pitches.map((p) => p % 12))];
          expect(pcs.length).toBeLessThanOrEqual(2);
          if (pcs.length === 2)
            expect([5, 7]).toContain((pcs[1]! - pcs[0]! + 12) % 12);
        }
      });
  });

  test("metal leaves count in sixteenths, early rock in eighths", () => {
    for (const id of rockLeaves) {
      const path = stylePath(id);
      const sub = resolveStyle(id).groove.subdivision;
      if (path.includes("metal" as StyleId) && id !== "glam-metal")
        expect(sub).toBe(4);
    }
    expect(resolveStyle("rock-and-roll" as StyleId).groove.subdivision).toBe(2);
  });
});

describe("rock family: leaf patterns", () => {
  test("hardcore skank beat: kick on the beat, snare on every off-beat eighth", () => {
    each("hardcore-punk", (g) => {
      const kick = stepsOf(g, "kick");
      const snare = stepsOf(g, "snare");
      for (const bar of plainBars(g)) {
        expect(kick[bar]).toEqual([0, 2, 4, 6]);
        expect(snare[bar]).toEqual([1, 3, 5, 7]);
      }
    });
  });

  test("d-beat: kick on 1, the and of 2 and 3; snare on 2 and 4", () => {
    each("crust", (g) => {
      const kick = stepsOf(g, "kick");
      const snare = stepsOf(g, "snare");
      for (const bar of plainBars(g)) {
        expect(kick[bar]).toEqual([0, 3, 4]);
        expect(snare[bar]).toEqual([2, 6]);
      }
    });
  });

  test("blast beat: kick and snare alternate on every sixteenth", () => {
    for (const id of ["grindcore", "powerviolence"])
      each(id, (g) => {
        const kick = stepsOf(g, "kick");
        const snare = stepsOf(g, "snare");
        for (const bar of plainBars(g)) {
          expect(kick[bar]).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
          expect(snare[bar]).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
        }
      });
  });

  test("the gallop: eighth then two sixteenths on every beat", () => {
    const kick = resolveStyle("heavy-metal" as StyleId).rhythm.onsets.kick!;
    const hits = kick.map((p, i) => (p >= 1 ? i : -1)).filter((i) => i >= 0);
    expect(hits).toEqual([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]);
  });

  test("motorik: four-on-the-floor plus the and of 4, nearly fill-free, one-chord modal", () => {
    const style = resolveStyle("krautrock" as StyleId);
    expect(style.harmony.model).toBe("modal");
    expect(style.rhythm.fills?.density[1] ?? 0).toBeLessThanOrEqual(0.1);
    each("krautrock", (g) => {
      const kick = stepsOf(g, "kick");
      const snare = stepsOf(g, "snare");
      for (const bar of plainBars(g)) {
        expect(kick[bar]).toEqual([0, 2, 4, 6, 7]);
        expect(snare[bar]).toEqual([2, 6]);
      }
    });
  });

  test("early rock: a 12-bar blues form and a 12-bar hypermeter", () => {
    for (const id of ["rock-and-roll", "rockabilly", "blues-rock"]) {
      const style = resolveStyle(id as StyleId);
      expect(style.meter.hypermeter[0]![0]).toBe(12);
      const forms = style.harmony.forms ?? [];
      expect(forms.some(([f]) => f.length === 12)).toBe(true);
    }
    // When the form drives, the chords are I-IV-V dominants in 12-bar order.
    each("rock-and-roll", (g) => {
      if (g.plan.harmonySource !== "form") return;
      const roots = g.plan.chords.map(
        (c) => (c.rootPc - g.plan.tonic + 12) % 12,
      );
      for (const r of roots) expect([0, 5, 7]).toContain(r);
    });
  });

  test("blues rock: a triplet (12/8-feel) shuffle grid", () => {
    each("blues-rock", (g) => {
      expect(g.plan.stepsPerBar).toBe(12);
    });
  });

  test("additive meters: prog, math rock and mathcore reach odd signatures", () => {
    for (const id of [
      "prog-rock",
      "math-rock",
      "mathcore",
      "canterbury",
      "prog-metal",
    ]) {
      const sigs = new Set<string>();
      for (let seed = 1; seed <= 24; seed += 1)
        sigs.add(
          generateStyle(id as StyleId, { seed, bars: 4 }).plan.signature,
        );
      expect([...sigs].some((s) => s !== "4/4")).toBe(true);
    }
  });

  test("phrygian riffing: thrash and death metal scales carry the bII", () => {
    for (const id of ["thrash", "death-metal", "deathcore"])
      each(id, (g) => {
        if (!["phrygian", "locrian"].includes(g.plan.scaleName)) return;
        const pcs = g.plan.scale.tones.map((t) => Math.round(t.semis) % 12);
        expect(pcs).toContain(1);
        expect(pcs).not.toContain(2);
      });
  });

  test("doom and funeral doom stay slow; grindcore and powerviolence stay fast", () => {
    each("doom-metal", (g) => expect(g.plan.bpm).toBeLessThanOrEqual(80));
    each("funeral-doom", (g) => expect(g.plan.bpm).toBeLessThanOrEqual(50));
    each("grindcore", (g) => expect(g.plan.bpm).toBeGreaterThanOrEqual(200));
    each("powerviolence", (g) =>
      expect(g.plan.bpm).toBeGreaterThanOrEqual(200),
    );
  });

  test("drone metal is near-beatless: no snare or hat, pedal bass", () => {
    each("drone-metal", (g) => {
      expect(stepsOf(g, "snare").flat()).toEqual([]);
      expect(stepsOf(g, "hat").flat()).toEqual([]);
    });
    expect(resolveStyle("drone-metal" as StyleId).bass.behaviour).toEqual([
      ["pedal", 1],
    ]);
  });

  test("timbre markers: slap bass in rockabilly, spring reverb in surf, machines in coldwave", () => {
    const voices = (id: string, r: RoleName) =>
      resolveStyle(id as StyleId).texture.roles[r]!.voices.map(
        (v) =>
          `${v.instrument}${v.rig ? `@${v.rig}` : ""}${v.kit ? `#${v.kit}` : ""}`,
      );
    expect(voices("rockabilly", "bass")).toEqual(["slap"]);
    expect(voices("psychobilly", "bass")).toEqual(["slap"]);
    expect(voices("surf", "lead")).toEqual(["electric@spring"]);
    expect(voices("coldwave", "kick")).toContain("drums#electro");
    expect(voices("shoegaze", "chords")).toEqual(["shoegaze"]);
    expect(voices("skiffle", "bass")).toEqual(["doublebass"]);
  });

  test("post-punk: the bass carries the line (ostinato, raised register)", () => {
    const style = resolveStyle("post-punk" as StyleId);
    expect(style.bass.behaviour).toEqual([["ostinato", 1]]);
    expect(style.bass.range[0]).toBeGreaterThan(
      resolveStyle("punk-rock" as StyleId).bass.range[0],
    );
  });

  test("quiet-loud: grunge, emo and post-hardcore choruses outweigh verses", () => {
    for (const id of ["grunge", "emo", "post-hardcore", "screamo"]) {
      const e = resolveStyle(id as StyleId).form.energy ?? {};
      expect(e.chorus! - e.verse!).toBeGreaterThanOrEqual(0.45);
    }
  });

  test("crescendo forms build to a drop in post-rock and post-metal", () => {
    for (const id of ["post-rock", "post-metal"]) {
      const e = resolveStyle(id as StyleId).form.energy ?? {};
      expect(e.drop!).toBeGreaterThan(e.build!);
      expect(e.build!).toBeGreaterThan(e.intro!);
    }
  });
});

/** Kick hits of a resolved card, as step indices. */
function kickHits(id: string): number[] {
  const kick = resolveStyle(id as StyleId).rhythm.onsets.kick ?? [];
  return kick.map((p, i) => (p >= 1 ? i : -1)).filter((i) => i >= 0);
}

/** Generated fingerprint: kick grid, tempo and pitch-class histogram. */
function fingerprint(id: string, seed: number): number[] {
  const g = generateStyle(id as StyleId, { seed, bars: BARS });
  const { plan } = g;
  const kick = new Array(16).fill(0);
  const pcs = new Array(12).fill(0);
  let pitched = 0;
  for (const note of g.data.notes ?? []) {
    const role = plan.noteRoles.get(note.id);
    const t = (note.startTick ?? 0) % plan.barTicks;
    if (role === "kick")
      kick[Math.floor((t / plan.barTicks) * 16)] += 1 / plan.bars;
    else if (role === "bass" || role === "chords" || role === "lead") {
      pcs[(((note.pitch - plan.tonic) % 12) + 12) % 12] += 1;
      pitched += 1;
    }
  }
  return [plan.bpm / 40, ...kick, ...pcs.map((v) => (6 * v) / (pitched || 1))];
}

const distance = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0));

describe("rock family: siblings a listener can tell apart", () => {
  test("first-wave punk: kick on every beat, major I-IV-V, faster than pop punk", () => {
    expect(kickHits("punk-rock")).toEqual([0, 2, 4, 6]);
    expect(resolveStyle("punk-rock" as StyleId).tempo.typical).toBeGreaterThan(
      resolveStyle("pop-punk" as StyleId).tempo.typical,
    );
    expect(kickHits("pop-punk")).toEqual([0, 3, 4, 6]);
  });

  test("hardcore is minor and phrygian; skate and pop punk are major", () => {
    const scales = (id: string) =>
      (resolveStyle(id as StyleId).pitch.scales ?? []).map((s) => s[0]);
    expect(scales("hardcore-punk")).not.toContain("major");
    expect(scales("skate-punk")).toEqual(["major"]);
    expect(scales("pop-punk")).toEqual(["major"]);
  });

  test("thrash beat: kick on the beat, snare on every off-beat eighth", () => {
    expect(kickHits("thrash")).toEqual([0, 4, 8, 12]);
  });

  test("metal siblings: power metal sings in major, neoclassical is mid-tempo harmonic minor", () => {
    const power = resolveStyle("power-metal" as StyleId);
    expect(power.pitch.scales?.[0]?.[0]).toBe("major");
    expect(power.texture.roles.pad?.required).toBe(true);
    const neo = resolveStyle("neo-classical-metal" as StyleId);
    expect(neo.tempo.typical).toBeLessThan(
      resolveStyle("speed-metal" as StyleId).tempo.typical,
    );
    expect(neo.pitch.scales?.[0]?.[0]).toBe("harmonic-minor");
  });

  test("classic-rock leaves each own a distinct kick figure", () => {
    const ids = [
      "hard-rock",
      "heartland-rock",
      "pop-rock",
      "folk-rock",
      "roots-rock",
      "pub-rock",
      "southern-rock",
      "psychedelic-rock",
      "stoner-rock",
    ];
    const figures = ids.map((id) => kickHits(id).join(","));
    expect(new Set(figures).size).toBe(ids.length);
  });

  test("generated siblings sit nearer their own centroid than a confusable sibling's", () => {
    const pairs: [string, string][] = [
      ["punk-rock", "pop-punk"],
      ["hardcore-punk", "skate-punk"],
      ["speed-metal", "neo-classical-metal"],
      ["metalcore", "speed-metal"],
      ["indie-rock", "k-rock"],
      ["hard-rock", "heartland-rock"],
    ];
    const seeds = [1, 2, 3];
    const centroid = (id: string) => {
      const fs = seeds.map((s) => fingerprint(id, s));
      return fs[0]!.map(
        (_, i) => fs.reduce((a, f) => a + f[i]!, 0) / fs.length,
      );
    };
    for (const [a, b] of pairs) {
      const ca = centroid(a);
      const cb = centroid(b);
      for (const seed of seeds) {
        const fa = fingerprint(a, seed);
        expect(distance(fa, ca)).toBeLessThan(distance(fa, cb));
        const fb = fingerprint(b, seed);
        expect(distance(fb, cb)).toBeLessThan(distance(fb, ca));
      }
    }
  });
});
