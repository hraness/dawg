import { describe, expect, test } from "bun:test";
import {
  autoPartVoice,
  normalizeSing,
  parseVowel,
  resolveSing,
  singSummary,
  SING_PRESET_NAMES,
  vowelOf,
} from "./sing.ts";

describe("normalizeSing", () => {
  test("a preset alone stays a preset alone", () => {
    expect(normalizeSing({ preset: "choir" })).toEqual({ preset: "choir" });
    expect(normalizeSing(null)).toBeUndefined();
    expect(normalizeSing(undefined)).toBeUndefined();
  });

  test("every preset normalizes to itself and resolves", () => {
    expect(SING_PRESET_NAMES.length).toBe(14);
    for (const preset of SING_PRESET_NAMES) {
      expect(normalizeSing({ preset })).toEqual({ preset });
      expect(resolveSing({ preset }).voices).toBeGreaterThanOrEqual(1);
    }
  });

  test("bad values throw naming the key", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ voices: 9 }, /voices/],
      [{ voices: 2.5 }, /voices/],
      [{ harmonics: [12, 6] }, /harmonics/],
      [{ drone: 70 }, /drone/],
      [{ drone: "H2" }, /drone/],
      [{ vowel: "x" }, /vowel/],
      [{ wat: 1 }, /wat/],
    ];
    for (const [input, key] of cases)
      expect(() => normalizeSing(input)).toThrow(key);
  });

  test("the drone accepts a note name or a MIDI number", () => {
    expect(normalizeSing({ drone: "D3" })).toEqual({ drone: 50 });
    expect(normalizeSing({ drone: 45 })).toEqual({ drone: 45 });
    expect(() => normalizeSing({ drone: "H2" })).toThrow(/D3|note/);
  });

  test("keys come out in canonical order", () => {
    const sing = normalizeSing({
      sub: 0.5,
      harmonics: [5, 9],
      preset: "drone",
    });
    expect(Object.keys(sing!)).toEqual(["preset", "harmonics", "sub"]);
  });
});

describe("vowels", () => {
  test("parseVowel reads single vowels, morphs and sung spellings", () => {
    expect(parseVowel("a>o")).toEqual(["a", "o"]);
    expect(parseVowel("A")).toEqual(["a"]);
    expect(parseVowel("ah>oo")).toEqual(["a", "u"]);
    expect(() => parseVowel("x")).toThrow(/vowel/);
    expect(() => parseVowel("a>o>u")).toThrow(/vowel/);
  });

  test("vowelOf finds a syllable's nucleus", () => {
    expect(vowelOf("you")).toBe("u");
    expect(vowelOf("la")).toBe("a");
    expect(vowelOf("night")).toBe("a>i");
    expect(vowelOf("see")).toBe("i");
    expect(vowelOf("go")).toBe("o");
    expect(vowelOf("o")).toBe("o");
    expect(vowelOf("hmm")).toBeUndefined();
    expect(vowelOf(undefined)).toBeUndefined();
  });

  test.each([
    ["py", "i"],
    ["ly", "i"],
    ["ry", "i"],
    ["my", "a>i"],
    ["why", "a>i"],
    ["sky", "a>i"],
    ["heart", "a"],
    ["yeah", "e"],
    ["eyes", "a>i"],
    ["hear", "i"],
    ["lu", "u"],
    ["love", "a"],
    ["come", "a"],
    ["one", "a"],
    ["home", "o"],
    ["hal", "a"],
    ["le", "e"],
    ["jah", "a"],
    ["night", "a>i"],
    ["day", "e>i"],
    ["now", "a>u"],
  ] as const)("vowelOf(%p) is %p", (syllable, vowel) => {
    expect(vowelOf(syllable)).toBe(vowel);
  });
});

describe("resolveSing", () => {
  test("throat presets carry their harmonic bands and drones", () => {
    expect(resolveSing({ preset: "khoomei" }).harmonics).toEqual([6, 10]);
    expect(resolveSing({ preset: "khoomei" }).drone).toBe(50);
    expect(resolveSing({ preset: "sygyt" }).harmonics).toEqual([9, 12]);
    expect(resolveSing({ preset: "kargyraa" }).sub).toBe(0.8);
  });

  test("overrides win over the preset and absent means defaults", () => {
    const s = resolveSing({ preset: "choir", voices: 3 });
    expect(s.voices).toBe(3);
    expect(resolveSing({}).voices).toBe(1);
    expect(resolveSing(undefined).drone).toBeUndefined();
  });

  test("a drone that follows the key stays in its style's register", () => {
    const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
    for (let key = 0; key < 12; key += 1) {
      for (const preset of ["khoomei", "sygyt", "kargyraa"] as const) {
        const base = resolveSing({ preset }).drone!;
        const drone = resolveSing({ preset }, key).drone!;
        expect(((drone % 12) + 12) % 12).toBe(key);
        expect(Math.abs(drone - base)).toBeLessThanOrEqual(6);
      }
      // sygyt's whistle band (harmonics 9..12) stays centred near 2 kHz
      const s = resolveSing({ preset: "sygyt" }, key);
      const centre = hz(s.drone!) * Math.sqrt(s.harmonics[0] * s.harmonics[1]);
      expect(centre).toBeGreaterThan(2000 / Math.SQRT2);
      expect(centre).toBeLessThan(2000 * Math.SQRT2);
    }
    // the reviewed cases: sygyt in C is C4 (not C3), kargyraa in C is C3
    expect(resolveSing({ preset: "sygyt" }, 0).drone).toBe(60);
    expect(resolveSing({ preset: "kargyraa" }, 0).drone).toBe(48);
    expect(resolveSing({ preset: "kargyraa" }, 6).drone).toBe(42);
    expect(resolveSing({ preset: "khoomei" }, 2).drone).toBe(50);
    // an explicit drone never follows the key
    expect(resolveSing({ preset: "sygyt", drone: 43 }, 0).drone).toBe(43);
  });
});

describe("singSummary", () => {
  test("shows the drone that plays, marked when it follows the key", () => {
    expect(singSummary({ preset: "kargyraa" })).toContain("drone A2");
    // E major: kargyraa's A2 drone moves to E2 and says so.
    expect(singSummary({ preset: "kargyraa" }, 4)).toContain("drone E2 (key)");
    expect(singSummary({ preset: "kargyraa", drone: 45 }, 4)).toContain(
      "drone A2",
    );
    expect(singSummary({ preset: "kargyraa", drone: 45 }, 4)).not.toContain(
      "(key)",
    );
  });
});

describe("autoPartVoice", () => {
  test("an SATB part keeps one voice type from its median pitch", () => {
    // Bach chorale ranges: the tenor line around B3-D4 stays a tenor
    expect(autoPartVoice([59, 60, 62, 59, 57, 62])).toBe("tenor");
    expect(autoPartVoice([43, 45, 47, 48, 50])).toBe("bass");
    expect(autoPartVoice([62, 64, 66, 67, 64])).toBe("alto");
    expect(autoPartVoice([67, 69, 71, 72, 74])).toBe("soprano");
    expect(autoPartVoice([])).toBeUndefined();
  });
});
