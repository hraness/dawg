import { describe, expect, test } from "bun:test";
import {
  briefConstraints,
  cardMessages,
  cardPins,
  EXAMPLE_CARDS,
  motifOf,
  numeral,
  readMusic,
  sampleGenome,
  songFromCard,
  validateCard,
  validateMusic,
} from "./index.ts";
import { Rng } from "./rng.ts";
import { scaleOf } from "./theory.ts";

const aMinor = scaleOf(9, "minor");
const cMajor = scaleOf(0, "major");

describe("music a model writes", () => {
  test("numerals take their quality from the mode", () => {
    expect(numeral(cMajor, "vi")!.name).toBe("vi");
    expect(numeral(cMajor, "VI")!.name).toBe("vi");
    expect(numeral(aMinor, "VI")!.name).toBe("VI");
    expect(numeral(cMajor, "V7")!.name).toBe("V7");
    expect(numeral(cMajor, "IVadd9")!.name).toBe("IVadd9");
    // A slash puts the 3rd in the bass; a diminished chord always does.
    expect(numeral(cMajor, "I/3")!.name).toBe("I/E");
    expect(numeral(cMajor, "vii")!.name).toContain("/");
    expect(numeral(cMajor, "bVII")).toBeUndefined();
    expect(numeral(cMajor, "Cmaj7")).toBeUndefined();
  });

  test("a motif reads from its grid", () => {
    const m = motifOf({ rhythm: "x-..x.x---......", steps: [2, -9] });
    if (typeof m === "string") throw new Error(m);
    expect(m.beats).toBe(4);
    expect(m.cell).toEqual([
      { beat: 0, len: 0.5 },
      { beat: 1, len: 0.25 },
      { beat: 1.5, len: 1 },
    ]);
    // Steps clamp to a 4th of the scale.
    expect(m.steps).toEqual([2, -4]);
    expect(motifOf({ rhythm: "x...............", steps: [] })).toBeString();
    expect(motifOf({ rhythm: "xoxo", steps: [1] })).toBeString();
    // Only the hook runs past a bar.
    const long = { rhythm: "x.x.".repeat(8), steps: [1, 1, 1] };
    const hook = motifOf(long, 64);
    const verse = motifOf(long, 16);
    expect(typeof hook !== "string" && hook.beats).toBe(8);
    expect(typeof verse !== "string" && verse.beats).toBe(4);
  });

  test("readMusic keeps what it can read and names what it drops", () => {
    const read = readMusic(
      {
        chords: {
          drop: ["vi", "IV", "I", "V"],
          verse: ["ii"],
          bridge: ["x", "IV", "V"],
        },
        motifs: { verse: { rhythm: "x...............", steps: [] } },
      },
      cMajor,
    );
    expect(read.loops.drop!.map((c) => c.name)).toEqual(["vi", "IV", "I", "V"]);
    expect(read.loops.verse).toBeUndefined();
    expect(read.loops.bridge!.map((c) => c.name)).toEqual(["IV", "V"]);
    expect(read.motifs.verse).toBeUndefined();
    expect(read.warnings.length).toBe(3);
  });

  test("validateMusic takes chords as a string and drops unknown values", () => {
    const v = validateMusic({
      chords: { drop: "vi - IV - I - V" },
      dropBass: "wobble",
      leadOctave: true,
      extra: 1,
    });
    expect(v.music!.chords!.drop).toEqual(["vi", "IV", "I", "V"]);
    expect(v.music!.dropBass).toBeUndefined();
    expect(v.music!.leadOctave).toBe(true);
    expect(v.warnings.length).toBe(1);
  });

  test("the card's music is what the song plays", () => {
    const card = EXAMPLE_CARDS[0]!;
    const song = songFromCard(card, 3);
    const line = song.notes.find((n) => n.startsWith("chords:"))!;
    const drop = card.music!.chords!.drop!;
    const want = drop.map((t) => numeral(song.genome.scale, t)!.name).join(" ");
    expect(line).toContain(`drop ${want};`);
    expect(song.notes.some((n) => n.startsWith("music: 4 chord loops"))).toBe(
      true,
    );
    const bare = songFromCard({ ...card, music: undefined }, 3);
    expect(JSON.stringify(bare.score)).not.toBe(JSON.stringify(song.score));
    expect(JSON.stringify(songFromCard(card, 3).score)).toBe(
      JSON.stringify(song.score),
    );
  });

  test("a card with music hears the constraints it was shown", () => {
    const brief = "a song about a parking garage at 3am";
    const shown = briefConstraints(brief, 11);
    const card = { ...EXAMPLE_CARDS[1]!, pins: {}, brief };
    const song = songFromCard(card, 11);
    // Mood no longer steers the mode or the beat once the model wrote for them.
    expect(song.notes.slice(0, 7)).toEqual(shown.slice(0, 7));
    expect(cardPins(card, new Rng(1)).mode).toBeUndefined();
    expect(
      cardPins({ ...card, music: undefined }, new Rng(1)).mode,
    ).toBeDefined();
    const chat = cardMessages(brief, 11, undefined, shown);
    expect(chat[1]!.content).toContain(shown[0]!);
  });

  test("example cards are valid and their motifs read cleanly", () => {
    for (const card of EXAMPLE_CARDS) {
      const checked = validateCard(JSON.parse(JSON.stringify(card)));
      expect(checked.ok && checked.warnings).toEqual([]);
      expect(readMusic(card.music, sampleGenome(1).scale).warnings).toEqual([]);
    }
  });
});
