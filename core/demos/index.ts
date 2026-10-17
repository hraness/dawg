/**
 * Complete, original demonstration songs, one file per song so each can be
 * developed on its own. Groove starters live in styles/. The three hyperpop
 * songs share the kit in hyperpop.ts.
 */
import { TrackScore } from "../score.ts";
import { coilDriver } from "./coil-driver.ts";
import { velvetCircuit } from "./velvet-circuit.ts";
import { signalBloom } from "./signal-bloom.ts";
import { copperWire } from "./copper-wire.ts";
import { lowTide } from "./low-tide.ts";
import { amberRoom } from "./amber-room.ts";
import { candyFault } from "./candy-fault.ts";
import { softReboot } from "./soft-reboot.ts";
import { lowBattery } from "./low-battery.ts";
import { glassGarden } from "./glass-garden.ts";
export type { DemoInfo } from "./types.ts";

const definitions = [
  coilDriver,
  velvetCircuit,
  signalBloom,
  copperWire,
  lowTide,
  amberRoom,
  candyFault,
  softReboot,
  lowBattery,
  glassGarden,
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
