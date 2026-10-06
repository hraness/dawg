/**
 * String-returning facade over the cell-buffer highway, kept for the demo
 * path, adapters, and tests that want a whole frame as text.
 *
 * The score shape is deliberately structural.  The session and score packages
 * can adapt their richer values to `TrackScoreSnapshot` without making the TUI
 * depend on either package.
 */

import { paintHighway, resolveBeat } from "./highway.ts";
import { CellBuffer, encodeBuffer } from "./screen.ts";
import { truncate } from "./text.ts";
import {
  detectTerminalCapabilities,
  effectiveTheme,
  onBackground,
  semanticColor,
  type TerminalCapabilities,
  type ThemeName,
} from "./theme.ts";

export {
  detectTerminalCapabilities,
  semanticColor,
  type ColorDepth,
  type SemanticRole,
  type TerminalCapabilities,
} from "./theme.ts";
export {
  drumLaneProjection,
  explicitLaneProjection,
  pitchProjection,
  projectionFor,
  type LaneProjection,
  type NoteSnapshot,
  type TrackScoreSnapshot,
} from "./highway.ts";
import type { TrackScoreSnapshot } from "./highway.ts";

export interface HighwayRenderOptions {
  width: number;
  height: number;
  clock?: () => number;
  capabilities?: TerminalCapabilities;
  reducedMotion?: boolean;
  theme?: ThemeName;
  /** Number of beats visible above the hit line. */
  lookaheadBeats?: number;
}

export function stripAnsi(value: string): string {
  const csi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
  return value.replace(csi, "");
}

/**
 * Render a header row plus the highway as a deterministic frame.  `clock` is
 * injected so tests can freeze a hit flash or a sustain at an exact phase.
 */
export function renderHighway(
  score: TrackScoreSnapshot,
  options: HighwayRenderOptions,
): string {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const capabilities = options.capabilities ?? detectTerminalCapabilities();
  const theme = effectiveTheme(options.theme ?? "default", capabilities);
  const buffer = new CellBuffer(width, height, theme.roles.canvas);
  if (width < 24 || height < 6) {
    const text = truncate("resize terminal", width);
    buffer.text(
      Math.max(0, Math.floor((width - text.length) / 2)),
      Math.floor(height / 2),
      text,
      theme.roles.warning,
    );
    return encodeBuffer(buffer, capabilities);
  }
  const nowMs = (options.clock ?? Date.now)();
  const name = score.trackName ?? score.trackId ?? "track";
  const unicode = capabilities.unicode;
  const transport = score.playing
    ? unicode
      ? "▶"
      : ">"
    : unicode
      ? "⏸"
      : "||";
  const parts = [
    name,
    `${transport} ${score.bpm ?? 120} BPM`,
    score.key,
    score.revision === undefined ? undefined : `rev ${score.revision}`,
    score.activity,
  ].filter((part): part is string => Boolean(part));
  buffer.fill(0, 0, width, 1, theme.roles.panel);
  buffer.text(
    1,
    0,
    truncate(parts.join(" · "), width - 2, unicode ? "…" : "~"),
    onBackground(theme.roles.text, theme.roles.panel),
  );
  paintHighway(
    buffer,
    { x: 0, y: 1, width, height: height - 1 },
    score,
    resolveBeat(score, nowMs),
    {
      theme,
      capabilities,
      reducedMotion: options.reducedMotion ?? false,
      ...(options.lookaheadBeats === undefined
        ? {}
        : { lookaheadBeats: options.lookaheadBeats }),
    },
  );
  return encodeBuffer(buffer, capabilities);
}

/** Aliases kept for adapters that call the surface a piano roll. */
export const renderPianoRoll = renderHighway;
export const renderTrack = renderHighway;
export const render = renderHighway;
export const colorize = semanticColor;
