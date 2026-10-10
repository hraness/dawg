/**
 * The real patch runner (src/audio/patch) on the assessment's voice: two
 * LFOs, saw, PWM pulse, sine sub, noise, mix, two ADSRs, SVF, VCA and pan
 * per voice (12 nodes), 16 voices held for 4 s at 48 kHz. Reports ns per
 * voice-sample, comparable with `patch.interp` from patch-kernel.ts.
 */
import { validatePatch } from "../../core/patch.ts";
import { compilePatch } from "../../src/audio/patch/compile.ts";
import { runPatch, type PatchNote } from "../../src/audio/patch/run.ts";

const SR = 48_000;
const VOICES = 16;
const SECONDS = 4;

export const BENCH_PATCH = validatePatch({
  kind: "patch",
  role: "instrument",
  name: "bench",
  voices: VOICES,
  nodes: [
    { id: "lfo1", type: "lfo", params: { rate: 5 } },
    {
      id: "lfo2",
      type: "lfo",
      params: { shape: "tri", rate: 0.7, depth: 0.4 },
    },
    { id: "saw", type: "osc", params: { wave: "saw", level: 0.5 } },
    {
      id: "pulse",
      type: "osc",
      params: { wave: "pulse", pw: 0.5, level: 0.3 },
    },
    { id: "sub", type: "osc", params: { wave: "sine", level: 0.4 } },
    { id: "hiss", type: "noise", params: { level: 0.05 } },
    { id: "blend", type: "mix" },
    {
      id: "envf",
      type: "adsr",
      params: { attack: 0.05, decay: 0.3, sustain: 0.4 },
    },
    { id: "vcf", type: "svf", params: { cutoff: 900, q: 0.3 } },
    {
      id: "enva",
      type: "adsr",
      params: { attack: 0.01, decay: 0.2, sustain: 0.7 },
    },
    { id: "amp", type: "vca" },
    { id: "spread", type: "pan" },
  ],
  cables: [
    { id: "c01", from: "voice.pitch", to: "saw.pitch" },
    { id: "c02", from: "voice.pitch", to: "pulse.pitch" },
    { id: "c03", from: "voice.pitch", to: "sub.pitch", amount: 0.5 },
    { id: "c04", from: "lfo1.out", to: "saw.detune" },
    { id: "c05", from: "lfo2.out", to: "pulse.pw" },
    { id: "c06", from: "saw.out", to: "blend.a" },
    { id: "c07", from: "pulse.out", to: "blend.b" },
    { id: "c08", from: "sub.out", to: "blend.c" },
    { id: "c09", from: "hiss.out", to: "blend.d" },
    { id: "c10", from: "voice.gate", to: "envf.gate" },
    { id: "c11", from: "envf.out", to: "vcf.q" },
    { id: "c12", from: "blend.out", to: "vcf.in" },
    { id: "c13", from: "voice.gate", to: "enva.gate" },
    { id: "c14", from: "vcf.out", to: "amp.in" },
    { id: "c15", from: "enva.out", to: "amp.gain" },
    { id: "c16", from: "amp.out", to: "spread.in" },
    { id: "c17", from: "lfo2.out", to: "spread.pan" },
    { id: "c18", from: "spread.left", to: "out.audio" },
    { id: "c19", from: "spread.right", to: "out.right" },
  ],
  macros: [],
});

export const BENCH_NOTES: readonly PatchNote[] = Array.from(
  { length: VOICES },
  (_, i) => ({
    seed: `n${i}:0`,
    start: 0,
    end: SECONDS * SR,
    pitch: 110 * Math.pow(2, i / 12),
    note: 45 + i,
    velocity: 0.8,
  }),
);

/**
 * ns per voice-sample of `runs` renders (after one warm-up); `fuse: false`
 * times the reference interpreter instead of the fused voice block.
 */
export function patchRunner(runs = 5, fuse = true): number[] {
  const program = compilePatch(BENCH_PATCH);
  const frames = SECONDS * SR;
  const once = () => {
    const started = performance.now();
    runPatch(program, { frames, sampleRate: SR, notes: BENCH_NOTES, fuse });
    return ((performance.now() - started) * 1e6) / (frames * VOICES);
  };
  once();
  return Array.from({ length: runs }, once);
}

if (import.meta.main) {
  console.log(
    "fused",
    patchRunner().map((x) => x.toFixed(2)),
  );
  console.log(
    "interp",
    patchRunner(5, false).map((x) => x.toFixed(2)),
  );
}
