import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { LoopRenderer } from "../renderer.ts";
import { renderScorePcm, StemRenderer } from "../wav.ts";

const SR = 8_000;

function busScore(
  options: Readonly<{
    shared?: boolean;
    second?: boolean;
    reverb?: boolean;
    duck?: boolean;
  }> = {},
): TrackScore {
  const orbit =
    options.shared === undefined
      ? {}
      : { fx: { orbit: { orbit: 2, shared: options.shared } } };
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "a",
        name: "a",
        instrument: "pluck",
        delay: { beats: 0.75, feedback: 0.4, mix: 0.3, pingpong: true },
        ...(options.reverb ? { reverb: { mix: 0.3, size: 0.6 } } : {}),
        ...orbit,
      },
      ...(options.second
        ? [
            {
              id: "b",
              name: "b",
              instrument: "saw",
              delay: { beats: 0.25, feedback: 0.1, mix: 0.5 },
              ...orbit,
            },
          ]
        : []),
      ...(options.duck
        ? [
            {
              id: "k",
              name: "k",
              instrument: "kit",
              fx: { duck: { orbit: 2, depth: 1, attack: 0.3 } },
            },
          ]
        : []),
    ],
    notes: [
      {
        id: "n",
        trackId: "a",
        pitch: 60,
        startTick: 0,
        durationTicks: 240,
        velocity: 0.8,
      },
      ...(options.second
        ? [
            {
              id: "m",
              trackId: "b",
              pitch: 67,
              startTick: 960,
              durationTicks: 240,
              velocity: 0.8,
            },
          ]
        : []),
      ...(options.duck
        ? [
            {
              id: "kk",
              trackId: "k",
              pitch: 36,
              startTick: 1440,
              durationTicks: 120,
              velocity: 1,
            },
          ]
        : []),
    ],
  } as never);
}

const render = (score: TrackScore) =>
  renderScorePcm(score, { sampleRate: SR }).pcm;

/** Sum of squared samples over a window, one channel. */
function energy(pcm: Int16Array, from: number, to: number, channel = 0) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += pcm[i * 2 + channel]! ** 2;
  return sum;
}

describe("shared orbit buses", () => {
  test("a bus with one member sounds exactly like the track's own delay", () => {
    const own = render(busScore());
    expect(render(busScore({ shared: false }))).toEqual(own);
    expect(render(busScore({ shared: true }))).toEqual(own);
  });

  test("members share the first member's delay time", () => {
    // Alone, b echoes every quarter beat; on the bus it uses a's 0.75 beat.
    const own = render(busScore({ shared: false, second: true }));
    const bus = render(busScore({ shared: true, second: true }));
    expect(bus).not.toEqual(own);
    // b plays at beat 2 (1 s); its own 0.25-beat echo lands at 1.125 s.
    // On the bus the first echo is at 1.375 s instead.
    const b = (pcm: Int16Array, at: number) =>
      energy(pcm, Math.round(at * SR), Math.round((at + 0.06) * SR), 1);
    expect(b(bus, 1.15)).toBeLessThan(b(own, 1.15) * 0.5);
  });

  test("delay and reverb run in parallel on the bus", () => {
    const serial = render(busScore({ shared: false, reverb: true }));
    const parallel = render(busScore({ shared: true, reverb: true }));
    expect(parallel).not.toEqual(serial);
    expect(energy(parallel, 0, parallel.length / 2)).toBeGreaterThan(0);
  });

  test("ducking an orbit ducks its bus return", () => {
    const plain = render(busScore({ shared: true }));
    const ducked = render(busScore({ shared: true, duck: true }));
    // Beat 3 (1.5 s): a's echoes only, through the bus, under the kick.
    const from = Math.round(1.52 * SR);
    const to = Math.round(1.7 * SR);
    // Right channel: the ping-pong echo, the kick sits centred, so compare
    // the side signal instead of a channel.
    const side = (pcm: Int16Array) => {
      let sum = 0;
      for (let i = from; i < to; i += 1)
        sum += (pcm[i * 2]! - pcm[i * 2 + 1]!) ** 2;
      return sum;
    };
    expect(side(plain)).toBeGreaterThan(0);
    expect(side(ducked)).toBeLessThan(side(plain) * 0.5);
  });

  test("cached, worker and cold renders are byte-identical", async () => {
    const worker = new LoopRenderer({ sampleRate: SR });
    const inline = new LoopRenderer({ sampleRate: SR, worker: false });
    const stems = new StemRenderer();
    try {
      for (const options of [
        { shared: true, second: true, reverb: true },
        { shared: true, second: true },
        { shared: true, second: true, reverb: true, duck: true },
        { shared: true, second: true, reverb: true },
      ]) {
        const score = busScore(options);
        const cold = renderScorePcm(score, { sampleRate: SR, loop: true });
        const [a, b] = await Promise.all([
          worker.render(score),
          inline.render(score),
        ]);
        expect(a.pcm).toEqual(cold.pcm);
        expect(b.pcm).toEqual(cold.pcm);
        expect(stems.render(score, { sampleRate: SR, loop: true }).pcm).toEqual(
          cold.pcm,
        );
      }
    } finally {
      worker.dispose();
      inline.dispose();
    }
  });
});
