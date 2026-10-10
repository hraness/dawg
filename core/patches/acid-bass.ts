/**
 * acid-bass: a 303-style monosynth line. A saw through a resonant lowpass
 * whose cutoff an envelope opens on each note, then a global drive after
 * the voice sum. Knobs: cutoff, resonance, envelope depth, drive.
 */
import type { Patch } from "../patch.ts";

export const ACID_BASS: Patch = {
  kind: "patch",
  role: "instrument",
  name: "acid-bass",
  nodes: [
    { id: "tone", type: "osc", params: { wave: "saw", level: 0.8 } },
    {
      id: "env",
      type: "adsr",
      params: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.05 },
    },
    { id: "envamt", type: "scale", params: { inmin: 0, inmax: 1, min: 0 } },
    {
      id: "amp",
      type: "adsr",
      params: { attack: 0.001, decay: 0.3, sustain: 0.6, release: 0.08 },
    },
    { id: "vcf", type: "svf", params: { mode: "lp" } },
    { id: "vca", type: "vca" },
    { id: "drive", type: "fx.distort", params: { type: "soft", mix: 1 } },
  ],
  cables: [
    { id: "c-pitch", from: "voice.pitch", to: "tone.pitch" },
    { id: "c-gate", from: "voice.gate", to: "env.gate" },
    { id: "c-again", from: "voice.gate", to: "amp.gate" },
    { id: "c-env", from: "env.out", to: "envamt.in" },
    { id: "c-cut", from: "envamt.out", to: "vcf.cutoff" },
    { id: "c-tone", from: "tone.out", to: "vcf.in" },
    { id: "c-vcf", from: "vcf.out", to: "vca.in" },
    { id: "c-amp", from: "amp.out", to: "vca.gain" },
    { id: "c-sum", from: "vca.out", to: "drive.in" },
    { id: "c-out", from: "drive.out", to: "out.audio" },
  ],
  macros: [
    {
      id: "cutoff",
      label: "Cutoff",
      min: 80,
      max: 4000,
      default: 600,
      curve: "exp",
      to: [{ port: "vcf.cutoff" }],
    },
    {
      id: "reso",
      label: "Reso",
      min: 0,
      max: 1,
      default: 0.7,
      to: [{ port: "vcf.q" }],
    },
    {
      id: "env",
      label: "Env",
      min: 0,
      max: 6000,
      default: 2400,
      to: [{ port: "envamt.max" }],
    },
    {
      id: "drive",
      label: "Drive",
      min: 0,
      max: 10,
      default: 2.5,
      to: [{ port: "drive.drive" }],
    },
  ],
  voices: 1,
};
