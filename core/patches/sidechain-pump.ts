/**
 * sidechain-pump: an effect patch that ducks the track under a tempo
 * clock (or, when the track names a `side`, under that track's level).
 * The clock's envelope dips the gain at each beat and releases between.
 * Knobs: depth, release, rate (beats per pump), mix with the dry signal.
 */
import type { Patch } from "../patch.ts";

export const SIDECHAIN_PUMP: Patch = {
  kind: "patch",
  role: "effect",
  name: "sidechain-pump",
  nodes: [
    { id: "clock", type: "clock", params: { beats: 1, width: 0.05 } },
    { id: "env", type: "ar", params: { attack: 0.002 } },
    { id: "side", type: "follow", params: { attack: 0.002, release: 0.12 } },
    { id: "both", type: "max" },
    { id: "duck", type: "scale", params: { inmin: 0, inmax: 1, min: 1 } },
    { id: "floor", type: "clamp", params: { min: 0, max: 1 } },
    { id: "vca", type: "vca" },
    { id: "blend", type: "xfade" },
  ],
  cables: [
    { id: "c-clock", from: "clock.out", to: "env.gate" },
    { id: "c-side", from: "in.side", to: "side.in" },
    { id: "c-a", from: "env.out", to: "both.a" },
    { id: "c-b", from: "side.out", to: "both.b" },
    { id: "c-env", from: "both.out", to: "duck.in" },
    { id: "c-duck", from: "duck.out", to: "floor.in" },
    { id: "c-gain", from: "floor.out", to: "vca.gain" },
    { id: "c-in", from: "in.audio", to: "vca.in" },
    { id: "c-dry", from: "in.audio", to: "blend.a" },
    { id: "c-wet", from: "vca.out", to: "blend.b" },
    { id: "c-out", from: "blend.out", to: "out.audio" },
  ],
  macros: [
    {
      id: "depth",
      label: "Depth",
      min: 0,
      max: 1,
      default: 0.8,
      to: [{ port: "duck.max", min: 1, max: 0 }],
    },
    {
      id: "release",
      label: "Release",
      min: 0.03,
      max: 1,
      default: 0.25,
      curve: "exp",
      to: [{ port: "env.release" }],
    },
    {
      id: "rate",
      label: "Rate",
      min: 0.25,
      max: 4,
      default: 1,
      curve: "exp",
      to: [{ port: "clock.beats" }],
    },
    {
      id: "mix",
      label: "Mix",
      min: 0,
      max: 1,
      default: 1,
      to: [{ port: "blend.x" }],
    },
  ],
};
