/** Dense deterministic scores shared by arrangement benchmarks and PTYs. */
import { createScore, type NoteInput, type TrackScore } from "../core/score.ts";

export function arrangementFixture(tracks = 32, scenes = 24): TrackScore {
  const bars = scenes * 4;
  const barTicks = 480 * 4;
  const names = [
    "Kick",
    "Snare",
    "Closed hats",
    "Open hats",
    "Sub bass",
    "Electric piano",
    "Warm pad",
    "Percussion",
  ];
  const notes: NoteInput[] = [];
  for (let track = 0; track < tracks; track++) {
    for (let bar = 0; bar < bars; bar++) {
      // Breakdowns thin out; later layers enter after the first section.
      if ((Math.floor(bar / 4) + track) % 5 < 2 || (bar < 4 && track > 5))
        continue;
      const steps = track % 8 === 0 ? 8 : track % 4 === 1 ? 2 : 1;
      for (let step = 0; step < steps; step++) {
        notes.push({
          id: `t${track}-b${bar}-n${step}`,
          trackId: `layer-${track + 1}`,
          startTick: bar * barTicks + step * (barTicks / steps),
          durationTicks: track % 4 === 2 ? 720 : 180,
          pitch: track % 4 === 0 ? 36 : 48 + ((track + step) % 12),
          velocity: step % 2 === 0 ? 0.85 : 0.45,
        });
      }
    }
  }
  return createScore({
    bars,
    tracks: Array.from({ length: tracks }, (_, index) => ({
      id: `layer-${index + 1}`,
      name: `${names[index % names.length]} ${Math.floor(index / names.length) + 1}`,
      instrument: index % 4 === 0 ? "kit" : index % 4 === 1 ? "saw" : "sine",
      volume: 0.5 + (index % 4) * 0.08,
      pan: ((index % 5) - 2) * 0.2,
      filter: { cutoff: 1600 + index * 90, resonance: 0.2 },
      volumeAutomation: [
        { tick: 0, value: 0.45 },
        { tick: 8 * barTicks, value: 0.7 },
        { tick: (bars - 1) * barTicks, value: 0.35 },
      ],
    })),
    notes,
    sections: Array.from({ length: scenes }, (_, index) => ({
      name: `${["Intro", "Verse", "Lift", "Chorus", "Break", "Outro"][index % 6]} ${Math.floor(index / 6) + 1}`,
      startBar: index * 4,
      bars: 4,
    })),
    form: Array.from({ length: scenes }, (_, index) => ({
      section: `${["Intro", "Verse", "Lift", "Chorus", "Break", "Outro"][index % 6]} ${Math.floor(index / 6) + 1}`,
      repeat: index % 4 === 3 ? 2 : 1,
    })),
  });
}
