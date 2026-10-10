/** Modulator kernels: lfo, sh (sample and hold), random and clock. */
import { at, BLOCK, draw, type Frame, put } from "./frame.ts";

const TAU = 2 * Math.PI;

/**
 * lfo: rate, phase, depth (+ setting sync in beats) → out -1..1.
 * Shapes follow effects/common.ts `lfo`. State: phase, held random value,
 * generator, started flag.
 */
export function lfo(f: Frame, n: number): void {
  const m = f.m;
  const st = f.st;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const o = at(f, n, 3);
  const offset = f.ctl[c + 1]!;
  const depth = f.ctl[c + 2]!;
  const sync = f.ctl[c + 3]!;
  const inc = (sync > 0 ? f.bps / sync : f.ctl[c]!) / f.sampleRate;
  const shape = f.mode[n]!;
  if (st[s + 3]! === 0) {
    st[s + 1] = draw(st, s + 2) * 2 - 1;
    st[s + 3] = 1;
  }
  let ph = st[s]!;
  for (let i = 0; i < BLOCK; i += 1) {
    let cyc = ph + offset;
    if (cyc >= 1) cyc -= 1;
    let v: number;
    switch (shape) {
      case 0:
        v = Math.sin(TAU * cyc);
        break;
      case 1:
        v = 1 - 4 * Math.abs(cyc - 0.5);
        break;
      case 2:
        v = cyc < 0.5 ? 1 : -1;
        break;
      case 3:
        v = 1 - 2 * cyc;
        break;
      case 4:
        v = 2 * cyc - 1;
        break;
      default:
        v = st[s + 1]!;
    }
    m[o + i] = v * depth;
    ph += inc;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      if (shape === 5) st[s + 1] = draw(st, s + 2) * 2 - 1;
    }
  }
  st[s] = ph;
}

/** sh: in (sampled), trig (sampled) → out. State: held, last trigger. */
export function sh(f: Frame, n: number): void {
  const m = f.m;
  const s = f.stBase[n]!;
  const x = at(f, n, 0);
  const trig = at(f, n, 1);
  const o = at(f, n, 2);
  let held = f.st[s]!;
  let last = f.st[s + 1]!;
  for (let i = 0; i < BLOCK; i += 1) {
    const t = m[trig + i]!;
    if (t > 0.5 && last <= 0.5) held = m[x + i]!;
    last = t;
    m[o + i] = held;
  }
  f.st[s] = held;
  f.st[s + 1] = last;
}

/** random: per note (drawn once) or per block → out 0..1. State: value, generator, flag. */
export function random(f: Frame, n: number): void {
  const st = f.st;
  const s = f.stBase[n]!;
  const o = at(f, n, 0);
  if (f.mode[n]! === 1 || st[s + 2]! === 0) {
    st[s] = draw(st, s + 1);
    st[s + 2] = 1;
  }
  put(f.m, st[s]!, o);
}

/** clock: width (+ setting beats) → out gate 0/1, from the song position. */
export function clock(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const o = at(f, n, 1);
  const width = f.ctl[c]!;
  const beats = f.ctl[c + 1]!;
  const b = f.beatSlot * f.stride + f.blk;
  for (let i = 0; i < BLOCK; i += 1) {
    const x = m[b + i]! / beats;
    m[o + i] = x - Math.floor(x) < width ? 1 : 0;
  }
}
