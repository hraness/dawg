/**
 * The song master (core/master.ts) as DSP: EQ, glue compressor, tape,
 * width and a true-peak limiter on the summed mix, then the loudness
 * target. Everything is offline over whole buffers in float64 with a fixed
 * order of operations, so masters render deterministically.
 *
 * Loops are processed as if they played forever: the chain runs over
 * warm-up repeats and keeps one steady-state pass, so the loop seam is
 * seamless. One-shot renders start from silence.
 */
import {
  MASTER_LIMITS,
  masterActive,
  type SongMaster,
} from "../../core/master.ts";
import type { FxValues } from "../../core/params.ts";
import {
  gainToDb,
  integratedLoudness,
  interSamplePeaks,
  truePeakGain,
} from "./loudness.ts";

export type MasterReport = Readonly<{
  /** Gain the target applied (into the limiter when it is on), dB. */
  gainDb: number;
  /** Integrated loudness after the master, LUFS. */
  integrated: number;
  /** True peak after the master, dBTP. */
  truePeak: number;
  target?: number;
  /** Whether the target was met within 0.5 LU. */
  reached?: boolean;
  /** Limiter passes the target search used (0 without one). */
  runs?: number;
}>;

export type MasterOutput = Readonly<{
  left: Float64Array;
  right: Float64Array;
  report: MasterReport;
}>;

/** Seconds of warm-up a loop gets before the pass that is kept. */
const LOOP_WARMUP_SECONDS = 2;
const TARGET_TOLERANCE_LU = 0.05;
const TARGET_ITERATIONS = 8;
/** LU per dB of drive below which the limiter is on its plateau. */
const PLATEAU_SLOPE = 0.05;
/** Largest single step the bracketing search takes, dB. */
const MAX_TARGET_STEP = 12;
/** Extra samples so true-peak interpolation past the lookahead is real. */
const TRUE_PEAK_PAD = 18;

/**
 * Masters the first `frames` samples of a mix. Returns undefined for a
 * master that changes nothing, so callers keep the plain mix (and dawg 0.4
 * renders stay byte-identical).
 */
export function applyMaster(
  mixL: Float64Array,
  mixR: Float64Array,
  frames: number,
  sampleRate: number,
  master: SongMaster | undefined,
  loop: boolean,
): MasterOutput | undefined {
  if (!masterActive(master) || frames <= 0) return undefined;
  const song = master!;
  const lookahead = song.limiter
    ? Math.max(
        1,
        Math.round((Number(song.limiter.lookahead) * sampleRate) / 1000),
      )
    : 0;
  // A loop is laid out as warm-up repeats, the kept pass and enough of the
  // next pass for the limiter to look ahead into; a one-shot is the mix
  // followed by silence the limiter can look into.
  const warm = loop
    ? Math.ceil((LOOP_WARMUP_SECONDS * sampleRate) / frames) * frames
    : 0;
  const length = warm + frames + lookahead + TRUE_PEAK_PAD;
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = loop ? index % frames : index;
    if (source < frames) {
      left[index] = mixL[source]!;
      right[index] = mixR[source]!;
    }
  }
  if (song.eq) applyEq(left, right, song.eq, sampleRate);
  if (song.glue) applyGlue(left, right, song.glue, sampleRate);
  if (song.tape) applyTape(left, right, song.tape, sampleRate);
  if (song.width) applyWidth(left, right, song.width, sampleRate);
  const kept = (buffer: Float64Array) => buffer.subarray(warm, warm + frames);
  let gainDb = 0;
  let runs = 0;
  let outL: Float64Array;
  let outR: Float64Array;
  if (song.limiter) {
    const limiter = new Limiter(left, right, song.limiter, sampleRate);
    const drive = Number(song.limiter.gain);
    let lastRun: number | undefined;
    const run = (gain: number) => {
      if (gain === lastRun) return;
      limiter.run(gain);
      lastRun = gain;
      runs += 1;
    };
    if (song.target === undefined) {
      gainDb = drive;
    } else {
      // The linear guess is a pure function of the mix, so the same mix
      // always solves to the same drive (and the same bytes).
      const before = integratedLoudness(
        kept(left),
        kept(right),
        sampleRate,
        loop,
      );
      gainDb = Number.isFinite(before)
        ? seekTarget(song.target, song.target - before, (gain) => {
            run(gain);
            return integratedLoudness(
              kept(limiter.left),
              kept(limiter.right),
              sampleRate,
              loop,
            );
          })
        : 0;
    }
    run(gainDb);
    outL = kept(limiter.left);
    outR = kept(limiter.right);
    trimToCeiling(
      outL,
      outR,
      Number(song.limiter.ceiling),
      loop,
      song.limiter.truepeak !== false,
    );
  } else {
    outL = kept(left);
    outR = kept(right);
    if (song.target !== undefined) {
      const before = integratedLoudness(outL, outR, sampleRate, loop);
      if (Number.isFinite(before)) {
        const peak = gainToDb(truePeakGain(outL, outR, loop));
        gainDb = clampGain(
          Math.min(song.target - before, MASTER_LIMITS.safeCeiling - peak),
        );
        scale(outL, outR, 10 ** (gainDb / 20));
      }
    }
  }
  const integrated = integratedLoudness(outL, outR, sampleRate, loop);
  const report: MasterReport = {
    gainDb,
    integrated,
    truePeak: gainToDb(truePeakGain(outL, outR, loop)),
    ...(song.target === undefined
      ? {}
      : {
          target: song.target,
          reached: Math.abs(integrated - song.target) <= 0.5,
        }),
    ...(song.limiter && song.target !== undefined ? { runs } : {}),
  };
  return Object.freeze({ left: outL, right: outR, report });
}

function clampGain(gainDb: number): number {
  return Math.max(
    -MASTER_LIMITS.maxTargetGain,
    Math.min(MASTER_LIMITS.maxTargetGain, gainDb),
  );
}

/**
 * Finds the limiter drive that meets a loudness target. Loudness rises
 * monotonically (and ever more slowly) with drive, so the search first
 * brackets the target from the linear guess, stepping outward, then closes
 * the bracket with Illinois regula falsi. It stops early on the plateau
 * where the limiter is past its ceiling and more drive buys almost no
 * loudness. Every step depends only on the inputs, so the same mix always
 * solves to the same drive; the closest run wins (ties go to less drive).
 */
export function seekTarget(
  target: number,
  guess: number,
  measure: (gainDb: number) => number,
): number {
  type Point = { gain: number; loudness: number };
  const seen: Point[] = [];
  const probe = (gain: number): Point => {
    const point = { gain, loudness: measure(gain) };
    seen.push(point);
    return point;
  };
  const off = (point: Point) => Math.abs(point.loudness - target);
  const best = () =>
    seen.reduce((a, b) =>
      off(b) < off(a) || (off(b) === off(a) && b.gain < a.gain) ? b : a,
    );
  let point = probe(clampGain(guess));
  if (!Number.isFinite(point.loudness)) return 0;
  let low = point.loudness < target ? point : undefined;
  let high = point.loudness < target ? undefined : point;
  // Bracket: step away from the target side, estimating the slope from the
  // last two runs (1 dB per dB at first) and overshooting a little, since
  // the curve only flattens further out.
  while (
    seen.length < TARGET_ITERATIONS &&
    off(point) > TARGET_TOLERANCE_LU &&
    (low === undefined || high === undefined)
  ) {
    const previous = seen.length >= 2 ? seen[seen.length - 2]! : undefined;
    const slope =
      previous === undefined
        ? 1
        : (point.loudness - previous.loudness) / (point.gain - previous.gain);
    // Below the target on the plateau, more drive cannot reach it; above
    // it, a flat stretch only means a bigger step down.
    if (
      high === undefined &&
      previous !== undefined &&
      !(slope >= PLATEAU_SLOPE)
    )
      break;
    const step = Math.min(
      MAX_TARGET_STEP,
      Math.max(0.25, (1.25 * off(point)) / Math.max(slope, PLATEAU_SLOPE)),
    );
    const next = clampGain(point.gain + (high === undefined ? step : -step));
    if (next === point.gain) break;
    point = probe(next);
    if (point.loudness < target) low = point;
    else high = point;
  }
  if (
    low !== undefined &&
    high !== undefined &&
    off(point) > TARGET_TOLERANCE_LU
  ) {
    let fLow = low.loudness - target;
    let fHigh = high.loudness - target;
    let side = 0;
    while (seen.length < TARGET_ITERATIONS && high.gain - low.gain > 0.01) {
      const gain = (low.gain * fHigh - high.gain * fLow) / (fHigh - fLow);
      point = probe(gain);
      const f = point.loudness - target;
      if (Math.abs(f) <= TARGET_TOLERANCE_LU) break;
      if (f < 0) {
        low = point;
        fLow = f;
        if (side === -1) fHigh /= 2;
        side = -1;
      } else {
        high = point;
        fHigh = f;
        if (side === 1) fLow /= 2;
        side = 1;
      }
    }
  }
  return best().gain;
}

function scale(left: Float64Array, right: Float64Array, gain: number): void {
  for (let index = 0; index < left.length; index += 1) {
    left[index]! *= gain;
    right[index]! *= gain;
  }
}

/**
 * A final static trim so the measured peak (true peak, or sample peak when
 * the limiter's true-peak detection is off) never passes the ceiling.
 */
function trimToCeiling(
  left: Float64Array,
  right: Float64Array,
  ceilingDb: number,
  loop: boolean,
  truePeak: boolean,
): void {
  const ceiling = 10 ** (ceilingDb / 20);
  let peak = 0;
  if (truePeak) peak = truePeakGain(left, right, loop);
  else
    for (let index = 0; index < left.length; index += 1)
      peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  if (peak > ceiling) scale(left, right, ceiling / peak);
}

/** A biquad section, transposed direct form II. */
class Section {
  private z1 = 0;
  private z2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  process(input: number): number {
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }

  run(buffer: Float64Array): void {
    for (let index = 0; index < buffer.length; index += 1)
      buffer[index] = this.process(buffer[index]!);
  }
}

type SectionKind = "low" | "high" | "bell" | "lowpass" | "highpass";

/** RBJ Audio EQ Cookbook coefficients (shelves at slope S = 1). */
export function cookbook(
  kind: SectionKind,
  frequency: number,
  sampleRate: number,
  gainDb = 0,
  q = Math.SQRT1_2,
): Section {
  const f = Math.max(10, Math.min(frequency, sampleRate * 0.45));
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const a = 10 ** (gainDb / 40);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (kind === "bell") {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * a;
    b1 = -2 * cos;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cos;
    a2 = 1 - alpha / a;
  } else if (kind === "low" || kind === "high") {
    const alpha = sin / Math.SQRT2;
    const root = 2 * Math.sqrt(a) * alpha;
    const sign = kind === "low" ? 1 : -1;
    b0 = a * (a + 1 - sign * (a - 1) * cos + root);
    b1 = sign * 2 * a * (a - 1 - sign * (a + 1) * cos);
    b2 = a * (a + 1 - sign * (a - 1) * cos - root);
    a0 = a + 1 + sign * (a - 1) * cos + root;
    a1 = -sign * 2 * (a - 1 + sign * (a + 1) * cos);
    a2 = a + 1 + sign * (a - 1) * cos - root;
  } else {
    const alpha = sin / (2 * q);
    const low = kind === "lowpass";
    b0 = low ? (1 - cos) / 2 : (1 + cos) / 2;
    b1 = low ? 1 - cos : -(1 + cos);
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }
  return new Section(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/** Low shelf, two bells and a high shelf; 0 dB bands are skipped. */
function applyEq(
  left: Float64Array,
  right: Float64Array,
  values: FxValues,
  sampleRate: number,
): void {
  const value = (key: string) => Number(values[key]);
  const bands: [SectionKind, number, number, number][] = [
    ["low", value("low"), value("lowfreq"), Math.SQRT1_2],
    ["bell", value("bell1"), value("bell1freq"), value("bell1q")],
    ["bell", value("bell2"), value("bell2freq"), value("bell2q")],
    ["high", value("high"), value("highfreq"), Math.SQRT1_2],
  ];
  for (const [kind, gain, frequency, q] of bands) {
    if (gain === 0) continue;
    for (const channel of [left, right])
      cookbook(kind, frequency, sampleRate, gain, q).run(channel);
  }
}

/**
 * Stereo-linked feed-forward bus compressor (Giannoulis, Massberg & Reiss,
 * JAES 2012): peak level of the louder channel (optionally high-passed so
 * the bass does not pump the mix), a soft-knee gain computer in dB and
 * attack/release smoothing of the gain reduction, then make-up and a
 * parallel dry/wet mix.
 */
function applyGlue(
  left: Float64Array,
  right: Float64Array,
  values: FxValues,
  sampleRate: number,
): void {
  const threshold = Number(values.threshold);
  const ratio = Number(values.ratio);
  const knee = Number(values.knee);
  const mix = Number(values.mix);
  const hpf = Number(values.hpf);
  const slope = 1 - 1 / ratio;
  // Auto make-up: half the static reduction a full-scale peak gets, a fixed
  // estimate of the average, so glue on/off compares near level-matched and
  // the result does not depend on the buffer (loops stay periodic).
  const auto =
    values.auto !== false ? (slope * Math.max(0, -threshold)) / 2 : 0;
  const makeup = 10 ** ((Number(values.makeup) + auto) / 20);
  const coefficient = (ms: number) =>
    Math.exp(-1 / Math.max(1, (ms / 1000) * sampleRate));
  const attack = coefficient(Number(values.attack));
  const release = coefficient(Number(values.release));
  const sideL = hpf > 0 ? cookbook("highpass", hpf, sampleRate) : undefined;
  const sideR = hpf > 0 ? cookbook("highpass", hpf, sampleRate) : undefined;
  let reduction = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index]!;
    const r = right[index]!;
    const detectL = sideL ? sideL.process(l) : l;
    const detectR = sideR ? sideR.process(r) : r;
    const level =
      20 * Math.log10(Math.max(Math.abs(detectL), Math.abs(detectR)) + 1e-12);
    const over = level - threshold;
    let target = 0;
    if (2 * over >= knee) target = slope * over;
    else if (knee > 0 && 2 * over > -knee)
      target = (slope * (over + knee / 2) ** 2) / (2 * knee);
    reduction =
      target > reduction
        ? attack * reduction + (1 - attack) * target
        : release * reduction + (1 - release) * target;
    const gain = 10 ** (-reduction / 20) * makeup;
    left[index] = l * (1 - mix) + l * gain * mix;
    right[index] = r * (1 - mix) + r * gain * mix;
  }
}

/** ln(cosh(u)), the antiderivative of tanh, without overflow. */
function logCosh(u: number): number {
  const a = Math.abs(u);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/**
 * Tape-style saturation: tanh(drive·x + bias), centred and scaled so full
 * scale stays full scale (quiet parts come up, peaks stay put). First-order
 * antiderivative anti-aliasing (Parker et al., DAFx 2016; Bilbao et al.,
 * IEEE SPL 2017) keeps the harmonics from folding back, a 5 Hz DC blocker
 * removes the offset the bias leaves, and `tone` rolls off the top
 * (20 kHz is off: the stage is flat to 0.4 fs).
 */
/** Pole of the filter that flattens the tape stage's ADAA top end. */
const TAPE_COMPENSATION = 0.85;

function applyTape(
  left: Float64Array,
  right: Float64Array,
  values: FxValues,
  sampleRate: number,
): void {
  const drive = 10 ** (Number(values.drive) / 20);
  const bias = Number(values.bias);
  const tone = Number(values.tone);
  const mix = Number(values.mix);
  const centre = Math.tanh(bias);
  const norm = Math.max(
    Math.tanh(drive + bias) - centre,
    centre - Math.tanh(bias - drive),
  );
  const dcPole = Math.exp((-2 * Math.PI * 5) / sampleRate);
  const toneOn = tone < Math.min(20_000, sampleRate * 0.45);
  for (const channel of [left, right]) {
    let previousU = bias;
    let previousF = logCosh(bias);
    let previousX = 0;
    let compensated = 0;
    let dcIn = 0;
    let dcOut = 0;
    const lowpass = toneOn ? cookbook("lowpass", tone, sampleRate) : undefined;
    for (let index = 0; index < channel.length; index += 1) {
      const x = channel[index]!;
      const u = drive * x + bias;
      const f = logCosh(u);
      const delta = u - previousU;
      const shaped =
        Math.abs(delta) > 1e-9
          ? (f - previousF) / delta
          : Math.tanh((u + previousU) / 2);
      previousU = u;
      previousF = f;
      let wet = (shaped - centre) / norm;
      // DC blocker: y[n] = x[n] - x[n-1] + R·y[n-1].
      const blocked = wet - dcIn + dcPole * dcOut;
      dcIn = wet;
      dcOut = blocked;
      wet = lowpass ? lowpass.process(blocked) : blocked;
      // The dry path gets the same half-sample delay the ADAA stage has.
      const dry = (x + previousX) / 2;
      previousX = x;
      // Both paths carry the two-tap average ADAA amounts to in its linear
      // region (|cos(pi f/fs)|: -6 dB at fs/3); a one-pole compensator
      // (1 + r)/(1 + r z^-1) undoes it to within 0.3 dB up to 0.4 fs.
      const mixed = dry * (1 - mix) + wet * mix;
      compensated =
        (1 + TAPE_COMPENSATION) * mixed - TAPE_COMPENSATION * compensated;
      channel[index] = compensated;
    }
  }
}

/**
 * Mid/side width with mono bass: the side signal is scaled by `width` and
 * high-passed at `mono` with a 4th-order Linkwitz-Riley filter; the mid
 * runs through the matching all-pass so both keep the same phase.
 */
function applyWidth(
  left: Float64Array,
  right: Float64Array,
  values: FxValues,
  sampleRate: number,
): void {
  const width = Number(values.width);
  const mono = Number(values.mono);
  if (width === 1 && mono === 0) return;
  const crossover = mono > 0;
  const lr4 = (kind: "lowpass" | "highpass") => [
    cookbook(kind, mono, sampleRate),
    cookbook(kind, mono, sampleRate),
  ];
  const midLow = crossover ? lr4("lowpass") : [];
  const midHigh = crossover ? lr4("highpass") : [];
  const sideHigh = crossover ? lr4("highpass") : [];
  for (let index = 0; index < left.length; index += 1) {
    let mid = (left[index]! + right[index]!) / 2;
    let side = ((left[index]! - right[index]!) / 2) * width;
    if (crossover) {
      mid =
        midLow[1]!.process(midLow[0]!.process(mid)) +
        midHigh[1]!.process(midHigh[0]!.process(mid));
      side = sideHigh[1]!.process(sideHigh[0]!.process(side));
    }
    left[index] = mid + side;
    right[index] = mid - side;
  }
}

/**
 * Brickwall limiter. Offline, so the lookahead reads the future directly:
 * the gain each sample needs (ceiling over its peak, with true peaks from
 * the 4x interpolator on both sides of the sample) is held as a minimum
 * over the next `lookahead` samples, released exponentially and smoothed
 * by a moving average of the same length. Every sample under the average
 * window carries its own requirement, so the result never overshoots and
 * the gain ramps down smoothly before each peak. Peaks are found once;
 * `run` can then try different drives cheaply (the loudness target).
 */
class Limiter {
  readonly left: Float64Array;
  readonly right: Float64Array;
  private readonly peaks: Float64Array;
  private readonly window: number;
  private readonly release: number;
  private readonly ceiling: number;

  constructor(
    private readonly inputL: Float64Array,
    private readonly inputR: Float64Array,
    values: FxValues,
    sampleRate: number,
  ) {
    const n = inputL.length;
    this.left = new Float64Array(n);
    this.right = new Float64Array(n);
    this.ceiling = 10 ** (Number(values.ceiling) / 20);
    this.window = Math.max(
      1,
      Math.round((Number(values.lookahead) * sampleRate) / 1000),
    );
    this.release = Math.exp(
      -1 / Math.max(1, (Number(values.release) / 1000) * sampleRate),
    );
    this.peaks = new Float64Array(n);
    if (values.truepeak !== false) {
      interSamplePeaks(inputL, false, this.peaks);
      interSamplePeaks(inputR, false, this.peaks);
      // A sample's gain shapes the waveform on both sides of it.
      for (let index = n - 1; index > 0; index -= 1)
        if (this.peaks[index - 1]! > this.peaks[index]!)
          this.peaks[index] = this.peaks[index - 1]!;
    } else {
      for (let index = 0; index < n; index += 1)
        this.peaks[index] = Math.max(
          Math.abs(inputL[index]!),
          Math.abs(inputR[index]!),
        );
    }
  }

  /** Limits the input driven by `gainDb` into `left` and `right`. */
  run(gainDb: number): void {
    const drive = 10 ** (gainDb / 20);
    const n = this.inputL.length;
    const { peaks, window, ceiling } = this;
    // Sliding minimum of the needed gain over [i, i + window - 1]: a
    // monotonic deque in a ring buffer, `window` samples ahead of the output.
    const capacity = window + 1;
    const slots = new Int32Array(capacity);
    const values = new Float64Array(capacity);
    let head = 0;
    let size = 0;
    const history = new Float64Array(window);
    let released = 1;
    let sum = 0;
    for (let ahead = 0; ahead < n + window - 1; ahead += 1) {
      const index = ahead - window + 1;
      while (size > 0 && slots[head]! < index) {
        head = (head + 1) % capacity;
        size -= 1;
      }
      const peak = ahead < n ? peaks[ahead]! * drive : 0;
      const need = peak > ceiling ? ceiling / peak : 1;
      while (size > 0 && values[(head + size - 1) % capacity]! >= need)
        size -= 1;
      const slot = (head + size) % capacity;
      slots[slot] = ahead;
      values[slot] = need;
      size += 1;
      if (index < 0) continue;
      const target = values[head]!;
      if (index === 0) {
        released = target;
        history.fill(target);
        sum = window * target;
      }
      released =
        target < released
          ? target
          : target - this.release * (target - released);
      const at = index % window;
      sum += released - history[at]!;
      history[at] = released;
      const gain = Math.min(1, sum / window) * drive;
      this.left[index] = this.inputL[index]! * gain;
      this.right[index] = this.inputR[index]! * gain;
    }
  }
}
