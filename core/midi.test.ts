import { describe, expect, test } from "bun:test";
import { midiTempoEvents, mtsKeys, scoreToMidi } from "./midi.ts";
import { resolveTuning } from "./tuning.ts";
import { createScore } from "./score.ts";
import { secondsAtTick } from "./tempo.ts";

type Event = { tick: number; status: number; data: number[] };

/** A minimal SMF reader: header fields and absolute-tick events per track. */
function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  expect(text(0)).toBe("MThd");
  const format = view.getUint16(8);
  const count = view.getUint16(10);
  const division = view.getUint16(12);
  let offset = 14;
  const tracks: Event[][] = [];
  for (let index = 0; index < count; index += 1) {
    expect(text(offset)).toBe("MTrk");
    const length = view.getUint32(offset + 4);
    let at = offset + 8;
    const end = at + length;
    let tick = 0;
    const events: Event[] = [];
    const varLen = () => {
      let value = 0;
      for (;;) {
        const byte = bytes[at++]!;
        value = (value << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) return value;
      }
    };
    while (at < end) {
      tick += varLen();
      const status = bytes[at++]!;
      if (status === 0xff) {
        const type = bytes[at++]!;
        const size = varLen();
        events.push({
          tick,
          status: 0xff00 | type,
          data: [...bytes.slice(at, at + size)],
        });
        at += size;
      } else {
        events.push({ tick, status, data: [bytes[at]!, bytes[at + 1]!] });
        at += 2;
      }
    }
    tracks.push(events);
    offset = end;
  }
  return { format, division, tracks };
}

const usOf = (data: number[]) => (data[0]! << 16) | (data[1]! << 8) | data[2]!;

describe("MIDI export", () => {
  const piano = {
    id: "p",
    name: "piano",
    instrument: "piano",
  };

  test("a constant score writes one tempo, one meter and its notes", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [piano, { id: "d", name: "drums", instrument: "drums" }],
      notes: [
        {
          id: "a",
          trackId: "p",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 1,
        },
        {
          id: "b",
          trackId: "d",
          startTick: 960,
          durationTicks: 120,
          pitch: 36,
          velocity: 0.5,
        },
      ],
    });
    const midi = readMidi(scoreToMidi(score));
    expect(midi.format).toBe(1);
    expect(midi.division).toBe(score.ticksPerBeat);
    expect(midi.tracks.length).toBe(3);
    const conductor = midi.tracks[0]!;
    const tempos = conductor.filter((e) => e.status === 0xff51);
    expect(tempos.map((e) => usOf(e.data))).toEqual([500_000]);
    const meters = conductor.filter((e) => e.status === 0xff58);
    expect(meters).toEqual([{ tick: 0, status: 0xff58, data: [4, 2, 24, 8] }]);
    const end = conductor.at(-1)!;
    expect(end.status).toBe(0xff2f);
    expect(end.tick).toBe(4 * 480);
    const pianoNotes = midi.tracks[1]!.filter((e) => e.status < 0xff00);
    expect(pianoNotes).toEqual([
      { tick: 0, status: 0x90, data: [60, 127] },
      { tick: 480, status: 0x80, data: [60, 0] },
    ]);
    const drumOn = midi.tracks[2]!.find((e) => (e.status & 0xf0) === 0x90)!;
    expect(drumOn.status & 0x0f).toBe(9);
    expect(drumOn.data).toEqual([36, 64]);
  });

  test("meter changes, ramps and fermatas reach the conductor track", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 4,
      time: {
        tempo: [{ tick: 1920, bpm: 60, ramp: "linear" }],
        meter: [{ bar: 2, beatsPerBar: 6, beatUnit: 8 }],
        fermatas: [{ tick: 3840, beats: 1 }],
      },
    });
    const conductor = readMidi(scoreToMidi(score)).tracks[0]!;
    const meters = conductor.filter((e) => e.status === 0xff58);
    expect(meters.map((e) => [e.tick, ...e.data])).toEqual([
      [0, 4, 2, 24, 8],
      [3840, 6, 3, 36, 8],
    ]);
    const tempos = midiTempoEvents(score);
    // Ramp steps slow down monotonically.
    const ramp = tempos.filter((e) => e.tick < 1920);
    expect(ramp.length).toBe(16);
    for (let i = 1; i < ramp.length; i += 1)
      expect(ramp[i]!.usPerQuarter).toBeGreaterThan(ramp[i - 1]!.usPerQuarter);
    // Every boundary keeps the rendered timeline: summed MIDI time matches.
    let seconds = 0;
    for (let i = 0; i < tempos.length; i += 1) {
      const next = tempos[i + 1]?.tick ?? 4800;
      seconds +=
        ((next - tempos[i]!.tick) / 480) * (tempos[i]!.usPerQuarter / 1e6);
      expect(seconds).toBeCloseTo(secondsAtTick(score, next), 4);
    }
    // The fermata's beat in 6/8 is the dotted quarter: it plays twice as
    // long, then the tempo returns.
    const at = (tick: number) =>
      [...tempos].reverse().find((e) => e.tick <= tick)!.usPerQuarter;
    expect(at(3840)).toBe(2_000_000);
    expect(at(4320)).toBe(2_000_000);
    expect(at(4560)).toBe(1_000_000);
  });

  test("a fermata beat lands subdivisions at the same seconds as the WAV", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      time: { fermatas: [{ tick: 0, beats: 2 }] },
    });
    const tempos = midiTempoEvents(score);
    const midiSeconds = (tick: number) => {
      let seconds = 0;
      for (let i = 0; i < tempos.length; i += 1) {
        const from = tempos[i]!.tick;
        const to = Math.min(tick, tempos[i + 1]?.tick ?? Infinity);
        if (to <= from) break;
        seconds += ((to - from) / 480) * (tempos[i]!.usPerQuarter / 1e6);
      }
      return seconds;
    };
    for (const tick of [60, 120, 240, 360, 480, 720, 1920])
      expect(midiSeconds(tick)).toBeCloseTo(secondsAtTick(score, tick), 6);
    expect(secondsAtTick(score, 120)).toBeCloseTo(0.375, 9);
  });

  test("track rate places repeats on the song timeline", () => {
    const score = createScore({
      bars: 1,
      tracks: [{ ...piano, time: { rate: 2, cycle: 960 } }],
      notes: [
        {
          id: "a",
          trackId: "p",
          startTick: 0,
          durationTicks: 480,
          pitch: 64,
          velocity: 0.8,
        },
      ],
    });
    const ons = readMidi(scoreToMidi(score))
      .tracks[1]!.filter((e) => e.status === 0x90)
      .map((e) => e.tick);
    expect(ons).toEqual([0, 480, 960, 1440]);
  });
});

describe("MIDI export of performance", () => {
  test("pedal writes CC64 and articulation shortens the note-off", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        {
          id: "p",
          name: "piano",
          instrument: "piano",
          pedal: [
            { tick: 0, state: "down" },
            { tick: 960, state: "half" },
            { tick: 1440, state: "up" },
          ],
        },
      ],
      notes: [
        {
          id: "a",
          trackId: "p",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.5,
          articulation: "staccato",
        },
        {
          id: "b",
          trackId: "p",
          startTick: 480,
          durationTicks: 480,
          pitch: 64,
          velocity: 0.5,
        },
      ],
    });
    const track = readMidi(scoreToMidi(score)).tracks[1]!;
    const cc = track.filter((e) => (e.status & 0xf0) === 0xb0);
    expect(cc.map((e) => [e.tick, ...e.data])).toEqual([
      [0, 64, 127],
      [960, 64, 64],
      [1440, 64, 0],
    ]);
    const offs = track.filter((e) => (e.status & 0xf0) === 0x80);
    // Staccato is shorter than the written 480; the pedal does not
    // lengthen the key (the second note ends where it was written).
    const offA = offs.find((e) => e.data[0] === 60)!;
    expect(offA.tick).toBeLessThan(480);
    expect(offs.find((e) => e.data[0] === 64)!.tick).toBe(960);
    // The CC64 down sorts before the note-on at tick 0.
    const first = track.findIndex((e) => (e.status & 0xf0) === 0xb0);
    const on = track.findIndex((e) => (e.status & 0xf0) === 0x90);
    expect(first).toBeLessThan(on);
  });
});

describe("MIDI export of tuning and sections", () => {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

  test("a 12-TET score without sections gains no events", () => {
    const score = createScore({
      tracks: [{ id: "a", name: "a", instrument: "sine" }],
    });
    expect(hex(scoreToMidi(score))).not.toContain("f07f7f0802");
    expect(hex(scoreToMidi(score))).not.toContain("ff06");
  });

  test("a tuned track carries MTS key frequencies and selects them", () => {
    const score = createScore({
      tuning: { name: "pelog", root: 60 },
      tracks: [{ id: "a", name: "polos", instrument: "sine" }],
    });
    const table = resolveTuning(score.tuning, undefined, score.key)!;
    const keys = mtsKeys(table);
    // Each key decodes back to its frequency within a hundredth of a cent.
    for (const key of [60, 61, 62, 63, 64]) {
      const [semi, msb, lsb] = keys[key]!;
      const value = semi! + ((msb! << 7) | lsb!) / 16384;
      const hz = 440 * 2 ** ((value - 69) / 12);
      expect(Math.abs(1200 * Math.log2(hz / table.hz[key]!))).toBeLessThan(
        0.01,
      );
    }
    const file = hex(scoreToMidi(score));
    expect(file).toContain("f08207" + "7f7f080200" + "40");
    // RPN 3 (tuning program select) = program 0 on channel 0.
    expect(file).toContain("b0650000b0640300b0060000b0657f");
  });

  test("sections are written as marker events", () => {
    const score = createScore({
      bars: 4,
      sections: [
        { name: "intro", startBar: 0, bars: 2 },
        { name: "drop", startBar: 2, bars: 2 },
      ],
      tracks: [{ id: "a", name: "a", instrument: "sine" }],
    });
    const file = hex(scoreToMidi(score));
    expect(file).toContain("ff0605" + Buffer.from("intro").toString("hex"));
    expect(file).toContain("ff0604" + Buffer.from("drop").toString("hex"));
  });
});
