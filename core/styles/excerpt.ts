/**
 * A short rendered excerpt of a generated style (quality-08): the first
 * bar at a low sample rate, with notes clipped to the bar and the song
 * master kept. The card test and `/style info --audition` paths use it to
 * check that a style sounds without rendering the whole song.
 */

import { createScore, type TrackScore } from "../score.ts";
import type { GeneratedStyle } from "./generate.ts";

export function excerptScore(generated: GeneratedStyle, bars = 1): TrackScore {
  const { data, plan } = generated;
  const count = Math.max(1, Math.min(plan.bars, Math.trunc(bars)));
  const endTick = plan.barTicks * count;
  return createScore({
    ...data,
    bars: count,
    sections: undefined,
    notes: (data.notes ?? [])
      .filter((note) => (note.startTick ?? 0) < endTick)
      .map((note) => ({
        ...note,
        durationTicks: Math.min(
          note.durationTicks ?? 1,
          endTick - (note.startTick ?? 0),
        ),
      })),
  });
}
