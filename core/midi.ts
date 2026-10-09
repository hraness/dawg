/**
 * Standard MIDI File (SMF) export.
 *
 * Format 1: track 0 is the conductor track with the time-signature (FF 58)
 * and tempo (FF 51) meta events, then one track per score track with its
 * notes. The file's division is the score's ticks per quarter, so score
 * ticks are written as they are.
 *
 * SMF tempo is constant between events, so ramps are written as steps
 * (every `rampStepTicks`, a sixteenth by default) and a fermata as a slower
 * tempo over its beat. Each step's tempo is the exact average over the step,
 * so every step boundary lands at the same second as in the rendered WAV.
 *
 * Notes are written as performed (core/expression.ts): articulation
 * lengths and velocities, humanize, the velocity curve and mono/legato
 * voicing. The sustain pedal is written as CC64 (127 down, 64 half, 0 up)
 * while each note keeps its key length, as a real pedal recording does.
 * Pitch expression (glide, bend, per-note vibrato) and per-note cents are
 * not exported: SMF pitch bend is per channel, so those notes play at their
 * written pitch.
 *
 * Tuning (core/tuning.ts) is written with the MIDI Tuning Standard: each
 * tuned track gets a real-time single-note tuning change SysEx (F0 7F 7F
 * 08 02) carrying every key's frequency as a tuning program, selected on
 * its channel with RPN 3 (tuning program select). Synths that honour MTS
 * play the tuning; others play 12-TET keys. Section starts are FF 06
 * marker events on the conductor track.
 *
 * Pure and dependency-free apart from the score modules.
 */
import { isDrumInstrument } from "./drums.ts";
import {
  performanceTimingFor,
  performNotes,
  type PedalState,
} from "./expression.ts";
import {
  barStartTick,
  clickTicksOf,
  fermataSpan,
  loopTicksOf,
  meterSegments,
  performedNotes,
  timeMapFor,
  type TimeScore,
} from "./tempo.ts";
import type { TrackScore } from "./score.ts";
import { resolveTuning, type TuningTable } from "./tuning.ts";

export type MidiOptions = Readonly<{
  /** Ticks per tempo step inside a ramp; default a sixteenth note. */
  rampStepTicks?: number;
}>;

const MAX_DIVISION = 0x7fff;

/** Breakpoints and tempos (microseconds per quarter) for the conductor. */
export function midiTempoEvents(
  score: TimeScore,
  options: MidiOptions = {},
): readonly Readonly<{ tick: number; usPerQuarter: number }>[] {
  const tpb = score.ticksPerBeat;
  const map = timeMapFor(score);
  const constantUs = (bpm: number) => Math.round(60_000_000 / bpm);
  if (!map) return [{ tick: 0, usPerQuarter: constantUs(score.tempoBpm) }];
  const end = loopTicksOf(score);
  const step = Math.max(1, Math.round(options.rampStepTicks ?? tpb / 4));
  const points = new Set<number>([0]);
  let previous = 0;
  for (const event of score.time?.tempo ?? []) {
    if (event.ramp)
      for (let tick = previous + step; tick < event.tick; tick += step)
        points.add(tick);
    points.add(event.tick);
    previous = event.tick;
  }
  for (const fermata of score.time?.fermatas ?? []) {
    points.add(fermata.tick);
    points.add(fermata.tick + fermataSpan(score, fermata.tick));
  }
  const ticks = [...points].filter((tick) => tick >= 0).sort((a, b) => a - b);
  const out: { tick: number; usPerQuarter: number }[] = [];
  for (let index = 0; index < ticks.length; index += 1) {
    const tick = Math.round(ticks[index]!);
    const next = ticks[index + 1];
    let us: number;
    if (next === undefined || tick >= end) us = constantUs(map.bpm(tick));
    else {
      const seconds = map.seconds(next) - map.seconds(tick);
      us = Math.round((seconds * 1_000_000 * tpb) / (next - tick));
    }
    us = Math.min(0xffffff, Math.max(1, us));
    if (out.length > 0 && out[out.length - 1]!.usPerQuarter === us) continue;
    out.push({ tick, usPerQuarter: us });
  }
  return out;
}

function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

type TimedEvent = Readonly<{ tick: number; order: number; bytes: number[] }>;

function trackChunk(
  events: TimedEvent[],
  name: string | undefined,
  endTick: number,
): number[] {
  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || a.order - b.order,
  );
  const body: number[] = [];
  if (name !== undefined) {
    const text = [...new TextEncoder().encode(name)].slice(0, 127);
    body.push(0, 0xff, 0x03, ...varLen(text.length), ...text);
  }
  let last = 0;
  for (const event of sorted) {
    body.push(...varLen(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(...varLen(Math.max(0, endTick - last)), 0xff, 0x2f, 0);
  return [
    0x4d,
    0x54,
    0x72,
    0x6b,
    (body.length >>> 24) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ];
}

const CC64: Readonly<Record<PedalState, number>> = {
  down: 127,
  half: 64,
  up: 0,
};

function log2(value: number): number {
  return Math.round(Math.log2(value));
}

/** MTS frequency words (semitone, 14-bit fraction) for keys 0..127. */
export function mtsKeys(table: TuningTable): readonly number[][] {
  const out: number[][] = [];
  for (let key = 0; key < 128; key++) {
    const hz = table.hz[key] ?? 0;
    if (!(hz > 0)) {
      out.push([0x7f, 0x7f, 0x7f]);
      continue;
    }
    const value = 69 + 12 * Math.log2(hz / 440);
    let semitone = Math.floor(value);
    let fraction = Math.round((value - semitone) * 16384);
    if (fraction >= 16384) {
      semitone += 1;
      fraction = 0;
    }
    if (semitone < 0) out.push([0, 0, 0]);
    else if (semitone > 127 || (semitone === 127 && fraction > 16382))
      out.push([0x7f, 0x7f, 0x7e]);
    else out.push([semitone, (fraction >> 7) & 0x7f, fraction & 0x7f]);
  }
  return out;
}

/** The SysEx and RPN events that tune a channel at tick 0. */
function tuningEvents(
  keys: readonly number[][],
  program: number,
  channel: number,
): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (let first = 0; first < 128; first += 64) {
    const data = [0x7f, 0x7f, 0x08, 0x02, program, 64];
    for (let key = first; key < first + 64; key++)
      data.push(key, ...keys[key]!);
    data.push(0xf7);
    events.push({
      tick: 0,
      order: -2,
      bytes: [0xf0, ...varLen(data.length), ...data],
    });
  }
  const cc = 0xb0 | channel;
  events.push({
    tick: 0,
    order: -1,
    bytes: [cc, 101, 0, 0, cc, 100, 3, 0, cc, 6, program, 0, cc, 101, 127],
  });
  events.push({ tick: 0, order: -1, bytes: [cc, 100, 127] });
  return events;
}

/** Encode a score as a format-1 Standard MIDI File. */
export function scoreToMidi(
  score: TrackScore,
  options: MidiOptions = {},
): Uint8Array {
  // Keep the division in range; scale ticks if a score ever exceeds it.
  const scale =
    score.ticksPerBeat > MAX_DIVISION ? MAX_DIVISION / score.ticksPerBeat : 1;
  const division = Math.round(score.ticksPerBeat * scale);
  const at = (tick: number) => Math.max(0, Math.round(tick * scale));
  const end = loopTicksOf(score);

  const conductor: TimedEvent[] = [];
  for (const segment of meterSegments(score)) {
    const clocks = Math.round(
      (clickTicksOf(segment, score.ticksPerBeat) / score.ticksPerBeat) * 24,
    );
    conductor.push({
      tick: at(segment.tick),
      order: 0,
      bytes: [
        0xff,
        0x58,
        4,
        segment.beatsPerBar,
        log2(segment.beatUnit),
        Math.min(255, Math.max(1, clocks)),
        8,
      ],
    });
  }
  for (const event of midiTempoEvents(score, options)) {
    const us = event.usPerQuarter;
    conductor.push({
      tick: at(event.tick),
      order: 1,
      bytes: [0xff, 0x51, 3, (us >>> 16) & 0xff, (us >>> 8) & 0xff, us & 0xff],
    });
  }
  for (const section of score.sections ?? []) {
    const tick = barStartTick(score, section.startBar);
    if (tick >= end) continue;
    const text = [...new TextEncoder().encode(section.name)].slice(0, 127);
    conductor.push({
      tick: at(tick),
      order: 2,
      bytes: [0xff, 0x06, ...varLen(text.length), ...text],
    });
  }
  const chunks: number[][] = [trackChunk(conductor, "dawg", at(end))];
  const programs = new Map<string, number>();
  const placed = performedNotes(score);
  const timing = performanceTimingFor(score);
  let melodic = 0;
  for (const track of score.tracks) {
    const drum = isDrumInstrument(track.instrument) || track.kit !== undefined;
    let channel: number;
    if (drum) channel = 9;
    else {
      channel = melodic % 15;
      if (channel >= 9) channel += 1;
      melodic += 1;
    }
    const events: TimedEvent[] = [];
    // The pedal is written as CC64, so notes are performed without it and
    // keep the key's length.
    const notes = performNotes(
      track.pedal ? { ...track, pedal: undefined } : track,
      placed.filter((note) => note.trackId === track.id),
      timing,
    );
    const table =
      score.tuning || track.tuning
        ? resolveTuning(score.tuning, track.tuning, score.key)
        : undefined;
    if (table && !drum) {
      const keys = mtsKeys(table);
      let program = programs.get(keys.join(","));
      if (program === undefined && programs.size < 128) {
        program = programs.size;
        programs.set(keys.join(","), program);
      }
      if (program !== undefined) {
        events.push(...tuningEvents(keys, program, channel));
      }
    }
    for (const event of track.pedal ?? []) {
      if (event.tick > end) continue;
      events.push({
        tick: at(event.tick),
        // After note-offs, before note-ons at the same tick.
        order: 0.5,
        bytes: [0xb0 | channel, 64, CC64[event.state]],
      });
    }
    for (const note of notes) {
      if (note.pitch < 0 || note.pitch > 127) continue;
      const start = at(note.startTick);
      const stop = Math.max(
        start + 1,
        at(Math.min(note.startTick + note.durationTicks, end)),
      );
      const velocity = Math.min(
        127,
        Math.max(1, Math.round(note.velocity * 127)),
      );
      events.push({
        tick: start,
        order: 1,
        bytes: [0x90 | channel, note.pitch, velocity],
      });
      // Note-offs sort before note-ons at the same tick so repeats retrigger.
      events.push({
        tick: stop,
        order: 0,
        bytes: [0x80 | channel, note.pitch, 0],
      });
    }
    chunks.push(trackChunk(events, track.name, at(end)));
  }

  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    1,
    (chunks.length >>> 8) & 0xff,
    chunks.length & 0xff,
    (division >>> 8) & 0xff,
    division & 0xff,
  ];
  const total = header.length + chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
