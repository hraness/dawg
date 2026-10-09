/**
 * Sound › Performance: how the focused track plays its notes. Every row
 * runs the same prompt command a user could type (src/commands/expression.ts),
 * so the menu, the prompt and the agent share one grammar.
 */
import { singVowelNodes } from "./sing-menu.ts";
import {
  ARTICULATIONS,
  DEFAULT_FIXED_VELOCITY,
  DEFAULT_GLIDE_SECONDS,
  EXPRESSION_LIMITS,
  GLIDE_MODES,
  VELOCITY_CURVES,
} from "../../core/expression.ts";
import type { Note, Track } from "../../core/score.ts";
import { isPianoFamily } from "../../core/keys.ts";
import {
  BEND_SHAPES,
  DEFAULT_HUMANIZE,
  describeHumanize,
  parseExpressionCommand,
} from "../commands/expression.ts";
import type { MenuContext, MenuNode } from "./menu.ts";

const round = (value: number, places = 3) =>
  Math.round(value * 10 ** places) / 10 ** places;

/** One value every note shares, `mixed`, or `fallback` when none set it. */
function shared(
  notes: readonly Note[],
  read: (note: Note) => string | undefined,
  fallback: string,
): string {
  const values = new Set(notes.map((note) => read(note) ?? fallback));
  if (values.size === 0) return fallback;
  return values.size === 1 ? [...values][0]! : "mixed";
}

function bendName(note: Note): string | undefined {
  if (!note.bend) return undefined;
  const text = JSON.stringify(note.bend);
  return (
    Object.entries(BEND_SHAPES).find(
      ([, points]) => JSON.stringify(points) === text,
    )?.[0] ?? "custom"
  );
}

/** The menu's one-line summary of a track's performance, for its row. */
export function performanceDetail(track: Track | undefined): string {
  if (!track) return "—";
  const parts = [
    track.glide ? `glide ${track.glide.mode}` : "",
    track.pedal?.length ? "pedal" : "",
    track.softPedal?.length ? "soft" : "",
    track.sostenuto?.length ? "sost" : "",
    track.velocityCurve ? `vel ${track.velocityCurve.curve}` : "",
    track.humanize ? "humanized" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "as written";
}

/** Soft pedal and Sostenuto rows: off, the current lane, or the whole loop. */
function pianoPedalNodes(track: Track): MenuNode[] {
  const rows = [
    {
      lane: "soft",
      label: "soft pedal",
      events: track.softPedal,
      help: "una corda: the hammers shift to strike fewer strings, softer and darker; read at each note's onset",
    },
    {
      lane: "sost",
      label: "sostenuto",
      events: track.sostenuto,
      help: "holds only the keys already down when it presses (the middle pedal); later notes damp normally",
    },
  ] as const;
  return rows
    .filter((row) => isPianoFamily(track.instrument) || row.events?.length)
    .map((row): MenuNode => {
      const value = row.events?.length ? `${row.events.length} events` : "off";
      return {
        kind: "choice",
        label: row.label,
        value,
        options: ["off", ...(value === "off" ? [] : [value]), "bars"],
        command: (option) =>
          option === "bars"
            ? `pedal ${row.lane} bars`
            : option === "off"
              ? `pedal ${row.lane} off`
              : `pedal ${row.lane}`,
        help: row.help,
      };
    });
}

export function performanceNodes(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find(
    (item) => item.id === context.trackId,
  );
  if (!track) return [];
  const notes = context.score.notes.filter((note) => note.trackId === track.id);
  const glide = track.glide;
  const curve = track.velocityCurve;
  const humanize = track.humanize;
  const humanizeCommand = (timing: number, velocity: number, length: number) =>
    `humanize ${round(timing)} ${round(velocity)} ${round(length)}`;
  const timing = humanize?.timing ?? 0;
  const velocity = humanize?.velocity ?? 0;
  const length = humanize?.length ?? 0;
  const pedalLabel = track.pedal?.length
    ? `${track.pedal.length} events`
    : "off";
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "articulation",
      value: shared(notes, (note) => note.articulation, "none"),
      options: ["none", ...ARTICULATIONS],
      command: (option) => `art ${option === "none" ? "off" : option}`,
      help: "every note on the track: staccato halves the length, ghost plays quiet",
    },
    {
      kind: "number",
      label: "glide (ms)",
      value: glide?.time,
      min: 0,
      max: EXPRESSION_LIMITS.maxGlideSeconds,
      step: (value, direction) =>
        Math.min(
          EXPRESSION_LIMITS.maxGlideSeconds,
          Math.max(0, round(value + 0.01 * direction, 2)),
        ),
      format: (value) => `${Math.round(value * 1000)} ms`,
      command: (value) => `glide ${Math.round(value * 1000)}ms`,
      off: "off",
      start: DEFAULT_GLIDE_SECONDS,
      reset: "glide off",
      help: "portamento into each note from the one before",
    },
    {
      kind: "choice",
      label: "glide mode",
      value: glide?.mode ?? "off",
      options: ["off", ...GLIDE_MODES],
      command: (option) => (option === "off" ? "glide off" : `glide ${option}`),
      help: "legato: slide only into overlapping notes (TB-303); mono: always; poly: every voice",
    },
    {
      kind: "choice",
      label: "bend",
      value: shared(notes, bendName, "none"),
      options: ["none", ...Object.keys(BEND_SHAPES)],
      command: (option) => `bend ${option === "none" ? "off" : option}`,
      help: "a pitch curve over every note; `bend` in the prompt takes points",
    },
    {
      kind: "entry",
      label: "vibrato",
      value: shared(
        notes,
        (note) =>
          note.vibrato
            ? `${note.vibrato.rate} Hz ${note.vibrato.depth}¢`
            : undefined,
        "none",
      ),
      placeholder: "rate Hz, depth cents, delay s: 5.5 25 0.2",
      command: (text) => {
        const command = text.trim() ? `vibrato ${text.trim()}` : "vibrato off";
        return parseExpressionCommand(command) ? command : undefined;
      },
      example: "vibrato 5.5 25 0.2",
      help: "replaces the synth's vib on every note on the track",
    },
    {
      kind: "choice",
      label: "sustain pedal",
      value: pedalLabel,
      options: ["off", ...(pedalLabel === "off" ? [] : [pedalLabel]), "bars"],
      command: (option) =>
        option === "bars"
          ? "pedal bars"
          : option === "off"
            ? "pedal off"
            : "pedal",
      help: "bars replaces the lane with a re-pedal on each downbeat; in play mode press Tab (latch) or hold Shift while recording",
    },
    // keys-electric (0.6.1): the piano's other two pedals, on modelled piano
    // tracks (or wherever a lane is already set).
    ...pianoPedalNodes(track),
    {
      kind: "choice",
      label: "velocity curve",
      value: curve?.curve ?? "linear",
      options: VELOCITY_CURVES,
      command: (option) => `velcurve ${option}`,
      help: "soft lifts quiet notes, hard deepens them, fixed plays every note the same",
    },
  ];
  if (curve?.curve === "fixed")
    nodes.push({
      kind: "number",
      label: "fixed velocity",
      value: curve.fixed ?? DEFAULT_FIXED_VELOCITY,
      min: 0,
      max: 1,
      step: (value, direction) =>
        Math.min(1, Math.max(0, round(value + 0.05 * direction, 2))),
      format: (value) => String(round(value, 2)),
      command: (value) => `velcurve fixed ${round(value, 2)}`,
      reset: `velcurve fixed ${DEFAULT_FIXED_VELOCITY}`,
    });
  nodes.push(
    {
      kind: "number",
      label: "humanize timing (ms)",
      value: humanize ? timing : undefined,
      min: 0,
      max: EXPRESSION_LIMITS.maxHumanizeTimingMs,
      step: (value, direction) =>
        Math.min(
          EXPRESSION_LIMITS.maxHumanizeTimingMs,
          Math.max(0, value + direction),
        ),
      format: (value) => `±${round(value)} ms`,
      command: (value) => humanizeCommand(value, velocity, length),
      off: "off",
      start: DEFAULT_HUMANIZE.timing,
      reset: "humanize off",
      help: `seeded drift applied at render; the score stays clean (${describeHumanize(humanize)})`,
    },
    {
      kind: "number",
      label: "humanize velocity (%)",
      value: humanize ? velocity : undefined,
      min: 0,
      max: EXPRESSION_LIMITS.maxHumanizePercent,
      step: (value, direction) =>
        Math.min(
          EXPRESSION_LIMITS.maxHumanizePercent,
          Math.max(0, value + direction),
        ),
      format: (value) => `±${round(value)}%`,
      command: (value) => humanizeCommand(timing, value, length),
      off: "off",
      start: DEFAULT_HUMANIZE.velocity,
      reset: "humanize off",
    },
    {
      kind: "number",
      label: "humanize length (%)",
      value: humanize ? length : undefined,
      min: 0,
      max: EXPRESSION_LIMITS.maxHumanizePercent,
      step: (value, direction) =>
        Math.min(
          EXPRESSION_LIMITS.maxHumanizePercent,
          Math.max(0, value + direction),
        ),
      format: (value) => `±${round(value)}%`,
      command: (value) => humanizeCommand(timing, velocity, value),
      off: "off",
      start: 5,
      reset: "humanize off",
    },
  );
  if (humanize)
    nodes.push({
      kind: "action",
      label: `new take (seed ${humanize.seed})`,
      command: "humanize reseed",
      help: "the same amounts with a different seeded performance",
    });
  // 0.7 sing: Vowels on a sing track.
  nodes.push(...singVowelNodes(context));
  return nodes;
}
