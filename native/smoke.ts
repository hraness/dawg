/**
 * Headless smoke test for a built native sink library, run by CI on every
 * platform it can execute: open the null device through bun:ffi, write a
 * second of a known signal, and check it drains in real time with exact
 * stats; then capture from the null input. Usage: bun native/smoke.ts <lib>
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

const path = process.argv[2];
if (!path) throw new Error("usage: bun native/smoke.ts <library>");
const lib = dlopen(path, {
  dawg_sink_abi_version: { args: [], returns: FFIType.u32 },
  dawg_sink_clock_ns: { args: [], returns: FFIType.u64 },
  dawg_sink_open: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  dawg_capture_open: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  dawg_sink_write: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
  dawg_capture_read: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
  dawg_sink_stats: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  dawg_sink_close: { args: [FFIType.ptr], returns: FFIType.void },
});
const sink = lib.symbols;
const check = (ok: boolean, what: string): void => {
  if (!ok) {
    console.error(`smoke: FAIL ${what}`);
    process.exit(1);
  }
};

check(sink.dawg_sink_abi_version() === 1, "abi version 1");
const rate = 22_050;
const name = Buffer.from("null\0");
const out = sink.dawg_sink_open(ptr(name), rate, 2, 128, rate * 2);
check(out !== null, "open null output");
const signal = new Float32Array(Math.floor(rate / 4) * 2);
for (let index = 0; index < signal.length; index += 1)
  signal[index] = Math.sin(index / 7) * 0.5;
const accepted = Number(sink.dawg_sink_write(out, ptr(signal), signal.length));
check(accepted === signal.length, `write accepted ${accepted}`);
const stats = new BigUint64Array(12);
await Bun.sleep(120);
sink.dawg_sink_stats(out, ptr(stats));
const stat = (index: number): number => Number(stats[index] ?? 0n);
const [queued, played, latencyNs, callbackNs, edgeNs] = [0, 1, 3, 4, 5].map(
  stat,
) as [number, number, number, number, number];
check(
  queued + played === signal.length / 2,
  `queued+played ${queued + played}`,
);
check(played > rate * 0.05 && played < rate * 0.25, `played ${played}`);
check(Number(stats[2]) === 0, "no underrun while fed");
check(latencyNs > 0 && edgeNs >= callbackNs, "timestamps");
check(
  Number(sink.dawg_sink_clock_ns()) >= callbackNs,
  "clock is monotonic past the callback",
);
await Bun.sleep(250);
sink.dawg_sink_stats(out, ptr(stats));
check(Number(stats[0]) === 0, "drained");
check(Number(stats[2]) === 1, "one underrun when the signal ends");
sink.dawg_sink_close(out);

const input = sink.dawg_capture_open(ptr(name), rate, 1, 64, rate);
check(input !== null, "open null input");
await Bun.sleep(50);
const captured = new Float32Array(rate);
const read = Number(sink.dawg_capture_read(input, ptr(captured), rate));
check(read > 0, `captured ${read}`);
sink.dawg_sink_close(input);
console.log(`smoke: ok · played ${played} frames · captured ${read}`);
