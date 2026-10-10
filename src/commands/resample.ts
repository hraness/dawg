/**
 * `resample <track> | orbit <n> | master [section <name> | bars a-b] [post]
 * [grain] [as <id>]` (0.6.1): render a track, an orbit or the mix to
 * `tracks/<slug>/samples/<name>.wav`, pin its sha256, record where it came
 * from (`from`: source, section or bars, the source score's sha256) and add
 * a track that plays it: a one-shot sampler track whose single note starts
 * where the range starts and lasts the range, or with `grain` a granular
 * track (the `cloud` preset) holding one note across the range. The source
 * stays as it is; mute it to hear only the resample.
 */
import { newId } from "../../core/ids.ts";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_ORBIT } from "../../core/fx.ts";
import { GRANULAR_INSTRUMENT } from "../../core/granular.ts";
import {
  ScoreValidationError,
  SCORE_LIMITS,
  TrackScore,
  addTrack,
  type SampleRef,
  requirePinnedRef,
  type TrackInput,
} from "../../core/score.ts";
import { trackDirectories } from "../../core/sdk/print.ts";
import { barTicks } from "../../core/sections.ts";
import {
  RESAMPLE_GAIN,
  renderResample,
  type ResampleRender,
  type ResampleRequest,
} from "../audio/resample.ts";
import type { SampleBank } from "../audio/samples.ts";

export type ResampleCommand = ResampleRequest &
  Readonly<{
    /** Make a granular track instead of a sampler track. */
    grain: boolean;
    /** The new track's id (default `<source>-rs` or `<source>-grain`). */
    as?: string;
  }>;

export const RESAMPLE_USAGE =
  "resample <track>|orbit <n>|master [section <name>|bars a-b] [post] [grain] [as <id>]";

const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** Parse `resample ...` (with or without the slash). */
export function parseResampleCommand(
  command: string,
): ResampleCommand | undefined {
  const words = command.trim().split(/\s+/);
  const head = words[0]?.toLowerCase().replace(/^\//, "");
  if (head !== "resample" && head !== "bounce") return undefined;
  let index = 1;
  const next = () => words[index++];
  const peek = () => words[index]?.toLowerCase();
  let source: ResampleRequest["source"] | undefined;
  const first = next();
  if (first === undefined) return undefined;
  if (first.toLowerCase() === "orbit") {
    const n = Number(next());
    if (!Number.isInteger(n) || n < 1 || n > MAX_ORBIT) return undefined;
    source = { kind: "orbit", orbit: n };
  } else if (first.toLowerCase() === "master" || first.toLowerCase() === "mix")
    source = { kind: "master" };
  else if (first.toLowerCase() === "track") {
    const id = next();
    if (!id) return undefined;
    source = { kind: "track", trackId: id };
  } else source = { kind: "track", trackId: first };
  let range: ResampleRequest["range"] = { kind: "song" };
  let post = false;
  let grain = false;
  let as: string | undefined;
  while (index < words.length) {
    const word = peek();
    index += 1;
    if (word === "section") {
      // A section name runs to the next keyword.
      const parts: string[] = [];
      while (
        index < words.length &&
        !["post", "grain", "granular", "as", "bars"].includes(peek()!)
      )
        parts.push(next()!);
      if (parts.length === 0) return undefined;
      range = { kind: "section", name: parts.join(" ") };
    } else if (word === "bars" || word === "bar") {
      const match = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(next() ?? "");
      if (!match) return undefined;
      const from = Number(match[1]);
      range = { kind: "bars", from, to: Number(match[2] ?? from) };
    } else if (word === "post" || word === "master") post = true;
    else if (word === "pre") post = false;
    else if (word === "grain" || word === "granular") grain = true;
    else if (word === "as") {
      as = next()?.toLowerCase();
      if (!as || !ID.test(as)) return undefined;
    } else return undefined;
  }
  return {
    source,
    range,
    ...(post ? { post } : {}),
    grain,
    ...(as ? { as } : {}),
  };
}

/** A free track id near `base`: `base`, `base-2`, … */
export function freeTrackId(score: TrackScore, base: string): string {
  const stem = base.slice(0, 56);
  const used = new Set(score.tracks.map((track) => track.id));
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n += 1)
    if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

function sourceStem(command: ResampleCommand): string {
  const source = command.source;
  const base =
    source.kind === "track"
      ? source.trackId.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : source.kind === "orbit"
        ? `orbit${source.orbit}`
        : "mix";
  return /^[a-z]/.test(base) ? base : `t${base}`;
}

/** The sample's file name (without extension) from source and range. */
export function resampleFileName(command: ResampleCommand): string {
  const range = command.range;
  const suffix =
    range.kind === "section"
      ? `-${range.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`
      : range.kind === "bars"
        ? `-b${range.from}-${range.to}`
        : "";
  return `${sourceStem(command)}${suffix}`.slice(0, 48) || "resample";
}

/**
 * The score with the new track: a one-shot sampler voice (or a granular
 * source) at `src`, and its one note across the range.
 */
export function addResampleTrack(
  score: TrackScore,
  command: ResampleCommand,
  render: Pick<
    ResampleRender,
    "sha256" | "startTick" | "durationTicks" | "from"
  >,
  trackId: string,
  src: string,
): TrackScore {
  const ref: SampleRef = requirePinnedRef(
    {
      src,
      sha256: render.sha256,
      from: render.from,
      // A bounce starts at full level: no anti-click fade-in.
      ...(command.grain ? {} : { gain: RESAMPLE_GAIN, fadeInTime: 0 }),
    },
    "resample",
  );
  const track: TrackInput = command.grain
    ? {
        id: trackId,
        name: trackId,
        instrument: GRANULAR_INSTRUMENT,
        granular: { src: ref, preset: "cloud" },
      }
    : {
        id: trackId,
        name: trackId,
        instrument: "sampler",
        sampler: {
          mode: "oneshot",
          voices: { [trackId.replace(/-/g, "_").slice(0, 32)]: ref },
        },
      };
  let next = addTrack(score, track as TrackInput);
  // One-shot slot 36 plays the only voice; a granular note at its root (60)
  // plays the source at its own pitch.
  const pitch = command.grain ? 60 : 36;
  const notes = next.notes;
  const ticks = Math.min(render.durationTicks, next.bars * barTicks(next));
  next = new TrackScore({
    ...next.toJSON(),
    notes: [
      ...notes,
      {
        id: newId(trackId),
        trackId,
        startTick: render.startTick,
        durationTicks: Math.max(1, ticks),
        pitch,
        velocity: 1,
      },
    ],
  } as never);
  return next;
}

export type ResampleResult =
  | Readonly<{
      ok: true;
      next: TrackScore;
      trackId: string;
      src: string;
      sha256: string;
      message: string;
    }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Render, write the file under the new track's directory and return the
 * score with the new track. `samples` is the loaded bank of `score`.
 */
export async function runResample(
  options: Readonly<{
    projectRoot: string;
    score: TrackScore;
    command: ResampleCommand;
    samples?: SampleBank;
  }>,
): Promise<ResampleResult> {
  const { score, command } = options;
  if (score.tracks.length >= SCORE_LIMITS.maxTracks)
    return {
      ok: false,
      message: `resample · the song already has ${SCORE_LIMITS.maxTracks} tracks`,
    };
  let render: ResampleRender;
  try {
    render = renderResample(score, command, options.samples);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return {
        ok: false,
        message: `resample · ${error.message} · ${RESAMPLE_USAGE}`,
      };
    throw error;
  }
  const trackId =
    command.as ??
    freeTrackId(
      score,
      `${sourceStem(command)}-${command.grain ? "grain" : "rs"}`,
    );
  if (score.tracks.some((track) => track.id === trackId))
    return { ok: false, message: `resample · track ${trackId} already exists` };
  // The directory follows the score that will hold the track.
  const probe = addTrack(score, { id: trackId, name: trackId });
  const slug = trackDirectories(probe).get(trackId) ?? trackId;
  const root = await realpath(options.projectRoot);
  const dir = join(root, "tracks", slug, "samples");
  await mkdir(dir, { recursive: true });
  const name = `${resampleFileName(command)}.wav`;
  const target = join(dir, name);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, render.wav);
  await rename(temporary, target);
  const src = `samples/${name}`;
  const next = addResampleTrack(score, command, render, trackId, src);
  const what =
    command.source.kind === "track"
      ? command.source.trackId
      : command.source.kind === "orbit"
        ? `orbit ${command.source.orbit}`
        : "the mix";
  return {
    ok: true,
    next,
    trackId,
    src: `tracks/${slug}/${src}`,
    sha256: render.sha256,
    message: `resampled ${what} · ${render.seconds.toFixed(2)} s → tracks/${slug}/${src} · ${render.sha256.slice(0, 12)} · new ${command.grain ? "granular" : "sampler"} track ${trackId}${command.source.kind === "track" ? ` · mute ${command.source.trackId} to hear only the resample` : ""}`,
  };
}
