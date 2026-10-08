import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../src/project/init.ts";
import { diffScores } from "./diff.ts";
import { decodeLoop, encodeLoop } from "./loop.ts";
import {
  describeMaster,
  LOUDNESS_TARGETS,
  MASTER_PRESETS,
  MASTER_SPECS,
  MASTER_UNITS,
  masterActive,
  masterDefaults,
  normalizeMaster,
} from "./master.ts";
import { normalizeParams } from "./params.ts";
import {
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  ScoreValidationError,
} from "./score.ts";
import { evaluateProject } from "./sdk/eval.ts";
import { printProject, printSong } from "./sdk/print.ts";
import { song } from "./sdk/v1.ts";

const base = createScore({
  tempoBpm: 140,
  bars: 1,
  tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
  notes: [
    {
      id: "n1",
      trackId: "lead",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    },
  ],
});

describe("song master: storage", () => {
  test("no master stores nothing, so 0.4 scores serialize unchanged", () => {
    expect("master" in base).toBe(false);
    expect("master" in base.toJSON()).toBe(false);
    expect(encodeLoop(base)).not.toContain("master");
    expect(masterActive(base.master)).toBe(false);
  });

  test("units fill their defaults; empty masters normalize away", () => {
    expect(normalizeMaster(undefined)).toBeUndefined();
    expect(normalizeMaster(null)).toBeUndefined();
    expect(normalizeMaster({})).toBeUndefined();
    const master = normalizeMaster({ limiter: {}, target: -14 })!;
    expect(master.limiter).toEqual(masterDefaults("limiter"));
    expect(master.limiter!.ceiling).toBe(-1);
    expect(master.target).toBe(-14);
    expect(masterActive(master)).toBe(true);
  });

  test("typos and out-of-range values are rejected with the unit named", () => {
    expect(() => normalizeMaster({ limitter: {} })).toThrow(/limitter/);
    expect(() => normalizeMaster({ glue: { ratio: 50 } })).toThrow(
      /master glue/,
    );
    expect(() => normalizeMaster({ target: -2 })).toThrow(/LUFS/);
    expect(() => createScore({ master: { eq: { nope: 1 } } as never })).toThrow(
      ScoreValidationError,
    );
  });

  test("every preset and target is valid", () => {
    for (const unit of MASTER_UNITS)
      for (const preset of Object.values(MASTER_PRESETS[unit]))
        expect(() =>
          normalizeParams(MASTER_SPECS[unit].params, preset, unit),
        ).not.toThrow();
    for (const target of Object.values(LOUDNESS_TARGETS))
      expect(() =>
        normalizeMaster({
          target: target.lufs,
          limiter: { ceiling: target.ceiling },
        }),
      ).not.toThrow();
  });

  test("survives toJSON, the loop codec and setMaster/diff", () => {
    const master = normalizeMaster({
      glue: { ratio: 4 },
      width: { width: 1.2 },
      target: -9,
    })!;
    const next = base.withMaster(master);
    expect(scoreFromJSON(next.toJSON()).master).toEqual(master);
    expect(decodeLoop(encodeLoop(next)).master).toEqual(master);
    const ops = diffScores(base, next);
    expect(ops).toEqual([{ type: "setMaster", master }]);
    expect(applyScoreOperation(base, ops[0]!).master).toEqual(master);
    const cleared = applyScoreOperation(next, {
      type: "setMaster",
      master: null,
    });
    expect("master" in cleared).toBe(false);
    expect(diffScores(next, cleared)).toEqual([
      { type: "setMaster", master: null },
    ]);
    // Other revisions keep the master.
    expect(next.withTempo(120).master).toEqual(master);
    expect(next.withBars(2).master).toEqual(master);
    expect(next.withTracks(next.tracks).master).toEqual(master);
  });

  test("describes itself for receipts", () => {
    expect(describeMaster(undefined)).toBe("off");
    expect(
      describeMaster(
        normalizeMaster({ limiter: { ceiling: -0.3 }, target: -8 }),
      ),
    ).toBe("limiter ceiling -0.3 dBTP · target -8 LUFS");
  });
});

describe("song master: SDK", () => {
  test("song.ts prints only non-default values, prettier-stable", async () => {
    const score = base.withMaster(
      normalizeMaster({
        eq: { high: 1.5 },
        glue: {},
        limiter: { ceiling: -0.3, release: 60 },
        target: -8,
      })!,
    );
    const text = printSong(score);
    expect(text).toContain(
      [
        "  master: {",
        "    eq: { high: 1.5 },",
        "    glue: {},",
        "    limiter: { ceiling: -0.3, release: 60 },",
        "    target: -8,",
        "  },",
      ].join("\n"),
    );
    expect(await prettier.format(text, { parser: "typescript" })).toBe(text);
    expect(printSong(base)).not.toContain("master");
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-master-"));
    try {
      await initProject(dir);
      const score = base.withMaster(
        normalizeMaster({
          tape: { drive: 3 },
          width: { mono: 150 },
          limiter: {},
          target: -14,
        })!,
      );
      for (const file of printProject(score).files)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.master).toEqual(score.master);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(score).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SDK master target", () => {
  test("takes LUFS only; a name says which number to use", () => {
    expect(() =>
      song({ tempo: 120, tracks: [], master: { target: "club" as never } }),
    ).toThrow(/takes LUFS.*-8 \(club/);
  });
});

describe("DAWG.md master table", () => {
  test("lists every MASTER_SPECS param with its range and default", () => {
    const text = readFileSync(join(import.meta.dir, "..", "DAWG.md"), "utf8");
    const table = text
      .split("<!-- master-params:start -->")[1]!
      .split("<!-- master-params:end -->")[0]!;
    const rows = new Map<string, string[]>();
    for (const line of table.split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length < 6 || cells[1]!.startsWith("-") || cells[1] === "Unit")
        continue;
      rows.set(`${cells[1]!.replaceAll("*", "")} ${cells[2]}`, cells);
    }
    let count = 0;
    for (const unit of MASTER_UNITS)
      for (const [key, param] of Object.entries(MASTER_SPECS[unit].params)) {
        const row = rows.get(`${unit} ${key}`);
        expect(row, `${unit} ${key}`).toBeDefined();
        if (param.kind === "number") {
          expect(row![3]).toStartWith(`${param.min}..${param.max}`);
          expect(row![4]).toBe(String(param.default));
        }
        count += 1;
      }
    expect(rows.size).toBe(count);
  });
});

describe("song master with the other 0.5 song fields", () => {
  const combined = () =>
    scoreFromJSON({
      ...base.toJSON(),
      bars: 2,
      time: { tempo: [{ tick: 1920, bpm: 100, ramp: "linear" }] },
      tuning: { name: "19-edo" },
      master: { glue: { ratio: 3 }, limiter: {}, target: -12 },
    });

  test("the loop codec and diff keep tempo map, tuning and master together", () => {
    const score = combined();
    expect(score.time).toBeDefined();
    expect(score.tuning).toBeDefined();
    const decoded = decodeLoop(encodeLoop(score));
    expect(decoded.toJSON()).toEqual(score.toJSON());
    const plain = scoreFromJSON({ ...base.toJSON(), bars: 2 });
    const ops = diffScores(plain, score).map((op) => op.type);
    expect(ops).toEqual(
      expect.arrayContaining(["setTime", "setTuning", "setMaster"]),
    );
    let applied = plain;
    for (const op of diffScores(plain, score))
      applied = applyScoreOperation(applied, op);
    expect(applied.toJSON()).toEqual(score.toJSON());
  });

  test("print → eval → print keeps all three", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-master-05-"));
    try {
      await initProject(dir);
      const score = combined();
      for (const file of printProject(score).files)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.master).toEqual(score.master);
      expect(evaluated.score.time).toEqual(score.time);
      expect(evaluated.score.tuning).toEqual(score.tuning);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
