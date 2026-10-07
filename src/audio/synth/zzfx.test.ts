import { describe, expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { normalizeSynth, synthParamName } from "../../../core/synth.ts";
import { renderScorePcm } from "../wav.ts";
import { seededRandom } from "../random.ts";
import { usesSynthVoice } from "./voice.ts";
import { renderZzfx, ZZFX_SOUNDS, type ZzfxParams } from "./zzfx.ts";

const RATE = 22_050;

function params(overrides: Partial<ZzfxParams> = {}): ZzfxParams {
  return {
    sound: "z_sine",
    sampleRate: RATE,
    frequency: 220,
    zrand: 0,
    curve: 1,
    slide: 0,
    deltaSlide: 0,
    pitchJump: 0,
    pitchJumpTime: 0,
    lfo: 0,
    noise: 0,
    zmod: 0,
    zcrush: 0,
    zdelay: 0,
    tremolo: 0,
    random: seededRandom("zzfx-test"),
    ...overrides,
  };
}

function render(overrides: Partial<ZzfxParams> = {}, seconds = 1) {
  const count = Math.round(RATE * seconds);
  const out = new Float64Array(count);
  renderZzfx(out, count, params(overrides));
  return out;
}

function crossings(buffer: Float64Array, from: number, to: number): number {
  let count = 0;
  from = Math.round(from);
  to = Math.round(to);
  for (let i = from + 1; i < to; i += 1)
    if (buffer[i - 1]! < 0 !== buffer[i]! < 0) count += 1;
  return count;
}

function rms(buffer: Float64Array, from: number, to: number): number {
  let sum = 0;
  from = Math.round(from);
  to = Math.round(to);
  for (let i = from; i < to; i += 1) sum += buffer[i]! ** 2;
  return Math.sqrt(sum / (to - from));
}

describe("zzfx voice", () => {
  test("a plain z_sine sits at the note frequency", () => {
    const out = render();
    // 220 Hz → 440 zero crossings per second.
    expect(Math.abs(crossings(out, 0, RATE) - 440)).toBeLessThanOrEqual(2);
  });

  test("slide raises the pitch over time and pitchJump steps it", () => {
    const slid = render({ slide: 1 });
    const early = crossings(slid, 0, RATE / 4);
    const late = crossings(slid, (3 * RATE) / 4, RATE);
    expect(late).toBeGreaterThan(early * 2);

    const jumped = render({ pitchJump: 220, pitchJumpTime: 0.5 });
    const before = crossings(jumped, 0, RATE / 2);
    const after = crossings(jumped, RATE / 2, RATE);
    expect(after / before).toBeCloseTo(2, 1);
  });

  test("lfo restarts the slide each period", () => {
    const out = render({ slide: 2, lfo: 0.5 });
    const first = crossings(out, 0, RATE / 4);
    const second = crossings(out, RATE / 2, (3 * RATE) / 4);
    expect(Math.abs(first - second)).toBeLessThanOrEqual(2);
  });

  test("tremolo modulates level at the lfo period", () => {
    const out = render({ tremolo: 1, lfo: 0.5 });
    // sin(2πt/0.5): peak gain loss at t = 0.125, none at t = 0.375.
    const quiet = rms(out, Math.round(0.1 * RATE), Math.round(0.15 * RATE));
    const loud = rms(out, Math.round(0.35 * RATE), Math.round(0.4 * RATE));
    expect(quiet).toBeLessThan(loud * 0.3);
  });

  test("zcrush holds samples and zdelay adds an echo", () => {
    const crushed = render({ zcrush: 1 }, 0.1);
    expect(crushed[1]).toBe(crushed[0]!);
    expect(crushed[40]).toBe(crushed[0]!);

    const count = RATE;
    const burst = new Float64Array(count);
    renderZzfx(burst, count, params({ zdelay: 0.25 }));
    const dry = render();
    const lag = Math.round(0.25 * RATE);
    expect(burst[lag + 10]).toBeCloseTo(dry[lag + 10]! + 0.5 * dry[10]!, 12);
  });

  test("curve 0 squares the wave off", () => {
    const out = render({ curve: 0 }, 0.1);
    for (const value of out) expect(Math.abs(value)).toBeOneOf([0, 1]);
  });

  test("every z_ sound renders deterministically through the score", () => {
    for (const sound of ZZFX_SOUNDS) {
      const score = createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [
          {
            id: "z",
            name: "z",
            instrument: sound,
            synth: { slide: -1, lfo: 0.25, tremolo: 0.5, zcrush: 0.2 },
          },
        ],
        notes: [0, 1].map((i) => ({
          id: `n${i}`,
          trackId: "z",
          pitch: 57,
          startTick: i * 960,
          durationTicks: 480,
          velocity: 0.9,
        })),
      });
      expect(usesSynthVoice(score.tracks[0])).toBe(true);
      const a = renderScorePcm(score).pcm;
      const b = renderScorePcm(score).pcm;
      expect(a.some((value) => value !== 0)).toBe(true);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    }
  });

  test("Strudel's camelCase names resolve and validate", () => {
    expect(synthParamName("deltaslide")).toBe("deltaSlide");
    expect(synthParamName("pitchJumpTime")).toBe("pitchJumpTime");
    expect(synthParamName("zcrush")).toBe("zcrush");
    expect(normalizeSynth({ pitchJump: 300, curve: 2 })).toEqual({
      curve: 2,
      pitchJump: 300,
    });
    expect(() => normalizeSynth({ curve: 9 })).toThrow();
  });
});

describe("zzfx commands", () => {
  test("synth parses ZzFX names in any case", async () => {
    const { parseSynthCommand } = await import("../../commands/synth.ts");
    expect(
      parseSynthCommand("synth slide -4 pitchjump 300 deltaslide 1 zcrush 0.3"),
    ).toEqual({
      type: "synth-set",
      values: { slide: -4, pitchJump: 300, deltaSlide: 1, zcrush: 0.3 },
    });
  });
});
