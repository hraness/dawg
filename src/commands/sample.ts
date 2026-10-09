/**
 * `/sample <path> [as <voice>]` and `/sample`: add a sample voice to the
 * focused track, or list its voices. The score edit is pure
 * (`addSampleVoice`); the window copies the file into the project
 * (`placeSampleFile`) and commits, and project sync reprints track.ts.
 */
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  SAMPLER_INSTRUMENT,
  SCORE_LIMITS,
  TrackScore,
  addTrack,
  isSamplerInstrument,
  normalizeSampleRef,
  samplerVoiceSlots,
  type Sampler,
  type SampleRef,
  type Track,
} from "../../core/score.ts";
import { trackDirectories } from "../../core/sdk/print.ts";

export type SampleCommand =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "add"; path: string; voice?: string }>
  | Readonly<{
      kind: "set";
      voice: string;
      values: Readonly<Record<string, SampleControlValue>>;
    }>;

/** A sample control value: a number, a switch, a unit, or null to unset. */
export type SampleControlValue = number | string | boolean | null;

/**
 * Per-voice sample controls `/sample set` and `set_sample` change, by
 * Strudel name. Aliases resolve to the stored field.
 */
export const SAMPLE_CONTROLS = Object.freeze({
  begin: "fraction 0..1 of the file where playback starts",
  end: "fraction 0..1 where it stops",
  gain: "linear 0..2",
  speed: "rate (negative reverses); with unit c/s a duration",
  unit: "r (rate), c (speed in cycles = bars), s (speed in seconds)",
  loop: "on/off: sustain by looping",
  loopBegin: "fraction where the loop starts (≥ begin); alias loopb",
  loopEnd: "fraction where the loop ends (≤ end); alias loope",
  clip: "voice lasts note length × clip, cutting the sample; alias legato",
  fit: "on/off: the window lasts the note's length",
  loopAt: "the window lasts n bars (sets speed 1/n, unit c)",
  accelerate: "rate ramps by this × over the voice (−8..8)",
  squiz: "pitch-raise ratio per zero-crossing cycle (1..32)",
  cut: "choke group name: a new hit stops the previous one",
  bpm: "the sample's own tempo: it follows the song's tempo map",
  fitmode: "how a fitted sample changes time: repitch, beats or tones",
  len: "the window lasts n beats of the song's tempo map",
  shift: "pitch in semitones (−24..24), length unchanged",
  formant: "formants in semitones with shift: 0 keeps the voice, off follows",
  fadeTime: "release fade in seconds (0..2); alias fadeout",
  fadeInTime: "attack fade in seconds (0..2); alias fadein",
});
export type SampleControl = keyof typeof SAMPLE_CONTROLS;

const SAMPLE_ALIASES: Readonly<Record<string, string>> = {
  loopb: "loopBegin",
  loope: "loopEnd",
  legato: "clip",
  choke: "cut",
  fadeout: "fadeTime",
  fadein: "fadeInTime",
};

function controlName(raw: string): SampleControl | undefined {
  const lower = raw.toLowerCase();
  const name =
    Object.keys(SAMPLE_CONTROLS).find((key) => key.toLowerCase() === lower) ??
    SAMPLE_ALIASES[lower];
  return name as SampleControl | undefined;
}

/** `/sample`, `/sample <path>`, `/sample <path> as <voice>`, `/sample set <voice> <control> <value>…`; else undefined. */
export function parseSampleCommand(command: string): SampleCommand | undefined {
  const match = command.trim().match(/^\/samples?(?:\s+(.+?))?\s*$/i);
  if (!match) return undefined;
  const rest = match[1];
  if (!rest) return { kind: "list" };
  const set = rest.match(/^set\s+([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/i);
  if (set) {
    const tokens = set[2]!.split(/\s+/);
    const values: Record<string, SampleControlValue> = {};
    for (let i = 0; i < tokens.length; i += 2)
      values[tokens[i]!] = parseControlToken(tokens[i + 1]);
    return { kind: "set", voice: set[1]!, values };
  }
  const named = rest.match(/^(.+?)\s+as\s+(\S+)$/i);
  const path = unquote((named ? named[1]! : rest).trim());
  return named
    ? { kind: "add", path, voice: named[2]! }
    : { kind: "add", path };
}

function parseControlToken(token: string | undefined): SampleControlValue {
  if (token === undefined) return "";
  const lower = token.toLowerCase();
  if (lower === "on" || lower === "true") return true;
  if (lower === "off" || lower === "false") return false;
  if (lower === "none" || lower === "unset" || lower === "default") return null;
  const value = Number(token);
  return token.trim() !== "" && Number.isFinite(value) ? value : token;
}

export type SetSampleResult =
  | Readonly<{ ok: true; next: TrackScore; message: string }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Set or unset (`null`, or `off` for numbers) per-voice sample controls on
 * `trackId`'s voice. Validation is the score's: limits and window rules.
 */
export function setSampleControls(
  score: TrackScore,
  trackId: string,
  voice: string,
  values: Readonly<Record<string, SampleControlValue>>,
): SetSampleResult {
  const track = score.tracks.find((item) => item.id === trackId);
  const sampler = track?.sampler;
  if (!track || !sampler || !isSamplerInstrument(track.instrument))
    return {
      ok: false,
      message: `sample · ${trackId} is not a sampler track · /sample <path> first`,
    };
  const ref = sampler.voices[voice];
  if (!ref)
    return {
      ok: false,
      message: `sample · ${trackId} has no voice "${voice}" · /sample lists them`,
    };
  const keys = Object.keys(values);
  if (keys.length === 0)
    return {
      ok: false,
      message: `sample · set needs a control · ${Object.keys(SAMPLE_CONTROLS).join(" ")}`,
    };
  const next: Record<string, unknown> = { ...ref };
  const changed: string[] = [];
  for (const raw of keys) {
    const name = controlName(raw);
    if (!name)
      return {
        ok: false,
        message: `sample · unknown control "${raw.slice(0, 40)}" · ${Object.keys(SAMPLE_CONTROLS).join(" ")}`,
      };
    let value: SampleControlValue = values[raw] ?? null;
    if (value === "")
      return { ok: false, message: `sample · ${raw} needs a value` };
    const field = name === "cut" ? "choke" : name;
    // `off` unsets a control (back to its default): numbers, switches, cut.
    if (value === false && name !== "unit") value = null;
    if (name === "loopAt") {
      if (value === null) {
        delete next.speed;
        delete next.unit;
      } else if (typeof value !== "number" || value <= 0)
        return {
          ok: false,
          message: "sample · loopAt needs a positive number of bars",
        };
      else {
        next.speed = 1 / value;
        next.unit = "c";
      }
      changed.push(value === null ? "loopAt off" : `loopAt ${value}`);
      continue;
    }
    if (name === "cut" && typeof value === "number") value = `cut${value}`;
    if (value === null) delete next[field];
    else next[field] = value;
    changed.push(`${raw} ${value === null ? "off" : String(value)}`);
  }
  let updated: TrackScore;
  try {
    const voices = {
      ...sampler.voices,
      [voice]: normalizeSampleRef(next, voice),
    };
    updated = new TrackScore({
      ...score.toJSON(),
      tracks: score.tracks.map((item) =>
        item.id === trackId
          ? { ...item, sampler: { ...sampler, voices } }
          : item,
      ),
    });
  } catch (error) {
    return {
      ok: false,
      message: `sample · ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    ok: true,
    next: updated,
    message: `sample · ${trackId}/${voice} · ${changed.join(" · ")}`,
  };
}

function unquote(value: string): string {
  const quoted = value.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2]! : value;
}

const VOICE = /^[a-z][a-z0-9_]{0,31}$/;

/** A voice name from a file name: `Kick 01.wav` → `kick_01`. */
export function voiceNameFrom(path: string): string {
  const stem = basename(path, extname(path))
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 32);
  return stem || "sample";
}

/** Lines for `/sample` with no args: one per voice, in slot order. */
export function listSampleVoices(track: Track | undefined): string[] {
  const sampler = track?.sampler;
  if (!track || !isSamplerInstrument(track.instrument) || !sampler) return [];
  const slots = samplerVoiceSlots(sampler);
  return Object.keys(sampler.voices)
    .sort((a, b) => (slots.get(a) ?? 0) - (slots.get(b) ?? 0) || cmp(a, b))
    .map((voice) => {
      const ref = sampler.voices[voice]!;
      const slot = slots.get(voice);
      const where =
        slot === undefined ? `root ${ref.root ?? 60}` : `slot ${slot}`;
      return `${voice} · ${ref.src} · ${where}`;
    });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type AddVoiceResult =
  | Readonly<{
      ok: true;
      next: TrackScore;
      /** Track that received the voice (new when the focus was not a sampler). */
      trackId: string;
      voice: string;
      message: string;
    }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Where a voice lands: the focused track when it is a sampler or an empty
 * track (converted), otherwise a new `samples` track so existing notes keep
 * their instrument.
 */
export function samplerTarget(score: TrackScore, focusedId: string): string {
  const focused = score.tracks.find((track) => track.id === focusedId);
  if (focused && isSamplerInstrument(focused.instrument)) return focused.id;
  const empty = !score.notes.some((note) => note.trackId === focusedId);
  if (!focused || empty) return focusedId;
  let id = "samples";
  for (let n = 2; score.tracks.some((track) => track.id === id); n += 1)
    id = `samples-${n}`;
  return id;
}

/**
 * Add `voice` → `ref` to `trackId`, creating or converting it to a oneshot
 * sampler. One-shot hits are addressed by slot (36 + voice-name order), so
 * existing hits are re-pitched to keep playing the same voice when a new
 * name sorts before them.
 */
export function addSampleVoice(
  score: TrackScore,
  trackId: string,
  voice: string,
  ref: SampleRef,
): AddVoiceResult {
  if (!VOICE.test(voice))
    return {
      ok: false,
      message: `sample · voice "${voice.slice(0, 40)}" is not a valid name · use a-z, 0-9 and _, starting with a letter (/sample <path> as kick)`,
    };
  const existing = score.tracks.find((track) => track.id === trackId);
  const previous =
    existing && isSamplerInstrument(existing.instrument)
      ? existing.sampler
      : undefined;
  if (previous && voice in previous.voices)
    return {
      ok: false,
      message: `sample · ${trackId} already has a voice "${voice}" · pick another name with as <voice>`,
    };
  const count = Object.keys(previous?.voices ?? {}).length;
  if (count >= SCORE_LIMITS.maxSamplerVoices)
    return {
      ok: false,
      message: `sample · ${trackId} has ${count} voices, the limit · remove one in track.ts first`,
    };
  const sampler: Sampler = {
    mode: previous?.mode ?? "oneshot",
    voices: { ...(previous?.voices ?? {}), [voice]: ref },
  };
  let next: TrackScore;
  try {
    if (!existing)
      next = addTrack(score, {
        id: trackId,
        name: trackId,
        instrument: SAMPLER_INSTRUMENT,
        sampler,
      });
    else {
      const json = score.toJSON();
      const oldSlots = previous ? samplerVoiceSlots(previous) : new Map();
      const newSlots = samplerVoiceSlots(sampler);
      const remap = new Map<number, number>();
      for (const [name, slot] of oldSlots) {
        const moved = newSlots.get(name);
        if (moved !== undefined && moved !== slot) remap.set(slot, moved);
      }
      next = new TrackScore({
        ...json,
        tracks: score.tracks.map((track) =>
          track.id === trackId
            ? { ...track, instrument: SAMPLER_INSTRUMENT, sampler }
            : track,
        ),
        notes: score.notes.map((note) =>
          note.trackId === trackId && remap.has(note.pitch)
            ? { ...note, pitch: remap.get(note.pitch)! }
            : note,
        ),
      });
    }
  } catch (error) {
    return {
      ok: false,
      message: `sample · ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const slot = samplerVoiceSlots(sampler).get(voice);
  return {
    ok: true,
    next,
    trackId,
    voice,
    message: `sample · ${voice} on ${trackId}${slot === undefined ? "" : ` · slot ${slot}`} · ${Object.keys(sampler.voices).length} voice${Object.keys(sampler.voices).length === 1 ? "" : "s"}`,
  };
}

/** First free voice name based on `base` (`kick`, `kick_2`, …). */
export function freeVoiceName(
  score: TrackScore,
  trackId: string,
  base: string,
): string {
  const voices =
    score.tracks.find((track) => track.id === trackId)?.sampler?.voices ?? {};
  if (!(base in voices)) return base;
  for (let n = 2; ; n += 1) {
    const name = `${base.slice(0, 29)}_${n}`;
    if (!(name in voices)) return name;
  }
}

export class SamplePlacementError extends Error {}

/**
 * Make `input` (relative to `cwd`) available to `trackId` and return its
 * `src`, relative to the track directory. A file already under the track's
 * directory is referenced in place; anything else is copied to
 * `tracks/<slug>/samples/<voice><ext>`. Enforces the sample size limit.
 */
export async function placeSampleFile(
  options: Readonly<{
    projectRoot: string;
    cwd: string;
    input: string;
    score: TrackScore;
    trackId: string;
    voice: string;
  }>,
): Promise<Readonly<{ src: string; sha256: string; copied: boolean }>> {
  let real: string;
  try {
    real = await realpath(resolve(options.cwd, options.input));
  } catch {
    throw new SamplePlacementError(`${options.input}: no such file`);
  }
  const info = await stat(real);
  if (!info.isFile())
    throw new SamplePlacementError(`${options.input} is not a file`);
  if (info.size > SCORE_LIMITS.maxSampleFileBytes)
    throw new SamplePlacementError(
      `${options.input} is ${Math.ceil(info.size / 1048576)} MiB, over the ${SCORE_LIMITS.maxSampleFileBytes / 1048576} MiB sample limit`,
    );
  const root = await realpath(options.projectRoot);
  // The track directory is decided by the score that will hold the voice.
  const withTrack = options.score.tracks.some((t) => t.id === options.trackId)
    ? options.score
    : addTrack(options.score, { id: options.trackId, name: options.trackId });
  const slug =
    trackDirectories(withTrack).get(options.trackId) ?? options.trackId;
  const trackDir = join(root, "tracks", slug);
  const sha256 = createHash("sha256")
    .update(await readFile(real))
    .digest("hex");
  const inTrack = relative(trackDir, real);
  if (
    inTrack &&
    !inTrack.startsWith("..") &&
    !inTrack.startsWith(sep) &&
    !inTrack.includes(`..${sep}`)
  )
    return { src: inTrack.split(sep).join("/"), sha256, copied: false };
  const ext =
    extname(real)
      .toLowerCase()
      .match(/^\.[a-z0-9]{1,8}$/)?.[0] ?? ".wav";
  const dir = join(trackDir, "samples");
  await mkdir(dir, { recursive: true });
  // The samples directory must still be inside the project after links.
  const realDir = await realpath(dir);
  const back = relative(root, realDir);
  if (back.startsWith("..") || resolve(root, back) !== realDir)
    throw new SamplePlacementError(
      `tracks/${slug}/samples resolves outside the project`,
    );
  let name = `${options.voice}${ext}`;
  for (let n = 2; await exists(join(realDir, name)); n += 1) {
    if ((await sha256Of(join(realDir, name))) === sha256) break;
    name = `${options.voice}_${n}${ext}`;
  }
  const target = join(realDir, name);
  if (!(await exists(target))) {
    const temporary = `${target}.${process.pid}.tmp`;
    await copyFile(real, temporary);
    await rename(temporary, target);
  }
  return { src: `samples/${name}`, sha256, copied: true };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256Of(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
