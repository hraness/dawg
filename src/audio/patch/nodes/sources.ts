/** Source kernels: `osc` (PolyBLEP saw, square, pulse; sine; triangle) and `noise`. */
import { at, BLOCK, draw, type Frame } from "./frame.ts";

const TAU = 2 * Math.PI;

function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Phase increment from Hz, clamped to half a cycle per sample. */
function step(hz: number, ratio: number): number {
  const dt = hz * ratio;
  return dt > 0.5 ? 0.5 : dt < -0.5 ? -0.5 : dt;
}

function wrap(ph: number): number {
  return ph >= 1 ? ph - 1 : ph < 0 ? ph + 1 : ph;
}

/** osc: pitch (sampled), detune, pw (smooth), fm (audio), level (smooth) → out. */
export function osc(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const pitch = at(f, n, 0);
  const fm = at(f, n, 3);
  const o = at(f, n, 5);
  const ratio = Math.pow(2, f.ctl[c + 1]! / 1200) / f.sampleRate;
  const pw0 = f.prev[c + 2]!;
  const dpw = (f.ctl[c + 2]! - pw0) / BLOCK;
  const lv0 = f.prev[c + 4]!;
  const dlv = (f.ctl[c + 4]! - lv0) / BLOCK;
  const wave = f.mode[n]!;
  let ph = f.st[s]!;
  // One loop per wave, so the per-sample body never branches on the wave.
  if (wave === 0)
    for (let i = 0; i < BLOCK; i += 1) {
      const dt = step(m[pitch + i]! + m[fm + i]!, ratio);
      m[o + i] = Math.sin(TAU * ph) * (lv0 + dlv * (i + 1));
      ph = wrap(ph + dt);
    }
  else if (wave === 1)
    for (let i = 0; i < BLOCK; i += 1) {
      const dt = step(m[pitch + i]! + m[fm + i]!, ratio);
      const adt = dt < 0 ? -dt : dt;
      m[o + i] = (2 * ph - 1 - blep(ph, adt)) * (lv0 + dlv * (i + 1));
      ph = wrap(ph + dt);
    }
  else if (wave === 3)
    for (let i = 0; i < BLOCK; i += 1) {
      const dt = step(m[pitch + i]! + m[fm + i]!, ratio);
      m[o + i] = (1 - 4 * Math.abs(ph - 0.5)) * (lv0 + dlv * (i + 1));
      ph = wrap(ph + dt);
    }
  else {
    // square is a pulse at width 0.5.
    const square = wave === 2;
    for (let i = 0; i < BLOCK; i += 1) {
      const dt = step(m[pitch + i]! + m[fm + i]!, ratio);
      const adt = dt < 0 ? -dt : dt;
      const pw = square ? 0.5 : pw0 + dpw * (i + 1);
      const h = ph + 1 - pw >= 1 ? ph - pw : ph + 1 - pw;
      const v = (ph < pw ? 1 : -1) + blep(ph, adt) - blep(h, adt);
      m[o + i] = v * (lv0 + dlv * (i + 1));
      ph = wrap(ph + dt);
    }
  }
  f.st[s] = ph;
}

/** noise: level (smooth) → out. State: generator, then seven pink poles. */
export function noise(f: Frame, n: number): void {
  const m = f.m;
  const st = f.st;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const o = at(f, n, 1);
  const lv0 = f.prev[c]!;
  const dlv = (f.ctl[c]! - lv0) / BLOCK;
  const color = f.mode[n]!;
  for (let i = 0; i < BLOCK; i += 1) {
    const w = draw(st, s) * 2 - 1;
    let v: number;
    if (color === 1) {
      // Paul Kellet's pink filter.
      st[s + 1] = 0.99886 * st[s + 1]! + w * 0.0555179;
      st[s + 2] = 0.99332 * st[s + 2]! + w * 0.0750759;
      st[s + 3] = 0.969 * st[s + 3]! + w * 0.153852;
      st[s + 4] = 0.8665 * st[s + 4]! + w * 0.3104856;
      st[s + 5] = 0.55 * st[s + 5]! + w * 0.5329522;
      st[s + 6] = -0.7616 * st[s + 6]! - w * 0.016898;
      v =
        (st[s + 1]! +
          st[s + 2]! +
          st[s + 3]! +
          st[s + 4]! +
          st[s + 5]! +
          st[s + 6]! +
          st[s + 7]! +
          w * 0.5362) *
        0.11;
      st[s + 7] = w * 0.115926;
    } else if (color === 2) {
      const y = (st[s + 1]! + 0.02 * w) / 1.02;
      st[s + 1] = y;
      v = y * 3.5;
    } else v = w;
    m[o + i] = v * (lv0 + dlv * (i + 1));
  }
}
