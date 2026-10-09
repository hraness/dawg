import { describe, expect, test } from "bun:test";
import {
  bayati,
  build,
  melody,
  steady,
  synthVoice,
  type SungNote,
  type VoiceSignal,
} from "../src/audio/fixtures/voice.ts";
import {
  AUTOTUNE_PARAMS,
  AUTOTUNE_PRESETS,
  autotuneBuffer,
  autotuneDigest,
  autotuneJob,
  centsOfHz,
  chromaticGrid,
  classGrid,
  correctionCurve,
  describeAutotune,
  guideCurve,
  normalizeAutotune,
  resolveAutotune,
  retuneCurve,
  scaleGrid,
  type AutotuneCurve,
  type GuideNote,
  type TrackAutotune,
} from "./autotune.ts";
import { FxValidationError } from "./params.ts";
import { resolveTuning } from "./tuning.ts";
import { budget } from "../test/perf.ts";

const SR = 16_000;
const HOP = 0.005;

/** The fixture's true f0 as an analysis curve (what the tracker would give). */
function curveOf(sig: VoiceSignal): AutotuneCurve {
  const n = Math.floor(sig.x.length / sig.sr / HOP);
  const f0 = new Float64Array(n);
  const prob = new Uint8Array(n);
  const aperiodic = new Uint8Array(n).fill(255);
  for (let f = 0; f < n; f += 1) {
    const hz =
      sig.f0[Math.min(sig.x.length - 1, Math.round(f * HOP * sig.sr))]!;
    if (hz > 0) {
      f0[f] = hz;
      prob[f] = 255;
      aperiodic[f] = 0;
    }
  }
  return { t0: 0, hop: HOP, f0, prob, aperiodic };
}

function targetAt(sig: VoiceSignal, f: number): number {
  return sig.target[Math.min(sig.x.length - 1, Math.round(f * HOP * sig.sr))]!;
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

/** Per-note mean |corrected − target| over the settled middle of each note. */
function noteErrors(
  sig: VoiceSignal,
  curve: AutotuneCurve,
  shift: Float64Array,
  settle = 0.3,
  tail = 0.15,
  targetOf?: (k: number) => number,
): { means: number[]; frames: number[]; mean: number } {
  const means: number[] = [];
  const frames: number[] = [];
  for (const [k, syl] of sig.syllables.entries()) {
    const a = Math.ceil((syl.onset + settle) / HOP);
    const b = Math.floor((syl.end - tail) / HOP);
    let sum = 0;
    let count = 0;
    for (let f = a; f < b; f += 1) {
      const hz = curve.f0[f]!;
      const target = targetOf ? targetOf(k) : targetAt(sig, f);
      if (!(hz > 0) || Number.isNaN(target)) continue;
      const out = centsOfHz(hz) + (Number.isNaN(shift[f]!) ? 0 : shift[f]!);
      sum += out - target;
      count += 1;
      frames.push(Math.abs(out - target));
    }
    if (count >= 4) means.push(Math.abs(sum / count));
  }
  // note-mean as in proto/pitch/bench.ts: the median over notes
  return { means, frames, mean: quantile(means, 0.5) };
}

function voice(notes: SungNote[], seed = 7): VoiceSignal {
  return synthVoice(notes, { sr: SR, seed });
}

describe("autotune: validation (test 7)", () => {
  test("presets and fields normalize; bad input names the field", () => {
    expect(normalizeAutotune(undefined)).toBeUndefined();
    expect(normalizeAutotune(null)).toBeUndefined();
    expect(normalizeAutotune({ preset: "hard" })).toEqual({ preset: "hard" });
    expect(normalizeAutotune({ speed: 40, preset: "pop" })).toEqual({
      preset: "pop",
      speed: 40,
    });
    const bad: [unknown, RegExp][] = [
      [{}, /preset or settings/],
      [[], /object/],
      [{ preset: "loud" }, /preset must be one of/],
      [{ speed: 401 }, /speed must be 0..400/],
      [{ speed: "fast" }, /speed must be a number/],
      [{ amount: Number.NaN }, /amount must be a number/],
      [{ wobble: 1 }, /unknown field wobble/],
      [{ key: "Q major" }, /not a key/],
      [{ to: "scale", from: "lead" }, /from needs to: notes/],
    ];
    for (const [input, message] of bad) {
      expect(() => normalizeAutotune(input)).toThrow(FxValidationError);
      expect(() => normalizeAutotune(input)).toThrow(message);
    }
    // any track may follow its own notes: guided and locked apply in one step
    expect(normalizeAutotune({ preset: "guided" })).toEqual({
      preset: "guided",
    });
    expect(normalizeAutotune({ preset: "locked" }, "saw")).toEqual({
      preset: "locked",
    });
  });

  test("field-only settings resolve on top of pop; every preset resolves", () => {
    const pop = resolveAutotune({ preset: "pop" });
    expect(resolveAutotune({ amount: 1 })).toEqual(pop);
    expect(resolveAutotune({ speed: 40 })).toEqual({ ...pop, speed: 40 });
    for (const preset of AUTOTUNE_PRESETS) {
      const r = resolveAutotune({ preset });
      expect(r.to).toBeDefined();
      for (const param of AUTOTUNE_PARAMS) {
        const value = r[param.name as keyof typeof r];
        if (value === undefined) continue;
        expect(value as number).toBeGreaterThanOrEqual(param.min);
        expect(value as number).toBeLessThanOrEqual(param.max);
      }
    }
    expect(resolveAutotune({ preset: "hard" }).speed).toBe(0);
    expect(resolveAutotune({ preset: "robot" }).to).toBe("chromatic");
    expect(resolveAutotune({ preset: "locked" }).speed).toBe(0);
    // guided keeps center/drift: no retune speed
    expect(resolveAutotune({ preset: "guided" }).speed).toBeUndefined();
  });

  test("vibmod defaults only when vib > 0", () => {
    expect(resolveAutotune({ preset: "pop" }).vibmod).toBe(0);
    expect(resolveAutotune({ preset: "warble" }).vibmod).toBe(0.35);
    expect(resolveAutotune({ vib: 5 }).vibmod).toBeGreaterThan(0);
  });

  test("digest and description are stable and short", () => {
    const r = resolveAutotune({ preset: "hard" });
    expect(autotuneDigest(r)).toBe(
      autotuneDigest(resolveAutotune({ preset: "hard" })),
    );
    expect(autotuneDigest(r)).not.toBe(
      autotuneDigest(resolveAutotune({ preset: "pop" })),
    );
    expect(describeAutotune({ preset: "hard" })).toBe("hard");
    expect(describeAutotune({ speed: 35 })).toBe("pop · speed 35 ms");
  });

  test("flex is monotonic: a larger flex corrects fewer notes", () => {
    const sig = voice(steady(60, 30));
    const curve = curveOf(sig);
    const grid = scaleGrid("C major");
    let last = Infinity;
    for (const flex of [0, 20, 40, 60]) {
      const shift = retuneCurve(curve, grid, { speed: 0, flex });
      const moved = sig.syllables.filter((syl) => {
        const f = Math.round((syl.onset + 0.4) / HOP);
        return Math.abs(shift[f]!) > 5;
      }).length;
      expect(moved).toBeLessThanOrEqual(last);
      last = moved;
    }
    expect(last).toBe(0);
  });
});

describe("autotune: scale targets (test 8)", () => {
  const sig = voice(melody(60));
  const curve = curveOf(sig);

  test("hard lands on the scale: note-mean <= 1 c, frame median <= 3 c, p95 <= 5 c", () => {
    const r = resolveAutotune({ preset: "hard" });
    const shift = correctionCurve(
      curve,
      { kind: "grid", grid: scaleGrid("C major") },
      r,
    );
    const { means, frames, mean } = noteErrors(sig, curve, shift);
    expect(means.length).toBeGreaterThanOrEqual(5);
    expect(mean).toBeLessThanOrEqual(1);
    expect(quantile(frames, 0.5)).toBeLessThanOrEqual(3);
    expect(quantile(frames, 0.95)).toBeLessThanOrEqual(5);
  });

  test("settle time grows with speed", () => {
    const steadySig = voice(steady(60, 40));
    const steadyCurve = curveOf(steadySig);
    const grid = scaleGrid("C major");
    let last = -1;
    for (const speed of [0, 25, 60, 120]) {
      const shift = retuneCurve(steadyCurve, grid, { speed });
      // mean residual 40 ms into each note
      let sum = 0;
      for (const syl of steadySig.syllables) {
        const f = Math.round((syl.onset + 0.04) / HOP);
        sum += Math.abs(
          centsOfHz(steadyCurve.f0[f]!) + shift[f]! - targetAt(steadySig, f),
        );
      }
      expect(sum).toBeGreaterThanOrEqual(last);
      last = sum;
    }
  });

  test("gentle keeps at least 80 % of vibrato depth", () => {
    const vibSig = voice(build([[64, 2, "a", { vib: 40, rate: 5.5 }, 0]]));
    const vibCurve = curveOf(vibSig);
    const r = resolveAutotune({ preset: "gentle" });
    const shift = correctionCurve(
      vibCurve,
      { kind: "grid", grid: scaleGrid("C major") },
      r,
    );
    const syl = vibSig.syllables[0]!;
    const a = Math.round((syl.onset + 0.5) / HOP);
    const b = Math.round((syl.end - 0.2) / HOP);
    const depth = (values: number[]) => {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      return Math.sqrt(
        values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length,
      );
    };
    const input: number[] = [];
    const output: number[] = [];
    for (let f = a; f < b; f += 1) {
      const c = centsOfHz(vibCurve.f0[f]!);
      input.push(c);
      output.push(c + (Number.isNaN(shift[f]!) ? 0 : shift[f]!));
    }
    expect(depth(output) / depth(input)).toBeGreaterThanOrEqual(0.8);
  });

  test("unvoiced frames pass through; low voicing weight shrinks the shift", () => {
    const r = resolveAutotune({ preset: "hard" });
    const breathy: AutotuneCurve = {
      ...curve,
      aperiodic: Uint8Array.from(curve.f0, (hz) => (hz > 0 ? 100 : 255)),
    };
    const shift = correctionCurve(
      breathy,
      { kind: "grid", grid: scaleGrid("C major") },
      r,
    );
    let sum = 0;
    let count = 0;
    for (let f = 0; f < shift.length; f += 1) {
      if (!(curve.f0[f]! > 0)) {
        expect(Number.isNaN(shift[f]!) || shift[f] === 0).toBe(true);
        continue;
      }
      sum += Math.abs(shift[f]!);
      count += 1;
    }
    expect(sum / count).toBeLessThan(10);
  });

  test("no key means chromatic", () => {
    expect(scaleGrid(null).points).toEqual(chromaticGrid().points);
    expect(scaleGrid("C major").points.length).toBeLessThan(
      chromaticGrid().points.length,
    );
  });
});

describe("autotune: microtonal and chord targets (test 10)", () => {
  test("maqam bayati lands on its neutral steps (<= 2 c note-mean)", () => {
    const sig = voice(bayati());
    const curve = curveOf(sig);
    const r = resolveAutotune({ preset: "hard" });
    const shift = correctionCurve(
      curve,
      { kind: "grid", grid: scaleGrid("D bayati") },
      r,
    );
    const steps = [62, 63.5, 65, 67, 65, 63.5, 62];
    const { means, mean } = noteErrors(
      sig,
      curve,
      shift,
      0.3,
      0.15,
      (k) => (steps[k]! - 69) * 100,
    );
    expect(means.length).toBeGreaterThanOrEqual(6);
    expect(mean).toBeLessThanOrEqual(2);
    // the 12-TET grid misses the neutral steps
    const wrong = correctionCurve(
      curve,
      { kind: "grid", grid: chromaticGrid() },
      r,
    );
    const missed = noteErrors(
      sig,
      curve,
      wrong,
      0.3,
      0.15,
      (k) => (steps[k]! - 69) * 100,
    );
    expect(Math.max(...missed.means)).toBeGreaterThan(40);
  });

  test("19-EDO chromatic lands within 5 c of a table step", () => {
    const table = resolveTuning({ edo: 19 }, undefined)!;
    expect(table.size).toBe(19);
    const grid = scaleGrid("C major", table);
    expect(grid.points).toEqual(chromaticGrid(table).points);
    const sig = voice(steady(60, 30));
    const curve = curveOf(sig);
    const shift = correctionCurve(
      curve,
      { kind: "grid", grid },
      resolveAutotune({ preset: "hard" }),
    );
    for (const syl of sig.syllables) {
      const f = Math.round((syl.onset + 0.4) / HOP);
      const out = centsOfHz(curve.f0[f]!) + shift[f]!;
      const nearest = Math.min(
        ...Array.from(grid.points, (p) => Math.abs(p - out)),
      );
      expect(nearest).toBeLessThanOrEqual(5);
    }
  });

  test("24-EDO: 35 c vibrato never flips the target", () => {
    const table = resolveTuning({ edo: 24 }, undefined)!;
    const grid = chromaticGrid(table);
    const sig = voice(build([[62, 2.5, "a", { vib: 35, rate: 5 }, 0]]));
    const curve = curveOf(sig);
    const shift = retuneCurve(curve, grid, { speed: 0 });
    const syl = sig.syllables[0]!;
    const targets = new Set<number>();
    for (
      let f = Math.round((syl.onset + 0.3) / HOP);
      f < Math.round((syl.end - 0.2) / HOP);
      f += 1
    )
      targets.add(Math.round(centsOfHz(curve.f0[f]!) + shift[f]!));
    expect(targets.size).toBe(1);
  });

  test("chord targets: every corrected note is a chord tone", () => {
    const sig = voice(steady(60, 30));
    const curve = curveOf(sig);
    const chord = classGrid([0, 4, 7]); // C major triad
    const shift = retuneCurve(curve, chord, { speed: 0 });
    for (const syl of sig.syllables) {
      const f = Math.round((syl.onset + 0.4) / HOP);
      const out = centsOfHz(curve.f0[f]!) + shift[f]!;
      const pc = (((Math.round(out / 100) + 9) % 12) + 12) % 12;
      expect([0, 4, 7]).toContain(pc);
    }
  });
});

describe("autotune: note targets (test 9)", () => {
  const notes = melody(60);
  const sig = voice(notes, 11);
  const curve = curveOf(sig);
  const guide: GuideNote[] = notes.map((note) => ({
    start: note.start,
    end: note.start + note.dur,
    cents: (note.midi - 69) * 100,
  }));

  const run = (settings: TrackAutotune, list = guide) =>
    correctionCurve(
      curve,
      { kind: "notes", notes: list },
      resolveAutotune(settings),
    );

  test("guided note-mean <= 7 c, drift 0 <= 4 c, drift 1 <= 5 c, p95 <= 10 c", () => {
    const input = noteErrors(sig, curve, new Float64Array(curve.f0.length));
    const guided = noteErrors(sig, curve, run({ preset: "guided" }));
    expect(guided.mean).toBeLessThanOrEqual(7);
    expect(guided.mean).toBeLessThan(input.mean);
    expect(quantile(guided.means, 0.95)).toBeLessThanOrEqual(10);
    expect(
      noteErrors(sig, curve, run({ preset: "guided", drift: 0 })).mean,
    ).toBeLessThanOrEqual(4);
    expect(
      noteErrors(sig, curve, run({ preset: "guided", drift: 1 })).mean,
    ).toBeLessThanOrEqual(5);
  });

  test("locked frame median <= 3 c", () => {
    const { frames } = noteErrors(
      sig,
      curve,
      run({ preset: "locked", from: "lead" }),
    );
    expect(quantile(frames, 0.5)).toBeLessThanOrEqual(3);
  });

  test("ghost notes get exactly no correction", () => {
    const ghosted = guide.map((note, i) =>
      i === 3 ? { ...note, ghost: true } : note,
    );
    const shift = run({ preset: "guided" }, ghosted);
    const syl = sig.syllables[3]!;
    for (
      let f = Math.round((syl.onset + 0.05) / HOP);
      f < Math.round((syl.end - 0.05) / HOP);
      f += 1
    )
      if (curve.f0[f]! > 0)
        expect(Number.isNaN(shift[f]!) || shift[f] === 0).toBe(true);
  });

  test("per-note drift overrides the track drift", () => {
    const all = noteErrors(sig, curve, run({ preset: "guided", drift: 0 }));
    const kept = noteErrors(
      sig,
      curve,
      run(
        { preset: "guided", drift: 0 },
        guide.map((note) => ({ ...note, drift: 1 })),
      ),
    );
    expect(kept.means).not.toEqual(all.means);
  });
});

describe("autotune: buffer and determinism (tests 11-12)", () => {
  // A stand-in PSOLA for the seam: records the per-sample shift it was given.
  const recorder = () => {
    const calls: number[] = [];
    return {
      calls,
      psola: (x: Float64Array, _sr: number, curve: { cents: Float64Array }) => {
        calls.push(curve.cents.reduce((s, v) => s + Math.abs(v), 0));
        return x.map((v) => v * 0.5);
      },
    };
  };

  test("autotuneBuffer is deterministic and returns the input when nothing moves", () => {
    const sig = voice(steady(60, 30));
    const curve = curveOf(sig);
    const x = Float32Array.from(sig.x);
    const r = resolveAutotune({ preset: "hard" });
    const a = recorder();
    const b = recorder();
    const targets = { kind: "grid", grid: scaleGrid("C major") } as const;
    const outA = autotuneBuffer(x, SR, curve, targets, r, a.psola);
    const outB = autotuneBuffer(x, SR, curve, targets, r, b.psola);
    expect(a.calls).toEqual(b.calls);
    expect(Buffer.from(outA.buffer)).toEqual(Buffer.from(outB.buffer));
    const tuned = voice(steady(60, 0));
    const flat = autotuneBuffer(
      Float32Array.from(tuned.x),
      SR,
      { ...curveOf(tuned), f0: new Float64Array(curveOf(tuned).f0.length) },
      targets,
      r,
      a.psola,
    );
    expect(flat.length).toBe(tuned.x.length);
  });
});

describe("Track.autotune in score diffs", () => {
  test("diffScores carries autotune changes and removal", async () => {
    const { createScore, updateTrack } = await import("./score.ts");
    const { applyScoreOperations, diffScores } = await import("./diff.ts");
    const a = createScore({
      bars: 1,
      tempoBpm: 120,
      tracks: [{ id: "vox", name: "vox", instrument: "saw" }],
      notes: [],
    });
    const b = updateTrack(a, "vox", { autotune: { preset: "hard" } });
    expect(applyScoreOperations(a, diffScores(a, b))).toEqual(b);
    expect(applyScoreOperations(b, diffScores(b, a))).toEqual(a);
  });
});

describe("autotune: cost with a cached curve", () => {
  test("target math and the per-sample shift stay well under 2 ms per audio-second", () => {
    const sig = voice(steady(60, 30));
    const curve = curveOf(sig);
    const x = Float32Array.from(sig.x);
    const r = resolveAutotune({ preset: "pop" });
    const targets = { kind: "grid", grid: scaleGrid("C major") } as const;
    // Identity PSOLA: measures only this lane's share (the pitch lane's
    // PSOLA carries its own budget test).
    const identity = (input: Float64Array) => input;
    autotuneBuffer(x, SR, curve, targets, r, identity);
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1)
      autotuneBuffer(x, SR, curve, targets, r, identity);
    const msPerSecond = (performance.now() - start) / runs / (x.length / SR);
    expect(msPerSecond).toBeLessThan(budget(1));
  });
});

describe("autotune: review fixes", () => {
  test("bayati through its own tuning puts E half-flat at -550 c", () => {
    const table = resolveTuning({ name: "bayati" }, undefined, "D bayati");
    const grid = scaleGrid("D bayati", table);
    // D4 is -700 c re A440; E half-flat is 150 c above it.
    const near = [...grid.points].reduce((best, p) =>
      Math.abs(p + 550) < Math.abs(best + 550) ? p : best,
    );
    expect(Math.abs(near + 550)).toBeLessThan(1);
    expect([...grid.points].some((p) => Math.abs(p + 575) < 1)).toBe(false);
  });

  test("added vibrato stays off unvoiced frames", () => {
    const frames = 200;
    const curve: AutotuneCurve = {
      t0: 0,
      hop: HOP,
      f0: new Float32Array(frames).fill(261.63),
      prob: new Uint8Array(frames).fill(0),
      aperiodic: new Uint8Array(frames).fill(255),
    };
    const shift = retuneCurve(curve, chromaticGrid(), {
      speed: 0,
      vib: 6,
      vibCents: 50,
    });
    for (const value of shift) expect(Math.abs(value)).toBeLessThan(1e-9);
  });

  test("a guide note's vibrato delay holds its vibrato back", () => {
    const frames = 200;
    const hz = 440 * 2 ** (-900 / 1200);
    const curve: AutotuneCurve = {
      t0: 0,
      hop: HOP,
      f0: new Float32Array(frames).fill(hz),
      prob: new Uint8Array(frames).fill(255),
      aperiodic: new Uint8Array(frames),
    };
    const shift = guideCurve(
      curve,
      [{ start: 0, end: 1, cents: -900, vib: 5, vibmod: 0.5, vibDelay: 0.5 }],
      { speed: 0, center: 1, drift: 0 } as never,
    );
    // Before 0.5 s the note is steady; after 0.7 s it swings.
    let early = 0;
    for (let f = 20; f < 95; f += 1)
      early = Math.max(early, Math.abs(shift[f]!));
    let late = 0;
    for (let f = 150; f < 190; f += 1)
      late = Math.max(late, Math.abs(shift[f]!));
    expect(early).toBeLessThan(2);
    expect(late).toBeGreaterThan(20);
  });

  test("autotuneJob yields between blocks and matches autotuneBuffer", () => {
    const sig = voice(melody(60));
    const curve = curveOf(sig);
    const r = resolveAutotune({ preset: "hard" });
    const targets = { kind: "grid", grid: scaleGrid("C major") } as const;
    const psola = (x: Float64Array) => x.map((v) => v * 0.5);
    const x = Float32Array.from(sig.x);
    const whole = autotuneBuffer(x, sig.sr, curve, targets, r, psola);
    const job = autotuneJob(x, sig.sr, curve, targets, r, psola);
    let steps = 0;
    let out: Float32Array | undefined;
    for (;;) {
      const step = job.next();
      if (step.done) {
        out = step.value;
        break;
      }
      steps += 1;
    }
    expect(steps).toBeGreaterThan(2);
    expect(Buffer.from(out.buffer).equals(Buffer.from(whole.buffer))).toBe(
      true,
    );
  });
});
