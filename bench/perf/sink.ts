/**
 * A stand-in audio player for DAWG_AUDIO_PLAYER (`sink.ts <log> {rate}`):
 * reads s16le stereo PCM from stdin like ffplay and appends one line per
 * silence/sound edge to <log>:
 *
 *   <arrival epoch ms> <scheduled epoch ms> on|off
 *
 * arrival is when the bytes reached the player; scheduled is when a device
 * would play them (the engine paces frame n at start + n / rate, and the
 * first chunk arrives at start), before the device's own output buffer.
 * Epoch ms is `performance.timeOrigin + performance.now()`, comparable
 * across processes.
 */
import { appendFileSync, writeFileSync } from "node:fs";

const log = process.argv[2];
const rate = Number(process.argv[3] ?? 44_100);
if (!log) throw new Error("usage: sink.ts <log> <rate>");
writeFileSync(log, "");
const epoch = () => performance.timeOrigin + performance.now();
let offset = 0;
let first: number | undefined;
let sounding = false;
let quietRun = 0;
/** About 46 ms of near-silence ends a sound. */
const QUIET_SAMPLES = Math.round(rate * 0.046) * 2;
let carry: Uint8Array | undefined;
for await (const chunk of Bun.stdin.stream()) {
  let bytes = chunk as Uint8Array;
  if (carry) {
    const joined = new Uint8Array(carry.length + bytes.length);
    joined.set(carry);
    joined.set(bytes, carry.length);
    bytes = joined;
    carry = undefined;
  }
  const usable = bytes.byteLength - (bytes.byteLength % 2);
  if (usable < bytes.byteLength) carry = bytes.slice(usable);
  const at = epoch();
  first ??= at;
  const view = new Int16Array(bytes.slice(0, usable).buffer);
  for (let i = 0; i < view.length; i += 1) {
    const loud = Math.abs(view[i]!) > 16;
    const sched = first + ((offset + i * 2) / (4 * rate)) * 1000;
    if (loud) {
      quietRun = 0;
      if (!sounding) {
        sounding = true;
        appendFileSync(log, `${at.toFixed(3)} ${sched.toFixed(3)} on\n`);
      }
    } else if (sounding && ++quietRun > QUIET_SAMPLES) {
      sounding = false;
      appendFileSync(log, `${at.toFixed(3)} ${sched.toFixed(3)} off\n`);
    }
  }
  offset += usable;
}
