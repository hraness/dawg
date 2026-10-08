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
 * Pure and dependency-free apart from the score modules.
 */
import { isDrumInstrument } from "./drums.ts";
import {
  clickTicksOf,
  loopTicksOf,
  meterSegments,
  performedNotes,
  timeMapFor,
  type TimeScore,
} from "./tempo.ts";
import type { TrackScore } from "./score.ts";

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
    points.add(fermata.tick + tpb);
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

function log2(value: number): number {
  return Math.round(Math.log2(value));
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
  const chunks: number[][] = [trackChunk(conductor, "dawg", at(end))];
  const notes = performedNotes(score);
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
    for (const note of notes) {
      if (note.trackId !== track.id) continue;
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
