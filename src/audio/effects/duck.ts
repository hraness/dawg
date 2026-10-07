/**
 * Orbits and ducking, applied where track stems are summed.
 *
 * Every track plays on an orbit (`fx.orbit`, 1 when absent). A track with
 * `fx.duck` dips its target orbit at each of its note onsets: the gain
 * falls to `1 - depth` over `onset` seconds and climbs back over `attack`
 * seconds (a new onset during the recovery dips again from where the gain
 * is). Several duckers on one orbit multiply. A ducker never ducks itself.
 *
 * Ducking is a gain on finished stems, so it never invalidates a ducked
 * track's cached stem and costs nothing when no track ducks. The curve is
 * plain float64 arithmetic over integer sample positions: deterministic on
 * every render path. Clean-room, from Strudel's documented behaviour.
 */
import type { Track } from "../../../core/score.ts";

export type Ducker = Readonly<{
  trackId: string;
  target: number;
  depth: number;
  attack: number;
  onset: number;
  /** Note onsets in samples, any order. */
  onsets: readonly number[];
}>;

/** The orbit a track plays on. */
export function orbitOf(track: Track | undefined): number {
  const orbit = track?.fx?.orbit?.orbit;
  return typeof orbit === "number" ? orbit : 1;
}

/** The track's duck settings without onsets, or undefined when it does not duck. */
export function duckSettings(
  track: Track | undefined,
): Omit<Ducker, "trackId" | "onsets"> | undefined {
  const duck = track?.fx?.duck;
  if (!duck) return undefined;
  const number = (key: string, fallback: number) =>
    typeof duck[key] === "number" ? duck[key] : fallback;
  return {
    target: number("orbit", 1),
    depth: number("depth", 1),
    attack: number("attack", 0.1),
    onset: number("onset", 0.003),
  };
}

/**
 * The duck envelope (0 = no dip, 1 = full dip) of one ducker over
 * `samples` samples. With `loopFrames`, onsets repeat every loop so the
 * folded tail sees the next pass's notes.
 */
export function duckEnvelope(
  ducker: Ducker,
  samples: number,
  sampleRate: number,
  loopFrames?: number,
): Float64Array {
  const marks = new Uint8Array(samples);
  const repeats =
    loopFrames && loopFrames > 0 ? Math.ceil(samples / loopFrames) : 1;
  for (const onset of ducker.onsets)
    for (let pass = 0; pass < repeats; pass += 1) {
      const at = onset + pass * (loopFrames ?? 0);
      if (at >= 0 && at < samples) marks[at] = 1;
    }
  const envelope = new Float64Array(samples);
  const riseSamples = Math.max(1, ducker.onset * sampleRate);
  const fallStep = 1 / Math.max(1, ducker.attack * sampleRate);
  let level = 0;
  let rising = false;
  let riseFrom = 0;
  let riseAt = 0;
  for (let index = 0; index < samples; index += 1) {
    if (marks[index] === 1) {
      rising = true;
      riseFrom = level;
      riseAt = 0;
    }
    if (rising) {
      riseAt += 1;
      const progress = Math.min(1, riseAt / riseSamples);
      level = riseFrom + (1 - riseFrom) * progress;
      if (progress >= 1) rising = false;
    } else if (level > 0) level = Math.max(0, level - fallStep);
    envelope[index] = level;
  }
  return envelope;
}

/**
 * Per-track gain curves: for each track id that some other track ducks,
 * the product of `1 - depth · envelope` over its duckers. Tracks absent
 * from the map play at unity.
 */
export function duckGains(
  tracks: readonly Readonly<{ id: string; orbit: number }>[],
  duckers: readonly Ducker[],
  samples: number,
  sampleRate: number,
  loopFrames?: number,
): Map<string, Float64Array> {
  const gains = new Map<string, Float64Array>();
  if (duckers.length === 0) return gains;
  const envelopes = duckers.map((ducker) =>
    duckEnvelope(ducker, samples, sampleRate, loopFrames),
  );
  for (const track of tracks) {
    let gain: Float64Array | undefined;
    duckers.forEach((ducker, which) => {
      if (ducker.target !== track.orbit || ducker.trackId === track.id) return;
      if (ducker.depth <= 0) return;
      if (!gain) gain = new Float64Array(samples).fill(1);
      const envelope = envelopes[which]!;
      for (let index = 0; index < samples; index += 1)
        gain[index]! *= 1 - ducker.depth * envelope[index]!;
    });
    if (gain) gains.set(track.id, gain);
  }
  return gains;
}
