import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "./diff.ts";
import { assignLyrics, lyricLine, parseLyric } from "./lyrics.ts";
import { createScore, type Note, type TrackScore } from "./score.ts";
import {
  clearLyrics,
  joinNotes,
  rangeLyricLine,
  reflowLyrics,
  retypeLyrics,
  splitNotes,
} from "./vox-edit.ts";
import { lintVox } from "./vox.ts";

const BAR = 4 * 960;

/** Eight quarter notes over two bars on track `lead`. */
function melody(count = 8): TrackScore {
  return createScore({
    tempoBpm: 120,
    ticksPerBeat: 960,
    bars: 4,
    tracks: [{ id: "lead", name: "lead", instrument: "sing" }],
    notes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      trackId: "lead",
      startTick: i * 960,
      durationTicks: 960,
      pitch: 60 + (i % 5),
      velocity: 0.8,
    })),
  } as never);
}

const lyricsOf = (score: TrackScore) => score.notes.map((n) => n.lyric);
const music = (score: TrackScore) =>
  score.notes.map(({ id, startTick, durationTicks, pitch, velocity }) => ({
    id,
    startTick,
    durationTicks,
    pitch,
    velocity,
  }));

describe("the lyric grammar (0.9 superset)", () => {
  test("continuation, phones, breath and line break", () => {
    const tokens = parseLyric(
      "twin-kle , lit-tle star[s t aa r] _ ~ / hel[hh eh l]- lo",
    );
    expect(tokens.map((t) => t.syl)).toEqual([
      "twin",
      "kle",
      "lit",
      "tle",
      "star",
      "_",
      "~",
      "hel",
      "lo",
    ]);
    expect(tokens[0]!.cont).toBe(true);
    expect(tokens[1]!.cont).toBeUndefined();
    expect(tokens[2]!.breath).toBe(true);
    expect(tokens[4]!.ph).toEqual(["s", "t", "aa", "r"]);
    // A trailing `-` continues the word into the next one typed.
    expect(tokens[7]).toMatchObject({ cont: true, ph: ["hh", "eh", "l"] });
    expect(tokens[8]).toMatchObject({ first: false, word: tokens[7]!.word });
  });

  test("0.7 lines read as before, plus stored continuations", () => {
    const { lyrics } = assignLyrics("sun-lit morn-ing _ glow", [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `n${i}`,
        startTick: i,
        pitch: 60,
      })),
    ]);
    expect([...lyrics.values()]).toEqual([
      "sun-",
      "lit",
      "morn-",
      "ing",
      "_",
      "glow",
    ]);
  });

  test("lyricLine reads back what assignLyrics stored", () => {
    const line = "twin-kle twin-kle , lit-tle star[s t aa r] _ ~ how I won-der";
    const notes = Array.from({ length: 13 }, (_, i) => ({
      id: `n${i}`,
      startTick: i,
      pitch: 60,
    }));
    const a = assignLyrics(line, notes);
    const stored = notes.map((n) => ({
      lyric: a.lyrics.get(n.id),
      vox: {
        ...(a.ph.has(n.id) ? { ph: a.ph.get(n.id)! } : {}),
        ...(a.breaths.has(n.id) ? { breath: 0.2 } : {}),
      },
    }));
    expect(lyricLine(stored)).toBe(line);
  });

  test("fuzz: random lines survive assign → line → assign", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const syls = ["la", "hel", "lo", "sun", "a", "I", "wor", "ld", "ré"];
    const phones = ["hh eh l", "ow", "s t aa r", "ax"];
    for (let round = 0; round < 300; round += 1) {
      const parts: string[] = [];
      const count = 1 + rand(10);
      for (let i = 0; i < count; i += 1) {
        const r = rand(10);
        if (r === 0) parts.push("_");
        else if (r === 1 && parts.length) parts.push(",");
        else if (r === 2 && parts.length) parts.push("/");
        else {
          const n = 1 + rand(3);
          const word = Array.from({ length: n }, () => {
            const s = syls[rand(syls.length)]!;
            return rand(4) === 0 ? `${s}[${phones[rand(phones.length)]}]` : s;
          }).join("-");
          parts.push(word);
        }
      }
      const line = parts.join(" ");
      const tokens = parseLyric(line).filter((t) => t.kind !== "rest");
      const notes = tokens.map((_, i) => ({
        id: `n${i}`,
        startTick: i,
        pitch: 60,
      }));
      const a = assignLyrics(line, notes);
      const stored = notes.map((n) => ({
        lyric: a.lyrics.get(n.id),
        vox: {
          ...(a.ph.has(n.id) ? { ph: a.ph.get(n.id)! } : {}),
          ...(a.breaths.has(n.id) ? { breath: 0.2 } : {}),
        },
      }));
      const again = assignLyrics(lyricLine(stored), notes);
      expect(Object.fromEntries(again.lyrics), line).toEqual(
        Object.fromEntries(a.lyrics),
      );
      expect(Object.fromEntries(again.ph), line).toEqual(
        Object.fromEntries(a.ph),
      );
      expect([...again.breaths], line).toEqual([...a.breaths]);
    }
  });
});

describe("lyric edits (design 3.4)", () => {
  test("retype a range touches no music field", () => {
    const base = applyScoreOperations(
      melody(),
      retypeLyrics(melody(), "lead", {}, "one two three four five six sev-en")
        .operations,
    );
    const edit = retypeLyrics(
      base,
      "lead",
      { fromTick: BAR, toTick: 2 * BAR },
      "hel[hh eh l]-lo , world",
    );
    const next = applyScoreOperations(base, edit.operations);
    expect(music(next)).toEqual(music(base));
    for (const op of edit.operations) {
      expect(op.type).toBe("updateNote");
      const patch = (op as { patch: Record<string, unknown> }).patch;
      expect(
        Object.keys(patch).every((k) => k === "lyric" || k === "vox"),
      ).toBe(true);
    }
    expect(lyricsOf(next)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "hel-",
      "lo",
      "world",
      "_",
    ]);
    expect(next.notes[4]!.vox?.ph).toEqual(["hh", "eh", "l"]);
    expect(next.notes[6]!.vox?.breath).toBe(0.2);
    expect(edit.line).toBe("hel[hh eh l]-lo , world _");
  });

  test("leftover syllables are reported, spare notes hold", () => {
    const edit = retypeLyrics(melody(2), "lead", {}, "a b c d");
    expect(edit.dropped).toEqual(["c", "d"]);
  });

  test("reflow on unchanged notes is a no-op; after a move it re-reads", () => {
    const sung = applyScoreOperations(
      melody(4),
      retypeLyrics(melody(4), "lead", {}, "hel-lo _ world").operations,
    );
    expect(reflowLyrics(sung, "lead", {}).operations).toEqual([]);
    // After a move the line reads in time order and reflow re-seats it.
    const moved = applyScoreOperations(sung, [
      {
        type: "updateNote",
        noteId: "n0",
        patch: { startTick: 960 + 480 },
      } as never,
    ]);
    expect(rangeLyricLine(moved, "lead", {})).toBe("lo hel- _ world");
    const fixed = applyScoreOperations(
      moved,
      reflowLyrics(moved, "lead", {}).operations,
    );
    expect(rangeLyricLine(fixed, "lead", {})).toBe("lo hel- _ world");
  });

  test("clear removes lyric and phones in the range only", () => {
    const sung = applyScoreOperations(
      melody(4),
      retypeLyrics(melody(4), "lead", {}, "a[ax] b c d").operations,
    );
    const next = applyScoreOperations(
      sung,
      clearLyrics(sung, "lead", { toTick: 960 * 2 }).operations,
    );
    expect(lyricsOf(next)).toEqual([undefined, undefined, "c", "d"]);
    expect(next.notes[0]!.vox).toBeUndefined();
  });

  test("split gives `_` and never a syllable; join restores the lyric", () => {
    const sung = applyScoreOperations(
      melody(2),
      retypeLyrics(melody(2), "lead", {}, "hel-lo").operations,
    );
    const split = splitNotes(sung, ["n0"]);
    const next = applyScoreOperations(sung, split.operations);
    expect(next.notes.length).toBe(3);
    const ordered = [...next.notes].sort((a, b) => a.startTick - b.startTick);
    expect(ordered.map((n) => n.lyric)).toEqual(["hel-", "_", "lo"]);
    expect(lintVox(next, "lead")).toEqual([]);
    const join = joinNotes(
      next,
      ordered.slice(0, 2).map((n) => n.id),
    );
    expect(join.dropped).toEqual([]);
    const back = applyScoreOperations(next, join.operations);
    expect(music(back)).toEqual(music(sung));
    expect(lyricsOf(back)).toEqual(lyricsOf(sung));
  });

  test("join reports every dropped syllable", () => {
    const sung = applyScoreOperations(
      melody(3),
      retypeLyrics(melody(3), "lead", {}, "a _ lo").operations,
    );
    const join = joinNotes(sung, ["n0", "n1", "n2"]);
    expect(join.dropped).toEqual(["lo"]);
    const back = applyScoreOperations(sung, join.operations);
    expect(back.notes.map((n: Note) => [n.lyric, n.durationTicks])).toEqual([
      ["a", 3 * 960],
    ]);
  });

  test("moves keep the multiset of (id, lyric)", () => {
    const sung = applyScoreOperations(
      melody(),
      retypeLyrics(melody(), "lead", {}, "a b c d e f g h").operations,
    );
    const pairs = (s: TrackScore) =>
      s.notes.map((n) => `${n.id}:${n.lyric}`).sort();
    const moved = applyScoreOperations(
      sung,
      sung.notes.map((n, i) => ({
        type: "updateNote",
        noteId: n.id,
        patch: { startTick: ((i * 7) % 8) * 960, pitch: n.pitch + 2 },
      })) as never,
    );
    expect(pairs(moved)).toEqual(pairs(sung));
  });
});
