/**
 * `/calibration [0|1|latest|off]`: the song's sound calibration revision
 * (core/score.ts CALIBRATION_LATEST). 0 (or off) keeps the 0.4 to 0.6.1
 * sound byte-identical; 1 renders the 0.7 hat choke, tuned toms, crash and
 * ride, levelled keys and steady lip brass. The menu and the agent's
 * set_calibration tool run the same command.
 */

import {
  applyScoreOperation,
  CALIBRATION_LATEST,
  type TrackScore,
} from "../../core/score.ts";

export type CalibrationCommand =
  | Readonly<{ type: "calibration-show" }>
  | Readonly<{ type: "calibration-set"; calibration: number }>
  | Readonly<{ type: "calibration-invalid"; message: string }>;

export type CalibrationResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: "score.calibration";
  payload?: Record<string, unknown>;
}>;

const USAGE = `calibration · /calibration 0..${CALIBRATION_LATEST}|latest|off`;

export function parseCalibrationCommand(
  text: string,
): CalibrationCommand | undefined {
  const words = text.trim().replace(/^\//, "").split(/\s+/);
  if (words[0]?.toLowerCase() !== "calibration") return undefined;
  if (words.length === 1) return { type: "calibration-show" };
  if (words.length > 2) return { type: "calibration-invalid", message: USAGE };
  const word = words[1]!.toLowerCase();
  if (word === "latest")
    return { type: "calibration-set", calibration: CALIBRATION_LATEST };
  if (word === "off" || word === "legacy")
    return { type: "calibration-set", calibration: 0 };
  if (/^\d$/.test(word) && Number(word) <= CALIBRATION_LATEST)
    return { type: "calibration-set", calibration: Number(word) };
  return { type: "calibration-invalid", message: USAGE };
}

export function calibrationLabel(calibration: number | undefined): string {
  return calibration ? String(calibration) : "0 (legacy)";
}

export function applyCalibrationCommand(
  score: TrackScore,
  command: CalibrationCommand,
): CalibrationResult {
  if (command.type === "calibration-invalid")
    return { ok: false, message: command.message };
  if (command.type === "calibration-show")
    return {
      ok: true,
      message: `calibration · ${calibrationLabel(score.calibration)} · latest ${CALIBRATION_LATEST}`,
    };
  const calibration = command.calibration || null;
  const next = applyScoreOperation(score, {
    type: "setCalibration",
    calibration,
  });
  return {
    ok: true,
    message: `calibration · ${calibrationLabel(next.calibration)}`,
    next,
    kind: "score.calibration",
    payload: { calibration },
  };
}
