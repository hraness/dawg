/**
 * A tsc negative fixture for the patch builder (patcher, SDK 1.35.0): the
 * repo typecheck fails if any `@ts-expect-error` line below stops being an
 * error. Nothing imports this file.
 */
import { patch } from "./v1.ts";

export const fixture = patch("types", ({ input, voice, osc, svf, macro }) => {
  const cutoff = macro("cutoff", { min: 80, max: 4000 });
  const filter = svf({ mode: "lp" }).cutoff(cutoff).q(0.5);
  // A notes source is not a control source.
  // @ts-expect-error notes cannot drive cutoff
  filter.cutoff(input.notes);
  // @ts-expect-error osc has no port colour
  osc().colour(1);
  // @ts-expect-error svf has no setting width
  svf({ width: 2 });
  // @ts-expect-error a wave word that osc does not know
  osc({ wave: "organ" });
  return osc().pitch(voice.pitch).to(filter);
});
