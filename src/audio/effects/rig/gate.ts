/**
 * Noise gate before the amp (`fx.head.gate`): a peak follower with
 * hysteresis (opens at the threshold, closes 6 dB below it), a 50 ms hold,
 * 1 ms attack and 80 ms release, so a high-gain head does not amplify the
 * hiss and string noise between notes.
 */
export const GATE_HYSTERESIS_DB = 6;

export function applyGate(
  buffer: Float64Array,
  thresholdDb: number,
  sampleRate: number,
): void {
  const open = 10 ** (thresholdDb / 20);
  const close = 10 ** ((thresholdDb - GATE_HYSTERESIS_DB) / 20);
  const peakRelease = Math.exp(-1 / (0.01 * sampleRate));
  const attack = 1 - Math.exp(-1 / (0.001 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.08 * sampleRate));
  const holdSamples = Math.round(0.05 * sampleRate);
  let peak = 0;
  let gain = 0;
  let isOpen = false;
  let hold = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const x = buffer[i]!;
    const level = Math.abs(x);
    peak = level > peak ? level : peak * peakRelease;
    if (peak >= open) {
      isOpen = true;
      hold = holdSamples;
    } else if (peak < close) {
      if (hold > 0) hold -= 1;
      else isOpen = false;
    }
    const target = isOpen ? 1 : 0;
    gain += (target - gain) * (target > gain ? attack : release);
    buffer[i] = x * gain;
  }
}
