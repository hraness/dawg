/**
 * Frame composition and UI state for the interactive Track TUI.
 *
 *   ┌ header: track · session · ▶ BPM · model · rev · sync ┐
 *   │ highway (notes fall toward the hit line)              │
 *   │ activity strip: spinner, operation cards, queue depth │
 *   └ prompt panel: bg fill, mode pill, wrapped draft       ┘
 *
 * `composeFrame` is pure (view + UI state + size + time → cell buffer), so
 * tests snapshot exact frames.  `TuiApp` owns the mutable UI state (prompt,
 * activity feed, theme, motion, overlay) and writes differential frames to an
 * injectable `TerminalIO`.
 */

import {
  ActivityFeed,
  revisionLabel,
  spinnerFrame,
  type ActivityCard,
  type TranscriptEntry,
} from "./activity.ts";
import {
  paintHighway,
  resolveBeat,
  type TrackScoreSnapshot,
} from "./highway.ts";
import { classifyKey, type UiCommand } from "./keys.ts";
import { PromptModel, type PromptAction, type PromptMode } from "./prompt.ts";
import { CellBuffer, ScreenWriter, type CursorPosition } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import {
  accentStyle,
  detectTerminalCapabilities,
  effectiveTheme,
  onBackground,
  parseThemeName,
  shade,
  THEME_NAMES,
  type Style,
  type TerminalCapabilities,
  type Theme,
  type ThemeName,
} from "./theme.ts";

export type SyncState = "synced" | "syncing" | "conflict" | "offline" | "local";

export interface AppView {
  score: TrackScoreSnapshot;
  /** Transport beat; when omitted it is derived from the snapshot. */
  beat?: number | undefined;
  model?: string | undefined;
  sync?: SyncState | undefined;
  /** Human session name; replaces the short id in the header when set. */
  sessionName?: string | undefined;
  /** Live windows on this session (presence); shown when more than one. */
  windows?: number | undefined;
}

export interface UiState {
  prompt: PromptModel;
  activity: ActivityFeed;
  theme: Theme;
  capabilities: TerminalCapabilities;
  reducedMotion: boolean;
  overlay: "log" | undefined;
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface Frame {
  buffer: CellBuffer;
  cursor: CursorPosition | undefined;
  /** Rows used by the prompt editor (excluding borders). */
  promptRows: number;
  layout: FrameLayout;
}

export interface FrameLayout {
  header: number;
  highway: { y: number; height: number };
  activity: number;
  prompt: { y: number; height: number };
  /** Editor rows inside the prompt panel. */
  promptRows: number;
  /** Whether the prompt panel has a bottom border with key hints. */
  footer: boolean;
  tooSmall: boolean;
}

export const MIN_WIDTH = 24;
export const MIN_HEIGHT = 8;
export const MAX_PROMPT_ROWS = 8;
/** New cards glow for this long before settling. */
export const CARD_GLOW_MS = 700;

/** Prompt rows allowed for a viewport: 1..8, capped at 30% of its height. */
export function promptRowCap(height: number): number {
  return Math.max(1, Math.min(MAX_PROMPT_ROWS, Math.floor(height * 0.3)));
}

/** Width available to the prompt editor inside the panel. */
export function promptEditorWidth(width: number): number {
  // "│ › " + text + cursor cell + " │"
  return Math.max(4, width - 7);
}

interface Box {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}
const UNICODE_BOX: Box = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
};
const ASCII_BOX: Box = { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

export function computeLayout(
  size: FrameSize,
  promptWrappedRows: number,
): FrameLayout {
  const tooSmall = size.width < MIN_WIDTH || size.height < MIN_HEIGHT;
  const rows = Math.max(
    1,
    Math.min(promptWrappedRows, promptRowCap(size.height)),
  );
  const footer = size.height >= 16 ? 1 : 0;
  const promptHeight = 1 + rows + footer;
  const promptY = size.height - promptHeight;
  const activity = promptY - 1;
  const highwayY = 1;
  return {
    header: 0,
    highway: { y: highwayY, height: Math.max(0, activity - highwayY) },
    activity,
    prompt: { y: promptY, height: promptHeight },
    promptRows: rows,
    footer: footer === 1,
    tooSmall,
  };
}

// ---------------------------------------------------------------------------
// Header

interface Segment {
  text: string;
  style: Style;
  /** Lower numbers survive longer when space is short. */
  priority: number;
}

function paintSegments(
  buffer: CellBuffer,
  y: number,
  segments: Segment[],
  width: number,
  separator: string,
  separatorStyle: Style,
  background: Style,
  rightSegments: Segment[] = [],
): void {
  const sepWidth = displayWidth(separator);
  const total = (list: Segment[]) =>
    list.reduce((sum, segment) => sum + displayWidth(segment.text), 0) +
    Math.max(0, list.length - 1) * sepWidth;
  let left = [...segments];
  let right = [...rightSegments];
  const fits = () =>
    total(left) + (right.length ? total(right) + 2 : 0) + 2 <= width;
  while (!fits()) {
    const all = [...left, ...right];
    if (all.length <= 1) break;
    const worst = all.reduce((a, b) => (b.priority > a.priority ? b : a));
    left = left.filter((segment) => segment !== worst);
    right = right.filter((segment) => segment !== worst);
  }
  buffer.fill(0, y, width, 1, background);
  let x = 1;
  left.forEach((segment, index) => {
    if (index > 0)
      x += buffer.text(
        x,
        y,
        separator,
        onBackground(separatorStyle, background),
      );
    x += buffer.text(
      x,
      y,
      truncate(segment.text, Math.max(1, width - x - 1)),
      onBackground(segment.style, background),
    );
  });
  if (right.length) {
    let rx = width - 1 - total(right);
    if (rx <= x) return;
    right.forEach((segment, index) => {
      if (index > 0)
        rx += buffer.text(
          rx,
          y,
          separator,
          onBackground(separatorStyle, background),
        );
      rx += buffer.text(
        rx,
        y,
        segment.text,
        onBackground(segment.style, background),
      );
    });
  }
}

function syncSegment(
  sync: SyncState | undefined,
  theme: Theme,
  unicode: boolean,
): Segment | undefined {
  if (!sync) return undefined;
  const glyph: Record<SyncState, string> = unicode
    ? {
        synced: "●",
        syncing: "◌",
        conflict: "▲",
        offline: "✗",
        local: "○",
      }
    : { synced: "*", syncing: "o", conflict: "!", offline: "x", local: "o" };
  const style: Record<SyncState, Style> = {
    synced: theme.roles.success,
    syncing: theme.roles.muted,
    conflict: theme.roles.warning,
    offline: theme.roles.error,
    local: theme.roles.muted,
  };
  return { text: `${glyph[sync]} ${sync}`, style: style[sync], priority: 4 };
}

function paintHeader(
  buffer: CellBuffer,
  view: AppView,
  ui: UiState,
  width: number,
): void {
  const { theme, capabilities } = ui;
  const roles = theme.roles;
  const score = view.score;
  const unicode = capabilities.unicode;
  const playing = score.playing === true;
  const transport = `${playing ? (unicode ? "▶" : ">") : unicode ? "⏸" : "||"} ${score.bpm ?? 120} BPM`;
  const name = score.trackName ?? score.trackId ?? "track";
  const left: Segment[] = [
    { text: "track", style: { ...roles.muted, bold: true }, priority: 6 },
    {
      text: name,
      style: { ...accentStyle(theme, score.trackId ?? name), bold: true },
      priority: 0,
    },
    {
      text: transport,
      style: playing ? roles.transport : roles.paused,
      priority: 0,
    },
  ];
  if (score.key)
    left.push({ text: score.key, style: roles.muted, priority: 5 });
  if (view.sessionName)
    left.push({ text: view.sessionName, style: roles.muted, priority: 3 });
  else if (score.sessionId)
    left.push({
      text: `session ${score.sessionId.slice(0, 8)}`,
      style: roles.muted,
      priority: 3,
    });
  if (view.windows !== undefined && view.windows > 1)
    left.push({
      text: `${view.windows} windows`,
      style: roles.muted,
      priority: 4,
    });
  const right: Segment[] = [];
  if (view.model)
    right.push({ text: view.model, style: roles.agent, priority: 2 });
  if (score.revision !== undefined)
    right.push({
      text: `rev ${score.revision}`,
      style: roles.text,
      priority: 1,
    });
  const sync = syncSegment(view.sync, theme, unicode);
  if (sync) right.push(sync);
  paintSegments(buffer, 0, left, width, " · ", roles.faint, roles.panel, right);
}

// ---------------------------------------------------------------------------
// Activity strip

function cardMarker(card: ActivityCard, unicode: boolean): string {
  switch (card.tone) {
    case "error":
      return unicode ? "✗" : "x";
    case "warning":
      return "!";
    case "agent":
      return unicode ? "◆" : "*";
    case "success":
      return unicode ? "✓" : "+";
    default:
      return unicode ? "•" : "-";
  }
}

export function cardText(card: ActivityCard, unicode: boolean): string {
  const parts = [`${cardMarker(card, unicode)} ${card.text}`];
  const revision = revisionLabel(
    card.baseRevision,
    card.resultRevision,
    unicode,
  );
  if (revision) parts.push(revision);
  if (card.hint) parts.push(card.hint);
  return parts.join(" · ");
}

function paintActivity(
  buffer: CellBuffer,
  y: number,
  ui: UiState,
  width: number,
  nowMs: number,
): void {
  const { theme, capabilities, activity } = ui;
  const roles = theme.roles;
  const background = roles.canvas;
  buffer.fill(0, y, width, 1, background);
  let x = 1;
  const right: string[] = [];
  if (activity.queueDepth > 0) right.push(`queue ${activity.queueDepth}`);
  if (ui.reducedMotion) right.push("motion off");
  const rightText = right.join(" · ");
  const limit = width - 1 - (rightText ? displayWidth(rightText) + 2 : 0);
  const spinner = activity.spinner;
  if (spinner) {
    const frame = spinnerFrame(
      nowMs - spinner.sinceMs,
      capabilities.unicode,
      ui.reducedMotion,
    );
    x += buffer.text(x, y, `${frame} `, roles.agent);
    x += buffer.text(x, y, truncate(spinner.label, Math.max(0, limit - x)), {
      ...roles.agent,
      bold: true,
    });
    if (activity.streaming && x < limit - 4) {
      x += buffer.text(x, y, " · ", roles.faint);
      const tail = activity.streaming;
      const room = Math.max(0, limit - x);
      const shown =
        displayWidth(tail) > room
          ? `…${Array.from(tail)
              .slice(-(room - 1))
              .join("")}`
          : tail;
      x += buffer.text(x, y, truncate(shown, room), roles.muted);
    }
  } else {
    const cards = [...activity.cards].reverse();
    cards.forEach((card, index) => {
      if (x >= limit) return;
      const text = cardText(card, capabilities.unicode);
      if (index > 0) {
        if (x + 3 + Math.min(12, displayWidth(text)) > limit) {
          x = limit;
          return;
        }
        x += buffer.text(x, y, "   ", background);
      }
      const age = nowMs - card.atMs;
      let style: Style =
        card.tone === "error"
          ? roles.error
          : card.tone === "warning"
            ? roles.warning
            : card.tone === "agent"
              ? roles.agent
              : card.tone === "success"
                ? roles.success
                : roles.text;
      if (index > 0) style = card.tone === "error" ? roles.error : roles.faint;
      else if (!ui.reducedMotion && age >= 0 && age < CARD_GLOW_MS)
        style = { ...shade(style, 0.4 * (1 - age / CARD_GLOW_MS)), bold: true };
      x += buffer.text(x, y, truncate(text, Math.max(0, limit - x)), style);
    });
    if (cards.length === 0)
      buffer.text(
        x,
        y,
        truncate(
          "type a request · space plays on an empty prompt · /help",
          limit - x,
        ),
        roles.faint,
      );
  }
  if (rightText)
    buffer.text(width - 1 - displayWidth(rightText), y, rightText, roles.muted);
}

// ---------------------------------------------------------------------------
// Prompt panel

function pill(mode: PromptMode): string {
  return mode === "queue" ? " QUEUE " : " STEER ";
}

function paintPrompt(
  buffer: CellBuffer,
  view: AppView,
  ui: UiState,
  layout: FrameLayout,
  width: number,
): { cursor: CursorPosition; rows: number } {
  const { theme, capabilities, prompt, activity } = ui;
  const roles = theme.roles;
  const box = capabilities.unicode ? UNICODE_BOX : ASCII_BOX;
  const panel: Style = { ...roles.promptBg };
  const border = onBackground(roles.borderFocus, panel);
  const top = layout.prompt.y;
  const height = layout.prompt.height;
  buffer.fill(0, top, width, height, panel);
  const rows = layout.promptRows;

  // Top border with the mode pill and right-aligned status.
  buffer.set(0, top, box.tl, border);
  for (let x = 1; x < width - 1; x += 1) buffer.set(x, top, box.h, border);
  buffer.set(width - 1, top, box.tr, border);
  const mode = prompt.snapshot.mode;
  const pillStyle = mode === "queue" ? roles.pillQueue : roles.pillSteer;
  let x = 2;
  x += buffer.text(x, top, pill(mode), pillStyle);
  const status: string[] = [];
  if (view.model) status.push(view.model);
  if (activity.queueDepth > 0) status.push(`queue ${activity.queueDepth}`);
  const layoutInfo = prompt.layout(rows);
  if (layoutInfo.total > rows)
    status.push(
      `${layoutInfo.first + layoutInfo.cursorRow + 1}/${layoutInfo.total}`,
    );
  const statusText = ` ${status.join(" · ")} `;
  if (status.length && width - 2 - displayWidth(statusText) > x + 1)
    buffer.text(
      width - 2 - displayWidth(statusText),
      top,
      statusText,
      onBackground(roles.muted, panel),
    );

  // Editor rows.
  const text = onBackground(roles.promptText, panel);
  const faint = onBackground(roles.faint, panel);
  const editorWidth = promptEditorWidth(width);
  for (let index = 0; index < rows; index += 1) {
    const y = top + 1 + index;
    buffer.set(0, y, box.v, border);
    buffer.set(width - 1, y, box.v, border);
    const row = layoutInfo.rows[index];
    const isFirst = layoutInfo.first + index === 0;
    buffer.text(
      2,
      y,
      isFirst ? (capabilities.unicode ? "›" : ">") : " ",
      onBackground(roles.borderFocus, panel),
    );
    if (row) buffer.text(4, y, row.text, text, editorWidth + 1);
    if (index === 0 && layoutInfo.first > 0)
      buffer.text(width - 3, y, capabilities.unicode ? "↑" : "^", faint);
    if (index === rows - 1 && layoutInfo.first + rows < layoutInfo.total)
      buffer.text(width - 3, y, capabilities.unicode ? "↓" : "v", faint);
  }
  if (prompt.value.length === 0) {
    const placeholder =
      mode === "queue"
        ? "queue a request for after the current one…"
        : "describe a change — “add a walking bass in A minor”";
    buffer.text(5, top + 1, truncate(placeholder, editorWidth - 1), faint);
  }

  // Footer hints.
  if (layout.footer) {
    const y = top + height - 1;
    buffer.set(0, y, box.bl, border);
    for (let column = 1; column < width - 1; column += 1)
      buffer.set(column, y, box.h, border);
    buffer.set(width - 1, y, box.br, border);
    const hints =
      width >= 100
        ? " enter send · shift+enter newline · ^q queue · ^z undo · ^o log · ^c quit "
        : width >= 72
          ? " enter send · ^j newline · ^q queue · ^z undo · ^o log "
          : width >= 44
            ? " enter · ^q queue · ^z undo · ^o log "
            : "";
    const shown = hints;
    if (shown) buffer.text(2, y, shown, onBackground(roles.muted, panel));
  }

  // Cursor: shown as a reverse cell and as the real terminal cursor.
  const cursorX = Math.min(width - 2, 4 + layoutInfo.cursorColumn);
  const cursorY = top + 1 + Math.min(rows - 1, layoutInfo.cursorRow);
  const under = buffer.get(cursorX, cursorY);
  buffer.set(
    cursorX,
    cursorY,
    under && under.ch !== "" && prompt.value.length > 0 ? under.ch : " ",
    { ...text, ...roles.cursor },
  );
  return { cursor: { x: cursorX, y: cursorY }, rows };
}

// ---------------------------------------------------------------------------
// Transcript overlay

const KIND_TAGS: Record<TranscriptEntry["kind"], string> = {
  request: "you",
  op: "op ",
  revision: "rev",
  error: "ERR",
  agent: "ai ",
  note: "   ",
};

function paintOverlay(
  buffer: CellBuffer,
  ui: UiState,
  region: { y: number; height: number },
  width: number,
): void {
  const { theme, capabilities, activity } = ui;
  const roles = theme.roles;
  const box = capabilities.unicode ? UNICODE_BOX : ASCII_BOX;
  const panel = roles.panel;
  const border = onBackground(roles.border, panel);
  const left = width >= 60 ? 2 : 0;
  const boxWidth = width - left * 2;
  const top = region.y;
  const height = region.height;
  if (height < 3 || boxWidth < 10) return;
  buffer.fill(left, top, boxWidth, height, panel);
  buffer.set(left, top, box.tl, border);
  buffer.set(left + boxWidth - 1, top, box.tr, border);
  buffer.set(left, top + height - 1, box.bl, border);
  buffer.set(left + boxWidth - 1, top + height - 1, box.br, border);
  for (let x = left + 1; x < left + boxWidth - 1; x += 1) {
    buffer.set(x, top, box.h, border);
    buffer.set(x, top + height - 1, box.h, border);
  }
  for (let y = top + 1; y < top + height - 1; y += 1) {
    buffer.set(left, y, box.v, border);
    buffer.set(left + boxWidth - 1, y, box.v, border);
  }
  buffer.text(
    left + 2,
    top,
    " transcript · requests, ops, revisions, errors ",
    onBackground({ ...roles.text, bold: true }, panel),
    boxWidth - 4,
  );
  const hint = " esc close ";
  if (boxWidth > 60)
    buffer.text(
      left + boxWidth - 2 - hint.length,
      top + height - 1,
      hint,
      onBackground(roles.muted, panel),
    );
  const inner = height - 2;
  const entries = activity.transcript.slice(-inner);
  if (entries.length === 0)
    buffer.text(
      left + 2,
      top + 1,
      "nothing yet",
      onBackground(roles.faint, panel),
    );
  entries.forEach((entry, index) => {
    const y = top + 1 + index;
    const tagStyle =
      entry.kind === "error"
        ? roles.error
        : entry.kind === "request"
          ? roles.borderFocus
          : entry.kind === "agent"
            ? roles.agent
            : roles.muted;
    buffer.text(
      left + 2,
      y,
      KIND_TAGS[entry.kind],
      onBackground({ ...tagStyle, bold: true }, panel),
    );
    buffer.text(
      left + 6,
      y,
      truncate(entry.text.replace(/\s+/g, " "), boxWidth - 8),
      onBackground(entry.kind === "error" ? roles.error : roles.text, panel),
    );
  });
}

// ---------------------------------------------------------------------------

function paintTooSmall(buffer: CellBuffer, ui: UiState, size: FrameSize): void {
  const roles = ui.theme.roles;
  const lines = [
    "resize terminal",
    `${size.width}x${size.height} · need ${MIN_WIDTH}x${MIN_HEIGHT}`,
  ];
  const top = Math.max(0, Math.floor((size.height - lines.length) / 2));
  lines.forEach((line, index) => {
    const text = truncate(line, size.width);
    const x = Math.max(0, Math.floor((size.width - displayWidth(text)) / 2));
    buffer.text(
      x,
      top + index,
      text,
      index === 0 ? roles.warning : roles.muted,
    );
  });
}

export function composeFrame(
  view: AppView,
  ui: UiState,
  size: FrameSize,
  nowMs: number,
): Frame {
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));
  const buffer = new CellBuffer(width, height, ui.theme.roles.canvas);
  ui.prompt.setWidth(promptEditorWidth(width));
  const layout = computeLayout({ width, height }, ui.prompt.wrappedRows);
  if (layout.tooSmall) {
    paintTooSmall(buffer, ui, { width, height });
    return { buffer, cursor: undefined, promptRows: 0, layout };
  }
  paintHeader(buffer, view, ui, width);
  const beat = view.beat ?? resolveBeat(view.score, nowMs);
  if (layout.highway.height > 0) {
    if (ui.overlay === "log") paintOverlay(buffer, ui, layout.highway, width);
    else
      paintHighway(
        buffer,
        { x: 0, y: layout.highway.y, width, height: layout.highway.height },
        view.score,
        beat,
        {
          theme: ui.theme,
          capabilities: ui.capabilities,
          reducedMotion: ui.reducedMotion,
        },
      );
  }
  paintActivity(buffer, layout.activity, ui, width, nowMs);
  const prompt = paintPrompt(buffer, view, ui, layout, width);
  return { buffer, cursor: prompt.cursor, promptRows: prompt.rows, layout };
}

// ---------------------------------------------------------------------------
// Mutable app

export interface TerminalIO {
  write(data: string): void;
  columns(): number;
  rows(): number;
}

export interface TuiAppOptions {
  io: TerminalIO;
  capabilities?: TerminalCapabilities;
  theme?: ThemeName;
  reducedMotion?: boolean;
  clock?: () => number;
  prompt?: PromptModel;
  activity?: ActivityFeed;
}

export type AppInput =
  | { type: "action"; action: PromptAction }
  | { type: "ui"; command: UiCommand }
  | { type: "none" };

export class TuiApp {
  readonly prompt: PromptModel;
  readonly activity: ActivityFeed;
  readonly io: TerminalIO;
  readonly clock: () => number;
  capabilities: TerminalCapabilities;
  themeName: ThemeName;
  reducedMotion: boolean;
  overlay: "log" | undefined;
  private writer: ScreenWriter;
  private lastFrame: Frame | undefined;
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  /** Minimum interval between frames (~30 fps). */
  frameIntervalMs = 33;

  constructor(options: TuiAppOptions) {
    this.io = options.io;
    this.clock = options.clock ?? Date.now;
    this.capabilities = options.capabilities ?? detectTerminalCapabilities();
    this.themeName = options.theme ?? "default";
    this.reducedMotion = options.reducedMotion ?? false;
    this.overlay = undefined;
    this.prompt =
      options.prompt ?? new PromptModel({ width: 72, maxVisualRows: 8 });
    this.activity = options.activity ?? new ActivityFeed({ clock: this.clock });
    this.writer = new ScreenWriter(this.capabilities);
  }

  get theme(): Theme {
    return effectiveTheme(this.themeName, this.capabilities);
  }

  get ui(): UiState {
    return {
      prompt: this.prompt,
      activity: this.activity,
      theme: this.theme,
      capabilities: this.capabilities,
      reducedMotion: this.reducedMotion,
      overlay: this.overlay,
    };
  }

  get frame(): Frame | undefined {
    return this.lastFrame;
  }

  /** Repaint everything on the next render (resize, theme change, ^L). */
  invalidate(): void {
    this.writer.invalidate();
    this.lastFrameAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Render a frame if the frame budget allows.  Returns the bytes written
   * (empty when throttled or nothing changed).
   */
  render(view: AppView, options: { force?: boolean } = {}): string {
    const now = this.clock();
    if (!options.force && now - this.lastFrameAt < this.frameIntervalMs)
      return "";
    this.lastFrameAt = now;
    const frame = composeFrame(
      view,
      this.ui,
      { width: this.io.columns(), height: this.io.rows() },
      now,
    );
    this.lastFrame = frame;
    const out = this.writer.frame(frame.buffer, frame.cursor);
    if (out) this.io.write(out);
    return out;
  }

  /** Decode one key sequence (from TerminalInputDecoder) into an input. */
  input(value: string | { type: "paste"; text: string }): AppInput {
    if (typeof value !== "string")
      return {
        type: "action",
        action: this.prompt.handle({ type: "paste", text: value.text }),
      };
    const key = classifyKey(value);
    switch (key.type) {
      case "ui":
        if (key.command === "toggle-log") {
          this.overlay = this.overlay ? undefined : "log";
          return { type: "ui", command: key.command };
        }
        if (key.command === "close-overlay") {
          if (this.overlay) {
            this.overlay = undefined;
            return { type: "ui", command: key.command };
          }
          return { type: "action", action: this.prompt.handle("ESC") };
        }
        if (key.command === "redraw") this.invalidate();
        return { type: "ui", command: key.command };
      case "prompt":
        return { type: "action", action: this.prompt.handle(key.key) };
      case "text": {
        let action: PromptAction = {
          kind: "noop",
          state: this.prompt.snapshot,
        };
        for (const character of Array.from(key.text))
          action = this.prompt.handle(character);
        return { type: "action", action };
      }
      default:
        return { type: "none" };
    }
  }

  /**
   * Handle TUI-local slash commands (`/log`, `/theme`, `/motion`).
   * Returns a receipt, or undefined when the command is not a UI command.
   */
  command(text: string): string | undefined {
    const command = text.trim();
    if (/^\/(log|transcript)$/i.test(command)) {
      this.overlay = this.overlay ? undefined : "log";
      return this.overlay
        ? "transcript open · esc closes"
        : "transcript closed";
    }
    const theme = command.match(/^\/theme(?:\s+(\S+))?$/i);
    if (theme) {
      if (!theme[1])
        return `theme ${this.themeName} · ${THEME_NAMES.join(" | ")}`;
      const name = parseThemeName(theme[1]);
      if (!name) return `unknown theme · ${THEME_NAMES.join(" | ")}`;
      this.themeName = name;
      this.invalidate();
      return this.capabilities.colorDepth === "none" && name !== "mono"
        ? `theme ${name} · terminal has no color, showing mono`
        : `theme ${name}`;
    }
    const motion = command.match(/^\/motion(?:\s+(on|off))?$/i);
    if (motion) {
      if (motion[1]) this.reducedMotion = motion[1].toLowerCase() === "off";
      else this.reducedMotion = !this.reducedMotion;
      return `motion ${this.reducedMotion ? "off" : "on"}`;
    }
    return undefined;
  }
}

/** Plain text of a frame (for tests and the non-interactive demo). */
export function frameText(frame: Frame): string {
  return frame.buffer
    .lines()
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}
