/**
 * First-order antiderivative antialiasing (ADAA; Parker et al. DAFx-16,
 * Bilbao et al. IEEE SPL 2017): y = (F(x) - F(x1)) / (x - x1) for a shaper
 * f with antiderivative F, falling back to f at the midpoint when the step
 * is tiny. Stateful: one instance per signal path.
 */

/** log(cosh(x)) without overflow: the antiderivative of tanh. */
export function logCosh(x: number): number {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/** Hard clip to [-1, 1]. */
export function hardclip(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/** Antiderivative of `hardclip`, continuous at ±1. */
export function hardclipF(x: number): number {
  return Math.abs(x) <= 1 ? 0.5 * x * x : Math.abs(x) - 0.5;
}

/**
 * Asymmetric soft clip: tanh(x + bias) - tanh(bias). Even harmonics come
 * from the offset; the subtraction keeps silence at zero.
 */
export function asym(x: number, bias = 0.3): number {
  return Math.tanh(x + bias) - Math.tanh(bias);
}

/** Antiderivative of `asym`. */
export function asymF(x: number, bias = 0.3): number {
  return logCosh(x + bias) - x * Math.tanh(bias);
}

/** Generic first-order ADAA around a shaper and its antiderivative. */
export class Adaa1 {
  x1 = 0;
  F1: number;

  constructor(
    readonly f: (x: number) => number,
    readonly F: (x: number) => number,
  ) {
    this.F1 = F(0);
  }

  process(x: number): number {
    const Fx = this.F(x);
    const dx = x - this.x1;
    const y =
      Math.abs(dx) < 1e-5 ? this.f(0.5 * (x + this.x1)) : (Fx - this.F1) / dx;
    this.x1 = x;
    this.F1 = Fx;
    return y;
  }

  reset(): void {
    this.x1 = 0;
    this.F1 = this.F(0);
  }
}

/** ADAA tanh. */
export function adaaTanh(): Adaa1 {
  return new Adaa1(Math.tanh, logCosh);
}

/** ADAA hard clip. */
export function adaaHardclip(): Adaa1 {
  return new Adaa1(hardclip, hardclipF);
}

/** ADAA asymmetric soft clip with a fixed bias. */
export function adaaAsym(bias = 0.3): Adaa1 {
  return new Adaa1(
    (x) => asym(x, bias),
    (x) => asymF(x, bias),
  );
}
