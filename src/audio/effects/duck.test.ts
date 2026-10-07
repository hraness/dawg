import { describe, expect, test } from "bun:test";
import { createScore, type TrackInput } from "../../../core/score.ts";
import { LoopRenderer } from "../renderer.ts";
import { renderScorePcm } from "../wav.ts";
import { duckEnvelope, duckGains, orbitOf } from "./duck.ts";

const RATE = 8_000;

function score(pad: Partial<TrackInput>, kick: Partial<TrackInput>) {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      { id: "pad", name: "pad", instrument: "sine", ...pad },
      { id: "kick", name: "kick", instrument: "kit", ...kick },
    ],
    notes: [
      {
        id: "p",
        trackId: "pad",
        startTick: 0,
        durationTicks: 1920,
        pitch: 60,
        velocity: 0.8,
      },
      ...[0, 1, 2, 3].map((beat) => ({
        id: `k${beat}`,
        trackId: "kick",
        startTick: beat * 480,
        durationTicks: 120,
        pitch: 36,
        velocity: 0.9,
      })),
    ],
  });
}

/** Left-channel RMS of the pad alone (kick muted out of the measure). */
function windowRms(pcm: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (pcm[i * 2]! / 32767) ** 2;
  return Math.sqrt(sum / (to - from));
}

describe("orbit and duck", () => {
  test("tracks default to orbit 1; fx.orbit moves them", () => {
    const s = score({ fx: { orbit: { orbit: 3 } } }, {});
    expect(orbitOf(s.tracks[0])).toBe(3);
    expect(orbitOf(s.tracks[1])).toBe(1);
  });

  test("the envelope dips at each onset and recovers over attack", () => {
    const env = duckEnvelope(
      {
        trackId: "k",
        target: 1,
        depth: 1,
        attack: 0.1,
        onset: 0.01,
        onsets: [100],
      },
      2_000,
      RATE,
    );
    expect(env[99]).toBe(0);
    expect(env[100 + 79]).toBeCloseTo(1, 6); // 10 ms rise at 8 kHz
    expect(env[180 + 400]!).toBeCloseTo(0.5, 2); // half way back after 50 ms
    expect(env[180 + 800]).toBe(0);
  });

  test("a ducker never ducks itself and only hits its target orbit", () => {
    const gains = duckGains(
      [
        { id: "kick", orbit: 2 },
        { id: "pad", orbit: 2 },
        { id: "lead", orbit: 1 },
      ],
      [
        {
          trackId: "kick",
          target: 2,
          depth: 0.5,
          attack: 0.05,
          onset: 0,
          onsets: [0],
        },
      ],
      450,
      RATE,
    );
    expect([...gains.keys()]).toEqual(["pad"]);
    expect(gains.get("pad")![0]).toBeCloseTo(0.5, 6);
    expect(gains.get("pad")![449]).toBe(1);
  });

  test("a kick on beat dips the pad on orbit 2 and leaves orbit 1 alone", () => {
    const quietKick = { volume: 0 };
    const plain = renderScorePcm(score({}, quietKick), { sampleRate: RATE });
    const ducked = renderScorePcm(
      score(
        { fx: { orbit: { orbit: 2 } } },
        { ...quietKick, fx: { duck: { orbit: 2, depth: 0.9, attack: 0.2 } } },
      ),
      { sampleRate: RATE },
    );
    const otherOrbit = renderScorePcm(
      score({}, { ...quietKick, fx: { duck: { orbit: 2, depth: 0.9 } } }),
      { sampleRate: RATE },
    );
    // Right after a beat (beat 2 at 0.5 s) vs just before the next.
    const after = [4_000 + 40, 4_000 + 400] as const;
    const before = [8_000 - 400, 8_000 - 40] as const;
    const dipAfter = windowRms(ducked.pcm, ...after);
    const plainAfter = windowRms(plain.pcm, ...after);
    expect(dipAfter / plainAfter).toBeLessThan(0.5);
    expect(
      windowRms(ducked.pcm, ...before) / windowRms(plain.pcm, ...before),
    ).toBeGreaterThan(0.95);
    expect(otherOrbit.pcm).toEqual(plain.pcm);
  });

  test("ducked renders are byte-identical across cold, cached and worker paths", async () => {
    const make = (depth: number) =>
      score(
        { fx: { orbit: { orbit: 2 }, chorus: {} } },
        { fx: { duck: { orbit: 2, depth, attack: 0.3 } } },
      );
    const worker = new LoopRenderer({ sampleRate: RATE });
    const inline = new LoopRenderer({ sampleRate: RATE, worker: false });
    try {
      for (const depth of [0.8, 0.5, 0.8]) {
        const cold = renderScorePcm(make(depth), {
          sampleRate: RATE,
          loop: true,
        });
        const [a, b] = await Promise.all([
          worker.render(make(depth)),
          inline.render(make(depth)),
        ]);
        expect(a.pcm).toEqual(cold.pcm);
        expect(b.pcm).toEqual(cold.pcm);
      }
    } finally {
      worker.dispose();
      inline.dispose();
    }
  });
});
