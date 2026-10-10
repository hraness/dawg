/**
 * Project › Tempo and meter: the song's tempo map, meter changes and
 * fermatas, and the focused track's rate, phase and loop. Every row runs a
 * prompt command from `src/commands/time.ts`, so the menu and the prompt
 * stay one grammar.
 */
import {
  barAt,
  bpmAtTick,
  loopSecondsOf,
  loopTicksOf,
  meterSegments,
  TIME_LIMITS,
  type TimeScore,
} from "../../core/tempo.ts";
import { parseTimeCommand } from "../commands/time.ts";
import type { MenuContext, MenuNode } from "./menu.ts";

/** The opening meter's note value (a bar-1 meter change can set it). */
export function openingUnit(score: TimeScore): number {
  return meterSegments(score)[0]?.beatUnit ?? 4;
}

/** Beats per bar from the slider, keeping the opening note value. */
export function openingMeterCommand(score: TimeScore, value: number): string {
  const unit = openingUnit(score);
  const beats = Math.round(value);
  return unit === 4 ? `meter ${beats}` : `meter ${beats}/${unit}`;
}

/** One-line summary for the Project row and the Tempo and meter row. */
export function tempoDetail(score: TimeScore): string {
  const time = score.time;
  const parts: string[] = [];
  const events = time?.tempo ?? [];
  if (events.length > 0) {
    const low = Math.min(score.tempoBpm, ...events.map((e) => e.bpm));
    const high = Math.max(score.tempoBpm, ...events.map((e) => e.bpm));
    parts.push(
      `${fmt(low)}–${fmt(high)} BPM · ${events.length} change${events.length === 1 ? "" : "s"}`,
    );
  } else parts.push(`${fmt(score.tempoBpm)} BPM`);
  const meters = time?.meter ?? [];
  const first = meters.find((change) => change.bar === 0);
  parts.push(
    first
      ? `${first.beatsPerBar}/${first.beatUnit ?? 4}`
      : `${score.beatsPerBar}/4`,
  );
  const later = meters.filter((change) => change.bar > 0).length;
  if (later > 0) parts.push(`${later} meter change${later === 1 ? "" : "s"}`);
  const fermatas = time?.fermatas?.length ?? 0;
  if (fermatas > 0)
    parts.push(`${fermatas} fermata${fermatas === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The Tempo and meter submenu node for Project. */
export function tempoMenuNode(context: MenuContext): MenuNode {
  return {
    kind: "menu",
    id: "tempo",
    label: "tempo and meter",
    detail: tempoDetail(context.score),
    help: "tempo changes, rit. and accel., fermatas, meter changes, track rate and phase",
    build: tempoNodes,
  };
}

/** What x puts the song's tempo, meter and loop length back to. */
export const START_TEMPO_BPM = 120;
export const START_BEATS_PER_BAR = 4;
export const START_BARS = 8;

/** Rows of Project › Tempo and meter. */
export function tempoNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  const tpb = score.ticksPerBeat;
  const time = score.time;
  const nodes: MenuNode[] = [
    {
      kind: "number",
      label: "start tempo",
      help: "beats per minute at the top of the song",
      value: score.tempoBpm,
      start: START_TEMPO_BPM,
      min: TIME_LIMITS.minBpm,
      max: TIME_LIMITS.maxBpm,
      step: stepBy(1, TIME_LIMITS.minBpm, TIME_LIMITS.maxBpm),
      format: (value) => `${fmt(value)} BPM`,
      command: (value) => `tempo ${fmt(value)}`,
    },
  ];
  for (const event of time?.tempo ?? []) {
    const at = placeOf(score, event.tick);
    const beat = fmt(event.tick / tpb);
    const ramp = event.ramp ? ` ${event.ramp === "exp" ? "exp" : "ramp"}` : "";
    nodes.push({
      kind: "number",
      label: `tempo @ ${at}`,
      help: `${event.ramp ? (event.ramp === "exp" ? "exponential glide" : "linear glide") : "steps"} to this tempo · x removes it`,
      value: event.bpm,
      min: TIME_LIMITS.minBpm,
      max: TIME_LIMITS.maxBpm,
      step: stepBy(1, TIME_LIMITS.minBpm, TIME_LIMITS.maxBpm),
      format: (value) =>
        `${event.ramp ? (event.ramp === "exp" ? "exp→ " : "→ ") : ""}${fmt(value)} BPM`,
      command: (value) => `tempo ${fmt(value)} at ${beat}${ramp}`,
      reset: `tempo remove ${beat}`,
    });
    nodes.push({
      kind: "choice",
      label: `glide @ ${at}`,
      help: "step: jump to the tempo · ramp: glide in evenly · exp: glide by equal ratios",
      value: event.ramp ? (event.ramp === "exp" ? "exp" : "ramp") : "step",
      options: ["step", "ramp", "exp"],
      command: (option) =>
        `tempo ${fmt(event.bpm)} at ${beat}${option === "step" ? "" : ` ${option}`}`,
    });
  }
  nodes.push(
    entry(
      "add tempo change",
      "<bpm> at <beat>|bar <n> [ramp|exp]",
      "tempo",
      "tempo 90 at bar 9 ramp",
      "a step or glide to a new tempo; beats count from 0, bars from 1",
    ),
    entry(
      "ritardando",
      "[<n> bars] [to <bpm>] [at bar <n>] · empty: last 2 bars to 75%",
      "rit",
      "rit 4 bars to 80",
      "slow down gradually; without a start it closes the song",
      true,
    ),
    entry(
      "accelerando",
      "[<n> bars] [to <bpm>] [at bar <n>] · empty: last 2 bars to 133%",
      "accel",
      "accel 8 bars to 174 at bar 9",
      "speed up gradually, e.g. into a drop",
      true,
    ),
    entry(
      "a tempo",
      "[at bar <n>] · empty: the bar after the last rit/accel",
      "a tempo",
      "a tempo at bar 9",
      "step back to the tempo before the last rit or accel",
      true,
    ),
    entry(
      "tempo primo",
      "[at bar <n>] · empty: the bar after the last rit/accel",
      "tempo primo",
      "tempo primo at bar 17",
      "step back to the start tempo",
      true,
    ),
  );
  for (const fermata of time?.fermatas ?? []) {
    const beat = fmt(fermata.tick / tpb);
    nodes.push({
      kind: "number",
      label: `fermata @ ${beat}`,
      help: "extra beats this beat holds for · x removes it",
      value: fermata.beats,
      min: 0.25,
      max: TIME_LIMITS.maxFermataBeats,
      step: stepBy(0.25, 0.25, TIME_LIMITS.maxFermataBeats),
      format: (value) => `+${fmt(value)} beat${value === 1 ? "" : "s"}`,
      command: (value) => `fermata at ${beat} ${fmt(value)}`,
      reset: `fermata remove ${beat}`,
    });
  }
  nodes.push(
    entry(
      "add fermata",
      "at <beat>|bar <n> [<extra beats>] · empty: the last beat, +2",
      "fermata",
      "fermata at 31 2",
      "hold one beat longer, as a fermata does",
      true,
    ),
    {
      kind: "number",
      label: "beats per bar",
      help: "the song's opening meter; meter changes below override it later",
      value: score.beatsPerBar,
      start: START_BEATS_PER_BAR,
      min: 1,
      max: TIME_LIMITS.maxBeatsPerBar,
      step: stepBy(1, 1, TIME_LIMITS.maxBeatsPerBar),
      format: (value) => `${value}/${openingUnit(score)}`,
      command: (value) => openingMeterCommand(score, value),
    },
  );
  for (const change of time?.meter ?? []) {
    const unit = change.beatUnit ?? 4;
    const bar = change.bar + 1;
    nodes.push({
      kind: "number",
      label: `meter @ bar ${bar}`,
      help: `beats of 1/${unit} per bar from bar ${bar} · x removes the change`,
      value: change.beatsPerBar,
      min: 1,
      max: TIME_LIMITS.maxBeatsPerBar,
      step: stepBy(1, 1, TIME_LIMITS.maxBeatsPerBar),
      format: (value) => `${value}/${unit}`,
      command: (value) => `meter ${Math.round(value)}/${unit} at bar ${bar}`,
      reset: `meter remove bar ${bar}`,
    });
  }
  nodes.push(
    entry(
      "add meter change",
      "<n>/<d> at bar <n>",
      "meter",
      "meter 7/8 at bar 5",
      "a new time signature from a bar line on",
    ),
  );
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  if (track)
    nodes.push({
      kind: "menu",
      id: "track-time",
      label: `${track.name ?? track.id} time`,
      detail: trackTimeDetail(context),
      help: "the focused track's tempo ratio, phase and loop (polytempo, polymeter, phasing)",
      build: trackTimeNodes,
    });
  if (time?.tempo?.length)
    nodes.push({
      kind: "action",
      label: "clear tempo changes",
      command: "tempo clear",
      help: `back to ${fmt(score.tempoBpm)} BPM throughout`,
    });
  if (time?.fermatas?.length)
    nodes.push({
      kind: "action",
      label: "clear fermatas",
      command: "fermata clear",
    });
  if (time?.meter?.length)
    nodes.push({
      kind: "action",
      label: "clear meter changes",
      command: "meter clear",
      help: `back to ${score.beatsPerBar}/4 throughout`,
    });
  nodes.push({
    kind: "info",
    label: "song length",
    // The written end tempo: a fermata's hold is not a tempo change.
    value: `${fmt(loopSecondsOf(score))} s · ends at ${fmt(
      bpmAtTick(
        {
          tempoBpm: score.tempoBpm,
          beatsPerBar: score.beatsPerBar,
          bars: score.bars,
          ticksPerBeat: score.ticksPerBeat,
          ...(time?.tempo || time?.meter
            ? { time: { tempo: time.tempo, meter: time.meter } }
            : {}),
        },
        loopTicksOf(score),
      ),
    )} BPM${time?.fermatas?.length ? ` · ${time.fermatas.length} fermata${time.fermatas.length === 1 ? "" : "s"}` : ""}`,
  });
  return nodes;
}

function trackTimeDetail(context: MenuContext): string {
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  const time = track?.time;
  if (!time) return "follows the song";
  const tpb = context.score.ticksPerBeat;
  const parts: string[] = [];
  if (time.rate !== undefined) parts.push(`rate ${fmt(time.rate, 4)}×`);
  if (time.phase !== undefined) parts.push(`phase ${fmt(time.phase / tpb)}`);
  if (time.cycle !== undefined) parts.push(`loop ${fmt(time.cycle / tpb)}`);
  return parts.join(" · ");
}

/** Rows of the focused track's time submenu. */
export function trackTimeNodes(context: MenuContext): MenuNode[] {
  const score = context.score;
  const track = score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  if (!track)
    return [{ kind: "info", label: "no track", value: "/track <name>" }];
  const tpb = score.ticksPerBeat;
  const loopBeats = loopTicksOf(score) / tpb;
  const time = track.time;
  return [
    {
      kind: "number",
      label: "rate",
      help: "tempo ratio against the song: 1.5 plays three beats in two · x resets",
      value: time?.rate ?? 1,
      min: TIME_LIMITS.minRate,
      max: TIME_LIMITS.maxRate,
      step: stepBy(0.01, TIME_LIMITS.minRate, TIME_LIMITS.maxRate),
      format: (value) => `${fmt(value, 4)}×`,
      command: (value) => `track rate ${fmt(value, 6)}`,
      reset: "track rate off",
    },
    {
      kind: "number",
      label: "phase",
      help: "beats the track's pattern starts later (negative: earlier) · x resets",
      value: (time?.phase ?? 0) / tpb,
      min: -loopBeats,
      max: loopBeats,
      step: stepBy(0.25, -loopBeats, loopBeats),
      format: (value) => `${fmt(value)} beat${value === 1 ? "" : "s"}`,
      command: (value) => `track phase ${fmt(value, 4)}`,
      reset: "track phase off",
    },
    {
      kind: "number",
      label: "loop",
      help: "beats before the track's own loop repeats (polymeter) · x follows the song loop",
      value: time?.cycle !== undefined ? time.cycle / tpb : undefined,
      off: "song loop",
      start: score.beatsPerBar,
      min: 0.25,
      max: TIME_LIMITS.maxTick / tpb,
      step: stepBy(0.25, 0.25, TIME_LIMITS.maxTick / tpb),
      format: (value) => `${fmt(value)} beat${value === 1 ? "" : "s"}`,
      command: (value) => `track loop ${fmt(value, 4)}`,
      reset: "track loop off",
    },
    entry(
      "phasing",
      "<cycle beats> [over <beats>] [cycles <n>]",
      "track phasing",
      "track phasing 4",
      "continuous drift (It's Gonna Rain): gain whole cycles per loop and realign at its end",
    ),
    entry(
      "stepped phasing",
      "<cycle beats> [hold <n>] [drift <n>] [shift <beats>]",
      "track phasing",
      "track phasing 3 hold 8",
      "Piano Phase: hold in step, then move a sixteenth ahead, and repeat",
    ),
    {
      kind: "action",
      label: "follow the song",
      command: "track time off",
      help: "clear rate, phase and loop",
    },
  ];
}

/** A typed-argument row that runs `<verb> <text>` when it parses. */
function entry(
  label: string,
  placeholder: string,
  verb: string,
  example: string,
  help: string,
  emptyRuns = false,
): MenuNode {
  return {
    kind: "entry",
    label,
    value: "—",
    placeholder,
    command: (text) => {
      const typed = text.trim();
      if (!typed && !emptyRuns) return undefined;
      const command = typed ? `${verb} ${typed}` : verb;
      return parseTimeCommand(command) ? command : undefined;
    },
    example,
    help,
  };
}

/** `bar 5` on a bar line, else `beat 17.5`. */
function placeOf(score: TimeScore, tick: number): string {
  const bar = barAt(score, tick);
  return bar.offset === 0
    ? `bar ${bar.bar + 1}`
    : `beat ${fmt(tick / score.ticksPerBeat)}`;
}

function stepBy(size: number, min: number, max: number) {
  return (value: number, direction: 1 | -1): number => {
    const next = Math.round((value + size * direction) / size) * size;
    return Math.min(max, Math.max(min, Math.round(next * 1e6) / 1e6));
  };
}

function fmt(value: number, digits = 3): string {
  const scale = 10 ** digits;
  return String(Math.round(value * scale) / scale);
}
