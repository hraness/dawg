/**
 * Control values for one vocoder render: the resolved settings plus, for
 * each automated parameter, a per-sample curve read once per 32-sample block
 * on the absolute song grid (so a window and the full render agree).
 */
import type { ResolvedVocoder } from "../../../core/vocoder.ts";

export const VOCODER_BLOCK = 32;

export type VocoderCurves = Partial<
  Record<
    | "spread"
    | "width"
    | "release"
    | "formant"
    | "unvoiced"
    | "hiss"
    | "depth"
    | "mix"
    | "gain",
    Float64Array
  >
>;

export type VocoderControl = Readonly<{
  settings: ResolvedVocoder;
  sampleRate: number;
  /** Absolute song sample of index 0. */
  origin: number;
  seed: number;
  /** Gate threshold in dBFS (auto already resolved); -120 is off. */
  gateDb: number;
  curves: VocoderCurves;
  /** Non-zero where the envelopes hold (freeze on, or its lane at 1). */
  hold?: Uint8Array;
}>;

/** A value at sample `i`: its curve when automated, else the static value. */
export function at(
  control: VocoderControl,
  name: keyof VocoderCurves,
  i: number,
): number {
  const curve = control.curves[name];
  return curve ? curve[i]! : (control.settings[name] as number);
}

/**
 * Per-sample curve from `valueAt(index)`, sampled at each block's first
 * song-grid sample (clamped to 0) and held for the block.
 */
export function blockCurve(
  n: number,
  origin: number,
  valueAt: (index: number) => number,
): Float64Array {
  const out = new Float64Array(n);
  const phase = ((origin % VOCODER_BLOCK) + VOCODER_BLOCK) % VOCODER_BLOCK;
  let i = 0;
  let start = -phase;
  while (i < n) {
    const end = Math.min(n, start + VOCODER_BLOCK);
    const value = valueAt(start);
    for (; i < end; i += 1) out[i] = value;
    start += VOCODER_BLOCK;
  }
  return out;
}
