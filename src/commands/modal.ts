/**
 * The `modal` prompt command (0.6): modal percussion on the focused track
 * (core/resonators.ts). The menu and the `set_modal` agent tool build the
 * same edits.
 *
 *   modal                              show the track's preset and overrides
 *   modal <preset>                     play a preset: marimba vibes xylophone
 *                                      glock celesta chimes kalimba mbira
 *                                      steelpan bowl gong timpani (and the
 *                                      aliases vibraphone glockenspiel
 *                                      tubular thumbpiano gongageng)
 *   modal preset <name>                the same, spelled out
 *   modal mallet <yarn|cord|rubber|plastic|brass>
 *   modal <param> <value> [<param> <value>…]   hardness 0.8, ring 3 …
 *   modal <param> off                  back to the preset's value
 *   modal reset                        clear overrides (keep the preset)
 *   modal off                          back to the legacy marimba voice
 *   modal list | presets modal         the presets with one-line characters
 *
 * Any edit turns the track into a modal track (`instrument "modal"`); the
 * legacy `marimba` tone is untouched until then. One `updateTrack` revision
 * and one undo step per command.
 */
import { FxValidationError } from "../../core/params.ts";
import {
  DEFAULT_MODAL_PRESET,
  GAMELAN_PRESETS,
  MODAL_INSTRUMENT,
  MODAL_PARAMS,
  MODAL_PRESETS,
  MODAL_PRESET_NAMES,
  MODAL_SIMPLE,
  modalParamName,
  modalPresetFor,
  modalSettings,
  normalizeModal,
  type TrackModal,
} from "../../core/resonators.ts";
import {
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import { parseParamValue } from "./fx.ts";

export type ModalCommand =
  | { type: "modal-show" }
  | { type: "modal-list" }
  | { type: "modal-reset" }
  | { type: "modal-off" }
  | { type: "modal-preset"; preset: string }
  | { type: "modal-usage"; message: string }
  | { type: "modal-hint"; message: string }
  | {
      type: "modal-set";
      /** `null` returns a parameter to the preset's value. */
      values: Readonly<Record<string, number | string | null>>;
    };

/** The voice `modal off` returns a track to: the legacy marimba tone. */
export const MODAL_OFF_INSTRUMENT = "marimba";

export const MODAL_USAGE =
  "modal <preset> | modal <body> | modal <param> <value> | modal mallet <name> | modal pair <track> | modal gamelan | modal reset | modal off | modal presets";

function rangeOf(name: string): string {
  const spec = MODAL_PARAMS[name]!;
  if (spec.kind === "number") return `${name} is ${spec.min}..${spec.max}`;
  if (spec.kind === "enum") return `${name} is one of ${spec.values.join(" ")}`;
  return name;
}

export function parseModalCommand(prompt: string): ModalCommand | undefined {
  const words = prompt.trim().toLowerCase().split(/\s+/);
  if (words[0] === "presets" && words[1] === "modal" && words.length === 2)
    return { type: "modal-list" };
  if (words[0] !== "modal") return undefined;
  if (words.length === 1) return { type: "modal-show" };
  if (prompt.length > 512) return undefined;
  const rest = words.slice(1);
  if (rest.length === 1 && rest[0] === "reset") return { type: "modal-reset" };
  if (rest.length === 1 && rest[0] === "off") return { type: "modal-off" };
  if (rest.length === 1 && (rest[0] === "list" || rest[0] === "presets"))
    return { type: "modal-list" };
  // `gamelan` is a browse group, not a preset: list the bronzes.
  if (rest.length === 1 && rest[0] === "gamelan")
    return {
      type: "modal-hint",
      message: `gamelan · ${GAMELAN_PRESETS.join(" ")} · modal gangsa to start · pair two tracks with modal pair <track> · tuning slendro or pelog · ctrl-k Sound › instruments › mallets › gamelan`,
    };
  if (rest[0] === "preset") {
    const preset = rest.length === 2 ? modalPresetFor(rest[1]!) : undefined;
    return preset
      ? { type: "modal-preset", preset }
      : {
          type: "modal-usage",
          message: `modal preset is one of ${MODAL_PRESET_NAMES.join(" ")}`,
        };
  }
  if (rest.length === 1) {
    const preset = modalPresetFor(rest[0]!);
    if (preset) return { type: "modal-preset", preset };
    // A body word with no preset of its own (frame, bell, crotale ...)
    // sets the body.
    const body = MODAL_PARAMS.body;
    if (body?.kind === "enum" && body.values.includes(rest[0]!))
      return { type: "modal-set", values: { body: rest[0]! } };
    return { type: "modal-usage", message: MODAL_USAGE };
  }
  // f061-gamelan-winds: `modal pair <track>` makes this track the
  // pengisep of an ombak pair (ids keep their case).
  if (rest[0] === "pair" && rest.length === 2) {
    const id = prompt.trim().split(/\s+/)[2]!;
    if (id === "off" || id === "unset" || id === "none")
      return { type: "modal-set", values: { pair: null } };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
      return {
        type: "modal-usage",
        message: "modal pair <track id> | modal pair off",
      };
    return { type: "modal-set", values: { pair: id } };
  }
  if (rest.length % 2 !== 0)
    return { type: "modal-usage", message: MODAL_USAGE };
  const values: Record<string, number | string | null> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = modalParamName(rest[index]!);
    if (!name)
      return {
        type: "modal-usage",
        message: `modal has no parameter ${rest[index]!.slice(0, 24)} · ${MODAL_SIMPLE.join(" ")} …`,
      };
    const word = rest[index + 1]!;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    const value = parseParamValue(MODAL_PARAMS[name]!, word);
    if (value === undefined || typeof value === "boolean")
      return { type: "modal-usage", message: rangeOf(name) };
    values[name] = value;
  }
  return { type: "modal-set", values };
}

/** `preset vibes · hardness 0.6 · ring 3`, overrides in canonical order. */
export function describeModal(modal: TrackModal | undefined): string {
  if (!modal) return "not a modal track";
  const preset = modal.preset ?? DEFAULT_MODAL_PRESET;
  const overrides = Object.entries(modal)
    .filter(([key]) => key !== "preset")
    .map(([key, value]) => `${key} ${value}`);
  return [`preset ${preset}`, ...overrides].join(" · ");
}

/** One line per preset, for `modal list` and the agent brief. */
export function modalListLines(): string[] {
  return MODAL_PRESET_NAMES.map(
    (name) => `${name.padEnd(10)} ${MODAL_PRESETS[name].doc}`,
  );
}

export type ModalResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/**
 * The modal field a command leaves on a track (pure; the agent tool shares
 * it). A preset switch keeps the overrides; `reset` keeps the preset.
 * `mallet` and `hardness` are one choice, so the one written last wins.
 */
export function nextModal(
  current: TrackModal | undefined,
  command: Extract<
    ModalCommand,
    { type: "modal-reset" | "modal-preset" | "modal-set" }
  >,
): TrackModal {
  const base: Record<string, unknown> = { ...current };
  // `modal ombak 6` or `modal pair t2` on a track that is not modal yet
  // means a gamelan pair: start from gangsa, not the default marimba.
  if (
    current === undefined &&
    command.type === "modal-set" &&
    command.values.preset === undefined &&
    (typeof command.values.ombak === "number" ||
      typeof command.values.pair === "string")
  )
    base.preset = "gangsa";
  if (command.type === "modal-reset")
    return normalizeModal(current?.preset ? { preset: current.preset } : {})!;
  if (command.type === "modal-preset") base.preset = command.preset;
  else
    for (const [key, value] of Object.entries(command.values)) {
      if (value === null) delete base[key];
      else {
        base[key] = value;
        if (key === "mallet" && !("hardness" in command.values))
          delete base.hardness;
        if (key === "hardness" && !("mallet" in command.values))
          delete base.mallet;
      }
    }
  return normalizeModal(base)!;
}

export function applyModalCommand(
  score: TrackScore,
  trackId: string,
  command: ModalCommand,
): ModalResult {
  if (command.type === "modal-usage")
    return { ok: false, message: `modal · ${command.message}` };
  if (command.type === "modal-hint")
    return { ok: true, message: `modal · ${command.message}` };
  if (command.type === "modal-list")
    return {
      ok: true,
      message: `modal presets · ${MODAL_PRESET_NAMES.join(" ")}`,
    };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "modal-show")
    return {
      ok: true,
      message:
        track.instrument === MODAL_INSTRUMENT && track.modal
          ? `modal · ${describeModal(track.modal)}`
          : `modal · ${trackId} plays ${track.instrument} · modal <preset> to switch (${MODAL_PRESET_NAMES.join(" ")})`,
    };
  if (track.sampler || track.instrument === "kit")
    return {
      ok: false,
      message: `modal · ${trackId} is a ${track.sampler ? "sampler" : "drum"} track`,
    };
  const current =
    track.instrument === MODAL_INSTRUMENT ? track.modal : undefined;
  if (command.type === "modal-off") {
    if (track.instrument !== MODAL_INSTRUMENT)
      return { ok: true, message: "modal · already off" };
    // Like `string off`: leave the engine for the legacy voice.
    const next = updateTrack(score, trackId, {
      instrument: MODAL_OFF_INSTRUMENT,
      modal: null,
    });
    return {
      ok: true,
      message: `modal · off (${MODAL_OFF_INSTRUMENT}) · modal ${current?.preset ?? DEFAULT_MODAL_PRESET} turns it back on`,
      next,
      kind: "score.modal",
      payload: { trackId, instrument: MODAL_OFF_INSTRUMENT, modal: null },
    };
  }
  let modal: TrackModal;
  let next: TrackScore;
  let partnerNote = "";
  try {
    modal = nextModal(current, command);
    if (
      command.type === "modal-set" &&
      typeof command.values.pair === "string"
    ) {
      const partnerId = command.values.pair;
      const partner = score.tracks.find((entry) => entry.id === partnerId);
      if (!partner || partnerId === trackId)
        return {
          ok: false,
          message: `modal · pair needs another track id (${score.tracks
            .filter((entry) => entry.id !== trackId)
            .map((entry) => entry.id)
            .join(" ")})`,
        };
      if (partner.instrument !== MODAL_INSTRUMENT || !partner.modal)
        return {
          ok: false,
          message: `modal · ${partnerId} is not a modal track · modal gangsa on it first`,
        };
      // The partner (pengumbang) plays straight (ombak 0) and this track
      // (pengisep) sounds ombak Hz above it, so the pair beats at ombak Hz.
      if (modalSettings(partner.modal).ombak !== 0) {
        score = updateTrack(score, partnerId, {
          modal: normalizeModal({ ...partner.modal, ombak: 0 })!,
        });
      }
      partnerNote = ` · ${partnerId} is the pengumbang (ombak 0)`;
    }
    next = updateTrack(score, trackId, {
      instrument: MODAL_INSTRUMENT,
      modal,
    });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `modal · ${error.message}` };
    throw error;
  }
  return {
    ok: true,
    message: `modal · ${describeModal(modal)}${partnerNote}`,
    next,
    kind: "score.modal",
    payload: { trackId, instrument: MODAL_INSTRUMENT, modal },
  };
}
