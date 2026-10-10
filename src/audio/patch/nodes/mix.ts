/** Mix kernels: vca, mix, xfade, pan, plus the compiler's pass and macro nodes. */
import { at, BLOCK, type Frame, put } from "./frame.ts";

/** vca: in (audio), gain (sampled) → out. */
export function vca(f: Frame, n: number): void {
  const m = f.m;
  const x = at(f, n, 0);
  const g = at(f, n, 1);
  const o = at(f, n, 2);
  for (let i = 0; i < BLOCK; i += 1) m[o + i] = m[x + i]! * m[g + i]!;
}

/** mix: a, b, c, d (audio), la..ld (smooth) → out. */
export function mix(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const a = at(f, n, 0);
  const b = at(f, n, 1);
  const cc = at(f, n, 2);
  const d = at(f, n, 3);
  const o = at(f, n, 8);
  const pa = f.prev[c + 4]!;
  const pb = f.prev[c + 5]!;
  const pc = f.prev[c + 6]!;
  const pd = f.prev[c + 7]!;
  const da = (f.ctl[c + 4]! - pa) / BLOCK;
  const db = (f.ctl[c + 5]! - pb) / BLOCK;
  const dc = (f.ctl[c + 6]! - pc) / BLOCK;
  const dd = (f.ctl[c + 7]! - pd) / BLOCK;
  for (let i = 0; i < BLOCK; i += 1) {
    const r = i + 1;
    m[o + i] =
      m[a + i]! * (pa + da * r) +
      m[b + i]! * (pb + db * r) +
      m[cc + i]! * (pc + dc * r) +
      m[d + i]! * (pd + dd * r);
  }
}

/** xfade: a, b (audio), x (smooth) → out (equal gain). */
export function xfade(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const a = at(f, n, 0);
  const b = at(f, n, 1);
  const o = at(f, n, 3);
  const x0 = f.prev[c + 2]!;
  const dx = (f.ctl[c + 2]! - x0) / BLOCK;
  for (let i = 0; i < BLOCK; i += 1) {
    const x = x0 + dx * (i + 1);
    m[o + i] = m[a + i]! * (1 - x) + m[b + i]! * x;
  }
}

/** pan: in (audio), pan (smooth) → left, right (equal power). */
export function pan(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const x = at(f, n, 0);
  const l = at(f, n, 2);
  const r = at(f, n, 3);
  const t0 = ((f.prev[c + 1]! + 1) * Math.PI) / 4;
  const t1 = ((f.ctl[c + 1]! + 1) * Math.PI) / 4;
  const l0 = Math.cos(t0);
  const r0 = Math.sin(t0);
  const dl = (Math.cos(t1) - l0) / BLOCK;
  const dr = (Math.sin(t1) - r0) / BLOCK;
  for (let i = 0; i < BLOCK; i += 1) {
    const v = m[x + i]!;
    m[l + i] = v * (l0 + dl * (i + 1));
    m[r + i] = v * (r0 + dr * (i + 1));
  }
}

/** pass (voicesum, a nested patch's boundary): each input k copies to output k. */
export function pass(f: Frame, n: number): void {
  const m = f.m;
  const count = f.nIn[n]!;
  for (let k = 0; k < count; k += 1) {
    const x = at(f, n, k);
    const o = at(f, n, count + k);
    if (x !== o) m.copyWithin(o, x, x + BLOCK);
  }
}

/** macro (a nested patch's knob): its control value → out. */
export function macro(f: Frame, n: number): void {
  const o = at(f, n, 1);
  put(f.m, f.ctl[f.ctlBase[n]!]!, o);
}
