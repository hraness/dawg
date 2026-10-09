/**
 * Test-only measurement helpers for the sing engine (formant.md section 9;
 * never on the render path): a YIN f0 tracker (the pitch lane's
 * src/audio/dsp/pitch.ts replaces it once merged), harmonic levels, the
 * alias-to-harmonic power ratio and harmonic-peak formant fits. Ported from
 * the reviewed prototype (proto/formant/analysis.ts, review.ts).
 */
import { fftInPlace } from "../dsp/fft.ts";
import { hann } from "../dsp/stft.ts";

/**
 * YIN (de Cheveigne and Kawahara 2002) with an FFT difference function,
 * CMNDF threshold, parabolic refinement. Returns f0 per hop (0 unvoiced).
 */
export function yin(
  x: Float64Array,
  sampleRate: number,
  hop: number,
  minHz = 60,
  maxHz = 1000,
  threshold = 0.12,
): Float64Array {
  const tauMax = Math.ceil(sampleRate / minHz);
  const tauMin = Math.floor(sampleRate / maxHz);
  const w = tauMax; // integration window
  let n = 1;
  while (n < w + tauMax) n <<= 1;
  const frames = Math.floor(x.length / hop);
  const result = new Float64Array(frames);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const re2 = new Float64Array(n);
  const im2 = new Float64Array(n);
  const d = new Float64Array(tauMax + 1);
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop - Math.floor(w / 2);
    // r(tau) = sum_{j<w} x[j] x[j+tau]: correlate window (len w) with segment (len w+tauMax)
    re.fill(0);
    im.fill(0);
    re2.fill(0);
    im2.fill(0);
    let energy0 = 0;
    for (let j = 0; j < w + tauMax; j += 1) {
      const k = start + j;
      const v = k >= 0 && k < x.length ? x[k]! : 0;
      re2[j] = v;
      if (j < w) {
        re[j] = v;
        energy0 += v * v;
      }
    }
    if (energy0 < 1e-7) continue;
    fftInPlace(re, im);
    fftInPlace(re2, im2);
    for (let k = 0; k < n; k += 1) {
      // conj(A) * B
      const a = re[k]!;
      const b = -im[k]!;
      const c = re2[k]!;
      const e = im2[k]!;
      re[k] = a * c - b * e;
      im[k] = a * e + b * c;
    }
    fftInPlace(re, im, true);
    // running energy of x[start+tau .. start+tau+w)
    let et = energy0;
    d[0] = 0;
    let running = 0;
    let found = -1;
    const cm = new Float64Array(tauMax + 1);
    cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      const outIdx = start + tau - 1;
      const inIdx = start + tau - 1 + w;
      const vOut = outIdx >= 0 && outIdx < x.length ? x[outIdx]! : 0;
      const vIn = inIdx >= 0 && inIdx < x.length ? x[inIdx]! : 0;
      et += vIn * vIn - vOut * vOut;
      d[tau] = energy0 + et - (2 * re[tau]!) / n;
      running += d[tau]!;
      cm[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
    }
    for (let tau = tauMin; tau < tauMax; tau += 1) {
      if (cm[tau]! < threshold) {
        while (tau + 1 < tauMax && cm[tau + 1]! < cm[tau]!) tau += 1;
        found = tau;
        break;
      }
    }
    if (found < 0) continue;
    const a = cm[found - 1]!;
    const b = cm[found]!;
    const c = cm[found + 1]!;
    const den = a - 2 * b + c;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    result[f] = sampleRate / (found + Math.max(-1, Math.min(1, shift)));
  }
  return result;
}

/** dB magnitude of harmonics 1..count at `f0` from a Hann frame centred at `centre`. */
export function harmonicLevels(
  x: Float64Array,
  sampleRate: number,
  centre: number,
  f0: number,
  maxHz: number,
  n = 4096,
): number[] {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i += 1) {
    const j = centre - n / 2 + i;
    re[i] = j >= 0 && j < x.length ? x[j]! * w[i]! : 0;
  }
  fftInPlace(re, im);
  const levels: number[] = [];
  for (let h = 1; h * f0 < maxHz; h += 1) {
    const bin = (h * f0 * n) / sampleRate;
    let best = 0;
    for (let k = Math.floor(bin) - 2; k <= Math.ceil(bin) + 2; k += 1)
      best = Math.max(best, Math.hypot(re[k]!, im[k]!));
    levels.push(20 * Math.log10(best + 1e-12));
  }
  return levels;
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
}

/** Inharmonic over harmonic power between 50 Hz and 5 kHz, dB. */
export function aliasDb(x: Float64Array, sr: number, f0: number): number {
  const n = 16384;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const off = x.length - n;
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / (n - 1);
    const w =
      0.35875 -
      0.48829 * Math.cos(t) +
      0.14128 * Math.cos(2 * t) -
      0.01168 * Math.cos(3 * t);
    re[i] = x[off + i]! * w;
  }
  fftInPlace(re, im);
  let harm = 0;
  let alias = 0;
  for (let k = Math.ceil((50 * n) / sr); k < (5000 * n) / sr; k += 1) {
    const hz = (k * sr) / n;
    const h = Math.round(hz / f0);
    const p = re[k]! ** 2 + im[k]! ** 2;
    if (h >= 1 && Math.abs(hz - h * f0) <= (5 * sr) / n) harm += p;
    else alias += p;
  }
  return 10 * Math.log10(alias / harm);
}

/** Peaks of a harmonic-level curve, parabolically refined, in Hz. */
export function harmonicPeaks(levels: readonly number[], f0: number): number[] {
  const peaks: number[] = [];
  for (let h = 1; h < levels.length - 1; h += 1) {
    const [a, b, c] = [levels[h - 1]!, levels[h]!, levels[h + 1]!];
    if (b > a && b >= c) {
      const d = a - 2 * b + c;
      const off = d < 0 ? (0.5 * (a - c)) / d : 0;
      peaks.push((h + 1 + off) * f0);
    }
  }
  return peaks;
}

/** Spectral centroid (Hz) of an 8192-sample frame from `from`. */
export function centroidHz(x: Float64Array, sr: number, from: number): number {
  const n = 8192;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i += 1) re[i] = (x[from + i] ?? 0) * w[i]!;
  fftInPlace(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k += 1) {
    const p = Math.hypot(re[k]!, im[k]!);
    num += p * ((k * sr) / n);
    den += p;
  }
  return num / den;
}

export const cents = (a: number, b: number): number => 1200 * Math.log2(a / b);
