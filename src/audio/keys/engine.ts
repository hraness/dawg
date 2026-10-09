/**
 * The keys engine (0.6, lane keys-piano): renders a track whose instrument
 * is a piano family (grand upright felt honkytonk prepared) AND that
 * carries `Track.keys`. Notes are performed by `performNotes` first, so the
 * 0.5 sustain pedal (down, half, up), velocity curves, humanize, bends and
 * vibrato all arrive on the notes; this file turns them into voices.
 *
 * - Voices run in 32-sample control blocks (bend, vibrato and the half
 *   pedal are read per block; `keys-<param>` lanes at each onset).
 * - Polyphony: 64 voices per track; beyond that the oldest released voice
 *   is stolen, else the oldest, with a 5 ms fade. Notes whose frequency is
 *   not positive (an unmapped degree of a tuning table) are dropped.
 * - Every voice ends inside the renderer's 8 s tail window with a 250 ms
 *   raised-cosine taper, so a long bass or pedalled note never hard-cuts
 *   at the window or the loop fold.
 * - Post: the family's body EQ per channel (the minimal per-track post
 *   hook), then the track volume, before the existing effects chain.
 */
import { pedalStateAt, type PerformedNote } from "../../../core/expression.ts";
import {
  isElectricFamily,
  isPianoFamily,
  resolvedKeys,
  type ElectricFamily,
} from "../../../core/keys.ts";
import type { Track } from "../../../core/score.ts";
import { noteHz } from "../../../core/tuning.ts";
import type { FxLane } from "../../../core/fx.ts";
import { interpolateAutomation } from "../effects/common.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import { Biquad2, clamp, CONTROL, LN1000 } from "./dsp.ts";
import { ORGAN_ENGINES } from "./organ.ts";
import { keysTrim } from "./calibration.ts";
import {
  damperT60,
  physicalKey,
  pianoF1,
  undamped,
  PianoVoice,
  pianoBody,
  trackSeedOf,
  type PianoParams,
} from "./piano.ts";
import {
  clavReleaseT60,
  electricPost,
  electricVoice,
  tineReleaseT60,
  type ElectricParams,
  type KeysVoice,
} from "./electric.ts";
import { Sympathetic } from "./sympathetic.ts";

export const KEYS_LIMITS = Object.freeze({
  /** Per-track polyphony cap (voice stealing beyond it). */
  voices: 64,
  /** Seconds a voice may ring after its note ends (the wav.ts window). */
  tailSeconds: 8,
  /** Raised-cosine taper ending each voice inside the window. */
  taperSeconds: 0.25,
  /** Fade of a stolen voice. */
  stealSeconds: 0.005,
});

/** Lane parameters read at a note's onset. */
const LANE_PARAMS = Object.freeze([
  "hardness",
  "touch",
  "decay",
  "release",
  "knock",
  "noise",
  "felt",
] as const);

type Values = Readonly<Record<string, number | string>>;

function num(values: Values, key: string): number {
  const value = values[key];
  return typeof value === "number" ? value : 0;
}

/** Voice parameters for a note: the resolved keys plus lanes at `tick`. */
export function pianoParamsAt(
  track: Track,
  values: Values,
  tick: number,
): PianoParams {
  const lane = (name: string) => {
    const points = track.fxAutomation?.[`keys-${name}` as FxLane];
    const base = num(values, name);
    return points && points.length > 0
      ? interpolateAutomation(points, tick, base)
      : base;
  };
  const lanes = Object.fromEntries(
    LANE_PARAMS.map((name) => [name, lane(name)]),
  );
  return {
    hardness: clamp(lanes.hardness!, 0, 1),
    touch: clamp(lanes.touch!, 0, 1),
    inharm: num(values, "inharm"),
    unison: num(values, "unison"),
    decay: clamp(lanes.decay!, 0.1, 4),
    release: clamp(lanes.release!, 0.1, 4),
    strike: num(values, "strike"),
    after: num(values, "after"),
    knock: clamp(lanes.knock!, 0, 1),
    noise: clamp(lanes.noise!, 0, 1),
    felt: clamp(lanes.felt!, 0, 1),
    prep: num(values, "prep"),
    width: num(values, "width"),
    stretch: num(values, "stretch"),
  };
}

/** Electric voice parameters for a note: the resolved keys plus lanes. */
export function electricParamsAt(
  track: Track,
  values: Values,
  tick: number,
  kind: ElectricFamily,
): ElectricParams {
  const lane = (name: string) => {
    const points = track.fxAutomation?.[`keys-${name}` as FxLane];
    const base = num(values, name);
    return points && points.length > 0
      ? interpolateAutomation(points, tick, base)
      : base;
  };
  const pickup = values.pickup;
  return {
    kind,
    hardness: clamp(lane("hardness"), 0, 1),
    touch: clamp(lane("touch"), 0, 1),
    decay: clamp(lane("decay"), 0.1, 4),
    release: clamp(lane("release"), 0.1, 4),
    width: num(values, "width"),
    bark: num(values, "bark"),
    bell: num(values, "bell"),
    tone: clamp(lane("tone"), 0, 12000),
    pickup:
      pickup === "neck" || pickup === "bridge" || pickup === "out"
        ? pickup
        : "both",
    mute: num(values, "mute"),
  };
}

/** Body voicing name for a track (the stored `body`, else the family's). */
export function bodyOf(values: Values): string {
  const body = values.body;
  return typeof body === "string" ? body : "grand";
}

type Live = {
  voice: KeysVoice;
  /** Calibration 1 level trim (1 for legacy songs). */
  trim: number;
  /** Sample index the voice started at. */
  start: number;
  /** Sample index of key-up. */
  off: number;
  /** Sample index the voice must be silent by (taper end). */
  end: number;
  order: number;
  /** Per-block bend and vibrato, cents at seconds from the note start. */
  cents?: (t: number) => number;
  damp?: Readonly<{ from: number; tau: number }>;
  damped: boolean;
  /** Being stolen: fading out over `fadeLength`, then removed. */
  stolen: boolean;
  /** Steal fade samples left. */
  fade: number;
  fadeLength: number;
};

type Onset = Readonly<{
  note: PerformedNote;
  start: number;
  off: number;
  hz: number;
  order: number;
}>;

function spanOf(
  note: PerformedNote,
  context: EngineContext,
): { start: number; off: number } {
  const { warp, samplesPerTick } = context;
  if (warp) {
    const start = Math.max(0, Math.floor(warp.sample(note.startTick)));
    const end = Math.floor(warp.sample(note.startTick + note.durationTicks));
    return { start, off: Math.max(start + 1, end) };
  }
  const start = Math.max(0, Math.floor(note.startTick * samplesPerTick));
  const length = Math.max(1, Math.floor(note.durationTicks * samplesPerTick));
  return { start, off: start + length };
}

/**
 * Renders a keys track's performed notes into `left` and `right` (both
 * already zeroed or holding earlier output; voices add).
 */
export function renderKeysTrack(
  left: Float64Array,
  right: Float64Array,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const sr = context.sampleRate;
  const total = left.length;
  const values = resolvedKeys(track.instrument ?? "grand", track.keys);
  const electric = isElectricFamily(track.instrument)
    ? track.instrument
    : undefined;
  const trackSeed = trackSeedOf(track.id);
  const seedTick = context.seedTick ?? 0;
  const window = Math.round(KEYS_LIMITS.tailSeconds * sr);
  const taper = Math.round(KEYS_LIMITS.taperSeconds * sr);
  const calibrated = (context.score.calibration ?? 0) >= 1;
  const onsets: Onset[] = [];
  notes.forEach((note) => {
    const hz = noteHz(note.pitch, note.cents, context.tuning);
    // An unmapped degree of a tuning table is silent.
    if (!(hz > 0) || !Number.isFinite(hz)) return;
    const { start, off } = spanOf(note, context);
    if (start >= total) return;
    onsets.push({ note, start, off, hz, order: 0 });
  });
  onsets.sort(
    (a, b) =>
      a.start - b.start ||
      a.note.startTick - b.note.startTick ||
      (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
  );
  const live: Live[] = [];
  const block = new Float64Array(CONTROL);
  let next = 0;
  let order = 0;
  for (let i = 0; i < total; i += CONTROL) {
    const count = Math.min(CONTROL, total - i);
    while (next < onsets.length && onsets[next]!.start < i + count) {
      const onset = onsets[next]!;
      next += 1;
      const playing = live.filter((x) => !x.stolen);
      if (playing.length >= KEYS_LIMITS.voices) {
        // Steal the oldest released voice, else the oldest.
        const released = playing.filter((x) => x.voice.released);
        const pool = released.length > 0 ? released : playing;
        let victim = pool[0]!;
        for (const x of pool) if (x.order < victim.order) victim = x;
        victim.fadeLength = Math.max(
          1,
          Math.round(KEYS_LIMITS.stealSeconds * sr),
        );
        victim.fade = victim.fadeLength;
        victim.stolen = true;
      }
      const note = onset.note;
      // Una corda (0.6.1) at the onset: down is the full shift, half half.
      const softState = track.softPedal
        ? pedalStateAt(track.softPedal, note.startTick)
        : "up";
      const soft = softState === "down" ? 1 : softState === "half" ? 0.5 : 0;
      const noteOn = {
        pitch: note.pitch,
        hz: onset.hz,
        velocity: clamp(note.velocity, 0, 1),
        trackSeed,
        noteSeed: `${track.id}:${note.id}:${note.startTick + seedTick}`,
        ...(soft > 0 ? { soft } : {}),
        ...(calibrated ? { calibration: 1 } : {}),
      };
      const trim = calibrated
        ? keysTrim(
            track.keys?.preset ?? track.instrument ?? "grand",
            note.pitch,
          )
        : 1;
      const voice: KeysVoice = electric
        ? electricVoice(
            noteOn,
            electricParamsAt(track, values, note.startTick, electric),
            sr,
          )
        : new PianoVoice(
            noteOn,
            pianoParamsAt(track, values, note.startTick),
            sr,
          );
      const performance = note.performance;
      // The `vib`/`vibmod` wow (lofi) unless the note brings its own vibrato.
      const vib = num(values, "vib");
      const depth = num(values, "vibmod") * 100;
      const wow =
        vib > 0 && depth > 0 && !performance?.replaceVibrato
          ? (t: number) => depth * Math.sin(2 * Math.PI * vib * t)
          : undefined;
      const bend = performance?.cents;
      const cents =
        bend && wow ? (t: number) => bend(t) + wow(t) : (bend ?? wow);
      live.push({
        voice,
        trim,
        start: onset.start,
        off: onset.off,
        end: onset.off + window,
        order: order++,
        ...(cents ? { cents } : {}),
        ...(performance?.damp ? { damp: performance.damp } : {}),
        damped: false,
        stolen: false,
        fade: 0,
        fadeLength: 0,
      });
    }
    for (let k = live.length - 1; k >= 0; k -= 1) {
      const x = live[k]!;
      // Voices that start inside this block begin at their own sample.
      const from = Math.max(i, x.start);
      const n = i + count - from;
      if (n <= 0) continue;
      const t = (from - x.start) / sr;
      if (x.cents) x.voice.setCents(x.cents(t));
      if (x.damp && !x.damped && t >= x.damp.from) {
        x.voice.damp(x.damp.tau);
        x.damped = true;
      }
      if (!x.voice.released && x.off < from + n) x.voice.noteOff();
      block.fill(0, 0, n);
      let alive = x.voice.process(block, 0, n);
      const { gl, gr } = x.voice;
      for (let s = 0; s < n; s += 1) {
        const index = from + s;
        let gain = 1;
        const left0 = x.end - index;
        if (left0 <= 0) gain = 0;
        else if (left0 < taper)
          gain = 0.5 - 0.5 * Math.cos((Math.PI * left0) / taper);
        if (x.stolen) {
          gain *= Math.max(0, x.fade) / x.fadeLength;
          x.fade -= 1;
        }
        const y = block[s]! * gain * x.trim;
        left[index]! += y * gl;
        right[index]! += y * gr;
      }
      if (x.stolen && x.fade <= 0) alive = false;
      if (from + n >= x.end) alive = false;
      if (!alive) live.splice(k, 1);
    }
  }
  if (electric) {
    // The electric post: suitcase vibrato or reed tremolo, then volume.
    const param = electric === "wurli" ? "trem" : "vibe";
    const points = track.fxAutomation?.[`keys-${param}` as FxLane];
    const base = num(values, param);
    const tickOf = (sample: number) =>
      context.warp
        ? context.warp.tick(sample)
        : sample / context.samplesPerTick;
    const depthAt =
      points && points.length > 0
        ? (sample: number) =>
            interpolateAutomation(points, tickOf(sample), base)
        : () => base;
    const rate = electric === "wurli" ? 5.6 : num(values, "vibehz") || 4;
    const startSample = Math.round(seedTick * context.samplesPerTick);
    electricPost(left, right, electric, rate, depthAt, sr, startSample);
    applyVolume(left, right, track, context);
    return;
  }
  // Sympathetic resonance (0.6.1): only with `sym` and sustain pedal events.
  const sym = num(values, "sym");
  const pedal = track.pedal;
  if (sym > 0 && pedal?.some((event) => event.state !== "up")) {
    const bank = new Sympathetic(
      (pitch) => noteHz(pitch, undefined, context.tuning),
      sym,
      sr,
    );
    // Pedal changes as samples; the bank reads them in order.
    const changes = pedal.map((event) => ({
      at: context.warp
        ? context.warp.sample(event.tick)
        : event.tick * context.samplesPerTick,
      down: event.state !== "up",
    }));
    let cursor = 0;
    let down = false;
    bank.process(left, right, (sample) => {
      while (cursor < changes.length && changes[cursor]!.at <= sample)
        down = changes[cursor++]!.down;
      return down;
    });
  }
  // The per-track post hook: body EQ, then the track volume.
  const body = bodyOf(values);
  const eqL = pianoBody(body, sr);
  const eqR = pianoBody(body, sr);
  applyEq(left, eqL);
  applyEq(right, eqR);
  applyVolume(left, right, track, context);
}

function applyEq(buffer: Float64Array, filters: readonly Biquad2[]): void {
  for (const filter of filters)
    for (let i = 0; i < buffer.length; i += 1)
      buffer[i] = filter.process(buffer[i]!);
}

function applyVolume(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EngineContext,
): void {
  const volume = clamp(track.volume ?? 1, 0, 1);
  const points = track.volumeAutomation ?? [];
  if (points.length === 0) {
    if (volume === 1) return;
    for (let i = 0; i < left.length; i += 1) {
      left[i]! *= volume;
      right[i]! *= volume;
    }
    return;
  }
  for (let i = 0; i < left.length; i += CONTROL) {
    const tick = context.warp
      ? context.warp.tick(i)
      : i / context.samplesPerTick;
    const gain = volume * interpolateAutomation(points, tick, 1);
    const end = Math.min(left.length, i + CONTROL);
    for (let s = i; s < end; s += 1) {
      left[s]! *= gain;
      right[s]! *= gain;
    }
  }
}

/**
 * The live note-off fade for a key sounding at `hz`: a linear fade with the
 * same energy as the damper's exponential decay (0.217 x its T60, at least
 * 10 ms); keys with no damper (F6 up) ring on through the 8 s window.
 */
export function keysReleaseSeconds(track: Track, hz: number): number {
  if (!(hz > 0) || !Number.isFinite(hz)) return 0.01;
  const values = resolvedKeys(track.instrument ?? "grand", track.keys);
  if (isElectricFamily(track.instrument)) {
    const release = clamp(num(values, "release"), 0.1, 4);
    const t60 =
      track.instrument === "clav"
        ? clavReleaseT60(release)
        : tineReleaseT60(physicalKey(hz), release);
    return Math.max(0.01, (3 / (2 * LN1000)) * t60);
  }
  const p = pianoParamsAt(track, values, 0);
  const key = physicalKey(hz);
  if (undamped(key)) return KEYS_LIMITS.tailSeconds;
  const t60 = damperT60(key, pianoF1(hz, p), p.release);
  return Math.max(0.01, (3 / (2 * LN1000)) * t60);
}

function engineFor(id: string): InstrumentEngine {
  return {
    id,
    field: "keys",
    render(dry, dryR, notes, track, context) {
      const right = dryR ?? new Float64Array(dry.length);
      renderKeysTrack(dry, right, notes, track, context);
      if (!dryR)
        for (let i = 0; i < dry.length; i += 1)
          dry[i] = 0.5 * (dry[i]! + right[i]!);
    },
    tailSeconds: () => KEYS_LIMITS.tailSeconds,
    releaseSeconds: (track, _pitch, hz) => keysReleaseSeconds(track, hz),
    stereo: () => true,
  };
}

/**
 * One engine per keys family (the registry dispatches by instrument id):
 * the pianos, then the electric keys and the organs (0.6.1).
 */
export const KEYS_ENGINES: readonly InstrumentEngine[] = Object.freeze(
  [
    ...["grand", "upright", "felt", "honkytonk", "prepared"].filter((id) =>
      isPianoFamily(id),
    ),
    ...["epiano", "wurli", "clav"].filter((id) => isElectricFamily(id)),
  ]
    .map(engineFor)
    // f061-organ: tonewheel, combo and pipe (src/audio/keys/organ.ts).
    .concat(ORGAN_ENGINES),
);
