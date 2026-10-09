/**
 * `/vocoder` (0.7, vocoder.md §8): put a vocoder on a track or tune it.
 *
 * - `/vocoder` on a track with audio (a vocal) and no vocoder makes a
 *   `<name> vocoder` carrier track driven by it and mutes the vocal, in one
 *   undo step; on a vocoder track it shows the settings and the modulator's
 *   licence; with nothing to vocode it changes nothing and says how to get a
 *   voice in (the Entry guidance).
 * - `/vocoder <preset>`, `/vocoder src <track>`, `/vocoder <param> <value>`
 *   (every VOCODER_PARAMS key), `/vocoder <param> reset`, `/vocoder reset`,
 *   `/vocoder off`, `/vocoder presets`.
 *
 * Preset words always win over track names: a track named `robot` is chosen
 * with `/vocoder src robot`. The agent tools share `nextVocoder`,
 * `vocodeTrack` and `vocoderProvenance`.
 */
import { parseKey } from "../../core/chords.ts";
import { FxValidationError } from "../../core/fx.ts";
import { resolveTrackRef } from "../../core/routing.ts";
import {
  addTrack,
  ScoreValidationError,
  SCORE_LIMITS,
  updateTrack,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { trackSlug } from "../../core/slug.ts";
import {
  DEFAULT_VOCODER_PRESET,
  isVocoderPreset,
  normalizeVocoder,
  resolveVocoder,
  VOCODER_GATE_AUTO,
  VOCODER_INSTRUMENT,
  VOCODER_PARAMS,
  VOCODER_PRESET_NAMES,
  VOCODER_PRESETS,
  vocoderParamName,
  type TrackVocoder,
  type VocoderCarrier,
  type VocoderFollow,
  type VocoderPresetName,
} from "../../core/vocoder.ts";
import { chordTimeline } from "../audio/granular.ts";
import { nearestWord } from "../audio/instrument-check.ts";
import { parseParamValue } from "./fx.ts";
import { VOCAL_VERBS } from "./vocal.ts";

export type VocoderValue = number | string | boolean | null;

export type VocoderCommand =
  /** `fresh` (`/vocoder new`) makes another carrier for a vocal. */
  | { type: "vocoder-show"; fresh?: boolean }
  | { type: "vocoder-list" }
  | { type: "vocoder-reset" }
  | { type: "vocoder-off" }
  | { type: "vocoder-usage"; message: string }
  | {
      type: "vocoder-set";
      /** A preset applied before the values (`vocoder talkbox formant 3`). */
      preset?: VocoderPresetName;
      /** The modulator, an id or a name slug. */
      src?: string;
      /** `null` returns a parameter to the preset's value. */
      values: Readonly<Record<string, VocoderValue>>;
    };

export const VOCODER_USAGE =
  "vocoder [preset] | vocoder new | vocoder src <track> | vocoder <param> <value|reset> | vocoder reset | vocoder off | vocoder presets";

/** The keys `/vocoder <param>` takes: exactly VOCODER_PARAMS. */
export const VOCODER_COMMAND_KEYS: readonly string[] = Object.freeze(
  Object.keys(VOCODER_PARAMS),
);

function rangeOf(name: string): string {
  const spec = VOCODER_PARAMS[name]!;
  if (name === "gate")
    return `gate is ${spec.kind === "number" ? `${spec.min}..${spec.max} dB` : ""} or auto`;
  if (spec.kind === "number") return `${name} is ${spec.min}..${spec.max}`;
  if (spec.kind === "enum") return `${name} is one of ${spec.values.join(" ")}`;
  return `${name} is on or off`;
}

/** One `<param> <value>` pair; undefined value means a range error. */
function parseValue(name: string, word: string): VocoderValue | undefined {
  if (word === "reset" || word === "unset") return null;
  if (name === "gate" && word === VOCODER_GATE_AUTO) return VOCODER_GATE_AUTO;
  // `+3` reads as 3 (`/vocoder formant +3`).
  const text = /^\+\d/.test(word) ? word.slice(1) : word;
  return parseParamValue(VOCODER_PARAMS[name]!, text);
}

export function parseVocoderCommand(
  prompt: string,
): VocoderCommand | undefined {
  if (prompt.length > 512) return undefined;
  const raw = prompt.trim().replace(/^\//, "").split(/\s+/);
  const words = raw.map((word) => word.toLowerCase());
  if (words[0] === "presets" && words[1] === "vocoder" && words.length === 2)
    return { type: "vocoder-list" };
  if (words[0] !== "vocoder") return undefined;
  if (words.length === 1) return { type: "vocoder-show" };
  const rest = words.slice(1);
  const restRaw = raw.slice(1);
  if (rest.length === 1) {
    if (rest[0] === "reset") return { type: "vocoder-reset" };
    if (rest[0] === "off") return { type: "vocoder-off" };
    if (rest[0] === "new") return { type: "vocoder-show", fresh: true };
    if (rest[0] === "list" || rest[0] === "presets")
      return { type: "vocoder-list" };
  }
  let preset: VocoderPresetName | undefined;
  if (rest[0] === "preset") {
    if (rest.length !== 2 || !isVocoderPreset(rest[1]!))
      return {
        type: "vocoder-usage",
        message: `preset is one of ${VOCODER_PRESET_NAMES.join(" ")}`,
      };
    return {
      type: "vocoder-set",
      preset: rest[1] as VocoderPresetName,
      values: {},
    };
  }
  if (isVocoderPreset(rest[0]!)) {
    preset = rest[0] as VocoderPresetName;
    rest.shift();
    restRaw.shift();
  }
  let src: string | undefined;
  const values: Record<string, VocoderValue> = {};
  for (let index = 0; index < rest.length;) {
    const key = rest[index]!;
    if (key === "src" || key === "source") {
      // A quoted run of words, or every word up to the next parameter
      // (`src Lead Vox formant 3` names the track `Lead Vox`).
      const words: string[] = [];
      let next = index + 1;
      const first = restRaw[next];
      const quote = first?.match(/^["']/)?.[0];
      if (quote) {
        for (; next < restRaw.length; next += 1) {
          words.push(restRaw[next]!);
          if (
            (words.length > 1 || first!.length > 1) &&
            restRaw[next]!.endsWith(quote)
          ) {
            next += 1;
            break;
          }
        }
      } else {
        for (; next < restRaw.length; next += 1) {
          const word = rest[next]!;
          if (vocoderParamName(word) || word === "src" || word === "source")
            break;
          words.push(restRaw[next]!);
        }
      }
      const value = words
        .join(" ")
        .replace(/^["']|["']$/g, "")
        .trim();
      if (value === "")
        return { type: "vocoder-usage", message: "vocoder src <track>" };
      src = value;
      index = next;
      continue;
    }
    const name = vocoderParamName(key);
    if (!name) {
      const word = key.slice(0, 24);
      const near = nearestWord(word, [...VOCODER_COMMAND_KEYS, "src"]);
      const asPreset = nearestWord(word, [...VOCODER_PRESET_NAMES]);
      return {
        type: "vocoder-usage",
        message: `vocoder has no parameter or preset ${word}${near || asPreset ? ` · did you mean ${near ?? asPreset}?` : ""} · ${VOCODER_USAGE}`,
      };
    }
    const word = rest[index + 1];
    if (word === undefined)
      return { type: "vocoder-usage", message: rangeOf(name) };
    const value = parseValue(name, word);
    if (value === undefined)
      return { type: "vocoder-usage", message: rangeOf(name) };
    values[name] = value;
    index += 2;
  }
  return {
    type: "vocoder-set",
    ...(preset ? { preset } : {}),
    ...(src !== undefined ? { src } : {}),
    values,
  };
}

/** True when a track plays recorded audio a vocoder can follow. */
export function trackHasAudio(track: Track): boolean {
  if (track.sampler && Object.keys(track.sampler.voices).length > 0)
    return true;
  if ((track.clips?.length ?? 0) > 0) return true;
  return track.instrument === "vocal";
}

/**
 * Tracks that could drive a vocoder on `carrierId`: audio tracks first (the
 * vocals), never the carrier itself or another vocoder carrier.
 */
export function vocoderCandidates(
  score: TrackScore,
  carrierId?: string,
): readonly Track[] {
  return score.tracks.filter(
    (track) =>
      track.id !== carrierId &&
      track.instrument !== VOCODER_INSTRUMENT &&
      trackHasAudio(track),
  );
}

/**
 * What to do when nothing can be vocoded (vocoder.md §5 Entry). Names
 * `/vocal import` and `/vocal stem` only once those verbs are registered.
 */
export function vocoderEntryLines(): readonly string[] {
  const has = (verb: string) =>
    VOCAL_VERBS.some((candidate) => candidate.verb === verb);
  return [
    "vocoder · no voice to vocode yet · nothing changed",
    has("import")
      ? "  import a file:   /vocal import <file.wav>  (or /sample <file>)"
      : "  import a file:   /sample <file.wav>",
    ...(has("stem")
      ? ["  split a song:    /vocal stem <file>  to get its vocal stem"]
      : []),
    "  or point it at any track:  /vocoder src <track>",
  ];
}

/**
 * The modulator's licence and provenance lines, the way pack.ts returns
 * `license`. Restricted sources print one plain line each.
 */
export function vocoderProvenance(score: TrackScore, srcId: string): string[] {
  const track = score.tracks.find((candidate) => candidate.id === srcId);
  if (!track) return [];
  const lines = new Set<string>();
  for (const ref of Object.values(track.sampler?.voices ?? {})) {
    if (ref.license) lines.add(`modulator license ${ref.license} (${ref.src})`);
  }
  for (const clip of track.clips ?? []) {
    if (clip.say) {
      const restricted = clip.say.engine === "say";
      lines.add(
        restricted
          ? `vocoded from a macOS say voice (${clip.say.voice}): ${clip.say.license}`
          : `vocoded from ${clip.say.engine} voice ${clip.say.voice}: ${clip.say.license}`,
      );
    }
  }
  return [...lines];
}

/** `talkbox · src vox · formant 3`, overrides in canonical order. */
export function describeVocoder(
  score: TrackScore,
  vocoder: TrackVocoder,
): string {
  const parts = [`preset ${vocoder.preset ?? DEFAULT_VOCODER_PRESET}`];
  if (vocoder.src !== undefined) {
    const source = score.tracks.find((track) => track.id === vocoder.src);
    parts.push(`src ${source ? source.name : vocoder.src}`);
  } else parts.push("no src (plays dry)");
  for (const key of VOCODER_COMMAND_KEYS) {
    const value = (vocoder as Record<string, unknown>)[key];
    if (value !== undefined)
      parts.push(
        `${key} ${value === true ? "on" : value === false ? "off" : value}`,
      );
  }
  return parts.join(" · ");
}

/** One line per preset, for `vocoder presets` and the agent brief. */
export function vocoderListLines(): string[] {
  return VOCODER_PRESET_NAMES.map(
    (name) => `${name.padEnd(8)} ${VOCODER_PRESETS[name].doc}`,
  );
}

/** A rough render-cost hint (vocoder.md §3b.9: talkbox and >24 bands). */
export function vocoderCostHint(vocoder: TrackVocoder): string {
  const resolved = resolveVocoder(vocoder);
  if (resolved.mode === "talkbox") return "cost: talkbox (LPC), light";
  if (resolved.bands > 24) return `cost: ${resolved.bands} bands, heavy`;
  return `cost: ${resolved.bands} bands`;
}

export type VocoderResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
  /** The track the command changed or created. */
  trackId?: string;
}>;

/**
 * The vocoder field a set leaves on a track (pure; the agent tool shares
 * it). A preset switch keeps the overrides; `reset` keeps the preset and
 * the source.
 */
export function nextVocoder(
  current: TrackVocoder | undefined,
  change: Readonly<{
    reset?: boolean;
    preset?: VocoderPresetName;
    src?: string;
    values?: Readonly<Record<string, VocoderValue>>;
  }>,
): TrackVocoder {
  const base: Record<string, unknown> = change.reset
    ? {
        ...(current?.src !== undefined ? { src: current.src } : {}),
        ...(current?.preset ? { preset: current.preset } : {}),
      }
    : { ...current };
  if (change.preset) base.preset = change.preset;
  if (change.src !== undefined) base.src = change.src;
  for (const [key, value] of Object.entries(change.values ?? {})) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return normalizeVocoder(base)!;
}

/** Resolve a typed modulator to a track id, or an error message. */
export function resolveVocoderSrc(
  score: TrackScore,
  carrierId: string,
  text: string,
): { id: string } | { error: string } {
  const byId = score.tracks.find((track) => track.id === text);
  if (!byId) {
    const slug = trackSlug(text);
    const matches = score.tracks.filter(
      (track) => trackSlug(track.name) === slug,
    );
    if (matches.length > 1)
      return {
        error: `src ${text} matches ${matches.length} tracks (${matches.map((track) => track.id).join(", ")}); use an id`,
      };
  }
  const found = byId ?? resolveTrackRef(score, text);
  if (!found) {
    const near = nearestWord(
      text.slice(0, 48),
      score.tracks.map((track) => track.id),
    );
    return {
      error: `src ${text.slice(0, 48)} names no track${near ? ` · did you mean ${near}?` : ""}`,
    };
  }
  if (found.id === carrierId)
    return { error: `${carrierId} cannot vocode itself; pick another src` };
  return { id: found.id };
}

function nameFor(
  score: TrackScore,
  base: string,
): { id: string; name: string } {
  const stem = trackSlug(`${base} vocoder`).slice(0, 40);
  let id = stem;
  for (let n = 2; score.tracks.some((track) => track.id === id); n += 1)
    id = `${stem}-${n}`;
  const suffix = id === stem ? "" : ` ${id.slice(stem.length + 1)}`;
  const name = `${base.slice(0, 48 - 9 - suffix.length)} vocoder${suffix}`;
  return { id, name };
}

/**
 * One step (vocoder.md §5): a new `vocoder` track driven by `srcId`, chords
 * from the song when it has harmonic tracks, else a drone on the key's root,
 * and the source muted. Pure; one score change.
 */
export function vocodeTrack(
  score: TrackScore,
  srcId: string,
  options: Readonly<{
    preset?: VocoderPresetName;
    name?: string;
    carrier?: VocoderCarrier;
    follow?: VocoderFollow;
    keepSource?: boolean;
  }> = {},
): VocoderResult {
  const source = score.tracks.find((track) => track.id === srcId);
  if (!source) return { ok: false, message: `vocoder · no track ${srcId}` };
  if (score.tracks.length >= SCORE_LIMITS.maxTracks)
    return { ok: false, message: "vocoder · the song is full of tracks" };
  const preset = options.preset ?? DEFAULT_VOCODER_PRESET;
  const presetFollow = VOCODER_PRESETS[preset].values.follow;
  const hasChords = chordTimeline(score).ticks.length > 0;
  // The preset's follow, unless it follows notes: a fresh track has none, so
  // it follows the song's chords, or drones on the key's root.
  let follow: VocoderFollow | undefined = options.follow;
  let root: number | undefined;
  if (follow === undefined && (presetFollow ?? "notes") === "notes")
    follow = hasChords ? "chords" : "drone";
  // A drone (the preset's or the fallback's) sits on the song key's tonic.
  if ((follow ?? presetFollow) === "drone") {
    const key = parseKey(score.key);
    // The key's tonic in the octave around A2..G#3 (45..56).
    root = key ? 45 + ((((key.tonic - 45) % 12) + 12) % 12) : undefined;
  }
  const { id, name: autoName } = nameFor(score, source.name);
  const name = options.name?.trim().slice(0, 48) || autoName;
  let vocoder: TrackVocoder;
  let next: TrackScore;
  try {
    vocoder = normalizeVocoder({
      src: srcId,
      preset,
      ...(follow !== undefined && follow !== presetFollow ? { follow } : {}),
      ...(root !== undefined ? { root } : {}),
      ...(options.carrier ? { carrier: options.carrier } : {}),
    })!;
    next = addTrack(score, {
      id,
      name,
      instrument: VOCODER_INSTRUMENT,
      vocoder,
    });
    if (!options.keepSource && source.muted !== true)
      next = updateTrack(next, srcId, { muted: true });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `vocoder · ${error.message}` };
    throw error;
  }
  const muted = !options.keepSource && source.muted !== true;
  const lines = [
    `vocoder · new track ${name} · ${describeVocoder(next, vocoder)}`,
    muted
      ? `  muted ${source.name}; the vocoder still hears it (the tap ignores mute) · /unmute ${srcId} to hear both`
      : `  ${source.name} still plays`,
    ...vocoderProvenance(next, srcId).map((line) => `  ${line}`),
    ...((presetFollow ?? "notes") === "notes" && options.follow === undefined
      ? [
          `  ${preset} plays a line: /vocoder follow notes, then write the melody on ${id}`,
        ]
      : []),
  ];
  return {
    ok: true,
    message: lines.join("\n"),
    next,
    kind: "score.vocoder",
    payload: { trackId: id, src: srcId, vocoder, muted },
    trackId: id,
  };
}

export function applyVocoderCommand(
  score: TrackScore,
  trackId: string,
  command: VocoderCommand,
): VocoderResult {
  if (command.type === "vocoder-usage")
    return { ok: false, message: `vocoder · ${command.message}` };
  if (command.type === "vocoder-list")
    return {
      ok: true,
      message: [
        "vocoder presets:",
        ...vocoderListLines().map((l) => `  ${l}`),
      ].join("\n"),
    };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const current = track.vocoder;
  // A vocal without a vocoder of its own: commands go to the carrier it
  // drives, or make one (one step), so `/vocoder talkbox` on the vocal
  // gives a talkbox carrier rather than a src-less field on the vocal.
  const vocalSide =
    !current &&
    trackHasAudio(track) &&
    (command.type === "vocoder-show" ||
      (command.type === "vocoder-set" && command.src === undefined));
  if (vocalSide) {
    const fresh = command.type === "vocoder-show" && command.fresh === true;
    const carrier = fresh
      ? undefined
      : score.tracks.find(
          (candidate) =>
            candidate.vocoder?.src !== undefined &&
            resolveTrackRef(score, candidate.vocoder.src)?.id === trackId,
        );
    if (carrier) {
      const result = applyVocoderCommand(score, carrier.id, command);
      return result.trackId ? result : { ...result, trackId: carrier.id };
    }
    if (command.type === "vocoder-show") return vocodeTrack(score, trackId);
    if (command.type === "vocoder-set") {
      const follow = command.values.follow;
      const made = vocodeTrack(score, trackId, {
        ...(command.preset ? { preset: command.preset } : {}),
        ...(typeof follow === "string"
          ? { follow: follow as VocoderFollow }
          : {}),
      });
      if (!made.ok || !made.next || !made.trackId) return made;
      const { follow: _follow, ...values } = command.values;
      if (Object.keys(values).length === 0) return made;
      const tuned = applyVocoderCommand(made.next, made.trackId, {
        type: "vocoder-set",
        values,
      });
      if (!tuned.ok || !tuned.next) return tuned;
      return {
        ...made,
        message: `${made.message}\n  ${tuned.message}`,
        next: tuned.next,
        payload: {
          ...made.payload,
          vocoder: tuned.next.tracks.find((t) => t.id === made.trackId)
            ?.vocoder,
        },
      };
    }
  }
  if (command.type === "vocoder-show") {
    if (current) {
      const lines = [
        `vocoder · ${describeVocoder(score, current)} · ${vocoderCostHint(current)}`,
        ...(current.src !== undefined
          ? vocoderProvenance(score, current.src).map((line) => `  ${line}`)
          : ["  /vocoder src <track> picks the voice"]),
      ];
      return { ok: true, message: lines.join("\n") };
    }
    // Another track: drive it from the one vocal.
    const candidates = vocoderCandidates(score, trackId);
    if (candidates.length === 0)
      return { ok: true, message: vocoderEntryLines().join("\n") };
    if (candidates.length > 1)
      return {
        ok: true,
        message: `vocoder · pick the voice: ${candidates.map((t) => `/vocoder src ${t.id}`).join(" · ")}`,
      };
    command = { type: "vocoder-set", src: candidates[0]!.id, values: {} };
  }
  if (track.instrument === "kit")
    return { ok: false, message: `vocoder · ${trackId} is a drum track` };
  if (command.type === "vocoder-off") {
    if (!current) return { ok: true, message: "vocoder · already off" };
    const next = updateTrack(score, trackId, { vocoder: null });
    return {
      ok: true,
      message:
        track.instrument === VOCODER_INSTRUMENT
          ? "vocoder · off · the track plays its plain supersaw carrier · /vocoder turns it back on"
          : "vocoder · off",
      next,
      kind: "score.vocoder",
      payload: { trackId, vocoder: null },
      trackId,
    };
  }
  let src: string | undefined;
  if (command.type === "vocoder-set" && command.src !== undefined) {
    const found = resolveVocoderSrc(score, trackId, command.src);
    if ("error" in found)
      return { ok: false, message: `vocoder · ${found.error}` };
    src = found.id;
  }
  // No voice yet and exactly one to follow: pick it (one step to a sound).
  if (
    src === undefined &&
    current?.src === undefined &&
    command.type === "vocoder-set"
  ) {
    const candidates = vocoderCandidates(score, trackId);
    if (candidates.length === 1) src = candidates[0]!.id;
  }
  let vocoder: TrackVocoder;
  let next: TrackScore;
  try {
    vocoder =
      command.type === "vocoder-reset"
        ? nextVocoder(current, { reset: true })
        : nextVocoder(current, {
            ...(command.preset ? { preset: command.preset } : {}),
            ...(src !== undefined ? { src } : {}),
            values: command.values,
          });
    next = updateTrack(score, trackId, { vocoder });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `vocoder · ${error.message}` };
    throw error;
  }
  const lines = [
    `vocoder · ${describeVocoder(next, vocoder)}`,
    ...(src !== undefined
      ? vocoderProvenance(next, src).map((line) => `  ${line}`)
      : []),
  ];
  return {
    ok: true,
    message: lines.join("\n"),
    next,
    kind: "score.vocoder",
    payload: { trackId, vocoder },
    trackId,
  };
}
