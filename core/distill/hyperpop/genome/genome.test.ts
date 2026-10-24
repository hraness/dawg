import { describe, expect, test } from "bun:test";
import { createDemo, DEMOS } from "../../../demos/index.ts";
import {
  briefPins,
  songFromCard,
  compileGenome,
  distance,
  fingerprint,
  sampleGenome,
  spread,
} from "./index.ts";
import { SOUND_TRIMS } from "./levels.ts";
import { fugue, type MNote } from "./melody.ts";
import { Rng } from "./rng.ts";
import { ARP, BAROQUE, BASS, LEAD, PAD, STAB, withGain } from "./sounds.ts";
import { consonant } from "./theory.ts";

const UNPITCHED = new Set([
  "kick",
  "snare",
  "hats",
  "perc",
  "sweep",
  "fx",
  "spark",
  "chops",
  "cloud",
]);
const seeds = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => from + i);

describe("hyperpop genomes", () => {
  test("a seed is a song: the same seed writes the same score", () => {
    const a = compileGenome(sampleGenome(42));
    const b = compileGenome(sampleGenome(42));
    expect(JSON.stringify(a.score.toJSON())).toBe(
      JSON.stringify(b.score.toJSON()),
    );
    expect(a.title).toBe(b.title);
  });

  test("seeds spread across the space rather than three templates", () => {
    const gs = seeds(80).map((s) => sampleGenome(s));
    const distinct = (f: (g: (typeof gs)[number]) => unknown) =>
      new Set(gs.map(f)).size;
    expect(distinct((g) => g.drums.main)).toBeGreaterThanOrEqual(8);
    expect(distinct((g) => g.form)).toBe(7);
    expect(distinct((g) => g.mode)).toBe(6);
    expect(distinct((g) => g.sounds.lead)).toBeGreaterThanOrEqual(10);
    expect(distinct((g) => g.voice)).toBe(7);
    expect(distinct((g) => g.bpm)).toBeGreaterThanOrEqual(30);
    // No two of 80 songs share drums, form, mode and lead.
    expect(
      distinct((g) => [g.drums.main, g.form, g.mode, g.sounds.lead].join()),
    ).toBeGreaterThanOrEqual(78);
  });

  test("pins hold and everything else is still drawn", () => {
    const g = sampleGenome(7, {
      voice: "abstract",
      form: "beatSwitch",
      drums: { main: "jersey" },
      fugue: true,
    });
    expect([g.voice, g.form, g.drums.main, g.fugue]).toEqual([
      "abstract",
      "beatSwitch",
      "jersey",
      true,
    ]);
    const song = compileGenome(g);
    expect(song.sections.some((s) => s.kind === "fugue")).toBe(true);
    expect(song.sections.some((s) => s.kind === "switch")).toBe(true);
  });

  test("songs compile, fit a stored score and never change key", () => {
    for (const seed of seeds(40)) {
      const song = compileGenome(sampleGenome(seed));
      const g = song.genome;
      expect(song.score.notes.length).toBeLessThanOrEqual(4096);
      expect(
        song.sections.filter((s) => s.kind === "drop").length,
      ).toBeGreaterThanOrEqual(2);
      expect(song.score.key).toBe(g.scale.label);
      // Every pitched note sits in the scale, unless the song borrows from
      // the parallel minor on purpose; then only its b3, b6 and b7 may sound.
      const borrows = [
        g.harmony.main,
        g.harmony.verse,
        g.harmony.bridge,
      ].includes("borrowed");
      const outside = song.score.notes.filter(
        (n) =>
          !UNPITCHED.has(n.trackId) &&
          !g.scale.pcs.includes(((n.pitch % 12) + 12) % 12),
      );
      if (!borrows)
        expect(outside.map((n) => `${seed}:${n.trackId}:${n.pitch}`)).toEqual(
          [],
        );
      else {
        const minor = [3, 8, 10].map((x) => (g.tonic + x) % 12);
        expect(
          outside.filter((n) => !minor.includes(((n.pitch % 12) + 12) % 12)),
        ).toEqual([]);
      }
    }
  });

  test("a fugue break is a sometimes thing, about one song in four", () => {
    const count = seeds(400).filter((s) => sampleGenome(s).fugue).length;
    expect(count).toBeGreaterThan(60);
    expect(count).toBeLessThan(140);
    const song = compileGenome(sampleGenome(1, { fugue: true }));
    const sec = song.sections.find((s) => s.kind === "fugue")!;
    const inFugue = song.score.notes.filter(
      (n) => /^fg\d$/.test(n.trackId) && n.startTick >= sec.start * 1920,
    );
    expect(new Set(inFugue.map((n) => n.trackId)).size).toBeGreaterThanOrEqual(
      1,
    );
  });

  test("fugue voices enter in turn and agree on strong beats", () => {
    for (const seed of seeds(30)) {
      const rng = new Rng(seed);
      const scale = sampleGenome(seed).scale;
      const f = fugue(
        rng,
        scale,
        { density: 1.6, syncopation: 0.3, tresillo: 0 },
        8,
        3,
      );
      const starts = f.voices.map((v) => v[0]?.beat ?? Infinity);
      expect(starts[0]!).toBeLessThan(1);
      expect(starts[1]!).toBeGreaterThan(starts[0]!);
      const at = (v: readonly MNote[], beat: number) =>
        v.find((n) => n.beat <= beat + 1e-6 && n.beat + n.len > beat + 1e-6)
          ?.pitch;
      let checked = 0;
      let clashes = 0;
      for (let beat = 0; beat < 32; beat += 2) {
        const sounding = f.voices
          .map((v) => at(v, beat))
          .filter((p): p is number => p !== undefined);
        for (let i = 0; i < sounding.length; i++)
          for (let j = i + 1; j < sounding.length; j++) {
            checked++;
            const [hi, lo] =
              sounding[i]! >= sounding[j]!
                ? [sounding[i]!, sounding[j]!]
                : [sounding[j]!, sounding[i]!];
            if (!consonant(hi, lo) && (hi - lo) % 12 !== 5) clashes++;
          }
      }
      expect(clashes / Math.max(1, checked)).toBeLessThan(0.15);
      for (const v of f.voices)
        for (const n of v)
          expect(scale.pcs).toContain(((n.pitch % 12) + 12) % 12);
    }
  });
  test("generated songs sit far from the demos and from each other", () => {
    const demos = DEMOS.map((d) => fingerprint(createDemo(d.id)));
    const prints = Array.from({ length: 16 }, (_, i) =>
      fingerprint(compileGenome(sampleGenome(i + 1)).score),
    );
    // Classic sheets land within 0.1 of a demo; the demos sit about 0.44 apart.
    for (const p of prints)
      expect(Math.min(...demos.map((d) => distance(p, d)))).toBeGreaterThan(
        0.25,
      );
    const s = spread(prints);
    expect(s.mean).toBeGreaterThan(0.3);
    expect(s.min).toBeGreaterThan(0.12);
  });
  test("a card keeps only the pins its brief names", () => {
    const card = {
      title: "T",
      hook: "la la",
      verses: ["la"],
      pins: { bpm: 165, mode: "lydian", drums: "jersey", fugue: true },
    } as const;
    expect(
      briefPins(card, "a euphoric rave song about red lights").pins,
    ).toEqual({});
    expect(
      briefPins(card, "a 165 bpm jersey club song in lydian").pins,
    ).toEqual({ bpm: 165, mode: "lydian", drums: "jersey" });
    expect(briefPins(card, "sad, with a baroque fugue").pins).toEqual({
      fugue: true,
    });
  });
  test("one seed under two cards is two songs, and a card replays exactly", () => {
    const a = {
      title: "Red Light",
      hook: "go go go",
      verses: ["la"],
      mood: { energy: 0.8, brightness: 0.6 },
    };
    const b = {
      title: "Pixel Grief",
      hook: "bye bye bye",
      verses: ["la"],
      mood: { energy: 0.8, brightness: 0.6 },
    };
    const fa = fingerprint(songFromCard(a, 7).score);
    expect(distance(fa, fingerprint(songFromCard(b, 7).score))).toBeGreaterThan(
      0.1,
    );
    expect(distance(fa, fingerprint(songFromCard(a, 7).score))).toBe(0);
  });
});

test("every palette sound has a measured trim to its role's loudness", () => {
  // Run `bun scripts/genome-levels.ts --write` after adding a sound.
  const roles = { bass: BASS, lead: LEAD, pad: PAD, stab: STAB, arp: ARP };
  for (const [role, table] of Object.entries({ ...roles, baroque: BAROQUE }))
    expect(Object.keys(SOUND_TRIMS[role] ?? {}).sort()).toEqual(
      Object.keys(table).sort(),
    );
});

test("a preset is cut ahead of its peak guard, not after it", () => {
  const design = {
    brightness: 0.5,
    grit: 0.5,
    space: 0.5,
    width: 0.5,
    echo: 0.5,
  };
  const felt = PAD.felt!("pad", "Pad", 0.5, design);
  const level = (t: typeof felt) =>
    t.patch && "nodes" in t.patch
      ? Number(t.patch.nodes.find((n) => n.id === "level")?.params?.gain)
      : NaN;
  const cut = withGain(felt, 0.1);
  expect(cut.volume).toBe(0.5);
  expect(level(cut)).toBeCloseTo(level(felt) * 0.1, 3);
  // A boost still goes on the track, past the guard.
  expect(withGain(felt, 1.5).volume).toBe(0.75);
});
