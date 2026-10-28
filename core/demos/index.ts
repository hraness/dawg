/**
 * Complete, original demonstration songs, one file per song so each can be
 * developed on its own. The shelf is hyperpop only for now: the three songs
 * share the kit in hyperpop.ts, and core/distill/ turns them into the song
 * sheets a small model learns the style from. Groove starters live in styles/.
 */
import { TrackScore } from "../score.ts";
import { bubbleWrap } from "./bubble-wrap.ts";
import { candyFault } from "./candy-fault.ts";
import { redline } from "./redline.ts";
import { glassGarden } from "./glass-garden.ts";
import { kiteSeason } from "./kite-season.ts";
import { nightSwim } from "./night-swim.ts";
import { glowStick } from "./glow-stick.ts";
import { windowSeat } from "./window-seat.ts";
import { lightOne } from "./light-one.ts";
export type { DemoInfo } from "./types.ts";

const definitions = [
  candyFault,
  redline,
  glassGarden,
  nightSwim,
  kiteSeason,
  bubbleWrap,
  glowStick,
  windowSeat,
  lightOne,
] as const;
export const DEMOS = Object.freeze(definitions.map(({ info }) => info));
const templates = new Map<string, TrackScore>();

/** Unknown ids fail without constructing anything. Each load gets an isolated score. */
export function createDemo(id: string): TrackScore {
  const definition = definitions.find(({ info }) => info.id === id);
  if (!definition) throw new Error(`Unknown demo: ${id.slice(0, 80)}`);
  let template = templates.get(id);
  if (!template) {
    template = definition.build();
    templates.set(id, template);
  }
  return new TrackScore(template.toJSON());
}
