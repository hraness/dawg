/**
 * Play mode: the computer keyboard as a MIDI keyboard.
 *
 * The layout is the GarageBand/Logic "Musical Typing" convention that
 * BandLab, FL Studio and Ableton follow:
 *
 *    W E   T Y U   O P          black keys (no key on R or I, matching the
 *   A S D F G H J K L ; '       missing black keys between E–F and B–C)
 *   C D E F G A B C D E F       white keys from the base octave
 *
 *   Z / X  octave down / up      C / V  velocity down / up (steps of 16)
 *   Shift  sustain while held    Tab    sustain latch     Esc  leave the mode
 *
 * Terminals report key-down only, so a held key is synthesized from the
 * keyboard's auto-repeat: a press sounds for the gate (one grid step by
 * default); repeats of the same key arriving at the repeat rate extend it,
 * and it releases RELEASE_MS after the last repeat. The first repeat after
 * the OS repeat delay cannot be told apart from a deliberate re-press until
 * the next repeat confirms the burst, so that note is absorbed into the held
 * one retroactively (`absorbed` on the extend action).
 *
 * Everything here is pure: callers pass the monotonic time of each key.
 */
import {
  SAMPLER_FIRST_SLOT,
  isSamplerInstrument,
  samplerVoiceSlots,
  type Track,
} from "../../core/score.ts";
import { pitchName } from "../../tui/highway.ts";

/** Semitone offset from the base C for each note key. */
export const WHITE_KEYS: Readonly<Record<string, number>> = Object.freeze({
  a: 0,
  s: 2,
  d: 4,
  f: 5,
  g: 7,
  h: 9,
  j: 11,
  k: 12,
  l: 14,
  ";": 16,
  "'": 17,
});

export const BLACK_KEYS: Readonly<Record<string, number>> = Object.freeze({
  w: 1,
  e: 3,
  t: 6,
  y: 8,
  u: 10,
  o: 13,
  p: 15,
});

/** Every note key, white and black, to its offset. */
export const NOTE_KEYS: Readonly<Record<string, number>> = Object.freeze({
  ...WHITE_KEYS,
  ...BLACK_KEYS,
});

/** Shifted characters a terminal sends for each note key while Shift is held. */
const SHIFTED: Readonly<Record<string, string>> = Object.freeze({
  ":": ";",
  '"': "'",
});

/** Highest offset in the layout (the top F). */
export const LAYOUT_SPAN = 17;
export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
/** Lowest and highest base C so every key stays inside MIDI 0..127. */
export const MIN_BASE = 0;
export const MAX_BASE = Math.floor((MAX_PITCH - LAYOUT_SPAN) / 12) * 12;
export const DEFAULT_BASE = 48;
export const DEFAULT_VELOCITY = 100;
export const VELOCITY_STEP = 16;
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;
/** Release after the last auto-repeat of a held key. */
export const RELEASE_MS = 120;
/** Repeats closer than this confirm a held key (macOS default is ~90 ms). */
export const REPEAT_GAP_MS = 120;
/** The first repeat arrives after the OS repeat delay, at most this late. */
export const REPEAT_DELAY_MS = 700;

/**
 * Base C that sits the keyboard in the instrument's comfortable range: bass
 * an octave below the default, leads an octave above, kits on the GM drum
 * map (A = kick 36, S = snare 38, T = closed hat 42).
 */
export function defaultBaseFor(instrument: string | undefined): number {
  const name = (instrument ?? "").toLowerCase();
  if (/bass/.test(name)) return DEFAULT_BASE - 12;
  if (/^(kit|drums?|drumkit)$/.test(name)) return 36;
  if (/^(saw|square|triangle|pluck|lead)/.test(name)) return DEFAULT_BASE + 12;
  return DEFAULT_BASE;
}

/**
 * How the keyboard sits on a track: its default base C and, for one-shot
 * samplers, the voice name each pitch slot plays (slots from 36 in
 * voice-name order, as `samplerVoiceSlots` assigns them, so A plays the
 * first voice, W the second, S the third and so on chromatically). Keyed
 * samplers start at the C at or below the lowest root.
 */
export type PlayLayout = Readonly<{
  base: number;
  /** Pitch → label (voice names on one-shot samplers). */
  labels: ReadonlyMap<number, string>;
}>;

export function playLayoutFor(track: Track | undefined): PlayLayout {
  const labels = new Map<number, string>();
  if (track && isSamplerInstrument(track.instrument) && track.sampler) {
    if (track.sampler.mode === "oneshot") {
      for (const [voice, slot] of samplerVoiceSlots(track.sampler))
        labels.set(slot, voice);
      return { base: SAMPLER_FIRST_SLOT, labels };
    }
    const roots = Object.values(track.sampler.voices).map(
      (ref) => ref.root ?? 60,
    );
    const lowest = roots.length > 0 ? Math.min(...roots) : 60;
    return { base: clampBase(Math.floor(lowest / 12) * 12), labels };
  }
  // A plain instrument takes its range from the track's name (`bass`, `lead`).
  const byInstrument = defaultBaseFor(track?.instrument);
  const base =
    byInstrument === DEFAULT_BASE && track
      ? defaultBaseFor(track.name || track.id)
      : byInstrument;
  return { base, labels };
}

export function clampBase(base: number): number {
  const octave = Math.round(base / 12) * 12;
  return Math.max(MIN_BASE, Math.min(MAX_BASE, octave));
}

export function clampVelocity(velocity: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(velocity)));
}

/** `C3–F4` for the keys' range at `base`. */
export function rangeLabel(base: number): string {
  return `${pitchName(base)}–${pitchName(base + LAYOUT_SPAN)}`;
}

export type PlayCommand =
  "exit" | "record" | "replace" | "click" | "transport" | "menu";

/** Keys that drive the mode itself rather than notes. */
const COMMAND_KEYS: Readonly<Record<string, PlayCommand>> = Object.freeze({
  "\u001b": "exit",
  r: "record",
  R: "replace",
  m: "click",
  M: "click",
  " ": "transport",
  "\u000b": "menu",
});

export type PlayedNote = Readonly<{
  /** Monotonically increasing per keyboard. */
  id: number;
  key: string;
  pitch: number;
  /** MIDI velocity 1..127. */
  velocity: number;
  atMs: number;
  /** When the note stops; Infinity while sustained. */
  releaseAtMs: number;
  sustain: boolean;
}>;

export type PlayAction =
  /** `released`: sustained notes that end now because Shift was lifted. */
  | { type: "note"; note: PlayedNote; released: readonly number[] }
  /**
   * An auto-repeat of a sounding key: `id` now releases at `releaseAtMs`.
   * `absorbed` is a tentative note (the first repeat) that belongs to `id`.
   */
  | {
      type: "extend";
      id: number;
      key: string;
      releaseAtMs: number;
      absorbed?: number | undefined;
    }
  | { type: "octave"; base: number; clamped: boolean }
  | { type: "velocity"; velocity: number; clamped: boolean }
  /** Sustain turned off: every sustained note releases at `atMs`. */
  | { type: "sustain"; on: boolean; released: readonly number[]; atMs: number }
  | { type: "command"; command: PlayCommand }
  /** Not a play-mode key; the caller handles it as usual. */
  | { type: "unmapped" };

type KeyState = {
  /** The note the key belongs to (the held one after absorption). */
  id: number;
  /** A tentative note from the first repeat, absorbed on confirmation. */
  tentative: number | undefined;
  lastMs: number;
  /** Key events seen for this note: 1 = a single press. */
  events: number;
  confirmed: boolean;
};

export type PlayKeyboardOptions = Readonly<{
  base?: number;
  velocity?: number;
}>;

export class PlayKeyboard {
  public base: number;
  public velocity: number;
  /** Tab latch. */
  public latched = false;
  private readonly keys = new Map<string, KeyState>();
  private readonly releases = new Map<number, number>();
  private readonly sustained = new Set<number>();
  private lastKey: string | undefined;
  private nextId = 1;
  /** Shift was held on the last note key (BandLab's Sustain light). */
  public shiftHeld = false;

  public constructor(options: PlayKeyboardOptions = {}) {
    this.base = clampBase(options.base ?? DEFAULT_BASE);
    this.velocity = clampVelocity(options.velocity ?? DEFAULT_VELOCITY);
  }

  public get sustain(): boolean {
    return this.latched || this.shiftHeld;
  }

  public get range(): string {
    return rangeLabel(this.base);
  }

  /** Pitch a note key plays at the current octave, or undefined. */
  public pitchFor(key: string): number | undefined {
    const offset = NOTE_KEYS[SHIFTED[key] ?? key.toLowerCase()];
    if (offset === undefined) return undefined;
    return this.base + offset;
  }

  /** Release time of a note, or undefined once forgotten. */
  public releaseOf(id: number): number | undefined {
    return this.releases.get(id);
  }

  /** Note keys currently sounding at `nowMs` (for the strip). */
  public litKeys(nowMs: number): Set<string> {
    const lit = new Set<string>();
    for (const [key, state] of this.keys) {
      const release = this.releases.get(state.tentative ?? state.id);
      if (release !== undefined && release > nowMs) lit.add(key);
    }
    return lit;
  }

  /**
   * Handle one decoded key at monotonic `nowMs`. `gateMs` is how long a
   * single press sounds (one grid step by default).
   */
  public press(value: string, nowMs: number, gateMs: number): PlayAction {
    if (value === "\t") return this.toggleLatch(nowMs);
    const command = COMMAND_KEYS[value];
    if (command) return { type: "command", command };
    const lower = value.length === 1 ? value.toLowerCase() : value;
    if (lower === "z" || lower === "x") {
      const wanted = this.base + (lower === "z" ? -12 : 12);
      this.base = clampBase(wanted);
      return { type: "octave", base: this.base, clamped: wanted !== this.base };
    }
    if (lower === "c" || lower === "v") {
      // 100 → 116 → 127 and back down in 16s, never 0 (a silent note).
      const wanted =
        this.velocity + (lower === "c" ? -VELOCITY_STEP : VELOCITY_STEP);
      this.velocity = clampVelocity(wanted);
      return {
        type: "velocity",
        velocity: this.velocity,
        clamped: wanted !== this.velocity,
      };
    }
    const pitch = this.pitchFor(value);
    if (pitch === undefined || value.length !== 1) return { type: "unmapped" };
    const key = SHIFTED[value] ?? lower;
    const shifted = value !== key;
    const previousShift = this.shiftHeld;
    this.shiftHeld = shifted;
    const repeat = this.repeatOf(key, nowMs);
    if (repeat) return repeat;
    // A plain key after Shift-held notes lifts the (synthesized) Shift.
    const released: number[] = [];
    if (previousShift && !shifted && !this.latched)
      released.push(...this.releaseSustained(nowMs));
    const sustain = this.sustain;
    const id = this.nextId++;
    const releaseAtMs = sustain ? Infinity : nowMs + gateMs;
    const previous = this.keys.get(key);
    // A second event inside the repeat delay may be the first auto-repeat;
    // keep it tentative so the next fast repeat can absorb it.
    const tentativeOf =
      previous &&
      this.lastKey === key &&
      previous.events === 1 &&
      !previous.confirmed &&
      nowMs - previous.lastMs <= REPEAT_DELAY_MS
        ? previous.id
        : undefined;
    this.keys.set(key, {
      id: tentativeOf ?? id,
      tentative: tentativeOf === undefined ? undefined : id,
      lastMs: nowMs,
      events: tentativeOf === undefined ? 1 : 2,
      confirmed: false,
    });
    this.lastKey = key;
    this.releases.set(id, releaseAtMs);
    if (sustain) this.sustained.add(id);
    this.forget(nowMs);
    const note: PlayedNote = {
      id,
      key,
      pitch,
      velocity: this.velocity,
      atMs: nowMs,
      releaseAtMs,
      sustain,
    };
    return { type: "note", note, released };
  }

  private repeatOf(key: string, nowMs: number): PlayAction | undefined {
    const state = this.keys.get(key);
    if (!state || this.lastKey !== key) return undefined;
    const gap = nowMs - state.lastMs;
    if (gap > REPEAT_GAP_MS) return undefined;
    const sounding = state.tentative ?? state.id;
    const release = this.releases.get(sounding);
    if (release === undefined) return undefined;
    state.lastMs = nowMs;
    state.events += 1;
    state.confirmed = true;
    const absorbed = state.tentative;
    state.tentative = undefined;
    const sustained =
      this.sustained.has(state.id) ||
      (absorbed !== undefined && this.sustained.has(absorbed));
    const releaseAtMs = sustained
      ? Infinity
      : Math.max(release, nowMs + RELEASE_MS);
    if (absorbed !== undefined) {
      this.releases.delete(absorbed);
      this.sustained.delete(absorbed);
      if (sustained) this.sustained.add(state.id);
    }
    this.releases.set(state.id, releaseAtMs);
    return {
      type: "extend",
      id: state.id,
      key,
      releaseAtMs,
      ...(absorbed === undefined ? {} : { absorbed }),
    };
  }

  private toggleLatch(nowMs: number): PlayAction {
    this.latched = !this.latched;
    const released = this.latched ? [] : this.releaseSustained(nowMs);
    return { type: "sustain", on: this.latched, released, atMs: nowMs };
  }

  /** End every sustained note at `nowMs` (sustain pedal up). */
  public releaseSustained(nowMs: number): number[] {
    const released = [...this.sustained];
    for (const id of released) this.releases.set(id, nowMs);
    this.sustained.clear();
    return released;
  }

  /** Drop bookkeeping for notes long gone, keeping the maps bounded. */
  private forget(nowMs: number): void {
    if (this.releases.size < 64) return;
    for (const [id, release] of this.releases)
      if (release + REPEAT_DELAY_MS < nowMs) this.releases.delete(id);
    for (const [key, state] of this.keys)
      if (!this.releases.has(state.id)) this.keys.delete(key);
  }
}

/** One row of the on-screen keyboard: `a s d …` with lit keys marked. */
export type StripCell = Readonly<{
  key: string;
  label: string;
  black: boolean;
  lit: boolean;
}>;

/** The keys in physical order across the two rows, for the strip. */
export const STRIP_ORDER: readonly string[] = Object.freeze([
  "a",
  "w",
  "s",
  "e",
  "d",
  "f",
  "t",
  "g",
  "y",
  "h",
  "u",
  "j",
  "k",
  "o",
  "l",
  "p",
  ";",
  "'",
]);

export function stripCells(
  keyboard: PlayKeyboard,
  lit: ReadonlySet<string>,
  labels: ReadonlyMap<number, string> = new Map(),
): StripCell[] {
  return STRIP_ORDER.map((key) => {
    const pitch = keyboard.pitchFor(key)!;
    const name =
      labels.size > 0 ? (labels.get(pitch) ?? "·") : pitchName(pitch);
    return {
      key,
      label: name,
      black: BLACK_KEYS[key] !== undefined,
      lit: lit.has(key),
    };
  });
}
