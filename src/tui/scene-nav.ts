import type { Section, TrackScore } from "../../core/score.ts";
import { barAt, loopTickAt } from "../../core/tempo.ts";
import { scoreBeatAt } from "../audio/arrange.ts";

/** The visible score bar, including its fractional progress, on any loop pass. */
export function sceneBarAt(score: TrackScore, sourceBeat: number): number {
  const tick = loopTickAt(score, scoreBeatAt(score, sourceBeat));
  const position = barAt(score, tick);
  return position.bar + position.offset / position.barTicks;
}

/** Previous/next scene in score order, including wraps and gaps before a scene. */
export function nextScene(
  score: TrackScore,
  sourceBeat: number,
  direction: 1 | -1,
): Section | undefined {
  const sections = [...score.sections].sort((a, b) => a.startBar - b.startBar);
  if (!sections.length) return undefined;
  const bar = sceneBarAt(score, sourceBeat);
  let current = -1;
  sections.forEach((section, index) => {
    if (section.startBar <= bar) current = index;
  });
  if (score.loopSection)
    current = sections.findIndex(
      (section) => section.name === score.loopSection,
    );
  const index =
    current < 0
      ? direction === 1
        ? 0
        : sections.length - 1
      : (current + direction + sections.length) % sections.length;
  return sections[index];
}
