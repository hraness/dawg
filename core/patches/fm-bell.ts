/**
 * fm-bell: the synth engine's two-operator FM voice (an inharmonic ratio
 * and a fast-decaying index) into a global reverb. Knobs: index, ratio,
 * decay, space.
 */
import type { Patch } from "../patch.ts";

export const FM_BELL: Patch = {
  kind: "patch",
  role: "instrument",
  name: "fm-bell",
  nodes: [
    {
      id: "bell",
      type: "engine.synth",
      params: {
        instrument: "sine",
        attack: 0.001,
        sustain: 0,
        release: 1.5,
        fmdecay: 1.8,
        fmsustain: 0,
      },
    },
    { id: "space", type: "fx.reverb", params: { size: 0.7, fade: 3.5 } },
  ],
  cables: [
    { id: "c-notes", from: "in.notes", to: "bell.notes" },
    { id: "c-l", from: "bell.out", to: "space.left" },
    { id: "c-r", from: "bell.right", to: "space.right" },
    { id: "c-outl", from: "space.left", to: "out.audio" },
    { id: "c-outr", from: "space.right", to: "out.right" },
  ],
  macros: [
    {
      id: "index",
      label: "Index",
      min: 0,
      max: 12,
      default: 4,
      to: [{ port: "bell.fm" }],
    },
    {
      id: "ratio",
      label: "Ratio",
      min: 0.5,
      max: 8,
      default: 3.5,
      to: [{ port: "bell.fmh" }],
    },
    {
      id: "decay",
      label: "Decay",
      min: 0.2,
      max: 6,
      default: 2.5,
      curve: "exp",
      to: [{ port: "bell.decay" }],
    },
    {
      id: "space",
      label: "Space",
      min: 0,
      max: 1,
      default: 0.3,
      to: [{ port: "space.mix" }],
    },
  ],
};
