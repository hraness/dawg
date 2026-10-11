/**
 * Machine-vox letter-to-sound (lane V1): the rules and dictionary, the
 * lyric contract (`hel-` + `lo` read as one word, `_` holds, a note's own
 * phones win) and the phone table's shape.
 */
import { describe, expect, test } from "bun:test";
import {
  phrasePhones,
  rulePhones,
  splitSyllables,
  VOX_DICT,
  VOX_DICT_SIZE,
  wordPhones,
} from "./g2p.ts";
import {
  isVoxPhone,
  normalizePhone,
  VOX_PHONE_NAMES,
  VOX_PHONES,
} from "./vox-phones.ts";

const say = (w: string) => wordPhones(w).join(" ");

describe("letter-to-sound", () => {
  test("common lyric words", () => {
    expect(say("sing")).toBe("s ih ng");
    expect(say("hello")).toBe("hh ax l ow");
    expect(say("world")).toBe("w er l d");
    expect(say("night")).toBe("n ay t");
    expect(say("knight")).toBe("n ay t");
    expect(say("phone")).toBe("f ow n");
    expect(say("strong")).toBe("s t r ao ng");
    expect(say("lamb")).toBe("l ae m");
    expect(say("cheese")).toBe("ch iy z");
    expect(say("quick")).toBe("k w ih k");
    expect(say("nation")).toBe("n ey sh ax n");
  });

  test("case, apostrophes and punctuation do not matter", () => {
    expect(say("Sing!")).toBe(say("sing"));
    expect(wordPhones("")).toEqual([]);
  });

  test("every rule and dictionary phone is in the table", () => {
    for (const phones of Object.values(VOX_DICT))
      for (const p of phones) expect(isVoxPhone(p)).toBe(true);
    for (const w of "the quick brown fox jumps over the lazy dog xylophone yacht".split(
      " ",
    ))
      for (const p of rulePhones(w)) expect(isVoxPhone(p)).toBe(true);
    expect(VOX_DICT_SIZE).toBe(Object.keys(VOX_DICT).length);
    expect(VOX_DICT_SIZE).toBeGreaterThan(20);
  });

  test("phone names: ARPAbet with or without stress digits", () => {
    expect(normalizePhone("AH0")).toBe("ah");
    expect(normalizePhone(" S ")).toBe("s");
    expect(normalizePhone("xx")).toBeUndefined();
    expect(normalizePhone("Q")).toBe("q");
    for (const name of VOX_PHONE_NAMES) expect(VOX_PHONES[name]).toBeDefined();
  });
});

describe("syllables over notes", () => {
  test("hel- + lo is one word split by maximal onset", () => {
    const [a, b] = phrasePhones([{ lyric: "hel-" }, { lyric: "lo" }]);
    expect(a).toEqual({ onset: ["hh"], nucleus: "ax", coda: [], hold: false });
    expect(b).toEqual({ onset: ["l"], nucleus: "ow", coda: [], hold: false });
  });

  test("onset, nucleus and coda of a one-note word", () => {
    expect(phrasePhones([{ lyric: "stars" }])[0]).toEqual({
      onset: ["s", "t"],
      nucleus: "aa",
      coda: ["r", "z"],
      hold: false,
    });
  });

  test("_ holds, a missing lyric and a sung vowel say nothing new", () => {
    const out = phrasePhones([
      { lyric: "you" },
      { lyric: "_" },
      {},
      { lyric: "a" },
      { lyric: "oo" },
    ]);
    expect(out[1]!.hold).toBe(true);
    expect(out[1]!.onset).toEqual([]);
    for (const k of [2, 3, 4]) {
      expect(out[k]!.onset).toEqual([]);
      expect(out[k]!.nucleus).toBeUndefined();
      expect(out[k]!.coda).toEqual([]);
    }
  });

  test("a note's phones override the rules for that note alone", () => {
    const out = phrasePhones([
      { lyric: "xyz", ph: ["S", "IH1", "NG"] },
      { lyric: "night" },
    ]);
    expect(out[0]).toEqual({
      onset: ["s"],
      nucleus: "ih",
      coda: ["ng"],
      hold: false,
    });
    expect(out[1]!.nucleus).toBe("ay");
  });

  test("more notes than vowels: the rest hold; a vowelless word hums", () => {
    const s = splitSyllables(["s", "ih", "ng"], 3);
    expect(s[1]!.hold && s[2]!.hold).toBe(true);
    const hum = splitSyllables(["hh", "m"], 1)[0]!;
    expect(hum.nucleus).toBeUndefined();
    expect(hum.onset).toEqual(["hh", "m"]);
  });

  test("pure and repeatable", () => {
    const input = [{ lyric: "sing-" }, { lyric: "ing" }, { lyric: "_" }];
    expect(phrasePhones(input)).toEqual(phrasePhones(input));
  });
});
