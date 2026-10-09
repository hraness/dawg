/**
 * Modal percussion settings (0.6 "Instruments", lane f06-modal): mallets,
 * bars, tines, bells, pans, bowls, gongs and drums played by one engine,
 * a bank of decaying resonators struck by a mallet pulse
 * (`src/audio/dsp/modal.ts`). Pure and import-light: the parameter table,
 * the presets and the validator that `core/score.ts`, the prompt, the menu,
 * the agent and the SDK printer share.
 *
 * A track plays this engine only when its `instrument` is `"modal"` AND it
 * carries a `modal` object (`{ preset, ...overrides }`). A bare `"modal"`
 * or `"marimba"` instrument without the field keeps the legacy tone voice
 * byte for byte.
 *
 * Strike position maps the user range onto a safe interior per shape so no
 * setting is silent: bars use x = p along the bar, tines x = 0.08 + 0.92 p
 * from the clamp, membranes r = 0.05 + 0.85 p from the centre, shells tilt
 * brightness by ratio^(2 (p - 0.5)); every mode keeps at least 0.02 of its
 * maximum weight.
 */
import { resolveInstrumentWord } from "./instruments.ts";
import { WIND_INSTRUMENT, windPresetFor, type TrackWind } from "./winds.ts";
import { SING_INSTRUMENT, isSingPreset, type TrackSing } from "./sing.ts";
import {
  FxValidationError,
  isRecord,
  normalizeParams,
  type EnumParam,
  type NumberParam,
  type ParamSpec,
} from "./params.ts";

/** Instrument value that selects the modal engine. */
export const MODAL_INSTRUMENT = "modal" as const;

/** Mode tables the engine knows (`body` overrides the preset's). */
export const MODAL_BODIES = Object.freeze([
  "marimba",
  "vibraphone",
  "xylophone",
  "glockenspiel",
  "celesta",
  "chimes",
  "crotale",
  "mbira",
  "kalimba",
  "musicbox",
  "toypiano",
  "saron",
  "bonang",
  "gender",
  "kempul",
  "gong",
  "bell",
  "steelpan",
  "bowl",
  "timpani",
  "tabla",
  "frame",
] as const);
export type ModalBody = (typeof MODAL_BODIES)[number];

/** Mallet words and the hardness each one sets. */
export const MODAL_MALLETS = Object.freeze({
  yarn: 0.15,
  cord: 0.35,
  rubber: 0.55,
  plastic: 0.75,
  brass: 0.95,
} as const);
export type ModalMallet = keyof typeof MODAL_MALLETS;
export const MODAL_MALLET_NAMES = Object.freeze(
  Object.keys(MODAL_MALLETS) as ModalMallet[],
);

/** The 0.6 core presets (lane A1). */
export const MODAL_PRESET_NAMES = Object.freeze([
  "marimba",
  "vibes",
  "xylophone",
  "glock",
  "celesta",
  "chimes",
  "kalimba",
  "mbira",
  "steelpan",
  "bowl",
  "gong",
  "timpani",
  // f061-gamelan-winds: gamelan, small bells and frame drums (lane A2).
  "crotales",
  "musicbox",
  "toypiano",
  "saron",
  "demung",
  "slenthem",
  "gangsa",
  "gender",
  "bonang",
  "kenong",
  "kethuk",
  "kempul",
  "daf",
  "bodhran",
  "tabla",
] as const);
export type ModalPresetName = (typeof MODAL_PRESET_NAMES)[number];

/** Extra words that pick a preset (`instrument vibraphone`). */
export const MODAL_ALIASES: Readonly<Record<string, ModalPresetName>> =
  Object.freeze({
    vibraphone: "vibes",
    glockenspiel: "glock",
    tubular: "chimes",
    thumbpiano: "kalimba",
    gongageng: "gong",
    steeldrum: "steelpan",
    singingbowl: "bowl",
    kettledrum: "timpani",
    tubularbells: "chimes",
    // f061-gamelan-winds. `gamelan` is a browse group, not an alias.
    crotale: "crotales",
    musicalbox: "musicbox",
    framedrum: "bodhran",
  });

/**
 * The gamelan presets, in browse order (the `gamelan` hint opens these
 * under Mallets and bells).
 */
export const GAMELAN_PRESETS: readonly ModalPresetName[] = Object.freeze([
  "saron",
  "demung",
  "slenthem",
  "gangsa",
  "gender",
  "bonang",
  "kenong",
  "kethuk",
  "kempul",
  "gong",
]);

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

/**
 * Every modal parameter. All are optional: an absent one takes the
 * preset's value, then the default here. `automate` ones have a
 * `modal-<param>` lane read at each note's onset (`motordepth` is read
 * every 32-sample control tick).
 */
export const MODAL_PARAMS: Readonly<Record<string, ParamSpec>> = Object.freeze({
  mallet: Object.freeze({
    kind: "enum",
    values: MODAL_MALLET_NAMES,
    default: "cord",
    optional: true,
    doc: "mallet: yarn, cord, rubber, plastic or brass (sets hardness)",
  }) as EnumParam,
  hardness: num(0, 1, 0.4, 0.05, "mallet hardness: 0 yarn/felt, 1 brass", {
    automate: true,
  }),
  position: num(0, 1, 0.42, 0.05, "strike point: 0 end or edge, 0.5 centre", {
    automate: true,
  }),
  ring: num(0.05, 30, 1.6, "log", "ring time (T60) at middle C", {
    unit: "s",
    automate: true,
  }),
  tilt: num(0, 2, 0.9, 0.05, "how much faster high modes and notes decay", {
    automate: true,
  }),
  damp: num(0, 1, 0, 0.05, "damping at note-off: 0 rings on, 1 chokes", {
    automate: true,
  }),
  release: num(0.005, 2, 0.12, "log", "choke time when damp is 1", {
    unit: "s",
    strudel: ["release", "rel"],
  }),
  motor: num(0, 12, 0, 0.25, "vibraphone motor tremolo rate", {
    unit: "Hz",
  }),
  motordepth: num(0, 1, 0, 0.05, "motor tremolo depth", { automate: true }),
  ombak: num(0, 12, 0, 0.25, "paired-instrument beat rate (gamelan ombak)", {
    unit: "Hz",
  }),
  buzz: num(0, 1, 0, 0.05, "buzzer or jingle amount", { automate: true }),
  click: num(0, 1, 0, 0.05, "mallet contact click", { automate: true }),
  strikebend: num(-24, 24, 0, 0.5, "strike pitch glide start", {
    unit: "st",
    strudel: ["penv"],
  }),
  strikedecay: num(0.001, 2, 0.1, "log", "strike pitch glide time", {
    unit: "s",
    strudel: ["pdecay"],
  }),
  gain: num(0, 2, 0.8, 0.05, "level", { automate: true }),
  body: Object.freeze({
    kind: "enum",
    values: MODAL_BODIES,
    default: "marimba",
    optional: true,
    doc: "mode table (from the preset)",
  }) as EnumParam,
});

/** Menu rows: the first five are what most people reach for. */
export const MODAL_SIMPLE = Object.freeze([
  "mallet",
  "hardness",
  "position",
  "ring",
  "damp",
]);

/** Resolved settings the engine plays. */
export type ModalSettings = Readonly<{
  body: ModalBody;
  hardness: number;
  position: number;
  ring: number;
  tilt: number;
  damp: number;
  release: number;
  motor: number;
  motordepth: number;
  ombak: number;
  buzz: number;
  click: number;
  strikebend: number;
  strikedecay: number;
  gain: number;
}>;

export const MODAL_DEFAULTS: ModalSettings = Object.freeze({
  body: "marimba",
  hardness: 0.4,
  position: 0.42,
  ring: 1.6,
  tilt: 0.9,
  damp: 0,
  release: 0.12,
  motor: 0,
  motordepth: 0,
  ombak: 0,
  buzz: 0,
  click: 0,
  strikebend: 0,
  strikedecay: 0.1,
  gain: 0.8,
});

export type ModalPreset = Readonly<{
  settings: ModalSettings;
  /** MIDI range the instrument is built for (browse hint and tests). */
  range: readonly [number, number];
  doc: string;
  styles: string;
}>;

const preset = (
  settings: Partial<ModalSettings>,
  range: [number, number],
  doc: string,
  styles: string,
): ModalPreset =>
  Object.freeze({
    settings: Object.freeze({ ...MODAL_DEFAULTS, ...settings }),
    range: Object.freeze(range) as readonly [number, number],
    doc,
    styles,
  });

/**
 * Presets, ported from the reviewed prototype (proto/resonators). Vibes
 * carry damp 0.3 (a vibist pedals; fully damped bars sounded dead in
 * review) and every preset uses the strengthened velocity coupling.
 */
export const MODAL_PRESETS: Readonly<Record<ModalPresetName, ModalPreset>> =
  Object.freeze({
    marimba: preset(
      { body: "marimba", ring: 1.6, tilt: 0.9, hardness: 0.35, position: 0.42 },
      [45, 96],
      "rosewood bars, yarn mallets, warm and round",
      "Reich, Glass, Four Tet, Caribou, jazz",
    ),
    vibes: preset(
      {
        body: "vibraphone",
        ring: 6,
        tilt: 0.6,
        hardness: 0.5,
        position: 0.42,
        damp: 0.3,
        release: 0.15,
        motor: 5.5,
        motordepth: 0.45,
      },
      [53, 89],
      "aluminium bars with motor tremolo, damped unless the pedal is down",
      "jazz, Motown, soul, Four Tet",
    ),
    xylophone: preset(
      {
        body: "xylophone",
        ring: 0.6,
        tilt: 1.2,
        hardness: 0.85,
        position: 0.45,
      },
      [65, 108],
      "hard, dry and bright",
      "orchestral, Messiaen, Shostakovich",
    ),
    glock: preset(
      {
        body: "glockenspiel",
        ring: 3.5,
        tilt: 0.5,
        hardness: 0.9,
        position: 0.45,
      },
      [79, 108],
      "steel bars, brass mallets, sparkling",
      "orchestral, Motown, The Field, Beach House",
    ),
    celesta: preset(
      { body: "celesta", ring: 1.2, tilt: 0.7, hardness: 0.5, position: 0.45 },
      [60, 108],
      "felt-hammered steel plates, soft and glassy",
      "Debussy, OPN, Radiohead, ambient",
    ),
    chimes: preset(
      { body: "chimes", ring: 7, tilt: 0.35, hardness: 0.8, position: 0.05 },
      [60, 77],
      "tubular bells struck at the cap",
      "orchestral, Messiaen, ambient",
    ),
    kalimba: preset(
      { body: "kalimba", ring: 1.4, tilt: 0.8, hardness: 0.6, position: 0.7 },
      [60, 88],
      "clean thumb piano",
      "Four Tet, Caribou, ambient, hyperpop",
    ),
    mbira: preset(
      {
        body: "mbira",
        ring: 1.4,
        tilt: 0.8,
        hardness: 0.7,
        position: 0.7,
        buzz: 0.35,
      },
      [48, 84],
      "thumb-plucked tines with a bottle-cap buzz",
      "mbira, Four Tet, Caribou",
    ),
    steelpan: preset(
      { body: "steelpan", ring: 1.6, tilt: 0.6, hardness: 0.6, position: 0.5 },
      [60, 88],
      "tuned steel drum with near-harmonic partials",
      "Caribou, ambient, calypso",
    ),
    bowl: preset(
      { body: "bowl", ring: 18, tilt: 0.25, hardness: 0.2, position: 0.5 },
      [48, 79],
      "singing bowl, beating split modes",
      "ambient, Eno, La Monte Young",
    ),
    gong: preset(
      { body: "gong", ring: 12, tilt: 0.3, hardness: 0.15, position: 0.5 },
      [31, 55],
      "gong ageng: deep, beating, very long",
      "gamelan, ambient, La Monte Young",
    ),
    timpani: preset(
      {
        body: "timpani",
        ring: 2.2,
        tilt: 0.6,
        hardness: 0.4,
        position: 0.75,
        strikebend: 0.3,
        strikedecay: 0.15,
      },
      [40, 60],
      "pedal timpani, felt sticks, a small strike glide",
      "Beethoven, Brahms, Shostakovich, orchestral",
    ),
    // f061-gamelan-winds (lane A2): appended; rows above are unchanged.
    // Gamelan ranges follow the instruments' slendro/pelog octaves; tune
    // them with `tuning slendro` or `tuning pelog` (core/tuning.ts).
    crotales: preset(
      {
        body: "crotale",
        ring: 6,
        tilt: 0.4,
        hardness: 0.85,
        position: 0.5,
        gain: 1.6,
      },
      [84, 108],
      "antique cymbals, long shimmering ring",
      "Messiaen, ambient",
    ),
    musicbox: preset(
      {
        body: "musicbox",
        ring: 1.8,
        tilt: 0.7,
        hardness: 1,
        position: 0.8,
        gain: 1.7,
      },
      [60, 100],
      "plucked steel comb",
      "ambient, OPN, A. G. Cook",
    ),
    toypiano: preset(
      {
        body: "toypiano",
        ring: 1,
        tilt: 0.6,
        hardness: 0.9,
        position: 0.6,
        click: 0.3,
        gain: 2,
      },
      [60, 96],
      "hammered toy-piano rods, clanky",
      "hyperpop, A. G. Cook, Four Tet",
    ),
    saron: preset(
      {
        body: "saron",
        ring: 2.5,
        tilt: 0.6,
        hardness: 0.85,
        position: 0.5,
        damp: 0.85,
        release: 0.1,
      },
      [60, 84],
      "saron barung: bronze keys, horn mallet, the balungan melody; damped at the next note (tutupan)",
      "Javanese gamelan, Reich",
    ),
    demung: preset(
      {
        body: "saron",
        ring: 3.2,
        tilt: 0.6,
        hardness: 0.75,
        position: 0.5,
        damp: 0.8,
        release: 0.12,
      },
      [48, 72],
      "demung: the saron an octave lower, fuller",
      "Javanese gamelan",
    ),
    slenthem: preset(
      { body: "gender", ring: 4.5, tilt: 0.5, hardness: 0.25, position: 0.5 },
      [43, 60],
      "slenthem: low bronze keys over tubes, padded mallet",
      "Javanese gamelan, ambient",
    ),
    gangsa: preset(
      {
        body: "saron",
        ring: 2.2,
        tilt: 0.6,
        hardness: 0.9,
        position: 0.5,
        ombak: 7,
        damp: 0.85,
        release: 0.1,
      },
      [60, 89],
      "Balinese metallophone: pengumbang and pengisep beating at 7 Hz (ombak)",
      "Balinese gamelan, Lopatin, Four Tet",
    ),
    gender: preset(
      { body: "gender", ring: 5, tilt: 0.5, hardness: 0.3, position: 0.5 },
      [48, 84],
      "gender: thin bronze keys over tubes, padded mallets, long ring",
      "Javanese gamelan, ambient",
    ),
    bonang: preset(
      {
        body: "bonang",
        ring: 1.8,
        tilt: 0.7,
        hardness: 0.6,
        position: 0.5,
        damp: 0.7,
        release: 0.12,
      },
      [55, 84],
      "bonang: small kettle gongs in a row, padded sticks",
      "Javanese gamelan, Reich",
    ),
    kenong: preset(
      { body: "bonang", ring: 4, tilt: 0.5, hardness: 0.45, position: 0.5 },
      [55, 72],
      "kenong: large kettle gong that marks the phrase",
      "Javanese gamelan",
    ),
    kethuk: preset(
      {
        body: "bonang",
        ring: 0.5,
        tilt: 0.7,
        hardness: 0.5,
        position: 0.5,
        damp: 1,
        release: 0.08,
      },
      [55, 67],
      "kethuk: small kettle gong, struck and damped (tutupan)",
      "Javanese gamelan",
    ),
    kempul: preset(
      { body: "kempul", ring: 6, tilt: 0.4, hardness: 0.25, position: 0.5 },
      [43, 67],
      "kempul: hanging gong, slow beating",
      "Javanese gamelan",
    ),
    daf: preset(
      {
        body: "frame",
        ring: 0.5,
        tilt: 0.8,
        hardness: 0.6,
        position: 0.85,
        buzz: 0.6,
      },
      [43, 55],
      "Persian frame drum with ring jingles",
      "Persian, Sufi",
    ),
    bodhran: preset(
      {
        body: "frame",
        ring: 0.35,
        tilt: 0.9,
        hardness: 0.5,
        position: 0.8,
        damp: 0.4,
        gain: 2,
      },
      [40, 52],
      "Irish frame drum, tipper",
      "celtic",
    ),
    tabla: preset(
      {
        body: "tabla",
        ring: 1.2,
        tilt: 0.5,
        hardness: 0.7,
        position: 0.75,
        strikebend: 0.4,
        strikedecay: 0.12,
        gain: 2,
      },
      [57, 69],
      "dayan: tuned treble drum with near-harmonic syahi modes",
      "Hindustani, Talvin Singh, Four Tet",
    ),
  });

/** Default preset of a `modal` field that names none. */
export const DEFAULT_MODAL_PRESET: ModalPresetName = "marimba";

/** A track's stored modal settings: a preset plus overrides, all optional. */
export type TrackModal = Readonly<{
  preset?: ModalPresetName;
  mallet?: ModalMallet;
  hardness?: number;
  position?: number;
  ring?: number;
  tilt?: number;
  damp?: number;
  release?: number;
  motor?: number;
  motordepth?: number;
  ombak?: number;
  buzz?: number;
  click?: number;
  strikebend?: number;
  strikedecay?: number;
  gain?: number;
  body?: ModalBody;
  /**
   * f061-gamelan-winds: the id of this track's partner in an ombak pair.
   * A paired track (the pengisep) plays one voice `ombak` Hz above the
   * pitch instead of its own twin, so it beats against its partner (the
   * pengumbang). Only this track's render changes.
   */
  pair?: string;
}>;

export function isModalPreset(name: string): name is ModalPresetName {
  return (MODAL_PRESET_NAMES as readonly string[]).includes(name);
}

/** A preset word or alias (`vibraphone`) to its preset; undefined if neither. */
export function modalPresetFor(word: string): ModalPresetName | undefined {
  const lower = word.trim().toLowerCase();
  if (isModalPreset(lower)) return lower;
  return MODAL_ALIASES[lower];
}

export function isModalParam(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODAL_PARAMS, name);
}

/** Strudel spelling (`penv`, `pdecay`, `rel`) to a modal parameter name. */
export function modalParamName(name: string): string | undefined {
  if (isModalParam(name)) return name;
  for (const [key, spec] of Object.entries(MODAL_PARAMS))
    if (spec.strudel?.includes(name)) return key;
  return undefined;
}

/**
 * Validates a `modal` field: `{ preset?, ...overrides }`, null or absent
 * meaning none. Keys come out in canonical order (preset, then
 * `MODAL_PARAMS` order) so equal settings print equally. `{}` is kept: it
 * means the default preset.
 */
export function normalizeModal(input: unknown): TrackModal | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new FxValidationError("track modal must be an object or null");
  const params: Record<string, unknown> = {};
  let presetName: ModalPresetName | undefined;
  let pair: string | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === "pair") {
      if (typeof value !== "string" || !PAIR_ID.test(value))
        throw new FxValidationError(
          "modal pair must be a track id (letters, digits, - or _)",
        );
      pair = value;
      continue;
    }
    if (key === "preset") {
      if (typeof value !== "string")
        throw new FxValidationError(
          `modal preset must be one of ${MODAL_PRESET_NAMES.join(", ")}`,
        );
      const resolved = modalPresetFor(value);
      if (!resolved)
        throw new FxValidationError(
          `modal preset must be one of ${MODAL_PRESET_NAMES.join(", ")}`,
        );
      presetName = resolved;
      continue;
    }
    const name = modalParamName(key);
    if (!name)
      throw new FxValidationError(
        `modal has no parameter "${key.slice(0, 32)}"`,
      );
    params[name] = value;
  }
  const values = normalizeParams(MODAL_PARAMS, params, "modal", false);
  return Object.freeze({
    ...(presetName ? { preset: presetName } : {}),
    ...values,
    ...(pair === undefined ? {} : { pair }),
  }) as TrackModal;
}

/**
 * The settings a `modal` field plays: defaults, then the preset, then the
 * mallet's hardness, then explicit overrides. `lane` reads an automation
 * lane value for a parameter (at the note's onset) when present.
 */
export function modalSettings(
  modal: TrackModal | undefined,
  lane?: (param: string) => number | undefined,
): ModalSettings {
  const base = MODAL_PRESETS[modal?.preset ?? DEFAULT_MODAL_PRESET].settings;
  const out: Record<string, number | string> = { ...base };
  if (modal?.mallet) out.hardness = MODAL_MALLETS[modal.mallet];
  if (modal)
    for (const [key, value] of Object.entries(modal))
      if (
        key !== "preset" &&
        key !== "mallet" &&
        key !== "pair" &&
        value !== undefined
      )
        out[key] = value;
  if (lane)
    for (const key of MODAL_LANE_PARAMS) {
      const value = lane(key.param);
      if (value !== undefined) out[key.param] = value;
    }
  return Object.freeze(out) as ModalSettings;
}

/** Parameters with a `modal-<param>` automation lane. */
export const MODAL_LANE_PARAMS: readonly Readonly<{
  param: string;
  spec: NumberParam;
}>[] = Object.freeze(
  Object.entries(MODAL_PARAMS)
    .filter(
      (entry): entry is [string, NumberParam] =>
        entry[1].kind === "number" && entry[1].automate === true,
    )
    .map(([param, spec]) => Object.freeze({ param, spec })),
);

/** Upper bound on a modal voice's ring after note-off, in seconds. */
export const MAX_RESONATOR_TAIL = 30;
/** Voices one modal track sounds at once; the oldest onset is stolen. */
export const MAX_RESONATOR_VOICES = 32;
/** Joins the stem cache key so mode-table changes invalidate stems. */
export const RESONATOR_TABLE_VERSION = 2;

/** A modal `pair` value: a track id. */
const PAIR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A modal track's ring-out after its last note-off, in seconds: the preset
 * ring stretched to an octave below middle C by `tilt`, or the choke time
 * when fully damped. Early silence detection usually stops sooner.
 */
export function modalTailSeconds(
  modal: TrackModal | undefined,
  lowestPitch?: number,
): number {
  const s = modalSettings(modal);
  if (s.damp >= 0.999) return Math.min(MAX_RESONATOR_TAIL, s.release + 0.05);
  // The ring law at C3, or at the lowest note when it is lower (a low gong
  // rings longer than the C3 estimate).
  const octavesBelowC4 =
    lowestPitch === undefined ? 1 : Math.max(1, (60 - lowestPitch) / 12);
  return Math.min(MAX_RESONATOR_TAIL, s.ring * 2 ** (s.tilt * octavesBelowC4));
}

/**
 * The track patch an instrument word makes: a modal word (`vibes`,
 * `glockenspiel`, `modal`) sets `instrument: "modal"` and `modal: { preset }`;
 * any other word (legacy `marimba` included) only sets `instrument`.
 */
export function instrumentPatchForWord(word: string): {
  instrument: string;
  modal?: TrackModal;
  wind?: TrackWind;
  sing?: TrackSing;
} {
  const meaning = resolveInstrumentWord(word);
  // f07-sing: `choir`, `aah`, `khoomei` sing a preset.
  if (meaning?.field === "sing" && meaning.instrument === SING_INSTRUMENT) {
    const preset =
      meaning.preset && isSingPreset(meaning.preset)
        ? meaning.preset
        : undefined;
    return {
      instrument: SING_INSTRUMENT,
      sing: Object.freeze(preset ? { preset } : {}) as TrackSing,
    };
  }
  // f061-gamelan-winds: `flute`, `sax`, `tuba` play a wind preset.
  if (meaning?.field === "wind" && meaning.instrument === WIND_INSTRUMENT) {
    const preset = meaning.preset ? windPresetFor(meaning.preset) : undefined;
    return {
      instrument: WIND_INSTRUMENT,
      wind: Object.freeze(preset ? { preset } : {}) as TrackWind,
    };
  }
  if (meaning?.field === "modal" && meaning.instrument === MODAL_INSTRUMENT) {
    const preset = meaning.preset ? modalPresetFor(meaning.preset) : undefined;
    return {
      instrument: MODAL_INSTRUMENT,
      modal: Object.freeze(preset ? { preset } : {}) as TrackModal,
    };
  }
  return { instrument: meaning?.instrument ?? word };
}

/** True for a word that resolves to the modal engine (`vibes`, `gong`). */
export function isModalWord(word: string): boolean {
  const meaning = resolveInstrumentWord(word);
  return (
    meaning?.instrument === MODAL_INSTRUMENT ||
    (meaning?.field === "wind" && meaning.instrument === WIND_INSTRUMENT) ||
    (meaning?.field === "sing" && meaning.instrument === SING_INSTRUMENT)
  );
}

/**
 * `dawg check` notes for ombak pairs whose partner is missing or is not a
 * modal track: the pengisep then plays ombak Hz sharp with nothing to beat
 * against.
 */
export function modalPairWarnings(
  tracks: readonly Readonly<{
    id: string;
    instrument: string;
    modal?: Readonly<{ pair?: string }>;
  }>[],
): string[] {
  const out: string[] = [];
  for (const track of tracks) {
    const pair = track.modal?.pair;
    if (pair === undefined) continue;
    const partner = tracks.find((candidate) => candidate.id === pair);
    if (!partner)
      out.push(
        `track ${track.id}: modal pair "${pair}" names no track; it plays ombak Hz sharp alone`,
      );
    else if (partner.instrument !== MODAL_INSTRUMENT || !partner.modal)
      out.push(
        `track ${track.id}: modal pair "${pair}" is not a modal track; give it the same preset (modal gangsa)`,
      );
  }
  return out;
}

/**
 * `dawg check` notes for tracks that store a legacy word the 0.6 physical
 * engines also answer to (`marimba`, `modal`, `wind`) with no engine
 * field: they keep the pre-0.6 tone, which is right for old projects but
 * rarely what a new one means.
 */
export function legacyResonatorWarnings(
  tracks: readonly Readonly<{
    id: string;
    instrument: string;
    modal?: unknown;
    wind?: unknown;
  }>[],
): string[] {
  const out: string[] = [];
  for (const track of tracks) {
    if (
      track.instrument === "marimba" ||
      track.instrument === MODAL_INSTRUMENT
    ) {
      if (track.modal === undefined)
        out.push(
          `track ${track.id}: instrument "${track.instrument}" plays the legacy marimba tone; use modal("marimba") (or \`modal marimba\`) for the modal mallet engine`,
        );
    } else if (track.instrument === "wind" && track.wind === undefined)
      out.push(
        `track ${track.id}: instrument "wind" plays the legacy wind tone; the 0.6 wind engine needs a wind preset`,
      );
  }
  return out;
}

// f061-gamelan-winds: blown instruments live in core/winds.ts.
export * from "./winds.ts";
