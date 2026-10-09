/**
 * Built-in carriers for instrument `vocoder` (0.7): saw, supersaw, pulse or
 * noise, pitched by the track's performed notes, the song's chord timeline
 * or a drone at `root`, through the track tuning. PolyBLEP edges (the synth
 * oscillators' residual); supersaw unison copies alternate left and right
 * on a stereo carrier. Phases are seeded from the note (never Math.random);
 * noise is keyed to the absolute song sample.
 */
import type { PerformedNote } from "../../../core/expression.ts";
import { noteHz, type TuningTable } from "../../../core/tuning.ts";
import type { ResolvedVocoder } from "../../../core/vocoder.ts";
import { unit } from "../dsp/rng.ts";
import { polyBlep } from "../synth/oscillators.ts";

/** Unison copies of a supersaw, in units of `spread` semitones. */
const UNISON = Object.freeze([0, -0.73, 0.73, -1.67, 1.67, -2.67, 2.67]);
/** Short fades so carrier notes never click (the vocoder adds no envelope). */
const FADE_SECONDS = 0.004;

export type CarrierSpan = Readonly<{
  start: number;
  length: number;
  pitches: readonly number[];
  /** Pitch offset in cents at `t` seconds from the span start (glide, bend, vibrato). */
  cents?: (t: number) => number;
  velocity: number;
  seed: number;
  /**
   * Phase runs on the absolute song sample (chord and drone spans), so a
   * window that cuts into the span hears the same wave as one pass.
   */
  absolute?: boolean;
}>;

export type CarrierOptions = Readonly<{
  sampleRate: number;
  /** Absolute song sample of index 0 (noise only). */
  origin: number;
  seed: number;
  tuning?: TuningTable;
}>;

/**
 * Adds one span (one note, chord or drone segment) of carrier into `left`
 * (and `right`). Supersaw copies after the centre alternate channels.
 */
export function renderCarrierSpan(
  left: Float64Array,
  right: Float64Array | undefined,
  span: CarrierSpan,
  settings: Pick<ResolvedVocoder, "carrier" | "spread">,
  options: CarrierOptions,
): void {
  const { sampleRate } = options;
  const end = Math.min(left.length, span.start + span.length);
  const begin = Math.max(0, span.start);
  if (end <= begin) return;
  const fade = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const level = 0.3 * (0.4 + 0.6 * Math.max(0, Math.min(1, span.velocity)));
  const envelope = (i: number): number => {
    const a = i - span.start;
    const b = span.start + span.length - i;
    return Math.min(1, a / fade, b / fade);
  };
  if (settings.carrier === "noise") {
    for (let i = begin; i < end; i += 1) {
      const v = (unit(options.seed, options.origin + i, 7) * 2 - 1) * 0.5;
      const e = envelope(i) * level;
      left[i]! += v * e;
      if (right) right[i]! += v * e;
    }
    return;
  }
  const copies = settings.carrier === "supersaw" ? UNISON : [0];
  const voices = span.pitches.length * copies.length;
  const norm = 1 / Math.sqrt(Math.max(1, voices));
  span.pitches.forEach((pitch, p) => {
    const base = noteHz(pitch, undefined, options.tuning);
    const bend = span.cents;
    copies.forEach((offset, c) => {
      const hz = base * 2 ** ((offset * settings.spread) / 12);
      let dt = hz / sampleRate;
      if (!(dt > 0 && dt < 0.5)) return;
      let phase =
        settings.carrier === "supersaw" ? unit(span.seed, p * 8 + c, 3) : 0;
      // Phase at `begin` (a span that starts before the buffer), or on the
      // absolute song sample for a span a render window may cut into.
      phase = span.absolute
        ? (phase + (((options.origin + begin) * dt) % 1)) % 1
        : (phase + (begin - span.start) * dt) % 1;
      const weight = (c === 0 ? 1 : 0.6) * norm * level;
      const side = c === 0 ? 0 : c % 2 === 1 ? -1 : 1;
      for (let i = begin; i < end; i += 1) {
        // Bends are read every 32 samples (control rate).
        if (bend && (i - begin) % 32 === 0)
          dt = Math.min(
            0.49,
            (hz * 2 ** (bend((i - span.start) / sampleRate) / 1200)) /
              sampleRate,
          );
        const v =
          settings.carrier === "pulse"
            ? (phase < 0.5 ? 1 : -1) +
              polyBlep(phase, dt) -
              polyBlep((phase + 0.5) % 1, dt)
            : 2 * phase - 1 - polyBlep(phase, dt);
        const s = v * weight * envelope(i);
        if (!right || side === 0) {
          left[i]! += s;
          if (right) right[i]! += s;
        } else if (side < 0) left[i]! += s * 1.4;
        else right[i]! += s * 1.4;
        phase += dt;
        if (phase >= 1) phase -= 1;
      }
    });
  });
}

/** Spans for `follow: notes`: one per performed note. */
export function noteSpans(
  notes: readonly PerformedNote[],
  span: (note: PerformedNote) => { start: number; length: number },
  seedOf: (note: PerformedNote) => number,
): CarrierSpan[] {
  return notes.map((note) => {
    const { start, length } = span(note);
    const cents = note.performance?.cents;
    return {
      start,
      length,
      pitches: [note.pitch],
      ...(cents ? { cents } : {}),
      velocity: note.velocity,
      seed: seedOf(note),
    };
  });
}

/**
 * Spans for `follow: chords`: the chord timeline's pitch classes voiced in
 * the octave from `root` upward, one span per chord change; no chord, no
 * carrier.
 */
export function chordSpans(
  changes: readonly Readonly<{
    start: number;
    end: number;
    pcs: readonly number[];
  }>[],
  root: number,
  seed: number,
): CarrierSpan[] {
  return changes
    .filter((change) => change.pcs.length > 0 && change.end > change.start)
    .map((change) => ({
      start: change.start,
      length: change.end - change.start,
      pitches: change.pcs.map((pc) => root + ((((pc - root) % 12) + 12) % 12)),
      velocity: 0.8,
      // One seed for the track: a render window's chord index differs.
      seed,
      absolute: true,
    }));
}
