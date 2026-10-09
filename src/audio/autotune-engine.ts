/**
 * The built-in pitch engine for autotune (0.7): the pitch lane's tracker
 * (src/audio/dsp/pitch.ts) and PSOLA (src/audio/dsp/psola.ts) behind the
 * `PitchEngine` seam of src/audio/autotune.ts. Curves are memoised per
 * audio (`id ?? sha256`, else the buffer itself) and voice range; a file
 * whose curve the analysis cache already holds is not tracked again. With
 * `defer` (live play) a missing curve is tracked in the background and the
 * buffer plays untuned until it is ready. Deterministic: the same audio
 * always gives the same curve and the same tuned bytes.
 */
import { cachedPitchCurve } from "./analysis.ts";
import {
  PITCH_TRACKER_VERSION,
  trackPitch,
  trackPitchAsync,
  type PitchCurve,
} from "./dsp/pitch.ts";
import { psola } from "./dsp/psola.ts";
import type { PitchEngine, TunableBuffer } from "./autotune.ts";

/** Curves kept in memory by key; older ones are tracked again on demand. */
const CURVE_ENTRIES = 64;

const curves = new Map<string, PitchCurve>();
const anonymous = new WeakMap<Float32Array, Map<string, PitchCurve>>();
const pending = new Set<string>();

function keyOf(buffer: TunableBuffer): string | undefined {
  return buffer.id ?? buffer.sha256;
}

function lookup(buffer: TunableBuffer, voice: string): PitchCurve | undefined {
  const key = keyOf(buffer);
  if (key === undefined) return anonymous.get(buffer.mono)?.get(voice);
  const name = `${key}|${voice}`;
  const hit = curves.get(name);
  if (hit) {
    curves.delete(name);
    curves.set(name, hit);
    return hit;
  }
  // The decoded file itself: the pitch lane's analysis cache may know it.
  if (buffer.id === undefined && buffer.sha256 !== undefined) {
    const cached = cachedPitchCurve(
      buffer.sha256,
      voice as Parameters<typeof cachedPitchCurve>[1],
    );
    if (cached) store(buffer, voice, cached);
    return cached;
  }
  return undefined;
}

function store(buffer: TunableBuffer, voice: string, curve: PitchCurve): void {
  const key = keyOf(buffer);
  if (key === undefined) {
    const byVoice = anonymous.get(buffer.mono) ?? new Map<string, PitchCurve>();
    byVoice.set(voice, curve);
    anonymous.set(buffer.mono, byVoice);
    return;
  }
  const name = `${key}|${voice}`;
  curves.delete(name);
  curves.set(name, curve);
  while (curves.size > CURVE_ENTRIES)
    curves.delete(curves.keys().next().value!);
}

/** Drops the memoised curves (tests). */
export function clearEngineCurves(): void {
  curves.clear();
  pending.clear();
}

/** The pitch lane's tracker and PSOLA as an autotune engine. */
export const builtinPitchEngine: PitchEngine = Object.freeze({
  version: `yin${PITCH_TRACKER_VERSION}-psola1`,
  curve(buffer, voice, options) {
    const hit = lookup(buffer, voice);
    if (hit) return hit;
    const x = Float64Array.from(buffer.mono);
    if (!options?.defer) {
      const curve = trackPitch(x, buffer.sampleRate, { voice });
      store(buffer, voice, curve);
      return curve;
    }
    const name = `${keyOf(buffer) ?? "anon"}|${voice}`;
    if (!pending.has(name)) {
      pending.add(name);
      void trackPitchAsync(x, buffer.sampleRate, { voice }).then(
        (curve) => {
          pending.delete(name);
          store(buffer, voice, curve);
        },
        () => pending.delete(name),
      );
    }
    return undefined;
  },
  psola: (x, sampleRate, curve) => psola(x, sampleRate, curve),
});
