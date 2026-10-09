/**
 * Loop filters for the string waveguides (ported from the 0.6 strings
 * prototype, proto/strings/dsp.ts): the two-decay loss filter and the
 * dispersion allpass fit. Pure functions; the delay interpolation comes from
 * the shared contract (src/audio/dsp/interp.ts).
 */
import { allpassDelay } from "../dsp/interp.ts";

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Phase delay (samples) of the one-pole low-pass 1/(1 - p z^-1) at w. */
export function onePoleDelay(p: number, w: number): number {
  if (w < 1e-9) return p / (1 - p);
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}

/**
 * Loop-loss filter g(1-p)/(1 - p z^-1) from two decay times (Valimaki et
 * al. 1996): the per-period gain at f0 gives T60 `t0`, at `fh` gives `th`.
 * The pole is capped at 0.95 and the gain at 0.99995, so the loop's DC gain
 * (g) stays below 1 and no setting can grow.
 */
export function designLoss(
  f0: number,
  t0: number,
  fh: number,
  th: number,
  sr: number,
): { g: number; p: number } {
  const w0 = (2 * Math.PI * f0) / sr;
  const wh = (2 * Math.PI * Math.min(fh, 0.45 * sr)) / sr;
  const g0 = 0.001 ** (1 / (t0 * f0));
  const gh = 0.001 ** (1 / (th * f0));
  const want = gh / g0;
  const ratio = (p: number) =>
    Math.sqrt(
      (1 - 2 * p * Math.cos(w0) + p * p) / (1 - 2 * p * Math.cos(wh) + p * p),
    );
  let lo = 0;
  let hi = 0.95;
  if (wh <= w0 || want >= 1) hi = 0;
  for (let i = 0; i < 50 && hi > 0; i += 1) {
    const mid = (lo + hi) / 2;
    if (ratio(mid) > want) lo = mid;
    else hi = mid;
  }
  // DC gain g must stay below 1, so cap the pole where the f0 gain would
  // need g > 0.99995: high keys keep their designed fundamental T60 and
  // give up some of the requested treble damping (design review: high
  // nylon and harp notes decayed several times too fast).
  const gFor = (q: number) =>
    (g0 * Math.sqrt(1 - 2 * q * Math.cos(w0) + q * q)) / (1 - q);
  let p = (lo + hi) / 2;
  if (gFor(p) > 0.99995) {
    let a = 0;
    let b = p;
    for (let i = 0; i < 50; i += 1) {
      const mid = (a + b) / 2;
      if (gFor(mid) > 0.99995) b = mid;
      else a = mid;
    }
    p = a;
  }
  const g = Math.min(0.99995, gFor(p));
  return { g, p };
}

/** Inharmonicity B for the `stiff` knob: 1e-6 x 400^stiff, 0 at 0. */
export function stiffnessB(stiff: number): number {
  return stiff > 0 ? 1e-6 * 400 ** stiff : 0;
}

/**
 * Dispersion allpass cascade (Van Duyne and Smith 1994): one shared
 * coefficient fitted by golden-section search so partial k lands at
 * k f1 sqrt((1 + B k^2) / (1 + B)).
 */
export function designDispersion(
  f1: number,
  B: number,
  sections: number,
  sr: number,
  maxDelay: number,
): number {
  if (!(B > 0) || sections === 0) return 0;
  const w1 = (2 * Math.PI * f1) / sr;
  const ks: number[] = [];
  for (let k = 2; k <= 16; k += 1) {
    const fk = k * f1 * Math.sqrt((1 + B * k * k) / (1 + B));
    if (fk > 0.42 * sr) break;
    ks.push(k);
  }
  if (ks.length === 0) return 0;
  const cost = (a: number): number => {
    if (sections * allpassDelay(a, w1) > maxDelay) return 1e9;
    let e = 0;
    for (const k of ks) {
      const fk = k * f1 * Math.sqrt((1 + B * k * k) / (1 + B));
      const wk = (2 * Math.PI * fk) / sr;
      const target = (2 * Math.PI * k) / wk - (2 * Math.PI) / w1;
      const got = sections * (allpassDelay(a, wk) - allpassDelay(a, w1));
      e += (got - target) ** 2;
    }
    return e;
  };
  let lo = -0.95;
  let hi = 0;
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  for (let i = 0; i < 60; i += 1) {
    if (cost(c) < cost(d)) hi = d;
    else lo = c;
    c = hi - gr * (hi - lo);
    d = lo + gr * (hi - lo);
  }
  return (lo + hi) / 2;
}
