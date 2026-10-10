/** Filter kernels: the TPT state-variable filter and a TPT one-pole. */
import { at, BLOCK, flush, type Frame } from "./frame.ts";

function warp(cutoff: number, sampleRate: number): number {
  const fc = Math.min(Math.max(cutoff, 1), 0.49 * sampleRate);
  return Math.tan((Math.PI * fc) / sampleRate);
}

/** Damping from resonance 0..1 (0: 2, a gentle Butterworth-like slope). */
function damping(q: number): number {
  return 2 - 1.94 * q;
}

/** svf: in (audio), cutoff (smooth), q (smooth) → out; mode lp|hp|bp|notch. */
export function svf(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const x = at(f, n, 0);
  const o = at(f, n, 3);
  const mode = f.mode[n]!;
  const g0 = warp(f.prev[c + 1]!, f.sampleRate);
  const g1 = warp(f.ctl[c + 1]!, f.sampleRate);
  const k0 = damping(f.prev[c + 2]!);
  const k1 = damping(f.ctl[c + 2]!);
  const dg = (g1 - g0) / BLOCK;
  const dk = (k1 - k0) / BLOCK;
  const still = dg === 0 && dk === 0;
  let ic1 = f.st[s]!;
  let ic2 = f.st[s + 1]!;
  let g = g1;
  let k = k1;
  let a1 = 1 / (1 + g * (g + k));
  let a2 = g * a1;
  let a3 = g * a2;
  for (let i = 0; i < BLOCK; i += 1) {
    if (!still) {
      g = g0 + dg * (i + 1);
      k = k0 + dk * (i + 1);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const input = m[x + i]!;
    const v3 = input - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    m[o + i] =
      mode === 0
        ? v2
        : mode === 1
          ? input - k * v1 - v2
          : mode === 2
            ? v1
            : input - k * v1;
  }
  f.st[s] = flush(ic1);
  f.st[s + 1] = flush(ic2);
}

/** onepole: in (audio), cutoff (smooth) → out; mode lp|hp. */
export function onepole(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const x = at(f, n, 0);
  const o = at(f, n, 2);
  const hp = f.mode[n]! === 1;
  const g0 = warp(f.prev[c + 1]!, f.sampleRate);
  const g1 = warp(f.ctl[c + 1]!, f.sampleRate);
  const dg = (g1 - g0) / BLOCK;
  let z = f.st[s]!;
  for (let i = 0; i < BLOCK; i += 1) {
    const g = dg === 0 ? g1 : g0 + dg * (i + 1);
    const input = m[x + i]!;
    const v = ((input - z) * g) / (1 + g);
    const lp = v + z;
    z = lp + v;
    m[o + i] = hp ? input - lp : lp;
  }
  f.st[s] = flush(z);
}
