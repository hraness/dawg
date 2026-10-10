/** Math and logic kernels; every input is sampled, so envelopes stay smooth. */
import { at, BLOCK, type Frame, put } from "./frame.ts";

export const enum Binary {
  Add,
  Mul,
  Min,
  Max,
  Gt,
  Lt,
}

export const enum Unary {
  Abs,
  Not,
  Pitch2Hz,
  Db2Gain,
}

/** const: setting value → out. */
export function constant(f: Frame, n: number): void {
  const o = at(f, n, 0);
  put(f.m, f.ctl[f.ctlBase[n]!]!, o);
}

/** add, mul, min, max, gt, lt: a, b → out. */
export function binary(f: Frame, n: number, op: Binary): void {
  const m = f.m;
  const a = at(f, n, 0);
  const b = at(f, n, 1);
  const o = at(f, n, 2);
  switch (op) {
    case Binary.Add:
      for (let i = 0; i < BLOCK; i += 1) m[o + i] = m[a + i]! + m[b + i]!;
      break;
    case Binary.Mul:
      for (let i = 0; i < BLOCK; i += 1) m[o + i] = m[a + i]! * m[b + i]!;
      break;
    case Binary.Min:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = Math.min(m[a + i]!, m[b + i]!);
      break;
    case Binary.Max:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = Math.max(m[a + i]!, m[b + i]!);
      break;
    case Binary.Gt:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = m[a + i]! > m[b + i]! ? 1 : 0;
      break;
    default:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = m[a + i]! < m[b + i]! ? 1 : 0;
  }
}

/** abs, not, pitch2hz, db2gain: in → out. */
export function unary(f: Frame, n: number, op: Unary): void {
  const m = f.m;
  const x = at(f, n, 0);
  const o = at(f, n, 1);
  switch (op) {
    case Unary.Abs:
      for (let i = 0; i < BLOCK; i += 1) m[o + i] = Math.abs(m[x + i]!);
      break;
    case Unary.Not:
      for (let i = 0; i < BLOCK; i += 1) m[o + i] = m[x + i]! < 0.5 ? 1 : 0;
      break;
    case Unary.Pitch2Hz:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = 440 * Math.pow(2, (m[x + i]! - 69) / 12);
      break;
    default:
      for (let i = 0; i < BLOCK; i += 1)
        m[o + i] = Math.pow(10, m[x + i]! / 20);
  }
}

/** scale: in, inmin, inmax, min, max → out; mode lin|exp (exp needs min > 0). */
export function scale(f: Frame, n: number): void {
  const m = f.m;
  const x = at(f, n, 0);
  const i0 = at(f, n, 1);
  const i1 = at(f, n, 2);
  const lo = at(f, n, 3);
  const hi = at(f, n, 4);
  const o = at(f, n, 5);
  const exp = f.mode[n]! === 1;
  for (let i = 0; i < BLOCK; i += 1) {
    const span = m[i1 + i]! - m[i0 + i]!;
    const t = span === 0 ? 0 : (m[x + i]! - m[i0 + i]!) / span;
    const a = m[lo + i]!;
    const b = m[hi + i]!;
    m[o + i] = exp && a > 0 && b > 0 ? a * Math.pow(b / a, t) : a + (b - a) * t;
  }
}

/** clamp: in, min, max → out. */
export function clamp(f: Frame, n: number): void {
  const m = f.m;
  const x = at(f, n, 0);
  const lo = at(f, n, 1);
  const hi = at(f, n, 2);
  const o = at(f, n, 3);
  for (let i = 0; i < BLOCK; i += 1)
    m[o + i] = Math.min(Math.max(m[x + i]!, m[lo + i]!), m[hi + i]!);
}
