import { describe, expect, test } from "bun:test";
import { parseKey, scaleSteps, SCALE_NAMES } from "./chords.ts";
import {
  describeTuning,
  displayCents,
  displayTag,
  edoCents,
  keyDeviation,
  parseKbm,
  parseScl,
  resolveTuning,
  snapToTuning,
  TUNING_PRESETS,
  tuningPreset,
  TuningError,
} from "./tuning.ts";

describe("tuning library", () => {
  test("every preset stays inside its period", () => {
    for (const preset of TUNING_PRESETS) {
      const period = preset.cents.at(-1)!;
      expect(preset.cents.length).toBeGreaterThan(0);
      for (const step of preset.cents.slice(0, -1)) {
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThan(period);
      }
    }
  });

  test("the Well-Tuned Piano keeps Young's out-of-order keys", () => {
    // Young's tuning is famously non-monotonic: the fifth key sounds below
    // the fourth (21/16 above 1323/1024).
    const cents = tuningPreset("well-tuned-piano")!.cents;
    expect(cents[3]!).toBeGreaterThan(cents[4]!);
  });

  test("names the brief's systems", () => {
    for (const name of [
      "12-tet",
      "19-edo",
      "24-edo",
      "31-edo",
      "pythagorean",
      "just",
      "7-limit",
      "well-tuned-piano",
      "pelog",
      "slendro",
      "nyamaropa",
      "shruti",
      "yaman",
      "bayati",
    ])
      expect(tuningPreset(name)?.name).toBeDefined();
    expect(tuningPreset("pelog")?.approximate).toBe(true);
    expect(tuningPreset("Well Tuned Piano")?.name).toBe("well-tuned-piano");
  });

  test("n-EDO steps divide the octave evenly", () => {
    const steps = edoCents(19);
    expect(steps).toHaveLength(19);
    expect(steps[18]).toBeCloseTo(1200, 9);
    expect(steps[0]).toBeCloseTo(1200 / 19, 9);
  });

  test("just intonation sounds pure fifths and thirds against the root", () => {
    const table = resolveTuning({ name: "just" }, undefined, "C")!;
    const c = table.hz[60]!;
    expect(table.hz[67]! / c).toBeCloseTo(3 / 2, 9);
    expect(table.hz[64]! / c).toBeCloseTo(5 / 4, 9);
    expect(table.hz[72]! / c).toBeCloseTo(2, 9);
    // The root sits at its 12-TET pitch, so the key's tonic is unchanged.
    expect(c).toBeCloseTo(440 * 2 ** (-9 / 12), 9);
  });
});

describe("scale library", () => {
  test("church modes, minors, ragas, maqam and Messiaen parse as keys", () => {
    for (const text of [
      "D dorian",
      "A harmonic-minor",
      "A melodic-minor",
      "C blues",
      "E hijaz",
      "D bayati",
      "C yaman",
      "C bhairav",
      "C kafi",
      "C messiaen-3",
    ])
      expect(parseKey(text)).toBeDefined();
    expect(scaleSteps(parseKey("C messiaen-1")!)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(SCALE_NAMES.length).toBeGreaterThan(20);
  });

  test("every current key string still parses to the same mode", () => {
    expect(parseKey("Am")?.mode).toBe("minor");
    expect(parseKey("C")?.mode).toBe("major");
    expect(parseKey("F# lydian")?.mode).toBe("lydian");
  });
});

describe("Scala files", () => {
  test("parses the specification's example", () => {
    const scale = parseScl(
      [
        "! meanquar.scl",
        "!",
        "1/4-comma meantone scale. Pietro Aaron's temp. (1523). 6/5 beats twice 3/2",
        " 12",
        "!",
        " 76.04900",
        " 193.15686",
        " 310.26471",
        " 5/4",
        " 503.42157",
        " 579.47057",
        " 696.57843",
        " 25/16",
        " 889.73529",
        " 1006.84314",
        " 1082.89214",
        " 2/1",
      ].join("\n"),
    );
    expect(scale.cents).toHaveLength(12);
    expect(scale.cents[3]).toBeCloseTo(386.3137, 3);
    expect(scale.cents[11]).toBeCloseTo(1200, 9);
    expect(scale.description).toContain("meantone");
  });

  test("rejects malformed files with the reason", () => {
    expect(() => parseScl("desc\nfive\n")).toThrow(TuningError);
    expect(() => parseScl("desc\n2\n100.0\n")).toThrow(/expected 2/);
    expect(() => parseScl("desc\n1\n-3/2\n")).toThrow(TuningError);
    expect(() => parseKbm("12\n0\n127\n60\n69\n440.0\n")).toThrow(
      /formal octave/,
    );
  });

  test("a keyboard mapping fixes the reference key and frequency", () => {
    const keymap = parseKbm(
      [
        "12",
        "0",
        "127",
        "60",
        "69",
        "432.0",
        "12",
        ...Array.from({ length: 12 }, (_, i) => `${i}`),
      ].join("\n"),
    );
    const table = resolveTuning({ edo: 12, keymap }, undefined)!;
    expect(table.hz[69]).toBeCloseTo(432, 9);
  });
});

describe("highway cents", () => {
  test("folds to the nearest 12-TET pitch and is absent in 12-TET", () => {
    expect(displayCents(undefined, 60, undefined)).toBeUndefined();
    expect(displayCents(undefined, 60, -14)).toBeCloseTo(-14, 9);
    const just = resolveTuning({ name: "just" }, undefined, "C")!;
    expect(displayCents(just, 64, undefined)).toBeCloseTo(-13.686, 2);
    const edo19 = resolveTuning({ edo: 19 }, undefined, "C")!;
    const folded = displayCents(edo19, 72, undefined)!;
    expect(Math.abs(folded)).toBeLessThanOrEqual(50);
    expect(keyDeviation(edo19, 72)).toBeLessThan(-100);
  });
});

describe("chords in other tunings", () => {
  test("twelve-key tunings keep chord keys; 19-EDO snaps to the nearest step", () => {
    const just = resolveTuning({ name: "just" }, undefined, "C major");
    expect(snapToTuning(64, just)).toBe(64);
    expect(snapToTuning(64, undefined)).toBe(64);
    const edo19 = resolveTuning({ edo: 19 }, undefined, "C major")!;
    // C4 = key 60 is the root; a major third (400 c) is 6 steps of 63.2 c.
    expect(snapToTuning(60, edo19)).toBe(60);
    expect(snapToTuning(64, edo19)).toBe(66);
    // A perfect fifth (700 c) is 11 steps (694.7 c).
    expect(snapToTuning(67, edo19)).toBe(71);
  });
});

describe("review fixes", () => {
  test("keys at or above 20 kHz are unmapped", () => {
    const one = resolveTuning({ edo: 1 }, undefined)!;
    expect(one.hz[127]).toBe(0);
    expect(one.hz[60]).toBeGreaterThan(0);
    const wide = resolveTuning({ cents: [9600] }, undefined)!;
    expect(wide.hz[127]).toBe(0);
    // 12-TET at 440 keeps every key.
    expect(resolveTuning({ ref: 440 }, undefined)!.hz[127]).toBeGreaterThan(0);
  });

  test("ref fixes the root at its 12-TET pitch", () => {
    // Just intonation in C: C4 sounds at 12-TET C4, A4 at C4 · 5/3.
    const just = resolveTuning({ name: "just" }, undefined, "C major")!;
    const c4 = 440 * 2 ** (-9 / 12);
    expect(just.hz[60]).toBeCloseTo(c4, 6);
    expect(just.hz[69]).toBeCloseTo((c4 * 5) / 3, 6);
    expect(just.hz[69]).toBeCloseTo(436.04, 2);
    // 19-EDO with no key roots on C4; key 69 is nine steps up.
    const edo = resolveTuning({ edo: 19 }, undefined)!;
    expect(edo.hz[60]).toBeCloseTo(c4, 6);
    expect(edo.hz[69]).toBeCloseTo(c4 * 2 ** (9 / 19), 6);
    // Rooted on A, A4 sounds exactly at ref.
    const onA = resolveTuning(
      { name: "just", ref: 432 },
      undefined,
      "A minor",
    )!;
    expect(onA.hz[69]).toBeCloseTo(432, 9);
  });

  test("describeTuning names the root", () => {
    expect(describeTuning({ ratios: ["3/2", "2/1"], root: 69 })).toBe(
      "2 ratios · root A4",
    );
  });

  test("raga presets carry their own shrutis", () => {
    const cents = (name: string) => tuningPreset(name)!.cents;
    // Komal re: Pythagorean 256/243 in Bhairavi, 16/15 in the generic table.
    expect(cents("bhairavi")[0]).toBeCloseTo(90.22, 2);
    expect(cents("hindustani")[0]).toBeCloseTo(111.73, 2);
    // Tivra ma: 729/512 in Yaman, 45/32 in Marwa.
    expect(cents("yaman")[5]).toBeCloseTo(611.73, 2);
    expect(cents("marwa")[5]).toBeCloseTo(590.22, 2);
    expect(cents("kafi")[9]).toBeCloseTo(1017.6, 1);
    expect(cents("asavari")[9]).toBeCloseTo(996.09, 2);
  });

  test("Segah, Sikah, Huzam and Nava have quarter-tone presets", () => {
    for (const name of ["segah", "sikah", "huzam", "nava"]) {
      expect(SCALE_NAMES as readonly string[]).toContain(name);
      const preset = tuningPreset(name)!;
      expect(preset.approximate).toBe(true);
      expect(preset.cents.some((step) => step % 100 === 50)).toBe(true);
    }
    expect(scaleSteps(parseKey("E sikah")!)).toEqual([
      0, 1.5, 3.5, 5.5, 7, 8.5, 10.5,
    ]);
  });
});

describe("highway tags in linear tunings", () => {
  test("name the 12-TET pitch the cents are measured from", () => {
    const edo19 = resolveTuning({ edo: 19 }, undefined)!;
    const tag = displayTag(edo19, 64, undefined)!;
    // Four steps up is 252.6 cents: D# minus 47.
    expect(tag.name).toBe("D#");
    expect(tag.cents).toBeCloseTo(-47.4, 0);
    const slendro = resolveTuning({ name: "slendro" }, undefined)!;
    expect(displayTag(slendro, 65, undefined)).toEqual({ name: "C" });
    // Twelve-key tables keep the bare cents tag.
    const just = resolveTuning({ name: "just" }, undefined, "C")!;
    expect(displayTag(just, 64, undefined)!.name).toBeUndefined();
    expect(displayTag(undefined, 60, undefined)).toBeUndefined();
  });
});
