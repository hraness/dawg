import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  resolveString,
  STRING_PRESET_NAMES,
  STRING_PRESETS,
} from "../../../core/strings.ts";
import { resolveTuning } from "../../../core/tuning.ts";
import {
  centroid,
  centsOff,
  measurePitch,
  partialT60,
  peakOf,
  render,
  SR,
  tetHz,
} from "./measure.test-helpers.ts";

// One string, no sympathetic bank or body: the loop's own pitch and decay.
const ISO = { unison: 1, sym: 0, body: "none", oct: 0 } as const;
const C4 = tetHz(60);
const designT60 = (preset: string, pitch: number) => {
  const v = resolveString({ preset });
  return (v.ring as number) * (tetHz(pitch) / C4) ** -(v.track as number);
};

describe("plucked strings (design spec section 9)", () => {
  test("presets are frozen: a retune needs a new name", () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(STRING_PRESETS))
      .digest("hex");
    // 0.6.1 (f061-bowed) appended 13 bowed and section rows; the 22
    // plucked rows are unchanged, so the pin moved only for the append.
    expect(STRING_PRESET_NAMES).toHaveLength(35);
    expect(hash).toBe(PRESET_HASH);
  });

  test("tuning: every fifth key within 0.1 cent of noteHz", () => {
    const ranges: [string, number, number][] = [
      ["nylon", 40, 88],
      ["steel", 40, 88],
      ["ebass", 28, 67],
      ["harpsichord", 29, 89],
      ["harp", 24, 103],
      ["koto", 50, 86],
      ["santur", 51, 88],
    ];
    for (const [preset, lo, hi] of ranges)
      for (let p = lo; p <= hi; p += 5) {
        const x = render({ preset, ...ISO }, [{ pitch: p }], 1.3);
        const off = centsOff(measurePitch(x, tetHz(p)), tetHz(p));
        expect({ preset, p, ok: Math.abs(off) < 0.1 }).toEqual({
          preset,
          p,
          ok: true,
        });
      }
  }, 60_000);

  test("sitar: buzz off is exact, buzz on stays within 1 cent above C4", () => {
    for (let p = 48; p <= 81; p += 3) {
      const off = render(
        { preset: "sitar", ...ISO, buzz: 0 },
        [{ pitch: p }],
        1.3,
      );
      expect(
        Math.abs(centsOff(measurePitch(off, tetHz(p)), tetHz(p))),
      ).toBeLessThan(0.1);
      const on = render({ preset: "sitar", ...ISO }, [{ pitch: p }], 1.3);
      const cents = Math.abs(centsOff(measurePitch(on, tetHz(p)), tetHz(p)));
      expect(cents).toBeLessThan(p >= 60 ? 1 : 5);
    }
    const a4 = render({ preset: "sitar", ...ISO }, [{ pitch: 69 }], 1.3);
    expect(Math.abs(centsOff(measurePitch(a4, 440), 440))).toBeLessThan(1);
  });

  test("tuning tables: 19-EDO and just intonation within 1 cent", () => {
    for (const tuning of [{ edo: 19 }, { name: "just" }]) {
      const table = resolveTuning(tuning, undefined, "C")!;
      for (const [preset, tol] of [
        ["nylon", 1],
        ["sitar", 1.5],
      ] as const)
        for (const p of [55, 62, 67]) {
          const want = table.hz[p]!;
          const x = render({ preset, ...ISO }, [{ pitch: p }], 1.4, table);
          expect(Math.abs(centsOff(measurePitch(x, want), want))).toBeLessThan(
            tol,
          );
        }
    }
  });

  test("T60 of the fundamental within 10% at every fifth key", () => {
    const ranges: [string, number, number][] = [
      ["nylon", 40, 100],
      ["steel", 40, 88],
      ["ebass", 28, 67],
      ["harp", 24, 103],
      ["harpsichord", 29, 89],
    ];
    for (const [preset, lo, hi] of ranges)
      for (let p = lo; p <= hi; p += 7) {
        const want = designT60(preset, p);
        const x = render(
          { preset, ...ISO },
          [{ pitch: p }],
          Math.min(12, want * 0.75 + 0.5),
        );
        const ratio = partialT60(x, tetHz(p)) / want;
        expect({ preset, p, ok: Math.abs(ratio - 1) < 0.1 }).toEqual({
          preset,
          p,
          ok: true,
        });
      }
  });

  test("harpsichord is velocity-flat (within 1 dB), nylon is not", () => {
    const db = (preset: string) =>
      20 *
      Math.log10(
        peakOf(render({ preset }, [{ pitch: 65, velocity: 1 }], 0.5)) /
          peakOf(render({ preset }, [{ pitch: 65, velocity: 0.2 }], 0.5)),
      );
    expect(Math.abs(db("harpsichord"))).toBeLessThan(1);
    expect(db("nylon")).toBeGreaterThan(6);
  });

  test("default harpsichord: level within 0.5 dB from velocity 40 to 127", () => {
    // Each strike starts at a different time (a different note seed); the
    // 8'+8' course's tuning belongs to the key, so its beating is the same.
    for (const pitch of [41, 62, 81]) {
      const levels: number[] = [];
      for (let v = 40, k = 0; v <= 127; v += 29, k += 1) {
        const start = k * 0.25;
        const x = render(
          { preset: "harpsichord" },
          [{ pitch, velocity: v / 127, start, seconds: 0.5 }],
          start + 0.5,
        );
        let sum = 0;
        const from = Math.round(start * SR);
        for (let i = from; i < x.length; i += 1) sum += x[i]! ** 2;
        levels.push(10 * Math.log10(sum / (x.length - from)));
      }
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(0.5);
    }
  });

  test("hard picks are brighter on picked presets", () => {
    for (const preset of ["steel", "electric", "santur"]) {
      const soft = render({ preset }, [{ pitch: 60, velocity: 0.25 }], 0.3);
      const hard = render({ preset }, [{ pitch: 60, velocity: 1 }], 0.3);
      expect(centroid(hard, 0, 1024) / centroid(soft, 0, 1024)).toBeGreaterThan(
        1.2,
      );
    }
  });

  test("jawari: no DC, and a brighter buzz", () => {
    for (const preset of ["sitar", "tanpura"])
      for (const p of [48, 60, 69]) {
        const on = render({ preset, ...ISO }, [{ pitch: p }], 1.5);
        const off = render({ preset, ...ISO, buzz: 0 }, [{ pitch: p }], 1.5);
        let mean = 0;
        let power = 0;
        for (const v of on) {
          mean += v;
          power += v * v;
        }
        mean /= on.length;
        expect(Math.abs(mean) / Math.sqrt(power / on.length)).toBeLessThan(
          0.05,
        );
        const start = Math.round(0.3 * SR);
        expect(
          centroid(on, start, 4096) / centroid(off, start, 4096),
        ).toBeGreaterThanOrEqual(1.3);
      }
  });

  test("levels: a C-major triad at velocity 0.8 peaks near -6 dBFS", () => {
    for (const preset of STRING_PRESET_NAMES) {
      const root = [
        "ebass",
        "slap",
        "upright",
        "motown",
        "contrabass",
        "contrabasses",
      ].includes(preset)
        ? 36
        : ["cello", "cellos"].includes(preset)
          ? 48
          : 60;
      const triad = render(
        { preset },
        [root, root + 4, root + 7].map((pitch) => ({ pitch, seconds: 1 })),
        1.5,
      );
      const db = 20 * Math.log10(peakOf(triad));
      expect({ preset, ok: db > -8 && db < -4 }).toEqual({ preset, ok: true });
    }
  });

  test("deterministic: the same notes render the same samples", () => {
    const notes = [{ pitch: 60 }, { pitch: 64, start: 0.1 }];
    for (const preset of ["sitar", "jangle", "santur"]) {
      const a = render({ preset }, notes, 0.8);
      const b = render({ preset }, notes, 0.8);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    }
  });

  test("an unmapped key (table Hz 0) is silent", () => {
    const table = resolveTuning({ edo: 12 }, undefined)!;
    const hz = new Float64Array(table.hz);
    hz[60] = 0;
    const x = render({ preset: "nylon" }, [{ pitch: 60 }], 0.3, {
      ...table,
      hz,
    });
    expect(peakOf(x)).toBe(0);
  });

  test("budget: at most 20 ms per voice-second", () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({
      pitch: 48 + i * 3,
      start: i * 0.25,
      seconds: 1.5,
    }));
    render({ preset: "nylon" }, notes, 0.5); // warm up
    let worst = 0;
    for (const preset of ["nylon", "sitar", "santur", "jangle"]) {
      const t = performance.now();
      render({ preset }, notes, 4);
      const ms = performance.now() - t;
      const strings = Math.max(1, resolveString({ preset }).unison as number);
      worst = Math.max(worst, ms / (8 * 4 * strings));
    }
    expect(worst).toBeLessThan(20);
  });
});

const PRESET_HASH =
  "b204919d783dad1160f4008769d02e82329b51b3a77f5edadcb7b2d420a0d7a3";
