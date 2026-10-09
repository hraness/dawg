/**
 * The string engine (0.6 lane A): renders a track whose instrument is
 * `"string"` and which carries `Track.string`. Each performed note plays
 * one string per unison player (plus an octave course), streamed in blocks
 * with same-pitch restrike and a chord-group voice cap; the summed strings
 * then pass the track's body and sympathetic strings, the preset trim and
 * the track volume, before the track's effects (wav.ts).
 */
import { parseKey, scaleSteps } from "../../../core/chords.ts";
import type { PerformedNote } from "../../../core/expression.ts";
import type { FxLane } from "../../../core/fx.ts";
import type { Track } from "../../../core/score.ts";
import {
  resolveString,
  stringPresetTableText,
  type StringValues,
} from "../../../core/strings.ts";
import { noteHz } from "../../../core/tuning.ts";
import { interpolateAutomation } from "../effects/common.ts";
import { seedHash, unit } from "../dsp/rng.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import { applyBody, bodyFor, symKeys, sympathetic } from "./body.ts";
import { keysTrim } from "../keys/calibration.ts";
import { clamp } from "./loop.ts";
import { PluckString, type Exciter, type PluckSpec } from "./pluck.ts";
import {
  BowedString,
  type BowControl,
  type BowSpec,
  type BowNote,
} from "./bow.ts";

const BLOCK = 128;
/** Longest a single string may ring (seconds). */
const MAX_RING = 12;
/** Sympathetic strings' own T60 at C4 (prototype). */
const SYM_DECAY = 4;

/** Value of `name` at `tick`: the `string-<name>` lane over the stored value. */
function valueAt(
  track: Track,
  values: StringValues,
  name: string,
  tick: number,
): number {
  const base = values[name] as number;
  const points = track.fxAutomation?.[`string-${name}` as FxLane];
  return points && points.length > 0
    ? interpolateAutomation(points, tick, base)
    : base;
}

/** The plucked-string spec for one note (articulations map to timbre). */
export function noteSpec(
  values: StringValues,
  note: PerformedNote,
  track: Track,
): { spec: PluckSpec; velocity: number } {
  const at = (name: string) => valueAt(track, values, name, note.startTick);
  let mute = clamp(at("mute"), 0, 1);
  let bright = clamp(values.bright as number, 0, 1);
  let velocity = clamp(note.velocity, 0, 1);
  const articulation = note.articulation;
  if (articulation === "staccato") mute = Math.max(mute, 0.7);
  if (articulation === "ghost") {
    mute = 1;
    bright *= 0.5;
  }
  if (articulation === "accent" || articulation === "marcato")
    velocity = Math.min(1, velocity + 0.15);
  // Velocity sensitivity: 0 plays every note at full velocity.
  const sens = clamp(values.vel as number, 0, 1);
  velocity = 1 - sens * (1 - velocity);
  const damp = clamp(values.damp as number, 0, 1);
  return {
    spec: {
      // Palm mute: up to 12x shorter ring and a darker loop.
      decay: Math.max(0.02, at("ring") * (1 - 0.92 * mute)),
      track: values.track as number,
      damp: damp + (1 - damp) * 0.6 * mute,
      stiff: values.stiff as number,
      pos: clamp(values.pos as number, 0.01, 0.5),
      exciter: values.exciter as Exciter,
      bright,
      noise: values.noise as number,
      release: values.release as number,
      jawari: clamp(at("buzz"), 0, 1),
      pickup: values.pickup as number,
    },
    velocity,
  };
}

/** Whether resolved values play the bowed voice (`exciter bow`). */
export function isBowed(values: StringValues): boolean {
  return values.exciter === "bow";
}

/** Play mode keeps a bowed section to two players (live budget). */
export const LIVE_BOW_UNISON = 2;

/** The track as play mode hears it: a bowed section capped at 2 players. */
export function liveStringTrack(track: Track): Track {
  if (track.instrument !== "string" || !track.string) return track;
  const values = resolveString(track.string);
  if (!isBowed(values) || (values.unison as number) <= LIVE_BOW_UNISON)
    return track;
  return { ...track, string: { ...track.string, unison: LIVE_BOW_UNISON } };
}

/** Bow lanes read every 32 samples (`string-<name>`, absent: the value). */
const BOW_LANES = ["pressure", "speed", "sord", "dyn"] as const;

/** The bowed spec and note fields for one note. */
export function bowSpec(
  values: StringValues,
  note: PerformedNote,
  track: Track,
  context: EngineContext,
): { spec: BowSpec; velocity: number; control?: (t: number) => BowControl } {
  const at = (name: string) => valueAt(track, values, name, note.startTick);
  let velocity = clamp(note.velocity, 0, 1);
  const articulation = note.articulation;
  const sens = clamp(values.vel as number, 0, 1);
  velocity = 1 - sens * (1 - velocity);
  let attack = values.attack as number;
  let release = values.release as number;
  // Detache (spec 4): staccato and ghost are short strokes, quick on and off.
  if (articulation === "staccato" || articulation === "ghost") {
    attack = Math.min(attack, 0.01);
    release = Math.min(release, 0.03);
  }
  // A harder stroke presses harder (spec 4: pressure += 0.3 (vel - 0.5)).
  const press = (p: number) => clamp(p + 0.3 * (velocity - 0.5), 0, 1);
  // Accent and marcato bite: pressure +0.2 for the first 80 ms.
  const bite = articulation === "accent" || articulation === "marcato";
  const spec: BowSpec = {
    decay: Math.max(0.02, at("ring")),
    track: values.track as number,
    damp: clamp(values.damp as number, 0, 1),
    pos: clamp(at("pos"), 0.01, 0.5),
    pressure: press(at("pressure")),
    speed: clamp(at("speed"), 0, 1),
    attack,
    release,
    tremhz: values.tremhz as number,
    sord: clamp(at("sord"), 0, 1),
  };
  const lanes = BOW_LANES.filter(
    (name) =>
      (track.fxAutomation?.[`string-${name}` as FxLane]?.length ?? 0) > 0,
  );
  const dyn = clamp(values.dyn as number, 0, 1);
  if (lanes.length === 0 && dyn === 1 && !bite) return { spec, velocity };
  const fixed: BowControl = {
    pressure: spec.pressure,
    speed: spec.speed,
    sord: spec.sord,
    dyn,
  };
  const bitten: BowControl = {
    ...fixed,
    pressure: clamp(spec.pressure + 0.2, 0, 1),
  };
  if (lanes.length === 0)
    return {
      spec,
      velocity,
      control: bite ? (t) => (t < 0.08 ? bitten : fixed) : () => fixed,
    };
  // Lanes are read in ticks; warped songs read them at the note's tempo.
  const ticksPerSecond = context.sampleRate / context.samplesPerTick;
  const control = (t: number): BowControl => {
    const tick = note.startTick + t * ticksPerSecond;
    const lane = (name: string) =>
      clamp(valueAt(track, values, name, tick), 0, 1);
    return {
      pressure: clamp(
        press(lane("pressure")) + (bite && t < 0.08 ? 0.2 : 0),
        0,
        1,
      ),
      speed: lane("speed"),
      sord: lane("sord"),
      dyn: lane("dyn"),
    };
  };
  return { spec, velocity, control };
}

/** The preset vibrato alone (a slur keeps it running). */
function vibratoCurve(
  note: PerformedNote,
  values: StringValues,
  track: Track,
  player: Readonly<{ rate: number; depth: number; phase: number }> = SOLO,
): ((t: number) => number) | undefined {
  if (note.performance?.replaceVibrato) return undefined;
  const rate = valueAt(track, values, "vib", note.startTick) * player.rate;
  const depth =
    valueAt(track, values, "vibmod", note.startTick) * 100 * player.depth;
  const delay = values.vibdelay as number;
  if (!(rate > 0 && depth > 0)) return undefined;
  const phase = player.phase;
  return (t: number) => {
    if (t <= delay) return 0;
    const fade = Math.min(1, (t - delay) / 0.15);
    return depth * fade * Math.sin(2 * Math.PI * (rate * (t - delay) + phase));
  };
}

const SOLO = { rate: 1, depth: 1, phase: 0 } as const;

/** Longest seeded onset spread of a bowed section's players (spec 2). */
export const SECTION_SPREAD = 0.025;

/**
 * One section player (spec 2, Ensemble): seeded vibrato rate x0.92-1.08,
 * depth x0.8-1.2 and phase, and an onset up to 25 ms late (scaled down
 * for notes under 0.25 s). The first player stays on the grid.
 */
export function sectionPlayer(
  seed: number,
  index: number,
  hold: number,
): { rate: number; depth: number; phase: number; onset: number } {
  const h = seedHash(`${seed}:${index}:player`);
  return {
    rate: 0.92 + 0.16 * unit(h, 0, 1),
    depth: 0.8 + 0.4 * unit(h, 1, 1),
    phase: unit(h, 2, 1),
    onset:
      index === 0
        ? 0
        : SECTION_SPREAD * unit(h, 3, 1) * Math.min(1, hold / 0.25),
  };
}

type Voice = {
  string: PluckString | BowedString;
  /** The string's pitch over the note's base pitch (a slur keeps it). */
  ratio: number;
  start: number;
  pitch: number;
  group: number;
  gainL: number;
  gainR: number;
  damp?: Readonly<{ from: number; tau: number }>;
};

/**
 * Whether pending note `index` (starting at `start`) is a lone note: no
 * other note starts with it, so a held single note may slur into it.
 */
function slurs(
  pending: readonly { start: number }[],
  index: number,
  start: number,
): boolean {
  return (
    pending[index - 1]?.start !== start && pending[index + 1]?.start !== start
  );
}

/** A 64th note in samples at the song's start tempo (the slur window). */
function slurWindow(context: EngineContext): number {
  const ticks = (context.score.ticksPerBeat ?? 480) / 16;
  return ticks * context.samplesPerTick;
}

/** Ring-out after the last note-off, in seconds. */
export function stringTailSeconds(track: Track): number {
  const values = resolveString(track.string);
  const release = values.release as number;
  const sym = (values.sym as number) > 0 ? SYM_DECAY : 0;
  return Math.min(MAX_RING, Math.max(release, sym) + 0.05);
}

function startSample(note: PerformedNote, context: EngineContext): number {
  if (context.warp)
    return Math.max(0, Math.floor(context.warp.sample(note.startTick)));
  return Math.max(0, Math.floor(note.startTick * context.samplesPerTick));
}

function holdSamples(
  note: PerformedNote,
  start: number,
  context: EngineContext,
): number {
  if (context.warp)
    return Math.max(
      1,
      Math.floor(
        context.warp.sample(note.startTick + note.durationTicks) - start,
      ),
    );
  return Math.max(1, Math.floor(note.durationTicks * context.samplesPerTick));
}

/** Combined pitch curve: the note's own, then the preset vibrato. */
function centsCurve(
  note: PerformedNote,
  values: StringValues,
  track: Track,
): ((t: number) => number) | undefined {
  const own = note.performance?.cents;
  const rate = valueAt(track, values, "vib", note.startTick);
  const depth = valueAt(track, values, "vibmod", note.startTick) * 100;
  const delay = values.vibdelay as number;
  const vibrato =
    rate > 0 && depth > 0 && !note.performance?.replaceVibrato
      ? (t: number) => {
          if (t <= delay) return 0;
          const fade = Math.min(1, (t - delay) / 0.15);
          return depth * fade * Math.sin(2 * Math.PI * rate * (t - delay));
        }
      : undefined;
  if (own && vibrato) return (t) => own(t) + vibrato(t);
  return own ?? vibrato;
}

/** Renders a string track's notes into `dry` (and `dryR` when stereo). */
export function renderStrings(
  dry: Float64Array,
  dryR: Float64Array | undefined,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const sr = context.sampleRate;
  const total = Math.min(dry.length, context.samples);
  const values = resolveString(track.string);
  const unison = Math.max(1, Math.round(values.unison as number));
  const detune = values.detune as number;
  const spread = dryR ? clamp(values.spread as number, 0, 1) : 0;
  const oct = values.oct as number;
  const octbelow = values.octbelow as number;
  const cap = Math.max(1, Math.round(values.voices as number));
  const tuning = context.tuning;
  const bowed = isBowed(values);
  // Calibration 1 (q08): the keyboard string presets (the harpsichord) take
  // the keys' key-tracked level trim; other presets have no row.
  const trimPreset =
    (context.score.calibration ?? 0) >= 1 ? track.string?.preset : undefined;
  const L = new Float64Array(total);
  const R = dryR ? new Float64Array(total) : undefined;
  const voices: Voice[] = [];
  const pending = notes
    .map((note) => ({ note, start: startSample(note, context) }))
    .filter((item) => item.start < total)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.note.pitch - b.note.pitch ||
        (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
    );
  let next = 0;
  for (let at = 0; at < total; at += BLOCK) {
    const count = Math.min(BLOCK, total - at);
    while (next < pending.length && pending[next]!.start < at + count) {
      const { note, start } = pending[next]!;
      next += 1;
      const baseHz = noteHz(note.pitch, note.cents, tuning);
      if (!(baseHz > 0) || baseHz >= 0.45 * sr) continue;
      // Slur (bowed): a single note that starts while one earlier single
      // note is still bowed moves that bow to the new pitch in 7 ms, with
      // no new attack (legato articulation overlaps its notes, so it
      // slurs too). Chords and double stops start new strokes.
      if (bowed && slurs(pending, next - 1, start)) {
        const held = voices.filter(
          (v) => !v.string.done && v.string.offAt > start - v.start,
        );
        const groups = new Set(held.map((v) => v.group));
        const pitches = new Set(held.map((v) => v.pitch));
        // A true legato only: the held note lets go within a short window
        // of the new one (a 64th note or 150 ms, legato's own overlap), or
        // the new note is marked legato. A pedal or a note held under a
        // moving line keeps sounding and the new note takes a new stroke.
        const window = Math.max(0.15 * sr, slurWindow(context));
        const letsGo =
          note.articulation === "legato" ||
          held.every((v) => v.start + v.string.offAt <= start + window);
        const range = held.every((v) =>
          (v.string as BowedString).canSlurTo(baseHz * v.ratio),
        );
        if (
          letsGo &&
          range &&
          groups.size === 1 &&
          pitches.size === 1 &&
          held[0]!.start < start
        ) {
          const hold = holdSamples(note, start, context) / sr;
          for (const v of held) {
            (v.string as BowedString).slurTo(
              baseHz * v.ratio,
              start - v.start,
              Math.max(0.01, hold),
              note.performance?.cents,
            );
            v.pitch = note.pitch;
          }
          continue;
        }
      }
      // Restrike: the same key damps its previous string.
      for (const v of voices)
        if (v.pitch === note.pitch) v.string.releaseAt(start - v.start);
      // Voice cap: count only chords not yet released, so a releasing
      // chord never shields the newer ringing ones from the cap.
      const held = voices.filter(
        (v) => !v.string.done && v.string.offAt > start - v.start,
      );
      const groups = new Set(held.map((v) => v.group));
      if (groups.size >= cap) {
        const oldest = Math.min(...groups);
        for (const v of held)
          if (v.group === oldest) v.string.releaseAt(start - v.start);
      }
      const seed = seedHash(
        `${note.id}:${note.startTick + (context.seedTick ?? 0)}:string`,
      );
      const strings: { hz: number; gain: number; ratio: number }[] = [];
      const trim = trimPreset ? keysTrim(trimPreset, note.pitch) : 1;
      // The course's tuning error belongs to the key, not to the strike: it
      // is seeded by track and key (so every velocity of a key beats the
      // same way) and centred, so the course's mean pitch is the table's.
      const course = seedHash(`${track.id}:${note.pitch}:course`);
      const jitters = Array.from({ length: unison }, (_, i) =>
        unison > 1 ? (unit(course, i, 1) - 0.5) * 2 : 0,
      );
      const meanJitter = jitters.reduce((a, b) => a + b, 0) / unison;
      for (let i = 0; i < unison; i += 1) {
        const d = unison > 1 ? (i / (unison - 1) - 0.5) * detune : 0;
        const jitter = jitters[i]! - meanJitter;
        const ratio = 2 ** ((d * 100 + jitter) / 1200);
        strings.push({
          hz: baseHz * ratio,
          gain: trim / Math.sqrt(unison),
          ratio,
        });
      }
      if (oct > 0 && note.pitch < octbelow) {
        const up = noteHz(Math.min(127, note.pitch + 12), note.cents, tuning);
        const hz = up > 0 ? up : baseHz * 2;
        if (hz < 0.45 * sr) {
          const tuned =
            hz * 2 ** (((unit(course, unison, 1) - 0.5) * 4) / 1200);
          strings.push({
            hz: tuned,
            gain: (trim * oct) / Math.sqrt(unison),
            ratio: tuned / baseHz,
          });
        }
      }
      const hold = holdSamples(note, start, context) / sr;
      const pluck = bowed ? undefined : noteSpec(values, note, track);
      const bow = bowed ? bowSpec(values, note, track, context) : undefined;
      const cents = bowed
        ? note.performance?.cents
        : centsCurve(note, values, track);
      const section = bowed && unison > 1;
      strings.forEach((s, i) => {
        // Section players (not the octave string) are seeded as players.
        const player =
          section && i < unison ? sectionPlayer(seed, i, hold) : undefined;
        const onset = player ? Math.round(player.onset * sr) : 0;
        const vibrato = bowed
          ? vibratoCurve(note, values, track, player)
          : undefined;
        const pan =
          strings.length > 1 ? (i / (strings.length - 1) - 0.5) * spread : 0;
        const common = {
          hz: s.hz,
          hold: Math.max(0.01, hold - onset / sr),
          seed: seedHash(`${seed}:${i}`),
          ...(cents ? { cents } : {}),
        };
        const string = bow
          ? new BowedString(
              bow.spec,
              {
                ...common,
                velocity: bow.velocity,
                ...(vibrato ? { vibrato } : {}),
                ...(bow.control ? { control: bow.control } : {}),
              } satisfies BowNote,
              sr,
              // A bow sustains for as long as the note is held.
              Math.max(MAX_RING, hold + bow.spec.release + 1),
            )
          : new PluckString(
              pluck!.spec,
              { ...common, velocity: pluck!.velocity },
              sr,
              MAX_RING,
            );
        const gl = R ? s.gain * Math.sqrt(0.5 - pan / 2) * Math.SQRT2 : s.gain;
        const gr = s.gain * Math.sqrt(0.5 + pan / 2) * Math.SQRT2;
        voices.push({
          string,
          ratio: s.ratio,
          start: start + onset,
          pitch: note.pitch,
          group: start,
          gainL: gl,
          gainR: gr,
          ...(note.performance?.damp ? { damp: note.performance.damp } : {}),
        });
      });
    }
    for (const v of voices) {
      if (v.string.done) continue;
      const from = Math.max(at, v.start);
      const n = at + count - from;
      if (n <= 0) continue;
      let scale = 1;
      if (v.damp) {
        const t = (from - v.start) / sr;
        if (t > v.damp.from) scale = Math.exp(-(t - v.damp.from) / v.damp.tau);
      }
      v.string.process(L, from, n, v.gainL * scale, R, v.gainR * scale);
    }
    for (let i = voices.length - 1; i >= 0; i -= 1)
      if (voices[i]!.string.done) voices.splice(i, 1);
  }
  finishTrack(L, R, values, track, context);
  for (let i = 0; i < total; i += 1) {
    dry[i] = dry[i]! + L[i]!;
    if (dryR && R) dryR[i] = dryR[i]! + R[i]!;
  }
}

/** Body, sympathetic strings, preset trim and track volume. */
function finishTrack(
  L: Float64Array,
  R: Float64Array | undefined,
  values: StringValues,
  track: Track,
  context: EngineContext,
): void {
  const sr = context.sampleRate;
  const sym = values.sym as number;
  let wet: Float64Array | undefined;
  if (sym > 0) {
    const mono = R ? new Float64Array(L.length) : L;
    if (R)
      for (let i = 0; i < L.length; i += 1) mono[i] = 0.5 * (L[i]! + R[i]!);
    // The key's own scale (a raga's or maqam's, quarter tones included),
    // not the chord mode it harmonizes with.
    const key = parseKey(context.score.key);
    const root = 48 + (key?.tonic ?? 0);
    const steps = key ? scaleSteps(key) : [0, 2, 4, 5, 7, 9, 11];
    const hzs = symKeys(values.symtune as string, root, steps).map((k) =>
      noteHz(k.key, k.cents || undefined, context.tuning),
    );
    wet = sympathetic(mono, hzs, 0.02 * sym, SYM_DECAY, 0.3, sr);
  }
  const body = bodyFor(values.body as string, values.size as number);
  applyBody(L, body, sr);
  if (R) applyBody(R, body, sr);
  if (wet)
    for (let i = 0; i < L.length; i += 1) {
      L[i] = L[i]! + wet[i]!;
      if (R) R[i] = R[i]! + wet[i]!;
    }
  // Preset trim (and its lane) and the track volume, every 32 samples.
  const volume = Math.max(0, Math.min(1, track.volume ?? 1));
  const volumeLane = track.volumeAutomation ?? [];
  const gainLane = track.fxAutomation?.["string-gain" as FxLane];
  const warp = context.warp;
  for (let at = 0; at < L.length; at += 32) {
    const tick = warp ? warp.tick(at) : at / context.samplesPerTick;
    const trim =
      gainLane && gainLane.length > 0
        ? interpolateAutomation(gainLane, tick, values.gain as number)
        : (values.gain as number);
    const g =
      Math.max(0, trim) *
      volume *
      (volumeLane.length > 0 ? interpolateAutomation(volumeLane, tick, 1) : 1);
    const end = Math.min(L.length, at + 32);
    for (let i = at; i < end; i += 1) {
      L[i] = L[i]! * g;
      if (R) R[i] = R[i]! * g;
    }
  }
}

/** True when the track's strings are panned apart (spread with 2+ strings). */
export function stringStereo(track: Track): boolean {
  const values = resolveString(track.string);
  const strings =
    Math.max(1, Math.round(values.unison as number)) +
    ((values.oct as number) > 0 ? 1 : 0);
  return (values.spread as number) > 0 && strings > 1;
}

/** Digest of the preset table text (FNV-1a, hex), computed once. */
const STRING_PRESET_DIGEST = `strings:${fnv1a(stringPresetTableText())}`;

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const STRING_ENGINE: InstrumentEngine = Object.freeze({
  id: "string",
  field: "string" as keyof Track,
  render: (dry, dryR, notes, track, context) =>
    renderStrings(dry, dryR, notes, track, context),
  tailSeconds: stringTailSeconds,
  stereo: stringStereo,
  // The preset table joins the stem and live keys: a code-side preset
  // retune never serves a stem rendered from the old table.
  assetDigests: () => [STRING_PRESET_DIGEST],
});
