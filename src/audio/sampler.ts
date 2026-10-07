/**
 * Sample playback for sampler tracks, with Strudel's semantics:
 *
 * - `begin`/`end` pick a 0..1 window of the file.
 * - `speed` scales the playback rate (and so the pitch); negative reverses.
 * - `loop` repeats the window (with a short crossfade) for the note's length.
 * - `gain` scales the voice; velocity and track volume apply as for synths.
 * - `choke` is Strudel's `cut`: a new hit in the same group stops the sounding
 *   voice with a short fade.
 * - keyed mode repitches from `root` (rate × 2^((pitch − root)/12)) and holds
 *   for the note's length; oneshot mode maps voices to pitch slots from 36 in
 *   voice-name order and plays the whole window unless `loop` is set.
 *
 * Voices are mixed in mono into the track's dry buffer, so the track's
 * filter, pan, delay, reverb and automation apply exactly as for synth tracks.
 * Everything is plain arithmetic over decoded samples: identical files give
 * identical output.
 */
import {
  SCORE_LIMITS,
  samplerVoiceSlots,
  type Note,
  type SampleRef,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";

/** Output level of a full-scale sample at velocity 1 and gain 1. */
export const SAMPLE_LEVEL = 0.7;
/** Anti-click fade-in on every voice start. */
const ATTACK_SECONDS = 0.001;
/** Fade at a natural end, a held release, a choke and a voice steal. */
const END_FADE_SECONDS = 0.003;
const RELEASE_SECONDS = 0.01;
const CHOKE_SECONDS = 0.005;
/** Loop seam crossfade (source time). */
const LOOP_CROSSFADE_SECONDS = 0.005;

export type SamplerTiming = Readonly<{
  score: TrackScore;
  sampleRate: number;
}>;

/** One planned voice: when it sounds and how it reads its sample. */
export type SamplerVoice = {
  readonly voice: string;
  readonly sample: DecodedSample;
  readonly startTick: number;
  readonly start: number;
  /** Output frame the voice is silent from (exclusive). */
  end: number;
  /** Frames of linear fade ending at `end`. */
  fade: number;
  /** Source frames advanced per output frame (always positive). */
  readonly step: number;
  readonly reverse: boolean;
  readonly loop: boolean;
  /** Window in source frames. */
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly gain: number;
  readonly choke: string | undefined;
};

function noteStartFrame(note: Note, timing: SamplerTiming): number {
  const { score, sampleRate } = timing;
  return Math.max(
    0,
    Math.floor(
      (((note.startTick / score.ticksPerBeat) * 60) / score.tempoBpm) *
        sampleRate,
    ),
  );
}

function noteLengthFrames(note: Note, timing: SamplerTiming): number {
  const { score, sampleRate } = timing;
  return Math.max(
    1,
    Math.floor(
      (((note.durationTicks / score.ticksPerBeat) * 60) / score.tempoBpm) *
        sampleRate,
    ),
  );
}

/** Which voice a note plays and the pitch ratio it plays at. */
function voiceResolver(
  track: Track,
): (pitch: number) => { voice: string; ratio: number } | undefined {
  const sampler = track.sampler!;
  if (sampler.mode === "oneshot") {
    const byPitch = new Map<number, string>();
    for (const [voice, slot] of samplerVoiceSlots(sampler))
      byPitch.set(slot, voice);
    return (pitch) => {
      const voice = byPitch.get(pitch);
      return voice === undefined ? undefined : { voice, ratio: 1 };
    };
  }
  // Keyed: the voice whose root is the highest at or below the pitch (a
  // multi-sampled instrument), else the lowest root.
  const keyed = Object.entries(sampler.voices)
    .map(([voice, ref]) => ({ voice, root: ref.root ?? 60 }))
    .sort((a, b) => a.root - b.root || (a.voice < b.voice ? -1 : 1));
  return (pitch) => {
    let chosen = keyed[0];
    for (const candidate of keyed)
      if (candidate.root <= pitch) chosen = candidate;
    if (!chosen) return undefined;
    return { voice: chosen.voice, ratio: 2 ** ((pitch - chosen.root) / 12) };
  };
}

/** Plans every voice a sampler track plays, with choke and polyphony applied. */
export function planSamplerVoices(
  track: Track,
  notes: readonly Note[],
  bank: SampleBank,
  timing: SamplerTiming,
): SamplerVoice[] {
  const sampler = track.sampler;
  if (!sampler) return [];
  const resolve = voiceResolver(track);
  const ordered = [...notes].sort(
    (a, b) =>
      a.startTick - b.startTick ||
      a.pitch - b.pitch ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const { sampleRate } = timing;
  const voices: SamplerVoice[] = [];
  const lastInGroup = new Map<string, SamplerVoice>();
  const maxVoices = SCORE_LIMITS.maxSamplerVoices;
  const stop = (voice: SamplerVoice, at: number, seconds: number) => {
    if (voice.end <= at) return;
    const fade = Math.max(1, Math.round(seconds * sampleRate));
    const end = Math.max(voice.start + 1, at + fade);
    if (end >= voice.end) return;
    voice.end = end;
    voice.fade = Math.min(fade, end - voice.start);
  };
  for (const note of ordered) {
    const target = resolve(note.pitch);
    if (!target) continue;
    const ref: SampleRef | undefined = sampler.voices[target.voice];
    const sample = bank.voices.get(sampleKey(track.id, target.voice));
    if (!ref || !sample) continue;
    const speed = ref.speed ?? 1;
    const step =
      ((Math.abs(speed) * sample.sampleRate) / sampleRate) * target.ratio;
    const regionStart = (ref.begin ?? 0) * sample.frames;
    const regionEnd = (ref.end ?? 1) * sample.frames;
    const natural = Math.max(1, Math.floor((regionEnd - regionStart) / step));
    const held = noteLengthFrames(note, timing);
    const release = Math.max(1, Math.round(RELEASE_SECONDS * sampleRate));
    const loop = ref.loop === true;
    let length: number;
    let fade: number;
    if (loop) {
      length = held + release;
      fade = release;
    } else if (sampler.mode === "keyed" && held + release < natural) {
      length = held + release;
      fade = release;
    } else {
      length = natural;
      fade = Math.max(1, Math.round(END_FADE_SECONDS * sampleRate));
    }
    const start = noteStartFrame(note, timing);
    const voice: SamplerVoice = {
      voice: target.voice,
      sample,
      startTick: note.startTick,
      start,
      end: start + length,
      fade: Math.min(fade, length),
      step,
      reverse: speed < 0,
      loop,
      regionStart,
      regionEnd,
      gain: (ref.gain ?? 1) * Math.max(0, Math.min(1, note.velocity)),
      choke: ref.choke,
    };
    if (voice.choke !== undefined) {
      const previous = lastInGroup.get(voice.choke);
      if (previous) stop(previous, start, CHOKE_SECONDS);
      lastInGroup.set(voice.choke, voice);
    }
    // Polyphony: steal the oldest sounding voice beyond the limit.
    const sounding = voices.filter((other) => other.end > start);
    if (sounding.length >= maxVoices)
      for (const other of sounding.slice(0, sounding.length - maxVoices + 1))
        stop(other, start, CHOKE_SECONDS);
    voices.push(voice);
  }
  return voices;
}

/** Linear-interpolated read, clamped to the sample. */
function readAt(mono: Float32Array, position: number): number {
  const last = mono.length - 1;
  if (position <= 0) return mono[0]!;
  if (position >= last) return mono[last]!;
  const base = Math.floor(position);
  const a = mono[base]!;
  return a + (mono[base + 1]! - a) * (position - base);
}

/**
 * Mix planned voices into a mono buffer. `gainAt(tick)` is the track's
 * volume (with automation) at a score tick.
 */
export function renderSamplerVoices(
  target: Float64Array,
  voices: readonly SamplerVoice[],
  timing: SamplerTiming,
  gainAt: (tick: number) => number,
): void {
  const { sampleRate, score } = timing;
  const samplesPerTick =
    (sampleRate * 60) / (score.tempoBpm * score.ticksPerBeat);
  const attack = Math.max(1, ATTACK_SECONDS * sampleRate);
  for (const voice of voices) {
    const { sample, step, regionStart, regionEnd, reverse, loop } = voice;
    const mono = sample.mono;
    const span = regionEnd - regionStart;
    const crossfade = loop
      ? Math.min(LOOP_CROSSFADE_SECONDS * sample.sampleRate, span / 4)
      : 0;
    const period = span - crossfade;
    const end = Math.min(target.length, voice.end);
    const fadeFrom = voice.end - voice.fade;
    const level = SAMPLE_LEVEL * voice.gain;
    for (let index = voice.start; index < end; index += 1) {
      const elapsed = index - voice.start;
      const travelled = elapsed * step;
      let value: number;
      if (!loop) {
        if (travelled >= span) break;
        value = readAt(
          mono,
          reverse ? regionEnd - 1 - travelled : regionStart + travelled,
        );
      } else {
        const phase =
          travelled < crossfade || period <= 0
            ? travelled % Math.max(span, 1e-9)
            : crossfade + ((travelled - crossfade) % period);
        const at = (offset: number) =>
          readAt(mono, reverse ? regionEnd - 1 - offset : regionStart + offset);
        value = at(phase);
        if (crossfade > 0 && phase >= period) {
          const mix = (phase - period) / crossfade;
          value = value * (1 - mix) + at(phase - period) * mix;
        }
      }
      let envelope = Math.min(1, elapsed / attack);
      if (index >= fadeFrom) envelope *= (voice.end - index) / voice.fade;
      target[index]! +=
        value *
        envelope *
        level *
        gainAt(voice.startTick + elapsed / samplesPerTick);
    }
  }
}

/**
 * Seconds a sampler track rings past the loop end (bounded by the caller),
 * so loop renders fold whole samples onto the start.
 */
export function samplerTailSeconds(
  score: TrackScore,
  bank: SampleBank,
  sampleRate: number,
): number {
  if (bank.voices.size === 0) return 0;
  const loopEnd =
    ((score.bars * score.beatsPerBar * 60) / score.tempoBpm) * sampleRate;
  const timing = { score, sampleRate };
  let latest = 0;
  for (const track of score.tracks) {
    if (!track.sampler) continue;
    const notes = score.notes.filter((note) => note.trackId === track.id);
    for (const voice of planSamplerVoices(track, notes, bank, timing))
      latest = Math.max(latest, voice.end - loopEnd);
  }
  return latest / sampleRate;
}
