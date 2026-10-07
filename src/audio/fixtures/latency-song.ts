/** The 4-track, 2-bar song the audition latency bench nudges. */
import { createScore, type TrackScore } from "../../../core/score.ts";

const BAR = 1_920;

export function song(): TrackScore {
  const notes = [];
  for (let bar = 0; bar < 2; bar += 1) {
    for (const [i, pitch] of [57, 60, 64].entries())
      notes.push({
        id: `p${bar}${i}`,
        trackId: "pad",
        pitch,
        startTick: bar * BAR,
        durationTicks: BAR,
        velocity: 0.7,
      });
    for (let step = 0; step < 8; step += 1)
      notes.push({
        id: `b${bar}${step}`,
        trackId: "bass",
        pitch: step % 2 ? 45 : 33,
        startTick: bar * BAR + step * 240,
        durationTicks: 200,
        velocity: 0.8,
      });
    for (let step = 0; step < 16; step += 1)
      notes.push({
        id: `k${bar}${step}`,
        trackId: "kit",
        pitch: step % 8 === 0 ? 36 : step % 8 === 4 ? 38 : 42,
        startTick: bar * BAR + step * 120,
        durationTicks: 100,
        velocity: 0.9,
      });
    for (let step = 0; step < 4; step += 1)
      notes.push({
        id: `l${bar}${step}`,
        trackId: "lead",
        pitch: 69 + step * 2,
        startTick: bar * BAR + step * 480,
        durationTicks: 360,
        velocity: 0.7,
      });
  }
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      {
        id: "pad",
        name: "pad",
        instrument: "wavetable",
        wavetable: { table: { src: "builtin:pwm" } },
        reverb: { mix: 0.3, size: 0.6 },
      },
      {
        id: "bass",
        name: "bass",
        instrument: "saw",
        filter: { cutoff: 800, resonance: 0.3 },
      },
      { id: "kit", name: "kit", instrument: "kit" },
      {
        id: "lead",
        name: "lead",
        instrument: "square",
        delay: { beats: 0.5, feedback: 0.3, mix: 0.2 },
      },
    ],
    notes,
  } as never);
}
