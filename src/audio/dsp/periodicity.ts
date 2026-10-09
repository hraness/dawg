/**
 * Periodicity (0.7 vocoder): 0..1 per sample, the best normalised
 * autocorrelation over 2..20 ms lags (a YIN-style aperiodicity cue), on a
 * ~8 kHz block-averaged copy, 30 ms frames every 5 ms. The frame grid sits on
 * the absolute song sample (`origin` + index), so a render window and the
 * full render agree after pre-roll.
 */
const posMod = (a: number, m: number): number => ((a % m) + m) % m;

export function periodicityCurve(
  x: Float64Array,
  sampleRate: number,
  origin = 0,
): Float64Array {
  const dec = Math.max(1, Math.round(sampleRate / 8000));
  const dsr = sampleRate / dec;
  const hop = Math.round(0.005 * sampleRate);
  const win = Math.round(0.03 * dsr);
  const lagLo = Math.round(dsr / 500);
  const lagHi = Math.round(dsr / 50);
  const out = new Float64Array(x.length);
  const buf = new Float64Array(win + lagHi);
  for (let s = -posMod(origin, hop); s < x.length; s += hop) {
    for (let i = 0; i < buf.length; i += 1) {
      let acc = 0;
      for (let d = 0; d < dec; d += 1) {
        const j = s + i * dec + d;
        acc += j >= 0 && j < x.length ? x[j]! : 0;
      }
      buf[i] = acc / dec;
    }
    let e0 = 0;
    for (let i = 0; i < win; i += 1) e0 += buf[i]! * buf[i]!;
    let best = 0;
    if (e0 > 1e-12)
      for (let lag = lagLo; lag <= lagHi; lag += 1) {
        let c = 0;
        let el = 0;
        for (let i = 0; i < win; i += 1) {
          c += buf[i]! * buf[i + lag]!;
          el += buf[i + lag]! * buf[i + lag]!;
        }
        const r = c / Math.sqrt(e0 * el + 1e-20);
        if (r > best) best = r;
      }
    // The value labels the frame's middle hop.
    const a = s + Math.round((win * dec) / 2) - (hop >> 1);
    for (let i = Math.max(0, a); i < Math.min(x.length, a + hop); i += 1)
      out[i] = best;
  }
  let first = 0;
  for (let i = 0; i < out.length; i += 1)
    if (out[i] !== 0) {
      first = out[i]!;
      break;
    }
  for (let i = 0; i < out.length && out[i] === 0; i += 1) out[i] = first;
  return out;
}
