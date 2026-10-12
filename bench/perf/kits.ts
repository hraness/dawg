/** `bun bench/perf/kits.ts`: exact hi-hat samples with/without shared oscillators. */
import { synthKit } from "../../core/kits.ts";
import {
  kitDrumSample,
  kitHatWave,
  newKitVoiceState,
} from "../../src/audio/kits.ts";
import { metric, table, type Metric } from "./stats.ts";

export function hatSamples(repeats = 9): Metric[] {
  const sampleRate = 22_050;
  const kit = synthKit("synlinn")!;
  const count = Math.ceil(kit.seconds * sampleRate);
  const before: number[] = [];
  const after: number[] = [];
  let reference: number | undefined;
  for (let trial = 0; trial < repeats; trial += 1) {
    // Alternate order to reduce warmup and host-load bias. The first cached
    // trial includes filling the waveform; later trials reuse its exact sum.
    for (const cached of trial % 2 ? [true, false] : [false, true]) {
      const started = performance.now();
      const wave = cached ? kitHatWave(sampleRate, true, count) : undefined;
      let sum = 0;
      for (let hit = 0; hit < 64; hit += 1) {
        const state = newKitVoiceState();
        for (let index = 0; index < count; index += 1)
          sum += kitDrumSample(
            kit,
            "hat",
            index / sampleRate,
            0.2,
            -0.1,
            state,
            sampleRate,
            { tomRatio: 1 },
            wave?.[index],
          );
      }
      (cached ? after : before).push(performance.now() - started);
      reference ??= sum;
      if (sum !== reference) throw new Error("hi-hat samples changed");
    }
  }
  return [
    metric(
      "hat.oscillator.before",
      "64 Linn hats, repeated oscillators",
      before,
    ),
    metric("hat.oscillator.after", "64 Linn hats, shared oscillators", after),
  ];
}

if (import.meta.main) console.log(table(hatSamples()));
