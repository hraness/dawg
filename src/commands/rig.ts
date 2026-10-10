/**
 * The guitar rig prompt commands (0.6):
 *
 *   rig                          show the focused track's rig
 *   rig <preset>                 load a whole rig (RIG_PRESETS): clean crunch
 *                                punk ragged lead metal fuzz octave funk wah
 *                                bachata spring bassdrive reese jangle alt
 *   rig reset | rig off          remove the stomp, head and cab
 *   stomp|head|cab <type>        pick a pedal, amp or cabinet (`head crunch`)
 *   stomp|head|cab <param> <v>…  set parameters (`head gain 7 gate -55`)
 *   stomp|head|cab on|off|reset  as `fx <stage> …`
 *
 * Stage commands are `fx stomp|head|cab …` without the `fx`. `fx amp` (and
 * `amp`) answer with a hint: `amp` stays Strudel's linear gain, the guitar
 * amplifier is `head`. One command is one `updateTrack` revision.
 */
import {
  FX_PRESETS,
  FxValidationError,
  RIG_PRESETS,
  RIG_STAGES,
  applyRigPreset,
  effectSpec,
  isRigReverb,
  rigPresetOf,
  rigReverb,
  type FxValues,
  type RigStage,
  type TrackFx,
  SHOEGAZE_EFFECTS,
} from "../../core/fx.ts";
import {
  instrumentForWord,
  resolveInstrumentWord,
} from "../../core/instruments.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackPatch,
  type TrackScore,
} from "../../core/score.ts";
import {
  applyFxCommand,
  parseFxCommand,
  type FxCommand,
  type FxResult,
} from "./fx.ts";
import { nearest } from "./nearest.ts";

export type RigCommand =
  | { type: "rig-show" }
  | { type: "rig-preset"; preset: string }
  | { type: "rig-reset" }
  | { type: "rig-stage"; stage: RigStage; fx: FxCommand }
  /** A typed word that is close to a rig command: answer with a hint. */
  | { type: "rig-hint"; message: string };

export const RIG_PRESET_NAMES: readonly string[] = Object.freeze(
  Object.keys(RIG_PRESETS),
);

const AMP_HINT =
  "did you mean head (guitar amp)? · `head crunch`, `rig crunch` · amp stays Strudel linear gain (`fx gain`)";

function isStage(word: string): word is RigStage {
  return (RIG_STAGES as readonly string[]).includes(word);
}

/** `unknown rig crunh · did you mean crunch? · rigs clean crunch …` */
function unknownRigMessage(name: string): string {
  const match = nearest(name, RIG_PRESET_NAMES);
  const near = match ? ` · did you mean ${match}?` : "";
  return `unknown rig ${name}${near} · rigs ${RIG_PRESET_NAMES.join(" ")} reset`;
}

export function parseRigCommand(prompt: string): RigCommand | undefined {
  if (prompt.length > 1_024) return undefined;
  const words = prompt.trim().replace(/^\//, "").toLowerCase().split(/\s+/);
  const head = words[0];
  if (head === "amp" || (head === "fx" && words[1] === "amp"))
    return { type: "rig-hint", message: AMP_HINT };
  if (head === "rig") {
    if (words.length === 1) return { type: "rig-show" };
    const name = words.slice(1).join(" ");
    if (name === "reset" || name === "off" || name === "none")
      return { type: "rig-reset" };
    if (Object.prototype.hasOwnProperty.call(RIG_PRESETS, name))
      return { type: "rig-preset", preset: name };
    return { type: "rig-hint", message: unknownRigMessage(name) };
  }
  if (!head || !isStage(head)) return undefined;
  const stage = head;
  const rest = words.slice(1);
  if (rest.length === 0)
    return { type: "rig-stage", stage, fx: { type: "fx-on", effect: stage } };
  // `stomp fuzz`, `head crunch`, `cab 4x12`: the stage's type.
  const types = effectSpec(stage).params.type;
  if (
    rest.length === 1 &&
    types?.kind === "enum" &&
    (types.values as readonly string[]).includes(rest[0]!)
  )
    return {
      type: "rig-stage",
      stage,
      fx: { type: "fx-set", effect: stage, values: { type: rest[0]! } },
    };
  // `stomp muff`: a stage preset.
  if (
    rest.length === 1 &&
    Object.prototype.hasOwnProperty.call(FX_PRESETS[stage] ?? {}, rest[0]!)
  )
    return {
      type: "rig-stage",
      stage,
      fx: { type: "fx-preset", effect: stage, preset: rest[0]! },
    };
  const fx = parseFxCommand(`fx ${stage} ${rest.join(" ")}`);
  return fx ? { type: "rig-stage", stage, fx } : undefined;
}

function describeRig(values: Readonly<Record<string, FxValues | undefined>>) {
  const stages = RIG_STAGES.filter((stage) => values[stage])
    .map((stage) => {
      const v = values[stage]!;
      const type = String(v.type);
      const gain = v.gain === undefined ? "" : ` ${String(v.gain)}`;
      return `${stage} ${type}${gain}`;
    })
    .join(" → ");
  // 0.6.1 shoegaze stages follow the cab in the chain.
  const gaze = SHOEGAZE_EFFECTS.filter((effect) => values[effect]);
  return gaze.length ? `${stages} + ${gaze.join(" ")}` : stages;
}

export function applyRigCommand(
  score: TrackScore,
  trackId: string,
  command: RigCommand,
): FxResult {
  if (command.type === "rig-hint")
    return { ok: false, message: command.message };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "rig-stage")
    return applyFxCommand(score, trackId, command.fx);
  if (command.type === "rig-show") {
    const fx = track.fx ?? {};
    if (!RIG_STAGES.some((stage) => fx[stage]))
      return {
        ok: true,
        message: `rig · none · rigs ${RIG_PRESET_NAMES.join(" ")}`,
      };
    const name = rigPresetOf(track.fx);
    return {
      ok: true,
      message: `rig${name ? ` ${name}` : ""} · ${describeRig(fx)}`,
    };
  }
  const name = command.type === "rig-reset" ? "reset" : command.preset;
  if (name === "reset" && !RIG_STAGES.some((stage) => track.fx?.[stage]))
    return { ok: true, message: "rig · already off" };
  let next: TrackScore;
  try {
    next = updateTrack(score, trackId, rigPatch(track, name));
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `rig · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((candidate) => candidate.id === trackId)?.fx;
  return {
    ok: true,
    message:
      name === "reset"
        ? "rig · off"
        : `rig ${name} · ${describeRig(stored ?? {})}`,
    next,
    kind: "score.effect",
    payload: { trackId, rig: name, fx: stored ?? null },
  };
}

/**
 * Track fields an instrument word sets beyond `instrument`: a rig alias
 * (`jangle`, `punk`, `gtr-metal`…) also loads its rig over `fx`, keeping
 * the track's other effects. Empty for every other word.
 */
export function rigWordPatch(
  word: string,
  fx: TrackFx | undefined,
): Readonly<{ fx?: TrackFx | null; reverb?: TrackPatch["reverb"] }> {
  const rig = resolveInstrumentWord(word)?.fx;
  if (!rig || !Object.prototype.hasOwnProperty.call(RIG_PRESETS, rig))
    return {};
  return rigPatch({ fx }, rig);
}

/**
 * The track patch for rig `name` (or `"reset"`): the stages and companion
 * effects, plus `rig spring`'s short room. A reverb a previous rig set (and
 * nobody changed since) is removed when the new rig has none.
 */
function rigPatch(
  track: Readonly<{ fx?: TrackFx; reverb?: unknown }>,
  name: string,
): Readonly<{ fx: TrackFx | null; reverb?: TrackPatch["reverb"] }> {
  const reverb = name === "reset" ? undefined : rigReverb(name);
  return {
    fx: applyRigPreset(track.fx, name) ?? null,
    ...(reverb
      ? { reverb: reverb as unknown as TrackPatch["reverb"] }
      : isRigReverb(track.reverb)
        ? { reverb: null }
        : {}),
  };
}

/**
 * A new track's fields for instrument word `word`: a guitar alias gets its
 * guitar voice and rig, any other word `{}` (callers pick the instrument).
 */
export function rigTrackFields(word: string): Readonly<{
  instrument?: string;
  string?: { preset: string };
  fx?: TrackFx;
  reverb?: TrackPatch["reverb"];
}> {
  const meaning = resolveInstrumentWord(word);
  if (!meaning?.fx) return {};
  const { fx, reverb } = rigWordPatch(word, undefined);
  return {
    instrument: meaning.instrument,
    ...(meaning.field === "string" && meaning.preset
      ? { string: { preset: meaning.preset } }
      : {}),
    ...(fx ? { fx } : {}),
    ...(reverb ? { reverb } : {}),
  };
}
