import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createScore } from "../../../core/score.ts";
import { resolveString } from "../../../core/strings.ts";
import { renderScoreWav } from "../wav.ts";
import { BowedString, type BowSpec } from "./bow.ts";
import { liveStringTrack, SECTION_SPREAD, sectionPlayer } from "./engine.ts";
import { LiveSynth } from "../live.ts";
import {
  centroid,
  partialT60,
  render,
  SR,
  tetHz,
} from "./measure.test-helpers.ts";
import { budget } from "../../../test/perf.ts";

// One string, no sympathetic bank, body or vibrato: the loop itself.
const ISO = { unison: 1, sym: 0, body: "none", oct: 0, vib: 0 } as const;

const SPEC: BowSpec = {
  decay: 0.6,
  track: 0.5,
  damp: 0.5,
  pos: 0.12,
  pressure: 0.5,
  speed: 0.6,
  attack: 0.08,
  release: 0.15,
  tremhz: 0,
  sord: 0,
};

/** One bowed string straight from the voice, `seconds` long. */
function bow(
  sr: number,
  hz: number,
  seconds: number,
  spec: Partial<BowSpec> = {},
  velocity = 0.8,
  hold = seconds,
): Float64Array {
  const s = new BowedString(
    { ...SPEC, ...spec },
    { hz, velocity, hold, seed: 1 },
    sr,
  );
  const x = new Float64Array(Math.round(seconds * sr));
  for (let at = 0; at < x.length; at += 128)
    s.process(x, at, Math.min(128, x.length - at));
  return x;
}

/** Runs a voice for `seconds` at `sr`. */
function play(s: BowedString, sr: number, seconds: number): Float64Array {
  const x = new Float64Array(Math.round(seconds * sr));
  for (let at = 0; at < x.length; at += 128)
    s.process(x, at, Math.min(128, x.length - at));
  return x;
}

/** RMS of x between t0 and t1 seconds. */
function rmsOf(x: Float64Array, sr: number, t0: number, t1: number): number {
  const s = Math.round(t0 * sr);
  const e = Math.round(t1 * sr);
  let r = 0;
  for (let i = s; i < e; i += 1) r += x[i]! ** 2;
  return Math.sqrt(r / (e - s));
}

/** A bowed preset's voice spec, as the engine resolves it. */
function specOf(preset: string): BowSpec {
  const v = resolveString({ preset }) as Record<string, number>;
  return {
    decay: v.ring!,
    track: v.track!,
    damp: v.damp!,
    pos: v.pos!,
    pressure: v.pressure!,
    speed: v.speed!,
    attack: v.attack!,
    release: v.release!,
    tremhz: 0,
    sord: v.sord!,
  };
}

/** Hann-windowed magnitude of x at hz over [s, s + n). */
function magAt(x: Float64Array, sr: number, hz: number, s: number, n: number) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const a = (2 * Math.PI * hz * i) / sr;
    re += x[s + i]! * w * Math.cos(a);
    im += x[s + i]! * w * Math.sin(a);
  }
  return Math.hypot(re, im) / n;
}

/** Sounding pitch error in cents: golden-section peak search near hz. */
function centsOff(x: Float64Array, sr: number, hz: number, t0: number) {
  const s = Math.round(t0 * sr);
  const n = Math.min(x.length - s, Math.round(0.6 * sr));
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 40; i += 1) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (
      magAt(x, sr, hz * 2 ** (a / 1200), s, n) <
      magAt(x, sr, hz * 2 ** (b / 1200), s, n)
    )
      lo = a;
    else hi = b;
  }
  return (lo + hi) / 2;
}

/** Helmholtz motion: sounding, the fundamental dominates, no subharmonic. */
function playable(x: Float64Array, sr: number, hz: number): boolean {
  const s = Math.round(0.4 * sr);
  const e = Math.round(1.1 * sr);
  let rms = 0;
  for (let i = s; i < e; i += 1) rms += x[i]! ** 2;
  rms = Math.sqrt(rms / (e - s));
  const m = (f: number) => magAt(x, sr, f, s, e - s);
  const m1 = m(hz);
  return (
    Number.isFinite(rms) &&
    rms > 1e-3 &&
    m1 > m(2 * hz) &&
    m1 > 3 * m(hz / 2) &&
    m1 > 3 * m(1.5 * hz)
  );
}

/**
 * Onsets: the first frame, then 10 ms frames whose energy rises 4x over
 * the quietest frame of the 150 ms before that follow the last onset's
 * own 150 ms (its attack and scratch), within
 * 20 dB of the loudest frame (one bow attack, scratch included, is one
 * onset; the free ring-out is none).
 */
function onsets(x: Float64Array): number {
  const w = Math.round(0.01 * SR);
  const e: number[] = [];
  for (let s = 0; s + w <= x.length; s += w) {
    let v = 0;
    for (let i = 0; i < w; i += 1) v += x[s + i]! ** 2;
    e.push(v / w);
  }
  const floor = Math.max(...e) / 100;
  let count = 0;
  let last = -Infinity;
  for (let i = 0; i < e.length; i += 1) {
    // The quietest frame since the last onset (and at most 150 ms back).
    const from = Math.max(0, i - 15, last + 15);
    const back = from >= i ? Infinity : Math.min(...e.slice(from, i));
    if (i === 0 || (e[i]! > floor && e[i]! > 4 * back && i - last >= 15)) {
      count += 1;
      last = i;
    }
  }
  return count;
}

describe("bowed strings (design spec section 9, f061-bowed)", () => {
  test("tuning: violin within 1 cent of 12-TET from G3 to C7 at 22.05 and 48 kHz", () => {
    const v = resolveString({ preset: "violin" });
    const spec = {
      decay: v.ring as number,
      track: v.track as number,
      damp: v.damp as number,
      pos: v.pos as number,
      pressure: v.pressure as number,
      speed: v.speed as number,
      attack: v.attack as number,
    };
    const bad: string[] = [];
    for (const sr of [22_050, 48_000])
      for (let k = 55; k <= 96; k += 3) {
        const c = centsOff(bow(sr, tetHz(k), 1.2, spec), sr, tetHz(k), 0.5);
        if (Math.abs(c) > 1) bad.push(`${sr} ${k} ${c.toFixed(2)}`);
      }
    expect(bad).toEqual([]);
  });

  test("tuning through the engine: every third key from C2 within 1 cent", () => {
    const bad: string[] = [];
    for (let k = 36; k <= 96; k += 3) {
      const x = render(
        { preset: "violin", ...ISO },
        [{ pitch: k, seconds: 1.5 }],
        1.5,
      );
      const c = centsOff(x, SR, tetHz(k), 0.5);
      if (Math.abs(c) > 1) bad.push(`${k} ${c.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });

  test("playability: 0 of 1296 settings leave Helmholtz motion", () => {
    const bad: string[] = [];
    const keys = [28, 43, 55, 69, 84, 96];
    for (const k of keys)
      for (const pos of [0.02, 0.1, 0.18, 0.26, 0.34, 0.5])
        for (const pressure of [0, 0.2, 0.4, 0.6, 0.8, 1])
          for (const velocity of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
            const hz = tetHz(k);
            const x = bow(SR, hz, 1.2, { pos, pressure }, velocity);
            if (!playable(x, SR, hz))
              bad.push(`${k} ${pos} ${pressure} ${velocity}`);
          }
    expect(bad).toEqual([]);
  }, 120_000);

  test("playability: violin, cello and contrabass presets across their ranges at 22.05 and 48 kHz", () => {
    const ranges = { violin: [55, 100], cello: [36, 76], contrabass: [28, 60] };
    const bad: string[] = [];
    for (const [preset, [lo, hi]] of Object.entries(ranges)) {
      const base = specOf(preset);
      for (const sr of [22_050, 48_000])
        for (let k = lo!; k <= hi!; k += 1)
          for (const speed of [0.1, base.speed, 1])
            for (const velocity of [0.2, 1]) {
              const hz = tetHz(k);
              const x = bow(sr, hz, 1.2, { ...base, speed }, velocity);
              if (!playable(x, sr, hz))
                bad.push(`${preset} ${sr} ${k} ${speed} ${velocity}`);
            }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  test("slur: four overlapping single notes are one bow stroke", () => {
    const legato = [60, 62, 64, 65].map((pitch, i) => ({
      pitch,
      start: 0.4 * i,
      seconds: 0.45,
    }));
    const detached = [60, 62, 64, 65].map((pitch, i) => ({
      pitch,
      start: 0.4 * i,
      seconds: 0.25,
    }));
    const string = { preset: "violin", ...ISO };
    expect(onsets(render(string, legato, 2))).toBe(1);
    expect(onsets(render(string, detached, 2))).toBe(4);
  });

  test("slur lands on the new pitch within 1 cent", () => {
    const x = render(
      { preset: "cello", ...ISO },
      [
        { pitch: 48, start: 0, seconds: 0.6 },
        { pitch: 55, start: 0.5, seconds: 1.4 },
      ],
      1.9,
    );
    expect(Math.abs(centsOff(x, SR, tetHz(55), 1))).toBeLessThan(1);
  });

  test("wide slurs (+-12, +-24 semitones) settle within 1 cent, one onset, level of a fresh note", () => {
    const bad: string[] = [];
    for (const sr of [22_050, 48_000])
      for (const [preset, from, to] of [
        ["violin", 67, 79],
        ["violin", 79, 67],
        ["violin", 55, 79],
        ["violin", 79, 55],
        ["cello", 36, 48],
        ["cello", 36, 60],
        ["cello", 60, 36],
      ] as const)
        for (const pos of [0.12, 0.4]) {
          const spec = { ...specOf(preset), pos };
          const slurred = new BowedString(
            spec,
            { hz: tetHz(from), velocity: 0.6, hold: 2.5, seed: 1 },
            sr,
          );
          expect(slurred.canSlurTo(tetHz(to))).toBe(true);
          slurred.slurTo(tetHz(to), Math.round(0.8 * sr), 1.7);
          const x = play(slurred, sr, 2.5);
          const y = play(
            new BowedString(
              spec,
              { hz: tetHz(to), velocity: 0.6, hold: 2.5, seed: 1 },
              sr,
            ),
            sr,
            2.5,
          );
          const c = centsOff(x, sr, tetHz(to), 1.6);
          const db =
            20 * Math.log10(rmsOf(x, sr, 1.6, 2.4) / rmsOf(y, sr, 1.6, 2.4));
          const tail = x.subarray(Math.round(1.2 * sr));
          if (
            Math.abs(c) > 1 ||
            Math.abs(db) > 2 ||
            !playable(tail, sr, tetHz(to))
          )
            bad.push(
              `${sr} ${preset} ${from}->${to} ${pos}: ${c.toFixed(2)} c ${db.toFixed(1)} dB`,
            );
        }
    expect(bad).toEqual([]);
    // Through the engine: an octave and two octaves up are one stroke.
    for (const [a, b] of [
      [55, 67],
      [55, 79],
    ] as const)
      expect(
        onsets(
          render(
            { preset: "violin", ...ISO },
            [
              { pitch: a, start: 0, seconds: 0.85 },
              { pitch: b, start: 0.8, seconds: 1 },
            ],
            2,
          ),
        ),
      ).toBe(1);
  }, 60_000);

  test("a legato scale stays within 2 dB of the same notes detached", () => {
    const keys = [60, 62, 64, 65, 67, 69, 71, 72];
    const legato = keys.map((pitch, i) => ({
      pitch,
      start: 0.4 * i,
      seconds: 0.45,
    }));
    const detached = keys.map((pitch, i) => ({
      pitch,
      start: 0.4 * i,
      seconds: 0.3,
    }));
    const string = { preset: "violin", ...ISO };
    const a = render(string, legato, 3.4);
    const b = render(string, detached, 3.4);
    expect(onsets(a)).toBe(1);
    for (let i = 1; i < keys.length; i += 1) {
      // The middle of each note: past the detached attack, before its release.
      const db =
        20 *
        Math.log10(
          rmsOf(a, SR, 0.4 * i + 0.15, 0.4 * i + 0.28) /
            rmsOf(b, SR, 0.4 * i + 0.15, 0.4 * i + 0.28),
        );
      expect(Math.abs(db)).toBeLessThan(2);
    }
  });

  test("a held note under a moving line keeps sounding (no slur)", () => {
    const x = render(
      { preset: "cello", ...ISO },
      [
        { pitch: 48, start: 0, seconds: 3 },
        { pitch: 55, start: 1, seconds: 0.9 },
        { pitch: 57, start: 2, seconds: 0.9 },
      ],
      3.2,
    );
    const s = Math.round(2.2 * SR);
    const n = Math.round(0.6 * SR);
    // Both the pedal C3 and the moving A3 sound in the last second.
    const pedal = magAt(x, SR, tetHz(48), s, n);
    const line = magAt(x, SR, tetHz(57), s, n);
    expect(pedal).toBeGreaterThan(1e-3);
    expect(line).toBeGreaterThan(1e-3);
    expect(pedal / line).toBeGreaterThan(0.1);
  });

  test("section players: seeded vibrato and onsets differ, renders repeat", () => {
    const players = [0, 1, 2, 3].map((i) => sectionPlayer(42, i, 1));
    expect(players[0]!.onset).toBe(0);
    for (const p of players) {
      expect(p.rate).toBeGreaterThanOrEqual(0.92);
      expect(p.rate).toBeLessThanOrEqual(1.08);
      expect(p.depth).toBeGreaterThanOrEqual(0.8);
      expect(p.depth).toBeLessThanOrEqual(1.2);
      expect(p.onset).toBeLessThanOrEqual(SECTION_SPREAD);
    }
    expect(new Set(players.map((p) => p.phase)).size).toBe(4);
    expect(new Set(players.slice(1).map((p) => p.onset)).size).toBe(3);
    // A short note spreads less.
    expect(sectionPlayer(42, 1, 0.05).onset).toBeLessThan(players[1]!.onset);
    expect(sectionPlayer(42, 1, 1)).toEqual(players[1]!);
    // The section's first samples: player 0 alone (onset 0) sounds first.
    const x = render({ preset: "violins", vib: 0 }, [{ pitch: 67 }], 0.5);
    const y = render({ preset: "violins", vib: 0 }, [{ pitch: 67 }], 0.5);
    expect(Buffer.from(x.buffer).equals(Buffer.from(y.buffer))).toBe(true);
  });

  test("articulations: staccato is a short stroke, accent bites", () => {
    const string = { preset: "violin", ...ISO };
    const at = (articulation?: "staccato" | "accent") =>
      render(
        string,
        [
          {
            pitch: 67,
            seconds: 0.3,
            ...(articulation ? { articulation } : {}),
          },
        ],
        0.6,
      );
    const legato = at();
    const stacc = at("staccato");
    // Detache: release 0.03 s, so 60 ms after note-off it is far quieter.
    const after = (x: Float64Array) => rmsOf(x, SR, 0.36, 0.42);
    expect(after(stacc)).toBeLessThan(0.5 * after(legato));
    // Accent: pressure +0.2 for 80 ms changes the stroke's start (a
    // brighter bite) and the same velocity's level is otherwise unchanged.
    const accent = at("accent");
    let diff = 0;
    for (let k = 0; k < Math.round(0.08 * SR); k += 1)
      diff = Math.max(diff, Math.abs(accent[k]! - legato[k]!));
    expect(diff).toBeGreaterThan(1e-3);
    const body = rmsOf(accent, SR, 0.1, 0.25) / rmsOf(legato, SR, 0.1, 0.25);
    expect(Math.abs(body - 1)).toBeLessThan(0.01);
  });

  test("T60 of the free string after the bow lifts within 10%", () => {
    const bad: string[] = [];
    for (const k of [43, 48, 55, 60, 67, 72, 79, 84])
      for (const damp of [0, 0.5]) {
        const hz = tetHz(k);
        const want = 0.6 * (hz / tetHz(60)) ** -0.5;
        const x = bow(SR, hz, 0.7 + 2 * want, { damp }, 0.8, 0.5);
        const t60 = partialT60(x.subarray(Math.round(0.7 * SR)), hz);
        if (!(Math.abs(t60 / want - 1) < 0.1)) bad.push(`${k} ${damp} ${t60}`);
      }
    expect(bad).toEqual([]);
  });

  test("dynamics: ff is brighter (centroid >= 1.15x) and louder than pp", () => {
    for (const preset of ["violin", "cello"]) {
      const pitch = preset === "cello" ? 48 : 64;
      const pp = render({ preset, ...ISO }, [{ pitch, velocity: 0.2 }], 1.2);
      const ff = render({ preset, ...ISO }, [{ pitch, velocity: 1 }], 1.2);
      const at = Math.round(0.4 * SR);
      const ratio = centroid(ff, at, 8192) / centroid(pp, at, 8192);
      const rms = (x: Float64Array) =>
        Math.sqrt(
          x.subarray(at).reduce((s, v) => s + v * v, 0) / (x.length - at),
        );
      expect({ preset, bright: ratio >= 1.15 }).toEqual({
        preset,
        bright: true,
      });
      expect(20 * Math.log10(rms(ff) / rms(pp))).toBeGreaterThan(12);
    }
  });

  test("deterministic: the same bowed notes render the same samples", () => {
    const notes = [{ pitch: 60 }, { pitch: 67, start: 0.2 }];
    for (const preset of ["violins", "trem", "erhu"]) {
      const a = render({ preset }, notes, 0.8);
      const b = render({ preset }, notes, 0.8);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    }
  });

  test("live: a cold 8 s violins key renders under 40 ms, then the full note", () => {
    const track = liveStringTrack({
      id: "s",
      name: "s",
      instrument: "string",
      string: { preset: "violins" },
    } as never);
    expect(track.string?.unison).toBe(2);
    const score = createScore({
      tempoBpm: 120,
      bars: 4,
      tracks: [
        {
          id: "s",
          name: "s",
          instrument: "string",
          string: { preset: "violins" },
        },
      ],
    } as never);
    const request = {
      score,
      trackId: "s",
      pitch: 67,
      velocity: 0.8,
      seconds: 8,
    };
    // Cold keys: a new synth, no warm-up, the master rate, each pitch a
    // cache miss. The median of five keys, so one load spike on a shared
    // CI runner (a single cold key measured 47 ms there) does not decide it.
    const synth = new LiveSynth(48_000);
    const times: number[] = [];
    let first: ReturnType<LiveSynth["render"]> = undefined;
    for (const pitch of [67, 60, 64, 69, 72]) {
      const t = performance.now();
      const pcm = synth.render({ ...request, pitch })!;
      times.push(performance.now() - t);
      first ??= pcm;
    }
    times.sort((a, b) => a - b);
    expect(times[2]!).toBeLessThan(budget(40));
    first = first!;
    // The key path sounds the first window; the full note (background
    // pass) starts with exactly those samples, so the swap is seamless.
    expect(first.partial).toBe(true);
    const full = synth.render({ ...request, full: true })!;
    expect(full.partial).toBeUndefined();
    expect(full.frames).toBeGreaterThan(8 * 48_000);
    expect(
      Buffer.from(
        full.pcm.buffer,
        full.pcm.byteOffset,
        first.pcm.byteLength,
      ).equals(
        Buffer.from(
          first.pcm.buffer,
          first.pcm.byteOffset,
          first.pcm.byteLength,
        ),
      ),
    ).toBe(true);
  });

  test("legacy cello, contrabass and strings render byte-identically", () => {
    const digests: Record<string, string> = {};
    for (const instrument of ["cello", "contrabass", "strings"]) {
      const score = createScore({
        tempoBpm: 96,
        bars: 1,
        tracks: [{ id: "s", name: "s", instrument }],
        notes: [48, 55, 60, 64].map((pitch, i) => ({
          id: `n${i}`,
          trackId: "s",
          pitch,
          startTick: i * 240,
          durationTicks: 960 - i * 120,
          velocity: 0.5 + 0.1 * i,
        })),
      } as never);
      const b = renderScoreWav(score, { sampleRate: 22_050 });
      digests[instrument] = createHash("sha256")
        .update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
        .digest("hex")
        .slice(0, 16);
    }
    // Recorded on origin/main 1314ab0 (v0.6.0), before the bowed engine.
    expect(digests).toEqual({
      cello: "2c5109472d61b1b1",
      contrabass: "b8e68d0adcb5ae68",
      strings: "2c5109472d61b1b1",
    });
  });
});
