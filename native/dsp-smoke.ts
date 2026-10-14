/** Exact arithmetic qualification on the executing release target; no audio I/O. */
import { createHash } from "node:crypto";
import { probeNativeDSP } from "../src/audio/native-dsp.ts";
import { algorithmicReverbWet } from "../src/audio/effects/space.ts";

export function dspSmoke(path: string): void {
  const probe = probeNativeDSP({ env: { DAWG_SINK_LIB: path } });
  if (!probe.ok) throw new Error(`DSP unavailable: ${probe.reason}`);
  let cases = 0;
  const digest = (buffer: Float64Array) =>
    createHash("sha256").update(new Uint8Array(buffer.buffer)).digest("hex");
  try {
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const config of [
        { size: 0, mix: 0.3 },
        { size: 1, mix: 0.5 },
        {
          size: 0.4,
          mix: 0.3,
          fade: 1.2,
          dim: 3300,
          predelay: 0.07,
          lowpass: 4000,
        },
        {
          size: 0.8,
          mix: 0.5,
          fade: 0.1,
          dim: 100,
          predelay: 0.005,
          lowpass: 80,
        },
      ]) {
        const left = new Float64Array(rate * 2),
          right = new Float64Array(left.length);
        let seed = 42;
        for (let i = 0; i < rate; i += 1) {
          seed = Math.imul(seed, 1664525) + 1013904223;
          left[i] = ((seed >>> 0) / 2 ** 32 - 0.5) * 0.3;
          right[i] = Math.sin(i / 37) * 0.15;
        }
        let ran = false;
        const js = algorithmicReverbWet(left, right, config, rate, null);
        const native = algorithmicReverbWet(
          left,
          right,
          config,
          rate,
          (...args) => {
            ran = probe.reverb(...args);
            return ran;
          },
        );
        if (
          !ran ||
          digest(js.left) !== digest(native.left) ||
          digest(js.right) !== digest(native.right)
        )
          throw new Error(
            `native reverb differs from JS at ${rate} Hz: ${JSON.stringify(config)}`,
          );
        cases += 1;
      }
    }
    console.log(
      `DSP parity: ${cases} exact stereo fixtures · ${process.platform}-${process.arch}`,
    );
  } finally {
    probe.close();
  }
}
if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun native/dsp-smoke.ts <library>");
  dspSmoke(path);
}
