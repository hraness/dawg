/**
 * Whether a prompt line is a command the human prompt bar runs locally (no
 * model call): every command parser the prompt tries, in one list. The TUI
 * uses it for typo fixes; show-me (src/agent/show-me.ts) uses it in tests to
 * prove every command it ghost-types is one a human can type.
 */
import type { TrackScore } from "../../core/score.ts";
import { parsePrompt } from "../agent/ops.ts";
import { parseSectionCommand } from "./arrange.ts";
import { parseAutotuneCommand } from "./autotune.ts";
import { parseClipCommand, parseLyricsCommand } from "./clips.ts";
import { parsePatternCommand } from "./drums.ts";
import { parseEditCommand } from "./edit.ts";
import { parseExpressionCommand } from "./expression.ts";
import { parseFitCommand } from "./fit.ts";
import { parseFormantCommand, parseVowelCommand } from "./formant.ts";
import { parseFxCommand } from "./fx.ts";
import { parseGranularCommand } from "./granular.ts";
import { parseKeysCommand } from "./keys.ts";
import { parseMasterCommand } from "./master.ts";
import { parseModalCommand } from "./modal.ts";
import { parseMusicCommand } from "./music.ts";
import { parseKitCommand, parsePackCommand } from "./pack.ts";
import { parseResampleCommand } from "./resample.ts";
import { parseRhythmCommand } from "./rhythm.ts";
import { parseRigCommand } from "./rig.ts";
import { parseSampleCommand } from "./sample.ts";
import { parseShiftCommand } from "./shift.ts";
import { parseSingCommand } from "./sing.ts";
import { parseStringCommand } from "./string.ts";
import { parseGuitarCommand, parseStrumCommand } from "./strum.ts";
import { parseSynthCommand } from "./synth.ts";
import { parseTimeCommand } from "./time.ts";
import { parseTuningCommand } from "./tuning.ts";
import { parseVocalCommand } from "./vocal.ts";
import { parseVocoderCommand } from "./vocoder.ts";
import { parseWavetableCommand } from "./wavetable.ts";
import { parseWindCommand } from "./wind.ts";

export function commandParses(text: string, score: TrackScore): boolean {
  return [
    parsePrompt,
    parseMusicCommand,
    parseEditCommand,
    parseRhythmCommand,
    parseFxCommand,
    parseSynthCommand,
    parseStringCommand,
    parseGranularCommand,
    parseKeysCommand,
    parseExpressionCommand,
    parseMasterCommand,
    (value: string) => parseSectionCommand(value, score),
    parsePatternCommand,
    parseKitCommand,
    parsePackCommand,
    parseSampleCommand,
    parseFitCommand,
    parseShiftCommand,
    parseResampleCommand,
    parseWavetableCommand,
    parseTimeCommand,
    parseTuningCommand,
    parseRigCommand,
    parseModalCommand,
    parseGuitarCommand,
    parseStrumCommand,
    parseWindCommand,
    parseAutotuneCommand,
    parseSingCommand,
    parseVocoderCommand,
    parseVocalCommand,
    parseFormantCommand,
    parseVowelCommand,
    parseClipCommand,
    parseLyricsCommand,
  ].some((parse) => parse(text) !== undefined);
}
