/**
 * wobble: a saw and a sub square an octave down through a resonant
 * lowpass that one tempo-synced LFO sweeps for every voice. Knobs:
 * cutoff, depth, rate (LFO length in beats), resonance.
 */
import type { Patch } from "../patch.ts";

export const WOBBLE: Patch = {
  kind: "patch",
  role: "instrument",
  name: "wobble",
  nodes: [
    { id: "saw", type: "osc", params: { wave: "saw", level: 0.3 } },
    {
      id: "sub",
      type: "osc",
      params: { wave: "square", detune: -1200, level: 0.2 },
    },
    { id: "sum", type: "mix" },
    { id: "lfo", type: "lfo", params: { shape: "sine", sync: 0.5 } },
    { id: "depth", type: "mul" },
    { id: "vcf", type: "svf", params: { mode: "lp" } },
    {
      id: "env",
      type: "adsr",
      params: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.08 },
    },
    { id: "vca", type: "vca" },
  ],
  cables: [
    { id: "c-p1", from: "voice.pitch", to: "saw.pitch" },
    { id: "c-p2", from: "voice.pitch", to: "sub.pitch" },
    { id: "c-gate", from: "voice.gate", to: "env.gate" },
    { id: "c-a", from: "saw.out", to: "sum.a" },
    { id: "c-b", from: "sub.out", to: "sum.b" },
    { id: "c-mix", from: "sum.out", to: "vcf.in" },
    { id: "c-lfo", from: "lfo.out", to: "depth.a" },
    { id: "c-wob", from: "depth.out", to: "vcf.cutoff" },
    { id: "c-vcf", from: "vcf.out", to: "vca.in" },
    { id: "c-amp", from: "env.out", to: "vca.gain" },
    { id: "c-out", from: "vca.out", to: "out.audio" },
  ],
  macros: [
    {
      id: "cutoff",
      label: "Cutoff",
      min: 100,
      max: 4000,
      default: 700,
      curve: "exp",
      to: [{ port: "vcf.cutoff" }],
    },
    {
      id: "depth",
      label: "Depth",
      min: 0,
      max: 3000,
      default: 600,
      to: [{ port: "depth.b" }],
    },
    {
      id: "rate",
      label: "Rate",
      min: 0.125,
      max: 4,
      default: 0.5,
      curve: "exp",
      to: [{ port: "lfo.sync" }],
    },
    {
      id: "reso",
      label: "Reso",
      min: 0,
      max: 1,
      default: 0.6,
      to: [{ port: "vcf.q" }],
    },
  ],
  voices: 8,
};
