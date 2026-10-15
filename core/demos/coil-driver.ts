/** Coil Driver: the acid techno demo song. */
import type { AutomationPoint, NoteInput } from "../score.ts";
import { BAR, Composer, hall, lanes, orbit, room, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/** One sixteenth step, in beats. */
const STEP = 0.25;
/** A TB-303 gate closes about halfway through its step. */
const GATE = STEP / 2;
/** The 303 slide is a constant time (about 60 to 90 ms), not a rate. */
const SLIDE = 0.075;
/** A light 909 shuffle: 54% puts every second sixteenth about 9 ms late. */
const SWING = 0.02;
/** The clap sits about 8 ms behind the grid; the kick stays dead on it. */
const CLAP_LATE = 0.018;

const PITCH_CLASS: Readonly<Record<string, number>> = {
  C: 0,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  Gb: 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
};

type AcidStep = {
  step: number;
  pitch: number;
  steps: number;
  accent: boolean;
  slide: boolean;
};

/**
 * A 16-step TB-303 pattern: `.` rests, `-` ties the previous note over the
 * step, `F2` plays a note, `!` accents it and `~` slides into it from the
 * note before (the gate holds and the pitch glides during this step).
 */
function acid(text: string): readonly AcidStep[] {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length !== 16) throw new Error(`acid pattern needs 16 steps`);
  const out: AcidStep[] = [];
  tokens.forEach((token, step) => {
    if (token === ".") return;
    const last = out[out.length - 1];
    if (token === "-") {
      if (last && last.step + last.steps === step) last.steps += 1;
      return;
    }
    const match = /^([A-G]b?)(\d)([!~]*)$/.exec(token);
    const pitchClass = match ? PITCH_CLASS[match[1]!] : undefined;
    if (!match || pitchClass === undefined)
      throw new Error(`bad acid step ${token}`);
    out.push({
      step,
      pitch: 12 * (Number(match[2]) + 1) + pitchClass,
      steps: 1,
      accent: match[3]!.includes("!"),
      slide: match[3]!.includes("~"),
    });
  });
  return out;
}

// The main coil: root pulse, an octave slide, the minor third and flat
// seventh accented off the beat, and a semitone slide home.
const A = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 . Db3 C3~");
const A2 = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 F3 Db3 C3~");
const A_TURN = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F3~ Eb3 C3 Ab2~");
const A_WIND = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 Ab2~ C3~ Eb3!~");
// The second cell jumps octaves and leans on the flat second.
const B = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 Bb2~ C3! . Eb3");
const B2 = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 Bb2~ C3! F3 Eb3");
const B_TURN = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 C3! - Eb3~ F3!~");
const B_FALL = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! F3 Ab3~ F3 Eb3~ C3~ Bb2~ Ab2~");
const MURMUR = acid("F2! . F2 . F2 . . F2 F2 . F2 F3~ . F2 . Eb2");
const BREAK = acid("F2! - - F3~ - . F2 . Ab2! - F2 Eb3~ - . C3 Db3~");
// The square 303 answers an octave above the main line, mostly off the beat.
const SQUARE = acid(". . F4! . . F4 Ab4~ . . . C5! . Bb4 Ab4~ . F4");
const SQUARE2 = acid(". . F4! . . F4 Ab4~ . . . C5! . Eb5 C5~ . Ab4");

/** Four-bar phrases end on a turnaround; eight-bar phrases wind upward. */
function mainCell(bar: number): readonly AcidStep[] {
  const inPhrase = bar % 8;
  if (inPhrase === 7) return A_WIND;
  if (inPhrase === 3) return A_TURN;
  return inPhrase % 4 === 2 ? A2 : A;
}

function peakCell(bar: number): readonly AcidStep[] {
  const inPhrase = bar % 8;
  if (inPhrase === 7) return B_TURN;
  if (inPhrase === 3) return B_FALL;
  return inPhrase % 4 === 2 ? B2 : B;
}

/** Small seeded generator: the song never reads `Math.random`. */
function seeded(seed: number): (amount: number) => number {
  let state = seed >>> 0;
  return (amount) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296 - 0.5) * 2 * amount;
  };
}

/**
 * A knob ride: keyframes `[bar, value]` joined by half-bar points that ease
 * in and out like a hand turning a pot, with a slow uneven wobble on top.
 */
function ride(
  keys: readonly (readonly [number, number])[],
  wobble: number,
  phase: number,
  min: number,
  max: number,
): AutomationPoint[] {
  const out: AutomationPoint[] = [];
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  for (let k = 0; k + 1 < keys.length; k++) {
    const [from, start] = keys[k]!;
    const [to, end] = keys[k + 1]!;
    for (let bar = from; bar < to - 1e-6; bar += 0.5) {
      const t = (bar - from) / (to - from);
      const eased = t * t * (3 - 2 * t);
      const hand =
        bar === from
          ? 0
          : wobble *
            (0.6 * Math.sin(bar * 1.37 + phase) +
              0.4 * Math.sin(bar * 3.11 + phase * 2.3));
      out.push({
        tick: Math.round(bar * BAR),
        value: clamp((start + (end - start) * eased) * (1 + hand)),
      });
    }
  }
  const [lastBar, lastValue] = keys[keys.length - 1]!;
  out.push({ tick: Math.round(lastBar * BAR), value: clamp(lastValue) });
  return out;
}

/**
 * The highest a note's filter envelope may sweep, in Hz. A real 303 never
 * opens much past 10 kHz, and the engine's ladder rings at the Nyquist
 * frequency once a resonant sweep passes about 12 kHz, which wastes the
 * headroom on a whistle nobody can hear.
 */
const PEAK_HZ = 11000;
/** Env mod the 303 keeps even at full cutoff, in octaves: the squelch. */
const MIN_ENV = 0.7;
/** Octaves an accent adds to each 303's filter sweep (`faccent`). */
const ACID_ACCENT = 1.5;
const SQUARE_ACCENT = 1.2;

/** A lane's value at `tick`, joining points with straight lines. */
function laneAt(points: readonly AutomationPoint[], tick: number): number {
  const after = points.findIndex((point) => point.tick >= tick);
  if (after < 0) return points[points.length - 1]!.value;
  const right = points[after]!;
  const left = points[after - 1];
  if (!left || right.tick === left.tick) return right.value;
  return (
    left.value +
    ((right.value - left.value) * (tick - left.tick)) / (right.tick - left.tick)
  );
}

/**
 * Fit a cutoff ride and an env mod ride inside the 303's travel. The cutoff
 * eases into a soft ceiling (a knob near the end of its turn) low enough
 * that every note keeps at least `MIN_ENV` octaves of sweep, and the env mod
 * comes down wherever cutoff × 2^(env mod + accent) would pass `PEAK_HZ`.
 */
function fitSweep(
  cutoff: readonly AutomationPoint[],
  envMod: readonly AutomationPoint[],
  accent: number,
): { cutoff: AutomationPoint[]; envMod: AutomationPoint[] } {
  const top = Math.log2(PEAK_HZ) - MIN_ENV - accent;
  const knee = 0.3;
  const fit = (hz: number) =>
    2 ** (top - knee * Math.log2(1 + 2 ** ((top - Math.log2(hz)) / knee)));
  const fitted = cutoff.map((p) => ({ tick: p.tick, value: fit(p.value) }));
  const ticks = [...new Set([...envMod, ...cutoff].map((p) => p.tick))].sort(
    (a, b) => a - b,
  );
  return {
    cutoff: fitted,
    envMod: ticks.map((tick) => ({
      tick,
      value: Math.max(
        0,
        Math.min(
          laneAt(envMod, tick),
          Math.log2(PEAK_HZ / laneAt(fitted, tick)) - accent,
        ),
      ),
    })),
  };
}

export const coilDriver: DemoDefinition = {
  info: demoInfo({
    id: "coil-driver",
    title: "Coil Driver",
    style: "Acid techno",
    description:
      "A hand-ridden F-minor 303 line coils from a closed-filter murmur to a screaming peak over a shuffled 909, breaks down to a lone resonant sweep and a snare roll, then a second 303 joins the overdrive before the knobs wind it all back down.",
    tempoBpm: 134,
    key: "Fm",
    bars: 64,
    highlightBar: 40,
    trackId: "acid",
    features: [
      "16-step 303 patterns with accents, slides and ties",
      "hand-ridden cutoff, resonance, env mod, decay and drive",
      "54% shuffled 909 hats, late clap, fills and a snare roll",
      "3-step 808 rim polymeter against the bar",
      "kickless breakdown and re-entry",
      "second square 303 at the peak",
    ],
    arrangement: [
      "Ignition 8",
      "Circuit 8",
      "Pressure 8",
      "Sparks 8",
      "Vacuum 8",
      "Re-entry 8",
      "Overdrive 8",
      "Power down 8",
    ],
    mixNotes: [
      "The 303 is quantized hard with half-step gates; slides hold the gate into the next step for 75 ms and accents open the ladder. The human part is the knob ride: cutoff, resonance, env mod, decay and drive move across all 64 bars.",
      "The kick owns the sub and ducks both 303s; a 45 Hz high-pass on the acid keeps filter energy off the kick fundamental.",
      "Hats swing 54% with a shaped sixteenth line, the clap sits about 8 ms late, and percussion thins out after every crash.",
      "Vacuum drops the kick for eight bars: the 303 alone near self-oscillation, then a snare roll and noise riser cut a sixteenth before the re-entry. The second peak changes the cell and the harmony instead of only adding volume.",
    ],
  }),
  build() {
    const s = new Composer(coilDriver.info);
    [
      "Ignition",
      "Circuit",
      "Pressure",
      "Sparks",
      "Vacuum",
      "Re-entry",
      "Overdrive",
      "Power down",
    ].forEach((name, i) => s.section(name, i * 8, 8));

    // Drums: one 909 split over three tracks so the hats can sit apart.
    s.track(
      voice("kick", "Kick", "kit", 0.6, {
        kit: "syn909",
        fx: { duck: { orbit: 2, depth: 0.48, attack: 0.17 } },
        humanize: { velocity: 2, seed: 7 },
      }),
    );
    s.track(
      voice("drums", "Clap, snare & toms", "kit", 0.36, {
        kit: "syn909",
        reverb: { mix: 0.1, size: 0.36, fade: 0.6 },
        humanize: { timing: 4, velocity: 4, seed: 23 },
      }),
    );
    s.track(
      voice("hats", "Hats & cymbals", "kit", 0.31, {
        kit: "syn909",
        pan: 0.16,
        reverb: { mix: 0.05, size: 0.22, fade: 0.5 },
        // A second hat a few milliseconds late on the other side: width
        // without moving the hats off the center of the groove.
        fx: { double: { time: 7, drift: 0.5, width: 0.55 } },
        humanize: { timing: 3, velocity: 4, seed: 19 },
      }),
    );

    // The knob ride over the whole song (Acid Tracks order: cutoff, then
    // resonance, decay and env mod up; at the end env mod and resonance go
    // to nothing and the cutoff closes).
    const cutoff = ride(
      [
        [0, 150],
        [4, 170],
        [8, 280],
        [12, 420],
        [15.5, 640],
        [16, 520],
        [20, 820],
        [23.5, 1250],
        [24, 900],
        [28, 1500],
        [31, 2300],
        [31.75, 2700],
        [32, 210],
        [34, 250],
        [36, 480],
        [38, 1400],
        [39.5, 3200],
        [40, 1750],
        [42, 1100],
        [44, 1350],
        [47.75, 2400],
        [48, 1600],
        [50, 2300],
        [52, 2800],
        [55.75, 4200],
        [56, 1900],
        [58, 1150],
        [60, 650],
        [62, 280],
        [63.75, 150],
      ],
      0.08,
      0.4,
      60,
      9000,
    );
    const resonance = ride(
      [
        [0, 4],
        [4, 4.5],
        [8, 5.5],
        [16, 7],
        [24, 8.5],
        [31, 10.5],
        [32, 11.4],
        [39, 11.8],
        [40, 9.5],
        [48, 10.5],
        [54, 11.8],
        [56, 10],
        [58, 6],
        [60, 3],
        [62, 1],
        [63.75, 0.8],
      ],
      0.04,
      1.1,
      0.7,
      12,
    );
    const envMod = ride(
      [
        [0, 1.4],
        [4, 1.6],
        [8, 2.4],
        [16, 3],
        [24, 3.6],
        [31, 4.2],
        [32, 2],
        [36, 2.8],
        [39, 4.5],
        [40, 4],
        [48, 4.4],
        [55, 5],
        [56, 3.6],
        [60, 1.2],
        [63.75, 0.4],
      ],
      0.06,
      2.3,
      0,
      6,
    );
    const decay = ride(
      [
        [0, 0.12],
        [4, 0.12],
        [16, 0.16],
        [24, 0.22],
        [31, 0.3],
        [32, 0.45],
        [39, 0.3],
        [40, 0.2],
        [48, 0.26],
        [55, 0.32],
        [56, 0.24],
        [63.75, 0.12],
      ],
      0.07,
      0.9,
      0.06,
      0.8,
    );
    const drive = ride(
      [
        [0, 0.6],
        [16, 0.9],
        [24, 1.2],
        [31, 1.8],
        [32, 1],
        [39, 2.2],
        [40, 1.6],
        [48, 2.4],
        [55, 3.2],
        [56, 1.6],
        [63.75, 0.6],
      ],
      0.05,
      3.1,
      0,
      10,
    );
    const acidSweep = fitSweep(cutoff, envMod, ACID_ACCENT);
    s.track(
      voice("acid", "Acid circuit", "saw", 1, {
        synth: {
          attack: 0.002,
          decay: 0.2,
          sustain: 0.5,
          release: 0.05,
          lpf: 300,
          lpq: 6,
          lpenv: 3,
          lpdecay: 0.18,
          lpsustain: 0,
          ftype: "ladder",
          faccent: ACID_ACCENT,
        },
        glide: { time: SLIDE, mode: "legato" },
        filter: { type: "hpf", cutoff: 45, resonance: 0.4 },
        delay: {
          beats: 0.75,
          feedback: 0.32,
          mix: 0.12,
          highcut: 3000,
          pingpong: true,
        },
        // Dub throws on phrase ends, a wetter break and a long tail.
        delayMixAutomation: lanes(
          [0, 0.1],
          [15.7, 0.1],
          [15.75, 0.3],
          [16.25, 0.1],
          [31.7, 0.1],
          [31.75, 0.34],
          [32, 0.24],
          [39.5, 0.2],
          [39.6, 0.32],
          [40.25, 0.12],
          [47.7, 0.12],
          [47.75, 0.3],
          [48.25, 0.12],
          [61, 0.14],
          [63, 0.42],
        ),
        fxAutomation: {
          "synth-lpf": acidSweep.cutoff,
          "synth-lpq": resonance,
          "synth-lpenv": acidSweep.envMod,
          "synth-lpdecay": decay,
          "distort-drive": drive,
        },
        fx: {
          ...orbit,
          distort: { type: "diode", drive: 0.8, mix: 0.28, tone: 5200 },
        },
      }),
    );
    const squareCutoff = ride(
      [
        [44, 480],
        [47.75, 1400],
        [48, 1100],
        [52, 1900],
        [55.75, 2800],
        [56, 1500],
        [58, 420],
      ],
      0.07,
      2.7,
      60,
      9000,
    );
    const squareSweep = fitSweep(
      squareCutoff,
      [{ tick: 0, value: 3 }],
      SQUARE_ACCENT,
    );
    s.track(
      voice("acid2", "Square circuit", "square", 0.46, {
        pan: -0.24,
        synth: {
          attack: 0.002,
          decay: 0.18,
          sustain: 0.4,
          release: 0.04,
          lpf: 700,
          lpq: 9,
          lpenv: 3,
          lpdecay: 0.16,
          lpsustain: 0,
          ftype: "ladder",
          faccent: SQUARE_ACCENT,
        },
        glide: { time: SLIDE, mode: "legato" },
        filter: { type: "hpf", cutoff: 220, resonance: 0.3 },
        delay: {
          beats: 0.5,
          feedback: 0.34,
          mix: 0.18,
          highcut: 4200,
          pingpong: true,
        },
        fxAutomation: {
          "synth-lpf": squareSweep.cutoff,
          "synth-lpenv": squareSweep.envMod,
          "synth-lpq": ride(
            [
              [44, 7],
              [48, 9],
              [55, 11],
              [58, 6],
            ],
            0.04,
            0.2,
            0.7,
            12,
          ),
        },
        fx: {
          ...orbit,
          distort: { type: "diode", drive: 1.4, mix: 0.3, tone: 6000 },
          // Hardfloor-style: the second box swims in a slow stereo chorus.
          chorus: { rate: 0.45, depth: 0.55, mix: 0.45 },
        },
      }),
    );
    s.track(
      voice("rim", "Rim machine", "kit", 0.22, {
        kit: "syn808",
        pan: -0.36,
        delay: { beats: 0.75, feedback: 0.22, mix: 0.12, pingpong: true },
        humanize: { timing: 2, velocity: 5, seed: 41 },
      }),
    );
    s.track(
      voice("bell", "Steel alarm", "modal", 0.13, {
        modal: { preset: "crotales" },
        pan: 0.36,
        reverb: hall,
        delay: {
          beats: 0.75,
          feedback: 0.38,
          mix: 0.2,
          highcut: 5000,
          pingpong: true,
        },
        humanize: { timing: 5, velocity: 5, seed: 53 },
      }),
    );
    // Risers sweep a resonant high-pass up; downlifters sweep it down.
    s.track(
      voice("noise", "Pressure release", "white", 0.11, {
        synth: { attack: 0.3, decay: 0.2, sustain: 0.5, release: 0.7 },
        filter: { type: "hpf", cutoff: 2800, resonance: 0.6 },
        reverb: room,
        volumeAutomation: lanes(
          [0, 0.01],
          [15, 0.01],
          [15.95, 0.12],
          [16, 0.01],
          [23, 0.01],
          [23.95, 0.14],
          [24, 0.01],
          [31.95, 0.01],
          [32, 0.16],
          [33.5, 0.01],
          [36, 0.01],
          [39.9, 0.2],
          [40, 0.01],
          [47, 0.01],
          [47.95, 0.14],
          [48, 0.01],
          [55.95, 0.01],
          [56, 0.13],
          [57, 0.01],
        ),
        filterAutomation: lanes(
          [0, 2800],
          [15, 900],
          [15.95, 6000],
          [16, 2800],
          [23, 900],
          [23.95, 6500],
          [24, 2800],
          [32, 7000],
          [33.5, 500],
          [36, 300],
          [39.9, 8000],
          [40, 2800],
          [47, 900],
          [47.95, 7000],
          [48, 2800],
          [56, 7000],
          [57, 600],
        ),
      }),
    );

    const jitter = seeded(0xc0115);
    const play = (
      trackId: string,
      bar: number,
      cell: readonly AcidStep[],
      transpose = 0,
      velocity = 0.64,
      fromStep = 0,
      toStep = 16,
    ) => {
      for (const n of cell) {
        if (n.step < fromStep || n.step >= toStep) continue;
        const extra: Partial<NoteInput> = {
          ...(n.slide ? { glide: SLIDE } : {}),
          ...(n.accent ? { articulation: "accent" as const } : {}),
        };
        s.note(
          trackId,
          bar,
          n.step * STEP,
          n.pitch + transpose,
          n.steps * STEP - GATE,
          velocity,
          extra,
        );
      }
    };

    // --- 909 parts ---------------------------------------------------------
    const kick = (bar: number, beats = 4, pickup = false) => {
      const shape = [0.97, 0.9, 0.94, 0.9];
      for (let beat = 0; beat < beats; beat++)
        s.note("kick", bar, beat, 36, 0.3, shape[beat]! + jitter(0.015));
      if (pickup) s.note("kick", bar, 3.75, 36, 0.2, 0.6);
    };
    // 1 e & a: the offbeat leads, the e is softest (push and pull).
    const HAT_SHAPE = [0.5, 0.33, 0.74, 0.42];
    const hats = (
      bar: number,
      gain: number,
      opts: {
        sixteenths?: boolean;
        open?: readonly number[];
        afterCrash?: boolean;
        until?: number;
      } = {},
    ) => {
      const open = opts.open ?? [];
      for (let step = 0; step < (opts.until ?? 16); step++) {
        const pos = step % 4;
        const beat = step * STEP + (pos % 2 ? SWING : 0);
        const lift = opts.afterCrash && step < 4 ? 0.7 : 1;
        // The bar leans into its last beat.
        const lean = 1 + (step >= 12 ? 0.06 : 0);
        if (open.includes(step)) {
          s.note("hats", bar, beat, 46, 0.24, (0.6 + jitter(0.04)) * gain);
          continue;
        }
        if (!opts.sixteenths && pos !== 2) continue;
        s.note(
          "hats",
          bar,
          beat,
          42,
          0.1,
          (HAT_SHAPE[pos]! + jitter(0.05)) * gain * lift * lean,
        );
      }
    };
    const OFFBEATS = [2, 6, 10, 14];
    const ride8 = (bar: number, gain: number, downbeats: boolean) => {
      for (let beat = 0; beat < 4; beat++) {
        s.note("hats", bar, beat + 0.5, 51, 0.5, (0.6 + jitter(0.05)) * gain);
        if (downbeats)
          s.note("hats", bar, beat, 51, 0.5, (0.4 + jitter(0.05)) * gain);
      }
    };
    const crash = (bar: number, velocity = 0.78) =>
      s.note("hats", bar, 0, 49, 2, velocity);
    const clap = (bar: number, gain = 1, snare = false) => {
      for (const beat of [1, 3]) {
        const velocity = (beat === 1 ? 0.8 : 0.86) + jitter(0.03);
        s.note("drums", bar, beat + CLAP_LATE, 39, 0.2, velocity * gain);
        if (snare) s.note("drums", bar, beat, 38, 0.2, 0.42 * gain);
      }
    };
    const snareFill = (bar: number, lift = 1) => {
      [0.42, 0.52, 0.64, 0.8].forEach((velocity, i) =>
        s.note("drums", bar, 3 + i * STEP, 38, 0.14, velocity * lift),
      );
    };
    const clapRoll = (bar: number) => {
      [0.36, 0.46, 0.6, 0.78].forEach((velocity, i) =>
        s.note("drums", bar, 3 + i * STEP + CLAP_LATE, 39, 0.14, velocity),
      );
    };
    const tomFill = (bar: number, from = 2) => {
      const toms = [50, 50, 48, 48, 47, 45, 43, 41];
      toms.forEach((pitch, i) => {
        const beat = from + i * STEP;
        if (beat >= 4) return;
        s.note("drums", bar, beat, pitch, 0.2, 0.5 + i * 0.05 + jitter(0.03));
      });
    };
    // 808 rim on a 3-step cell that keeps running across the bar line, so
    // it lands somewhere new every bar and realigns every three bars.
    const rim = (bar: number, gain: number, cowbell = false) => {
      for (let step = 0; step < 16; step++) {
        const g = bar * 16 + step;
        const beat = step * STEP + (step % 2 ? SWING : 0);
        if (g % 3 === 0) {
          const accent = (g / 3) % 4 === 0;
          s.note(
            "rim",
            bar,
            beat,
            37,
            0.1,
            ((accent ? 0.78 : 0.48) + jitter(0.05)) * gain,
          );
        }
        if (cowbell && g % 5 === 2)
          s.note("rim", bar, beat, 56, 0.1, (0.3 + jitter(0.04)) * gain);
      }
    };

    for (let b = 0; b < 64; b++) {
      const section = Math.floor(b / 8);
      const inSection = b % 8;
      const crashBar = [16, 24, 32, 40, 48, 56].includes(b);
      if (crashBar) crash(b, b === 40 || b === 48 ? 0.86 : 0.74);

      // Kick: dead on the grid; holes and pickups mark phrase ends.
      if (b < 32 || (b >= 40 && b < 62)) {
        if (b === 15 || b === 47) kick(b, 3);
        else if (b === 31) kick(b, 2);
        else kick(b, 4, [11, 19, 27, 43, 51].includes(b));
      }

      // Hats and cymbals.
      if (section === 0) {
        if (b < 2) hats(b, 0.5);
        else hats(b, b < 4 ? 0.62 : 0.74, {
          sixteenths: true,
          open: b >= 6 ? [14] : [],
        });
      } else if (section === 1) {
        hats(b, 0.9, {
          sixteenths: true,
          open: b >= 12 ? [6, 14] : [14],
          afterCrash: false,
        });
      } else if (section === 2 || section === 3) {
        hats(b, 1, { sixteenths: true, open: OFFBEATS, afterCrash: crashBar });
        if (b >= 20 && b < 28) ride8(b, 0.85, false);
        if (b >= 28) ride8(b, 0.9, true);
      } else if (section === 4) {
        if (b === 37) hats(b, 0.5);
        if (b === 38) hats(b, 0.6, { sixteenths: true });
        if (b === 39) hats(b, 0.7, { sixteenths: true, until: 8 });
      } else if (section === 5 || section === 6) {
        hats(b, 1, { sixteenths: true, open: OFFBEATS, afterCrash: crashBar });
        if (section === 5 && b >= 44) ride8(b, 0.85, false);
        if (section === 6) ride8(b, 0.95, true);
      } else {
        if (b < 60)
          hats(b, 0.95, {
            sixteenths: true,
            open: b < 58 ? OFFBEATS : [6, 14],
            afterCrash: crashBar,
          });
        else if (b < 62) hats(b, 0.7);
      }

      // Clap, snare and fills.
      if (b === 7) s.note("drums", b, 3 + CLAP_LATE, 39, 0.2, 0.55);
      if ((b >= 8 && b < 32) || (b >= 40 && b < 60))
        clap(b, b >= 56 ? 0.9 : 1, section === 6);
      if (b === 15 || b === 47) snareFill(b);
      if (b === 23) clapRoll(b);
      if (b === 31) tomFill(b, 2);
      if (b === 55) {
        tomFill(b, 2.5);
        s.note("drums", b, 2, 38, 0.14, 0.5);
        s.note("drums", b, 2.25, 38, 0.14, 0.58);
      }
      if ([19, 27, 43, 51].includes(b))
        s.note("drums", b, 3.75 + CLAP_LATE, 39, 0.14, 0.3);
      // Vacuum's snare roll: quarters, eighths, sixteenths, then 32nds,
      // rising to the last sixteenth, which is left empty.
      if (b >= 36 && b < 40) {
        const rate = [1, 0.5, 0.25, 0.125][b - 36]!;
        for (let beat = 0; beat < 4 - 1e-9; beat += rate) {
          if (b === 39 && beat >= 3.75) break;
          if (b === 39 && beat < 2 && (beat * 8) % 2) continue;
          const progress = (b - 36 + beat / 4) / 4;
          s.note(
            "drums",
            b,
            beat,
            38,
            0.12,
            0.28 + 0.66 * progress ** 1.4 + jitter(0.03),
          );
        }
      }

      // Rim polymeter from Pressure, with a cowbell cell at the peak.
      if ((b >= 16 && b < 32) || (b >= 40 && b < 58))
        rim(b, b >= 56 ? 0.75 : 1, section === 6);

      // The 303.
      if (b >= 4 && b < 8) play("acid", b, MURMUR, 0, 0.6);
      else if (b >= 8 && b < 24) play("acid", b, mainCell(b));
      else if (b >= 24 && b < 32) {
        // Sparks: the second cell, with a VI - VII lift before the break.
        const transpose = [0, 0, 0, 0, -4, -4, -2, 0][inSection]!;
        play("acid", b, b === 31 ? B_TURN : peakCell(b), transpose);
      } else if (b >= 32 && b < 36) play("acid", b, BREAK, 0, 0.6);
      else if (b >= 36 && b < 39) play("acid", b, b === 38 ? A2 : A);
      else if (b === 39) play("acid", b, A, 0, 0.64, 0, 8);
      else if (b >= 40 && b < 48) play("acid", b, mainCell(b), 0, 0.66);
      else if (b >= 48 && b < 56) {
        // Overdrive: i - VI - VII - i in two-bar steps.
        const transpose = [0, 0, -4, -4, -2, -2, 0, 0][inSection]!;
        play("acid", b, peakCell(b), transpose, 0.66);
        play("acid2", b, b % 2 ? SQUARE2 : SQUARE, transpose, 0.6);
      } else if (b >= 56 && b < 62) play("acid", b, mainCell(b), 0, 0.62);
      else if (b === 62) play("acid", b, MURMUR, 0, 0.58);
      else if (b === 63)
        s.note("acid", b, 0, 41, 0.6, 0.62, { articulation: "accent" });
      if (b >= 44 && b < 48)
        play("acid2", b, b % 2 ? SQUARE2 : SQUARE, 0, 0.5, 8, 16);
      if (b >= 56 && b < 58) play("acid2", b, SQUARE, 0, 0.5, 0, 12);

      // Steel alarm: a call, its repeat, then an answer that climbs.
      const bellRoot = [0, 0, -4, -4, -2, -2, 0, 0][inSection]!;
      if ([24, 28, 44].includes(b))
        s.phrase("bell", b, [
          [0, 77, 1.6, 0.5],
          [1.5, 75, 0.6, 0.36],
          [2.25, 72, 1.5, 0.44],
        ]);
      if ([26, 46].includes(b))
        s.phrase("bell", b, [
          [0, 77, 1.6, 0.48],
          [1.5, 75, 0.6, 0.36],
          [2.25, 80, 1.5, 0.46],
        ]);
      if (b === 30)
        s.phrase("bell", b, [
          [0, 77, 1.2, 0.5],
          [1.5, 80, 0.6, 0.42],
          [2.25, 84, 1.7, 0.52],
        ]);
      if (b === 33) s.note("bell", b, 0, 77, 3, 0.4);
      if (b === 35) s.note("bell", b, 2, 72, 2, 0.34);
      if (b === 37) s.note("bell", b, 0, 80, 2, 0.38);
      if (section === 6 && inSection % 2 === 0)
        s.phrase(
          "bell",
          b,
          inSection === 6
            ? [
                [0, 77, 1.2, 0.52],
                [1.5, 80, 0.6, 0.44],
                [2.25, 84, 1.7, 0.56],
              ]
            : [
                [0, 77 + (bellRoot === -2 ? 2 : 0), 1.6, 0.5],
                [1.5, 75, 0.6, 0.38],
                [2.25, 72 + bellRoot, 1.5, 0.46],
              ],
        );
      if (b === 58) s.note("bell", b, 0, 77, 2, 0.34);
      if (b === 62) s.note("bell", b, 0, 77, 4, 0.36);

      // Noise: risers into sections, downlifters out of the peaks.
      if ([15, 23, 47].includes(b)) s.note("noise", b, 0, 72, 3.95, 0.7);
      if (b === 32) s.note("noise", b, 0, 72, 6, 0.7);
      if (b === 36) s.note("noise", b, 0, 72, 15.9, 0.72);
      if (b === 56) s.note("noise", b, 0, 72, 4, 0.66);
    }
    return s.finish();
  },
};
