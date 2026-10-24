/** The hand-written charts every generated chart is measured against. */
import type { Chart } from "../format.ts";
import { PAPER_COMET } from "./paper-comet.ts";
import { SNOW_DAY_STATIC } from "./snow-day-static.ts";
import { TIN_FOIL_HALO } from "./tin-foil-halo.ts";

export const GOLD: readonly Chart[] = [
  PAPER_COMET,
  SNOW_DAY_STATIC,
  TIN_FOIL_HALO,
];
