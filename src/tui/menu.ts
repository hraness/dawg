/**
 * The hand-editing menu (`/menu`, Ctrl-K): every edit the agent can make,
 * reachable with arrow keys. Pure: the tree is rebuilt from the score on
 * every key, and a change is returned as the command it stands for, which
 * the caller runs through the normal prompt path (one ScoreOperation, one
 * receipt, one undo step). Each row shows its current value and that
 * command, so the menu teaches the commands.
 *
 * Rendering reuses the TUI's picker overlay: `view()` returns a picker.
 */
import { HINTS } from "../../tui/grammar.ts";
import { auditionKey, type AuditionKey } from "./audition.ts";
import {
  AUTOMATION_PARAMETERS,
  automationPoints,
  automationRange,
  REVERB_IR_BUILTINS,
  SAMPLE_UNITS,
  SCORE_LIMITS,
  isTrackAutomationParameter,
  WARP_MODES,
  WAVETABLE_PARAMS,
  isWavetableInstrument,
  wavetableOf,
  type WavetableParam,
  type AutomationParameter,
  type Track,
  type TrackAutomationParameter,
  type TrackScore,
} from "../../core/score.ts";
import {
  CORE_EFFECTS,
  EFFECT_NAMES,
  FX_LANES,
  effectPresetNames,
  effectSpec,
  type EffectName,
  type FxLane,
  type NumberParam,
  type ParamSpec,
} from "../../core/fx.ts";
import { effectValues } from "../commands/fx.ts";
import { SAMPLE_CONTROLS, type SampleControl } from "../commands/sample.ts";
import { AVAILABLE_INSTRUMENTS } from "../audio/wav.ts";
import {
  DEFAULT_KITS,
  GM_INSTRUMENTS,
  PACK_CATALOG,
  STRUDEL_BANK_ALIASES,
} from "../audio/packs.ts";
import { kitCatalog } from "../audio/kits.ts";
import { SYNTH_KIT_NAMES } from "../../core/kits.ts";
import { DRUM_PATTERNS } from "../../core/sdk/v1.ts";
import { isDrumInstrument } from "../../core/drums.ts";
import {
  SYNTH_GROUPS,
  SYNTH_PARAMS,
  SYNTH_PRESETS,
  SYNTH_SIMPLE,
  normalizeSynth,
} from "../../core/synth.ts";
import type { PickerItem } from "../../tui/app.ts";
import { BUILTIN_TABLES, BUILTIN_TABLE_NAMES } from "../audio/wavetable.ts";
import {
  UZU_WAVETABLES,
  WAVETABLE_PACK,
  describeTable,
  listLocalWavetables,
} from "../commands/wavetable.ts";
import {
  BASS_MODES,
  CHORD_PATTERNS,
  MAX_VOICING_STEP,
  MODE_NAMES,
  PERFORM_MODES,
  PROGRESSION_PRESETS,
  PROGRESSION_STYLES,
  SPREADS,
  keyName,
  parseKey,
} from "../../core/chords.ts";
import {
  ARP_RATES,
  CHORD_MODES,
  defaultChordSettings,
  type ChordSettings,
} from "./play-chords.ts";

/** What the menu needs to know beyond the score. */
export type MenuContext = Readonly<{
  score: TrackScore;
  trackId: string;
  playing: boolean;
  grid: string;
  grids: readonly string[];
  clickOn: boolean;
  countInBars: number;
  /** Play mode's chord settings (defaults when absent). */
  chords?: ChordSettings;
  /** Project root, for the project's own wavetables (none when absent). */
  projectRoot?: string;
  /**
   * The audition loop (src/tui/audition.ts), when the window hosts one.
   * `score` above is then the staged score; changed rows show the
   * committed value beside the staged one.
   */
  audition?: MenuAudition;
}>;

/** What the menu needs from the audition controller. */
export type MenuAudition = Readonly<{
  looping: boolean;
  /** Edits are staged (an Enter keeps them, Esc reverts them). */
  dirty: boolean;
  /** The committed score, for `staged ← committed` on changed rows. */
  committed: TrackScore;
  /** The footer while auditioning. */
  hint: string;
  /** `♪ solo · B staged 2 · 42 ms`, shown in the title. */
  status?: string | undefined;
}>;

type NumberField = Readonly<{
  kind: "number";
  label: string;
  /** `undefined` while the effect is off; a nudge then turns it on. */
  value: number | undefined;
  min: number;
  max: number;
  /** Next value one step in `direction`. */
  step: (value: number, direction: 1 | -1) => number;
  format: (value: number) => string;
  command: (value: number) => string;
  /** Shown while `value` is undefined. */
  off?: string;
  /** Starting value for a nudge while off. */
  start?: number;
  /** The command `x` runs to put the value back to its default. */
  reset?: string;
}>;

export type MenuNode = (
  | Readonly<{
      kind: "menu";
      id: string;
      label: string;
      detail: string;
      build: (context: MenuContext) => MenuNode[];
    }>
  | NumberField
  | Readonly<{
      kind: "toggle";
      label: string;
      value: boolean;
      command: (value: boolean) => string;
    }>
  | Readonly<{
      kind: "choice";
      label: string;
      value: string;
      options: readonly string[];
      command: (option: string) => string;
    }>
  | Readonly<{
      kind: "entry";
      label: string;
      value: string;
      /** Shown in the title while typing. */
      placeholder: string;
      /** Command for the typed text; undefined when it cannot parse. */
      command: (text: string) => string | undefined;
      /** Shown as the slash-command equivalent. */
      example: string;
    }>
  | Readonly<{ kind: "action"; label: string; command: string }>
  | Readonly<{
      kind: "point";
      label: string;
      lane: AutomationParameter;
      beat: number;
      value: number;
    }>
  | Readonly<{ kind: "info"; label: string; value: string }>
) &
  Readonly<{
    /** One line on what the focused row does, shown under the list. */
    help?: string;
  }>;

/** What a key did; `run` carries the command to execute. */
export type MenuResult =
  | { type: "handled" }
  | { type: "close" }
  | { type: "run"; command: string }
  /** Space (loop), `a` (A/B) or `c` (context) for the audition loop. */
  | { type: "audition"; key: AuditionKey }
  /** Commit the staged edits as one operation. */
  | { type: "keep" }
  /** Drop the staged edits. */
  | { type: "revert" }
  | { type: "pass" };

export type MenuView = Readonly<{
  title: string;
  items: PickerItem[];
  index: number;
  hint: string;
  /** What the focused row does, and the prompt command it stands for. */
  note: string;
}>;

// ── formatting and steps ──────────────────────────────────────────────

export function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

const linear =
  (size: number, min: number, max: number) =>
  (value: number, direction: 1 | -1) =>
    clamp(Math.round((value + size * direction) / size) * size, min, max);

/** Cutoff moves by thirds of an octave-ish so the low end stays usable. */
const cutoffStep = (value: number, direction: 1 | -1) =>
  clamp(
    Math.round(direction > 0 ? value * 1.25 : value / 1.25),
    SCORE_LIMITS.minFilterCutoff,
    SCORE_LIMITS.maxFilterCutoff,
  );

const DELAY_BEATS = [
  0.0625, 0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4,
] as const;
const delayStep = (value: number, direction: 1 | -1) => {
  if (direction > 0)
    return DELAY_BEATS.find((beats) => beats > value + 1e-9) ?? 4;
  return (
    [...DELAY_BEATS].reverse().find((beats) => beats < value - 1e-9) ?? 0.0625
  );
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const TRACK_LANE_STEP: Readonly<
  Record<TrackAutomationParameter, (value: number, direction: 1 | -1) => number>
> = {
  volume: linear(0.05, 0, SCORE_LIMITS.maxVolume),
  pan: linear(0.1, -1, 1),
  filter: cutoffStep,
  resonance: linear(0.05, 0, SCORE_LIMITS.maxFilterResonance),
  "delay-feedback": linear(0.05, 0, SCORE_LIMITS.maxDelayFeedback),
  "delay-mix": linear(0.05, 0, SCORE_LIMITS.maxDelayMix),
  wt: linear(0.05, 0, 1),
};

const TRACK_LANE_LABEL: Readonly<Record<TrackAutomationParameter, string>> = {
  volume: "volume",
  pan: "pan",
  filter: "filter cutoff (Hz)",
  resonance: "filter resonance",
  "delay-feedback": "delay feedback",
  "delay-mix": "delay mix",
  wt: "wavetable position",
};

const FX_LANE_INFO = new Map(FX_LANES.map((entry) => [entry.lane, entry]));

/** Nudge for a number spec: linear by its step, or a sixth of an octave. */
function specStep(
  spec: NumberParam,
): (value: number, direction: 1 | -1) => number {
  if (spec.step === "log")
    return (value, direction) => {
      const next = Math.max(value, 1) * 2 ** (direction / 6);
      return clamp(
        next >= 100 ? Math.round(next) : Math.round(next * 10) / 10,
        spec.min,
        spec.max,
      );
    };
  const size = spec.step;
  return (value, direction) => {
    const next = Math.round((value + size * direction) / size) * size;
    return clamp(Number(next.toFixed(6)), spec.min, spec.max);
  };
}

function laneStep(
  lane: AutomationParameter,
): (value: number, direction: 1 | -1) => number {
  if (isTrackAutomationParameter(lane)) return TRACK_LANE_STEP[lane];
  const info = FX_LANE_INFO.get(lane);
  return info ? specStep(info.spec) : linear(0.05, 0, 1);
}

function laneLabel(lane: AutomationParameter): string {
  if (isTrackAutomationParameter(lane)) return TRACK_LANE_LABEL[lane];
  const info = FX_LANE_INFO.get(lane);
  if (!info) return lane;
  const unit = info.spec.unit ? ` (${info.spec.unit})` : "";
  const owner =
    info.effect === "synth" ? "synth" : effectSpec(info.effect).label;
  return `${owner} ${info.param}${unit}`;
}

/** `volume 0.8`, `pan -0.3`: the command that sets a lane's static value. */
function laneFormat(lane: AutomationParameter, value: number): string {
  if (lane === "filter") return `${Math.round(value)}`;
  const info = FX_LANE_INFO.get(lane as FxLane);
  if (info?.spec.step === "log" && value >= 100) return `${Math.round(value)}`;
  return num(value);
}

// ── the tree ──────────────────────────────────────────────────────────

function focused(context: MenuContext): Track | undefined {
  return context.score.tracks.find((track) => track.id === context.trackId);
}

export function rootNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  const name = track?.name ?? context.trackId;
  const effects = EFFECT_NAMES.filter((effect) => effectValues(track, effect));
  const automated = AUTOMATION_PARAMETERS.filter(
    (lane) => automationPoints(track, lane).length > 0,
  ).length;
  const tracks = context.score.tracks.length;
  return [
    {
      kind: "menu",
      id: "sound",
      label: "Sound",
      detail: `${name} · ${track?.instrument ?? "?"}`,
      help: "the focused track's instrument and its voice",
      build: soundSectionNodes,
    },
    {
      kind: "menu",
      id: "effects",
      label: "Effects",
      detail: effects.length ? effects.join(" · ") : "none on",
      help: "filter, delay, reverb and more on the focused track",
      build: effectNodes,
    },
    {
      kind: "menu",
      id: "rhythm",
      label: "Rhythm",
      detail: "euclid editor · patterns · kits",
      help: "drum hits per voice, ready-made grooves and drum kits",
      build: rhythmNodes,
    },
    {
      kind: "menu",
      id: "chords",
      label: "Chords",
      detail: chordsDetail(context),
      help: "song key and how chords play in play mode (Ctrl-P)",
      build: chordNodes,
    },
    {
      kind: "menu",
      id: "mix",
      label: "Mix & automation",
      detail: `${tracks} track${tracks === 1 ? "" : "s"} · ${automated} lane${automated === 1 ? "" : "s"} moving`,
      help: "volume, pan, mute and solo per track; values that change over time",
      build: mixSectionNodes,
    },
    {
      kind: "menu",
      id: "project",
      label: "Project",
      detail: `${num(context.score.tempoBpm)} BPM · ${context.score.beatsPerBar}/4 · ${context.score.bars} bars`,
      help: "tempo, meter, loop length, play, click and count-in",
      build: transportNodes,
    },
  ];
}

/** Old section names still open the menu where that content now lives. */
const SECTION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  sound: ["sound"],
  parameters: ["sound"],
  sounds: ["sound", "browse"],
  effects: ["effects"],
  rhythm: ["rhythm"],
  chords: ["chords"],
  mix: ["mix"],
  track: ["mix"],
  automation: ["mix", "automation"],
  project: ["project"],
  transport: ["project"],
};

/** Sound: instrument and voice first, then the sound browser. */
function soundSectionNodes(context: MenuContext): MenuNode[] {
  return [
    ...parameterNodes(context),
    {
      kind: "menu",
      id: "browse",
      label: "browse sounds",
      detail: soundsDetail(focused(context)),
      help: "instruments, wavetables, sample packs",
      build: soundNodes,
    },
  ];
}

/** Rhythm: the euclid editor, then grooves and kits. */
function rhythmNodes(): MenuNode[] {
  return [
    {
      kind: "action",
      label: "euclid editor",
      command: "/euclid",
      help: "hits, steps and rotation per drum voice",
    },
    patternsMenu(),
    kitsMenu(),
  ];
}

/** Mix & automation: this track, every track, then automation lanes. */
function mixSectionNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  const automated = AUTOMATION_PARAMETERS.filter(
    (lane) => automationPoints(track, lane).length > 0,
  ).join(" ");
  return [
    ...trackNodes(context),
    {
      kind: "menu",
      id: "tracks",
      label: "all tracks",
      detail: `${context.score.tracks.length} · focus another track`,
      help: "pick a track to edit; ● is the focused one",
      build: mixNodes,
    },
    {
      kind: "menu",
      id: "automation",
      label: "automation",
      detail: automated || "no lanes yet",
      help: "points that move a value over the loop",
      build: automationNodes,
    },
  ];
}

function chordsDetail(context: MenuContext): string {
  const chords = context.chords ?? defaultChordSettings();
  const key = parseKey(context.score.key ?? undefined);
  return `${chords.mode} · ${key ? keyName(key) : "no key"} · ${chords.perform}`;
}

/** Play mode's chord settings and the song key (`/chords …`, `key …`). */
function chordNodes(context: MenuContext): MenuNode[] {
  const chords = context.chords ?? defaultChordSettings();
  const key = parseKey(context.score.key ?? undefined);
  const tonic = key ? keyName(key).split(" ")[0]! : "C";
  const mode = key?.mode ?? "major";
  const presets = PROGRESSION_PRESETS.map((preset) => preset.name);
  return [
    {
      kind: "choice",
      label: "mode",
      help: "auto: keys play chords in the song key · manual: latch 1–8 · off",
      value: chords.mode,
      options: CHORD_MODES,
      command: (option) => `/chords ${option}`,
    },
    {
      kind: "choice",
      label: "key tonic",
      help: "the song key; auto chord mode follows it",
      value: tonic,
      options: TONICS,
      command: (option) => `key ${option} ${mode}`,
    },
    {
      kind: "choice",
      label: "key mode",
      help: "major, minor or a church mode",
      value: mode,
      options: MODE_NAMES,
      command: (option) => `key ${tonic} ${option}`,
    },
    {
      kind: "number",
      label: "voicing",
      help: "inversion steps up or down (play mode: - =)",
      value: chords.inversion,
      min: -MAX_VOICING_STEP,
      max: MAX_VOICING_STEP,
      step: linear(1, -MAX_VOICING_STEP, MAX_VOICING_STEP),
      format: (value) => (value > 0 ? `+${value}` : String(value)),
      command: (value) => `/chords voicing ${Math.round(value)}`,
    },
    {
      kind: "choice",
      label: "spread",
      help: "close, open or wide chord voicing",
      value: chords.spread,
      options: SPREADS,
      command: (option) => `/chords spread ${option}`,
    },
    {
      kind: "choice",
      label: "bass",
      help: "what the left hand plays under the chord (play mode: b)",
      value: chords.bass,
      options: BASS_MODES,
      command: (option) => `/chords bass ${option}`,
    },
    {
      kind: "toggle",
      label: "sevenths",
      help: "auto mode plays sevenths instead of triads",
      value: chords.sevenths,
      command: (on) => `/chords sevenths ${on ? "on" : "off"}`,
    },
    {
      kind: "choice",
      label: "perform",
      help: "block, strum, arpeggio or a rhythm pattern (play mode: 9)",
      value: chords.perform,
      options: PERFORM_MODES,
      command: (option) => `/chords perform ${option}`,
    },
    {
      kind: "choice",
      label: "pattern",
      help: "the rhythm used when perform is pattern",
      value: chords.pattern,
      options: CHORD_PATTERNS.map((pattern) => pattern.name),
      command: (option) => `/chords pattern ${option}`,
    },
    {
      kind: "choice",
      label: "arp rate",
      help: "arpeggio step length",
      value: chords.rate,
      options: ARP_RATES,
      command: (option) => `/chords rate ${option}`,
    },
    {
      kind: "number",
      label: "arp octaves",
      help: "how many octaves an arpeggio climbs",
      value: chords.octaves,
      min: 1,
      max: 4,
      step: linear(1, 1, 4),
      format: (value) => `${num(value)} oct`,
      command: (value) => `/chords octaves ${Math.round(value)}`,
    },
    {
      kind: "choice",
      label: "progression",
      help: "a preset the n key walks through",
      value: chords.preset,
      options: ["none", ...presets],
      command: (option) => `/chords preset ${option}`,
    },
    {
      kind: "choice",
      label: "style",
      help: "the style n suggests next chords in",
      value: chords.style,
      options: PROGRESSION_STYLES,
      command: (option) => `/chords style ${option}`,
    },
  ];
}

const TONICS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

function trackNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  if (!track)
    return [{ kind: "info", label: "no track", value: "/track <name>" }];
  return [
    {
      kind: "entry",
      label: "name",
      value: track.name,
      placeholder: "new name",
      command: (text) =>
        text.trim() ? `track name ${text.trim()}` : undefined,
      example: `track name ${track.name}`,
      help: "rename the focused track",
    },
    {
      kind: "toggle",
      label: "mute",
      value: track.muted,
      command: (on) => (on ? "mute" : "unmute"),
      help: "silence this track",
    },
    {
      kind: "toggle",
      label: "solo",
      value: track.solo === true,
      command: (on) => (on ? "solo" : "unsolo"),
      help: "hear only soloed tracks",
    },
    volumeNode(track),
    panNode(track),
  ];
}

function instrumentNode(track: Track): MenuNode {
  const options: string[] = [...AVAILABLE_INSTRUMENTS];
  if (!options.includes(track.instrument)) options.push(track.instrument);
  return {
    kind: "choice",
    label: "instrument",
    value: track.instrument,
    options,
    command: (option) => `instrument ${option}`,
    help: "the sound source; drums use kit",
  };
}

function volumeNode(track: Track): MenuNode {
  return {
    kind: "number",
    label: "volume",
    value: track.volume,
    min: 0,
    max: SCORE_LIMITS.maxVolume,
    step: TRACK_LANE_STEP.volume,
    format: (value) =>
      `${num(value)} · ${value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dB` : "silent"}`,
    command: (value) => `volume ${num(value)}`,
    reset: "volume 1",
    help: "track gain; 1 is unity (0 dB) · x resets",
  };
}

function panNode(track: Track): MenuNode {
  return {
    kind: "number",
    label: "pan",
    value: track.pan,
    min: -1,
    max: 1,
    step: TRACK_LANE_STEP.pan,
    format: (value) =>
      value === 0
        ? "center"
        : `${num(Math.abs(value))} ${value < 0 ? "L" : "R"}`,
    command: (value) => `pan ${num(value)}`,
    reset: "pan 0",
    help: "-1 left … 1 right · x centres",
  };
}

function parameterNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  const nodes: MenuNode[] = [instrumentNode(track)];
  // A wavetable track also has the synth voice's envelope, filters and FM.
  if (isWavetableInstrument(track.instrument))
    nodes.push(...wavetableNodes(track, context.projectRoot));
  if (track.sampler) {
    nodes.push({
      kind: "info",
      label: "sampler mode",
      value: track.sampler.mode,
    });
    for (const [voice, ref] of Object.entries(track.sampler.voices).sort()) {
      const extras = [
        ref.root !== undefined ? `root ${ref.root}` : "",
        ref.gain !== undefined ? `gain ${num(ref.gain)}` : "",
        ref.speed !== undefined ? `speed ${num(ref.speed)}` : "",
      ].filter(Boolean);
      nodes.push({
        kind: "menu",
        id: `sample:${voice}`,
        label: voice,
        detail: [ref.src.split("/").at(-1), ...extras].join(" · "),
        help: "this voice's sample controls (Strudel names)",
        build: (context) => sampleVoiceNodes(context, voice),
      });
    }
    nodes.push({
      kind: "info",
      label: "add a voice",
      value: "/sample <path> [as <voice>]",
    });
  } else if (!isDrumInstrument(track.instrument)) {
    nodes.push(...synthNodes(track, SYNTH_SIMPLE));
    nodes.push({
      kind: "menu",
      id: "synth:advanced",
      label: "advanced",
      detail: `all ${Object.keys(SYNTH_PARAMS).length} params`,
      help: "every voice parameter, grouped, under its Strudel name",
      build: synthAdvancedNodes,
    });
    if (track.synth)
      nodes.push({
        kind: "action",
        label: "reset to defaults",
        command: "synth reset",
        help: "clear every voice setting on this track",
      });
  }
  return nodes;
}

/** Number rows for `/sample set`: [control, min, max, step, default]. */
const SAMPLE_NUMBER_ROWS: readonly (readonly [
  SampleControl,
  number,
  number,
  number,
  number,
])[] = [
  ["begin", 0, 0.99, 0.01, 0],
  ["end", 0.01, 1, 0.01, 1],
  ["gain", 0, SCORE_LIMITS.maxSampleGain, 0.05, 1],
  ["speed", -SCORE_LIMITS.maxSampleSpeed, SCORE_LIMITS.maxSampleSpeed, 0.05, 1],
  ["loopBegin", 0, 0.99, 0.01, 0],
  ["loopEnd", 0.01, 1, 0.01, 1],
  ["clip", 0.05, SCORE_LIMITS.maxSampleClip, 0.05, 1],
  [
    "accelerate",
    -SCORE_LIMITS.maxSampleAccelerate,
    SCORE_LIMITS.maxSampleAccelerate,
    0.1,
    0,
  ],
  ["squiz", 1, SCORE_LIMITS.maxSampleSquiz, 0.5, 1],
];

/** One sampler voice: every sample control, run through `/sample set`. */
function sampleVoiceNodes(context: MenuContext, voice: string): MenuNode[] {
  const track = context.score.tracks.find(
    (item) => item.id === context.trackId,
  );
  const ref = track?.sampler?.voices[voice];
  if (!ref) return [];
  const set = (rest: string) => `/sample set ${voice} ${rest}`;
  const nodes: MenuNode[] = [{ kind: "info", label: "file", value: ref.src }];
  for (const [control, min, max, step, start] of SAMPLE_NUMBER_ROWS) {
    const current = (ref as Record<string, unknown>)[control];
    nodes.push({
      kind: "number",
      label: control,
      value: typeof current === "number" ? current : undefined,
      start,
      off: num(start),
      min,
      max,
      step:
        control === "speed"
          ? (value, direction) => {
              // Speed 0 is invalid: step over it.
              const next = linear(step, min, max)(value, direction);
              return next === 0 ? step * direction : next;
            }
          : linear(step, min, max),
      format: num,
      command: (value) => set(`${control} ${num(value)}`),
      reset: set(`${control} off`),
      help: SAMPLE_CONTROLS[control],
    });
  }
  nodes.push(
    {
      kind: "choice",
      label: "unit",
      value: ref.unit ?? "r",
      options: SAMPLE_UNITS,
      command: (option) => set(`unit ${option}`),
      help: SAMPLE_CONTROLS.unit,
    },
    {
      kind: "toggle",
      label: "loop",
      value: ref.loop === true,
      command: (on) => set(`loop ${on ? "on" : "off"}`),
      help: SAMPLE_CONTROLS.loop,
    },
    {
      kind: "toggle",
      label: "fit",
      value: ref.fit === true,
      command: (on) => set(`fit ${on ? "on" : "off"}`),
      help: SAMPLE_CONTROLS.fit,
    },
    {
      kind: "info",
      label: "cut / loopAt",
      value: `/sample set ${voice} cut hats · loopAt 2`,
    },
  );
  return nodes;
}

/** Synth preset first, then one row per parameter. */
/** The preset this track's voice still matches exactly, if any. */
function matchingSynthPreset(track: Track): string | undefined {
  if (!track.synth) return undefined;
  const current = JSON.stringify(track.synth);
  return Object.entries(SYNTH_PRESETS).find(
    ([, preset]) =>
      preset.instrument === track.instrument &&
      JSON.stringify(normalizeSynth(preset.synth)) === current,
  )?.[0];
}

function synthNodes(track: Track, keys: readonly string[]): MenuNode[] {
  const nodes: MenuNode[] = [];
  if (keys === SYNTH_SIMPLE)
    nodes.push({
      kind: "choice",
      label: "preset",
      value: matchingSynthPreset(track) ?? "—",
      options: Object.keys(SYNTH_PRESETS),
      command: (preset) => `synth preset ${preset}`,
      help: "a starting voice; every value stays editable",
    });
  for (const key of keys)
    nodes.push(synthParamNode(track, key, keys !== SYNTH_SIMPLE));
  return nodes;
}

function synthParamNode(track: Track, key: string, named: boolean): MenuNode {
  const param = SYNTH_PARAMS[key]!;
  const current = track.synth?.[key];
  const aliases = (param.strudel ?? []).filter((name) => name !== key);
  const label = named
    ? aliases.length
      ? `${key} (${aliases.join("/")})`
      : key
    : (SYNTH_LABEL[key] ?? key);
  if (param.kind === "number")
    return {
      kind: "number",
      label,
      value: typeof current === "number" ? current : undefined,
      start: param.default,
      // An unset filter cutoff means no filter, not the default cutoff.
      off: /^(lpf|hpf|bpf)$/.test(key)
        ? "off"
        : withUnit(formatParam(param, param.default), param.unit),
      min: param.min,
      max: param.max,
      step: specStep(param),
      format: (value) => withUnit(formatParam(param, value), param.unit),
      command: (value) => `synth ${key} ${formatParam(param, value)}`,
      reset: `synth ${key} off`,
      help: param.doc,
    };
  if (param.kind === "enum")
    return {
      kind: "choice",
      label,
      value: typeof current === "string" ? current : param.default,
      options: param.values,
      command: (option) => `synth ${key} ${option}`,
      help: param.doc,
    };
  return {
    kind: "toggle",
    label,
    value: typeof current === "boolean" ? current : param.default,
    command: (on) => `synth ${key} ${on ? "on" : "off"}`,
    help: param.doc,
  };
}

/** Plain names for the simple synth rows; the note shows the command name. */
const SYNTH_LABEL: Readonly<Record<string, string>> = {
  lpf: "filter cutoff",
  lpq: "filter res",
  lpenv: "filter env",
  vib: "vibrato",
  fm: "FM amount",
};

/** Every synth parameter, grouped (amplitude, oscillator, FM 1..8, …). */
function synthAdvancedNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  const nodes: MenuNode[] = SYNTH_GROUPS.map((group) => {
    const set = group.params.filter((key) => track.synth?.[key] !== undefined);
    return {
      kind: "menu",
      id: `synth:${group.id}`,
      label: group.label,
      detail: set.length
        ? set.map((key) => `${key} ${String(track.synth![key])}`).join(" · ")
        : "defaults",
      build: (inner) => {
        const current = focused(inner);
        return current ? synthNodes(current, group.params) : [];
      },
    };
  });
  const partials = track.synth?.partials;
  nodes.push({
    kind: "entry",
    label: "partials",
    value: Array.isArray(partials) ? partials.join(" ") : "—",
    placeholder: "harmonic amplitudes, e.g. 1 0.5 0.33",
    command: (text) =>
      text.trim() ? `synth partials ${text.trim()}` : "synth partials off",
    example: "synth partials 1 0.5 0.33 0.25",
  });
  nodes.push({
    kind: "entry",
    label: "zzfx array",
    value: "—",
    placeholder: "a raw ZzFX array, e.g. ,,129,.01,,.15,2",
    command: (text) => `synth zzfx ${text.trim()}`,
    example: "synth zzfx ,,129,.01,,.15,2",
  });
  return nodes;
}

/** Short help for each wavetable parameter row. */
const WAVETABLE_LABELS: Readonly<Record<WavetableParam, string>> = {
  wt: "position (wt)",
  wtenv: "position env amount",
  wtattack: "position env attack s",
  wtdecay: "position env decay s",
  wtsustain: "position env sustain",
  wtrelease: "position env release s",
  wtrate: "position LFO Hz",
  wtdepth: "position LFO depth",
  warp: "warp",
  wtphaserand: "phase randomness",
};

const WAVETABLE_STEP: Readonly<Record<WavetableParam, number>> = {
  wt: 0.05,
  wtenv: 0.1,
  wtattack: 0.01,
  wtdecay: 0.05,
  wtsustain: 0.05,
  wtrelease: 0.05,
  wtrate: 0.25,
  wtdepth: 0.05,
  warp: 0.05,
  wtphaserand: 0.1,
};

function wavetableNodes(track: Track, projectRoot?: string): MenuNode[] {
  const settings = wavetableOf(track);
  const local = listLocalWavetables(projectRoot);
  const tables: MenuNode[] = [
    ...local.map((path): MenuNode => ({
      kind: "action",
      label: `${path.split("/").pop()}  project · ${path.split("/")[1]}`,
      command: `wt ${path}`,
    })),
    ...BUILTIN_TABLE_NAMES.map((name): MenuNode => ({
      kind: "action",
      label: `${name}  ${BUILTIN_TABLES[name]!.title} · built-in`,
      command: `wt ${name}`,
    })),
    ...Object.entries(UZU_WAVETABLES).map(([set, names]): MenuNode => ({
      kind: "menu",
      id: `wt-${set}`,
      label: set,
      detail: `${names.length} tables · ${WAVETABLE_PACK}`,
      build: () =>
        names.map((name, index): MenuNode => ({
          kind: "action",
          label: `${set}:${index}  ${name}`,
          command: `wt ${set}:${index}`,
        })),
    })),
  ];
  const nodes: MenuNode[] = [
    {
      kind: "menu",
      id: "wavetables",
      label: "table",
      detail: describeTable(settings.table.src),
      build: () => tables,
    },
  ];
  for (const name of Object.keys(WAVETABLE_PARAMS) as WavetableParam[]) {
    const [min, max, fallback] = WAVETABLE_PARAMS[name];
    nodes.push({
      kind: "number",
      label: WAVETABLE_LABELS[name],
      value: settings[name] ?? fallback,
      min,
      max,
      step: linear(WAVETABLE_STEP[name], min, max),
      format: num,
      command: (value) => `${name} ${num(value)}`,
      reset: `${name} ${num(fallback)}`,
    });
  }
  nodes.push({
    kind: "choice",
    label: "warp mode",
    value: settings.warpmode ?? "none",
    options: WARP_MODES,
    command: (option) => `warpmode ${option}`,
  });
  if ((track.wtAutomation?.length ?? 0) > 0)
    nodes.push({
      kind: "info",
      label: "position automation",
      value: `${track.wtAutomation!.length} points · Automation › wavetable position`,
    });
  return nodes;
}

/** Effects in chain order; each opens on its presets and simple params. */
function effectNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  const node = (effect: EffectName): MenuNode => {
    const spec = effectSpec(effect);
    const values = effectValues(track, effect);
    return {
      kind: "menu",
      id: effect,
      label: spec.label[0]!.toUpperCase() + spec.label.slice(1),
      detail: values ? effectSummary(effect, values) : "off",
      help: spec.doc,
      build: (inner) => effectParamNodes(inner, effect, false),
    };
  };
  const more = EFFECT_NAMES.filter((effect) => !CORE_EFFECTS.includes(effect));
  const moreOn = more.filter((effect) => effectValues(track, effect));
  return [
    ...CORE_EFFECTS.map(node),
    {
      kind: "menu",
      id: "more effects",
      label: "more effects",
      help: "less common effects, each with the same controls",
      detail:
        moreOn.length > 0
          ? `on: ${moreOn.map((effect) => effectSpec(effect).label).join(", ")}`
          : more.map((effect) => effectSpec(effect).label).join(", "),
      build: () => more.map(node),
    },
  ];
}

function effectSummary(
  effect: EffectName,
  values: Readonly<Record<string, number | string | boolean>>,
): string {
  const spec = effectSpec(effect);
  return spec.simple
    .filter((key) => values[key] !== undefined)
    .map((key) => {
      const value = values[key]!;
      const param = spec.params[key]!;
      return `${key} ${typeof value === "number" ? formatParam(param, value) : String(value)}`;
    })
    .join(" · ");
}

/** `800 Hz`, `0.2 s`: a value with its unit, when it has one. */
function withUnit(text: string, unit: string | undefined): string {
  return unit ? `${text} ${unit}` : text;
}

function formatParam(spec: ParamSpec, value: number): string {
  if (spec.kind !== "number") return num(value);
  return spec.step === "log" && value >= 100
    ? `${Math.round(value)}`
    : num(value);
}

/**
 * One effect's rows: on/off, presets, then its simple parameters; the
 * `advanced` submenu holds every parameter with its Strudel names.
 */
function effectParamNodes(
  context: MenuContext,
  effect: EffectName,
  advanced: boolean,
): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  const spec = effectSpec(effect);
  const values = effectValues(track, effect);
  const nodes: MenuNode[] = [];
  if (!advanced) {
    nodes.push({
      kind: "toggle",
      label: "on",
      value: values !== undefined,
      command: (on) => `fx ${effect} ${on ? "on" : "off"}`,
      help: `switch the ${spec.label} on or off (settings are kept)`,
    });
    const presets = effectPresetNames(effect);
    if (presets.length > 0)
      nodes.push({
        kind: "choice",
        label: "preset",
        value: "—",
        options: presets,
        command: (preset) => `fx ${effect} preset ${preset}`,
        help: "a starting point; every value stays editable",
      });
    if (effect === "reverb") {
      // Convolution (Strudel `ir`): a generated impulse, or `fx ir <file>`.
      const ir = track.reverb?.ir?.src;
      const current = ir?.startsWith("builtin:")
        ? ir.slice("builtin:".length)
        : (ir ?? "off");
      nodes.push({
        kind: "choice",
        label: "impulse (ir)",
        value: current,
        options: ["off", ...REVERB_IR_BUILTINS],
        command: (choice) => `fx reverb ir ${choice}`,
      });
    }
  }
  const keys = advanced ? Object.keys(spec.params) : spec.simple;
  for (const key of keys) {
    const param = spec.params[key]!;
    const current = values?.[key];
    const label =
      advanced && param.strudel?.length
        ? `${key} (${param.strudel.filter((name) => !name.includes(" ")).join("/")})`
        : key;
    if (param.kind === "number") {
      nodes.push({
        kind: "number",
        label,
        value: typeof current === "number" ? current : undefined,
        start: param.default,
        off: values
          ? withUnit(formatParam(param, param.default), param.unit)
          : "off",
        min: param.min,
        max: param.max,
        step: specStep(param),
        format: (value) => withUnit(formatParam(param, value), param.unit),
        command: (value) => `fx ${effect} ${key} ${formatParam(param, value)}`,
        help: param.doc,
        ...(values
          ? {
              reset: `fx ${effect} ${key} ${formatParam(param, param.default)}`,
            }
          : {}),
      });
    } else if (param.kind === "enum") {
      nodes.push({
        kind: "choice",
        label,
        value: typeof current === "string" ? current : param.default,
        options: param.values,
        command: (option) => `fx ${effect} ${key} ${option}`,
        help: param.doc,
      });
    } else {
      nodes.push({
        kind: "toggle",
        label,
        value: typeof current === "boolean" ? current : param.default,
        command: (on) => `fx ${effect} ${key} ${on ? "on" : "off"}`,
        help: param.doc,
      });
    }
  }
  if (!advanced) {
    nodes.push({
      kind: "menu",
      id: `${effect}:advanced`,
      label: "advanced",
      detail: `all ${Object.keys(spec.params).length} params`,
      help: `Strudel: ${spec.strudel}`,
      build: (inner) => effectParamNodes(inner, effect, true),
    });
    if (values)
      nodes.push({
        kind: "action",
        label: "reset to defaults",
        command: `fx ${effect} reset`,
        help: `put every ${spec.label} value back to its default`,
      });
  }
  return nodes;
}

function automationNodes(context: MenuContext): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  // Track lanes, the lanes of effects that are on, and any lane with
  // points; every other effect lane is under "all lanes".
  const shown = AUTOMATION_PARAMETERS.filter((lane) => {
    if (isTrackAutomationParameter(lane)) return true;
    if (automationPoints(track, lane).length > 0) return true;
    const info = FX_LANE_INFO.get(lane as FxLane);
    if (info?.effect === "synth")
      return track.synth?.[info.param] !== undefined;
    return info !== undefined && effectValues(track, info.effect) !== undefined;
  });
  const hidden = AUTOMATION_PARAMETERS.filter((lane) => !shown.includes(lane));
  const nodes = shown.map((lane) => laneMenu(track, lane));
  if (hidden.length > 0)
    nodes.push({
      kind: "menu",
      id: "lanes:all",
      label: "all lanes",
      detail: `${hidden.length} more effect lanes`,
      build: (inner) => {
        const current = focused(inner);
        return current ? hidden.map((lane) => laneMenu(current, lane)) : [];
      },
    });
  return nodes;
}

function laneMenu(track: Track, lane: AutomationParameter): MenuNode {
  const count = automationPoints(track, lane).length;
  return {
    kind: "menu",
    id: `lane:${lane}`,
    label: laneLabel(lane),
    detail: `${count} point${count === 1 ? "" : "s"}`,
    build: (inner) => laneNodes(inner, lane),
  };
}

/** `4:0.5 8:1` → `automate <lane> points 4:0.5 8:1`, when every pair parses. */
function pointsCommand(
  lane: AutomationParameter,
  text: string,
  exactly?: number,
): string | undefined {
  const pairs = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (pairs.length === 0 || (exactly !== undefined && pairs.length !== exactly))
    return undefined;
  const { min, max } = automationRange(lane);
  for (const pair of pairs) {
    const match = pair.match(/^(\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/);
    if (!match) return undefined;
    const value = Number(match[2]);
    if (value < min || value > max) return undefined;
  }
  return `automate ${lane} points ${pairs.join(" ")}`;
}

function laneNodes(
  context: MenuContext,
  lane: AutomationParameter,
): MenuNode[] {
  const track = focused(context);
  if (!track) return [];
  const { min, max } = automationRange(lane);
  const range = `${laneFormat(lane, min)}…${laneFormat(lane, max)}`;
  const points = automationPoints(track, lane);
  const nodes: MenuNode[] = [
    {
      kind: "entry",
      label: "add points",
      value: range,
      placeholder: "beat:value [beat:value …]",
      command: (text) => pointsCommand(lane, text),
      example: `automate ${lane} points 0:${laneFormat(lane, min)} 4:${laneFormat(lane, max)}`,
    },
    {
      kind: "entry",
      label: "ramp",
      value: "two points",
      placeholder: "from-beat:value to-beat:value",
      command: (text) => pointsCommand(lane, text, 2),
      example: `automate ${lane} points 0:${laneFormat(lane, min)} ${context.score.beatsPerBar * context.score.bars}:${laneFormat(lane, max)}`,
    },
  ];
  for (const point of points)
    nodes.push({
      kind: "point",
      label: `beat ${num(point.tick / context.score.ticksPerBeat)}`,
      lane,
      beat: point.tick / context.score.ticksPerBeat,
      value: point.value,
    });
  if (points.length > 0)
    nodes.push({
      kind: "action",
      label: "clear lane",
      command: `clear ${lane} automation`,
    });
  return nodes;
}

function mixNodes(context: MenuContext): MenuNode[] {
  return context.score.tracks.map((track): MenuNode => {
    const detail = `vol ${num(track.volume)} · pan ${num(track.pan)}${track.muted ? " · M" : ""}${track.solo ? " · S" : ""}`;
    // Commands act on the focused track, so another track is focused first.
    return track.id === context.trackId
      ? {
          kind: "menu",
          id: `mix:${track.id}`,
          label: `${track.name} ●`,
          detail,
          build: trackNodes,
        }
      : {
          kind: "action",
          label: `${track.name}  ${detail}`,
          command: `/track ${track.id}`,
        };
  });
}

// ── sounds (sample packs) ──────────────────────────────────────────────

function soundsDetail(track: Track | undefined): string {
  const packs = new Set<string>();
  for (const ref of Object.values(track?.sampler?.voices ?? {}))
    if (ref.src.startsWith("pack:")) packs.add(ref.src.slice(5).split("/")[0]!);
  return packs.size ? [...packs].join(" · ") : "kits, instruments, packs";
}

/**
 * The instrument browser: drum kits and soundfont instruments from the
 * built-in packs (fetched on first use), and the pack list.
 */
function kitsMenu(): MenuNode {
  return {
    kind: "menu",
    id: "kits",
    label: "drum kits",
    help: "make this a drum track with a synth or sample kit",
    detail: `synth ${SYNTH_KIT_NAMES.join(" ")} · samples ${Object.keys(DEFAULT_KITS).join(" ")}`,
    // Synth kits first (offline), then the pack sample kits.
    build: () => [
      ...kitCatalog().map((entry): MenuNode => ({
        kind: "action",
        label:
          entry.kind === "synth"
            ? `${entry.label} · ${entry.detail}`
            : `${entry.label} · ${DEFAULT_KITS[entry.name]?.pack ?? entry.detail}`,
        command: entry.command,
      })),
      {
        kind: "menu",
        id: "kit-nicknames",
        label: "Strudel banks",
        detail: `${Object.keys(STRUDEL_BANK_ALIASES).length} drum machines by nickname`,
        build: () =>
          Object.entries(STRUDEL_BANK_ALIASES)
            .sort(([, a], [, b]) =>
              a.toLowerCase() < b.toLowerCase() ? -1 : 1,
            )
            .map(([bank, nickname]): MenuNode => ({
              kind: "action",
              label: `${nickname}  ${bank}`,
              command: `/kit ${nickname}`,
            })),
      },
    ],
  };
}

function patternsMenu(): MenuNode {
  return {
    kind: "menu",
    id: "patterns",
    label: "drum patterns",
    detail: `${DRUM_PATTERNS.length} grooves`,
    help: "replace the drum part with a ready-made groove",
    build: () =>
      DRUM_PATTERNS.map((entry): MenuNode => ({
        kind: "action",
        label: `${entry.label}  ${entry.tempo.bpm} BPM · ${entry.tags.join(", ")}`,
        command: `/pattern ${entry.name}`,
      })),
  };
}

function soundNodes(): MenuNode[] {
  return [
    {
      kind: "action",
      label: "wavetable synth  basic shapes morph · built-in",
      command: "wt basic",
      help: "switch this track to the morphing wavetable synth",
    },
    {
      kind: "menu",
      id: "instruments",
      label: "instruments",
      help: "sampled piano and General MIDI instruments",
      detail: "General MIDI soundfont, piano",
      build: () => [
        {
          kind: "action",
          label: "piano  Salamander grand · piano",
          command: "/pack use piano/piano",
        },
        ...GM_INSTRUMENTS.map((name): MenuNode => ({
          kind: "action",
          label: `${name.replace(/^gm_/, "").replace(/_/g, " ")} · gm`,
          command: `/pack use gm/${name}`,
        })),
      ],
    },
    {
      kind: "entry",
      label: "use a sound",
      value: "",
      help: "type a pack sound name, e.g. dirt-samples/bd:3",
      placeholder: "<pack>/<sound>[:<n>]",
      command: (text) => (text.trim() ? `/pack use ${text.trim()}` : undefined),
      example: "/pack use dirt-samples/bd:3",
    },
    {
      kind: "menu",
      id: "packs",
      label: "sample packs",
      help: "browse built-in packs or add one by URL",
      detail: `${PACK_CATALOG.length} built in`,
      build: () => [
        ...PACK_CATALOG.map((pack): MenuNode => ({
          kind: "action",
          label: `${pack.name}  ${pack.license}`,
          command: `/pack info ${pack.name}`,
        })),
        {
          kind: "entry",
          label: "add a pack",
          value: "",
          placeholder: "manifest URL or github:user/repo",
          command: (text) =>
            text.trim() ? `/pack add ${text.trim()}` : undefined,
          example: "/pack add github:yaxu/clean-breaks",
        },
      ],
    },
  ];
}

function transportNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  return [
    {
      kind: "action",
      label: context.playing ? "pause" : "play",
      command: context.playing ? "pause" : "play",
      help: "start or stop the loop (space on an empty prompt)",
    },
    {
      kind: "number",
      label: "tempo",
      help: "beats per minute",
      value: score.tempoBpm,
      min: SCORE_LIMITS.minTempoBpm,
      max: SCORE_LIMITS.maxTempoBpm,
      step: linear(1, SCORE_LIMITS.minTempoBpm, SCORE_LIMITS.maxTempoBpm),
      format: (value) => `${num(value)} BPM`,
      command: (value) => `tempo ${num(value)}`,
    },
    {
      kind: "number",
      label: "beats per bar",
      help: "the meter",
      value: score.beatsPerBar,
      min: 1,
      max: SCORE_LIMITS.maxBeatsPerBar,
      step: linear(1, 1, SCORE_LIMITS.maxBeatsPerBar),
      format: (value) => `${value}/4`,
      command: (value) => `meter ${Math.round(value)}`,
    },
    {
      kind: "number",
      label: "loop length",
      help: "how long the loop is",
      value: score.bars,
      min: 1,
      max: SCORE_LIMITS.maxBars,
      step: linear(1, 1, SCORE_LIMITS.maxBars),
      format: (value) => `${num(value)} bar${value === 1 ? "" : "s"}`,
      command: (value) => `bars ${Math.round(value)}`,
    },
    {
      kind: "choice",
      label: "grid",
      help: "the step play-mode recording and the euclid editor snap to",
      value: context.grid,
      options: context.grids,
      command: (option) => `/grid ${option}`,
    },
    {
      kind: "toggle",
      label: "click",
      help: "metronome while playing and recording",
      value: context.clickOn,
      command: (on) => `/click ${on ? "on" : "off"}`,
    },
    {
      kind: "choice",
      label: "count-in bars",
      help: "bars of click before recording starts",
      value: String(context.countInBars),
      options: ["0", "1", "2"],
      command: (option) => `/count-in ${option}`,
    },
  ];
}

// ── controller ────────────────────────────────────────────────────────

type Frame = {
  title: string;
  build: (context: MenuContext) => MenuNode[];
  index: number;
  query: string;
};

const KEY_UP = new Set(["\u001b[A", "\u001bOA", "k"]);
const KEY_DOWN = new Set(["\u001b[B", "\u001bOB", "j"]);
const KEY_LEFT = new Set(["\u001b[D", "\u001bOD", "h", "-", "_"]);
const KEY_RIGHT = new Set(["\u001b[C", "\u001bOC", "l", "+", "="]);
const KEY_ENTER = new Set(["\r", "\n"]);
const KEY_BACKSPACE = new Set(["\u007f", "\b"]);
const KEY_DELETE = new Set(["\u001b[3~", "x"]);
const LABEL_WIDTH = 16;

/**
 * A submenu frame whose rows are rebuilt from the parent's fresh build, so
 * values (and the commands closed over them) always follow the score.
 */
function childFrame(
  parent: Frame,
  node: Extract<MenuNode, { kind: "menu" }>,
): Frame {
  return {
    title: node.label,
    index: 0,
    query: "",
    build: (context) => {
      const fresh = parent
        .build(context)
        .find(
          (candidate): candidate is Extract<MenuNode, { kind: "menu" }> =>
            candidate.kind === "menu" && candidate.id === node.id,
        );
      return (fresh ?? node).build(context);
    },
  };
}

export class EditMenu {
  private stack: Frame[] = [];
  private filtering = false;
  /** Typed value for the selected row (`entry` holds the row's label). */
  private entry: { label: string; buffer: string } | undefined;

  get open(): boolean {
    return this.stack.length > 0;
  }

  /** True while the menu takes typed text (a filter or a value). */
  get typing(): boolean {
    return this.filtering || this.entry !== undefined;
  }

  /** Open at the root, or at a section id (`effects`, `automation`). */
  show(context: MenuContext, section?: string): void {
    this.stack = [{ title: "menu", build: rootNodes, index: 0, query: "" }];
    this.filtering = false;
    this.entry = undefined;
    // Walk the section path (`automation` is Mix & automation › automation).
    for (const id of section
      ? (SECTION_ALIASES[section.toLowerCase()] ?? [])
      : []) {
      const frame = this.stack.at(-1)!;
      const nodes = frame.build(context);
      const index = nodes.findIndex(
        (node) => node.kind === "menu" && node.id === id,
      );
      const node = nodes[index];
      if (node?.kind !== "menu") break;
      frame.index = index;
      this.stack.push(childFrame(frame, node));
    }
  }

  close(): void {
    this.stack = [];
    this.filtering = false;
    this.entry = undefined;
  }

  /** The visible rows of the current level (filtered). */
  nodes(context: MenuContext): MenuNode[] {
    const frame = this.stack.at(-1);
    if (!frame) return [];
    const all = frame.build(context);
    const needle = frame.query.toLowerCase();
    return needle
      ? all.filter((node) => nodeText(node).toLowerCase().includes(needle))
      : all;
  }

  private selected(context: MenuContext): MenuNode | undefined {
    const frame = this.stack.at(-1);
    const nodes = this.nodes(context);
    if (!frame || nodes.length === 0) return undefined;
    frame.index = clamp(frame.index, 0, nodes.length - 1);
    return nodes[frame.index];
  }

  key(value: string, context: MenuContext): MenuResult {
    const frame = this.stack.at(-1);
    if (!frame) return { type: "pass" };
    if (value === "\u0003" || value === "\u000c") return { type: "pass" };
    if (this.entry) return this.entryKey(value, context);
    if (this.filtering) {
      if (value === "\u001b") {
        frame.query = "";
        this.filtering = false;
        return { type: "handled" };
      }
      if (KEY_BACKSPACE.has(value)) {
        frame.query = frame.query.slice(0, -1);
        if (!frame.query) this.filtering = false;
        frame.index = 0;
        return { type: "handled" };
      }
      if (
        KEY_ENTER.has(value) ||
        value === "\u001b[B" ||
        value === "\u001b[A"
      ) {
        this.filtering = false;
        return this.key(value, context);
      }
      if (value.length === 1 && value >= " ") {
        frame.query = (frame.query + value).slice(0, 40);
        frame.index = 0;
        return { type: "handled" };
      }
      return { type: "handled" };
    }
    const nodes = this.nodes(context);
    const node = this.selected(context);
    if (value === "\u001b") {
      if (frame.query) {
        frame.query = "";
        return { type: "handled" };
      }
      // Esc reverts staged edits first, then goes back as usual.
      if (context.audition?.dirty) return { type: "revert" };
      this.stack.pop();
      return this.stack.length ? { type: "handled" } : { type: "close" };
    }
    if (value === "/") {
      this.filtering = true;
      frame.query = "";
      return { type: "handled" };
    }
    if (KEY_UP.has(value) || KEY_DOWN.has(value)) {
      const step = KEY_UP.has(value) ? -1 : 1;
      if (nodes.length)
        frame.index = (frame.index + step + nodes.length) % nodes.length;
      return { type: "handled" };
    }
    if (value === "\u001b[5~" || value === "\u001b[H") {
      frame.index = 0;
      return { type: "handled" };
    }
    if (value === "\u001b[6~" || value === "\u001b[F") {
      frame.index = Math.max(0, nodes.length - 1);
      return { type: "handled" };
    }
    // Space hears the focused track (it still switches a toggle row);
    // `a` and `c` are A/B and context while the window hosts an audition.
    const audition = context.audition ? auditionKey(value) : undefined;
    if (audition && !(audition === "loop" && node?.kind === "toggle"))
      return { type: "audition", key: audition };
    if (!node) return { type: "handled" };
    if (
      KEY_ENTER.has(value) &&
      context.audition?.dirty &&
      (node.kind === "number" ||
        node.kind === "toggle" ||
        node.kind === "point" ||
        node.kind === "info")
    )
      return { type: "keep" };
    if (KEY_LEFT.has(value) || KEY_RIGHT.has(value)) {
      const direction = KEY_RIGHT.has(value) ? 1 : -1;
      return this.nudge(node, direction);
    }
    if (KEY_DELETE.has(value) && node.kind === "number") {
      const reset =
        node.reset ??
        (node.start !== undefined && node.value !== undefined
          ? node.command(node.start)
          : undefined);
      return reset ? { type: "run", command: reset } : { type: "handled" };
    }
    if (KEY_DELETE.has(value) && node.kind === "point")
      return {
        type: "run",
        command: `automate ${node.lane} remove ${num(node.beat)}`,
      };
    if (
      /^[0-9.]$/.test(value) &&
      (node.kind === "number" || node.kind === "point")
    ) {
      this.entry = { label: node.label, buffer: value };
      return { type: "handled" };
    }
    if (KEY_ENTER.has(value) || value === " ") {
      if (node.kind === "menu") {
        // Going back lands on the opened row with the filter cleared.
        if (frame.query) {
          frame.query = "";
          frame.index = Math.max(
            0,
            this.nodes(context).findIndex(
              (candidate) =>
                candidate.kind === "menu" && candidate.id === node.id,
            ),
          );
        }
        this.stack.push(childFrame(frame, node));
        return { type: "handled" };
      }
      if (node.kind === "toggle")
        return { type: "run", command: node.command(!node.value) };
      if (node.kind === "action") return { type: "run", command: node.command };
      if (node.kind === "choice") {
        const current = node.options.indexOf(node.value);
        this.stack.push({
          title: node.label,
          index: Math.max(0, current),
          query: "",
          build: (fresh) => {
            const parent = this.stack.at(-2);
            const live =
              parent
                ?.build(fresh)
                .find(
                  (candidate): candidate is typeof node =>
                    candidate.kind === "choice" &&
                    candidate.label === node.label,
                ) ?? node;
            return live.options.map((option) => ({
              kind: "action",
              label: option === live.value ? `${option}  ✓` : option,
              command: live.command(option),
            }));
          },
        });
        return { type: "handled" };
      }
      if (
        node.kind === "entry" ||
        node.kind === "number" ||
        node.kind === "point"
      ) {
        this.entry = { label: node.label, buffer: "" };
        return { type: "handled" };
      }
    }
    return { type: "handled" };
  }

  private nudge(node: MenuNode, direction: 1 | -1): MenuResult {
    if (node.kind === "menu") {
      if (direction > 0) {
        this.stack.push(childFrame(this.stack.at(-1)!, node));
        return { type: "handled" };
      }
      if (this.stack.length > 1) this.stack.pop();
      return { type: "handled" };
    }
    if (node.kind === "number") {
      const next =
        node.value === undefined
          ? (node.start ?? node.min)
          : clamp(node.step(node.value, direction), node.min, node.max);
      if (node.value !== undefined && Math.abs(next - node.value) < 1e-9)
        return { type: "handled" };
      return { type: "run", command: node.command(next) };
    }
    if (node.kind === "point") {
      const { min, max } = automationRange(node.lane);
      const next = clamp(laneStep(node.lane)(node.value, direction), min, max);
      if (Math.abs(next - node.value) < 1e-9) return { type: "handled" };
      return {
        type: "run",
        command: `automate ${node.lane} points ${num(node.beat)}:${laneFormat(node.lane, next)}`,
      };
    }
    if (node.kind === "toggle") {
      const want = direction > 0;
      return want === node.value
        ? { type: "handled" }
        : { type: "run", command: node.command(want) };
    }
    if (node.kind === "choice") {
      const at = node.options.indexOf(node.value);
      const next =
        node.options[clamp(at + direction, 0, node.options.length - 1)];
      return next === undefined || next === node.value
        ? { type: "handled" }
        : { type: "run", command: node.command(next) };
    }
    if (direction < 0 && this.stack.length > 1) this.stack.pop();
    return { type: "handled" };
  }

  private entryKey(value: string, context: MenuContext): MenuResult {
    const entry = this.entry!;
    if (value === "\u001b") {
      this.entry = undefined;
      return { type: "handled" };
    }
    if (KEY_BACKSPACE.has(value)) {
      entry.buffer = entry.buffer.slice(0, -1);
      return { type: "handled" };
    }
    if (KEY_ENTER.has(value)) {
      const node = this.selected(context);
      this.entry = undefined;
      const command = node ? entryCommand(node, entry.buffer) : undefined;
      if (!command) return { type: "handled" };
      // A committed value clears the filter so its result (a new automation
      // point, a renamed row) is in view, keeping the cursor on the row.
      const frame = this.stack.at(-1)!;
      if (frame.query && node) {
        frame.query = "";
        const index = this.nodes(context).findIndex(
          (candidate) => candidate.label === node.label,
        );
        frame.index = Math.max(0, index);
      }
      return { type: "run", command };
    }
    if (value.length >= 1 && !value.startsWith("\u001b") && value >= " ") {
      entry.buffer = (entry.buffer + value).slice(0, 200);
    }
    return { type: "handled" };
  }

  /** The picker the TUI draws for the current level. */
  view(context: MenuContext): MenuView {
    const frame = this.stack.at(-1);
    const nodes = this.nodes(context);
    const index = frame
      ? clamp(frame.index, 0, Math.max(0, nodes.length - 1))
      : 0;
    const crumbs = this.stack.map((level) => level.title).join(" › ");
    const selected = nodes[index];
    let title = crumbs;
    if (frame?.query || this.filtering) title += ` · /${frame?.query ?? ""}`;
    if (this.entry)
      title += ` · ${this.entry.label}: ${this.entry.buffer || placeholderFor(selected)}▏`;
    const audition = context.audition;
    if (audition?.dirty) title = `● ${title}`;
    if (audition?.status && !this.entry) title += ` · ${audition.status}`;
    // Changed rows show `staged ← committed` (Elektron's compare, inline).
    const before = new Map<string, string>();
    if (audition?.dirty && frame && !frame.query)
      for (const node of frame.build({
        ...context,
        score: audition.committed,
      }))
        before.set(node.label, valueText(node));
    const items = nodes.map((node, at) => {
      const now = valueText(node);
      const was = node.kind === "menu" ? undefined : before.get(node.label);
      const shown = was !== undefined && was !== now ? `${now} ← ${was}` : now;
      return {
        label: `${node.label.padEnd(LABEL_WIDTH)} ${shown}`.trimEnd(),
        value: String(at),
      };
    });
    const command = selected ? commandText(selected) : undefined;
    const note = [
      selected ? describe(selected) : "",
      command ? `› ${command}` : "",
    ]
      .filter(Boolean)
      .join("  ");
    const hint = this.entry
      ? HINTS.typing
      : this.filtering
        ? HINTS.filtering
        : audition && (audition.looping || audition.dirty)
          ? audition.hint
          : selected?.kind === "point"
            ? HINTS.point
            : selected?.kind === "number" ||
                selected?.kind === "toggle" ||
                selected?.kind === "choice"
              ? HINTS.value
              : selected?.kind === "action"
                ? HINTS.action
                : HINTS.menu;
    return { title, items, index, hint, note };
  }
}

/** The focused row's one-line description. */
function describe(node: MenuNode): string {
  if (node.help) return node.help;
  switch (node.kind) {
    case "number":
      return node.reset || node.start !== undefined
        ? "←→ adjust · type a number · x resets"
        : "←→ adjust · type a number";
    case "toggle":
      return "space or enter switches it";
    case "choice":
      return `${node.options.length} choices · enter lists them`;
    case "point":
      return "←→ change · type beat:value · x deletes";
    case "entry":
      return "enter, then type";
    default:
      return "";
  }
}

function placeholderFor(node: MenuNode | undefined): string {
  if (!node) return "";
  if (node.kind === "entry") return node.placeholder;
  if (node.kind === "number")
    return `${node.format(node.min)}…${node.format(node.max)}`;
  if (node.kind === "point") return "value";
  return "";
}

function entryCommand(node: MenuNode, text: string): string | undefined {
  const trimmed = text.trim();
  if (node.kind === "entry") return node.command(trimmed);
  if (node.kind === "number") {
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
    const value = Number(trimmed);
    if (value < node.min || value > node.max) return undefined;
    return node.command(value);
  }
  if (node.kind === "point") {
    // `0.8` sets the value; `6:0.8` moves to beat 6.
    const { min, max } = automationRange(node.lane);
    const match = trimmed.match(/^(?:(\d+(?:\.\d+)?):)?(-?\d+(?:\.\d+)?)$/);
    if (!match) return undefined;
    const value = Number(match[2]);
    if (value < min || value > max) return undefined;
    if (match[1] !== undefined && Number(match[1]) !== node.beat)
      return `automate ${node.lane} points ${match[1]}:${match[2]}`;
    return `automate ${node.lane} points ${num(node.beat)}:${match[2]}`;
  }
  return undefined;
}

function valueText(node: MenuNode): string {
  switch (node.kind) {
    case "menu":
      return node.detail;
    case "number":
      return node.value === undefined
        ? (node.off ?? "—")
        : node.format(node.value);
    case "toggle":
      return node.value ? "on" : "off";
    case "choice":
      return node.value;
    case "entry":
      return node.value;
    case "point":
      return laneFormat(node.lane, node.value);
    case "info":
      return node.value;
    case "action":
      return "";
  }
}

/** The command a row stands for, shown so the menu teaches commands. */
function commandText(node: MenuNode): string | undefined {
  switch (node.kind) {
    case "number":
      return node.command(node.value ?? node.start ?? node.min);
    case "toggle":
      return node.command(!node.value);
    case "choice":
      return node.command(node.value);
    case "entry":
      return node.example;
    case "action":
      return node.command;
    case "point":
      return `automate ${node.lane} points ${num(node.beat)}:${laneFormat(node.lane, node.value)}`;
    default:
      return undefined;
  }
}

function nodeText(node: MenuNode): string {
  return `${node.label} ${valueText(node)} ${commandText(node) ?? ""}`;
}

/** Root sections, for `/menu <section>`. */
export const MENU_SECTIONS = [
  "sound",
  "effects",
  "rhythm",
  "chords",
  "mix",
  "project",
  // Older names, still accepted.
  "parameters",
  "sounds",
  "track",
  "automation",
  "transport",
] as const;
