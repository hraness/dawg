import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  exportSampleRate,
  measureRendered,
  measureScore,
  measureScoreOffThread,
} from "../audio/measure.ts";
import { renderScorePcm } from "../audio/wav.ts";
import {
  applyMasterCommand,
  loudnessLine,
  measurementLine,
  parseMasterCommand,
} from "./master.ts";

const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "a", name: "a", instrument: "saw" }],
    notes: [
      {
        id: "n1",
        trackId: "a",
        pitch: 57,
        startTick: 0,
        durationTicks: 1_800,
        velocity: 0.8,
      },
    ],
  });

describe("parseMasterCommand", () => {
  test("lists, measures and turns off", () => {
    expect(parseMasterCommand("master")).toEqual({ type: "master-list" });
    expect(parseMasterCommand("/master")).toEqual({ type: "master-list" });
    expect(parseMasterCommand("master measure")).toEqual({
      type: "master-measure",
    });
    expect(parseMasterCommand("master off")).toEqual({ type: "master-off" });
    expect(parseMasterCommand("masters")).toBeUndefined();
    expect(parseMasterCommand("mastering on")).toBeUndefined();
  });

  test("units on, off, presets and params", () => {
    expect(parseMasterCommand("master glue on")).toEqual({
      type: "master-unit",
      unit: "glue",
      on: true,
    });
    expect(parseMasterCommand("master tape off")).toEqual({
      type: "master-unit",
      unit: "tape",
      on: false,
    });
    expect(parseMasterCommand("master eq preset air")).toEqual({
      type: "master-preset",
      unit: "eq",
      preset: "air",
    });
    expect(parseMasterCommand("master eq air")).toEqual({
      type: "master-preset",
      unit: "eq",
      preset: "air",
    });
    expect(parseMasterCommand("master eq low 2 highfreq 9000")).toEqual({
      type: "master-set",
      unit: "eq",
      values: { low: 2, highfreq: 9_000 },
    });
    expect(parseMasterCommand("master limiter truepeak off")).toEqual({
      type: "master-set",
      unit: "limiter",
      values: { truepeak: false },
    });
    // Unknown params, out-of-range values and odd pairs do not parse.
    expect(parseMasterCommand("master eq loww 2")).toBeUndefined();
    expect(parseMasterCommand("master eq low")).toBeUndefined();
    // Inherited Object properties are not presets.
    expect(parseMasterCommand("master eq constructor")).toBeUndefined();
    expect(parseMasterCommand("master eq toString")).toBeUndefined();
  });

  test("a bare unit shows it; reset keeps it on with defaults", () => {
    expect(parseMasterCommand("master glue")).toEqual({
      type: "master-show",
      unit: "glue",
    });
    expect(parseMasterCommand("master glue reset")).toEqual({
      type: "master-reset",
      unit: "glue",
    });
  });

  test("targets by number, name or off", () => {
    expect(parseMasterCommand("master target -14")).toEqual({
      type: "master-target",
      lufs: -14,
    });
    // Loudness targets are negative; a bare 9 means -9 LUFS.
    expect(parseMasterCommand("master target 9")).toEqual({
      type: "master-target",
      lufs: -9,
      flipped: 9,
    });
    expect(parseMasterCommand("master club")).toEqual({
      type: "master-target",
      lufs: -8,
      name: "club",
    });
    expect(parseMasterCommand("master target off")).toEqual({
      type: "master-target",
      lufs: null,
    });
    expect(parseMasterCommand("master target loudest")).toBeUndefined();
  });

  test("shorthands: master -14, master on, master spotify", () => {
    expect(parseMasterCommand("master -14")).toEqual({
      type: "master-target",
      lufs: -14,
    });
    const streaming = parseMasterCommand("master streaming");
    expect(parseMasterCommand("master on")).toEqual(streaming);
    expect(parseMasterCommand("master spotify")).toEqual(streaming);
    expect(parseMasterCommand("master youtube")).toEqual(streaming);
    // The reply says how a positive number was read.
    const flipped = applyMasterCommand(
      song(),
      parseMasterCommand("master 14")!,
    );
    expect(flipped.next?.master?.target).toBe(-14);
    expect(flipped.message).toContain("read 14 as -14 LUFS");
  });
});

describe("applyMasterCommand", () => {
  test("a unit on stores its defaults as one setMaster revision", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master glue on")!,
    );
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("score.master");
    expect(result.next?.master?.glue?.ratio).toBe(2);
    expect(result.message).toStartWith("master · glue");
  });

  test("a named target turns the limiter on at its ceiling", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master loud")!,
    );
    expect(result.next?.master?.target).toBe(-6);
    expect(result.next?.master?.limiter?.ceiling).toBe(-2);
  });

  test("a loud target without the limiter warns about the peak cap", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master target -9")!,
    );
    expect(result.next?.master?.limiter).toBeUndefined();
    expect(result.message).toContain("no limiter");
  });

  test("params merge into the unit; off removes it; master off bypasses", () => {
    let score = applyMasterCommand(
      song(),
      parseMasterCommand("master eq low 3")!,
    ).next!;
    score = applyMasterCommand(
      score,
      parseMasterCommand("master eq high -2")!,
    ).next!;
    expect(score.master?.eq?.low).toBe(3);
    expect(score.master?.eq?.high).toBe(-2);
    score = applyMasterCommand(
      score,
      parseMasterCommand("master width on")!,
    ).next!;
    score = applyMasterCommand(
      score,
      parseMasterCommand("master eq off")!,
    ).next!;
    expect(score.master?.eq).toBeUndefined();
    expect(score.master?.width).toBeDefined();
    const off = applyMasterCommand(score, parseMasterCommand("master off")!);
    expect(off.next?.master).toBeUndefined();
    expect("master" in off.next!.toJSON()).toBe(false);
  });

  test("reset restores a unit's defaults and keeps it on", () => {
    let score = applyMasterCommand(
      song(),
      parseMasterCommand("master glue ratio 6")!,
    ).next!;
    expect(score.master?.glue?.ratio).toBe(6);
    score = applyMasterCommand(
      score,
      parseMasterCommand("master glue reset")!,
    ).next!;
    expect(score.master?.glue?.ratio).toBe(2);
  });

  test("a bare unit lists every parameter and the presets", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master limiter")!,
    );
    expect(result.ok).toBe(true);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("master limiter · off");
    for (const name of ["ceiling -1 dBTP", "release", "lookahead", "truepeak"])
      expect(result.message).toContain(name);
    expect(result.message).toContain("presets");
  });

  test("an unknown preset fails and lists the real ones", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master eq preset nope")!,
    );
    expect(result.ok).toBe(false);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("no preset nope");
    expect(result.message).toContain("air");
  });

  test("a no-op change commits nothing", () => {
    const result = applyMasterCommand(
      song(),
      parseMasterCommand("master off")!,
    );
    expect(result.ok).toBe(true);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("master · off");
  });
});

describe("measurement lines", () => {
  test("measure_mix and `render --measure` read the same rate and numbers", () => {
    let score = song();
    for (const command of [
      "master eq preset air",
      "master limiter on",
      "master target -14",
    ])
      score = applyMasterCommand(score, parseMasterCommand(command)!).next!;
    // The CLI path: render at the export rate, one-shot, then measure.
    const rate = exportSampleRate(score);
    expect(rate).toBe(48_000);
    const exported = measureRendered(
      renderScorePcm(score, { sampleRate: rate }),
      false,
    );
    const agent = measureScore(score, { loop: false });
    expect(agent.sampleRate).toBe(exported.sampleRate);
    expect(agent.mix.loudness.integrated).toBeCloseTo(
      exported.mix.loudness.integrated,
      6,
    );
    expect(agent.mix.loudness.truePeak).toBeCloseTo(
      exported.mix.loudness.truePeak,
      6,
    );
  });

  test("the off-thread measure matches inline and keeps the loop free", async () => {
    let score = createScore({ ...song().toJSON(), bars: 32 });
    for (const command of [
      "master glue on",
      "master limiter on",
      "master club",
    ])
      score = applyMasterCommand(score, parseMasterCommand(command)!).next!;
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    // perf-exempt: timer ticks against elapsed time, no budget.
    const started = performance.now();
    const off = await measureScoreOffThread(score);
    const elapsed = performance.now() - started;
    clearInterval(timer);
    // The caller's event loop ran throughout: at least a third of the ticks
    // a free 5 ms timer would get, and never a single long freeze.
    expect(ticks).toBeGreaterThan(elapsed / 5 / 3);
    const inline = measureScore(score);
    expect(off.sampleRate).toBe(inline.sampleRate);
    expect(off.mix.loudness.integrated).toBeCloseTo(
      inline.mix.loudness.integrated,
      9,
    );
    expect(off.master?.gainDb).toBeCloseTo(inline.master!.gainDb, 9);
  });

  test("measure and describe a mastered loop", () => {
    const score = applyMasterCommand(
      song(),
      parseMasterCommand("master streaming")!,
    ).next!;
    const measured = measureScore(score);
    expect(measured.loop).toBe(true);
    expect(measured.master?.reached).toBe(true);
    expect(Math.abs(measured.mix.loudness.integrated + 14)).toBeLessThan(0.6);
    const line = measurementLine(measured.mix, measured.master);
    expect(line).toContain("LUFS");
    expect(line).toContain("target -14.0 reached");
    expect(line).toContain("correlation");
    expect(line).toContain("momentary max");
    expect(loudnessLine({ integrated: -Infinity, truePeak: -1.04 })).toBe(
      "-∞ LUFS · -1.0 dBTP",
    );
  });
});

describe("a silent song with a target", () => {
  test("says the target was not applied instead of missed by -∞", () => {
    const silent = applyMasterCommand(
      createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [{ id: "a", name: "a", instrument: "saw" }],
        notes: [],
      }),
      parseMasterCommand("master streaming")!,
    ).next!;
    const measured = measureScore(silent);
    const line = measurementLine(measured.mix, measured.master);
    expect(line).toContain("target -14.0 not applied · silent");
    expect(line).not.toContain("missed");
  });
});

describe("master: out-of-range values", () => {
  test("name the range instead of the generic usage", () => {
    const score = createScore({ tempoBpm: 120, bars: 1 });
    const reply = (text: string) =>
      applyMasterCommand(score, parseMasterCommand(text)!);
    expect(reply("master target -2")).toMatchObject({
      ok: false,
      message: "master · target must be -40..-3 LUFS",
    });
    expect(reply("master target -80").ok).toBe(false);
    expect(reply("master eq low 40")).toMatchObject({ ok: false });
    expect(reply("master eq low 40").message).toContain("eq low must be");
    expect(reply("master glue ratio 40").message).toBe(
      "master · glue ratio must be between 1 and 10",
    );
  });
});
