/**
 * Hand-editing commands the menus emit that the prompt grammar lacked. Each
 * is one ScoreOperation, so it is one revision and one undo step.
 *
 *   track name <text>                       rename the focused track
 *   meter <beats per bar>                   time signature numerator (1..16)
 *   key <name>|none                         song key (`C major`, `F# dorian`)
 *   automate <lane> points <beat:value>...  merge points into a lane
 *   automate <lane> remove <beat>           drop the point at a beat
 *
 * Lanes are every AUTOMATION_LANES key plus the effect aliases (`cutoff`,
 * `res`, `feedback`, `delay-fb`). Parsing is pure; applying returns the next
 * score and the session event, leaving persistence to the caller.
 */
import {
  AUTOMATION_PARAMETERS,
  automationPoints,
  automationRange,
  SCORE_LIMITS,
  applyScoreOperation,
  type AutomationParameter,
  type AutomationPoint,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { keyName, parseKey } from "../../core/chords.ts";
import { parseEffectLane } from "./music.ts";

export type EditCommand =
  | { type: "track-name"; name: string }
  | { type: "meter"; beatsPerBar: number }
  | { type: "key"; key: string | null }
  | {
      type: "automation-points";
      parameter: AutomationParameter;
      points: readonly { beat: number; value: number }[];
    }
  | { type: "automation-remove"; parameter: AutomationParameter; beat: number };

export function parseLane(name: string): AutomationParameter | undefined {
  const lower = name.toLowerCase();
  if (lower === "volume" || lower === "vol") return "volume";
  if (lower === "pan") return "pan";
  // Lanes are typed in any case: `synth-pitchjump` is `synth-pitchJump`.
  return (
    parseEffectLane(lower) ??
    parseEffectLane(
      AUTOMATION_PARAMETERS.find((lane) => lane.toLowerCase() === lower) ?? "",
    )
  );
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function parseEditCommand(prompt: string): EditCommand | undefined {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (text.length > 1_024) return undefined;
  const name = text.match(/^track name (.+)$/i);
  if (name) {
    const value = name[1]!.trim();
    return value.length > 0 && value.length <= SCORE_LIMITS.maxNameLength
      ? { type: "track-name", name: value }
      : undefined;
  }
  const meter = text.match(/^meter (\d+)$/i);
  if (meter) {
    const beatsPerBar = Number(meter[1]);
    return beatsPerBar >= 1 && beatsPerBar <= SCORE_LIMITS.maxBeatsPerBar
      ? { type: "meter", beatsPerBar }
      : undefined;
  }
  const key = text.match(/^\/?key (.+)$/i);
  if (key) {
    const value = key[1]!.trim();
    if (/^(none|off|clear)$/i.test(value)) return { type: "key", key: null };
    const parsed = parseKey(value);
    return parsed ? { type: "key", key: keyName(parsed) } : undefined;
  }
  const points = text.match(/^automate ([a-z0-9-]+) points((?: \S+)+)$/i);
  if (points) {
    const parameter = parseLane(points[1]!);
    if (!parameter) return undefined;
    const { min, max } = automationRange(parameter);
    const parsed: { beat: number; value: number }[] = [];
    for (const pair of points[2]!.trim().split(" ")) {
      const [beatText, valueText, extra] = pair.split(":");
      if (extra !== undefined || !beatText || !valueText) return undefined;
      if (!NUMBER.test(beatText) || !NUMBER.test(valueText)) return undefined;
      const beat = Number(beatText);
      const value = Number(valueText);
      if (beat > SCORE_LIMITS.maxTick) return undefined;
      if (value < min || value > max) return undefined;
      parsed.push({ beat, value });
    }
    if (parsed.length === 0 || parsed.length > SCORE_LIMITS.maxAutomationPoints)
      return undefined;
    return { type: "automation-points", parameter, points: parsed };
  }
  const remove = text.match(/^automate ([a-z0-9-]+) remove (\d+(?:\.\d+)?)$/i);
  if (remove) {
    const parameter = parseLane(remove[1]!);
    return parameter
      ? { type: "automation-remove", parameter, beat: Number(remove[2]) }
      : undefined;
  }
  return undefined;
}

export type EditResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** Apply `command` to `trackId` as one ScoreOperation. */
export function applyEditCommand(
  score: TrackScore,
  trackId: string,
  command: EditCommand,
): EditResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (command.type === "meter") {
    const operation: ScoreOperation = {
      type: "setMeter",
      beatsPerBar: command.beatsPerBar,
    };
    return {
      ok: true,
      message: `meter · ${command.beatsPerBar}/4`,
      next: applyScoreOperation(score, operation),
      kind: "score.meter",
      payload: { beatsPerBar: command.beatsPerBar },
    };
  }
  if (command.type === "key") {
    return {
      ok: true,
      message: `key · ${command.key ?? "none"}`,
      next: applyScoreOperation(score, { type: "setKey", key: command.key }),
      kind: "score.key",
      payload: { key: command.key },
    };
  }
  if (!track) return { ok: false, message: `no track ${trackId}` };
  if (command.type === "track-name") {
    const patch = { name: command.name };
    return {
      ok: true,
      message: `track name · ${command.name}`,
      next: applyScoreOperation(score, {
        type: "updateTrack",
        trackId,
        patch,
      }),
      kind: "score.track",
      payload: { trackId, patch },
    };
  }
  const current: readonly AutomationPoint[] = automationPoints(
    track,
    command.parameter,
  );
  let points: AutomationPoint[];
  if (command.type === "automation-points") {
    const byTick = new Map(current.map((point) => [point.tick, point]));
    for (const point of command.points) {
      const tick = Math.max(0, Math.round(point.beat * score.ticksPerBeat));
      byTick.set(tick, { tick, value: point.value });
    }
    points = [...byTick.values()].sort((left, right) => left.tick - right.tick);
    if (points.length > SCORE_LIMITS.maxAutomationPoints)
      return {
        ok: false,
        message: `${command.parameter} automation holds ${SCORE_LIMITS.maxAutomationPoints} points`,
      };
  } else {
    const tick = Math.round(command.beat * score.ticksPerBeat);
    points = current.filter((point) => point.tick !== tick);
    if (points.length === current.length)
      return {
        ok: false,
        message: `no ${command.parameter} point at beat ${command.beat} · the ${command.parameter} lane shows them · help automate`,
      };
  }
  return {
    ok: true,
    message: `automation · ${command.parameter} ${points.length} point${points.length === 1 ? "" : "s"}`,
    next: applyScoreOperation(score, {
      type: "setAutomation",
      trackId,
      parameter: command.parameter,
      points,
    }),
    kind: "score.automation",
    payload: { trackId, parameter: command.parameter, points },
  };
}
