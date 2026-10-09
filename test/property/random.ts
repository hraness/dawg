/**
 * Seeded generators of valid scores for the property tests: random songs
 * built from the typed fixtures, and small edits of a given song.
 */

import {
  createScore,
  ScoreValidationError,
  type Note,
  type Track,
  type TrackScore,
  type TrackScoreData,
} from "../../core/score.ts";
import type { Rng } from "./prng.ts";
import {
  ALL_NOTES,
  ALL_TRACKS,
  EXTRA_LANES,
  NOTE_SAMPLES,
  SONG_VALUES,
  TRACK_SAMPLES,
} from "./fixtures.ts";

/** The score, or undefined when validation rejects it; other errors throw. */
export function tryScore(data: TrackScoreData): TrackScore | undefined {
  try {
    return createScore(data);
  } catch (error) {
    if (error instanceof ScoreValidationError) return undefined;
    // Some validators throw their own Error subclasses; a TypeError or
    // RangeError is a bug, never a validation answer.
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    return undefined;
  }
}

function randomTime(rng: Rng, bars: number, beatsPerBar: number): unknown {
  if (rng.chance(0.4)) return undefined;
  const maxTick = bars * beatsPerBar * 480;
  const time: Record<string, unknown> = {};
  if (rng.chance(0.6))
    time.tempo = Array.from({ length: rng.int(1, 3) }, (_, i) => ({
      tick: Math.min(maxTick, 480 * (1 + i * rng.int(1, 8))),
      bpm: rng.pick([30, 60, 90, 132, 200]),
      ...(rng.chance(0.3) ? { ramp: rng.pick(["linear", "exp"]) } : {}),
    }));
  if (rng.chance(0.5))
    time.meter = Array.from({ length: rng.int(1, 2) }, (_, i) => ({
      bar: i === 0 ? rng.pick([0, 1, 2]) : 3 + i,
      beatsPerBar: rng.int(2, 7),
      ...(rng.chance(0.3) ? { beatUnit: rng.pick([4, 8]) } : {}),
    }));
  if (rng.chance(0.5))
    time.fermatas = [{ tick: 480 * rng.int(0, 7), beats: rng.int(1, 8) }];
  return time;
}

function randomSections(rng: Rng): Partial<TrackScoreData> {
  if (rng.chance(0.5)) return {};
  const index = rng.int(0, (SONG_VALUES.sections ?? []).length - 1);
  const sections = SONG_VALUES.sections![index] as TrackScoreData["sections"];
  const form = SONG_VALUES.form?.[index] as TrackScoreData["form"];
  return {
    sections,
    ...(rng.chance(0.5) && form ? { form } : {}),
    ...(rng.chance(0.3) && sections?.some((s) => s.name === "chorus")
      ? { loopSection: "chorus" }
      : {}),
  };
}

function randomTrack(rng: Rng, id: string): Track {
  const base = rng.pick(ALL_TRACKS);
  const track: Record<string, unknown> = { ...base, id };
  if (rng.chance(0.5)) {
    const key = rng.pick(Object.keys(TRACK_SAMPLES));
    const value = rng.pick(TRACK_SAMPLES[key]!)[key as keyof Track];
    track[key] = value;
  }
  if (rng.chance(0.3)) track.volume = rng.pick([0, 0.5, 0.8, 1]);
  if (rng.chance(0.3)) track.pan = rng.pick([-1, -0.25, 0, 0.5]);
  if (rng.chance(0.2)) track.muted = !track.muted;
  if (rng.chance(0.2)) track.solo = true;
  if (rng.chance(0.2))
    track[rng.pick(EXTRA_LANES)] = [{ tick: rng.int(0, 960), value: 0.5 }];
  return track as Track;
}

function randomNote(rng: Rng, trackIds: readonly string[]): Note {
  const base = rng.pick(ALL_NOTES);
  const note: Record<string, unknown> = {
    ...base,
    id: `n${rng.int(0, 15)}`,
    trackId: rng.pick(trackIds),
    startTick: 120 * rng.int(0, 63),
    pitch: rng.int(36, 84),
  };
  for (let i = rng.int(0, 3); i > 0; i -= 1) {
    const key = rng.pick(Object.keys(NOTE_SAMPLES));
    note[key] = rng.pick(NOTE_SAMPLES[key]!)[key as keyof Note];
  }
  if (rng.chance(0.2)) delete note[rng.pick(Object.keys(note))];
  return note as Note;
}

export function randomScore(rng: Rng): TrackScore {
  for (;;) {
    const bars = rng.int(1, 32);
    const beatsPerBar = rng.int(2, 7);
    const trackIds = Array.from(
      { length: rng.int(0, 4) },
      (_, i) => `t${rng.int(0, 5)}${i}`,
    );
    const ids = [...new Set(trackIds)];
    const notes = ids.length
      ? Array.from({ length: rng.int(0, 10) }, () => randomNote(rng, ids))
      : [];
    const unique = [...new Map(notes.map((n) => [n.id, n])).values()];
    const score = tryScore({
      tempoBpm: rng.pick([30, 72, 120, 174]),
      beatsPerBar,
      bars,
      key: rng.pick([null, "C major", "A minor"]),
      time: randomTime(rng, bars, beatsPerBar) as TrackScoreData["time"],
      ...(rng.chance(0.3)
        ? { tuning: rng.pick(SONG_VALUES.tuning!) as TrackScoreData["tuning"] }
        : {}),
      ...(rng.chance(0.3)
        ? { master: rng.pick(SONG_VALUES.master!) as TrackScoreData["master"] }
        : {}),
      ...randomSections(rng),
      tracks: ids.map((id) => randomTrack(rng, id)),
      notes: unique,
    });
    if (score) return score;
  }
}

/** b as a small edit of a: a few song, track or note changes. */
export function nearbyScore(rng: Rng, a: TrackScore): TrackScore {
  for (;;) {
    const data: Record<string, unknown> = { ...a.toJSON() };
    const fresh = randomScore(rng).toJSON() as Record<string, unknown>;
    for (let i = rng.int(1, 4); i > 0; i -= 1) {
      const key = rng.pick([
        "tempoBpm",
        "beatsPerBar",
        "bars",
        "key",
        "time",
        "tuning",
        "master",
        "sections",
        "tracks",
        "notes",
      ]);
      data[key] = fresh[key];
      if (key === "sections") {
        data.form = fresh.form;
        data.loopSection = fresh.loopSection;
      }
    }
    const score = tryScore(data as TrackScoreData);
    if (score) return score;
  }
}
