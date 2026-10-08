/**
 * Frame composition and UI state for the interactive dawg TUI.
 *
 *   ┌ header: dawg · track · session · ▶ BPM · model · rev · sync ┐
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
import { asciiHint, fitHint, HINTS } from "./grammar.ts";
import { GuideBrowser } from "./guide.ts";
import { listGuides } from "../guides/index.ts";
import { classifyKey, overlayKey, type UiCommand } from "./keys.ts";
import { PromptModel, type PromptAction, type PromptMode } from "./prompt.ts";
import {
  paintChordLegend,
  paintPlayHeader,
  paintPlayStrip,
  type PlayHeaderView,
} from "./play-strip.ts";
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
  /** Project typecheck result; `types ✓` or `types ✗ N` beside sync. */
  types?: TypesIndicator | undefined;
  /**
   * The line under the prompt: `$0.12 session · $0.48 today · opus-5.5 ·
   * gateway`, or `no model · dawg login`. The caller sizes it to the width.
   */
  spend?: string | undefined;
  /** No agent provider: the placeholder teaches commands, no STEER pill. */
  agentOffline?: boolean | undefined;
  /** Play mode: replaces the header and adds the keyboard strip row. */
  play?: PlayHeaderView | undefined;
}

export type TypesIndicator = Readonly<{ ok: boolean; errors: number }>;

export interface UiState {
  prompt: PromptModel;
  activity: ActivityFeed;
  theme: Theme;
  capabilities: TerminalCapabilities;
  reducedMotion: boolean;
  overlay: Overlay;
  /** Transcript scroll (entries up from the newest) and filter. */
  log?: LogView | undefined;
  picker?: PickerState | undefined;
  text?: TextView | undefined;
  /** The `?` panel: keys for the screen underneath, drawn over it. */
  keys?: TextView | undefined;
  /** The `/guide` tree and pages. */
  guide?: GuideBrowser | undefined;
}

/**
 * `log` is the transcript, `picker` an arrow-key list, `text` static lines,
 * `guide` the user guides.
 */
export type Overlay = "log" | "picker" | "text" | "guide" | undefined;

/** A scrollable read-only panel (`/help`, `/sessions`, `/tracks`). */
export interface TextView {
  title: string;
  lines: readonly string[];
  /** Rows scrolled down from the top. */
  scroll: number;
}

export type LogFilter = "all" | "requests" | "ops" | "errors";
export const LOG_FILTERS: readonly LogFilter[] = [
  "all",
  "requests",
  "ops",
  "errors",
];

export interface LogView {
  scroll: number;
  filter: LogFilter;
}

/** An arrow-key list overlay (`/resume`, `/login --xcb`). */
export interface PickerState {
  /** Caller tag returned with the choice. */
  id: string;
  title: string;
  items: readonly PickerItem[];
  index: number;
  /** Type-to-filter on label and detail (`/model`). */
  filterable?: boolean | undefined;
  /** Current filter text; `items` is then the matching subset of `all`. */
  query?: string | undefined;
  /** `/` was pressed: printable keys type into the filter. */
  filtering?: boolean | undefined;
  all?: readonly PickerItem[] | undefined;
  /** Footer keys, replacing the default move/choose/cancel hint. */
  hint?: string | undefined;
  /** A dim line under the rows: what the focused row does. */
  note?: string | undefined;
  /**
   * Hosts the audition loop (src/tui/audition.ts): Space, `a` and `c` are
   * returned as `pick-audition` instead of being swallowed.
   */
  audition?: boolean | undefined;
}

export interface PickerItem {
  label: string;
  /** Opaque value returned on Enter. */
  value: string;
  detail?: string | undefined;
  /** Marked with ● (the current model). */
  current?: boolean | undefined;
}

/** Most picker rows kept; longer lists are truncated by the caller's order. */
export const MAX_PICKER_ITEMS = 64;

export function logEntriesFor(
  entries: readonly TranscriptEntry[],
  filter: LogFilter,
): readonly TranscriptEntry[] {
  if (filter === "all") return entries;
  return entries.filter((entry) =>
    filter === "requests"
      ? entry.kind === "request"
      : filter === "errors"
        ? entry.kind === "error"
        : entry.kind === "op" ||
          entry.kind === "revision" ||
          entry.kind === "agent",
  );
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
    { text: "dawg", style: { ...roles.muted, bold: true }, priority: 6 },
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
  if (view.types)
    right.push({
      text: view.types.ok
        ? `types ${unicode ? "✓" : "ok"}`
        : `types ${unicode ? "✗" : "x"} ${view.types.errors}`,
      style: view.types.ok ? roles.success : roles.error,
      priority: 4,
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
  if (!view.agentOffline) x += buffer.text(x, top, pill(mode), pillStyle);
  const status: string[] = [];
  // The model shows once, in the header; the spend line carries it here.
  // Views without a spend line (embedders such as the site demo) keep the
  // model label.
  if (view.spend) {
    if (!layout.footer) status.push(view.spend);
  } else if (view.model) status.push(view.model);
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
    const placeholder = view.agentOffline
      ? "try: tempo 96 · add C4 at 0 · /help  (dawg login enables the agent)"
      : mode === "queue"
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
    const spend = view.spend ? ` ${view.spend} ` : "";
    const spendWidth = displayWidth(spend);
    // Spend wins over hints when both do not fit.
    const shown =
      hints && displayWidth(hints) + spendWidth + 6 <= width ? hints : "";
    if (shown) buffer.text(2, y, shown, onBackground(roles.muted, panel));
    if (spend && spendWidth + 4 <= width)
      buffer.text(
        width - 2 - spendWidth,
        y,
        spend,
        onBackground(roles.muted, panel),
      );
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
  const view = ui.log ?? { scroll: 0, filter: "all" };
  const inner = height - 2;
  const all = logEntriesFor(activity.transcript, view.filter);
  const maxScroll = Math.max(0, all.length - inner);
  const scroll = Math.max(0, Math.min(maxScroll, view.scroll));
  const end = all.length - scroll;
  const entries = all.slice(Math.max(0, end - inner), end);
  const position =
    scroll > 0 ? ` · ${end}/${all.length}` : all.length > inner ? " · end" : "";
  buffer.text(
    left + 2,
    top,
    ` transcript · ${view.filter}${position} `,
    onBackground({ ...roles.text, bold: true }, panel),
    boxWidth - 4,
  );
  const hintText = footerHint(HINTS.log, boxWidth - 4, capabilities.unicode);
  if (hintText)
    buffer.text(
      left + boxWidth - 2 - displayWidth(hintText),
      top + height - 1,
      hintText,
      onBackground(roles.muted, panel),
    );
  if (entries.length === 0)
    buffer.text(
      left + 2,
      top + 1,
      view.filter === "all" ? "nothing yet" : `no ${view.filter} yet`,
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

/** Static lines in a bordered panel; the title sits on the top border. */
function paintText(
  buffer: CellBuffer,
  ui: UiState,
  region: { y: number; height: number },
  width: number,
  options: { text?: TextView | undefined; hint?: string } = {},
): void {
  const text = options.text ?? ui.text;
  if (!text) return;
  const roles = ui.theme.roles;
  const left = width >= 60 ? 2 : 0;
  const boxWidth = width - left * 2;
  const height = region.height;
  if (height < 3 || boxWidth < 10) return;
  const panel = paintBox(buffer, ui, {
    left,
    top: region.y,
    width: boxWidth,
    height,
  });
  const inner = height - 2;
  const maxScroll = Math.max(0, text.lines.length - inner);
  const scroll = Math.max(0, Math.min(maxScroll, text.scroll));
  const position =
    maxScroll > 0
      ? ` · ${scroll + 1}-${scroll + inner}/${text.lines.length}`
      : "";
  buffer.text(
    left + 2,
    region.y,
    ` ${text.title}${position} `,
    onBackground({ ...roles.text, bold: true }, panel),
    boxWidth - 4,
  );
  const hint = footerHint(
    options.hint ?? HINTS.text,
    boxWidth - 4,
    ui.capabilities.unicode,
  );
  if (hint)
    buffer.text(
      left + boxWidth - 2 - displayWidth(hint),
      region.y + height - 1,
      hint,
      onBackground(roles.muted, panel),
    );
  text.lines.slice(scroll, scroll + inner).forEach((line, index) => {
    const heading = line.startsWith("── ");
    buffer.text(
      left + 2,
      region.y + 1 + index,
      truncate(
        heading && !ui.capabilities.unicode ? line.replace("── ", "-- ") : line,
        boxWidth - 4,
      ),
      onBackground(
        heading ? { ...roles.borderFocus, bold: true } : roles.text,
        panel,
      ),
    );
  });
}

function paintGuide(
  buffer: CellBuffer,
  ui: UiState,
  region: { y: number; height: number },
  width: number,
): void {
  const guide = ui.guide;
  if (!guide) return;
  const roles = ui.theme.roles;
  const unicode = ui.capabilities.unicode;
  const left = width >= 60 ? 2 : 0;
  const boxWidth = width - left * 2;
  const height = region.height;
  if (height < 3 || boxWidth < 10) return;
  const panel = paintBox(buffer, ui, {
    left,
    top: region.y,
    width: boxWidth,
    height,
  });
  const view = guide.view(boxWidth - 4, height - 2, unicode);
  buffer.text(
    left + 2,
    region.y,
    ` ${view.title} `,
    onBackground({ ...roles.text, bold: true }, panel),
    boxWidth - 4,
  );
  const hint = footerHint(view.hint, boxWidth - 4, unicode);
  if (hint)
    buffer.text(
      left + boxWidth - 2 - displayWidth(hint),
      region.y + height - 1,
      hint,
      onBackground(roles.muted, panel),
    );
  view.rows.forEach((row, index) => {
    const style = row.selected
      ? { ...roles.borderFocus, bold: true }
      : row.heading
        ? { ...roles.borderFocus, bold: true }
        : row.muted
          ? roles.muted
          : roles.text;
    const marker = row.selected ? (unicode ? "›" : ">") : " ";
    const text = guide.page === undefined ? `${marker}${row.text}` : row.text;
    buffer.text(
      left + 2,
      region.y + 1 + index,
      truncate(text, boxWidth - 4),
      onBackground(style, panel),
    );
  });
}

function paintBox(
  buffer: CellBuffer,
  ui: UiState,
  rect: { left: number; top: number; width: number; height: number },
): Style {
  const roles = ui.theme.roles;
  const box = ui.capabilities.unicode ? UNICODE_BOX : ASCII_BOX;
  const panel = roles.panel;
  const border = onBackground(roles.borderFocus, panel);
  const { left, top, width, height } = rect;
  buffer.fill(left, top, width, height, panel);
  buffer.set(left, top, box.tl, border);
  buffer.set(left + width - 1, top, box.tr, border);
  buffer.set(left, top + height - 1, box.bl, border);
  buffer.set(left + width - 1, top + height - 1, box.br, border);
  for (let x = left + 1; x < left + width - 1; x += 1) {
    buffer.set(x, top, box.h, border);
    buffer.set(x, top + height - 1, box.h, border);
  }
  for (let y = top + 1; y < top + height - 1; y += 1) {
    buffer.set(left, y, box.v, border);
    buffer.set(left + width - 1, y, box.v, border);
  }
  return panel;
}

function paintPicker(
  buffer: CellBuffer,
  ui: UiState,
  region: { y: number; height: number },
  width: number,
): void {
  const picker = ui.picker;
  if (!picker) return;
  const roles = ui.theme.roles;
  const left = width >= 60 ? 2 : 0;
  const boxWidth = width - left * 2;
  const noteRows = picker.note && region.height >= 6 ? 1 : 0;
  const height = Math.min(
    region.height,
    Math.max(1, picker.items.length) + 2 + noteRows,
  );
  if (height < 3 || boxWidth < 10) return;
  const panel = paintBox(buffer, ui, {
    left,
    top: region.y,
    width: boxWidth,
    height,
  });
  buffer.text(
    left + 2,
    region.y,
    ` ${picker.title}${picker.filtering || picker.query ? ` · /${picker.query ?? ""}${picker.filtering ? "▏" : ""}` : ""} `,
    onBackground({ ...roles.text, bold: true }, panel),
    boxWidth - 4,
  );
  const hint = footerHint(
    picker.filtering
      ? HINTS.filtering
      : (picker.hint ??
          (picker.filterable
            ? HINTS.list
            : HINTS.list.replace(" · / filter", ""))),
    boxWidth - 4,
    ui.capabilities.unicode,
  );
  if (hint)
    buffer.text(
      left + boxWidth - 2 - displayWidth(hint),
      region.y + height - 1,
      hint,
      onBackground(roles.muted, panel),
    );
  const inner = height - 2 - noteRows;
  if (noteRows && picker.note)
    buffer.text(
      left + 2,
      region.y + height - 2,
      truncate(picker.note, boxWidth - 4),
      onBackground(roles.muted, panel),
    );
  const first = Math.max(
    0,
    Math.min(picker.items.length - inner, picker.index - inner + 1),
  );
  const marks = (picker.all ?? picker.items).some(
    (item) => item.current !== undefined,
  );
  if (picker.items.length === 0)
    buffer.text(
      left + 4,
      region.y + 1,
      "no matches",
      onBackground(roles.muted, panel),
    );
  picker.items.slice(first, first + inner).forEach((item, offset) => {
    const index = first + offset;
    const y = region.y + 1 + offset;
    const selected = index === picker.index;
    const marker = selected ? (ui.capabilities.unicode ? "›" : ">") : " ";
    const style = selected
      ? onBackground({ ...roles.borderFocus, bold: true }, panel)
      : onBackground(roles.text, panel);
    buffer.text(left + 2, y, marker, style);
    // A column for the current-item mark only when the picker uses one.
    const pad = marks ? 2 : 0;
    if (item.current)
      buffer.text(
        left + 4,
        y,
        ui.capabilities.unicode ? "●" : "*",
        onBackground(roles.success, panel),
      );
    const room = boxWidth - 6 - pad;
    const used = buffer.text(
      left + 4 + pad,
      y,
      truncate(item.label, room),
      style,
    );
    if (item.detail && used + 3 < room)
      buffer.text(
        left + 4 + pad + used + 2,
        y,
        truncate(item.detail, room - used - 2),
        onBackground(roles.muted, panel),
      );
  });
}

/** The `?` panel sits at the bottom of the highway, as tall as it needs. */
function keysRegion(
  region: { y: number; height: number },
  keys: TextView,
): { y: number; height: number } {
  const height = Math.min(region.height, keys.lines.length + 2);
  return { y: region.y + region.height - height, height };
}

/** A footer hint fitted to `width`, spelled in ASCII when needed. */
export function footerHint(
  hint: string,
  width: number,
  unicode: boolean,
): string {
  return fitHint(unicode ? hint : asciiHint(hint), width);
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
  if (view.play) {
    paintPlayHeader(
      buffer,
      layout.header,
      width,
      view.play,
      ui.theme,
      ui.capabilities.unicode,
    );
    if (layout.highway.height > 1) {
      paintPlayStrip(buffer, layout.highway.y, width, view.play.keys, ui.theme);
      layout.highway = {
        y: layout.highway.y + 1,
        height: layout.highway.height - 1,
      };
    }
    if (view.play.legend && layout.highway.height > 4) {
      paintChordLegend(
        buffer,
        layout.highway.y,
        width,
        view.play.legend,
        ui.theme,
      );
      layout.highway = {
        y: layout.highway.y + 1,
        height: layout.highway.height - 1,
      };
    }
  } else paintHeader(buffer, view, ui, width);
  const beat = view.beat ?? resolveBeat(view.score, nowMs);
  if (layout.highway.height > 0) {
    if (ui.overlay === "log") paintOverlay(buffer, ui, layout.highway, width);
    else if (ui.overlay === "picker" && ui.picker)
      paintPicker(buffer, ui, layout.highway, width);
    else if (ui.overlay === "text" && ui.text)
      paintText(buffer, ui, layout.highway, width);
    else if (ui.overlay === "guide" && ui.guide)
      paintGuide(buffer, ui, layout.highway, width);
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
  if (ui.keys && layout.highway.height > 0)
    paintText(buffer, ui, keysRegion(layout.highway, ui.keys), width, {
      text: ui.keys,
      hint: HINTS.keys,
    });
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
  /** Enter on a picker row; `value` is the chosen item's value. */
  | { type: "pick"; picker: string; value: string }
  /** Esc on a picker. */
  | { type: "pick-cancel"; picker: string }
  /**
   * The highlighted row changed (move, page, filter): the hook for live
   * previews (/pattern today; an audition controller can listen here too).
   * Pickers raise `pick-move` → `pick` (commit) or `pick-cancel` (cancel).
   */
  | { type: "pick-move"; picker: string; value: string }
  /** Space, `a` or `c` on a picker that hosts the audition loop. */
  | { type: "pick-audition"; picker: string; key: "loop" | "ab" | "context" }
  /** Consumed by an overlay (scroll, filter, move). */
  | { type: "overlay" }
  | { type: "none" };

export class TuiApp {
  readonly prompt: PromptModel;
  readonly activity: ActivityFeed;
  readonly io: TerminalIO;
  readonly clock: () => number;
  capabilities: TerminalCapabilities;
  themeName: ThemeName;
  reducedMotion: boolean;
  overlay: Overlay;
  log: LogView = { scroll: 0, filter: "all" };
  picker: PickerState | undefined;
  text: TextView | undefined;
  /** `/view all` overlays every unmuted track; `/view focus` shows one. */
  highwayView: "all" | "focus" = "all";
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
      log: this.log,
      picker: this.picker,
      text: this.text,
      keys: this.keys,
      guide: this.guide,
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
    if (this.overlay === "picker" && this.picker) {
      const picker = this.picker;
      const nav = overlayKey(value);
      if (nav === "up" || nav === "down" || nav === "pgup" || nav === "pgdn") {
        const step =
          nav === "up" ? -1 : nav === "down" ? 1 : nav === "pgup" ? -8 : 8;
        // Moving ends typing into the filter; the filter itself stays.
        picker.filtering = false;
        picker.index = Math.max(
          0,
          Math.min(picker.items.length - 1, picker.index + step),
        );
        return this.pickerMoved(picker);
      }
      if (nav === "home" || nav === "end") {
        picker.index = nav === "home" ? 0 : picker.items.length - 1;
        return this.pickerMoved(picker);
      }
      if (nav === "enter") {
        const item = picker.items[picker.index];
        this.closePicker();
        return item
          ? { type: "pick", picker: picker.id, value: item.value }
          : { type: "pick-cancel", picker: picker.id };
      }
      if (key.type === "ui" && key.command === "close-overlay") {
        // Esc clears the filter first, then closes.
        if (picker.query || picker.filtering) {
          this.filterPicker("");
          if (this.picker) this.picker.filtering = false;
          return { type: "overlay" };
        }
        this.closePicker();
        return { type: "pick-cancel", picker: picker.id };
      }
      if (picker.filterable && picker.filtering) {
        if (value === "\u007f" || value === "\b") {
          const query = (picker.query ?? "").slice(0, -1);
          this.filterPicker(query);
          if (!query && this.picker) this.picker.filtering = false;
          return { type: "overlay" };
        }
        if (key.type === "text") {
          this.filterPicker(((picker.query ?? "") + key.text).slice(0, 40));
          return { type: "overlay" };
        }
      }
      if (picker.audition && !picker.filtering) {
        const audition =
          value === " "
            ? "loop"
            : value === "a"
              ? "ab"
              : value === "c"
                ? "context"
                : undefined;
        if (audition)
          return { type: "pick-audition", picker: picker.id, key: audition };
      }
      if (picker.filterable && key.type === "text" && key.text === "/") {
        picker.filtering = true;
        return { type: "overlay" };
      }
      if (key.type === "text" && (key.text === "j" || key.text === "k")) {
        const step = key.text === "k" ? -1 : 1;
        picker.index = Math.max(
          0,
          Math.min(picker.items.length - 1, picker.index + step),
        );
        return this.pickerMoved(picker);
      }
      // Quit and redraw still work; everything else is swallowed.
      if (
        key.type === "ui" &&
        (key.command === "quit" || key.command === "redraw")
      ) {
        if (key.command === "redraw") this.invalidate();
        return { type: "ui", command: key.command };
      }
      return { type: "overlay" };
    }
    if (this.overlay === "guide" && this.guide) {
      if (
        key.type === "ui" &&
        (key.command === "quit" || key.command === "redraw")
      ) {
        if (key.command === "redraw") this.invalidate();
        return { type: "ui", command: key.command };
      }
      const result = this.guide.key(value, Math.max(1, this.io.rows() - 10));
      if (result === "close") this.closeGuide();
      return { type: "overlay" };
    }
    if (this.overlay === "text" && this.text) {
      const nav = overlayKey(value);
      const page = Math.max(1, this.io.rows() - 10);
      if (nav && nav !== "enter") {
        const step =
          nav === "down"
            ? 1
            : nav === "up"
              ? -1
              : nav === "pgdn"
                ? page
                : nav === "pgup"
                  ? -page
                  : 0;
        const total = this.text.lines.length;
        this.text.scroll =
          nav === "home"
            ? 0
            : nav === "end"
              ? total
              : Math.max(0, Math.min(total, this.text.scroll + step));
        return { type: "overlay" };
      }
    }
    if (this.overlay === "log") {
      const nav = overlayKey(value);
      const page = Math.max(1, this.io.rows() - 10);
      if (nav && nav !== "enter") {
        const step =
          nav === "up"
            ? 1
            : nav === "down"
              ? -1
              : nav === "pgup"
                ? page
                : nav === "pgdn"
                  ? -page
                  : 0;
        const total = logEntriesFor(
          this.activity.transcript,
          this.log.filter,
        ).length;
        this.log.scroll =
          nav === "home"
            ? total
            : nav === "end"
              ? 0
              : Math.max(0, Math.min(total, this.log.scroll + step));
        return { type: "overlay" };
      }
      if (key.type === "text" && key.text === "/") {
        const next =
          LOG_FILTERS[
            (LOG_FILTERS.indexOf(this.log.filter) + 1) % LOG_FILTERS.length
          ]!;
        this.log = { scroll: 0, filter: next };
        return { type: "overlay" };
      }
    }
    switch (key.type) {
      case "ui":
        if (key.command === "toggle-log") {
          this.overlay = this.overlay === "log" ? undefined : "log";
          if (this.overlay === "log") this.log = { ...this.log, scroll: 0 };
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
      case "prompt": {
        const action = this.prompt.handle(key.key);
        // Submitting from under a text panel closes it so the receipt shows.
        if (action.kind === "submit" && this.overlay === "text")
          this.closeText();
        return { type: "action", action };
      }
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

  /** Show an arrow-key picker over the highway; replaces any overlay. */
  /** `pick-move` for the row now highlighted, or a plain overlay input. */
  private pickerMoved(picker: PickerState): AppInput {
    const item = picker.items[picker.index];
    return item
      ? { type: "pick-move", picker: picker.id, value: item.value }
      : { type: "overlay" };
  }

  openPicker(picker: Omit<PickerState, "index"> & { index?: number }): void {
    const items = picker.items.slice(0, MAX_PICKER_ITEMS);
    if (items.length === 0) return;
    this.picker = {
      ...picker,
      items,
      index: Math.max(0, Math.min(items.length - 1, picker.index ?? 0)),
    };
    this.overlay = "picker";
  }

  /** Narrow a filterable picker to rows matching `query`. */
  private filterPicker(query: string): void {
    const picker = this.picker;
    if (!picker) return;
    const all = picker.all ?? picker.items;
    const needle = query.toLowerCase();
    const items = all.filter(
      (item) =>
        !needle ||
        item.label.toLowerCase().includes(needle) ||
        (item.detail ?? "").toLowerCase().includes(needle),
    );
    const keep = picker.items[picker.index]?.value;
    const index = Math.max(
      0,
      items.findIndex((item) => item.value === keep),
    );
    this.picker = { ...picker, all, query, items, index };
  }

  closePicker(): void {
    this.picker = undefined;
    if (this.overlay === "picker") this.overlay = undefined;
  }

  /** Show static lines over the highway (`/help`, lists); replaces any overlay. */
  openText(title: string, lines: readonly string[]): void {
    this.text = { title, lines: lines.slice(0, 512), scroll: 0 };
    this.overlay = "text";
  }

  /** The `?` panel over the current screen; any key closes it. */
  keys: TextView | undefined;
  showKeys(title: string, lines: readonly string[]): void {
    this.keys = { title, lines, scroll: 0 };
  }

  closeKeys(): void {
    this.keys = undefined;
  }

  /** True while a picker's `/` filter is taking typed text. */
  get pickerTyping(): boolean {
    return this.overlay === "picker" && this.picker?.filtering === true;
  }

  /** The `/guide` pane; built on first use from `guides/*.md`. */
  guide: GuideBrowser | undefined;

  /**
   * Open the guides at the tree, or at one guide (`chords`). Returns false
   * (and opens nothing) when `topic` names no guide.
   */
  openGuide(topic?: string): boolean {
    const browser = this.guide ?? new GuideBrowser(listGuides());
    if (topic && !browser.open(topic)) return false;
    if (!topic) {
      browser.page = undefined;
      browser.query = "";
      browser.filtering = false;
    }
    this.guide = browser;
    this.overlay = "guide";
    return true;
  }

  closeGuide(): void {
    if (this.overlay === "guide") this.overlay = undefined;
  }

  /** True while the guide filter takes typed text (so `?` is a letter). */
  get guideTyping(): boolean {
    return this.overlay === "guide" && this.guide?.typing === true;
  }

  closeText(): void {
    this.text = undefined;
    if (this.overlay === "text") this.overlay = undefined;
  }

  /**
   * Handle TUI-local slash commands (`/log`, `/theme`, `/motion`, `/guide`).
   * Returns a receipt, or undefined when the command is not a UI command.
   */
  command(text: string): string | undefined {
    const command = text.trim();
    if (/^\/(log|transcript)$/i.test(command)) {
      this.overlay = this.overlay === "log" ? undefined : "log";
      if (this.overlay === "log") this.log = { ...this.log, scroll: 0 };
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
    const guide = command.match(/^\/guides?(?:\s+(.+))?$/i);
    if (guide) {
      const topic = guide[1]?.trim();
      if (!this.openGuide(topic))
        return `no guide named ${topic} · /guide lists them all`;
      return topic
        ? `guide · ${this.guide?.guides.find((g) => g.id === this.guide?.page)?.title ?? topic} · esc back`
        : "guides · → open · esc closes";
    }
    const view = command.match(/^\/view(?:\s+(\S+))?$/i);
    if (view) {
      const value = view[1]?.toLowerCase();
      if (value === undefined)
        this.highwayView = this.highwayView === "all" ? "focus" : "all";
      else if (value === "all" || value === "focus") this.highwayView = value;
      else return "view · /view focus | all";
      return this.highwayView === "all"
        ? "view all · every unmuted track, focused track on top"
        : "view focus · focused track only";
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
