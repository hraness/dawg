/**
 * formant-vox: an effect patch that makes the track talk. A vowel filter
 * whose morph a tempo-synced LFO sweeps from "a" to "o", after a formant
 * shift. Knobs: morph depth, rate (LFO beats), shift, mix.
 */
import type { Patch } from "../patch.ts";

export const FORMANT_VOX: Patch = {
  kind: "patch",
  role: "effect",
  name: "formant-vox",
  nodes: [
    { id: "shift", type: "fx.formant" },
    { id: "vowel", type: "fx.vowel", params: { vowel: "a", to: "o" } },
    { id: "lfo", type: "lfo", params: { shape: "tri", sync: 2 } },
    { id: "unipolar", type: "scale", params: { inmin: -1, inmax: 1, min: 0 } },
  ],
  cables: [
    { id: "c-in", from: "in.audio", to: "shift.in" },
    { id: "c-shift", from: "shift.out", to: "vowel.in" },
    { id: "c-lfo", from: "lfo.out", to: "unipolar.in" },
    { id: "c-morph", from: "unipolar.out", to: "vowel.morph" },
    { id: "c-out", from: "vowel.out", to: "out.audio" },
  ],
  macros: [
    {
      id: "morph",
      label: "Morph",
      min: 0,
      max: 1,
      default: 0.8,
      to: [{ port: "unipolar.max" }],
    },
    {
      id: "rate",
      label: "Rate",
      min: 0.25,
      max: 8,
      default: 2,
      curve: "exp",
      to: [{ port: "lfo.sync" }],
    },
    {
      id: "shift",
      label: "Shift",
      min: -12,
      max: 12,
      default: 0,
      to: [{ port: "shift.shift" }],
    },
    {
      id: "mix",
      label: "Mix",
      min: 0,
      max: 1,
      default: 1,
      to: [{ port: "vowel.mix" }],
    },
  ],
};
