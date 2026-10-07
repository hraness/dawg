/**
 * Synthesized drum kits: parameter sets for the built-in drum synth
 * (`src/audio/kits.ts`). A kit is chosen per track (`kit: "syn808"` on an
 * `instrument: "kit"` track); a track without `kit` plays the original
 * voices, byte-for-byte unchanged.
 *
 * Kits are plain data so the score can validate names without importing
 * the renderer, and every kit renders deterministically (noise is seeded
 * per note, exactly as in the default kit).
 *
 * Sample kits (Roland TR banks and friends from Strudel-format packs) live
 * in `src/audio/packs.ts` (`DEFAULT_KITS`, `/kit 909`); `src/audio/kits.ts`
 * lists both kinds in one catalog.
 */
/** Pitched body with an exponential pitch drop (kick, tom). */
export type DrumBodyParams = Readonly<{
  /** Resting frequency, Hz. */
  base: number;
  /** Extra Hz at the attack, decaying at `sweepRate` per second. */
  sweep: number;
  sweepRate: number;
  /** Amplitude decay rate per second (higher is shorter). */
  decay: number;
  /** Noise click level at the attack and its decay rate. */
  click: number;
  clickDecay: number;
  /** Level of the body. */
  level: number;
}>;

export type SnareParams = Readonly<{
  /** Drum-head tone, Hz, with its level and decay rate. */
  tone: number;
  toneLevel: number;
  toneDecay: number;
  /** Snare-wire noise level and decay rate. */
  noise: number;
  noiseDecay: number;
  /** 0 dull … 1 bright wires (white vs high-passed noise). */
  snap: number;
}>;

export type ClapParams = Readonly<{
  /** Seconds between the three bursts. */
  gap: number;
  /** Decay rate of the diffuse tail. */
  tail: number;
  /** Band-pass smoothing 0..1 (higher is brighter). */
  band: number;
  level: number;
}>;

export type HatParams = Readonly<{
  level: number;
  decay: number;
  /** 0 dark … 1 bright noise. */
  tone: number;
  /** 0 noise … 1 six detuned square oscillators (808-style metal). */
  metal: number;
}>;

export type RimParams = Readonly<{
  high: number;
  low: number;
  decay: number;
  level: number;
}>;

export type SynthKit = Readonly<{
  name: string;
  label: string;
  /** One line for pickers. */
  description: string;
  kick: DrumBodyParams;
  tom: DrumBodyParams;
  snare: SnareParams;
  clap: ClapParams;
  hat: HatParams;
  openhat: HatParams;
  rim: RimParams;
  /** Longest one-shot, seconds (808 booms ring longer). */
  seconds: number;
  /** 0..1 tanh saturation. */
  drive: number;
  /** Bit depth for crushing; 0 is off. */
  bits: number;
  /** Sample-and-hold factor (1 = off) for a dusty, aliased top end. */
  hold: number;
  /** Output gain. */
  gain: number;
}>;

/** The original voices as parameters (the default kit is not routed through these). */
type KitParams = Omit<SynthKit, "name" | "label" | "description">;

const BASE: KitParams = Object.freeze({
  kick: {
    base: 45,
    sweep: 105,
    sweepRate: 28,
    decay: 7.5,
    click: 0.12,
    clickDecay: 300,
    level: 1,
  },
  tom: {
    base: 105,
    sweep: 95,
    sweepRate: 18,
    decay: 9,
    click: 0,
    clickDecay: 300,
    level: 1,
  },
  snare: {
    tone: 185,
    toneLevel: 0.45,
    toneDecay: 22,
    noise: 0.7,
    noiseDecay: 16,
    snap: 0,
  },
  clap: { gap: 0.01, tail: 18, band: 0.35, level: 1 },
  hat: { level: 0.42, decay: 60, tone: 1, metal: 0 },
  openhat: { level: 0.36, decay: 9, tone: 1, metal: 0 },
  rim: { high: 1_700, low: 820, decay: 90, level: 1 },
  seconds: 0.6,
  drive: 0,
  bits: 0,
  hold: 1,
  gain: 1,
});

type KitOverrides = Readonly<
  Partial<{
    [K in keyof KitParams]: KitParams[K] extends object
      ? Partial<KitParams[K]>
      : KitParams[K];
  }>
>;

function kit(
  name: string,
  label: string,
  description: string,
  overrides: KitOverrides,
): SynthKit {
  const out: Record<string, unknown> = { name, label, description };
  for (const [key, value] of Object.entries(BASE)) {
    const override = (overrides as Record<string, unknown>)[key];
    out[key] =
      typeof value === "object"
        ? Object.freeze({ ...value, ...(override as object | undefined) })
        : (override ?? value);
  }
  return Object.freeze(out) as SynthKit;
}

/** Synthesized kits in picker order. */
export const SYNTH_KITS: readonly SynthKit[] = Object.freeze([
  kit("syn808", "808 (synth)", "long sub boom, snappy snare, metallic hats", {
    kick: {
      base: 49,
      sweep: 70,
      sweepRate: 20,
      decay: 2.6,
      click: 0.03,
      clickDecay: 400,
    },
    tom: { base: 95, sweep: 40, sweepRate: 14, decay: 5 },
    snare: {
      tone: 238,
      toneLevel: 0.5,
      toneDecay: 18,
      noise: 0.55,
      noiseDecay: 20,
      snap: 0.8,
    },
    clap: { gap: 0.011, tail: 14 },
    hat: { level: 0.36, decay: 70, metal: 1 },
    openhat: { level: 0.3, decay: 7, metal: 1 },
    rim: { high: 1_870, low: 470, decay: 110 },
    seconds: 1.4,
  }),
  kit("syn909", "909 (synth)", "punchy clicky kick, bright noisy snare", {
    kick: {
      base: 52,
      sweep: 190,
      sweepRate: 38,
      decay: 6,
      click: 0.35,
      clickDecay: 500,
    },
    snare: {
      tone: 205,
      toneLevel: 0.4,
      toneDecay: 26,
      noise: 0.9,
      noiseDecay: 12,
      snap: 1,
    },
    clap: { gap: 0.009, tail: 12, band: 0.5 },
    hat: { level: 0.4, decay: 55, tone: 1, metal: 0.3 },
    openhat: { level: 0.34, decay: 6, metal: 0.3 },
    drive: 0.35,
  }),
  kit("acoustic", "Acoustic-ish", "beater kick, wire snare, darker cymbals", {
    kick: {
      base: 62,
      sweep: 45,
      sweepRate: 30,
      decay: 11,
      click: 0.3,
      clickDecay: 180,
    },
    tom: { base: 120, sweep: 50, sweepRate: 10, decay: 7, click: 0.1 },
    snare: {
      tone: 175,
      toneLevel: 0.35,
      toneDecay: 18,
      noise: 0.85,
      noiseDecay: 9,
      snap: 0.3,
    },
    clap: { tail: 22, band: 0.25 },
    hat: { level: 0.4, decay: 45, tone: 0.55, metal: 0.5 },
    openhat: { level: 0.34, decay: 4.5, tone: 0.55, metal: 0.5 },
    rim: { high: 1_300, low: 640, decay: 70 },
    seconds: 0.9,
  }),
  kit("lofi", "Lo-fi dusty", "soft round kick, crushed and dark", {
    kick: { base: 50, sweep: 70, sweepRate: 22, decay: 8, click: 0.05 },
    snare: { toneLevel: 0.5, noise: 0.6, noiseDecay: 14, snap: 0 },
    hat: { level: 0.38, decay: 50, tone: 0.3 },
    openhat: { level: 0.3, decay: 8, tone: 0.3 },
    drive: 0.25,
    bits: 8,
    hold: 3,
    gain: 0.95,
  }),
  kit(
    "electro",
    "Electro minimal",
    "tight short kick, clicky rim, ticking hats",
    {
      kick: {
        base: 56,
        sweep: 240,
        sweepRate: 60,
        decay: 13,
        click: 0.2,
        clickDecay: 700,
      },
      tom: { base: 140, sweep: 160, sweepRate: 40, decay: 14 },
      snare: {
        tone: 310,
        toneLevel: 0.55,
        toneDecay: 35,
        noise: 0.5,
        noiseDecay: 28,
        snap: 1,
      },
      clap: { gap: 0.008, tail: 26, band: 0.6 },
      hat: { level: 0.38, decay: 120, metal: 0.6 },
      openhat: { level: 0.32, decay: 14, metal: 0.6 },
      rim: { high: 2_400, low: 1_100, decay: 140 },
      seconds: 0.5,
    },
  ),
  kit("trap", "Trap", "distorted long 808, crisp hats, high snare", {
    kick: {
      base: 43,
      sweep: 90,
      sweepRate: 16,
      decay: 1.6,
      click: 0.08,
      clickDecay: 400,
      level: 0.9,
    },
    snare: {
      tone: 265,
      toneLevel: 0.45,
      toneDecay: 20,
      noise: 0.8,
      noiseDecay: 15,
      snap: 1,
    },
    clap: { gap: 0.012, tail: 16, band: 0.55 },
    hat: { level: 0.4, decay: 95, tone: 1, metal: 0.4 },
    openhat: { level: 0.32, decay: 8, metal: 0.4 },
    seconds: 1.6,
    drive: 0.55,
  }),
]);

const BY_NAME = new Map(SYNTH_KITS.map((entry) => [entry.name, entry]));

/** Accepted spellings for kit names (`808` resolves to the sample bank instead). */
const KIT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  synth808: "syn808",
  "synth-808": "syn808",
  "syn-808": "syn808",
  synth909: "syn909",
  "synth-909": "syn909",
  "syn-909": "syn909",
  "lo-fi": "lofi",
  dusty: "lofi",
  minimal: "electro",
});

/** The synth kit named `name` (case-insensitive, with aliases), if any. */
export function synthKit(name: string | undefined): SynthKit | undefined {
  if (typeof name !== "string") return undefined;
  const key = name.trim().toLowerCase();
  return BY_NAME.get(KIT_ALIASES[key] ?? key);
}

export const SYNTH_KIT_NAMES: readonly string[] = Object.freeze(
  SYNTH_KITS.map((entry) => entry.name),
);
