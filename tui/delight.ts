/**
 * Small, quiet moments that answer the music: the header ▶ glints on each
 * downbeat, the first wrap of a new song sweeps once across the hit line,
 * and a play key that is not recording glows its lane. Every one is a pure
 * function of the transport clock and a timestamp, so tests pin the clock;
 * `/motion off` turns them all off. None of them touches the score.
 */

/** How long the header ▶ stays bright after a bar downbeat. */
export const GLINT_MS = 120;
/** How long the first-loop sweep takes to cross the hit line. */
export const SWEEP_MS = 900;
/** How long a play key's lane glows. */
export const GHOST_MS = 150;
/** The card the first wrap shows, once per song. */
export const FIRST_LOOP_CARD = "↻ first loop";

export type GlintInput = Readonly<{
  playing: boolean;
  /** Transport beat, unwrapped. */
  beat: number;
  bpm: number;
  beatsPerBar: number;
  /** Bar starts within the loop (meter changes); bars repeat when absent. */
  barBeats?: readonly number[] | undefined;
  loopBeats?: number | undefined;
  reducedMotion: boolean;
}>;

/** Whether the header ▶ glints now: within `GLINT_MS` after a downbeat. */
export function downbeatGlint(input: GlintInput): boolean {
  if (!input.playing || input.reducedMotion) return false;
  if (!Number.isFinite(input.beat) || input.beat < 0) return false;
  const bpm = Math.max(1, input.bpm);
  const loop =
    input.loopBeats && input.loopBeats > 0 ? input.loopBeats : undefined;
  const inLoop = loop ? input.beat % loop : input.beat;
  let since: number;
  if (input.barBeats && input.barBeats.length > 0) {
    let start = 0;
    for (const bar of input.barBeats) if (bar <= inLoop + 1e-9) start = bar;
    since = inLoop - start;
  } else {
    const bar = Math.max(1, input.beatsPerBar);
    since = inLoop % bar;
  }
  return (since * 60_000) / bpm < GLINT_MS;
}

/**
 * The first-loop sweep's head, 0..1 across the hit line, or undefined when
 * it is not running. It plays once, `SWEEP_MS` long, from `startedAtMs`.
 */
export function sweepProgress(
  startedAtMs: number | undefined,
  nowMs: number,
  reducedMotion: boolean,
): number | undefined {
  if (startedAtMs === undefined || reducedMotion) return undefined;
  const age = nowMs - startedAtMs;
  if (age < 0 || age >= SWEEP_MS) return undefined;
  return age / SWEEP_MS;
}

/** A glowing lane: its pitch and strength (1 at the press, fading to 0). */
export type LaneGlow = Readonly<{ pitch: number; strength: number }>;

/**
 * Session-only delight state. The first loop is remembered per song in the
 * session's metadata (`heardLoop`), handed in by the host, never the score.
 */
export class Delight {
  /** The song has wrapped before (this window or an earlier session). */
  heardLoop: boolean;
  /** When this window's first-loop sweep started. */
  sweepStartedAtMs: number | undefined;
  private readonly ghosts = new Map<number, number>();
  private songId: string | undefined;

  constructor(options: { heardLoop?: boolean } = {}) {
    this.heardLoop = options.heardLoop ?? false;
  }

  /**
   * Watch the transport. Returns true once, on the first wrap of a song
   * that has not wrapped before; the caller shows the card and records it.
   */
  observe(
    input: Readonly<{
      playing: boolean;
      beat: number;
      loopBeats?: number | undefined;
      empty: boolean;
    }>,
    nowMs: number,
  ): boolean {
    if (this.heardLoop || !input.playing || input.empty) return false;
    const loop = input.loopBeats;
    if (!loop || loop <= 0 || !(input.beat >= loop)) return false;
    this.heardLoop = true;
    this.sweepStartedAtMs = nowMs;
    return true;
  }

  /**
   * Follow the open song: a different session starts fresh from its own
   * metadata; the same one only ever learns that it has wrapped.
   */
  song(id: string, heardLoop: boolean): void {
    if (id !== this.songId) {
      this.songId = id;
      this.heardLoop = heardLoop;
      this.sweepStartedAtMs = undefined;
    } else if (heardLoop) this.heardLoop = true;
  }

  /** A play key sounded without recording. */
  ghost(pitch: number, nowMs: number): void {
    this.ghosts.set(pitch, nowMs);
  }

  /** Lanes glowing now, strongest first; expired ones are dropped. */
  glows(nowMs: number, reducedMotion: boolean): LaneGlow[] {
    const glows: LaneGlow[] = [];
    for (const [pitch, atMs] of this.ghosts) {
      const age = nowMs - atMs;
      if (age >= GHOST_MS || age < 0) {
        if (age >= GHOST_MS) this.ghosts.delete(pitch);
        continue;
      }
      if (!reducedMotion) glows.push({ pitch, strength: 1 - age / GHOST_MS });
    }
    return glows.sort((a, b) => b.strength - a.strength);
  }

  /** Whether anything is animating (the host keeps frames coming). */
  animating(nowMs: number): boolean {
    return (
      this.ghosts.size > 0 ||
      (this.sweepStartedAtMs !== undefined &&
        nowMs - this.sweepStartedAtMs < SWEEP_MS)
    );
  }
}
