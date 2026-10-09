/**
 * Test-only measurements for the vocoder (ported from the design
 * prototype's measure.ts): a third-octave FFT reference bank independent of
 * the vocoder's own filters, band-envelope correlation and cepstral
 * envelope distance. Nothing here runs at render time.
 */
import { resolveVocoder, type TrackVocoder } from "../../../core/vocoder.ts";
import { channelVocode } from "../vocoder/bank.ts";
import type { VocoderControl } from "../vocoder/control.ts";
import { autoGateDb, peakGuard } from "../vocoder/index.ts";
import { talkboxVocode } from "../vocoder/talkbox.ts";

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
  }
}

/** Third-octave band energies (dB) per 5 ms frame. */
export function bandEnvelopes(x: Float64Array, sr: number, N = 2048) {
  const hop = Math.round(0.005 * sr);
  const centres: number[] = [];
  for (let f = 125; f <= 8000; f *= 2 ** (1 / 3)) centres.push(f);
  const frames = Math.max(0, Math.floor((x.length - N) / hop));
  const bands = centres.map(() => new Float64Array(frames));
  const total = new Float64Array(frames);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let t = 0; t < frames; t += 1) {
    for (let i = 0; i < N; i += 1) {
      re[i] = x[t * hop + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    let all = 0;
    centres.forEach((c, b) => {
      const lo = Math.floor((c * 2 ** (-1 / 6) * N) / sr);
      const hi = Math.ceil((c * 2 ** (1 / 6) * N) / sr);
      let e = 0;
      for (let k = lo; k <= hi; k += 1) e += re[k]! ** 2 + im[k]! ** 2;
      bands[b]![t] = 10 * Math.log10(e + 1e-12);
      all += e;
    });
    total[t] = 10 * Math.log10(all + 1e-12);
  }
  return { centres, bands, total, hop };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb + 1e-300);
}

/**
 * Mean over third-octave bands of the Pearson r between the modulator's and
 * the output's dB envelopes, over frames where the modulator is active.
 */
export function bandCorrelation(
  mod: Float64Array,
  out: Float64Array,
  sr: number,
): number {
  const m = bandEnvelopes(mod, sr);
  const o = bandEnvelopes(out, sr);
  const peak = Math.max(...m.total);
  const per: number[] = [];
  for (let b = 0; b < m.centres.length; b += 1) {
    const xa: number[] = [];
    const xb: number[] = [];
    const bandPeak = Math.max(...m.bands[b]!);
    for (let t = 0; t < o.total.length && t < m.total.length; t += 1) {
      if (m.total[t]! < peak - 40 || m.bands[b]![t]! < bandPeak - 35) continue;
      xa.push(m.bands[b]![t]!);
      xb.push(o.bands[b]![t]!);
    }
    per.push(pearson(xa, xb));
  }
  const valid = per.filter((v) => Number.isFinite(v));
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function envelopeAt(x: Float64Array, at: number, N: number, lifter: number) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i += 1)
    re[i] = (x[at + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  const cr = new Float64Array(N);
  const ci = new Float64Array(N);
  for (let k = 0; k < N; k += 1)
    cr[k] = Math.log(Math.hypot(re[k]!, im[k]!) + 1e-9);
  fft(cr, ci);
  for (let q = lifter; q <= N - lifter; q += 1) {
    cr[q] = 0;
    ci[q] = 0;
  }
  for (let k = 0; k < N; k += 1) ci[k] = -ci[k]!;
  fft(cr, ci);
  const env = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k += 1) env[k] = (20 / Math.LN10) * (cr[k]! / N);
  return env;
}

/**
 * Mean absolute dB distance, 200..5000 Hz, between the output's envelope
 * and the modulator's warped by `ratio` (1 = unshifted), level-aligned.
 */
export function envelopeDistance(
  mod: Float64Array,
  out: Float64Array,
  sr: number,
  starts: readonly number[],
  ratio = 1,
  N = 2048,
): number {
  const lo = Math.ceil((200 * N) / sr);
  const hi = Math.floor((5000 * N) / sr);
  let sum = 0;
  for (const at of starts) {
    const em = envelopeAt(mod, at, N, 100);
    const eo = envelopeAt(out, at, N, 100);
    const target: number[] = [];
    const got: number[] = [];
    for (let k = lo; k <= hi; k += 1) {
      const src = k / ratio;
      const k0 = Math.floor(src);
      const fr = src - k0;
      target.push(em[k0]! * (1 - fr) + em[Math.min(k0 + 1, N / 2 - 1)]! * fr);
      got.push(eo[k]!);
    }
    const off = got.reduce((s, v, i) => s + v - target[i]!, 0) / got.length;
    sum +=
      got.reduce((s, v, i) => s + Math.abs(v - target[i]! - off), 0) /
      got.length;
  }
  return sum / starts.length;
}

/**
 * The vocoder DSP alone (no score): `mod` shapes `cars` with the given
 * settings, then gain and the peak guard, as the stage applies them.
 */
export function vocodeDirect(
  mod: Float64Array,
  cars: readonly Float64Array[],
  sr: number,
  vocoder: TrackVocoder = {},
  options: Readonly<{ origin?: number; hold?: Uint8Array; seed?: number }> = {},
): Float64Array[] {
  const settings = resolveVocoder(vocoder);
  const control: VocoderControl = {
    settings,
    sampleRate: sr,
    origin: options.origin ?? 0,
    seed: options.seed ?? 1,
    gateDb:
      settings.gate === "auto"
        ? autoGateDb(mod, sr)
        : (settings.gate as number),
    curves: {},
    ...(options.hold ? { hold: options.hold } : {}),
  };
  const outs =
    settings.mode === "talkbox"
      ? talkboxVocode(mod, cars, control)
      : channelVocode(mod, cars, control);
  const g = 10 ** (settings.gain / 20);
  for (const out of outs) {
    if (g !== 1) for (let i = 0; i < out.length; i += 1) out[i] = out[i]! * g;
    peakGuard(out);
  }
  return outs;
}
