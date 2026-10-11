/**
 * Machine vox in song.ts (lane V0, SDK 1.36.0): `Note.vox` and `Track.vox`
 * print in canonical key order and sync back byte-stably; `lyrics()` reads
 * the 0.9 grammar (`[ph]`, `,`, `/`, word continuation `-`).
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { lyrics, note, seq, song, track, vox, SDK_VERSION } from "./v1.ts";

const full = createScore({
  tempoBpm: 96,
  bars: 2,
  tracks: [
    {
      id: "lead",
      name: "lead",
      instrument: "sing",
      vox: {
        engine: "kokoro",
        voice: "kokoro:af_heart",
        lang: "en-us",
        fit: "psola",
        p: { speed: 1.1, warmth: 0.25 },
      },
    },
    {
      id: "bot",
      name: "bot",
      instrument: "saw",
      vox: { engine: "formant", voice: "formant:robot" },
    },
  ],
  notes: [
    {
      id: "n1",
      trackId: "lead",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
      lyric: "hel-",
      vox: {
        ph: ["hh", "eh", "l"],
        lang: "en-gb",
        cons: 0.3,
        lead: 0.05,
        shift: -0.02,
        breath: 0.2,
        dyn: [
          { at: 0, v: 0.5 },
          { at: 0.5, v: 1 },
          { at: 1, v: 0.7 },
        ],
        p: { bright: 0.5, air: 2 },
      },
    },
    {
      id: "n2",
      trackId: "lead",
      startTick: 480,
      durationTicks: 480,
      pitch: 62,
      velocity: 0.8,
      lyric: "lo",
      vox: { cons: { s: 0.08 } },
    },
    {
      id: "n3",
      trackId: "lead",
      startTick: 960,
      durationTicks: 480,
      pitch: 64,
      velocity: 0.8,
      lyric: "_",
    },
  ],
} as never);

async function roundTrip(score: TrackScore): Promise<TrackScore> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-print-vox-"));
  try {
    await initProject(dir);
    for (const file of printProject(score).files)
      await writeAtomic(join(dir, file.path), file.text);
    const evaluated = await evaluateProject(dir);
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
    return evaluated.score;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Seeded PRNG (mulberry32) so the fuzz is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLS = [
  "la",
  "sun",
  "hel",
  "lo",
  "twin",
  "kle",
  "star",
  "won",
  "der",
  "I",
  "morn",
  "ing",
];
const PHONES = [
  "hh",
  "eh",
  "l",
  "ow",
  "s",
  "t",
  "aa",
  "r",
  "m",
  "iy",
  "ng",
  "d",
  "er",
];

function randomLine(next: () => number): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  const tokens: string[] = [];
  const count = 1 + Math.floor(next() * 10);
  for (let i = 0; i < count; i += 1) {
    const r = next();
    if (r < 0.08) tokens.push("_");
    else if (r < 0.14) tokens.push("~");
    else if (r < 0.2) tokens.push(",");
    else if (r < 0.24) tokens.push("/");
    else {
      const parts = Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
        const syl = pick(SYLS);
        if (next() < 0.25) {
          const ph = Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
            pick(PHONES),
          );
          return `${syl}[${ph.join(" ")}]`;
        }
        return syl;
      });
      tokens.push(parts.join("-") + (next() < 0.1 ? "-" : ""));
    }
  }
  return tokens.join(" ");
}

describe("machine vox in the SDK", () => {
  test("the minor bump", () => {
    expect(SDK_VERSION).toBe("1.36.0");
  });

  test("note vox, vox() and lyrics() store what dawg reads", () => {
    const result = song({
      tempo: 100,
      bars: 1,
      tracks: [
        track({
          name: "lead",
          instrument: "sing",
          vox: vox("formant", "formant:robot", { lang: "EN-US" }),
          notes: [
            note("C4", 0, 1, 0.8, { lyric: "hel-", vox: { ph: "HH EH1 l" } }),
            ...lyrics(
              "lo , world[w er l d] / a-gain-",
              seq("D4 E4 F4 G4", { from: 1 }),
            ),
          ],
        }),
      ],
    });
    expect(result.tracks[0]!.vox).toEqual({
      engine: "formant",
      voice: "formant:robot",
      lang: "en-us",
    });
    const sung = result.notes!.map((n) => [n.lyric, n.vox]);
    expect(sung).toEqual([
      ["hel-", { ph: ["hh", "eh", "l"] }],
      ["lo", undefined],
      ["world", { ph: ["w", "er", "l", "d"], breath: 0.2 }],
      ["a-", undefined],
      ["gain-", undefined],
    ]);
    expect(() => createScore(result as never)).not.toThrow();
    expect(() => vox("nope" as never)).toThrow(/engine/);
    expect(() => note("C4", 0, 1, 0.8, { vox: { pitch: 1 } as never })).toThrow(
      /no field "pitch"/,
    );
  });

  test("vox prints in canonical key order, ph as one string", () => {
    const text = printTrack(full, full.tracks[0]!);
    expect(text).toContain('ph: "hh eh l",');
    expect(text).toContain("cons: { s: 0.08 }");
    expect(text).toContain(
      'vox: {\n    engine: "kokoro",\n    voice: "kokoro:af_heart",\n    lang: "en-us",\n    fit: "psola",\n    p: { speed: 1.1, warmth: 0.25 },\n  },',
    );
    const order = [
      "ph:",
      "lang:",
      "cons:",
      "lead:",
      "shift:",
      "breath:",
      "dyn:",
      "p:",
    ].map((key) => text.indexOf(key, text.indexOf('lyric: "hel-"')));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(printTrack(full, full.tracks[1]!)).toContain(
      'vox: { engine: "formant", voice: "formant:robot" },',
    );
  });

  test("print(sync(print(s))) === print(s) with every vox field", async () => {
    const back = await roundTrip(full);
    expect(back.tracks.map((t) => t.vox)).toEqual(
      full.tracks.map((t) => t.vox),
    );
    expect(back.notes.map((n) => [n.lyric, n.vox])).toEqual(
      full.notes.map((n) => [n.lyric, n.vox]),
    );
    expect(printProject(back).files).toEqual(printProject(full).files);
  });

  test("fuzz: random lyric lines through lyrics(), print and sync", async () => {
    const next = rng(0x5eed);
    const lines = Array.from({ length: 48 }, () => randomLine(next));
    const result = song({
      tempo: 120,
      bars: 4,
      tracks: lines.map((line, index) =>
        track({
          name: `v${index}`,
          instrument: "sing",
          notes: lyrics(
            line,
            seq(
              Array.from(
                { length: 1 + Math.floor(next() * 12) },
                () => "C4",
              ).join(" "),
              {
                step: 0.5,
              },
            ),
          ),
        }),
      ),
    });
    const score = createScore(result as never);
    const printed = printProject(score).files;
    const back = await roundTrip(score);
    expect(printProject(back).files).toEqual(printed);
    expect(back.notes.map((n) => [n.lyric, n.vox])).toEqual(
      score.notes.map((n) => [n.lyric, n.vox]),
    );
    // Every stored lyric is one grammar syllable.
    for (const n of score.notes)
      if (n.lyric !== undefined) expect(n.lyric).toMatch(/^[^\s[\],]+$/u);
  });
});
