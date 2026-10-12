/** Small score-writing helpers; the songs below are authored, never randomized. */
import { resolveInstrumentWord } from "../instruments.ts";
import { presetByName } from "../presets/index.ts";
import { instrumentPatchForWord } from "../resonators.ts";
import {
  createScore,
  type AutomationPoint,
  type NoteInput,
  type Section,
  type TrackInput,
  type TrackScore,
} from "../score.ts";
import type { DemoInfo } from "./types.ts";

export const TPB = 480;
export const BAR = 4 * TPB;
export type Phrase = readonly (readonly [
  beat: number,
  pitch: number,
  length: number,
  velocity?: number,
  lyric?: string,
])[];

export const lanes = (
  ...points: readonly (readonly [number, number])[]
): AutomationPoint[] =>
  points.map(([bar, value]) => ({ tick: Math.round(bar * BAR), value }));

export function voice(
  id: string,
  name: string,
  word: string,
  volume: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const meaning = resolveInstrumentWord(word);
  return {
    id,
    name,
    volume,
    ...instrumentPatchForWord(word),
    ...(meaning?.field === "string" && meaning.preset
      ? { string: { preset: meaning.preset } as TrackInput["string"] }
      : {}),
    ...extra,
  };
}

export function preset(
  id: string,
  name: string,
  source: string,
  volume: number,
  extra: Partial<TrackInput> = {},
): TrackInput {
  const patch = presetByName(source)?.patch;
  if (!patch) throw new Error(`demo preset missing: ${source}`);
  return { id, name, instrument: "patch", patch, volume, ...extra };
}

export const orbit = { orbit: { orbit: 2 } } as const;
export const room = { mix: 0.12, size: 0.42, fade: 1.7, lowpass: 6500 };
export const hall = { mix: 0.2, size: 0.7, fade: 2.8, lowpass: 5200 };

export class Composer {
  readonly notes: NoteInput[] = [];
  readonly tracks: TrackInput[] = [];
  readonly sections: Section[] = [];
  constructor(readonly info: DemoInfo) {}

  track(track: TrackInput): this {
    this.tracks.push(track);
    return this;
  }
  section(
    name: string,
    startBar: number,
    bars: number,
    extra: Partial<Section> = {},
  ): this {
    this.sections.push({ name, startBar, bars, ...extra });
    return this;
  }
  note(
    trackId: string,
    bar: number,
    beat: number,
    pitch: number,
    length = 0.2,
    velocity = 0.7,
    extra: Partial<NoteInput> = {},
  ): void {
    const startTick = Math.round(bar * BAR + beat * TPB);
    const durationTicks = Math.min(
      Math.round(length * TPB),
      this.info.bars * BAR - startTick,
    );
    if (startTick < 0 || durationTicks <= 0)
      throw new Error(`demo note outside ${this.info.id}`);
    this.notes.push({
      id: `${trackId}-${this.notes.length}`,
      trackId,
      startTick,
      durationTicks,
      pitch,
      velocity,
      ...extra,
    });
  }
  chord(
    trackId: string,
    bar: number,
    beat: number,
    pitches: readonly number[],
    length: number,
    velocity = 0.6,
  ): void {
    pitches.forEach((pitch, i) =>
      this.note(
        trackId,
        bar,
        beat + i * 0.008,
        pitch,
        length,
        velocity * (i === pitches.length - 1 ? 1 : 0.88),
      ),
    );
  }
  phrase(
    trackId: string,
    bar: number,
    phrase: Phrase,
    transpose = 0,
    gain = 1,
  ): void {
    for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase)
      this.note(
        trackId,
        bar,
        beat,
        pitch + transpose,
        length,
        velocity * gain,
        lyric ? { lyric } : {},
      );
  }
  /** A compact 16-step drum grid: digits are intentional velocity accents. */
  grid(
    trackId: string,
    bar: number,
    pitch: number,
    grid: string,
    gain = 1,
    swing = 0,
  ): void {
    [...grid].forEach((hit, i) => {
      if (hit === "." || hit === "-") return;
      const velocity = Number(hit) / 10;
      this.note(
        trackId,
        bar,
        i / 4 + (i % 2 ? swing : 0),
        pitch,
        0.13,
        velocity * gain,
      );
    });
  }
  fill(bar: number, trackId = "drums", lift = 1): void {
    for (const [beat, pitch, velocity] of [
      [2.5, 38, 0.45],
      [2.75, 38, 0.58],
      [3, 45, 0.7],
      [3.25, 45, 0.5],
      [3.5, 38, 0.8],
      [3.75, 38, 0.64],
    ])
      this.note(trackId, bar, beat!, pitch!, 0.14, velocity! * lift);
  }
  /** Keep each instrument independently editable; forms expose scene navigation. */
  finish(): TrackScore {
    return createScore({
      tempoBpm: this.info.tempoBpm,
      key: this.info.key,
      bars: this.info.bars,
      ticksPerBeat: TPB,
      beatsPerBar: 4,
      calibration: 1,
      tracks: this.tracks,
      notes: this.notes,
      sections: this.sections,
      form: this.sections.map(({ name }) => ({ section: name })),
      master: {
        eq: { bell1: -1.2, bell1freq: 280, bell1q: 0.8 },
        glue: { threshold: -16, ratio: 1.5, attack: 30, release: 220 },
        width: { width: 1, mono: 120 },
        limiter: { ceiling: -1, release: 160, lookahead: 5 },
        target: -14,
      },
    });
  }
}

/** Kick owns the duck trigger; hats cannot accidentally retrigger the bus. */
export function machineTracks(
  song: Composer,
  kit: string,
  kickLevel = 0.8,
): void {
  song.track(
    voice("kick", "Kick", "kit", kickLevel, {
      kit,
      fx: { duck: { orbit: 2, depth: 0.48, attack: 0.17 } },
    }),
  );
  song.track(
    voice("drums", "Clap & hats", "kit", 0.52, {
      kit,
      reverb: { mix: 0.035, size: 0.18, fade: 0.45 },
    }),
  );
}

/** Four-on-floor remains stable while upper percussion evolves every phrase. */
export function fourFloor(
  song: Composer,
  bar: number,
  energy: number,
  variation = 0,
): void {
  song.grid("kick", bar, 36, "9...8...9...8...", energy);
  if (energy < 0.6) return;
  song.grid("drums", bar, 39, "....7.......8...", energy);
  song.grid(
    "drums",
    bar,
    42,
    variation % 2 ? "..5...6...5.3.6." : "..5...6...5...6.",
    energy,
  );
  if (energy > 0.85) song.grid("drums", bar, 46, "......4.......5.", energy);
  if (variation === 3) song.grid("drums", bar, 37, ".2.....3..2....3", energy);
}
