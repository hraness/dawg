/**
 * supersaw-pad: three detuned saws summed per voice, a slow envelope and a
 * soft lowpass, then a global chorus and reverb. Knobs: detune, cutoff,
 * attack, space.
 */
import type { Patch } from "../patch.ts";

export const SUPERSAW_PAD: Patch = {
  kind: "patch",
  role: "instrument",
  name: "supersaw-pad",
  nodes: [
    { id: "saw1", type: "osc", params: { wave: "saw" } },
    { id: "saw2", type: "osc", params: { wave: "saw" } },
    { id: "saw3", type: "osc", params: { wave: "saw" } },
    { id: "sum", type: "mix", params: { la: 0.3, lb: 0.3, lc: 0.3, ld: 0 } },
    {
      id: "env",
      type: "adsr",
      params: { decay: 1, sustain: 0.8, release: 1.2 },
    },
    { id: "vcf", type: "svf", params: { mode: "lp", q: 0.2 } },
    { id: "vca", type: "vca" },
    {
      id: "chorus",
      type: "fx.chorus",
      params: { rate: 0.5, depth: 0.5, mix: 0.5 },
    },
    { id: "space", type: "fx.reverb", params: { size: 0.8, fade: 4 } },
  ],
  cables: [
    { id: "c-p1", from: "voice.pitch", to: "saw1.pitch" },
    { id: "c-p2", from: "voice.pitch", to: "saw2.pitch" },
    { id: "c-p3", from: "voice.pitch", to: "saw3.pitch" },
    { id: "c-gate", from: "voice.gate", to: "env.gate" },
    { id: "c-s1", from: "saw1.out", to: "sum.a" },
    { id: "c-s2", from: "saw2.out", to: "sum.b" },
    { id: "c-s3", from: "saw3.out", to: "sum.c" },
    { id: "c-mix", from: "sum.out", to: "vcf.in" },
    { id: "c-vcf", from: "vcf.out", to: "vca.in" },
    { id: "c-amp", from: "env.out", to: "vca.gain" },
    { id: "c-cl", from: "vca.out", to: "chorus.left" },
    { id: "c-cr", from: "vca.out", to: "chorus.right" },
    { id: "c-rl", from: "chorus.left", to: "space.left" },
    { id: "c-rr", from: "chorus.right", to: "space.right" },
    { id: "c-outl", from: "space.left", to: "out.audio" },
    { id: "c-outr", from: "space.right", to: "out.right" },
  ],
  macros: [
    {
      id: "detune",
      label: "Detune",
      min: 0,
      max: 50,
      default: 14,
      to: [{ port: "saw1.detune" }, { port: "saw3.detune", min: 0, max: -50 }],
    },
    {
      id: "cutoff",
      label: "Cutoff",
      min: 200,
      max: 12000,
      default: 3000,
      curve: "exp",
      to: [{ port: "vcf.cutoff" }],
    },
    {
      id: "attack",
      label: "Attack",
      min: 0.005,
      max: 4,
      default: 0.6,
      curve: "exp",
      to: [{ port: "env.attack" }],
    },
    {
      id: "space",
      label: "Space",
      min: 0,
      max: 1,
      default: 0.35,
      to: [{ port: "space.mix" }],
    },
  ],
  voices: 8,
};
