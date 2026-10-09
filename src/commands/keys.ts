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
 *   tonewheel [888800008]         the tonewheel organ (hammond, b3), drawbars
 *   combo [08880]                 the combo organ (farfisa), registers
 *   pipe [plenum | flute8 …]      the pipe organ (church), stops
 *   rotary slow|fast|stop         the organ's rotary speaker speed
 *   rotary fast at <beat>         a keys-rotary lane point (the Leslie switch)
 *   keys drawbars 888800008       organ text rows: drawbars registers stops
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
  KEYS_PARAM_FAMILIES,
  ORGAN_ALIASES,
  ORGAN_TEXT,
  PIANO_FAMILIES,
  PIPE_REGISTRATIONS,
  PIPE_STOPS,
  isKeysFamily,
  isKeysPreset,
  isOrganFamily,
  isOrganText,
  isPianoFamily,
  keysParamName,
  keysParamsFor,
  keysSimpleFor,
  ORGAN_ROWS,
  ORGAN_FAMILIES,
  normalizeKeys,
  pianoWrite,
  type TrackKeys,
} from "../../core/keys.ts";
import {
  automationPoints,
  createScore,
  SCORE_LIMITS,
  setTrackAutomation,
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
  | {
      type: "keys-preset";
      preset: string;
      /** f061-organ: overrides on top of the preset (`tonewheel 888800008`). */
      values?: Readonly<Record<string, string>>;
    }
  | {
      /** f061-organ: `rotary fast at 16` writes a keys-rotary point. */
      type: "keys-rotary-at";
      speed: "stop" | "slow" | "fast";
      beat: number;
    }
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
  // f061-organ
  ...Object.keys(ORGAN_ALIASES),
  "rotary",
]);

/** A pipe stop or registration word. */
function isStopWord(word: string): boolean {
  return (
    (PIPE_STOPS as readonly string[]).includes(word) ||
    Object.prototype.hasOwnProperty.call(PIPE_REGISTRATIONS, word)
  );
}

/** `principal8,octave4` / `principal8+octave4` / words: the stop words. */
function stopWords(words: readonly string[]): string[] | undefined {
  const out = words.flatMap((word) => word.split(/[,+]/).filter(Boolean));
  return out.length > 0 && out.every(isStopWord) ? out : undefined;
}

/**
 * f061-organ: `tonewheel 888800008`, `combo 08880`, `pipe plenum`,
 * `hammond gospel`: an organ preset word with its one text row.
 */
function parseOrganWord(words: readonly string[]): KeysCommand | undefined {
  const head = ORGAN_ALIASES[words[0]!] ?? words[0]!;
  if (!isKeysPreset(head)) return undefined;
  const family = KEYS_PRESETS[head]!.instrument;
  if (!isOrganFamily(family)) return undefined;
  const rest = words.slice(1);
  if (rest.length === 0) return { type: "keys-preset", preset: head };
  if (
    rest.length === 1 &&
    isKeysPreset(rest[0]!) &&
    KEYS_PRESETS[rest[0]!]!.instrument === family
  )
    return { type: "keys-preset", preset: rest[0]! };
  if (family === "pipe") {
    const stops = stopWords(rest);
    return stops
      ? {
          type: "keys-preset",
          preset: head,
          values: { stops: stops.join(" ") },
        }
      : undefined;
  }
  const name = family === "tonewheel" ? "drawbars" : "registers";
  const digits = ORGAN_TEXT[name].digits;
  const values: Record<string, string> = {};
  let at = 0;
  if (new RegExp(`^[0-8]{${digits}}$`).test(rest[0]!)) {
    values[name] = rest[0]!;
    at = 1;
  }
  // `combo flute`: the combo voice by its word.
  const spec = KEYS_PARAMS.voice;
  const voices: readonly string[] = spec?.kind === "enum" ? spec.values : [];
  if (family === "combo" && voices.includes(rest[at]!)) {
    values.voice = rest[at]!;
    at += 1;
  }
  // Then any rows as `keys` pairs: `tonewheel 888800008 perc 3rd`.
  const pairs = rest.slice(at);
  if (pairs.length > 0) {
    const set = parseKeysCommand(`keys ${pairs.join(" ")}`);
    if (set?.type !== "keys-set") return undefined;
    for (const [key, value] of Object.entries(set.values)) {
      if (value === null) return undefined;
      values[key] = String(value);
    }
  }
  return Object.keys(values).length > 0
    ? { type: "keys-preset", preset: head, values }
    : undefined;
}

/** The families that read a keys row (for the "wrong family" message). */
function familiesReading(param: string): string[] {
  const organs = ORGAN_FAMILIES.filter((family) =>
    ORGAN_ROWS[family].includes(param),
  );
  const others = (KEYS_PARAM_FAMILIES[param] ?? []).filter(
    (family) => !isOrganFamily(family),
  );
  const families = [...new Set([...others, ...organs])];
  return families.length > 0 ? families : ["the pianos"];
}

/**
 * A row the track's family never reads, as a message (`rotary` on a pipe
 * organ): stored projects still load, but a typed write is refused.
 */
export function keysRowMismatch(
  instrument: string,
  params: readonly string[],
): string | undefined {
  const rows = keysParamsFor(instrument);
  const wrong = params.filter(
    (param) => param !== "preset" && !rows.includes(param),
  );
  if (wrong.length === 0) return undefined;
  return `${instrument} has no ${wrong.join(" ")} (${familiesReading(wrong[0]!).join("/")} row); its parameters: ${rows.join(" ")}`;
}

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
  // f061-organ: `rotary slow|fast|stop` and the organ words with a row.
  if (head === "rotary") {
    const speed = words[1] as "stop" | "slow" | "fast";
    if (!["slow", "fast", "stop"].includes(speed)) return undefined;
    if (words.length === 2)
      return { type: "keys-set", values: { rotary: speed } };
    const beat = Number(words[3]);
    return words.length === 4 &&
      words[2] === "at" &&
      /^\d+(\.\d+)?$/.test(words[3]!) &&
      Number.isFinite(beat)
      ? { type: "keys-rotary-at", speed, beat }
      : undefined;
  }
  if (head !== "keys" && head !== "piano") {
    const organ = parseOrganWord(words);
    if (organ) return organ;
  }
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
  const values: Record<string, number | string | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = keysParamName(rest[index]!);
    if (!name) return undefined;
    const word = rest[index + 1];
    if (word === undefined) return undefined;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    // f061-organ text rows: digits, or stop words up to the next row name.
    if (isOrganText(name)) {
      if (name !== "stops") {
        values[name] = word;
        continue;
      }
      let end = index + 1;
      while (end < rest.length && !keysParamName(rest[end]!)) end += 1;
      const stops = stopWords(rest.slice(index + 1, end));
      if (!stops) return undefined;
      values[name] = stops.join(" ");
      index = end - 2;
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
  // f061-organ: organs take `keys` commands too.
  const piano = isKeysFamily(track.instrument);
  const elsewhere =
    track.instrument === "organ"
      ? `keys · ${trackId} is the legacy organ; type tonewheel (or combo, pipe) for drawbars and rotary, or piano for the modelled piano`
      : `keys · ${trackId} is ${track.instrument}; type piano (${PIANO_FAMILIES.join(" ")}), ${ELECTRIC_FAMILIES.join(" ")} or ${ORGAN_FAMILIES.join(" ")} for modelled keys`;
  if (command.type === "keys-list")
    return {
      ok: true,
      message: piano
        ? `keys · ${track.instrument} · ${describeKeys(track.keys)} · basics ${keysSimpleFor(track.instrument).join(" ")}`
        : elsewhere,
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
    if (command.values) {
      try {
        patch = {
          ...patch,
          keys: normalizeKeys({ ...patch.keys, ...command.values }) ?? {},
        };
      } catch (error) {
        if (error instanceof FxValidationError)
          return { ok: false, message: `keys · ${error.message}` };
        throw error;
      }
    }
  } else if (!piano && command.type === "keys-rotary-at") {
    return { ok: false, message: elsewhere };
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
        : elsewhere,
    };
  } else if (command.type === "keys-rotary-at") {
    const wrong = keysRowMismatch(track.instrument, ["rotary"]);
    if (wrong) return { ok: false, message: `keys · ${wrong}` };
    const tick = Math.round(command.beat * score.ticksPerBeat);
    const value = { stop: 0, slow: 1, fast: 2 }[command.speed];
    const merged = new Map(
      automationPoints(track, "keys-rotary").map((point) => [
        point.tick,
        point,
      ]),
    );
    merged.set(tick, { tick, value });
    const points = [...merged.values()].sort((a, b) => a.tick - b.tick);
    if (points.length > SCORE_LIMITS.maxAutomationPoints)
      return { ok: false, message: "keys-rotary automation is full" };
    return {
      ok: true,
      message: `keys · rotary ${command.speed} at beat ${command.beat} · keys-rotary ${points.length} point${points.length === 1 ? "" : "s"}`,
      next: setTrackAutomation(score, trackId, "keys-rotary", points),
      kind: "score.automation",
      payload: { trackId, parameter: "keys-rotary", points },
    };
  } else if (command.type === "keys-reset") {
    // The family's own sound: the preset and the effects it brought go.
    patch = { ...keysPresetClear(track), keys: {} };
  } else {
    const wrong = keysRowMismatch(
      track.instrument,
      Object.entries(command.values)
        .filter(([, value]) => value !== null)
        .map(([key]) => key),
    );
    if (wrong) return { ok: false, message: `keys · ${wrong}` };
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
        ? command.values
          ? `keys · ${stored.instrument} · ${describeKeys(stored.keys)}${extras.length > 0 ? ` · with ${extras.join(" ")}` : ""}`
          : `keys · ${stored.instrument} · preset ${command.preset} · ${KEYS_PRESETS[command.preset]!.doc}${extras.length > 0 ? ` · with ${extras.join(" ")}` : ""}`
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
