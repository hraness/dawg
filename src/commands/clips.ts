/**
 * Audio clip and lyric commands (0.7 clips lane): `/vocal import|stem|
 * setups`, `/clip` and `/lyrics`. Commands take 1-based bars (`5.3` is bar
 * 5 beat 3) and dB; the score stores ticks and linear gain (sources.md 4).
 */
import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  assignLyrics,
  CLIP_GAIN_MAX_DB,
  CLIP_GAIN_MIN_DB,
  clipGainDb,
  clipLength,
  clipSongTick,
  dbToClipGain,
  importGain,
  nextClipId,
  repeatClip,
  splitClip,
  vocalChainPatch,
} from "../../core/clips.ts";
import {
  SCORE_LIMITS,
  setClips,
  updateNote,
  updateTrack,
  type AudioClip,
  type Note,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { trackSlug } from "../../core/slug.ts";
import { barStartTick } from "../../core/tempo.ts";
import { importSample } from "../media/import.ts";
import {
  ensureDir,
  projectPath,
  resolveInput,
  samplesDir,
} from "../media/paths.ts";
import type { MediaRunContext } from "../media/types.ts";
import { parseWav } from "../media/vendor/wav.ts";
import type { VocalContext, VocalResult, VocalVerb } from "./vocal.ts";

// ---------------------------------------------------------------------------
// Bars

/** Tick for a 1-based bar like `9` or `5.3` (bar 5, beat 3). */
export function userBarTick(score: TrackScore, text: string): number {
  const match = text.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`"${text}" is not a bar (try 9 or 5.3)`);
  const bar = Number(match[1]);
  const beat = match[2] === undefined ? 1 : Number(match[2]);
  if (bar < 1) throw new Error("bars start at 1");
  if (beat < 1 || beat > score.beatsPerBar)
    throw new Error(`beat ${beat} is outside a ${score.beatsPerBar}-beat bar`);
  return barStartTick(score, bar - 1) + (beat - 1) * score.ticksPerBeat;
}

/** `5` or `5.3` for a tick (inverse of `userBarTick` on whole beats). */
export function userBarLabel(score: TrackScore, tick: number): string {
  let bar = 0;
  while (barStartTick(score, bar + 1) <= tick && bar < 100_000) bar += 1;
  const beat = Math.floor(
    (tick - barStartTick(score, bar)) / score.ticksPerBeat,
  );
  return beat === 0 ? `${bar + 1}` : `${bar + 1}.${beat + 1}`;
}

// ---------------------------------------------------------------------------
// Audio files

/** Seconds and peak (linear) of a project wav, or undefined when unreadable. */
export async function wavInfo(
  path: string,
): Promise<{ seconds: number; peak: number } | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > SCORE_LIMITS.maxSampleFileBytes)
      return undefined;
    const wav = parseWav(new Uint8Array(await readFile(path)), {
      maximumBytes: SCORE_LIMITS.maxSampleFileBytes,
      maximumDurationSeconds: SCORE_LIMITS.maxClipSeconds + 1,
      maximumChannels: 2,
    });
    let peak = 0;
    for (let frame = 0; frame < wav.sampleCount; frame += 1)
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const value = Math.abs(wav.sample(frame, channel));
        if (value > peak) peak = value;
      }
    return { seconds: wav.sampleCount / wav.sampleRate, peak };
  } catch {
    return undefined;
  }
}

/** Track or create the clip track a verb acts on. */
function focusedTrack(score: TrackScore, trackId: string): Track {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("no track is focused; /track vocal makes one");
  return track;
}

/** Score and track with a new clip placed; vocal tracks keep their chain. */
export function placeClip(
  score: TrackScore,
  trackId: string,
  clip: Omit<AudioClip, "id"> & { id?: string },
): { score: TrackScore; clip: AudioClip } {
  const track = focusedTrack(score, trackId);
  const clips = track.clips ?? [];
  if (clips.length >= SCORE_LIMITS.maxClipsPerTrack)
    throw new Error(
      `${track.name} already has ${SCORE_LIMITS.maxClipsPerTrack} clips`,
    );
  const base = clip.id ?? trackSlug(basename(clip.src, extname(clip.src)));
  const placed: AudioClip = { ...clip, id: nextClipId(track, base || "clip") };
  return { score: setClips(score, trackId, [...clips, placed]), clip: placed };
}

export type ImportDeps = Readonly<{
  /** Media services (runner, env); absent in tests that stub `importFile`. */
  media?: Omit<MediaRunContext, "projectRoot" | "trackSlug">;
  /** Copies `file` into tracks/<slug>/samples/<name>.wav (48 kHz mono s16). */
  importFile?: (
    file: string,
    name: string,
    context: VocalContext,
    slug: string,
  ) => Promise<{ src: string; sha256: string }>;
}>;

let importDeps: ImportDeps = {};
/** Main wires the media runner here once; tests inject a stub. */
export function setClipImportDeps(deps: ImportDeps): void {
  importDeps = deps;
}

/**
 * Copy `file` into tracks/<slug>/samples/<name>.wav when it is already a
 * 48 kHz mono 16-bit PCM WAV; undefined when it needs converting.
 */
export async function copyReadyWav(
  file: string,
  name: string,
  cwd: string,
  slug: string,
): Promise<{ src: string; sha256: string } | undefined> {
  const host = { projectRoot: cwd, trackSlug: slug };
  let input;
  try {
    input = await resolveInput(host, file);
  } catch {
    return undefined;
  }
  if (!/\.wav$/i.test(input.absolute)) return undefined;
  if (input.size > SCORE_LIMITS.maxSampleFileBytes) return undefined;
  const bytes = new Uint8Array(await readFile(input.absolute));
  try {
    const wav = parseWav(bytes, {
      maximumBytes: SCORE_LIMITS.maxSampleFileBytes,
      maximumDurationSeconds: SCORE_LIMITS.maxClipSeconds + 1,
      maximumChannels: 2,
    });
    if (
      wav.sampleRate !== 48_000 ||
      wav.channels !== 1 ||
      wav.encoding !== "pcm16"
    )
      return undefined;
  } catch {
    return undefined;
  }
  const dir = await ensureDir(samplesDir(host));
  const target = join(dir, `${name}.wav`);
  const temp = `${target}.part.wav`;
  await writeFile(temp, bytes);
  await rename(temp, target);
  return {
    src: projectPath(cwd, target),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function importIntoProject(
  file: string,
  name: string,
  context: VocalContext,
  slug: string,
): Promise<{ src: string; sha256: string }> {
  if (importDeps.importFile)
    return importDeps.importFile(file, name, context, slug);
  // A WAV already in the project format (48 kHz mono 16-bit PCM) is copied
  // byte for byte: no ffmpeg needed.
  const ready = await copyReadyWav(file, name, context.cwd, slug);
  if (ready) return ready;
  if (!importDeps.media) throw new Error("audio import is not available here");
  const result = await importSample(
    { file, name, channels: 1 },
    { ...importDeps.media, projectRoot: context.cwd, trackSlug: slug },
  );
  const sample = result.content.sample as { path: string; sha256: string };
  return { src: sample.path, sha256: sample.sha256 };
}

/** `/vocal import <file> [at] [bar]`: copy, pin and place at a bar. */
export async function importClip(
  file: string,
  bar: string | undefined,
  context: VocalContext,
  label = "import",
): Promise<VocalResult> {
  const track = focusedTrack(context.score, context.trackId);
  const slug = trackSlug(track.name);
  const name = trackSlug(basename(file, extname(file))).slice(0, 48) || "vocal";
  const startTick = bar ? userBarTick(context.score, bar) : 0;
  const copied = await importIntoProject(file, name, context, slug);
  const info = await wavInfo(join(context.cwd, copied.src));
  const gain = info ? importGain(info.peak) : undefined;
  const { score, clip } = placeClip(context.score, context.trackId, {
    id: name,
    src: copied.src,
    sha256: copied.sha256,
    startTick,
    ...(gain !== undefined ? { gain } : {}),
  });
  const seconds = info ? ` · ${info.seconds.toFixed(1)} s` : "";
  const db =
    gain !== undefined
      ? ` · gain ${formatDb(clipGainDb(gain))} (peak -6 dBFS)`
      : "";
  return {
    ok: true,
    message: `vocal ${label}: ${clip.id} at bar ${userBarLabel(score, startTick)} on ${track.name}${seconds}${db} · /clip to edit`,
    next: score,
    kind: "clip.place",
    payload: { clipId: clip.id, src: clip.src },
  };
}

/** The newest `vocals.wav` under `downloads/**.stems/` in the project. */
export async function latestVocalStem(
  cwd: string,
): Promise<string | undefined> {
  let best: { path: string; at: number } | undefined;
  const tracks = join(cwd, "tracks");
  let slugs: string[] = [];
  try {
    slugs = await readdir(tracks);
  } catch {
    return undefined;
  }
  for (const slug of slugs) {
    const downloads = join(tracks, slug, "downloads");
    let entries: string[] = [];
    try {
      entries = await readdir(downloads);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".stems")) continue;
      const path = join(downloads, entry, "vocals.wav");
      try {
        const info = await stat(path);
        if (!best || info.mtimeMs > best.at)
          best = {
            path: `tracks/${slug}/downloads/${entry}/vocals.wav`,
            at: info.mtimeMs,
          };
      } catch {
        continue;
      }
    }
  }
  return best?.path;
}

// ---------------------------------------------------------------------------
// Setups (VOCAL_SOURCES, sources.md 5)

export type VocalSetup = Readonly<{
  name: string;
  summary: string;
  /** Fields the setup sets beyond the vocal chain. */
  patch?: Readonly<Partial<Pick<Track, "delay" | "fx">>>;
  /** Other lanes' fields it would set; reported when absent here. */
  needs?: readonly string[];
}>;

export const VOCAL_SETUPS: readonly VocalSetup[] = [
  {
    name: "hyper",
    summary: "hard-tuned hyperpop lead: formant up, slapback, light distortion",
    patch: {
      delay: { beats: 0.125, feedback: 0.1, mix: 0.18 },
      fx: {
        formant: { shift: 3.5 } as never,
        distort: { drive: 1, tone: 6000, mix: 0.25 } as never,
      },
    },
    needs: ["autotune", "harmony", "record"],
  },
  { name: "take", summary: "a lead with plate reverb", needs: ["record"] },
  { name: "stack", summary: "three passes panned wide", needs: ["record"] },
  { name: "import", summary: "place a vocal file at a bar (/vocal import)" },
  { name: "stem", summary: "place the vocals stem (/vocal stem)" },
  { name: "robot", summary: "TTS sung on the notes", needs: ["say"] },
  {
    name: "android",
    summary: "TTS sung, formant up",
    patch: { fx: { formant: { shift: 3.5 } as never } },
    needs: ["say"],
  },
  { name: "whisper", summary: "whisper voice, reverse swells", needs: ["say"] },
  {
    name: "choir",
    summary: "TTS across four voices",
    needs: ["say", "harmony"],
  },
  {
    name: "speech",
    summary: "TTS on the grid, /clip repeat for loops",
    needs: ["say"],
  },
];

/** Whether this build's Track carries `field` (a later lane's field). */
export type FieldProbe = (field: string) => boolean;

const knownTrackFields = new Set<string>(["harmony", "record", "say"]);
/** Lanes register the fields they add so setups can use them. */
export function registerVocalSetupField(field: string): void {
  knownTrackFields.add(`+${field}`);
}
const fieldPresent: FieldProbe = (field) => knownTrackFields.has(`+${field}`);

/** Apply a setup's chain to the focused track; report what this build lacks. */
export function applyVocalSetup(
  score: TrackScore,
  trackId: string,
  name: string,
  present: FieldProbe = fieldPresent,
): VocalResult {
  const setup = VOCAL_SETUPS.find(
    (s) => s.name === name || (name === "auto" && s.name === "hyper"),
  );
  if (!setup)
    return {
      ok: false,
      message: `vocal setups: no setup ${name} · ${VOCAL_SETUPS.map((s) => s.name).join(", ")}`,
    };
  const track = focusedTrack(score, trackId);
  const chain = vocalChainPatch(track);
  const fx = { ...(chain.fx ?? track.fx ?? {}), ...(setup.patch?.fx ?? {}) };
  const patch = {
    instrument: "vocal",
    ...chain,
    ...(setup.patch?.delay ? { delay: setup.patch.delay } : {}),
    ...(setup.patch?.fx ? { fx } : {}),
  };
  const next = updateTrack(score, trackId, patch as never);
  const missing = (setup.needs ?? []).filter((field) => !present(field));
  const lacks = missing.length
    ? ` · not in this build yet: ${missing.join(", ")}`
    : "";
  return {
    ok: true,
    message: `vocal ${setup.name}: ${track.name} set up (${setup.summary})${lacks}`,
    next,
    kind: "vocal.setup",
    payload: { setup: setup.name },
  };
}

// ---------------------------------------------------------------------------
// /vocal verbs

export const CLIP_VOCAL_VERBS: readonly VocalVerb[] = [
  {
    verb: "import",
    usage: "import <file> [at] [bar]",
    summary: "copy an audio file into the track (48 kHz mono) and place it",
    lane: "clips",
    run: async (args, context) => {
      const match = args.match(/^(.+?)(?:\s+(?:at\s+)?(\d+(?:\.\d+)?))?$/i);
      const file = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (!file)
        return { ok: false, message: "usage: /vocal import <file> [at <bar>]" };
      return importClip(file, match?.[2], context);
    },
  },
  {
    verb: "stem",
    usage: "stem [at] [bar]",
    summary: "place the vocals stem from the last split_stems",
    lane: "clips",
    run: async (args, context) => {
      const bar = args.replace(/^at\s+/i, "").trim() || undefined;
      const stem = await latestVocalStem(context.cwd);
      if (!stem)
        return {
          ok: false,
          message:
            "vocal stem: no vocals stem yet · download a song and run split_stems first",
        };
      return importClip(stem, bar, context, "stem");
    },
  },
  {
    verb: "setups",
    usage: "setups [name]",
    summary: "list or apply a vocal setup (hyper, take, stack, ...)",
    lane: "clips",
    run: async (args, context) => {
      const name = args.trim().toLowerCase();
      if (!name)
        return {
          ok: true,
          message: [
            "vocal setups:",
            ...VOCAL_SETUPS.map(
              (s) =>
                `  ${s.name.padEnd(8)} ${s.summary}${
                  s.needs?.some((f) => !fieldPresent(f))
                    ? ` (needs ${s.needs.filter((f) => !fieldPresent(f)).join(", ")})`
                    : ""
                }`,
            ),
          ].join("\n"),
        };
      return applyVocalSetup(context.score, context.trackId, name);
    },
  },
];

// ---------------------------------------------------------------------------
// /clip

export type ClipEdit =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "gain"; db: number; relative: boolean }>
  | Readonly<{ kind: "fade"; in?: number | null; out?: number | null }>
  | Readonly<{ kind: "move"; bar: string }>
  | Readonly<{ kind: "split"; bar: string }>
  | Readonly<{ kind: "rev" }>
  | Readonly<{ kind: "mute" }>
  | Readonly<{ kind: "rm" }>
  | Readonly<{ kind: "trim"; offset?: number; dur?: number | null }>
  | Readonly<{ kind: "repeat"; every: number; until: string }>;

export type ClipCommand = Readonly<{ clipId?: string; edit: ClipEdit }>;

const CLIP_USAGE =
  "/clip [id] gain -3 | gain by -3 | fade .01 .2 | fade in .01 | fade out default | move 9 | split 7 | trim [offset s] [dur s|end] | rev | repeat every 2 to 32 | mute | rm";

/** Parse `/clip ...`; undefined when it is not a /clip command. */
export function parseClipCommand(
  command: string,
): ClipCommand | { error: string } | undefined {
  const match = command.trim().match(/^\/clip(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const words = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { edit: { kind: "list" } };
  const verbs = new Set([
    "gain",
    "fade",
    "move",
    "split",
    "rev",
    "mute",
    "rm",
    "trim",
    "repeat",
  ]);
  let clipId: string | undefined;
  if (!verbs.has(words[0]!.toLowerCase())) clipId = words.shift();
  const verb = words.shift()?.toLowerCase();
  const num = (text: string | undefined) => {
    const value = Number(text);
    return text !== undefined && Number.isFinite(value) ? value : undefined;
  };
  const bad = { error: `usage: ${CLIP_USAGE}` };
  switch (verb) {
    case undefined:
      return { clipId, edit: { kind: "list" } };
    case "gain": {
      // `gain by -3` nudges; `gain -3` sets.
      const relative = words[0]?.toLowerCase() === "by";
      const text = relative ? words[1] : words[0];
      const db = num(text?.replace(/db$/i, ""));
      if (db === undefined) return bad;
      return { clipId, edit: { kind: "gain", db, relative } };
    }
    case "fade": {
      // `fade in <s>` / `fade out <s>` edit one side (`default` drops the
      // field); `fade <in> [out]` sets both.
      const side = words[0]?.toLowerCase();
      if (side === "in" || side === "out") {
        const text = words[1]?.toLowerCase().replace(/s$/, "");
        const value = text === "default" ? null : num(text);
        if (value === undefined) return bad;
        return {
          clipId,
          edit:
            side === "in"
              ? { kind: "fade", in: value }
              : { kind: "fade", out: value },
        };
      }
      const fadeIn = num(words[0]);
      const fadeOut = num(words[1] ?? words[0]);
      if (fadeIn === undefined) return bad;
      return { clipId, edit: { kind: "fade", in: fadeIn, out: fadeOut } };
    }
    case "move":
    case "split":
      if (!words[0]) return bad;
      return { clipId, edit: { kind: verb, bar: words[0] } };
    case "rev":
    case "mute":
    case "rm":
      return { clipId, edit: { kind: verb } };
    case "trim": {
      const edit: { kind: "trim"; offset?: number; dur?: number | null } = {
        kind: "trim",
      };
      for (let i = 0; i < words.length; i += 2) {
        const key = words[i]?.toLowerCase();
        // `dur end` plays to the end of the file (drops dur).
        if (key === "dur" && words[i + 1]?.toLowerCase() === "end") {
          edit.dur = null;
          continue;
        }
        const value = num(words[i + 1]?.replace(/s$/, ""));
        if (value === undefined || (key !== "offset" && key !== "dur"))
          return bad;
        edit[key] = value;
      }
      return { clipId, edit };
    }
    case "repeat": {
      const every = num(words[words.indexOf("every") + 1]);
      const toAt = words.indexOf("to");
      const until = toAt >= 0 ? words[toAt + 1] : undefined;
      if (
        words.indexOf("every") < 0 ||
        every === undefined ||
        !(every > 0) ||
        !until
      )
        return bad;
      return { clipId, edit: { kind: "repeat", every, until } };
    }
    default:
      return bad;
  }
}

function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "-inf dB";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

/** One line per clip for `/clip` and the menu. */
export function clipLines(score: TrackScore, track: Track): string[] {
  const clips = track.clips ?? [];
  if (clips.length === 0)
    return [`${track.name} has no clips · /vocal import <file> [bar]`];
  return clips.map((clip) => {
    const flags = [
      clip.gain !== undefined ? formatDb(clipGainDb(clip.gain)) : "",
      clip.rev ? "rev" : "",
      clip.mute ? "muted" : "",
      clip.take ? `take ${clip.take}` : "",
      clip.dur !== undefined ? `${clip.dur.toFixed(2)} s` : "",
    ].filter(Boolean);
    return `  ${clip.id.padEnd(12)} bar ${userBarLabel(score, clip.startTick).padEnd(6)} ${basename(clip.src)}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
  });
}

/** Pick the clip an edit names, else the one sounding at `cursorTick`, else the last. */
function pickClip(
  track: Track,
  id: string | undefined,
  cursorTick?: number,
): AudioClip {
  const clips = track.clips ?? [];
  if (clips.length === 0)
    throw new Error(`${track.name} has no clips · /vocal import <file> [bar]`);
  if (id !== undefined) {
    const clip = clips.find((c) => c.id === id);
    if (!clip)
      throw new Error(`no clip ${id} · ${clips.map((c) => c.id).join(", ")}`);
    return clip;
  }
  if (cursorTick !== undefined) {
    const before = clips.filter((c) => c.startTick <= cursorTick);
    if (before.length > 0) return before.at(-1)!;
  }
  return clips.at(-1)!;
}

/** Apply a `/clip` edit. Never throws: failures come back as text. */
export async function runClipCommand(
  command: ClipCommand,
  context: VocalContext & Readonly<{ cursorTick?: number }>,
): Promise<VocalResult> {
  try {
    const { score } = context;
    const track = focusedTrack(score, context.trackId);
    const { edit } = command;
    if (edit.kind === "list")
      return {
        ok: true,
        message: [`clips on ${track.name}:`, ...clipLines(score, track)].join(
          "\n",
        ),
      };
    const clip = pickClip(track, command.clipId, context.cursorTick);
    const clips = track.clips!;
    const replace = (
      next: readonly AudioClip[],
      what: string,
      kind = "clip.edit",
    ): VocalResult => ({
      ok: true,
      message: `clip ${clip.id}: ${what}`,
      next: setClips(score, track.id, next.length > 0 ? next : null),
      kind,
      payload: { clipId: clip.id },
    });
    const swap = (patch: Partial<AudioClip>, drop: (keyof AudioClip)[] = []) =>
      clips.map((c) => {
        if (c !== clip) return c;
        const out: Record<string, unknown> = { ...c, ...patch };
        for (const key of drop) delete out[key];
        return out as AudioClip;
      });
    const fileSeconds = async () =>
      (await wavInfo(join(context.cwd, clip.src)))?.seconds;
    switch (edit.kind) {
      case "gain": {
        const db = edit.relative
          ? clipGainDb(clip.gain ?? 1) + edit.db
          : edit.db;
        const gain = dbToClipGain(
          Math.max(CLIP_GAIN_MIN_DB, Math.min(CLIP_GAIN_MAX_DB, db)),
        );
        return replace(
          Math.abs(gain - 1) < 1e-6
            ? swap({}, ["gain"])
            : swap({ gain: Math.round(gain * 1e4) / 1e4 }),
          `gain ${formatDb(db)}`,
        );
      }
      case "fade": {
        const max = SCORE_LIMITS.maxClipFadeSeconds;
        const clamp = (value: number) => Math.max(0, Math.min(max, value));
        const patch: { fadeInTime?: number; fadeTime?: number } = {};
        const drop: (keyof AudioClip)[] = [];
        if (edit.in === null) drop.push("fadeInTime");
        else if (edit.in !== undefined) patch.fadeInTime = clamp(edit.in);
        if (edit.out === null) drop.push("fadeTime");
        else if (edit.out !== undefined) patch.fadeTime = clamp(edit.out);
        const next = swap(patch, drop);
        const edited = next.find((c) => c.id === clip.id)!;
        const shown = (value: number | undefined) =>
          value === undefined ? "default" : `${value} s`;
        return replace(
          next,
          `fades ${shown(edited.fadeInTime)} in, ${shown(edited.fadeTime)} out (equal-power)`,
        );
      }
      case "move": {
        const startTick = userBarTick(score, edit.bar);
        return replace(swap({ startTick }), `moved to bar ${edit.bar}`);
      }
      case "split": {
        const tick = userBarTick(score, edit.bar);
        const cut = splitClip(score, track, clip, tick, await fileSeconds());
        if (typeof cut === "string")
          return {
            ok: false,
            message: cut.replace("there", `at bar ${edit.bar}`),
          };
        const next = clips.flatMap((c) =>
          c === clip ? [cut.head, cut.tail] : [c],
        );
        return replace(
          next,
          `split at bar ${edit.bar} into ${clip.id} and ${cut.tail.id}`,
        );
      }
      case "trim": {
        const seconds = (await fileSeconds()) ?? SCORE_LIMITS.maxClipSeconds;
        const offset = Math.max(
          0,
          Math.min(seconds, edit.offset ?? clip.offset ?? 0),
        );
        const dur =
          edit.dur === null
            ? undefined
            : edit.dur !== undefined
              ? Math.max(0.001, Math.min(seconds - offset, edit.dur))
              : clip.dur;
        return replace(
          swap(
            {
              ...(offset > 0 ? { offset } : {}),
              ...(dur !== undefined ? { dur } : {}),
            },
            [
              ...(offset > 0 ? [] : (["offset"] as const)),
              ...(dur === undefined ? (["dur"] as const) : []),
            ],
          ),
          `plays ${offset.toFixed(3)} s for ${dur === undefined ? "the rest of the file" : `${dur.toFixed(3)} s`}`,
        );
      }
      case "rev":
        return replace(
          clip.rev ? swap({}, ["rev"]) : swap({ rev: true }),
          clip.rev ? "forwards" : "reversed",
        );
      case "mute":
        return replace(
          clip.mute ? swap({}, ["mute"]) : swap({ mute: true }),
          clip.mute ? "unmuted" : "muted",
        );
      case "rm":
        return replace(
          clips.filter((c) => c !== clip),
          "removed",
          "clip.remove",
        );
      case "repeat": {
        const every = Math.round(
          edit.every * score.beatsPerBar * score.ticksPerBeat,
        );
        const until = userBarTick(score, edit.until);
        const copies = repeatClip(
          clip,
          every,
          until,
          new Set(clips.map((c) => c.id)),
        );
        if (clips.length + copies.length > SCORE_LIMITS.maxClipsPerTrack)
          return {
            ok: false,
            message: `clip ${clip.id}: that is more than ${SCORE_LIMITS.maxClipsPerTrack} clips`,
          };
        return replace(
          [...clips, ...copies],
          `${copies.length} repeat${copies.length === 1 ? "" : "s"} every ${edit.every} bar${edit.every === 1 ? "" : "s"} to bar ${edit.until}`,
        );
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: `clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// /lyrics

export type LyricsCommand =
  | Readonly<{ kind: "show" }>
  | Readonly<{ kind: "clear"; bar?: string }>
  | Readonly<{ kind: "set"; bar?: string; text: string }>;

/** `/lyrics [bar] <text>`, `/lyrics clear [bar]`, bare `/lyrics` shows. */
export function parseLyricsCommand(command: string): LyricsCommand | undefined {
  const match = command.trim().match(/^\/lyrics?(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { kind: "show" };
  const clear = rest.match(/^clear(?:\s+(\d+(?:\.\d+)?))?$/i);
  if (clear) return { kind: "clear", ...(clear[1] ? { bar: clear[1] } : {}) };
  const bar = rest.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (bar)
    return {
      kind: "set",
      bar: bar[1],
      text: bar[2]!.replace(/^["']|["']$/g, ""),
    };
  return { kind: "set", text: rest.replace(/^["']|["']$/g, "") };
}

/** Notes on a track from `fromTick`, in sung order. */
function sungNotes(
  score: TrackScore,
  trackId: string,
  fromTick: number,
): Note[] {
  return score.notes
    .filter((note) => note.trackId === trackId && note.startTick >= fromTick)
    .sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);
}

/** Put lyrics on a track's notes (or clear them). */
export function applyLyrics(
  score: TrackScore,
  trackId: string,
  command: LyricsCommand,
): VocalResult {
  try {
    const track = focusedTrack(score, trackId);
    const from =
      command.kind !== "show" && command.bar
        ? userBarTick(score, command.bar)
        : 0;
    const notes = sungNotes(score, trackId, from);
    if (command.kind === "show") {
      const sung = notes.filter((n) => n.lyric !== undefined);
      return {
        ok: true,
        message: sung.length
          ? `lyrics on ${track.name}: ${sung.map((n) => n.lyric).join(" ")}`
          : `${track.name} has no lyrics · /lyrics sun-lit morn-ing`,
      };
    }
    if (notes.length === 0)
      return {
        ok: false,
        message: `lyrics: ${track.name} has no notes${from ? " from there" : ""} to sing on`,
      };
    let next = score;
    if (command.kind === "clear") {
      for (const note of notes)
        if (note.lyric !== undefined)
          next = updateNote(next, note.id, { lyric: null });
      return {
        ok: true,
        message: `lyrics cleared on ${track.name}`,
        next,
        kind: "lyrics.set",
        payload: {},
      };
    }
    // Chords sing one syllable on their top note.
    const tops = notes.filter(
      (note, index) =>
        index === 0 || note.startTick !== notes[index - 1]!.startTick,
    );
    const { lyrics, dropped, split } = assignLyrics(command.text, tops);
    for (const note of tops) {
      const lyric = lyrics.get(note.id);
      if (lyric !== note.lyric)
        next = updateNote(next, note.id, { lyric: lyric ?? null });
    }
    const shown = tops.map((note) => lyrics.get(note.id) ?? "~").join(" ");
    const extra = dropped.length
      ? ` · ${dropped.length} syllable${dropped.length === 1 ? "" : "s"} left over: ${dropped.join(" ")}`
      : "";
    const auto = split.length ? ` · split ${split.join(", ")}` : "";
    return {
      ok: true,
      message: `lyrics on ${track.name}: ${shown}${auto}${extra}`,
      next,
      kind: "lyrics.set",
      payload: { notes: tops.length },
    };
  } catch (error) {
    return {
      ok: false,
      message: `lyrics: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export { clipLength, clipSongTick };
