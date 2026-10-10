/**
 * pluck-ks: a Karplus-Strong plucked string (the string engine's
 * delay-line comb with damped feedback) into a global delay. Knobs: ring,
 * damping, brightness, echo.
 */
import type { Patch } from "../patch.ts";

export const PLUCK_KS: Patch = {
  kind: "patch",
  role: "instrument",
  name: "pluck-ks",
  nodes: [
    {
      id: "string",
      type: "engine.string",
      params: { instrument: "string", pos: 0.12 },
    },
    {
      id: "echo",
      type: "fx.delay",
      params: { beats: 0.75, feedback: 0.3, pingpong: true },
    },
  ],
  cables: [
    { id: "c-notes", from: "in.notes", to: "string.notes" },
    { id: "c-l", from: "string.out", to: "echo.left" },
    { id: "c-r", from: "string.right", to: "echo.right" },
    { id: "c-outl", from: "echo.left", to: "out.audio" },
    { id: "c-outr", from: "echo.right", to: "out.right" },
  ],
  macros: [
    {
      id: "ring",
      label: "Ring",
      min: 0.1,
      max: 12,
      default: 2,
      curve: "exp",
      to: [{ port: "string.ring" }],
    },
    {
      id: "damp",
      label: "Damp",
      min: 0,
      max: 1,
      default: 0.4,
      to: [{ port: "string.damp" }],
    },
    {
      id: "bright",
      label: "Bright",
      min: 0,
      max: 1,
      default: 0.6,
      to: [{ port: "string.bright" }],
    },
    {
      id: "echo",
      label: "Echo",
      min: 0,
      max: 1,
      default: 0.2,
      to: [{ port: "echo.mix" }],
    },
  ],
};
