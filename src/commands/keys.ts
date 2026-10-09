/**
 * The modelled piano commands (0.6 keys lane, `core/keys.ts`):
 *
 *   piano                         the focused track becomes the modelled grand
 *   piano <preset>                grand ballad upright felt lofi honkytonk prepared
 *   grand | upright | felt …      the same, by the preset word alone
 *   keys                          list this track's piano settings
 *   keys preset <name>            load a preset (instrument, keys and its effects)
 *   keys <param> <value> […]      set parameters (hardness 0.4 decay 1.5 …)
 *   keys <param> off              unset one parameter (back to the preset's)
 *   keys reset                    the family's own sound (`keys: {}`),
 *                                 dropping the preset's unedited effects
 *   epiano | wurli | clav         the electric keys (0.6.1), also rhodes
 *                                 suitcase dyno wurlitzer clavinet funkclav
 *   epiano preset <name>          an electric preset
 *   epiano <param> <value> […]    set electric parameters (vibe 0.6 …);
 *                                 the track becomes that family first
 *
 * Every new write of `piano` stores `instrument: "grand"` with `keys`; a
 * stored legacy `instrument: "piano"` is never rewritten unless asked. Each
 * command is one `updateTrack` revision and one undo step.
 */
import { FxValidationError } from "../../core/params.ts";
import {
  ELECTRIC_FAMILIES,
  KEYS_PARAMS,
  KEYS_PRESETS,
  PIANO_FAMILIES,
  isKeysPreset,
  isKeysFamily,
  keysParamName,
  keysParamsFor,
  keysSimpleFor,
  normalizeKeys,
  pianoWrite,
  type TrackKeys,
} from "../../core/keys.ts";
import {
  createScore,
  ScoreValidationError,
  updateTrack,
  type TrackPatch,
  type TrackScore,
} from "../../core/score.ts";
import { parseParamValue } from "./fx.ts";

export type KeysCommand =
  | { type: "keys-list" }
  /** `family`: `epiano preset` lists only that family's presets. */
  | { type: "keys-presets"; family?: string }
  | { type: "keys-reset" }
  | { type: "keys-preset"; preset: string }
  | {
      type: "keys-set";
      /** `null` unsets a parameter. */
      values: Readonly<Record<string, number | string | null>>;
      /** `epiano vibe 0.6`: the electric family the track becomes first. */
      family?: string;
    };

/** Electric family words that also take `preset` and parameters. */
const FAMILY_HEADS: Readonly<Record<string, string>> = Object.freeze({
  epiano: "epiano",
  rhodes: "epiano",
  wurli: "wurli",
  wurlitzer: "wurli",
  clav: "clav",
  clavinet: "clav",
});

/** The words that start a keys command (registered with /help). */
export const KEYS_COMMAND_WORDS = Object.freeze([
  "keys",
  "piano",
  ...Object.keys(KEYS_PRESETS).filter((name) => name !== "lofi"),
  "rhodes",
  "wurlitzer",
  "clavinet",
]);

export function parseKeysCommand(prompt: string): KeysCommand | undefined {
  if (prompt.length > 1_024) return undefined;
  let words = prompt.trim().toLowerCase().split(/\s+/);
  // `instrument piano` / `sound grand`: the generic instrument command with
  // a keys word is a new write, so it stores the modelled piano.
  if (
    words.length === 2 &&
    ["instrument", "sound", "voice"].includes(words[0]!) &&
    pianoWrite(words[1]!)
  )
    words = [words[1]!];
  const head = words[0] ?? "";
  // `piano`, `piano <preset>`, and a bare preset word (`grand`, `felt`).
  if (head === "piano" || head === "uprightpiano" || head === "feltpiano") {
    if (words.length === 1)
      return { type: "keys-preset", preset: pianoWrite(head)!.preset! };
    return words.length === 2 && isKeysPreset(words[1]!)
      ? { type: "keys-preset", preset: words[1]! }
      : undefined;
  }
  const family = FAMILY_HEADS[head];
  if (family) {
    if (words.length === 1)
      return { type: "keys-preset", preset: pianoWrite(head)!.preset! };
    const parsed = parseKeysCommand(["keys", ...words.slice(1)].join(" "));
    if (!parsed || parsed.type === "keys-list") return undefined;
    if (parsed.type === "keys-preset")
      return KEYS_PRESETS[parsed.preset]!.instrument === family
        ? parsed
        : undefined;
    if (parsed.type === "keys-set") return { ...parsed, family };
    if (parsed.type === "keys-presets") return { ...parsed, family };
    return parsed;
  }
  if (head !== "keys") {
    if (words.length === 1 && isKeysPreset(head) && head !== "lofi")
      return { type: "keys-preset", preset: head };
    if (words.length === 2 && isKeysPreset(head) && words[1] === "piano")
      return { type: "keys-preset", preset: head };
    return undefined;
  }
  if (words.length === 1) return { type: "keys-list" };
  const rest = words.slice(1);
  if (rest.length === 1 && (rest[0] === "reset" || rest[0] === "off"))
    return { type: "keys-reset" };
  if (rest.length === 1 && rest[0] === "presets")
    return { type: "keys-presets" };
  if (rest[0] === "preset")
    return rest.length === 2 && isKeysPreset(rest[1]!)
      ? { type: "keys-preset", preset: rest[1]! }
      : rest.length === 1
        ? { type: "keys-presets" }
        : undefined;
  if (rest.length === 1 && isKeysPreset(rest[0]!))
    return { type: "keys-preset", preset: rest[0]! };
  if (rest.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = keysParamName(rest[index]!);
    if (!name) return undefined;
    const word = rest[index + 1]!;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    const value = parseParamValue(KEYS_PARAMS[name]!, word);
    if (value === undefined || typeof value === "boolean") return undefined;
    values[name] = value as number | string;
  }
  return { type: "keys-set", values };
}

export function describeKeys(keys: TrackKeys | undefined): string {
  if (!keys) return "off";
  const entries = Object.entries(keys).filter(([key]) => key !== "preset");
  const parts = [
    ...(keys.preset ? [`preset ${keys.preset}`] : []),
    ...entries.map(([key, value]) => `${key} ${String(value)}`),
  ];
  return parts.length > 0 ? parts.join(" · ") : "defaults";
}

export type KeysResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** One line per preset for `keys presets`, /help and the agent prompt. */
export function keysPresetLines(): string[] {
  return Object.entries(KEYS_PRESETS).map(
    ([name, preset]) => `${name} · ${preset.doc} · ${preset.styles}`,
  );
}

type PresetTrack = Pick<
  TrackScore["tracks"][number],
  "fx" | "keys" | "filter" | "reverb"
>;

/** A preset's effects as the score stores them (defaults filled in). */
const storedPresetFx = new Map<string, Track>();
type Track = TrackScore["tracks"][number];
function presetEffects(preset: string): Track | undefined {
  if (storedPresetFx.has(preset)) return storedPresetFx.get(preset);
  const write = pianoWrite(preset);
  const track = write
    ? createScore({
        tracks: [
          {
            id: "p",
            name: "p",
            instrument: write.instrument,
            ...(write.filter ? { filter: write.filter } : {}),
            ...(write.fx ? { fx: write.fx } : {}),
            ...(write.reverb ? { reverb: write.reverb } : {}),
          },
        ],
      }).tracks[0]
    : undefined;
  if (track) storedPresetFx.set(preset, track);
  return track;
}

/** True when `stored` still equals the preset's stored value. */
function unchanged(stored: unknown, preset: unknown): boolean {
  return (
    stored !== undefined &&
    preset !== undefined &&
    JSON.stringify(stored) === JSON.stringify(preset)
  );
}

/**
 * Clears the effects the track's current preset brought (its filter, fx
 * entries and reverb) while they still hold the preset's values, so moving
 * between presets or resetting never piles them up. Effects the user has
 * since edited stay.
 */
export function keysPresetClear(track: PresetTrack): TrackPatch {
  const name = track.keys?.preset;
  const old = typeof name === "string" ? presetEffects(name) : undefined;
  if (!old) return {};
  const patch: {
    filter?: null;
    reverb?: null;
    fx?: TrackPatch["fx"];
  } = {};
  if (old.filter && unchanged(track.filter, old.filter)) patch.filter = null;
  if (old.reverb && unchanged(track.reverb, old.reverb)) patch.reverb = null;
  if (old.fx && track.fx) {
    const fx: Record<string, unknown> = { ...track.fx };
    let removed = false;
    for (const [effect, params] of Object.entries(old.fx))
      if (unchanged(fx[effect], params)) {
        delete fx[effect];
        removed = true;
      }
    if (removed)
      patch.fx = Object.keys(fx).length > 0 ? (fx as TrackPatch["fx"]) : null;
  }
  return patch;
}

/**
 * The track patch for a preset write (instrument, keys, preset effects),
 * first clearing the effects the previous preset brought.
 */
export function keysPresetPatch(
  track: PresetTrack,
  preset: string,
): TrackPatch {
  const write = pianoWrite(preset)!;
  const clear = keysPresetClear(track);
  const fx = "fx" in clear ? (clear.fx ?? undefined) : track.fx;
  return {
    ...clear,
    instrument: write.instrument,
    keys: write.keys,
    ...(write.filter ? { filter: write.filter } : {}),
    ...(write.fx
      ? { fx: { ...(fx ?? {}), ...write.fx } as TrackPatch["fx"] }
      : {}),
    ...(write.reverb ? { reverb: write.reverb } : {}),
  };
}

export function applyKeysCommand(
  score: TrackScore,
  trackId: string,
  command: KeysCommand,
): KeysResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "keys-presets")
    return {
      ok: true,
      message: `${command.family ?? "keys"} presets · ${Object.keys(
        KEYS_PRESETS,
      )
        .filter(
          (name) =>
            !command.family ||
            KEYS_PRESETS[name]!.instrument === command.family,
        )
        .join(" ")}`,
    };
  const piano = isKeysFamily(track.instrument);
  if (command.type === "keys-list")
    return {
      ok: true,
      message: piano
        ? `keys · ${track.instrument} · ${describeKeys(track.keys)} · basics ${keysSimpleFor(track.instrument).join(" ")}`
        : `keys · ${trackId} is ${track.instrument}; type piano (${PIANO_FAMILIES.join(" ")}) or ${ELECTRIC_FAMILIES.join(" ")} for modelled keys`,
    };
  if (
    command.type === "keys-set" &&
    command.family &&
    track.instrument !== command.family
  ) {
    // `epiano vibe 0.6` on another sound: become the family, then set.
    const base = applyKeysCommand(score, trackId, {
      type: "keys-preset",
      preset: command.family,
    });
    if (!base.ok || !base.next) return base;
    return applyKeysCommand(base.next, trackId, {
      type: "keys-set",
      values: command.values,
    });
  }
  if (track.sampler && command.type !== "keys-preset")
    return {
      ok: false,
      message: `keys · ${trackId} is a sampler track; type piano to make it a modelled piano`,
    };
  let patch: TrackPatch;
  if (command.type === "keys-preset") {
    patch = {
      ...keysPresetPatch(track, command.preset),
      ...(track.sampler ? { sampler: null } : {}),
      ...(track.synth ? { synth: null } : {}),
    };
  } else if (!piano) {
    // `keys` is also the legacy synth sound (`instrument keys`): name both
    // ways out.
    const keysSynth = track.instrument === "keys";
    const [first] = Object.keys(
      command.type === "keys-set" ? command.values : {},
    );
    return {
      ok: false,
      message: keysSynth
        ? `keys · keys shapes the modelled piano; ${trackId} is the keys synth: use synth ${first ?? "decay"} …, or type piano`
        : `keys · ${trackId} is ${track.instrument}; type piano first (keys shapes the modelled piano)`,
    };
  } else if (command.type === "keys-reset") {
    // The family's own sound: the preset and the effects it brought go.
    patch = { ...keysPresetClear(track), keys: {} };
  } else {
    const allowed = keysParamsFor(track.instrument);
    const foreign = Object.keys(command.values).filter(
      (key) => !allowed.includes(key),
    );
    if (foreign.length > 0)
      return {
        ok: false,
        message: `keys · ${track.instrument} has no ${foreign.join(" ")}; its parameters: ${allowed.join(" ")}`,
      };
    const keys: Record<string, unknown> = { ...(track.keys ?? {}) };
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete keys[key];
      else keys[key] = value;
    }
    try {
      patch = { keys: normalizeKeys(keys) ?? {} };
    } catch (error) {
      if (error instanceof FxValidationError)
        return { ok: false, message: `keys · ${error.message}` };
      throw error;
    }
  }
  let next: TrackScore;
  try {
    next = updateTrack(score, trackId, patch);
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `keys · ${error.message}` };
    throw error;
  }
  const stored = next.tracks.find((candidate) => candidate.id === trackId)!;
  const extras =
    command.type === "keys-preset"
      ? [
          ...(patch.reverb ? ["reverb"] : []),
          ...(patch.filter ? ["filter"] : []),
          ...Object.keys(pianoWrite(command.preset)?.fx ?? {}),
        ]
      : [];
  return {
    ok: true,
    message:
      command.type === "keys-preset"
        ? `keys · ${stored.instrument} · preset ${command.preset} · ${KEYS_PRESETS[command.preset]!.doc}${extras.length > 0 ? ` · with ${extras.join(" ")}` : ""}`
        : `keys · ${stored.instrument} · ${describeKeys(stored.keys)}`,
    next,
    kind: "score.keys",
    payload: {
      trackId,
      instrument: stored.instrument,
      keys: stored.keys ?? null,
    },
  };
}

/**
 * The fields a new track named after a piano word starts with
 * (`/track piano` → the modelled grand); empty for any other name. `lofi`
 * is left out: it also names a drum kit and pattern.
 */
export function newPianoTrack(name: string): {
  instrument?: string;
  keys?: TrackKeys;
  filter?: TrackPatch["filter"];
  fx?: TrackPatch["fx"];
  reverb?: TrackPatch["reverb"];
} {
  const word = name.toLowerCase();
  if (word === "lofi") return {};
  const write = pianoWrite(word);
  if (!write) return {};
  return {
    instrument: write.instrument,
    keys: write.keys,
    ...(write.filter ? { filter: write.filter } : {}),
    ...(write.fx ? { fx: write.fx } : {}),
    ...(write.reverb ? { reverb: write.reverb } : {}),
  };
}
