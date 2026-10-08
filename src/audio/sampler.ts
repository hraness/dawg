/**
 * Sample playback for sampler tracks, with Strudel's semantics:
 *
 * - `begin`/`end` pick a 0..1 window of the file.
 * - `speed` scales the playback rate (and so the pitch); negative reverses.
 * - `loop` repeats the window (with a short crossfade) for the note's length.
 * - `gain` scales the voice; velocity and track volume apply as for synths.
 * - `choke` is Strudel's `cut`: a new hit in the same group stops the sounding
 *   voice with a short fade.
 * - `loopBegin`/`loopEnd` loop a part of the window; `clip` (`legato`) cuts
 *   the voice at the note's length times the factor; `unit` "c"/"s" and
 *   `fit` turn `speed` into a duration (cycles = bars, seconds, the note);
 *   `accelerate` ramps the rate; `squiz` raises pitch per zero-crossing
 *   cycle (described in Tidal/SuperDirt docs; implemented here from that
 *   description).
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
import { loopSecondsOf, performedNotes } from "../../core/tempo.ts";
import { sampleWarpFor, warpedSpan, type SampleWarp } from "./warp.ts";

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
  /** The song's tempo map in samples; absent keeps constant tempo. */
  warp?: SampleWarp;
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
  /** Loop part as travel offsets from the playback start (begin, or end reversed). */
  readonly loopStart: number;
  readonly loopSpan: number;
  /** Rate ramp per output frame (`accelerate` / reference length); 0 is off. */
  readonly ramp: number;
  /** `squiz` ratio; 1 is off. */
  readonly squiz: number;
};

/**
 * Source frames travelled after `elapsed` output frames: `step·(e + k·e²/2)`
 * with the rate held at zero once a negative ramp reaches it.
 */
function travelAt(elapsed: number, step: number, ramp: number): number {
  if (ramp === 0) return elapsed * step;
  const e = ramp < 0 ? Math.min(elapsed, -1 / ramp) : elapsed;
  return step * (e + (ramp * e * e) / 2);
}

/** Output frames until `distance` source frames are travelled (Infinity if never). */
function framesToTravel(distance: number, step: number, ramp: number): number {
  if (ramp === 0) return distance / step;
  const d = distance / step;
  const disc = 1 + 2 * ramp * d;
  if (disc < 0) return Infinity;
  return (Math.sqrt(disc) - 1) / ramp;
}

function noteStartFrame(note: Note, timing: SamplerTiming): number {
  const { score, sampleRate, warp } = timing;
  if (warp) return warpedSpan(warp, note.startTick, note.durationTicks).start;
  return Math.max(
    0,
    Math.floor(
      (((note.startTick / score.ticksPerBeat) * 60) / score.tempoBpm) *
        sampleRate,
    ),
  );
}

function noteLengthFrames(note: Note, timing: SamplerTiming): number {
  const { score, sampleRate, warp } = timing;
  if (warp) return warpedSpan(warp, note.startTick, note.durationTicks).length;
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
    const regionStart = (ref.begin ?? 0) * sample.frames;
    const regionEnd = (ref.end ?? 1) * sample.frames;
    const held = noteLengthFrames(note, timing);
    // `fit`, `unit: "c"` and `unit: "s"` give the window a duration; the
    // keyed ratio still repitches on top.
    const unit = ref.unit ?? "r";
    const seconds = ref.fit
      ? held / sampleRate
      : unit === "c"
        ? (timing.score.beatsPerBar * 60) /
          (timing.warp?.bpm(note.startTick) ?? timing.score.tempoBpm) /
          Math.abs(speed)
        : unit === "s"
          ? Math.abs(speed)
          : undefined;
    const step =
      seconds === undefined
        ? ((Math.abs(speed) * sample.sampleRate) / sampleRate) * target.ratio
        : ((regionEnd - regionStart) / (seconds * sampleRate)) * target.ratio;
    const natural = Math.max(1, Math.floor((regionEnd - regionStart) / step));
    const release = Math.max(1, Math.round(RELEASE_SECONDS * sampleRate));
    const loop = ref.loop === true;
    const clipped =
      ref.clip === undefined ? held : Math.max(1, Math.floor(held * ref.clip));
    let length: number;
    let fade: number;
    if (loop) {
      length = clipped + release;
      fade = release;
    } else if (
      (sampler.mode === "keyed" || ref.clip !== undefined) &&
      clipped + release < natural
    ) {
      length = clipped + release;
      fade = release;
    } else {
      length = natural;
      fade = Math.max(1, Math.round(END_FADE_SECONDS * sampleRate));
    }
    // accelerate: the rate ramps by `accelerate`× over the planned length;
    // a non-looping voice ends where the ramped read runs out (or stops).
    const accelerate = ref.accelerate ?? 0;
    const ramp = accelerate === 0 ? 0 : accelerate / length;
    if (ramp !== 0 && !loop) {
      const reach = Math.min(
        framesToTravel(regionEnd - regionStart, step, ramp),
        ramp < 0 ? -1 / ramp : Infinity,
      );
      const until = Math.max(1, Math.floor(reach));
      if (until < length) {
        length = until;
        fade = Math.max(1, Math.round(END_FADE_SECONDS * sampleRate));
      }
    }
    const loopFrom =
      ref.loopBegin === undefined ? regionStart : ref.loopBegin * sample.frames;
    const loopTo =
      ref.loopEnd === undefined ? regionEnd : ref.loopEnd * sample.frames;
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
      loopStart: speed < 0 ? regionEnd - loopTo : loopFrom - regionStart,
      loopSpan: loopTo - loopFrom,
      ramp,
      squiz: ref.squiz ?? 1,
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
  const { sampleRate, score, warp } = timing;
  const samplesPerTick =
    (sampleRate * 60) / (score.tempoBpm * score.ticksPerBeat);
  const attack = Math.max(1, ATTACK_SECONDS * sampleRate);
  for (const voice of voices) {
    const { sample, step, regionStart, regionEnd, reverse, loop } = voice;
    const { loopStart, loopSpan, ramp } = voice;
    const mono = sample.mono;
    const span = regionEnd - regionStart;
    const crossfade = loop
      ? Math.min(LOOP_CROSSFADE_SECONDS * sample.sampleRate, loopSpan / 4)
      : 0;
    const period = loopSpan - crossfade;
    const end = Math.min(target.length, voice.end);
    const fadeFrom = voice.end - voice.fade;
    const level = SAMPLE_LEVEL * voice.gain;
    const at = (offset: number) =>
      readAt(mono, reverse ? regionEnd - 1 - offset : regionStart + offset);
    // The raw read at an elapsed frame, or undefined past a one-shot's end.
    const read = (elapsed: number): number | undefined => {
      const travelled =
        ramp === 0 ? elapsed * step : travelAt(elapsed, step, ramp);
      if (!loop) return travelled >= span ? undefined : at(travelled);
      if (travelled < loopStart) return at(travelled);
      const into = travelled - loopStart;
      const phase =
        into < crossfade || period <= 0
          ? into % Math.max(loopSpan, 1e-9)
          : crossfade + ((into - crossfade) % period);
      let value = at(loopStart + phase);
      if (crossfade > 0 && phase >= period) {
        const mix = (phase - period) / crossfade;
        value = value * (1 - mix) + at(loopStart + phase - period) * mix;
      }
      return value;
    };
    const squizzed =
      voice.squiz > 1
        ? squizBuffer(read, end - voice.start, voice.squiz)
        : undefined;
    for (let index = voice.start; index < end; index += 1) {
      const elapsed = index - voice.start;
      const value = squizzed ? squizzed[elapsed]! : read(elapsed);
      if (value === undefined) break;
      let envelope = Math.min(1, elapsed / attack);
      if (index >= fadeFrom) envelope *= (voice.end - index) / voice.fade;
      target[index]! +=
        value *
        envelope *
        level *
        gainAt(
          warp ? warp.tick(index) : voice.startTick + elapsed / samplesPerTick,
        );
    }
  }
}

/** Longest zero-crossing cycle `squiz` treats as one (longer runs split). */
const SQUIZ_MAX_CYCLE = 4096;

/**
 * Squiz (Tidal/SuperDirt's description: a simplistic pitch raiser): cut the
 * voice at its upward zero crossings and play each cycle `ratio`× faster,
 * repeating it to fill the cycle's original length. Length is kept, the
 * pitch rises, and the timbre turns buzzy, as documented.
 */
export function squizBuffer(
  read: (elapsed: number) => number | undefined,
  length: number,
  ratio: number,
): Float64Array {
  const raw = new Float64Array(Math.max(0, length));
  let filled = raw.length;
  for (let i = 0; i < raw.length; i += 1) {
    const value = read(i);
    if (value === undefined) {
      filled = i;
      break;
    }
    raw[i] = value;
  }
  const out = new Float64Array(raw.length);
  let start = 0;
  while (start < filled) {
    let stop = start + 1;
    while (
      stop < filled &&
      stop - start < SQUIZ_MAX_CYCLE &&
      !(raw[stop - 1]! < 0 && raw[stop]! >= 0)
    )
      stop += 1;
    const size = stop - start;
    for (let i = 0; i < size; i += 1) {
      const position = (i * ratio) % size;
      const base = Math.floor(position);
      const next = base + 1 < size ? base + 1 : 0;
      const frac = position - base;
      out[start + i] =
        raw[start + base]! + (raw[start + next]! - raw[start + base]!) * frac;
    }
    start = stop;
  }
  return out;
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
  const loopEnd = score.time
    ? loopSecondsOf(score) * sampleRate
    : ((score.bars * score.beatsPerBar * 60) / score.tempoBpm) * sampleRate;
  const warp = sampleWarpFor(score, sampleRate);
  const timing = { score, sampleRate, ...(warp ? { warp } : {}) };
  let latest = 0;
  for (const track of score.tracks) {
    if (!track.sampler) continue;
    const notes = performedNotes(score).filter(
      (note) => note.trackId === track.id,
    );
    for (const voice of planSamplerVoices(track, notes, bank, timing))
      latest = Math.max(latest, voice.end - loopEnd);
  }
  return latest / sampleRate;
}
