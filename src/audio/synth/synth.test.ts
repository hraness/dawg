import { describe, expect, test } from "bun:test";
import { createScore, type TrackInput } from "../../../core/score.ts";
import { SYNTH_PRESETS } from "../../../core/synth.ts";
import { renderScorePcm } from "../wav.ts";
import { LoopRenderer } from "../renderer.ts";

const RATE = 48_000;

type Rendered = { left: Float64Array; right: Float64Array };

/** One note (C4 unless `pitch`) of `beats` beats on a single track, 120 bpm. */
function render(
  track: Omit<TrackInput, "id">,
  options: { pitch?: number; beats?: number; bars?: number } = {},
): Rendered {
  const beats = options.beats ?? 1;
  const score = createScore({
    tempoBpm: 120,
    bars: options.bars ?? 1,
    tracks: [{ id: "t", ...track }],
    notes: [
      {
        id: "n",
        trackId: "t",
        startTick: 0,
        durationTicks: beats * 480,
        pitch: options.pitch ?? 60,
        velocity: 0.8,
      },
    ],
  });
  const audio = renderScorePcm(score, { sampleRate: RATE });
  const left = new Float64Array(audio.frames);
  const right = new Float64Array(audio.frames);
  for (let i = 0; i < audio.frames; i += 1) {
    left[i] = audio.pcm[2 * i]! / 32768;
    right[i] = audio.pcm[2 * i + 1]! / 32768;
  }
  return { left, right };
}

function rms(buffer: Float64Array, from = 0, to = buffer.length): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += buffer[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Magnitude of one frequency via a Goertzel-style single-bin DFT. */
function bin(
  buffer: Float64Array,
  hz: number,
  from: number,
  to: number,
): number {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i += 1) {
    const phase = (2 * Math.PI * hz * i) / RATE;
    re += buffer[i]! * Math.cos(phase);
    im -= buffer[i]! * Math.sin(phase);
  }
  return Math.hypot(re, im) / (to - from);
}

/** Zero-crossing rate per second over a window: a cheap brightness/pitch proxy. */
function crossings(buffer: Float64Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i += 1)
    if (buffer[i - 1]! < 0 !== buffer[i]! < 0) count += 1;
  return (count * RATE) / (to - from);
}

const ms = (value: number) => Math.round((value * RATE) / 1000);
const C4 = 261.6255653005986;

describe("synth voice", () => {
  test("legacy instruments without synth params render as before", () => {
    // The voice is opt-in: an empty synth object is stored as undefined.
    const plain = render({ instrument: "saw" });
    const empty = render({ instrument: "saw", synth: {} as never });
    expect(empty.left).toEqual(plain.left);
  });

  test("ADSR: attack ramps up, sustain holds its level, release decays", () => {
    const { left } = render(
      {
        instrument: "sine",
        synth: { attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2 },
      },
      { beats: 1 },
    );
    const early = rms(left, 0, ms(20));
    const peak = rms(left, ms(90), ms(110));
    const held = rms(left, ms(300), ms(450));
    const after = rms(left, ms(500 + 150), ms(500 + 200));
    expect(early).toBeLessThan(peak * 0.4);
    expect(held / peak).toBeGreaterThan(0.4);
    expect(held / peak).toBeLessThan(0.6);
    expect(after).toBeLessThan(held * 0.3);
  });

  test("sawtooth is band-limited and carries its harmonics", () => {
    const { left } = render({ instrument: "sawtooth", synth: { attack: 0 } });
    const from = ms(100);
    const to = ms(400);
    const h1 = bin(left, C4, from, to);
    const h2 = bin(left, 2 * C4, from, to);
    const h3 = bin(left, 3 * C4, from, to);
    expect(h2 / h1).toBeGreaterThan(0.35);
    expect(h2 / h1).toBeLessThan(0.65);
    expect(h3 / h1).toBeGreaterThan(0.2);
  });

  test("square has odd harmonics only; pulse width changes the spectrum", () => {
    const square = render({ instrument: "square", synth: { attack: 0 } }).left;
    const from = ms(100);
    const to = ms(400);
    expect(bin(square, 2 * C4, from, to)).toBeLessThan(
      bin(square, 3 * C4, from, to) * 0.2,
    );
    const narrow = render({
      instrument: "pulse",
      synth: { attack: 0, pw: 0.1 },
    }).left;
    // A 10% pulse has a strong second harmonic, unlike the square.
    expect(bin(narrow, 2 * C4, from, to)).toBeGreaterThan(
      bin(square, 2 * C4, from, to) * 5,
    );
  });

  test("lpf darkens and lpenv sweeps the cutoff open then closed", () => {
    const open = render({ instrument: "sawtooth", synth: { attack: 0 } }).left;
    const dark = render({
      instrument: "sawtooth",
      synth: { attack: 0, lpf: 400 },
    }).left;
    const from = ms(100);
    const to = ms(400);
    expect(bin(dark, 5 * C4, from, to)).toBeLessThan(
      bin(open, 5 * C4, from, to) * 0.3,
    );
    const swept = render({
      instrument: "sawtooth",
      synth: { attack: 0, lpf: 300, lpenv: 5, lpdecay: 0.15, lpsustain: 0 },
    }).left;
    // Bright at the envelope peak, dark once it has decayed.
    expect(bin(swept, 5 * C4, ms(5), ms(40))).toBeGreaterThan(
      bin(swept, 5 * C4, ms(350), ms(450)) * 4,
    );
  });

  test("hpf removes the fundamental", () => {
    const plain = render({ instrument: "sawtooth", synth: { attack: 0 } }).left;
    const thin = render({
      instrument: "sawtooth",
      synth: { attack: 0, hpf: 2000 },
    }).left;
    const from = ms(100);
    const to = ms(400);
    expect(bin(thin, C4, from, to)).toBeLessThan(
      bin(plain, C4, from, to) * 0.1,
    );
  });

  test("FM adds sidebands at carrier ± modulator", () => {
    const plain = render({ instrument: "sine", synth: { attack: 0 } }).left;
    const fm = render({
      instrument: "sine",
      synth: { attack: 0, fm: 2, fmh: 1 },
    }).left;
    const from = ms(100);
    const to = ms(400);
    expect(bin(plain, 2 * C4, from, to)).toBeLessThan(0.001);
    expect(bin(fm, 2 * C4, from, to)).toBeGreaterThan(0.01);
    // A second operator stacks more sidebands.
    const fm2 = render({
      instrument: "sine",
      synth: { attack: 0, fm: 2, fmh: 1, fm2: 3, fmh2: 3 },
    }).left;
    expect(bin(fm2, 4 * C4, from, to)).toBeGreaterThan(
      bin(fm, 4 * C4, from, to),
    );
  });

  test("fm envelope: the index decays with fmdecay", () => {
    const { left } = render({
      instrument: "sine",
      synth: {
        attack: 0,
        fm: 6,
        fmh: 2,
        fmattack: 0,
        fmdecay: 0.1,
        fmsustain: 0,
      },
    });
    expect(bin(left, 3 * C4, ms(2), ms(40))).toBeGreaterThan(
      bin(left, 3 * C4, ms(300), ms(450)) * 4,
    );
  });

  test("supersaw spreads unison voices across the stereo field", () => {
    const mono = render({ instrument: "sawtooth", synth: { attack: 0 } });
    const wide = render({ instrument: "supersaw", synth: { attack: 0 } });
    const side = (r: Rendered) => {
      const s = new Float64Array(r.left.length);
      for (let i = 0; i < s.length; i += 1) s[i] = r.left[i]! - r.right[i]!;
      return rms(s, ms(50), ms(450));
    };
    expect(side(mono)).toBeLessThan(1e-4);
    expect(side(wide)).toBeGreaterThan(0.005);
    const narrow = render({
      instrument: "supersaw",
      synth: { attack: 0, spread: 0 },
    });
    expect(side(narrow)).toBeLessThan(1e-4);
  });

  test("vibrato and the pitch envelope move the pitch", () => {
    const steady = render({ instrument: "sine", synth: { attack: 0 } }).left;
    const bent = render({
      instrument: "sine",
      synth: { attack: 0, penv: 12, pattack: 0, pdecay: 0.1, psustain: 0 },
    }).left;
    // penv starts an octave up (twice the zero crossings), then returns.
    expect(crossings(bent, ms(0), ms(15))).toBeGreaterThan(
      crossings(steady, ms(0), ms(15)) * 1.6,
    );
    expect(
      Math.abs(
        crossings(bent, ms(300), ms(450)) - crossings(steady, ms(300), ms(450)),
      ),
    ).toBeLessThan(30);
    const wobble = render(
      { instrument: "sine", synth: { attack: 0, vib: 5, vibmod: 2 } },
      { beats: 2 },
    ).left;
    // 5 Hz vibrato: windows a quarter period apart see different pitches.
    const rates = [0, 50, 100, 150].map((start) =>
      crossings(wobble, ms(200 + start), ms(240 + start)),
    );
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(40);
  });

  test("noise colours: white is brighter than pink, pink brighter than brown", () => {
    const zc = (instrument: string) =>
      crossings(
        render({ instrument, synth: { attack: 0 } }).left,
        ms(50),
        ms(450),
      );
    const white = zc("white");
    const pink = zc("pink");
    const brown = zc("brown");
    expect(white).toBeGreaterThan(pink * 1.5);
    expect(pink).toBeGreaterThan(brown * 1.5);
    // The noise mix control adds noise to a tone.
    const tone = render({ instrument: "sine", synth: { attack: 0 } }).left;
    const noisy = render({
      instrument: "sine",
      synth: { attack: 0, noise: 0.5 },
    }).left;
    expect(crossings(noisy, ms(50), ms(450))).toBeGreaterThan(
      crossings(tone, ms(50), ms(450)) * 3,
    );
  });

  test("crackle density sets how many impulses there are", () => {
    const count = (density: number) => {
      const { left } = render({
        instrument: "crackle",
        synth: { attack: 0, density },
      });
      let hits = 0;
      for (let i = ms(20); i < ms(450); i += 1)
        if (Math.abs(left[i]!) > 0.002 && left[i - 1] === 0) hits += 1;
      return hits;
    };
    expect(count(0.2)).toBeGreaterThan(count(0.02) * 3);
  });

  test("partials build a user waveform", () => {
    const { left } = render({
      instrument: "user",
      synth: { attack: 0, partials: [1, 0, 0.5] },
    });
    const from = ms(100);
    const to = ms(400);
    const h1 = bin(left, C4, from, to);
    expect(bin(left, 2 * C4, from, to) / h1).toBeLessThan(0.02);
    expect(bin(left, 3 * C4, from, to) / h1).toBeGreaterThan(0.4);
  });

  test("every preset renders audible, finite, unclipped audio", () => {
    for (const [name, preset] of Object.entries(SYNTH_PRESETS)) {
      const { left, right } = render(
        { instrument: preset.instrument, synth: preset.synth },
        { beats: 2 },
      );
      const level = Math.max(rms(left), rms(right));
      expect({ name, audible: level > 0.003 }).toEqual({
        name,
        audible: true,
      });
      let peak = 0;
      for (const v of left) peak = Math.max(peak, Math.abs(v));
      expect({ name, clipped: peak >= 0.999 }).toEqual({
        name,
        clipped: false,
      });
    }
  });

  test("synth renders are byte-identical across cold, cached and worker paths", async () => {
    const score = (attack: number) => {
      const tracks = Object.entries(SYNTH_PRESETS)
        .slice(0, 6)
        .map(([name, preset]) => ({
          id: name,
          name,
          instrument: preset.instrument,
          synth: { ...preset.synth, attack },
        }));
      return createScore({
        tempoBpm: 118,
        bars: 2,
        tracks,
        notes: tracks.flatMap((track, t) =>
          [0, 1, 2, 3].map((n) => ({
            id: `${track.id}-${n}`,
            trackId: track.id,
            startTick: n * 960 + t * 60,
            durationTicks: 600,
            pitch: 48 + t * 3 + n * 2,
            velocity: 0.7,
          })),
        ),
      });
    };
    const worker = new LoopRenderer({ sampleRate: 8_000 });
    const inline = new LoopRenderer({ sampleRate: 8_000, worker: false });
    try {
      for (const attack of [0.01, 0.05, 0.01]) {
        const cold = renderScorePcm(score(attack), {
          sampleRate: 8_000,
          loop: true,
        });
        const [a, b] = await Promise.all([
          worker.render(score(attack)),
          inline.render(score(attack)),
        ]);
        expect(a.pcm).toEqual(cold.pcm);
        expect(b.pcm).toEqual(cold.pcm);
        expect(cold.pcm.some((v) => v !== 0)).toBe(true);
      }
    } finally {
      worker.dispose();
      inline.dispose();
    }
  });
});

describe("synth filter envelopes", () => {
  const peak = (buffer: Float64Array) => {
    let out = 0;
    for (const value of buffer) out = Math.max(out, Math.abs(value));
    return out;
  };
  const one = (synth: Record<string, unknown>, pitch: number) =>
    peak(
      render({ instrument: "synth", synth: { gain: 0.1, ...synth } } as never, {
        pitch,
        beats: 2,
      }).left,
    );

  // A falling cutoff used to blow up the biquad's state: bpf 1000 with
  // bpenv -10 peaked 20 dB over the unfiltered note and clipped at full
  // gain. No filter (12db, 24db, each type) may exceed the dry peak by 6 dB
  // anywhere in the negative depth range.
  test("negative depths sweep down without transient spikes", () => {
    for (const pitch of [36, 60]) {
      const dry = one({}, pitch);
      for (const [type, prefix] of [
        ["lpf", "lp"],
        ["hpf", "hp"],
        ["bpf", "bp"],
      ] as const)
        for (const cutoff of [100, 1000, 8000])
          for (const depth of [-10, -6, -2, -0.5])
            for (const ftype of type === "lpf" ? ["12db", "24db"] : ["12db"]) {
              const wet = one(
                {
                  [type]: cutoff,
                  [`${prefix}env`]: depth,
                  [`${prefix}q`]: 1,
                  ftype,
                },
                pitch,
              );
              const over = 20 * Math.log10(wet / dry);
              if (over >= 6)
                throw new Error(
                  `${type} ${cutoff} ${prefix}env ${depth} ${ftype} at ${pitch}: +${over.toFixed(1)} dB`,
                );
            }
    }
  });

  // Seeded property run: random filter type, cutoff, resonance, depth
  // (negative), anchor, envelope times and pitch. No draw may exceed the dry
  // note by more than 6 dB plus the resonant gain a static filter of that Q
  // gives (Q per stage), or produce a non-finite sample.
  test("seeded fuzz: negative-depth envelopes stay bounded", () => {
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(next() * items.length)]!;
    const dryCache = new Map<number, number>();
    for (let run = 0; run < 24; run += 1) {
      const pitch = 30 + Math.floor(next() * 60);
      const [type, prefix] = pick([
        ["lpf", "lp"],
        ["hpf", "hp"],
        ["bpf", "bp"],
      ] as const);
      const synth: Record<string, unknown> = {
        [type]: Math.round(40 * 400 ** next()),
        [`${prefix}env`]: -Math.round(next() * 100) / 10 || -0.1,
        [`${prefix}q`]: Math.round((0.5 + next() * 7.5) * 10) / 10,
        ftype: type === "lpf" ? pick(["12db", "24db"]) : "12db",
        [`${prefix}attack`]: Math.round(next() * 300) / 1000,
        [`${prefix}decay`]: Math.round((0.01 + next() * 0.8) * 1000) / 1000,
        [`${prefix}sustain`]: Math.round(next() * 100) / 100,
      };
      if (type === "lpf") synth.fanchor = Math.round(next() * 100) / 100;
      if (!dryCache.has(pitch)) dryCache.set(pitch, one({}, pitch));
      const dry = dryCache.get(pitch)!;
      const { left } = render(
        { instrument: "synth", synth: { gain: 0.1, ...synth } } as never,
        { pitch, beats: 1 },
      );
      for (const value of left)
        if (!Number.isFinite(value)) throw new Error(JSON.stringify(synth));
      const over = 20 * Math.log10(peak(left) / dry);
      const stages = synth.ftype === "24db" ? 2 : 1;
      const q = synth[`${prefix}q`] as number;
      const bound = 6 + stages * 20 * Math.log10(Math.max(1, q));
      if (over >= bound)
        throw new Error(
          `${JSON.stringify(synth)} at ${pitch}: +${over.toFixed(1)} dB (bound ${bound.toFixed(1)})`,
        );
    }
  });

  test("bpenv -10 at full gain no longer clips", () => {
    for (const synth of [
      { bpf: 1000, bpenv: -10 },
      { lpf: 1000, lpenv: -10 },
      { lpf: 1000, lpenv: -10, ftype: "24db" },
    ]) {
      const { left } = render({ instrument: "synth", synth } as never, {
        beats: 2,
      });
      expect(peak(left)).toBeLessThan(0.99);
    }
  });
});
