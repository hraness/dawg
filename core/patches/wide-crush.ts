/**
 * wide-crush: an effect patch that bit-crushes and downsamples the track,
 * then widens it with a stereo doubler. Knobs: bits, downsample, width,
 * mix with the dry signal.
 */
import type { Patch } from "../patch.ts";

export const WIDE_CRUSH: Patch = {
  kind: "patch",
  role: "effect",
  name: "wide-crush",
  nodes: [
    { id: "crush", type: "fx.crush" },
    { id: "wide", type: "fx.double", params: { time: 18, drift: 4 } },
  ],
  cables: [
    { id: "c-in", from: "in.audio", to: "crush.in" },
    { id: "c-l", from: "crush.out", to: "wide.left" },
    { id: "c-r", from: "crush.out", to: "wide.right" },
    { id: "c-outl", from: "wide.left", to: "out.audio" },
    { id: "c-outr", from: "wide.right", to: "out.right" },
  ],
  macros: [
    {
      id: "bits",
      label: "Bits",
      min: 2,
      max: 16,
      default: 6,
      to: [{ port: "crush.bits" }],
    },
    {
      id: "down",
      label: "Down",
      min: 1,
      max: 32,
      default: 4,
      curve: "exp",
      to: [{ port: "crush.coarse" }],
    },
    {
      id: "width",
      label: "Width",
      min: 0,
      max: 1,
      default: 0.7,
      to: [{ port: "wide.width" }],
    },
    {
      id: "mix",
      label: "Mix",
      min: 0,
      max: 1,
      default: 0.8,
      to: [{ port: "crush.mix" }],
    },
  ],
};
