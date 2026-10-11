/**
 * Machine vox (lane V1): consonants for the sing engine. A line's notes
 * become a timeline of phone spans (onset consonants at each note's start,
 * the vowel nucleus, coda consonants ending at the note's end) and this
 * module answers, per control tick, what the tract does there:
 *
 * - formants: the span's targets (phone table F1-F3 scaled per voice type,
 *   the SATB singer tables for the five sung vowels), with a smoothstep
 *   transition from the previous span (approximant and diphthong glides);
 * - voicing: how much glottal source passes (0 in a stop closure or a
 *   voiceless fricative, a murmur level for nasals);
 * - a nasal zero (the pole-zero pair: a low murmur pole in F1 plus an
 *   anti-resonance) on the cascade output;
 * - noise: frication and stop bursts through three parallel band-passes
 *   (Klatt 1980's parallel branch), and aspiration through bands at the
 *   current formants.
 *
 * Structure after klatt-syn by Christian d'Heureuse (MIT,
 * https://github.com/chdh/klatt-syn), used as a reference; see NOTICE.
 * Everything is a pure function of the offset into the line except the
 * noise pass, whose generator is seeded per line: deterministic.
 */
import type { VoxSyllable } from "../../../core/g2p.ts";
import { VOX_PHONES, type VoxPhone } from "../../../core/vox-phones.ts";
import {
  Bandpass,
  morphVowel,
  SINGER_FORMANTS,
  vowelAt,
  type Formant,
  type VoiceType,
} from "../dsp/formant.ts";
import { seededRandom } from "../dsp/rng.ts";

/** Phone-table F1-F3 (adult male) to each voice type's tract. */
const VOICE_SCALE: Readonly<Record<VoiceType, number>> = Object.freeze({
  bass: 0.93,
  tenor: 1,
  alto: 1.12,
  soprano: 1.2,
});

/** Formant transition into a span, seconds. */
const TRANSITION_SECONDS = 0.035;
/** Into a vowel after a stop release: faster. */
const RELEASE_TRANSITION_SECONDS = 0.02;
/** A note's consonants take at most this share of it. */
const CONSONANT_SHARE = 0.6;
/** Voicing and noise level smoothing, seconds (time constant). */
export const VOX_AV_SECONDS = 0.0025;
const NOISE_SMOOTH_SECONDS = 0.0015;
/** Aspiration level (relative to a full vowel) after a voiceless stop. */
const ASPIRATION_LEVEL = 0.3;
/**
 * Noise output trim: puts an /s/ at noiseLevel 0.5 about 6-8 dB under the
 * vowel beside it, as in speech.
 */
const NOISE_TRIM = 0.55;

export type SpanPart = "main" | "closure" | "burst" | "aspiration" | "tail";

/** One stretch of a line: a phone (or a sung vowel) over [at, end). */
export type VoxSpan = {
  at: number;
  end: number;
  /** Phone name; undefined for a sung-vowel spec with no phone. */
  phone?: string;
  part: SpanPart;
  /** Formants at the start, and (diphthongs, morphs) at the end. */
  from: readonly Formant[];
  to?: readonly Formant[];
  /** Diphthong: hold, then glide late; a morph spec glides across. */
  late: boolean;
  av: number;
  noise: number;
  bands?: readonly (readonly [number, number, number])[];
  /** Aspiration: noise through the current formants. */
  aspirate: boolean;
  zero?: number;
  trans: number;
};

/** A segment of a line as the engine plans it (one per note). */
export type VoxSegment = Readonly<{
  at: number;
  end: number;
  /** The vowel spec the note would sing without consonants. */
  vowel: string;
  syllable: VoxSyllable;
}>;

/** F1-F3 of a phone on `voice`, with that voice's F4 and F5. */
function phoneTable(
  voice: VoiceType,
  f: readonly [number, number, number],
  bw: readonly [number, number, number],
): Formant[] {
  const k = VOICE_SCALE[voice];
  const a = SINGER_FORMANTS[voice].a!;
  return [
    [f[0] * k, 0, bw[0]],
    [f[1] * k, -6, bw[1]],
    [f[2] * k, -12, bw[2]],
    [Math.max(a[3]![0], f[2] * k * 1.15), a[3]![1], a[3]![2]],
    [Math.max(a[4]![0], f[2] * k * 1.3), a[4]![1], a[4]![2]],
  ];
}

/** Start and end formants of a vowel phone or a sung spec. */
function vowelTables(
  voice: VoiceType,
  phone: string | undefined,
  spec: string,
): { from: Formant[]; to?: Formant[]; late: boolean } {
  const p = phone ? VOX_PHONES[phone] : undefined;
  const sung = p ? p.sung : spec;
  if (sung !== undefined) {
    const morph = sung.includes(">");
    return {
      from: vowelAt(voice, sung, 0),
      ...(morph ? { to: vowelAt(voice, sung, 1) } : {}),
      late: p !== undefined,
    };
  }
  const q = p!;
  return {
    from: phoneTable(voice, q.f, q.bw),
    ...(q.to ? { to: phoneTable(voice, q.to, q.bw) } : {}),
    late: true,
  };
}

/** The articulation of one line (see the module comment). */
export class Articulation {
  readonly spans: VoxSpan[] = [];
  private cursor = 0;
  constructor(
    segments: readonly VoxSegment[],
    voice: VoiceType,
    sampleRate: number,
    strength: number,
  ) {
    const sec = (s: number) => Math.round(s * sampleRate);
    let heldPhone: string | undefined;
    let heldSpec = segments[0]?.vowel ?? "a";
    let lastConsonant: string | undefined;
    segments.forEach((seg, k) => {
      const { syllable } = seg;
      const len = Math.max(1, seg.end - seg.at);
      const onset = syllable.hold ? [] : syllable.onset;
      const coda = syllable.coda;
      const onSec = onset.reduce(
        (t, p, i) => t + this.phoneLength(p, k === 0 && i === 0),
        0,
      );
      const coSec = coda.reduce((t, p) => t + this.phoneLength(p, false), 0);
      const want = sec(onSec + coSec);
      const squeeze =
        want > len * CONSONANT_SHARE ? (len * CONSONANT_SHARE) / want : 1;
      let at = Math.max(seg.at, this.spans[this.spans.length - 1]?.end ?? 0);
      onset.forEach((p, i) => {
        at = this.pushPhone(
          p,
          at,
          squeeze,
          sampleRate,
          voice,
          k === 0 && i === 0,
        );
      });
      const codaLen = Math.round(sec(coSec) * squeeze);
      const vowelEnd = Math.max(at + 1, seg.end - codaLen);
      if (!syllable.hold) {
        if (syllable.nucleus !== undefined) {
          heldPhone = syllable.nucleus;
          heldSpec = seg.vowel;
        } else if (syllable.onset.length > 0 || coda.length > 0) {
          // a consonant-only syllable ("hmm"): no vowel of its own
          heldPhone = undefined;
          heldSpec = seg.vowel;
        } else {
          heldPhone = undefined;
          heldSpec = seg.vowel;
        }
      }
      const consonantOnly =
        !syllable.hold && syllable.nucleus === undefined && onset.length > 0;
      if (consonantOnly) {
        // stretch the last onset phone (a hum, a hiss) over the note
        const last = this.spans[this.spans.length - 1];
        if (last && last.part === "main") last.end = vowelEnd;
        at = vowelEnd;
      } else {
        const tables = vowelTables(voice, heldPhone, heldSpec);
        this.spans.push({
          at,
          end: vowelEnd,
          ...(heldPhone ? { phone: heldPhone } : {}),
          part: "main",
          from: tables.from,
          ...(tables.to ? { to: tables.to } : {}),
          late: tables.late,
          av: 1,
          noise: 0,
          aspirate: false,
          trans: sec(TRANSITION_SECONDS),
        });
        at = vowelEnd;
      }
      coda.forEach((p) => {
        at = this.pushPhone(p, at, squeeze, sampleRate, voice, false);
      });
      // the coda ends at the note's end exactly
      const tailSpan = this.spans[this.spans.length - 1];
      if (tailSpan) tailSpan.end = Math.max(tailSpan.end, seg.end);
      lastConsonant = coda.length > 0 ? coda[coda.length - 1] : undefined;
    });
    // after the line's last phone: a consonant ends the voice (a stop or a
    // voiceless hiss falls silent; a nasal or liquid keeps humming)
    const last = this.spans[this.spans.length - 1];
    if (last) {
      const p = lastConsonant ? VOX_PHONES[lastConsonant] : undefined;
      const endTable = last.to ?? last.from;
      const silent =
        p !== undefined &&
        (p.kind === "stop" || p.kind === "affricate" || !p.voiced);
      this.spans.push({
        at: last.end,
        end: Number.MAX_SAFE_INTEGER,
        ...(last.phone ? { phone: last.phone } : {}),
        part: "tail",
        from: endTable,
        late: false,
        av: p === undefined ? 1 : silent ? 0 : p.av,
        noise: 0,
        aspirate: false,
        ...(p?.zero !== undefined && !silent ? { zero: p.zero } : {}),
        trans: 1,
      });
    }
    // aspiration and /h/ excite the formants of the vowel that follows
    for (let i = 0; i < this.spans.length; i += 1) {
      const span = this.spans[i]!;
      if (!span.aspirate) continue;
      const next = this.spans
        .slice(i + 1)
        .find((s) => s.av > 0.9 && s.part === "main");
      if (next) span.from = next.from;
    }
    for (const span of this.spans) {
      span.av = 1 - strength * (1 - span.av);
      span.noise *= strength;
    }
  }

  private phoneLength(name: string, lineStart: boolean): number {
    const p = VOX_PHONES[name];
    if (!p) return 0;
    if (p.kind === "vowel") return p.dur;
    const closure = lineStart ? 0 : (p.closure ?? 0);
    return closure + p.dur + (p.aspiration ?? 0);
  }

  /** Appends the spans of one consonant (or coda vowel); returns the end. */
  private pushPhone(
    name: string,
    at: number,
    squeeze: number,
    sampleRate: number,
    voice: VoiceType,
    lineStart: boolean,
  ): number {
    const p: VoxPhone | undefined = VOX_PHONES[name];
    if (!p) return at;
    const len = (s: number) =>
      Math.max(1, Math.round(s * squeeze * sampleRate));
    const trans = Math.round(TRANSITION_SECONDS * sampleRate);
    const table = phoneTable(voice, p.f, p.bw);
    const push = (span: Omit<VoxSpan, "at" | "end">, seconds: number): void => {
      const end = at + len(seconds);
      this.spans.push({ at, end, ...span });
      at = end;
    };
    if (p.kind === "vowel") {
      const t = vowelTables(voice, name, "a");
      push(
        {
          phone: name,
          part: "main",
          from: t.from,
          ...(t.to ? { to: t.to } : {}),
          late: true,
          av: 1,
          noise: 0,
          aspirate: false,
          trans,
        },
        p.dur,
      );
      return at;
    }
    if (p.kind === "stop" || p.kind === "affricate") {
      if (!lineStart)
        push(
          {
            phone: name,
            part: "closure",
            from: table,
            late: false,
            av: p.voiced ? 0.15 : 0,
            noise: 0,
            aspirate: false,
            trans: Math.round(0.015 * sampleRate),
          },
          p.closure ?? 0.05,
        );
      push(
        {
          phone: name,
          part: p.kind === "stop" ? "burst" : "main",
          from: table,
          late: false,
          av: p.av,
          noise: p.noiseLevel ?? 0,
          ...(p.noise ? { bands: p.noise } : {}),
          aspirate: false,
          trans: 1,
        },
        p.dur,
      );
      if (p.aspiration)
        push(
          {
            phone: name,
            part: "aspiration",
            from: table,
            late: false,
            av: 0,
            noise: ASPIRATION_LEVEL,
            aspirate: true,
            trans: Math.round(RELEASE_TRANSITION_SECONDS * sampleRate),
          },
          p.aspiration,
        );
      return at;
    }
    push(
      {
        phone: name,
        part: "main",
        from: table,
        late: false,
        av: p.av,
        noise: p.noiseLevel ?? 0,
        ...(p.noise ? { bands: p.noise } : {}),
        aspirate: p.kind === "aspirate",
        ...(p.zero !== undefined ? { zero: p.zero } : {}),
        trans,
      },
      p.dur,
    );
    return at;
  }

  /** The span at `offset` (a cursor makes in-order calls O(1)). */
  spanAt(offset: number): number {
    const spans = this.spans;
    let i = this.cursor;
    if (i >= spans.length || spans[i]!.at > offset) i = 0;
    while (i + 1 < spans.length && spans[i + 1]!.at <= offset) i += 1;
    this.cursor = i;
    return i;
  }

  /** Formants at `offset`: the span's, glided in from the previous one. */
  formantsAt(offset: number, morph: number): readonly Formant[] {
    const i = this.spanAt(offset);
    const span = this.spans[i]!;
    let table: readonly Formant[] = span.from;
    if (span.to) {
      const len = Math.max(1, span.end - span.at);
      const u = Math.min(1, Math.max(0, (offset - span.at) / len));
      const t = span.late
        ? Math.min(1, Math.max(0, (u - 0.55) / 0.45))
        : u * morph;
      if (t > 0) table = morphVowel(span.from, span.to, t);
    }
    if (i > 0 && span.trans > 1) {
      const into = (offset - span.at) / span.trans;
      if (into < 1) {
        const prev = this.spans[i - 1]!;
        const s = Math.max(0, into);
        table = morphVowel(prev.to ?? prev.from, table, s * s * (3 - 2 * s));
      }
    }
    return table;
  }

  avAt(offset: number): number {
    return this.spans[this.spanAt(offset)]!.av;
  }

  zeroAt(offset: number): number | undefined {
    return this.spans[this.spanAt(offset)]!.zero;
  }

  /** Whether any span makes noise (the noise pass can be skipped). */
  get noisy(): boolean {
    return this.spans.some((s) => s.noise > 0);
  }

  /**
   * The noise branch: frication, bursts and aspiration for the line,
   * mixed into `left` (and `right`). `amp(index)` is the line's level at
   * an output sample (gain, velocity, volume).
   */
  renderNoise(
    seed: string,
    start: number,
    frames: number,
    sampleRate: number,
    scale: number,
    control: number,
    amp: (index: number) => number,
    formants: (offset: number) => readonly Formant[],
    left: Float64Array,
    right: Float64Array | undefined,
  ): void {
    if (!this.noisy) return;
    const rand = seededRandom(`${seed}:vox`);
    const bands = [new Bandpass(), new Bandpass(), new Bandpass()];
    const gains = [0, 0, 0];
    const smooth = 1 - Math.exp(-1 / (NOISE_SMOOTH_SECONDS * sampleRate));
    let level = 0;
    let target = 0;
    const SQRT12 = Math.sqrt(12);
    for (let j = 0; j < frames; j += 1) {
      if (j % control === 0) {
        const span = this.spans[this.spanAt(j)]!;
        target = span.noise;
        if (span.noise > 0) {
          if (span.aspirate) {
            const f = formants(j);
            for (let b = 0; b < 3; b += 1) {
              bands[b]!.set(
                f[b]![0] * scale,
                Math.max(150, f[b]![2] * 2),
                sampleRate,
              );
              gains[b] = [1, 0.6, 0.35][b]!;
            }
          } else if (span.bands) {
            for (let b = 0; b < 3; b += 1) {
              const band = span.bands[b]!;
              bands[b]!.set(band[0] * Math.sqrt(scale), band[1], sampleRate);
              gains[b] = 10 ** (band[2] / 20);
            }
          }
        }
      }
      level += (target - level) * smooth;
      if (level < 1e-6 && target === 0) continue;
      const n = (rand() - 0.5) * SQRT12;
      const y =
        (bands[0]!.process(n) * gains[0]! +
          bands[1]!.process(n) * gains[1]! +
          bands[2]!.process(n) * gains[2]!) *
        level *
        NOISE_TRIM *
        amp(start + j);
      const index = start + j;
      left[index] = left[index]! + y;
      if (right) right[index] = right[index]! + y;
    }
  }
}

/** Klatt anti-resonator: a second-order zero (the nasal anti-formant). */
export class Antiresonator {
  private a = 1;
  private b = 0;
  private c = 0;
  private x1 = 0;
  private x2 = 0;
  private hz = 0;
  /** Sets the zero at `hz` (bandwidth `bw`); 0 bypasses it. */
  set(hz: number, bw: number, sampleRate: number): void {
    if (hz === this.hz) return;
    this.hz = hz;
    if (hz <= 0) {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      return;
    }
    const t = 1 / sampleRate;
    const f = Math.min(hz, sampleRate * 0.45);
    const c = -Math.exp(-2 * Math.PI * bw * t);
    const b = 2 * Math.exp(-Math.PI * bw * t) * Math.cos(2 * Math.PI * f * t);
    const a = 1 - b - c;
    this.a = 1 / a;
    this.b = -b / a;
    this.c = -c / a;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2;
    this.x2 = this.x1;
    this.x1 = x;
    return y;
  }
}
