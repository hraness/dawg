/**
 * Vocoder (0.7 "Voice", lane vocoder): a track's sound (the carrier) shaped
 * by another track's sound (the modulator, `src`). Pure and import-light,
 * like `core/winds.ts`: the parameter table, the eight presets and the
 * validator that the score, the prompt, the menu, the agent and the SDK
 * printer share. The DSP lives in `src/audio/vocoder/`.
 *
 * Two ways in:
 * - any track gains `vocoder: { src, ... }`: its own voice is the carrier;
 * - instrument `vocoder` with a `vocoder` field plays a built-in carrier
 *   (saw, supersaw, pulse or noise) following the track's notes, the song's
 *   chords or a drone.
 *
 * The stage runs only when `vocoder.src` is present; without it the track
 * plays dry (a `vocoder` instrument without a source is silent). Absent
 * field: today's sound, byte for byte.
 */
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** Instrument value that selects the built-in carrier. */
export const VOCODER_INSTRUMENT = "vocoder" as const;

export const VOCODER_PRESET_NAMES = Object.freeze([
  "classic",
  "robot",
  "talkbox",
  "choir",
  "glass",
  "whisper",
  "smear",
  "lofi",
] as const);
export type VocoderPresetName = (typeof VOCODER_PRESET_NAMES)[number];

/** Default preset of a `vocoder` field that names none. */
export const DEFAULT_VOCODER_PRESET: VocoderPresetName = "classic";

/** Modulator taps (append-only). */
export const VOCODER_TAPS = Object.freeze(["chain", "dry"]);
/** Modes (append-only): a band bank or an LPC talkbox. */
export const VOCODER_MODES = Object.freeze(["channel", "talkbox"]);
/** Built-in carriers (append-only; `glottal` is 0.7.1). */
export const VOCODER_CARRIERS = Object.freeze([
  "saw",
  "supersaw",
  "pulse",
  "noise",
]);
/** Built-in carrier pitch (append-only; `voice` is 0.7.1). */
export const VOCODER_FOLLOWS = Object.freeze(["notes", "chords", "drone"]);

/** `gate` value that reads the threshold off the modulator's own assets. */
export const VOCODER_GATE_AUTO = "auto" as const;

/** Talkbox formant bound (the channel bank takes the full ±24). */
export const TALKBOX_FORMANT_MAX = 12;

const num = (
  min: number,
  max: number,
  fallback: number,
  step: number | "log",
  doc: string,
  extra: Partial<NumberParam> = {},
): NumberParam =>
  Object.freeze({
    kind: "number",
    min,
    max,
    default: fallback,
    step,
    optional: true,
    doc,
    ...extra,
  });

const choice = (values: readonly string[], fallback: string, doc: string) =>
  Object.freeze({
    kind: "enum" as const,
    values,
    default: fallback,
    optional: true,
    doc,
  });

/**
 * Every vocoder parameter in table order (`src` and `preset` excluded). All
 * optional: an absent one takes the preset's value, then the default here.
 * `automate` ones have a `vocoder-<param>` lane. `gate` also takes "auto".
 */
export const VOCODER_PARAMS: Readonly<Record<string, ParamSpec>> =
  Object.freeze({
    tap: choice(
      VOCODER_TAPS,
      "chain",
      "modulator after its mono chain (pre-pan) or dry before it",
    ),
    mode: choice(VOCODER_MODES, "channel", "band bank or LPC talkbox"),
    carrier: choice(
      VOCODER_CARRIERS,
      "supersaw",
      "built-in carrier (instrument vocoder only)",
    ),
    follow: choice(
      VOCODER_FOLLOWS,
      "notes",
      "built-in carrier pitch: notes, song chords or a drone",
    ),
    root: num(24, 96, 45, 1, "drone pitch (MIDI)", { integer: true }),
    spread: num(0, 1, 0.15, 0.05, "supersaw detune spread (semitones)", {
      unit: "st",
      automate: true,
    }),
    bands: num(4, 40, 16, 1, "channel bands (heavy above 24)", {
      integer: true,
    }),
    lo: num(50, 1000, 100, "log", "lowest band centre", { unit: "Hz" }),
    hi: num(2000, 12000, 8000, "log", "highest band centre", { unit: "Hz" }),
    width: num(0.25, 4, 1, 0.05, "band width (x spacing)", {
      automate: true,
    }),
    attack: num(0.0005, 0.2, 0.005, "log", "follower attack", {
      unit: "s",
      strudel: ["att"],
    }),
    release: num(0.005, 2, 0.04, "log", "follower release (long = smear)", {
      unit: "s",
      automate: true,
      strudel: ["rel"],
    }),
    formant: num(
      -24,
      24,
      0,
      0.5,
      "formant shift (+ is smaller and brighter; talkbox ±12)",
      { unit: "st", automate: true },
    ),
    unvoiced: num(0, 1, 0.5, 0.05, "noise carrier on fricatives", {
      automate: true,
    }),
    sens: num(0, 1, 0.5, 0.05, "unvoiced detection sensitivity"),
    hiss: num(0, 1, 0, 0.05, "high-passed modulator added through", {
      automate: true,
    }),
    gate: num(-90, 0, -60, 1, 'modulator gate in dBFS, or "auto"', {
      unit: "dB",
    }),
    enhance: Object.freeze({
      kind: "boolean" as const,
      default: true,
      optional: true,
      doc: "whiten the carrier so every band speaks",
    }),
    depth: num(0, 1, 1, 0.05, "how much the voice shapes the carrier", {
      automate: true,
    }),
    freeze: Object.freeze({
      kind: "boolean" as const,
      default: false,
      optional: true,
      doc: "hold the last sung vowel through rests",
    }),
    mix: num(0, 1, 1, 0.05, "wet against the carrier", { automate: true }),
    gain: num(-24, 24, 0, 0.5, "output trim", { unit: "dB", automate: true }),
    seed: num(0, 2 ** 31, 1, 1, "noise seed (absent: from the track id)", {
      integer: true,
    }),
  });

export type VocoderTap = "chain" | "dry";
export type VocoderMode = "channel" | "talkbox";
export type VocoderCarrier = "saw" | "supersaw" | "pulse" | "noise";
export type VocoderFollow = "notes" | "chords" | "drone";

/** Overrides over a preset, all optional. */
export type VocoderOverrides = Readonly<{
  tap?: VocoderTap;
  mode?: VocoderMode;
  carrier?: VocoderCarrier;
  follow?: VocoderFollow;
  root?: number;
  spread?: number;
  bands?: number;
  lo?: number;
  hi?: number;
  width?: number;
  attack?: number;
  release?: number;
  formant?: number;
  unvoiced?: number;
  sens?: number;
  hiss?: number;
  gate?: number | "auto";
  enhance?: boolean;
  depth?: number;
  freeze?: boolean;
  mix?: number;
  gain?: number;
  seed?: number;
}>;

/** A track's stored vocoder: the modulator, a preset and overrides. */
export type TrackVocoder = Readonly<
  { src?: string; preset?: VocoderPresetName } & VocoderOverrides
>;

/** Everything the DSP reads, resolved: defaults <- preset <- overrides. */
export type ResolvedVocoder = Readonly<{
  tap: VocoderTap;
  mode: VocoderMode;
  carrier: VocoderCarrier;
  follow: VocoderFollow;
  root: number;
  spread: number;
  bands: number;
  lo: number;
  hi: number;
  width: number;
  attack: number;
  release: number;
  formant: number;
  unvoiced: number;
  sens: number;
  hiss: number;
  gate: number | "auto";
  enhance: boolean;
  depth: number;
  freeze: boolean;
  mix: number;
  gain: number;
  /** Undefined: derived from the track id by the renderer. */
  seed?: number;
}>;

export const VOCODER_DEFAULTS: ResolvedVocoder = Object.freeze({
  tap: "chain",
  mode: "channel",
  carrier: "supersaw",
  follow: "notes",
  root: 45,
  spread: 0.15,
  bands: 16,
  lo: 100,
  hi: 8000,
  width: 1,
  attack: 0.005,
  release: 0.04,
  formant: 0,
  unvoiced: 0.5,
  sens: 0.5,
  hiss: 0,
  gate: "auto",
  enhance: true,
  depth: 1,
  freeze: false,
  mix: 1,
  gain: 0,
});

export type VocoderPreset = Readonly<{
  /** One line for the menu and /help. */
  doc: string;
  values: VocoderOverrides;
}>;

/** Presets over the defaults (all at 24 bands or fewer). */
export const VOCODER_PRESETS: Readonly<
  Record<VocoderPresetName, VocoderPreset>
> = Object.freeze({
  classic: { doc: "70s/80s band vocoder lead", values: {} },
  robot: {
    doc: "monotone machine voice on a drone",
    values: {
      bands: 12,
      carrier: "pulse",
      follow: "drone",
      root: 45,
      release: 0.03,
      unvoiced: 0.3,
    },
  },
  talkbox: {
    doc: "wet mouth-shaped lead, sharp vowels",
    values: { mode: "talkbox", carrier: "saw", unvoiced: 0.3, hiss: 0.1 },
  },
  choir: {
    doc: "stereo vocal-stack chord pad",
    values: {
      bands: 24,
      spread: 0.25,
      follow: "chords",
      release: 0.08,
      width: 1.3,
    },
  },
  glass: {
    doc: "bright crystalline lead",
    values: {
      bands: 24,
      carrier: "saw",
      formant: 3,
      hiss: 0.3,
      attack: 0.001,
    },
  },
  whisper: {
    doc: "breathy unpitched ghost voice",
    values: { bands: 24, carrier: "noise", unvoiced: 0, hiss: 0.2 },
  },
  smear: {
    doc: "blurred vowel wash (try freeze)",
    values: {
      bands: 24,
      follow: "chords",
      release: 0.6,
      attack: 0.02,
      width: 1.5,
    },
  },
  lofi: {
    doc: "narrow murky 8-band",
    values: {
      bands: 8,
      carrier: "pulse",
      formant: -3,
      width: 0.7,
      hi: 4000,
      // The narrow layout loses ~5 dB the fixed makeup does not restore.
      gain: 5,
    },
  },
});

/** Parameters with a `vocoder-<param>` lane (freeze is a 0/1 step lane). */
export const VOCODER_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze([
  ...Object.entries(VOCODER_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
  Object.freeze({
    param: "freeze",
    spec: num(0, 1, 0, 1, "hold the vowel while 1", { automate: true }),
  }),
]);

export function isVocoderPreset(name: string): name is VocoderPresetName {
  return (VOCODER_PRESET_NAMES as readonly string[]).includes(name);
}

export function isVocoderParam(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(VOCODER_PARAMS, name);
}

/** Strudel spelling (`att`, `rel`) to a vocoder parameter name. */
export function vocoderParamName(name: string): string | undefined {
  if (isVocoderParam(name)) return name;
  for (const [key, spec] of Object.entries(VOCODER_PARAMS))
    if (spec.strudel?.includes(name)) return key;
  return undefined;
}

/**
 * Validates a `vocoder` field: `{ src?, preset?, ...overrides }`, null or
 * absent meaning none. Keys come out in canonical order (src, preset, then
 * `VOCODER_PARAMS` order). `{}` is kept: it means the default preset with no
 * modulator (the track plays dry). Whether `src` names another track is the
 * score's check.
 */
export function normalizeVocoder(input: unknown): TrackVocoder | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track vocoder must be an object or null");
  const params: Record<string, unknown> = {};
  let presetName: VocoderPresetName | undefined;
  let src: string | undefined;
  let gate: number | "auto" | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "src") {
      if (typeof value !== "string" || value.length === 0 || value.length > 64)
        throw new FxValidationError(
          "vocoder src must be a track id (1 to 64 characters)",
        );
      src = value;
      continue;
    }
    if (key === "preset") {
      const lower = typeof value === "string" ? value.toLowerCase() : "";
      if (!isVocoderPreset(lower))
        throw new FxValidationError(
          `vocoder preset must be one of ${VOCODER_PRESET_NAMES.join(", ")}`,
        );
      presetName = lower;
      continue;
    }
    const name = vocoderParamName(key);
    if (!name)
      throw new FxValidationError(
        `vocoder has no parameter "${key.slice(0, 32)}"`,
      );
    if (name === "gate" && value === VOCODER_GATE_AUTO) {
      gate = VOCODER_GATE_AUTO;
      continue;
    }
    params[name] = value;
  }
  const values = normalizeParams(VOCODER_PARAMS, params, "vocoder", false);
  const out: Record<string, unknown> = {};
  if (src !== undefined) out.src = src;
  if (presetName) out.preset = presetName;
  for (const key of Object.keys(VOCODER_PARAMS)) {
    if (key === "gate" && gate !== undefined) out.gate = gate;
    else if (values[key] !== undefined) out[key] = values[key];
  }
  return Object.freeze(out) as TrackVocoder;
}

/** The preset a `vocoder` field plays. */
export function vocoderPresetOf(
  vocoder: TrackVocoder | undefined,
): VocoderPresetName {
  return vocoder?.preset ?? DEFAULT_VOCODER_PRESET;
}

/**
 * The settings a `vocoder` field plays: defaults, then the preset, then
 * overrides, then lane values from `lane`. A talkbox's formant is clamped
 * to ±12 st.
 */
export function resolveVocoder(
  vocoder: TrackVocoder | undefined,
  lane?: (param: string) => number | undefined,
): ResolvedVocoder {
  const out: Record<string, unknown> = {
    ...VOCODER_DEFAULTS,
    ...VOCODER_PRESETS[vocoderPresetOf(vocoder)].values,
  };
  if (vocoder)
    for (const [key, value] of Object.entries(vocoder))
      if (key !== "preset" && key !== "src" && value !== undefined)
        out[key] = value;
  if (lane)
    for (const { param } of VOCODER_LANE_PARAMS) {
      const value = lane(param);
      if (value === undefined) continue;
      out[param] = param === "freeze" ? value >= 0.5 : value;
    }
  if (out.mode === "talkbox")
    out.formant = Math.max(
      -TALKBOX_FORMANT_MAX,
      Math.min(TALKBOX_FORMANT_MAX, out.formant as number),
    );
  return Object.freeze(out) as ResolvedVocoder;
}

/** The value one key plays (for menu rows and `/vocoder <param>`). */
export function vocoderValue(
  vocoder: TrackVocoder | undefined,
  key: string,
): number | string | boolean | undefined {
  return (resolveVocoder(vocoder) as Record<string, unknown>)[key] as
    number | string | boolean | undefined;
}

/** Ring after the modulator stops: the release plus 50 ms, at most 2.05 s. */
export function vocoderTailSeconds(vocoder: TrackVocoder | undefined): number {
  if (!vocoder) return 0;
  return Math.min(2.05, resolveVocoder(vocoder).release + 0.05);
}

/** Pre-roll a window needs so its envelopes have settled. */
export function vocoderPrerollSeconds(
  vocoder: TrackVocoder | undefined,
): number {
  if (!vocoder) return 0;
  return Math.max(0.5, 5 * resolveVocoder(vocoder).release + 0.1);
}

/**
 * Score-level checks over a track list: `src` never names its own track,
 * at most `maxTracks` vocoder tracks, and no modulator cycle (A vocodes B
 * while B vocodes A). Returns an error message or undefined. `src` naming
 * no track is left to the edit surfaces, because a preview or live score
 * holds only some of the song's tracks.
 */
export function vocoderScoreError(
  tracks: readonly Readonly<{ id: string; vocoder?: TrackVocoder }>[],
  maxTracks: number,
): string | undefined {
  const vocoded = tracks.filter((track) => track.vocoder);
  if (vocoded.length > maxTracks)
    return `a song holds at most ${maxTracks} vocoder tracks`;
  const src = new Map<string, string>();
  for (const track of vocoded) {
    const from = track.vocoder!.src;
    if (from === undefined) continue;
    if (from === track.id)
      return `track ${track.id} cannot vocode itself (vocoder src)`;
    src.set(track.id, from);
  }
  for (const start of src.keys()) {
    const path = [start];
    let at = src.get(start);
    while (at !== undefined) {
      if (at === start) return `vocoder cycle: ${[...path, at].join(" -> ")}`;
      if (path.includes(at)) break;
      path.push(at);
      at = src.get(at);
    }
  }
  return undefined;
}
