/**
 * The built-in patch library: plain data, each with four named macros (the
 * TUI knob row plays them). Names resolve after project patches and the
 * user library (design §5), so a project can shadow any of them.
 */
import type { Patch } from "../patch.ts";
import { ACID_BASS } from "./acid-bass.ts";
import { FM_BELL } from "./fm-bell.ts";
import { FORMANT_VOX } from "./formant-vox.ts";
import { PLUCK_KS } from "./pluck-ks.ts";
import { SIDECHAIN_PUMP } from "./sidechain-pump.ts";
import { SUPERSAW_PAD } from "./supersaw-pad.ts";
import { WIDE_CRUSH } from "./wide-crush.ts";
import { WOBBLE } from "./wobble.ts";

/** Every built-in patch by name, instruments first, then effects. */
export const BUILTIN_PATCHES: Readonly<Record<string, Patch>> = Object.freeze(
  Object.fromEntries(
    [
      ACID_BASS,
      SUPERSAW_PAD,
      FM_BELL,
      PLUCK_KS,
      WOBBLE,
      SIDECHAIN_PUMP,
      WIDE_CRUSH,
      FORMANT_VOX,
    ].map((patch) => [patch.name, patch]),
  ),
);

/** Built-in patch names in library order. */
export const BUILTIN_PATCH_NAMES: readonly string[] =
  Object.keys(BUILTIN_PATCHES);

/** The built-in named `name`, or undefined. */
export function builtinPatch(name: string): Patch | undefined {
  return Object.hasOwn(BUILTIN_PATCHES, name)
    ? BUILTIN_PATCHES[name]
    : undefined;
}
