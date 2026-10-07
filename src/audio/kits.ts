/**
 * Drum kits: the synthesized kits from `core/kits.ts` rendered sample by
 * sample, and the one catalog `/kit`, `/menu` and the agent list.
 *
 * The renderer calls `kitDrumSample` only for a track with `kit` set, so the
 * default voices in `wav.ts` stay byte-identical. Everything here is plain
 * arithmetic on the seeded noise `wav.ts` passes in, so a kit renders the
 * same buffer on every run.
 */
import type { DrumVoice } from "../../core/drums.ts";
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
): number {
  const frequency =
    params.base + params.sweep * Math.exp(-t * params.sweepRate);
  state.phase += frequency / sampleRate;
  return (
    Math.sin(2 * Math.PI * state.phase) *
      Math.exp(-t * params.decay) *
      params.level +
    noise * params.click * Math.exp(-t * params.clickDecay)
  );
}

function hat(
  params: HatParams,
  t: number,
  noise: number,
  bright: number,
  state: KitVoiceState,
): number {
  state.dark += 0.3 * (noise - state.dark);
  const noisy = params.tone * bright + (1 - params.tone) * state.dark * 0.8;
  let source = noisy;
  if (params.metal > 0) {
    let square = 0;
    for (const hz of METAL_HZ) square += (t * hz) % 1 < 0.5 ? 1 : -1;
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
): number {
  let sample: number;
  if (voice === "kick") sample = body(kit.kick, t, noise, state, sampleRate);
  else if (voice === "tom") sample = body(kit.tom, t, noise, state, sampleRate);
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
  } else if (voice === "hat") sample = hat(kit.hat, t, noise, bright, state);
  else if (voice === "openhat")
    sample = hat(kit.openhat, t, noise, bright, state);
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

/** Longest synth-kit one-shot in the score; 0 without kits (so renders without kits are unchanged). */
export function kitTailSeconds(score: TrackScore): number {
  let seconds = 0;
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
