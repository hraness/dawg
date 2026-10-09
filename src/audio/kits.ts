/**
 * Drum kits: the synthesized kits from `core/kits.ts` rendered sample by
 * sample, and the one catalog `/kit`, `/menu` and the agent list.
 *
 * The renderer calls `kitDrumSample` only for a track with `kit` set, so the
 * default voices in `wav.ts` stay byte-identical. Everything here is plain
 * arithmetic on the seeded noise `wav.ts` passes in, so a kit renders the
 * same buffer on every run.
 */
import { type DrumVoice, isDrumInstrument } from "../../core/drums.ts";
import {
  SYNTH_KITS,
  type DrumBodyParams,
  type HatParams,
  type SynthKit,
  synthKit,
} from "../../core/kits.ts";
import type { TrackScore } from "../../core/score.ts";
import { DEFAULT_KITS } from "./packs.ts";

/** Per-hit oscillator and filter state. */
export type KitVoiceState = {
  phase: number;
  band: number;
  dark: number;
  metalPrevious: number;
  holdLeft: number;
  held: number;
};

export function newKitVoiceState(): KitVoiceState {
  return {
    phase: 0,
    band: 0,
    dark: 0,
    metalPrevious: 0,
    holdLeft: 0,
    held: 0,
  };
}

/** 808 hi-hat oscillator frequencies (six detuned squares). */
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800] as const;

function body(
  params: DrumBodyParams,
  t: number,
  noise: number,
  state: KitVoiceState,
  sampleRate: number,
  ratio = 1,
): number {
  const frequency =
    (params.base + params.sweep * Math.exp(-t * params.sweepRate)) * ratio;
  state.phase += frequency / sampleRate;
  return (
    Math.sin(2 * Math.PI * state.phase) *
      Math.exp(-t * params.decay) *
      params.level +
    noise * params.click * Math.exp(-t * params.clickDecay)
  );
}

/** PolyBLEP residual for a unit step at phase 0 (Välimäki). */
function polyBlep(phase: number, step: number): number {
  if (phase < step) {
    const x = phase / step;
    return x + x - x * x - 1;
  }
  if (phase > 1 - step) {
    const x = (phase - 1) / step;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A band-limited square at `hz`, `t` seconds in (closed-form phase). */
export function blepSquare(hz: number, t: number, sampleRate: number): number {
  const phase = (t * hz) % 1;
  const step = Math.min(0.5, hz / sampleRate);
  return (
    (phase < 0.5 ? 1 : -1) +
    polyBlep(phase, step) -
    polyBlep((phase + 0.5) % 1, step)
  );
}

function hat(
  params: HatParams,
  t: number,
  noise: number,
  bright: number,
  state: KitVoiceState,
  sampleRate = 0,
): number {
  state.dark += 0.3 * (noise - state.dark);
  const noisy = params.tone * bright + (1 - params.tone) * state.dark * 0.8;
  let source = noisy;
  if (params.metal > 0) {
    let square = 0;
    // Calibrated (sampleRate > 0): band-limited squares, so the metal
    // does not alias and sounds the same at every rate.
    for (const hz of METAL_HZ)
      square +=
        sampleRate > 0
          ? blepSquare(hz, t, sampleRate)
          : (t * hz) % 1 < 0.5
            ? 1
            : -1;
    // First difference: keep the metallic top end, drop the low beating.
    const metal = (square / METAL_HZ.length - state.metalPrevious) * 1.6;
    state.metalPrevious = square / METAL_HZ.length;
    source = params.metal * metal + (1 - params.metal) * noisy;
  }
  return source * params.level * Math.exp(-t * params.decay);
}

/** One sample of `voice` in `kit` at `t` seconds after the hit. */
export function kitDrumSample(
  kit: SynthKit,
  voice: DrumVoice,
  t: number,
  noise: number,
  bright: number,
  state: KitVoiceState,
  sampleRate: number,
  /** Calibration 1+ (0.7): pitch ratio for toms, band-limited metal. */
  calibrated?: Readonly<{ tomRatio: number }>,
): number {
  let sample: number;
  const metalRate = calibrated ? sampleRate : 0;
  if (voice === "kick") sample = body(kit.kick, t, noise, state, sampleRate);
  else if (voice === "tom")
    sample = body(
      kit.tom,
      t,
      noise,
      state,
      sampleRate,
      calibrated?.tomRatio ?? 1,
    );
  else if (voice === "snare") {
    const p = kit.snare;
    state.phase += p.tone / sampleRate;
    const wires = p.snap * bright + (1 - p.snap) * noise;
    sample =
      Math.sin(2 * Math.PI * state.phase) *
        p.toneLevel *
        Math.exp(-t * p.toneDecay) +
      wires * p.noise * Math.exp(-t * p.noiseDecay);
  } else if (voice === "clap") {
    const p = kit.clap;
    state.band += p.band * (bright - state.band);
    const span = p.gap * 3;
    const burst = t < span ? (Math.floor(t / p.gap) % 2 === 0 ? 1 : 0.35) : 0;
    sample =
      state.band *
      p.level *
      (burst + 0.8 * Math.exp(-(t - span) * p.tail) * +(t >= span));
  } else if (voice === "hat")
    sample = hat(kit.hat, t, noise, bright, state, metalRate);
  else if (voice === "openhat")
    sample = hat(kit.openhat, t, noise, bright, state, metalRate);
  else {
    const p = kit.rim;
    sample =
      (Math.sin(2 * Math.PI * p.high * t) * 0.6 +
        Math.sin(2 * Math.PI * p.low * t) * 0.4) *
      Math.exp(-t * p.decay) *
      p.level;
  }
  if (kit.drive > 0) {
    const amount = 1 + kit.drive * 4;
    sample = Math.tanh(sample * amount) / Math.tanh(amount);
  }
  if (kit.bits > 0) {
    const steps = 2 ** (kit.bits - 1);
    sample = Math.round(sample * steps) / steps;
  }
  if (kit.hold > 1) {
    if (state.holdLeft <= 0) {
      state.held = sample;
      state.holdLeft = kit.hold;
    }
    state.holdLeft -= 1;
    sample = state.held;
  }
  return sample * kit.gain;
}

// ── calibrated GM extras (0.7) ─────────────────────────────────────────

/** GM cymbal and bell numbers that calibration 1+ plays as metal. */
export type MetalKind = "crash" | "ride" | "cowbell";

const METAL_PITCHES: Readonly<Record<number, MetalKind>> = Object.freeze({
  49: "crash",
  52: "crash",
  55: "crash",
  57: "crash",
  51: "ride",
  53: "ride",
  59: "ride",
  56: "cowbell",
});

/** The metal voice for a GM pitch, or undefined for every other number. */
export function metalKindForPitch(pitch: number): MetalKind | undefined {
  return METAL_PITCHES[pitch];
}

/**
 * GM tom pitch ratio: 45 (low tom) is the voice's own tuning, and each GM
 * semitone moves the body by two thirds of a semitone, so 41 (low floor)
 * through 50 (high tom) spread across about half an octave.
 */
export function tomRatio(pitch: number): number {
  const clamped = Math.max(35, Math.min(55, pitch));
  return 2 ** (((clamped - 45) * 2) / 3 / 12);
}

/**
 * One sample of a crash, ride or cowbell, `t` seconds after the hit.
 * Crash and ride are band-limited inharmonic squares through a first
 * difference plus bright noise; the cowbell is the classic 540/800 Hz
 * square pair. Deterministic: closed-form phase and the caller's noise.
 */
export function metalSample(
  kind: MetalKind,
  t: number,
  bright: number,
  state: KitVoiceState,
  sampleRate: number,
): number {
  if (kind === "cowbell") {
    const tone =
      (blepSquare(540, t, sampleRate) + blepSquare(800, t, sampleRate)) / 2;
    state.band += 0.45 * (tone - state.band);
    const envelope = 0.7 * Math.exp(-t * 60) + 0.3 * Math.exp(-t * 9);
    return state.band * 0.5 * envelope;
  }
  let square = 0;
  for (const hz of METAL_HZ) square += blepSquare(hz * 1.9, t, sampleRate);
  const metal = (square / METAL_HZ.length - state.metalPrevious) * 1.6;
  state.metalPrevious = square / METAL_HZ.length;
  if (kind === "crash") {
    const swell = Math.min(1, t / 0.004);
    return (0.55 * bright + 0.45 * metal) * 0.42 * swell * Math.exp(-t * 4.2);
  }
  // Ride: a pinged bell over a long, quieter wash.
  const ping = (0.6 * metal + 0.4 * bright) * 0.3 * Math.exp(-t * 28);
  const wash = (0.35 * metal + 0.65 * bright) * 0.16 * Math.exp(-t * 3.5);
  return ping + wash;
}

/** Length of a calibrated crash, ride or cowbell one-shot. */
export const METAL_SECONDS = 1.4;

/** Longest synth-kit one-shot in the score; 0 without kits (so renders without kits are unchanged). */
export function kitTailSeconds(score: TrackScore): number {
  let seconds = 0;
  if ((score.calibration ?? 0) >= 1) {
    const drums = new Set(
      score.tracks
        .filter((track) => isDrumInstrument(track.instrument))
        .map((track) => track.id),
    );
    if (
      score.notes.some(
        (note) =>
          drums.has(note.trackId) &&
          metalKindForPitch(note.pitch) !== undefined,
      )
    )
      seconds = METAL_SECONDS;
  }
  for (const track of score.tracks)
    seconds = Math.max(seconds, synthKit(track.kit)?.seconds ?? 0);
  return seconds;
}

// ── catalog ────────────────────────────────────────────────────────────

/**
 * One entry of the kit catalog. `synth` kits render offline from the
 * parameters in `core/kits.ts`; `sample` kits are pack banks fetched on
 * first use (`src/audio/packs.ts`). New kinds (a user's own folder of
 * samples, more packs) slot in here without touching the pickers.
 */
export type KitEntry = Readonly<{
  name: string;
  kind: "synth" | "sample";
  label: string;
  detail: string;
  /** The prompt command that puts this kit on the focused track. */
  command: string;
}>;

/** The default synth voices, listed first. */
export const DEFAULT_SYNTH_KIT = "default";

export function kitCatalog(): readonly KitEntry[] {
  const synth: KitEntry[] = [
    {
      name: DEFAULT_SYNTH_KIT,
      kind: "synth",
      label: "Default (synth)",
      detail: "the built-in voices",
      command: `/kit ${DEFAULT_SYNTH_KIT}`,
    },
    ...SYNTH_KITS.map((entry): KitEntry => ({
      name: entry.name,
      kind: "synth",
      label: entry.label,
      detail: entry.description,
      command: `/kit ${entry.name}`,
    })),
  ];
  const sample = Object.entries(DEFAULT_KITS).map(
    ([name, entry]): KitEntry => ({
      name,
      kind: "sample",
      label: `${name}  ${entry.bank || entry.pack}`,
      detail: `${entry.pack} samples (fetched once)`,
      command: `/kit ${name}`,
    }),
  );
  return Object.freeze([...synth, ...sample]);
}
