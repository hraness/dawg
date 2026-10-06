/**
 * Small, dependency-free terminal projection for Track.
 *
 * The score shape is deliberately structural.  The session and score packages
 * can adapt their richer values to `TrackScoreSnapshot` without making the TUI
 * depend on either package.
 */

export type ColorDepth = "truecolor" | "ansi256" | "ansi16" | "none";

export type SemanticRole =
  | "canvas"
  | "panel"
  | "border"
  | "text"
  | "muted"
  | "cursor"
  | "transport"
  | "track"
  | "pending"
  | "selected"
  | "hit"
  | "sustain"
  | "mutedNote"
  | "agent"
  | "success"
  | "warning"
  | "error";

export interface TerminalCapabilities {
  colorDepth: ColorDepth;
  unicode: boolean;
}

export interface NoteSnapshot {
  id?: string | undefined;
  /** Score time in beats. */
  startBeat: number;
  durationBeats?: number | undefined;
  /** MIDI pitch, or a lane number for a drum track. */
  pitch?: number | undefined;
  lane?: number | undefined;
  velocity?: number | undefined;
  selected?: boolean | undefined;
  pending?: boolean | undefined;
  muted?: boolean | undefined;
}

export interface TrackScoreSnapshot {
  notes: readonly NoteSnapshot[];
  trackName?: string | undefined;
  trackId?: string | undefined;
  sessionId?: string | undefined;
  revision?: number | undefined;
  bpm?: number | undefined;
  key?: string | undefined;
  loopBeats?: number | undefined;
  laneCount?: number | undefined;
  /** Optional lane legend (drum voices) drawn just below the hit line. */
  laneLabels?: readonly string[] | undefined;
  /** Static transport position when the score is paused. */
  transportBeat?: number | undefined;
  /** Alias accepted by adapters that call this value currentBeat. */
  currentBeat?: number | undefined;
  transportStartedAtMs?: number | undefined;
  playing?: boolean | undefined;
  activity?: string | undefined;
}

export interface HighwayRenderOptions {
  width: number;
  height: number;
  clock?: () => number;
  capabilities?: TerminalCapabilities;
  reducedMotion?: boolean;
  /** Number of beats visible above the hit line. Defaults to eight. */
  lookaheadBeats?: number;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly ansi256: number;
  readonly ansi16: number;
}

const palette: Record<SemanticRole, Rgb> = {
  canvas: { r: 17, g: 20, b: 26, ansi256: 234, ansi16: 30 },
  panel: { r: 27, g: 32, b: 42, ansi256: 236, ansi16: 30 },
  border: { r: 100, g: 112, b: 132, ansi256: 245, ansi16: 90 },
  text: { r: 225, g: 231, b: 239, ansi256: 253, ansi16: 97 },
  muted: { r: 130, g: 143, b: 164, ansi256: 245, ansi16: 90 },
  cursor: { r: 255, g: 255, b: 255, ansi256: 15, ansi16: 97 },
  transport: { r: 91, g: 211, b: 145, ansi256: 78, ansi16: 92 },
  track: { r: 95, g: 181, b: 255, ansi256: 75, ansi16: 96 },
  pending: { r: 203, g: 168, b: 255, ansi256: 141, ansi16: 95 },
  selected: { r: 255, g: 212, b: 94, ansi256: 221, ansi16: 93 },
  hit: { r: 255, g: 118, b: 99, ansi256: 203, ansi16: 91 },
  sustain: { r: 113, g: 202, b: 255, ansi256: 81, ansi16: 96 },
  mutedNote: { r: 102, g: 111, b: 125, ansi256: 242, ansi16: 90 },
  agent: { r: 255, g: 150, b: 219, ansi256: 212, ansi16: 95 },
  success: { r: 113, g: 220, b: 148, ansi256: 84, ansi16: 92 },
  warning: { r: 255, g: 193, b: 87, ansi256: 221, ansi16: 93 },
  error: { r: 255, g: 108, b: 112, ansi256: 203, ansi16: 91 },
};

const RESET = "\u001b[0m";
const ESC = "\u001b[";

export function detectTerminalCapabilities(
  env: Record<string, string | undefined> = (() => {
    const runtime = globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    };
    return runtime.process?.env ?? {};
  })(),
): TerminalCapabilities {
  const noColor = env.NO_COLOR !== undefined || env.TERM === "dumb";
  let colorDepth: ColorDepth = "ansi16";
  if (noColor) colorDepth = "none";
  else if (
    (env.COLORTERM ?? "").toLowerCase().includes("truecolor") ||
    (env.COLORTERM ?? "").toLowerCase().includes("24bit")
  ) {
    colorDepth = "truecolor";
  } else if ((env.TERM ?? "").includes("256color")) colorDepth = "ansi256";
  return { colorDepth, unicode: env.TERM !== "dumb" };
}

/** Apply a named role while retaining a clean, testable no-color mode. */
export function semanticColor(
  role: SemanticRole,
  value: string,
  capabilities: TerminalCapabilities = detectTerminalCapabilities(),
): string {
  if (capabilities.colorDepth === "none" || value.length === 0) return value;
  const color = palette[role];
  const prefix =
    capabilities.colorDepth === "truecolor"
      ? `${ESC}38;2;${color.r};${color.g};${color.b}m`
      : capabilities.colorDepth === "ansi256"
        ? `${ESC}38;5;${color.ansi256}m`
        : `${ESC}${color.ansi16}m`;
  return `${prefix}${value}${RESET}`;
}

export function stripAnsi(value: string): string {
  const sgr = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return value.replace(sgr, "");
}

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length;
}

function fit(value: string, width: number, truncation = "…"): string {
  const target = Math.max(0, width);
  const plain = stripAnsi(value);
  if (Array.from(plain).length <= target) return plain.padEnd(target, " ");
  if (target <= 1) return plain.slice(0, target);
  return `${Array.from(plain)
    .slice(0, target - 1)
    .join("")}${truncation}`;
}

function styledFit(
  role: SemanticRole,
  value: string,
  width: number,
  capabilities: TerminalCapabilities,
): string {
  return semanticColor(
    role,
    fit(value, width, capabilities.unicode ? "…" : "~"),
    capabilities,
  );
}

function padStyled(value: string, width: number): string {
  const amount = Math.max(0, width - visibleLength(value));
  return `${value}${" ".repeat(amount)}`;
}

function resolveBeat(score: TrackScoreSnapshot, nowMs: number): number {
  const base = score.currentBeat ?? score.transportBeat ?? 0;
  if (!score.playing || score.transportStartedAtMs === undefined) return base;
  const bpm = Math.max(1, score.bpm ?? 120);
  return (
    base + (Math.max(0, nowMs - score.transportStartedAtMs) * bpm) / 60_000
  );
}

function wrapLoopDelta(delta: number, loopBeats: number | undefined): number {
  if (!loopBeats || !Number.isFinite(loopBeats) || loopBeats <= 0) return delta;
  let result = delta;
  while (result < -loopBeats / 2) result += loopBeats;
  while (result > loopBeats / 2) result -= loopBeats;
  return result;
}

function noteRole(
  note: NoteSnapshot,
  delta: number,
  hit: boolean,
): SemanticRole {
  if (note.muted) return "mutedNote";
  if (note.selected) return "selected";
  if (hit) return "hit";
  if (note.pending) return "pending";
  if (delta < 0 && (note.durationBeats ?? 0) > 0) return "sustain";
  return "track";
}

function noteGlyph(
  note: NoteSnapshot,
  delta: number,
  capabilities: TerminalCapabilities,
  nowMs: number,
  reducedMotion: boolean,
): string {
  const fallback = !capabilities.unicode;
  const hit = Math.abs(delta) < 0.16;
  if (hit && !reducedMotion) {
    const phase = Math.floor(nowMs / 90) % 2;
    return fallback ? (phase === 0 ? "*" : "+") : phase === 0 ? "✦" : "✧";
  }
  if (note.muted) return fallback ? "." : "·";
  if (note.pending) return fallback ? "o" : "◇";
  if (note.selected) return fallback ? "@" : "◆";
  if (delta < 0 && (note.durationBeats ?? 0) > 0) return fallback ? "|" : "┃";
  return fallback ? "o" : "●";
}

function compactHeader(
  score: TrackScoreSnapshot,
  width: number,
  capabilities: TerminalCapabilities,
): string {
  const name = score.trackName ?? score.trackId ?? "track";
  const state = capabilities.unicode
    ? score.playing
      ? "▶"
      : "Ⅱ"
    : score.playing
      ? ">"
      : "||";
  const bpm = score.bpm === undefined ? "" : ` ${score.bpm} BPM`;
  const key = score.key ? ` ${score.key}` : "";
  return styledFit("text", `${name} ${state}${bpm}${key}`, width, capabilities);
}

/**
 * Render a complete deterministic frame.  `clock` is injected so PTY tests can
 * freeze a hit flash or a sustain at an exact phase.
 */
export function renderHighway(
  score: TrackScoreSnapshot,
  options: HighwayRenderOptions,
): string {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const capabilities = options.capabilities ?? detectTerminalCapabilities();
  const nowMs = options.clock?.() ?? Date.now();
  const reducedMotion = options.reducedMotion ?? false;
  if (width < 24 || height < 6) {
    const hint = width < 18 ? "resize" : "resize terminal for Track";
    return styledFit("warning", hint, width, capabilities);
  }

  const name = score.trackName ?? score.trackId ?? "track";
  const state = capabilities.unicode
    ? score.playing
      ? "▶ playing"
      : "Ⅱ paused"
    : score.playing
      ? "> playing"
      : "|| paused";
  const metadata = [
    name,
    score.sessionId ? `session ${score.sessionId}` : undefined,
    state,
    score.bpm === undefined ? undefined : `${score.bpm} BPM`,
    score.key,
    score.revision === undefined ? undefined : `rev ${score.revision}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const header =
    width < 48
      ? compactHeader(score, width, capabilities)
      : styledFit("text", metadata, width, capabilities);
  // One row is reserved for the compact activity strip and one for the header.
  const bodyHeight = Math.max(1, height - 2);
  const hitRow = Math.min(
    bodyHeight - 1,
    Math.max(0, Math.floor(bodyHeight * 0.76)),
  );
  const contentWidth = Math.max(1, width - 2);
  const lookahead = Math.max(2, options.lookaheadBeats ?? 8);
  const beatPerRow = lookahead / Math.max(1, hitRow);
  const beat = resolveBeat(score, nowMs);
  const laneCount = Math.max(1, score.laneCount ?? 12);
  const grid: string[][] = Array.from({ length: bodyHeight }, () =>
    Array.from({ length: contentWidth }, () => " "),
  );
  const roles: Array<Array<SemanticRole | undefined>> = Array.from(
    { length: bodyHeight },
    () => Array.from({ length: contentWidth }, () => undefined),
  );

  // Light beat guides keep the highway legible in monochrome too.
  for (let row = 0; row < bodyHeight; row += 1) {
    const rowBeat = beat + (hitRow - row) * beatPerRow;
    if (Math.abs(rowBeat - Math.round(rowBeat)) < beatPerRow * 0.15) {
      for (let column = 0; column < contentWidth; column += 1) {
        grid[row]![column] = capabilities.unicode
          ? row % 4 === 0
            ? "┄"
            : "·"
          : row % 4 === 0
            ? "-"
            : ".";
        roles[row]![column] = "muted";
      }
    }
  }

  // Draw the hit line before notes so a note landing exactly on the line is
  // still visible during its flash.
  const hitGlyph = capabilities.unicode ? "─" : "-";
  for (let column = 0; column < contentWidth; column += 1) {
    grid[hitRow]![column] = hitGlyph;
    roles[hitRow]![column] = "border";
  }

  // Lane legend sits under the hit line; passing notes draw over it.
  drawLaneLabels(score, grid, roles, hitRow + 1, contentWidth, laneCount);

  for (const note of score.notes) {
    if (!Number.isFinite(note.startBeat)) continue;
    const duration = Math.max(0, note.durationBeats ?? 0);
    const delta = wrapLoopDelta(note.startBeat - beat, score.loopBeats);
    if (
      delta < -Math.max(1, duration) - beatPerRow * 2 ||
      delta > lookahead + beatPerRow
    )
      continue;
    const center = hitRow - Math.round(delta / beatPerRow);
    const end = hitRow - Math.round((delta + duration) / beatPerRow);
    const top = Math.max(0, Math.min(center, end));
    const bottom = Math.min(bodyHeight - 1, Math.max(center, end));
    const lane = note.lane ?? note.pitch ?? 0;
    const normalized =
      note.lane === undefined
        ? Math.max(0, Math.min(127, lane)) / 127
        : Math.max(0, Math.min(laneCount - 1, lane)) /
          Math.max(1, laneCount - 1);
    const x = Math.max(
      0,
      Math.min(contentWidth - 1, Math.round(normalized * (contentWidth - 1))),
    );
    const extent =
      duration > 0
        ? Math.max(
            1,
            Math.min(8, Math.round((duration / lookahead) * contentWidth)),
          )
        : 1;
    const hit = Math.abs(delta) < 0.16;
    const role = noteRole(note, delta, hit);
    const glyph = noteGlyph(note, delta, capabilities, nowMs, reducedMotion);
    for (let row = top; row <= bottom; row += 1) {
      for (
        let offset = 0;
        offset < extent && x + offset < contentWidth;
        offset += 1
      ) {
        const column = x + offset;
        grid[row]![column] =
          row === center || duration === 0
            ? glyph
            : capabilities.unicode
              ? "━"
              : "-";
        roles[row]![column] = role;
      }
    }
  }

  const rows: string[] = [header];
  for (let row = 0; row < bodyHeight; row += 1) {
    let rendered = "";
    for (let column = 0; column < contentWidth; column += 1) {
      const value = grid[row]![column]!;
      const role = roles[row]![column];
      rendered += role ? semanticColor(role, value, capabilities) : value;
    }
    rows.push(capabilities.unicode ? `│${rendered}│` : `|${rendered}|`);
  }
  const activity = score.activity
    ? ` ${score.activity}`
    : " ready · [u] undo · [space] pause · [o] inspect";
  rows.push(styledFit("muted", activity, width, capabilities));
  return rows.map((row) => padStyled(row, width)).join("\n");
}

function drawLaneLabels(
  score: TrackScoreSnapshot,
  grid: string[][],
  roles: Array<Array<SemanticRole | undefined>>,
  row: number,
  contentWidth: number,
  laneCount: number,
): void {
  const labels = score.laneLabels;
  if (!labels || row >= grid.length) return;
  const slot = Math.floor(contentWidth / Math.max(1, laneCount));
  labels.slice(0, laneCount).forEach((label, lane) => {
    const x = Math.round(
      (lane / Math.max(1, laneCount - 1)) * (contentWidth - 1),
    );
    const text = label.slice(0, Math.max(1, slot - 1));
    const start = Math.max(0, Math.min(contentWidth - text.length, x));
    for (let offset = 0; offset < text.length; offset += 1) {
      grid[row]![start + offset] = text[offset]!;
      roles[row]![start + offset] = "muted";
    }
  });
}

/** Alias kept for adapters that call the surface a piano roll. */
export const renderPianoRoll = renderHighway;
export const renderTrack = renderHighway;
export const render = renderHighway;
export const colorize = semanticColor;
