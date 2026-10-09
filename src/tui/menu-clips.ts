/**
 * Sound > Voice > Clips and Lyrics, and Sound > browse sounds > Voices >
 * Vocal (0.7 clips lane). Every row runs a prompt command (`/clip`,
 * `/lyrics`, `/vocal`), so the menu, the prompt and undo stay one path.
 */
import { basename } from "node:path";
import {
  CLIP_GAIN_MAX_DB,
  CLIP_GAIN_MIN_DB,
  clipGainDb,
  lyricText,
} from "../../core/clips.ts";
import { SCORE_LIMITS, type AudioClip } from "../../core/score.ts";
import { userBarLabel, VOCAL_SETUPS } from "../commands/clips.ts";
import type { MenuContext, MenuNode } from "./menu.ts";

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const dbText = (db: number) =>
  Number.isFinite(db) ? `${db > 0 ? "+" : ""}${round(db, 1)} dB` : "-inf dB";

function clipDetail(context: MenuContext, clip: AudioClip): string {
  return [
    `bar ${userBarLabel(context.score, clip.startTick)}`,
    clip.gain !== undefined ? dbText(clipGainDb(clip.gain)) : "",
    clip.rev ? "rev" : "",
    clip.mute ? "muted" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The rows for one clip: gain, fades, place, rev, mute, repeat, remove. */
function clipRows(context: MenuContext, id: string): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  const clip = track?.clips?.find((c) => c.id === id);
  if (!clip) return [{ kind: "info", label: "clip", value: "removed" }];
  const fadeIn = clip.fadeInTime ?? 0.005;
  const fadeOut = clip.fadeTime ?? 0.005;
  const fadeMax = SCORE_LIMITS.maxClipFadeSeconds;
  const fadeStep = (value: number, direction: 1 | -1) =>
    Math.max(
      0,
      Math.min(
        fadeMax,
        round(
          value < 0.05 ? value + 0.005 * direction : value + 0.05 * direction,
          3,
        ),
      ),
    );
  return [
    {
      kind: "number",
      label: "gain",
      help: "clip gain in dB before the track's effects",
      value: round(clipGainDb(clip.gain ?? 1), 1),
      min: CLIP_GAIN_MIN_DB,
      max: CLIP_GAIN_MAX_DB,
      step: (value, direction) =>
        Math.max(
          CLIP_GAIN_MIN_DB,
          Math.min(CLIP_GAIN_MAX_DB, round(value + direction, 1)),
        ),
      format: dbText,
      command: (value) => `/clip ${id} gain ${value}`,
      reset: `/clip ${id} gain 0`,
    },
    {
      kind: "number",
      label: "fade in",
      help: "equal-power fade-in, seconds",
      value: fadeIn,
      min: 0,
      max: fadeMax,
      step: fadeStep,
      format: (value) => `${round(value, 3)} s`,
      command: (value) => `/clip ${id} fade in ${value}`,
      reset: `/clip ${id} fade in default`,
    },
    {
      kind: "number",
      label: "fade out",
      help: "equal-power fade-out, seconds",
      value: fadeOut,
      min: 0,
      max: fadeMax,
      step: fadeStep,
      format: (value) => `${round(value, 3)} s`,
      command: (value) => `/clip ${id} fade out ${value}`,
      reset: `/clip ${id} fade out default`,
    },
    {
      kind: "number",
      label: "start in file",
      help: "seconds into the file where the clip starts playing",
      value: clip.offset ?? 0,
      min: 0,
      max: SCORE_LIMITS.maxClipSeconds,
      step: (value, direction) =>
        Math.max(0, round(value + 0.1 * direction, 3)),
      format: (value) => `${round(value, 3)} s`,
      command: (value) => `/clip ${id} trim offset ${value}`,
      reset: `/clip ${id} trim offset 0`,
    },
    {
      kind: "entry",
      label: "length",
      value: clip.dur === undefined ? "to file end" : `${round(clip.dur, 3)} s`,
      help: "seconds of the file to play; `end` plays to the file's end",
      placeholder: "seconds, e.g. 4.5, or end",
      command: (text) => {
        const value = text.trim().toLowerCase().replace(/s$/, "");
        if (value === "end") return `/clip ${id} trim dur end`;
        return Number(value) > 0 ? `/clip ${id} trim dur ${value}` : undefined;
      },
      example: `/clip ${id} trim dur 4.5`,
    },
    {
      kind: "toggle",
      label: "reverse",
      help: "play the clip backwards",
      value: clip.rev === true,
      command: () => `/clip ${id} rev`,
    },
    {
      kind: "toggle",
      label: "mute",
      help: "silence this clip only",
      value: clip.mute === true,
      command: () => `/clip ${id} mute`,
    },
    {
      kind: "entry",
      label: "move to bar",
      value: userBarLabel(context.score, clip.startTick),
      help: "1-based bar, or bar.beat",
      placeholder: "bar, e.g. 9 or 5.3",
      command: (text) =>
        text.trim() ? `/clip ${id} move ${text.trim()}` : undefined,
      example: `/clip ${id} move 9`,
    },
    {
      kind: "entry",
      label: "split at bar",
      value: "",
      help: "cut the clip in two at a bar (5 ms fades at the cut)",
      placeholder: "bar, e.g. 7",
      command: (text) =>
        text.trim() ? `/clip ${id} split ${text.trim()}` : undefined,
      example: `/clip ${id} split 7`,
    },
    {
      kind: "entry",
      label: "repeat",
      value: "",
      help: "copies every N bars up to a bar: type `2 to 32`",
      placeholder: "every N to bar",
      command: (text) => {
        const match = text
          .trim()
          .match(/^(?:every\s+)?(\d+(?:\.\d+)?)\s+(?:to\s+)?(\d+)$/i);
        return match
          ? `/clip ${id} repeat every ${match[1]} to ${match[2]}`
          : undefined;
      },
      example: `/clip ${id} repeat every 2 to 32`,
    },
    {
      kind: "info",
      label: "file",
      value: basename(clip.src),
      help: clip.src,
    },
    {
      kind: "action",
      label: "remove clip",
      command: `/clip ${id} rm`,
      help: "remove this clip (the file stays in the project; undo brings it back)",
    },
  ];
}

/** Sound > Voice rows from the clips lane: Clips and Lyrics. */
export function clipMenuRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!track) return [];
  const clips = track.clips ?? [];
  const notes = context.score.notes.filter((n) => n.trackId === track.id);
  const sung = lyricText(notes);
  return [
    {
      kind: "menu",
      id: "voice:clips",
      label: "Clips",
      detail: clips.length
        ? `${clips.length} clip${clips.length === 1 ? "" : "s"}`
        : "import a vocal",
      help: "audio clips on this track: import a file or the vocals stem, then edit",
      build: (inner) => {
        const now =
          inner.score.tracks.find((t) => t.id === inner.trackId)?.clips ?? [];
        return [
          ...now.map((clip): MenuNode => ({
            kind: "menu",
            id: `clip:${clip.id}`,
            label: clip.id,
            detail: clipDetail(inner, clip),
            help: `${basename(clip.src)} · gain, fades, reverse, mute, move, split, repeat`,
            build: (deeper) => clipRows(deeper, clip.id),
          })),
          {
            kind: "entry",
            label: "import a file",
            value: "",
            help: "copy an audio file into the track (48 kHz mono, peak -6 dBFS) at a bar",
            placeholder: "<file> [bar]",
            command: (text) =>
              text.trim() ? `/vocal import ${text.trim()}` : undefined,
            example: "/vocal import ~/take.wav 9",
          },
          {
            kind: "entry",
            label: "vocals stem",
            value: "",
            help: "place the vocals stem from the last split_stems at a bar",
            placeholder: "bar (default 1)",
            command: (text) => `/vocal stem ${text.trim() || "1"}`,
            example: "/vocal stem 1",
          },
          {
            kind: "choice",
            label: "setup",
            value: "",
            options: VOCAL_SETUPS.filter(
              (setup) => !setup.needs?.includes("say"),
            ).map((setup) => setup.name),
            help: "a vocal chain in one step (setups naming later tools say what is missing)",
            command: (option) => `/vocal setups ${option}`,
          },
        ];
      },
    },
    {
      kind: "menu",
      id: "voice:lyrics",
      label: "Lyrics",
      detail: sung ? sung.slice(0, 32) : "none",
      help: "words on this track's notes: - splits syllables, _ holds, ~ skips",
      build: (inner) => {
        const text = lyricText(
          inner.score.notes.filter((n) => n.trackId === inner.trackId),
        );
        return [
          {
            kind: "entry",
            label: "lyrics",
            value: text,
            help: "typed words are split into syllables onto the notes in order",
            placeholder: "sun-lit morn-ing _ glow",
            command: (typed) =>
              typed.trim() ? `/lyrics ${typed.trim()}` : undefined,
            example: "/lyrics sun-lit morn-ing",
          },
          {
            kind: "entry",
            label: "from bar",
            value: "",
            help: "lyrics starting at a bar: type `9 la la la`",
            placeholder: "<bar> <words>",
            command: (typed) =>
              /^\d+(?:\.\d+)?\s+\S/.test(typed.trim())
                ? `/lyrics ${typed.trim()}`
                : undefined,
            example: "/lyrics 9 la la la",
          },
          { kind: "action", label: "clear lyrics", command: "/lyrics clear" },
        ];
      },
    },
  ];
}

/** Sound > browse sounds > Voices > Vocal: the guide-note vocal track. */
export function vocalBrowseRows(_context: MenuContext): MenuNode[] {
  return [
    {
      kind: "action",
      label:
        "Vocal  clips sound, notes are a silent guide · hpf 90, 3:1, plate",
      command: "instrument vocal",
      help: "a vocal track: import a take or stem in Sound > Voice > Clips",
    },
  ];
}
