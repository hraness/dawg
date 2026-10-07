/**
 * The click track (metronome): an accented downbeat, a beat click and a
 * lighter subdivision click at the transport tempo and time signature.
 *
 * The click is a monitoring bus only. The engine mixes it into the live
 * stream; it is never part of a loop render, `dawg render` or an export, and
 * nothing here touches the score.
 */

export type ClickLevel = "accent" | "beat" | "sub";

export type ClickSettings = Readonly<{
  /** 0..1 output level. */
  volume: number;
  beatsPerBar: number;
  /** Clicks per beat: 1 = quarters, 2 = eighths, 4 = sixteenths. */
  subdivision: number;
}>;

export const DEFAULT_CLICK_VOLUME = 0.6;
export const MAX_SUBDIVISION = 4;

/** One click due inside a block of stream frames. */
export type ClickEvent = Readonly<{
  /** Frame offset inside the block. */
  offset: number;
  level: ClickLevel;
  /** Absolute step (beat × subdivision); negative during a count-in. */
  step: number;
}>;

/** Level of absolute step `step` (beat × subdivision). */
export function clickLevel(
  step: number,
  beatsPerBar: number,
  subdivision: number,
): ClickLevel {
  const perBar = Math.max(1, beatsPerBar) * Math.max(1, subdivision);
  const inBar = ((step % perBar) + perBar) % perBar;
  if (inBar === 0) return "accent";
  return inBar % Math.max(1, subdivision) === 0 ? "beat" : "sub";
}

/**
 * Clicks whose time falls in the half-open beat span [fromBeat, toBeat)
 * covered by `frames` stream frames. Contiguous blocks never repeat or skip
 * a click, and a jump (seek, loop wrap) never fires a stray mid-beat click.
 */
export function clicksIn(
  fromBeat: number,
  toBeat: number,
  frames: number,
  settings: Pick<ClickSettings, "beatsPerBar" | "subdivision">,
): ClickEvent[] {
  if (!(toBeat > fromBeat) || frames <= 0) return [];
  const subdivision = Math.max(
    1,
    Math.min(MAX_SUBDIVISION, Math.round(settings.subdivision)),
  );
  const events: ClickEvent[] = [];
  const span = toBeat - fromBeat;
  // Half-open: a click exactly at `toBeat` belongs to the next block, whose
  // `fromBeat` is computed identically, so it fires once.
  const first = Math.ceil(fromBeat * subdivision) + 0;
  for (let step = first; step / subdivision < toBeat; step += 1) {
    const offset = Math.floor(
      ((step / subdivision - fromBeat) / span) * frames,
    );
    if (offset < 0 || offset >= frames) continue;
    events.push({
      offset,
      step,
      level: clickLevel(step, settings.beatsPerBar, subdivision),
    });
    if (events.length > 64) break;
  }
  return events;
}

const CLICK_TONES: Readonly<
  Record<ClickLevel, { hz: number; gain: number; ms: number }>
> = Object.freeze({
  accent: { hz: 1760, gain: 1, ms: 45 },
  beat: { hz: 1320, gain: 0.7, ms: 35 },
  sub: { hz: 990, gain: 0.35, ms: 25 },
});

/** Mono click waveforms (−1..1) for each level at `sampleRate`. */
export function clickSounds(
  sampleRate: number,
): Readonly<Record<ClickLevel, Float32Array>> {
  const make = (level: ClickLevel): Float32Array => {
    const tone = CLICK_TONES[level];
    const frames = Math.max(1, Math.round((tone.ms * sampleRate) / 1000));
    const out = new Float32Array(frames);
    const attack = Math.max(1, Math.round(0.001 * sampleRate));
    for (let index = 0; index < frames; index += 1) {
      const t = index / sampleRate;
      const decay = Math.exp((-index / frames) * 6);
      const env = Math.min(1, index / attack) * decay;
      out[index] = Math.sin(2 * Math.PI * tone.hz * t) * env * tone.gain;
    }
    return out;
  };
  return { accent: make("accent"), beat: make("beat"), sub: make("sub") };
}

/** `/click on|off|<volume>` → settings change, or an error message. */
export function parseClickArgument(
  argument: string,
  current: Readonly<{ on: boolean; volume: number }>,
): { on: boolean; volume: number } | { error: string } {
  const value = argument.trim().toLowerCase();
  if (value === "" || value === "toggle")
    return { on: !current.on, volume: current.volume };
  if (value === "on") return { on: true, volume: current.volume };
  if (value === "off") return { on: false, volume: current.volume };
  const percent = value.endsWith("%");
  const number = Number(percent ? value.slice(0, -1) : value);
  if (!Number.isFinite(number) || number < 0)
    return { error: "usage: /click on|off|<volume 0..1 or 0..100%>" };
  const volume = percent || number > 1 ? number / 100 : number;
  if (volume > 1) return { error: "click volume is 0..1 (or 0..100%)" };
  return { on: volume > 0, volume };
}
