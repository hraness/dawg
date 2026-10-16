/**
 * Complete, original demonstration songs, one file per song so each can be
 * developed on its own. Groove starters live in styles/. All three are
 * hyperpop built from the shared kit in hyperpop.ts.
 */
import { TrackScore } from "../score.ts";
import { softReboot } from "./soft-reboot.ts";
import { lowBattery } from "./low-battery.ts";
import { glassGarden } from "./glass-garden.ts";
export type { DemoInfo } from "./types.ts";

const definitions = [softReboot, lowBattery, glassGarden] as const;
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
