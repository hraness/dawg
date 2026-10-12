/** Complete, original demonstration songs. Groove starters live in styles/. */
import { TrackScore } from "../score.ts";
import { coilDriver, nightRelay, signalBloom } from "./electronic.ts";
import { amberRoom, copperWire } from "./organic.ts";
import { glassArc, lowTide, velvetCircuit } from "./vocal.ts";
import { afterHours, candyFault, skylineCurrent } from "./dance.ts";
export type { DemoInfo } from "./types.ts";

const definitions = [
  nightRelay,
  coilDriver,
  velvetCircuit,
  glassArc,
  signalBloom,
  copperWire,
  lowTide,
  amberRoom,
  candyFault,
  afterHours,
  skylineCurrent,
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
