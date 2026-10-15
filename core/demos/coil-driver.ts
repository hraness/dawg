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
// The first two bars of each phrase lean down to the flat seventh instead
// of the octave, so the octave jump is an event when it returns.
const A_LOW = acid("F2! . F2 Eb2~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 . Db3 C3~");
const A2 = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 F3 Db3 C3~");
// The golden bars: bar 6 of a section climbs once past the octave, higher
// each time it comes round (Ab3, then a 4-3 slide onto Ab3 from Bb3, then
// C4). Steps 1, 5 and 13 stay empty so the hocket partner's peak lands.
const A_GOLD_1 = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ Ab3~ . Eb3 C3~");
const A_GOLD_2 = acid(
  "F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ Ab3 . Bb3!~ Ab3~",
);
const A_GOLD_3 = acid(
  "F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ Ab3~ . C4! Ab3~",
);
const A_TURN = acid("F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F3~ Eb3 C3 Ab2~");
const A_WIND = acid(
  "F2! . F2 F3~ F2 . Ab2! F2 C3 - F2 Eb3!~ F2 Ab2~ C3~ Eb3!~",
);
// The second cell jumps octaves and leans on the flat second.
const B = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 Bb2~ C3! . Eb3");
const B2 = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 Bb2~ C3! F3 Eb3");
const B_TURN = acid("F2! F3 F2 . F2 F3~ Gb3 F3~ F2! . Ab2 F2 C3! - Eb3~ F3!~");
const B_FALL = acid(
  "F2! F3 F2 . F2 F3~ Gb3 F3~ F2! F3 Ab3~ F3 Eb3~ C3~ Bb2~ Ab2~",
);
const MURMUR = acid("F2! . F2 . F2 . . F2 F2 . F2 F3~ . F2 . Eb2");
const BREAK = acid("F2! - - F3~ - . F2 . Ab2! - F2 Eb3~ - . C3 Db3~");
// The hocket partner: the square box plays only the holes of the main cell,
// an octave up, so the sum of the two boxes is one sixteenth line. Its three
// notes outline the chord's upper structure (b3 5 b7), rising one bar and
// falling the next.
const H_RISE = acid(". Ab3 . . . C4 . . . . . . . Eb4! . .");
const H_FALL = acid(". Eb4 . . . C4 . . . . . . . Ab3! . .");
// The partner's one peak: the late bar of a section's second phrase climbs
// to the root above.
const H_PEAK = acid(". C4 . . . Eb4 . . . . . . . F4! . .");
// Sparks: the peak cell thinned to its accents and slides, which the square
// box plays one beat late an octave up: a Reich-style offset canon.
const B_THIN = acid("F2! . . . . F3~ . . F2! . . . Bb2~ C3! . Eb3");
// Overdrive: the square box answers in the peak cell's rests (and doubles
// one slide); its top note walks up one bar (Ab F C Eb) and down the next.
const SQ_UP = acid(". . . Ab4 . . . F4 . C5! . . . . Eb5~ .");
const SQ_DOWN = acid(". . . Eb5 . . . C5 . Ab4! . . . . F4~ .");
const SQ_TOP = acid(". . . F5 . . . Eb5 . C5! . . . . Ab4~ .");

/** The steps a cell leaves empty: nothing sounding, no tie held. */
function holes(cell: readonly AcidStep[]): Set<number> {
  const busy = new Set<number>();
  for (const n of cell) for (let i = 0; i < n.steps; i++) busy.add(n.step + i);
  return new Set([...Array(16).keys()].filter((step) => !busy.has(step)));
}

/** Only the partner's notes that land in the main cell's holes. */
function inHoles(
  partner: readonly AcidStep[],
  main: readonly AcidStep[],
): readonly AcidStep[] {
  const free = holes(main);
  return partner.filter((n) => free.has(n.step));
}

/** The same cell `by` steps later, wrapping inside the bar (a Reich offset). */
function shift(cell: readonly AcidStep[], by: number): readonly AcidStep[] {
  return cell
    .map((n) => ({ ...n, step: (n.step + by) % 16 }))
    .sort((a, b) => a.step - b.step);
}
/** F natural minor as semitones above the root. */
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/**
 * The same cell moved `degrees` scale steps inside F minor, so a cell on i
 * lands on VI or VII with that chord's own third and seventh instead of a
 * literal copy's Fb and Cb against the major stabs. A chromatic note (the
 * flat-second lean) stays the upper neighbour of the degree below it.
 */
function diatonic(
  cell: readonly AcidStep[],
  degrees: number,
): readonly AcidStep[] {
  if (degrees === 0) return cell;
  const move = (pitch: number) => {
    const rel = (((pitch - 5) % 12) + 12) % 12;
    let degree = MINOR.indexOf(rel);
    let lift = 0;
    if (degree < 0) {
      degree = MINOR.filter((s) => s < rel).length - 1;
      lift = 1;
    }
    const target = degree + degrees;
    const octave = Math.floor(target / 7);
    return pitch - rel + MINOR[((target % 7) + 7) % 7]! + 12 * octave + lift;
  };
  return cell.map((n) => ({ ...n, pitch: move(n.pitch) }));
}
/**
 * Four-bar phrases end on a turnaround; eight-bar phrases open low, peak
 * once on their sixth bar (higher each section) and wind upward.
 */
function mainCell(bar: number): readonly AcidStep[] {
  const inPhrase = bar % 8;
  if (inPhrase === 7) return A_WIND;
  if (inPhrase === 6) {
    const section = Math.floor(bar / 8);
    if (section === 1) return A_GOLD_1;
    if (section === 2) return A_GOLD_2;
    if (section === 5) return A_GOLD_3;
  }
  if (inPhrase === 3) return A_TURN;
  if (inPhrase < 2) return A_LOW;
  return inPhrase === 2 ? A2 : A;
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
const MIN_ENV = 0.35;
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
      "Two F-minor 303s hocket one sixteenth line between them, trade halves, then chase each other a beat apart over a shuffled 909 and a sub pedal, the line lifting onto VI and VII by scale step; the kick drops out for dub chord stabs under a crotale that holds a 7-6 suspension chain over a falling bass, a bit-crushed roll and half a bar of silence, and the drop lands a thrown stab with both boxes in octaves before the knobs wind down.",
    tempoBpm: 134,
    key: "Fm",
    bars: 64,
    highlightBar: 40,
    trackId: "acid",
    features: [
      "two 303s in a hocket: the square box plays the saw's holes an octave up; each 8-bar phrase opens low and peaks once on its sixth bar, higher every section",
      "trade bars (call and response) and a Reich-style one-beat offset canon",
      "dub chord stabs with delay throws under a crotale 7-6 suspension chain over i VII VI V, a last 4-3 over the pedal",
      "sub pedal under the VI-VII lift, walking bass in the breakdown",
      "hand-ridden cutoff, resonance, env mod, decay and drive on both boxes",
      "beat repeats at phrase ends, crush sweep and a silent half bar into the drop",
      "hat ratchet glitch fill with a tom pitch rise, one pitch-jumped stab",
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
      "The saw 303 is the bass voice of the pair, centered with a 9 ms double for width; the square box plays an octave up, panned hard left in a slow chorus, with its own filter ride and a short delay so the hocket's holes stay holes.",
      "The sub pedal is a sine on F1 that only plays off the kick (and ducks under it); it sits out the first two bars of the breakdown and arrives quietly on the Eb, then walks Eb Db C with glides into each root while the crotale holds each 7th over the new root, the saw rests, and the stabs answer with the 6/3 chord (an open fifth on V).",
      "Dub stabs run through a dotted-eighth ping-pong delay whose feedback and send are thrown every two bars; the tone climbs across Vacuum and the last throw is cut dead for the silent half bar.",
      "The crush sweep (bits 14 to 4, mix 0 to 0.9) rides the acid and the snare roll over the last bar and a half of the build and snaps clean on the drop; the drop lands a downbeat stab thrown into the delay with the square box doubling the saw an octave up for two bars and the kick's duck pumping.",
      "The cutoff eases into a soft ceiling so even the loudest accent keeps its squelch below 11 kHz; hats swing 54% with a 7 ms double for width, the clap sits 8 ms late.",
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

    // The silent half bar before the drop: every pitched track is gated
    // from the middle of bar 39 to the downbeat of 40.
    const gate = lanes([39.49, 1], [39.5, 0], [39.99, 0], [40, 1]);
    // The crush sweep into the drop (acid and the snare roll), snapped clean.
    const crushMix = lanes(
      [37.5, 0],
      [38, 0.12],
      [39, 0.55],
      [39.45, 0.9],
      [39.5, 0],
    );
    const crushBits = lanes([37.5, 14], [38.5, 9], [39.45, 4], [39.5, 16]);

    // Drums: one 909 split over three tracks so the hats can sit apart.
    s.track(
      voice("kick", "Kick", "kit", 0.6, {
        kit: "syn909",
        fx: { duck: { orbit: 2, depth: 0.48, attack: 0.17 } },
        humanize: { velocity: 2, seed: 7 },
      }),
    );
    s.track(
      voice("drums", "Clap, snare & toms", "kit", 0.44, {
        kit: "syn909",
        reverb: { mix: 0.1, size: 0.36, fade: 0.6 },
        humanize: { timing: 4, velocity: 4, seed: 23 },
        fx: { crush: { bits: 16, coarse: 1, mix: 0 } },
        fxAutomation: { "crush-mix": crushMix, "crush-bits": crushBits },
      }),
    );
    s.track(
      voice("hats", "Hats & cymbals", "kit", 0.31, {
        kit: "syn909",
        pan: 0.2,
        reverb: { mix: 0.05, size: 0.22, fade: 0.5 },
        // A second hat a few milliseconds late on the other side: width
        // without moving the hats off the center of the groove.
        fx: { double: { time: 11, drift: 0.5, width: 0.9 } },
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
        [16, 1.2],
        [24, 1.6],
        [31, 2.4],
        [32, 1.2],
        [39, 2.9],
        [40, 2.1],
        [48, 3.1],
        [55, 4.2],
        [56, 2],
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
        // Dub throws on phrase ends, a wetter break and a long tail; the
        // send is cut for the silent half bar.
        delayMixAutomation: lanes(
          [0, 0.14],
          [15.7, 0.14],
          [15.75, 0.34],
          [16.25, 0.14],
          [31.7, 0.14],
          [31.75, 0.36],
          [32, 0.24],
          [39.45, 0.2],
          [39.5, 0],
          [40, 0.16],
          [47.7, 0.16],
          [47.75, 0.34],
          [48.25, 0.16],
          [61, 0.16],
          [63, 0.42],
        ),
        // Vacuum: the saw sits 3 dB back for its two bars of BREAK, rests
        // while the chain is exposed, and comes back under the roll.
        volumeAutomation: [
          ...lanes(
            [0, 1],
            [31.9, 1],
            [32, 0.65],
            [35.9, 0.65],
            [36, 0.8],
            [38, 1],
          ),
          ...gate,
        ],
        fxAutomation: {
          "synth-lpf": acidSweep.cutoff,
          "synth-lpq": resonance,
          "synth-lpenv": acidSweep.envMod,
          "synth-lpdecay": decay,
          "distort-drive": drive,
          "crush-mix": crushMix,
          "crush-bits": crushBits,
        },
        fx: {
          ...orbit,
          crush: { bits: 16, coarse: 1, mix: 0 },
          distort: { type: "diode", drive: 0.8, mix: 0.42, tone: 5200 },
          // A 9 ms second take on the other side: the saw stays the center
          // voice (the master folds everything under 120 Hz to mono) but
          // its squelch spreads, which is where the width of the mix lives.
          double: { time: 9, drift: 0.4, width: 0.7 },
        },
      }),
    );
    // The square box rides its own knobs: darker than the saw while it
    // hockets, opening with the song and screaming with it at the peaks.
    const squareCutoff = ride(
      [
        [12, 360],
        [16, 520],
        [20, 800],
        [23.75, 1500],
        [24, 800],
        [28, 1300],
        [31.75, 2300],
        [32, 300],
        [40, 1200],
        [44, 1500],
        [47.75, 2400],
        [48, 1700],
        [52, 2600],
        [55.75, 3600],
        [56, 1500],
        [58, 600],
        [62, 300],
      ],
      0.07,
      2.7,
      60,
      9000,
    );
    const squareSweep = fitSweep(
      squareCutoff,
      ride(
        [
          [12, 2],
          [24, 2.6],
          [31, 3.4],
          [32, 2],
          [48, 3.2],
          [55, 4],
          [56, 2.4],
          [62, 1],
        ],
        0.05,
        1.7,
        0,
        6,
      ),
      SQUARE_ACCENT,
    );
    s.track(
      voice("acid2", "Square circuit", "square", 0.62, {
        pan: -0.55,
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
        // Short and dry so the hocket's holes stay holes; it gets wetter
        // only where it answers alone.
        delay: {
          beats: 0.5,
          feedback: 0.24,
          mix: 0.08,
          highcut: 4200,
          pingpong: true,
        },
        delayMixAutomation: lanes(
          [0, 0.12],
          [23.7, 0.12],
          [23.75, 0.32],
          [24.25, 0.12],
          [39.5, 0],
          [40, 0.12],
          [48, 0.16],
          [56, 0.12],
          [60, 0.3],
        ),
        volumeAutomation: gate,
        fxAutomation: {
          "synth-lpf": squareSweep.cutoff,
          "synth-lpenv": squareSweep.envMod,
          "synth-lpq": ride(
            [
              [12, 5],
              [24, 7.5],
              [31, 10],
              [32, 6],
              [40, 8],
              [48, 9.5],
              [55, 11.5],
              [58, 6],
              [62, 2],
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
          chorus: { rate: 0.45, depth: 0.7, mix: 0.55 },
        },
      }),
    );
    // A sine sub: the pedal point under the lifts, the walking bass of the
    // breakdown. Off the kick and ducked by it, so the two never fight.
    s.track(
      voice("sub", "Sub pedal", "sine", 0.58, {
        synth: {
          attack: 0.004,
          decay: 0.12,
          sustain: 0.85,
          release: 0.09,
          lpf: 220,
        },
        glide: { time: 0.1, mode: "legato" },
        fx: orbit,
        volumeAutomation: [...gate, ...lanes([56, 1], [60, 0.9], [63.9, 0.45])],
      }),
    );
    // Dub chord stabs through a dotted-eighth feedback delay: the tone
    // climbs across the breakdown, the send and feedback are thrown every
    // two bars, and the last throw is cut dead for the silent half bar.
    s.track(
      voice("stabs", "Dub coil", "supersaw", 0.46, {
        pan: 0.14,
        synth: {
          attack: 0.004,
          decay: 0.3,
          sustain: 0.18,
          release: 0.14,
          unison: 3,
          detune: 0.12,
          spread: 1,
          lpf: 4500,
          lpenv: 0.8,
          lpdecay: 0.2,
          hpf: 150,
        },
        filter: { type: "lpf", cutoff: 1200, resonance: 0.3 },
        filterAutomation: lanes(
          [0, 1200],
          [34, 1500],
          [38, 2600],
          [39.4, 3600],
          [39.5, 2200],
          [41, 1400],
          [48, 2200],
          [55, 3800],
          [56, 1400],
          [62, 900],
        ),
        delay: {
          beats: 0.75,
          feedback: 0.46,
          mix: 0.26,
          pingpong: true,
          highcut: 2600,
        },
        delayFeedbackAutomation: lanes(
          [0, 0.46],
          [33.4, 0.46],
          [33.5, 0.72],
          [34, 0.5],
          [35.4, 0.5],
          [35.5, 0.74],
          [36, 0.52],
          [37.4, 0.52],
          [37.5, 0.78],
          [38, 0.54],
          [38.7, 0.54],
          [38.75, 0.86],
          [39.5, 0.4],
          [39.99, 0.4],
          [40, 0.7],
          [41, 0.5],
          [48, 0.5],
          [55.4, 0.5],
          [55.5, 0.8],
          [56, 0.5],
          [60, 0.72],
        ),
        delayMixAutomation: lanes(
          [0, 0.26],
          [33.4, 0.26],
          [33.5, 0.56],
          [34, 0.3],
          [35.4, 0.3],
          [35.5, 0.58],
          [36, 0.3],
          [37.4, 0.3],
          [37.5, 0.6],
          [38, 0.32],
          [38.7, 0.32],
          [38.75, 0.7],
          [39.45, 0.7],
          [39.5, 0],
          [39.99, 0],
          [40, 0.62],
          [40.75, 0.2],
          [55.4, 0.2],
          [55.5, 0.5],
          [56, 0.26],
          [60, 0.42],
          [63, 0.5],
        ),
        reverb: { ...room, mix: 0.08 },
        volumeAutomation: gate,
        fx: orbit,
      }),
    );
    s.track(
      voice("rim", "Rim machine", "kit", 0.3, {
        kit: "syn808",
        pan: -0.5,
        delay: { beats: 0.75, feedback: 0.22, mix: 0.12, pingpong: true },
        humanize: { timing: 2, velocity: 5, seed: 41 },
        fx: orbit,
      }),
    );
    s.track(
      voice("bell", "Steel alarm", "modal", 0.2, {
        modal: { preset: "crotales" },
        pan: 0.6,
        reverb: hall,
        delay: {
          beats: 0.75,
          feedback: 0.38,
          mix: 0.2,
          highcut: 5000,
          pingpong: true,
        },
        volumeAutomation: gate,
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
          [39.45, 0.2],
          [39.5, 0],
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
          [39.45, 8000],
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
    // A beat repeat: the cell's last half beat (steps 14 and 15) re-fired
    // as 1/32 notes with a velocity ramp, up for a build or down for a fade.
    const stutter = (
      trackId: string,
      bar: number,
      cell: readonly AcidStep[],
      transpose: number,
      from: number,
      to: number,
    ) => {
      const pitches = cell
        .filter((n) => n.step >= 14)
        .map((n) => n.pitch + transpose);
      if (pitches.length === 0) return;
      for (let i = 0; i < 4; i++)
        s.note(
          trackId,
          bar,
          3.5 + i / 8,
          pitches[i % pitches.length]!,
          0.07,
          from + ((to - from) * i) / 3,
          i === 3 ? { articulation: "accent" } : {},
        );
    };
    // The two boxes trade halves of one cell: the saw asks, the square
    // answers an octave up; a phrase-end beat repeat finishes the answer.
    const trade = (
      bar: number,
      cell: readonly AcidStep[],
      velocity: number,
      repeat: boolean,
    ) => {
      play("acid", bar, cell, 0, velocity, 0, 8);
      play("acid2", bar, cell, 12, velocity - 0.06, 8, repeat ? 14 : 16);
      if (repeat) stutter("acid2", bar, cell, 12, 0.4, 0.68);
    };
    // The square box as hocket partner: only the holes of the saw's cell,
    // rising one bar and falling the next.
    const hocket = (
      bar: number,
      cell: readonly AcidStep[],
      velocity: number,
    ) => {
      const partner = bar % 8 === 6 ? H_PEAK : bar % 2 ? H_FALL : H_RISE;
      play("acid2", bar, inHoles(partner, cell), 0, velocity);
    };

    // --- 909 parts ---------------------------------------------------------
    // The arc lives in the drums too: Ignition sits a few dB under Sparks.
    const KICK_GAIN = [0.78, 0.9, 0.95, 1, 1, 1, 1.06, 0.92];
    const kick = (bar: number, beats = 4, pickup = false) => {
      const shape = [0.97, 0.9, 0.94, 0.9];
      const gain = KICK_GAIN[Math.floor(bar / 8)]!;
      for (let beat = 0; beat < beats; beat++)
        s.note(
          "kick",
          bar,
          beat,
          36,
          0.3,
          Math.min(1, (shape[beat]! + jitter(0.015)) * gain),
        );
      if (pickup) s.note("kick", bar, 3.75, 36, 0.2, 0.6 * gain);
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
        skip?: readonly number[];
      } = {},
    ) => {
      const open = opts.open ?? [];
      const skip = opts.skip ?? [];
      for (let step = 0; step < (opts.until ?? 16); step++) {
        if (skip.includes(step)) continue;
        const pos = step % 4;
        const beat = step * STEP + (pos % 2 ? SWING : 0);
        const lift = opts.afterCrash && step < 4 ? 0.7 : 1;
        // The bar leans into its last beat.
        const lean = 1 + (step >= 12 ? 0.06 : 0);
        if (open.includes(step)) {
          s.note("hats", bar, beat, 46, 0.24, (0.66 + jitter(0.04)) * gain);
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
    // Micro-variation: every fourth bar drops one sixteenth, every eighth
    // moves an open hat.
    const hatVar = (bar: number) => ({
      skip: bar % 4 === 2 ? [8] : bar % 4 === 1 ? [13] : [],
      open: bar % 8 === 5 ? [2, 6, 10, 15] : OFFBEATS,
    });
    const ride8 = (bar: number, gain: number, downbeats: boolean) => {
      for (let beat = 0; beat < 4; beat++) {
        s.note("hats", bar, beat + 0.5, 51, 0.5, (0.6 + jitter(0.05)) * gain);
        if (downbeats)
          s.note("hats", bar, beat, 51, 0.5, (0.4 + jitter(0.05)) * gain);
      }
    };
    const crash = (bar: number, velocity = 0.78) =>
      s.note("hats", bar, 0, 49, 2, velocity);
    const clap = (
      bar: number,
      gain = 1,
      snare = false,
      beats: readonly number[] = [1, 3],
    ) => {
      for (const beat of beats) {
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
    // A clap beat repeat: two sixteenths, then 1/32s that build.
    const clapRepeat = (bar: number) => {
      [3, 3.25].forEach((beat, i) =>
        s.note("drums", bar, beat + CLAP_LATE, 39, 0.12, 0.4 + i * 0.1),
      );
      for (let i = 0; i < 4; i++)
        s.note(
          "drums",
          bar,
          3.5 + i / 8 + CLAP_LATE,
          39,
          0.08,
          0.56 + i * 0.08,
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
    // The glitch fill: hat ratchets at 1/32 then 1/64 with a velocity rise,
    // over toms climbing in pitch.
    const ratchet = (bar: number) => {
      for (let i = 0; i < 4; i++)
        s.note("hats", bar, 3 + i / 8, 42, 0.06, 0.36 + i * 0.06);
      for (let i = 0; i < 8; i++)
        s.note("hats", bar, 3.5 + i / 16, 42, 0.04, 0.58 + i * 0.045);
      [41, 45, 48, 50].forEach((pitch, i) =>
        s.note("drums", bar, 3 + i * STEP, pitch, 0.12, 0.5 + i * 0.1),
      );
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

    // --- harmony -----------------------------------------------------------
    // A stab: rolled upward two milliseconds a voice, top voice lifted.
    const stab = (
      bar: number,
      beat: number,
      voicing: readonly number[],
      velocity: number,
      length = 0.32,
    ) =>
      voicing.forEach((pitch, i) =>
        s.note(
          "stabs",
          bar,
          beat + i * 0.005,
          pitch,
          length,
          Math.min(
            1,
            (velocity + jitter(0.02)) * (i === voicing.length - 1 ? 1.06 : 0.9),
          ),
        ),
      );
    // Rootless voicings (b3 5 b7 over the sub) and the 7-6 chain: over each
    // new bass note the top voice holds the 7th from the chord before, then
    // falls a step to the 6th, which is the next bass note's 7th.
    const FM = [56, 60, 63]; // Ab C Eb: Fm7 rootless; over C it is Ab/C
    const F_T = [56, 60, 65]; // Ab C F     plain triads for the bar of each
    const EB_T = [55, 58, 63]; // G Bb Eb   bass change: the held bell is
    const DB_T = [53, 56, 61]; // F Ab Db   the only 7th in the room until
    const C_T = [48, 55, 60]; // C G C     it falls to the 6th (an open
    //                           fifth: the leading tone waits for bar 39)
    const F_6 = [53, 56, 61]; // F Ab Db   the 6/3 chords each resolution
    const EB_6 = [55, 60, 63]; // G C Eb    lands on: Db/F, Cm/Eb, Bbm/Db,
    const DB_6 = [53, 58, 61]; // F Bb Db   Ab/C, first inversions chained
    const C_6 = FM; //            Ab C Eb   over the falling bass
    const C_7 = [52, 55, 58]; // E G Bb    V7, thrown an octave up at the end
    const VI = [53, 56, 60]; // Db: F Ab C
    const VII = [55, 58, 61]; // Eb7: G Bb Db
    const FSUS = [53, 58, 60]; // F Bb C: the 4 that falls to Ab at the end
    const sub = (
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      glide?: number,
    ) =>
      s.note("sub", bar, beat, pitch, length, velocity, glide ? { glide } : {});

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
        if (b < 2) hats(b, 0.45);
        else
          hats(b, b < 4 ? 0.56 : 0.68, {
            sixteenths: true,
            open: b >= 6 ? [14] : [],
          });
      } else if (section === 1) {
        hats(b, 0.9, {
          sixteenths: true,
          open: b >= 12 ? [6, 14] : [14],
          skip: hatVar(b).skip,
        });
      } else if (section === 2 || section === 3) {
        hats(b, 1, { sixteenths: true, afterCrash: crashBar, ...hatVar(b) });
        if (b >= 20 && b < 28) ride8(b, 0.85, false);
        if (b >= 28) ride8(b, 0.9, true);
      } else if (section === 4) {
        if (b === 37) hats(b, 0.5);
        if (b === 38) hats(b, 0.6, { sixteenths: true });
        if (b === 39) hats(b, 0.7, { sixteenths: true, until: 8 });
      } else if (section === 5 || section === 6) {
        hats(b, section === 6 ? 1.06 : 1, {
          sixteenths: true,
          afterCrash: crashBar,
          ...hatVar(b),
          ...(b === 47 ? { until: 12 } : {}),
        });
        if (section === 5 && b >= 44) ride8(b, 0.85, false);
        if (section === 6) ride8(b, 1.05, true);
      } else {
        if (b < 60)
          hats(b, 0.95, {
            sixteenths: true,
            afterCrash: crashBar,
            ...hatVar(b),
            ...(b >= 58 ? { open: [6, 14] } : {}),
          });
        else if (b < 62) hats(b, 0.7);
      }

      // Clap, snare and fills.
      if (b === 7) s.note("drums", b, 3 + CLAP_LATE, 39, 0.2, 0.55);
      if ((b >= 8 && b < 32) || (b >= 40 && b < 60))
        clap(
          b,
          b >= 56 ? 0.9 : section === 6 ? 1.1 : 1,
          section === 6,
          b === 23 ? [1] : [1, 3],
        );
      if (b === 15) snareFill(b);
      if (b === 23) clapRepeat(b);
      if (b === 31) tomFill(b, 2);
      if (b === 47) ratchet(b);
      if (b === 55) {
        tomFill(b, 2.5);
        s.note("drums", b, 2, 38, 0.14, 0.5);
        s.note("drums", b, 2.25, 38, 0.14, 0.58);
      }
      if ([19, 27, 43, 51].includes(b))
        s.note("drums", b, 3.75 + CLAP_LATE, 39, 0.14, 0.3);
      // A ghost snare on the "a" of two every other bar at the peak.
      if (section === 6 && b % 2 === 1) s.note("drums", b, 1.75, 38, 0.1, 0.22);
      // Vacuum's snare roll: quarters, eighths, sixteenths, then 32nds,
      // rising into the silent half bar.
      if (b >= 36 && b < 40) {
        const rate = [1, 0.5, 0.25, 0.125][b - 36]!;
        for (let beat = 0; beat < 4 - 1e-9; beat += rate) {
          if (b === 39 && beat >= 2) break;
          const progress = (b - 36 + beat / 4) / 3.5;
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
        rim(b, b >= 56 ? 0.75 : section === 6 ? 1.15 : 1, section === 6);

      // --- the two 303s ----------------------------------------------------
      if (b >= 4 && b < 8) play("acid", b, MURMUR, 0, 0.6);
      else if (b >= 8 && b < 24) {
        // Circuit: the saw states the line; the square joins at bar 12 in
        // its holes. Pressure: the full hocket, trading halves at phrase ends.
        const cell = mainCell(b);
        if (inSection === 7 && b >= 12) trade(b, cell, 0.64, true);
        else {
          play("acid", b, cell);
          if (b >= 12) hocket(b, cell, b < 16 ? 0.48 : 0.54);
        }
      } else if (b >= 24 && b < 32) {
        // Sparks: the peak cell with a VI - VII lift over the sub pedal;
        // the square box chases its accents one beat late, an octave up.
        // The lift is diatonic: the cell moves by scale steps onto VI and
        // VII, so Db bars carry F and C, Eb bars G and Db.
        const degrees = [0, 0, 0, 0, -2, -2, -1, 0][inSection]!;
        const cell = diatonic(b === 31 ? B_TURN : peakCell(b), degrees);
        // The beat repeat replaces the last half beat it re-fires.
        play("acid", b, cell, 0, 0.64, 0, b === 31 ? 14 : 16);
        if (b >= 25 && b < 31)
          play("acid2", b, diatonic(shift(B_THIN, 4), degrees), 12, 0.5);
        if (b === 31) stutter("acid", b, cell, 0, 0.66, 0.3);
      } else if (b >= 32 && b < 34) play("acid", b, BREAK, 0, 0.6);
      // 34-35: the saw rests while the chain is exposed over the new bass.
      else if (b >= 36 && b < 39) play("acid", b, b === 38 ? A2 : A, 0, 0.62);
      else if (b === 39) play("acid", b, A, 0, 0.64, 0, 8);
      else if (b >= 40 && b < 48) {
        const cell = mainCell(b);
        if (inSection === 3 || inSection === 7) trade(b, cell, 0.66, false);
        else {
          play("acid", b, cell, 0, 0.66);
          // The drop lands something new: for two bars the square box
          // doubles the saw an octave up, then the hocket resumes.
          if (b < 42) play("acid2", b, cell, 12, 0.6);
          else hocket(b, cell, 0.56);
        }
      } else if (b >= 48 && b < 56) {
        // Overdrive: i - VI - VII - i in two-bar steps, the square box
        // answering in the rests with a top line that walks up and down.
        const degrees = [0, 0, -2, -2, -1, -1, 0, 0][inSection]!;
        play("acid", b, diatonic(peakCell(b), degrees), 0, 0.7);
        play(
          "acid2",
          b,
          diatonic(b === 55 ? SQ_TOP : b % 2 ? SQ_DOWN : SQ_UP, degrees),
          0,
          0.6,
        );
      } else if (b >= 56 && b < 59) {
        play("acid", b, mainCell(b), 0, 0.62);
        if (b < 58) hocket(b, mainCell(b), 0.44);
      } else if (b >= 59 && b < 63) play("acid", b, MURMUR, 0, 0.5);
      else if (b === 63)
        s.note("acid", b, 0, 41, 0.6, 0.62, { articulation: "accent" });

      // --- sub -------------------------------------------------------------
      if ((b >= 24 && b < 32) || (b >= 40 && b < 56)) {
        // Off the kick: the pedal on F1, sparser on the re-entry; the last
        // offbeat of a phrase drops to C (V) against the square's rise.
        const beats = section === 5 ? [1.5, 3.5] : [0.5, 1.5, 2.5, 3.5];
        for (const beat of beats) {
          const five = beat === 3.5 && inSection === 7 && b !== 55;
          sub(
            b,
            beat,
            five ? 24 : 29,
            0.32,
            (five ? 0.6 : 0.52) + jitter(0.03),
          );
        }
      }
      // The breakdown walk: i VII VI V, each root slid into from the last.
      // The sub is out for the first two bars (the saw's BREAK holds the F)
      // and arrives quietly with the Eb the first suspension falls onto.
      if (b === 34) sub(b, 0, 27, 8.1, 0.44, 0.12);
      if (b === 36) sub(b, 0, 25, 8.1, 0.56, 0.12);
      if (b === 38) sub(b, 0, 24, 6, 0.66, 0.12);
      if (b === 56) sub(b, 0, 29, 16, 0.5);
      if (b === 60) sub(b, 0, 29, 15.9, 0.48);

      // --- dub stabs -------------------------------------------------------
      // Vacuum: the 7-6 chain. On each bass change the first stab is a
      // plain triad on the "and" of one, held a beat, so the bell's
      // suspended 7th is the only dissonance in the room; the bell falls
      // onto the stab's tail and the late stab confirms the 6/3 chord. The
      // second bar of each pair sits on that 6/3 and its late, longer stab
      // is the preparation the bell strikes with.
      if (b === 32) {
        stab(b, 0.5, F_T, 0.68, 1);
        stab(b, 2.5, F_6, 0.56);
      }
      if (b === 33) {
        stab(b, 0.75, F_6, 0.58);
        stab(b, 2.5, F_6, 0.64, 1.25);
      }
      if (b === 34) {
        stab(b, 0.5, EB_T, 0.7, 1);
        stab(b, 2.5, EB_6, 0.56);
      }
      if (b === 35) {
        stab(b, 0.75, EB_6, 0.6);
        stab(b, 2.5, EB_6, 0.66, 1.25);
      }
      if (b === 36) {
        stab(b, 0.5, DB_T, 0.72, 1);
        stab(b, 2.5, DB_6, 0.58);
      }
      if (b === 37) {
        stab(b, 0.75, DB_6, 0.62);
        stab(b, 2.5, DB_6, 0.68, 1.25);
      }
      if (b === 38) {
        stab(b, 0.5, C_T, 0.74, 1);
        stab(b, 2.5, C_6, 0.7);
      }
      // One pitch-jumped stab: the V an octave up, thrown into the delay
      // and cut dead by the silent half bar.
      if (b === 39)
        stab(
          b,
          0.5,
          C_7.map((p) => p + 12),
          0.8,
          0.2,
        );
      // Overdrive: a stab marks each two-bar change. Power down resolves a
      // last 4-3 over the pedal: bar 59's late stab strikes the sus4 and
      // its Bb rings across the barline over a bare fifth, falls to Ab on
      // beat 2, and bar 61 confirms the minor third.
      // The drop: one stab dead on the downbeat, thrown into the delay.
      if (b === 40) stab(b, 0, FM, 0.74, 0.5);
      if (b === 48) stab(b, 0.75, FM, 0.66);
      if (b === 50) stab(b, 0.75, VI, 0.68);
      if (b === 52) stab(b, 0.75, VII, 0.7);
      if (b === 54) stab(b, 0.75, FM, 0.66);
      if (b === 55) stab(b, 2.5, FM, 0.72, 0.26);
      if (b === 59) {
        stab(b, 2.5, FSUS, 0.6, 0.9);
        s.note("stabs", b, 2.515, 58, 2.25, 0.64);
      }
      if (b === 60) {
        stab(b, 0.5, [53, 60, 65], 0.58, 1);
        s.note("stabs", b, 0.75, 56, 1.5, 0.6);
      }
      if (b === 61) stab(b, 0.75, [56, 60, 65], 0.6, 0.8);
      // The tail: a root-position Fm left ringing under the last bell.
      if (b === 62) stab(b, 0.5, [53, 56, 60], 0.46, 2.5);

      // Steel alarm: a call, its repeat, then an answer that climbs; in the
      // breakdown it is the voice that holds the 7-6 chain.
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
      // The 7-6 chain as a held voice: the crotale strikes the 6th of each
      // chord with the late stab (the preparation), rings across the bass
      // change where it is now the 7th over the new root, and steps down to
      // the new 6th on the "and" of one as the triad stab rings. The first
      // one is the alarm struck in Sparks' last bar; the last falls through
      // the b6 to the 5th of V.
      if (b === 31) s.note("bell", b, 2.5, 75, 2.25, 0.42);
      if (b === 32) s.note("bell", b, 0.75, 73, 2.5, 0.44);
      if (b === 33) s.note("bell", b, 2.5, 73, 2.25, 0.46);
      if (b === 34) s.note("bell", b, 0.75, 72, 2.5, 0.44);
      if (b === 35) s.note("bell", b, 2.5, 72, 2.25, 0.46);
      if (b === 36) s.note("bell", b, 0.75, 70, 2.5, 0.46);
      if (b === 37) s.note("bell", b, 2.5, 70, 2.25, 0.46);
      if (b === 38) s.note("bell", b, 0.75, 68, 2, 0.44);
      if (b === 39) s.note("bell", b, 1.25, 67, 1, 0.4);
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
                // Over Db the answer lands on C (its seventh), over Eb on
                // Db: never the fifth the square box accents at the same
                // tick.
                [2.25, bellRoot === -2 ? 73 : 72, 1.5, 0.46],
              ],
        );
      if (b === 58) s.note("bell", b, 0, 77, 2, 0.34);
      if (b === 63) s.note("bell", b, 0, 77, 3.5, 0.36);

      // Noise: risers into sections, downlifters out of the peaks.
      if ([15, 23, 47].includes(b)) s.note("noise", b, 0, 72, 3.95, 0.7);
      if (b === 32) s.note("noise", b, 0, 72, 6, 0.7);
      if (b === 36) s.note("noise", b, 0, 72, 14, 0.72);
      if (b === 56) s.note("noise", b, 0, 72, 4, 0.66);
    }
    return s.finish();
  },
};
