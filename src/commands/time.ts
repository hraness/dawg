/**
 * Tempo map, meter, fermata and track-time commands (`core/tempo.ts`). Each
 * is one score revision, so one undo step.
 *
 *   tempo <bpm> at <beat>|bar <n> [ramp|exp]   tempo change; ramp glides in
 *   tempo remove <beat>|bar <n> · tempo clear · tempo map
 *   rit|accel [<n> [bars|beats]] [to <bpm>] [at bar <n>|<beat>] [exp]
 *                                              gradual change; 75% / 133% by
 *                                              default, over the last bars
 *   fermata [at <beat>|bar <n>|end] [<beats>]  hold that beat for extra beats
 *   fermata remove <beat>|bar <n> · fermata clear
 *   meter <n>/<d> [at bar <n>]                 meter change at a bar line
 *   meter remove bar <n> · meter clear
 *   track rate <0.125..8>|<a>/<b>|off          polytempo: the track's tempo ratio
 *   track phase <beats>|off                    start the track later
 *   track cycle <beats>|off                    polymeter: loop the first beats
 *   track phasing <cycle> [over <beats>] [cycles <n>]   Reich-style drift
 *   track time off                             follow the song again
 *
 * `tempo <bpm>` (the start tempo) and `meter <n>` (beats per bar) keep their
 * own parsers. Beats count from 0, bars from 1, as in the rest of the grammar.
 */
import {
  applyScoreOperation,
  ScoreValidationError,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import {
  barAt,
  barStartTick,
  bpmAtTick,
  describeSongTime,
  driftRate,
  loopTicksOf,
  TIME_LIMITS,
  TimeValidationError,
  withFermata,
  withMeterChange,
  withoutFermatas,
  withoutTempoEvents,
  withTempoEvent,
  withTempoRamp,
  type SongTime,
  type TempoRamp,
  type TrackTime,
} from "../../core/tempo.ts";

/** A place in the song: a 0-based beat or a 1-based bar's downbeat. */
export type TimePosition =
  Readonly<{ beat: number }> | Readonly<{ bar: number }>;

export type TimeCommand =
  | Readonly<{
      type: "tempo-at";
      bpm: number;
      at: TimePosition;
      ramp?: TempoRamp;
    }>
  | Readonly<{ type: "tempo-remove"; at: TimePosition }>
  | Readonly<{ type: "tempo-clear" }>
  | Readonly<{ type: "tempo-map" }>
  | Readonly<{
      type: "gradual";
      direction: "rit" | "accel";
      length: number;
      unit: "bars" | "beats";
      bpm?: number;
      at?: TimePosition;
      curve: TempoRamp;
    }>
  | Readonly<{ type: "fermata"; at?: TimePosition; beats: number }>
  | Readonly<{ type: "fermata-remove"; at: TimePosition }>
  | Readonly<{ type: "fermata-clear" }>
  | Readonly<{
      type: "meter-at";
      beatsPerBar: number;
      beatUnit: number;
      /** 1-based; absent sets the meter for the whole song. */
      bar?: number;
    }>
  | Readonly<{ type: "meter-remove"; bar: number }>
  | Readonly<{ type: "meter-clear" }>
  | Readonly<{
      type: "track-time";
      field: "rate" | "phase" | "cycle";
      /** Rate, or beats for phase and cycle; null resets the field. */
      value: number | null;
    }>
  | Readonly<{
      type: "track-phasing";
      cycle: number;
      over?: number;
      cycles: number;
    }>
  | Readonly<{ type: "track-time-off" }>;

export type TimeResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** MuseScore's default rit. and accel. amounts (75% and 133%). */
export const GRADUAL_DEFAULTS = Object.freeze({
  ritFactor: 0.75,
  accelFactor: 1.33,
  bars: 2,
});

/** Extra beats a bare `fermata` holds for (the SDK's `fermata()` default). */
export const FERMATA_DEFAULT_BEATS = 2;

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const UNSIGNED = /^\d+(?:\.\d+)?$/;

/** Parses one time command, or undefined when `prompt` is not one. */
export function parseTimeCommand(prompt: string): TimeCommand | undefined {
  const text = prompt.trim().replace(/\s+/g, " ").toLowerCase();
  if (text.length > 256) return undefined;
  const words = text.split(" ");
  const verb = words[0]!;
  const rest = words.slice(1);
  if (verb === "tempo" || verb === "bpm") return tempoCommand(rest);
  if (RIT.has(verb) || ACCEL.has(verb))
    return gradualCommand(RIT.has(verb) ? "rit" : "accel", rest);
  if (verb === "fermata") return fermataCommand(rest);
  if (verb === "meter") return meterCommand(rest);
  if (verb === "track") return trackTimeCommand(rest);
  return undefined;
}

const RIT = new Set(["rit", "rit.", "ritardando", "rall", "rallentando"]);
const ACCEL = new Set(["accel", "accel.", "accelerando"]);

function tempoCommand(rest: readonly string[]): TimeCommand | undefined {
  if (rest.length === 1 && (rest[0] === "clear" || rest[0] === "reset"))
    return { type: "tempo-clear" };
  if (rest.length === 1 && rest[0] === "map") return { type: "tempo-map" };
  if (rest[0] === "remove" || rest[0] === "delete") {
    const at = position(rest.slice(1));
    return at && at.used === rest.length - 1
      ? { type: "tempo-remove", at: at.position }
      : undefined;
  }
  // `tempo <bpm>` alone is the start tempo, parsed elsewhere.
  if (rest.length < 3 || !UNSIGNED.test(rest[0]!) || rest[1] !== "at")
    return undefined;
  const bpm = Number(rest[0]);
  const at = position(rest.slice(2));
  if (!at || !validBpm(bpm)) return undefined;
  const tail = rest.slice(2 + at.used);
  if (tail.length === 0) return { type: "tempo-at", bpm, at: at.position };
  if (tail.length !== 1) return undefined;
  const ramp = rampWord(tail[0]!);
  return ramp ? { type: "tempo-at", bpm, at: at.position, ramp } : undefined;
}

function gradualCommand(
  direction: "rit" | "accel",
  rest: readonly string[],
): TimeCommand | undefined {
  let index = 0;
  let length: number = GRADUAL_DEFAULTS.bars;
  let unit: "bars" | "beats" = "bars";
  let bpm: number | undefined;
  let at: TimePosition | undefined;
  let curve: TempoRamp = "linear";
  if (rest[0] !== undefined && UNSIGNED.test(rest[0])) {
    length = Number(rest[0]);
    index = 1;
    const word = rest[1];
    if (word === "bar" || word === "bars") index = 2;
    else if (word === "beat" || word === "beats") {
      unit = "beats";
      index = 2;
    }
  }
  if (!(length > 0)) return undefined;
  if (unit === "bars" && !Number.isInteger(length)) return undefined;
  while (index < rest.length) {
    const word = rest[index]!;
    if (word === "to" && rest[index + 1] && UNSIGNED.test(rest[index + 1]!)) {
      bpm = Number(rest[index + 1]);
      if (!validBpm(bpm)) return undefined;
      index += 2;
    } else if (word === "at" || word === "from") {
      const found = position(rest.slice(index + 1));
      if (!found) return undefined;
      at = found.position;
      index += 1 + found.used;
    } else if (rampWord(word)) {
      curve = rampWord(word)!;
      index += 1;
    } else return undefined;
  }
  return {
    type: "gradual",
    direction,
    length,
    unit,
    ...(bpm !== undefined ? { bpm } : {}),
    ...(at ? { at } : {}),
    curve,
  };
}

function fermataCommand(rest: readonly string[]): TimeCommand | undefined {
  if (rest.length === 1 && rest[0] === "clear")
    return { type: "fermata-clear" };
  if (rest[0] === "remove" || rest[0] === "delete") {
    const words = rest[1] === "at" ? rest.slice(2) : rest.slice(1);
    const at = position(words);
    return at && at.used === words.length
      ? { type: "fermata-remove", at: at.position }
      : undefined;
  }
  let words = rest;
  let at: TimePosition | undefined;
  if (words[0] === "at") {
    if (words[1] === "end") words = words.slice(2);
    else {
      const found = position(words.slice(1));
      if (!found) return undefined;
      at = found.position;
      words = words.slice(1 + found.used);
    }
  }
  if (words[0] === "for") words = words.slice(1);
  let beats = FERMATA_DEFAULT_BEATS;
  if (words.length > 0) {
    if (!UNSIGNED.test(words[0]!)) return undefined;
    beats = Number(words[0]);
    words = words.slice(
      words[1] === "beat" || words[1] === "beats" || words[1] === "extra"
        ? 2
        : 1,
    );
    if (words[0] === "beat" || words[0] === "beats") words = words.slice(1);
  }
  if (words.length > 0) return undefined;
  if (!(beats > 0 && beats <= TIME_LIMITS.maxFermataBeats)) return undefined;
  return { type: "fermata", ...(at ? { at } : {}), beats };
}

function meterCommand(rest: readonly string[]): TimeCommand | undefined {
  if (rest.length === 1 && rest[0] === "clear") return { type: "meter-clear" };
  if (rest[0] === "remove" || rest[0] === "delete") {
    let words = rest.slice(1);
    if (words[0] === "at") words = words.slice(1);
    if (words[0] === "bar") words = words.slice(1);
    if (words.length !== 1 || !/^\d+$/.test(words[0]!)) return undefined;
    const bar = Number(words[0]);
    return bar >= 1 ? { type: "meter-remove", bar } : undefined;
  }
  const signature = rest[0]?.match(/^(\d+)(?:\/(\d+))?$/);
  if (!signature) return undefined;
  const beatsPerBar = Number(signature[1]);
  const beatUnit = signature[2] === undefined ? 4 : Number(signature[2]);
  if (
    beatsPerBar < 1 ||
    beatsPerBar > TIME_LIMITS.maxBeatsPerBar ||
    !TIME_LIMITS.beatUnits.includes(beatUnit)
  )
    return undefined;
  if (rest.length === 1)
    // `meter 3` stays the edit command; `meter 6/8` covers the whole song.
    return signature[2] === undefined
      ? undefined
      : { type: "meter-at", beatsPerBar, beatUnit };
  let words = rest.slice(1);
  if (words[0] !== "at" && words[0] !== "from") return undefined;
  words = words.slice(1);
  if (words[0] === "bar") words = words.slice(1);
  if (words.length !== 1 || !/^\d+$/.test(words[0]!)) return undefined;
  const bar = Number(words[0]);
  if (bar < 1) return undefined;
  return { type: "meter-at", beatsPerBar, beatUnit, bar };
}

function trackTimeCommand(rest: readonly string[]): TimeCommand | undefined {
  const [field, value, ...tail] = rest;
  if (field === "time")
    return rest.length === 2 && (value === "off" || value === "reset")
      ? { type: "track-time-off" }
      : undefined;
  if (field === "rate" || field === "phase" || field === "cycle") {
    if (value === undefined || tail.length > 0) return undefined;
    if (value === "off" || value === "reset")
      return { type: "track-time", field, value: null };
    const ratio = value.match(/^(\d+(?:\.\d+)?)[/:](\d+(?:\.\d+)?)$/);
    const number = value.replace(/x$/, "");
    if (!ratio && !NUMBER.test(number)) return undefined;
    if (ratio && field !== "rate") return undefined;
    const parsed = ratio ? Number(ratio[1]) / Number(ratio[2]) : Number(number);
    if (!Number.isFinite(parsed)) return undefined;
    if (field === "rate") {
      if (parsed < TIME_LIMITS.minRate || parsed > TIME_LIMITS.maxRate)
        return undefined;
    } else if (field === "cycle" && !(parsed > 0)) return undefined;
    return { type: "track-time", field, value: parsed };
  }
  if (field === "phasing") {
    if (value === undefined || !UNSIGNED.test(value)) return undefined;
    const cycle = Number(value);
    if (!(cycle > 0)) return undefined;
    let over: number | undefined;
    let cycles = 1;
    let index = 0;
    while (index < tail.length) {
      const word = tail[index]!;
      const next = tail[index + 1];
      if (next === undefined) return undefined;
      if (word === "over" && UNSIGNED.test(next)) over = Number(next);
      else if (word === "cycles" && NUMBER.test(next)) cycles = Number(next);
      else return undefined;
      index += 2;
    }
    if (over !== undefined && !(over > 0)) return undefined;
    if (cycles === 0) return undefined;
    return {
      type: "track-phasing",
      cycle,
      ...(over !== undefined ? { over } : {}),
      cycles,
    };
  }
  return undefined;
}

/** `12`, `bar 3`, `beat 12`: the position and the words it used. */
function position(
  words: readonly string[],
): { position: TimePosition; used: number } | undefined {
  if (words[0] === "bar") {
    const value = words[1];
    if (value === undefined || !/^\d+$/.test(value)) return undefined;
    const bar = Number(value);
    return bar >= 1 ? { position: { bar }, used: 2 } : undefined;
  }
  const skip = words[0] === "beat" ? 1 : 0;
  const value = words[skip];
  if (value === undefined || !UNSIGNED.test(value)) return undefined;
  return { position: { beat: Number(value) }, used: skip + 1 };
}

function rampWord(word: string): TempoRamp | undefined {
  if (word === "ramp" || word === "linear" || word === "glide") return "linear";
  if (word === "exp" || word === "exponential") return "exp";
  return undefined;
}

function validBpm(bpm: number): boolean {
  return (
    Number.isFinite(bpm) &&
    bpm >= TIME_LIMITS.minBpm &&
    bpm <= TIME_LIMITS.maxBpm
  );
}

// ---------------------------------------------------------------------------
// Applying

/** Applies `command` (track commands to `trackId`) as one revision. */
export function applyTimeCommand(
  score: TrackScore,
  trackId: string,
  command: TimeCommand,
): TimeResult {
  try {
    return applyOrThrow(score, trackId, command);
  } catch (error) {
    if (
      error instanceof TimeValidationError ||
      error instanceof ScoreValidationError
    )
      return { ok: false, message: error.message };
    throw error;
  }
}

function applyOrThrow(
  score: TrackScore,
  trackId: string,
  command: TimeCommand,
): TimeResult {
  switch (command.type) {
    case "tempo-map":
      return { ok: true, message: `tempo map · ${describeSongTime(score)}` };
    case "tempo-at": {
      const tick = tickOf(score, command.at);
      const where = placeLabel(command.at);
      if (tick >= loopTicksOf(score))
        return { ok: false, message: `tempo · ${where} is past the song end` };
      if (tick === 0) {
        const next = applyScoreOperation(score, {
          type: "setTempo",
          tempoBpm: command.bpm,
        });
        return songResult(
          next,
          `tempo · ${fmt(command.bpm)} BPM`,
          "score.tempo",
          { tempoBpm: command.bpm },
        );
      }
      const time = withTempoEvent(score.time, {
        tick,
        bpm: command.bpm,
        ...(command.ramp ? { ramp: command.ramp } : {}),
      });
      const glide = command.ramp
        ? ` (${command.ramp === "exp" ? "exp ramp" : "ramp"})`
        : "";
      return timeResult(
        score,
        time,
        `tempo · ${fmt(command.bpm)} BPM at ${where}${glide}`,
      );
    }
    case "tempo-remove": {
      const [from, to] = spanOf(score, command.at);
      const before = score.time?.tempo?.length ?? 0;
      const time = withoutTempoEvents(score.time, from, to);
      const removed = before - (time?.tempo?.length ?? 0);
      if (removed === 0)
        return {
          ok: false,
          message: `tempo · no change at ${placeLabel(command.at)}`,
        };
      return timeResult(
        score,
        time,
        `tempo · removed ${removed} change${removed === 1 ? "" : "s"} at ${placeLabel(command.at)}`,
      );
    }
    case "tempo-clear": {
      if (!score.time?.tempo)
        return { ok: true, message: `tempo · ${fmt(score.tempoBpm)} BPM` };
      const time = score.time ? { ...score.time, tempo: [] } : undefined;
      return timeResult(
        score,
        time,
        `tempo · ${fmt(score.tempoBpm)} BPM throughout`,
      );
    }
    case "gradual":
      return gradual(score, command);
    case "fermata": {
      const tick = command.at
        ? tickOf(score, command.at)
        : Math.max(0, loopTicksOf(score) - score.ticksPerBeat);
      if (tick >= loopTicksOf(score))
        return {
          ok: false,
          message: `fermata · ${placeLabel(command.at!)} is past the song end`,
        };
      const time = withFermata(score.time, { tick, beats: command.beats });
      return timeResult(
        score,
        time,
        `fermata · +${fmt(command.beats)} beat${command.beats === 1 ? "" : "s"} at beat ${fmt(tick / score.ticksPerBeat)}`,
      );
    }
    case "fermata-remove": {
      const [from, to] = spanOf(score, command.at);
      const before = score.time?.fermatas?.length ?? 0;
      const time = withoutFermatas(score.time, from, to);
      if ((time?.fermatas?.length ?? 0) === before)
        return {
          ok: false,
          message: `fermata · none at ${placeLabel(command.at)}`,
        };
      return timeResult(
        score,
        time,
        `fermata · removed at ${placeLabel(command.at)}`,
      );
    }
    case "fermata-clear": {
      const time = score.time ? { ...score.time, fermatas: [] } : undefined;
      return timeResult(score, time, "fermata · none");
    }
    case "meter-at":
      return meterAt(score, command);
    case "meter-remove": {
      const bar = command.bar - 1;
      if (!score.time?.meter?.some((change) => change.bar === bar))
        return {
          ok: false,
          message: `meter · no change at bar ${command.bar}`,
        };
      const time = withMeterChange(score.time, bar, null);
      return timeResult(
        score,
        time,
        `meter · bar ${command.bar} follows the bar before`,
      );
    }
    case "meter-clear": {
      const time = score.time ? { ...score.time, meter: [] } : undefined;
      return timeResult(
        score,
        time,
        `meter · ${score.beatsPerBar}/4 throughout`,
      );
    }
    case "track-time":
    case "track-phasing":
    case "track-time-off":
      return trackTime(score, trackId, command);
  }
}

function gradual(
  score: TrackScore,
  command: Extract<TimeCommand, { type: "gradual" }>,
): TimeResult {
  const loopTicks = loopTicksOf(score);
  const tpb = score.ticksPerBeat;
  let from: number;
  let to: number;
  if (command.at) {
    from = tickOf(score, command.at);
    if (command.unit === "beats") to = from + Math.round(command.length * tpb);
    else {
      const bar = barAt(score, from);
      to = barStartTick(score, bar.bar + command.length) + bar.offset;
    }
  } else {
    // No start: the last bars (or beats) of the song, as a closing rit.
    to = loopTicks;
    from =
      command.unit === "beats"
        ? to - Math.round(command.length * tpb)
        : barStartTick(score, Math.max(0, score.bars - command.length));
    from = Math.max(0, from);
  }
  if (from >= loopTicks)
    return {
      ok: false,
      message: `${command.direction} · ${placeLabel(command.at!)} is past the song end`,
    };
  if (!(to > from))
    return { ok: false, message: `${command.direction} · needs a length` };
  if (to > TIME_LIMITS.maxTick)
    return { ok: false, message: `${command.direction} · runs too long` };
  const start = bpmAtTick(score, from);
  const factor =
    command.direction === "rit"
      ? GRADUAL_DEFAULTS.ritFactor
      : GRADUAL_DEFAULTS.accelFactor;
  const target =
    command.bpm ??
    Math.min(
      TIME_LIMITS.maxBpm,
      Math.max(TIME_LIMITS.minBpm, Math.round(start * factor * 100) / 100),
    );
  if (command.direction === "rit" && target > start)
    return {
      ok: false,
      message: `rit · ${fmt(target)} BPM is faster than ${fmt(start)}; use accel`,
    };
  if (command.direction === "accel" && target < start)
    return {
      ok: false,
      message: `accel · ${fmt(target)} BPM is slower than ${fmt(start)}; use rit`,
    };
  const time = withTempoRamp(score, from, to, target, command.curve);
  const span = spanLabel(score, from, to);
  return timeResult(
    score,
    time,
    `${command.direction} · ${fmt(start)} → ${fmt(target)} BPM ${span}${command.curve === "exp" ? " (exp)" : ""}`,
  );
}

function meterAt(
  score: TrackScore,
  command: Extract<TimeCommand, { type: "meter-at" }>,
): TimeResult {
  const label = `${command.beatsPerBar}/${command.beatUnit}`;
  if (command.bar === undefined) {
    // The whole song: quarter-note meters set beats per bar as `meter <n>`
    // does; other note values become a change at bar 1.
    const cleared = withMeterChange(score.time, 0, null);
    if (command.beatUnit === 4) {
      const next = applyScoreOperation(
        applyScoreOperation(score, {
          type: "setMeter",
          beatsPerBar: command.beatsPerBar,
        }),
        { type: "setTime", time: cleared ?? null },
      );
      return songResult(next, `meter · ${label}`, "score.meter", {
        beatsPerBar: command.beatsPerBar,
      });
    }
    return timeResult(
      score,
      withMeterChange(score.time, 0, command),
      `meter · ${label}`,
    );
  }
  if (command.bar > score.bars)
    return {
      ok: false,
      message: `meter · bar ${command.bar} is past the song end (${score.bars} bars)`,
    };
  const time = withMeterChange(score.time, command.bar - 1, command);
  return timeResult(score, time, `meter · ${label} from bar ${command.bar}`);
}

function trackTime(
  score: TrackScore,
  trackId: string,
  command: Extract<
    TimeCommand,
    { type: "track-time" | "track-phasing" | "track-time-off" }
  >,
): TimeResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track ${trackId}` };
  const tpb = score.ticksPerBeat;
  const current: { rate?: number; phase?: number; cycle?: number } = {
    ...track.time,
  };
  let message: string;
  if (command.type === "track-time-off") {
    for (const key of Object.keys(current)) delete current[key as "rate"];
    message = `${trackId} · follows the song`;
  } else if (command.type === "track-phasing") {
    const cycle = Math.round(command.cycle * tpb);
    if (cycle < 1)
      return { ok: false, message: "track phasing · cycle is too short" };
    const over =
      command.over !== undefined
        ? Math.round(command.over * tpb)
        : loopTicksOf(score);
    const rate = driftRate(over, cycle, command.cycles);
    if (!(rate >= TIME_LIMITS.minRate && rate <= TIME_LIMITS.maxRate))
      return {
        ok: false,
        message: `track phasing · needs a rate between ${TIME_LIMITS.minRate} and ${TIME_LIMITS.maxRate}`,
      };
    current.cycle = cycle;
    current.rate = rate;
    message = `${trackId} · phasing ${fmt(command.cycle)}-beat cycle, rate ${fmt(rate, 4)} (realigns every ${fmt(over / tpb)} beats)`;
  } else if (command.value === null) {
    delete current[command.field];
    message = `${trackId} · ${command.field} off`;
  } else if (command.field === "rate") {
    current.rate = command.value;
    message = `${trackId} · rate ${fmt(command.value, 4)}×`;
  } else {
    const ticks = Math.round(command.value * tpb);
    if (command.field === "cycle" && ticks < 1)
      return { ok: false, message: "track cycle · too short" };
    current[command.field] = ticks;
    message = `${trackId} · ${command.field} ${fmt(command.value)} beat${command.value === 1 ? "" : "s"}`;
  }
  const time: TrackTime | null = Object.keys(current).length
    ? (current as TrackTime)
    : null;
  const operation: ScoreOperation = {
    type: "updateTrack",
    trackId,
    patch: { time },
  };
  const next = applyScoreOperation(score, operation);
  return {
    ok: true,
    message,
    next,
    kind: "track.time",
    payload: { trackId, time },
  };
}

function timeResult(
  score: TrackScore,
  time: SongTime | undefined,
  message: string,
): TimeResult {
  const operation: ScoreOperation = { type: "setTime", time: time ?? null };
  const next = applyScoreOperation(score, operation);
  return songResult(next, message, "score.time", {
    time: next.time ?? null,
  });
}

function songResult(
  next: TrackScore,
  message: string,
  kind: string,
  payload: Record<string, unknown>,
): TimeResult {
  return { ok: true, message, next, kind, payload };
}

/** The tick a position names. */
export function tickOf(score: TrackScore, at: TimePosition): number {
  return "bar" in at
    ? barStartTick(score, at.bar - 1)
    : Math.round(at.beat * score.ticksPerBeat);
}

/** A beat names one tick; a bar names its whole span. */
function spanOf(score: TrackScore, at: TimePosition): [number, number] {
  if ("beat" in at) {
    const tick = tickOf(score, at);
    return [tick, tick];
  }
  return [barStartTick(score, at.bar - 1), barStartTick(score, at.bar) - 1];
}

function placeLabel(at: TimePosition): string {
  return "bar" in at ? `bar ${at.bar}` : `beat ${fmt(at.beat)}`;
}

function spanLabel(score: TrackScore, from: number, to: number): string {
  const start = barAt(score, from);
  const end = barAt(score, to);
  if (start.offset === 0 && end.offset === 0) {
    const bars = end.bar - start.bar;
    return `over ${bars} bar${bars === 1 ? "" : "s"} from bar ${start.bar + 1}`;
  }
  const beats = (to - from) / score.ticksPerBeat;
  return `over ${fmt(beats)} beat${beats === 1 ? "" : "s"} from beat ${fmt(from / score.ticksPerBeat)}`;
}

function fmt(value: number, digits = 2): string {
  const scale = 10 ** digits;
  return String(Math.round(value * scale) / scale);
}
