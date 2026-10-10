/**
 * Semantic theme tokens for the dawg TUI.
 *
 * Components ask for a role ("hit", "promptBg", "error") and never write raw
 * escape colors.  A theme maps every role to a `Style`; the capability layer
 * then projects that style onto truecolor, 256-color, 16-color, or attribute-
 * only output.  Every musical meaning also has a glyph or attribute cue, so the
 * monochrome projection keeps the same information at the same positions.
 */

export type ColorDepth = "truecolor" | "ansi256" | "ansi16" | "none";

export interface TerminalCapabilities {
  colorDepth: ColorDepth;
  unicode: boolean;
  /**
   * Whether SGR attributes (bold, dim, reverse, underline) may be emitted.
   * `TERM=dumb` disables them; `NO_COLOR` keeps them, as the spec allows.
   */
  attributes?: boolean;
}

export type ThemeName = "default" | "high-contrast" | "mono";
export const THEME_NAMES: readonly ThemeName[] = [
  "default",
  "high-contrast",
  "mono",
];

export type SemanticRole =
  | "canvas"
  | "panel"
  | "border"
  | "borderFocus"
  | "text"
  | "muted"
  | "faint"
  | "cursor"
  | "transport"
  | "paused"
  | "track"
  | "pending"
  | "selected"
  | "hit"
  | "sustain"
  | "ghost"
  | "mutedNote"
  | "beatRule"
  | "barRule"
  | "loopRule"
  | "hitLine"
  | "agent"
  | "success"
  | "warning"
  | "error"
  | "promptBg"
  | "promptText"
  | "pillSteer"
  | "pillQueue"
  /** The four knobs (design §7.1): reserved, never reused for other things. */
  | "knob1"
  | "knob2"
  | "knob3"
  | "knob4";

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Style {
  readonly fg?: Rgb | undefined;
  readonly bg?: Rgb | undefined;
  readonly bold?: boolean | undefined;
  readonly dim?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly reverse?: boolean | undefined;
}

export interface Theme {
  readonly name: ThemeName;
  readonly roles: Readonly<Record<SemanticRole, Style>>;
  /** Stable per-track accents; empty for attribute-only themes. */
  readonly accents: readonly Rgb[];
}

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

const defaultTheme: Theme = {
  name: "default",
  roles: {
    canvas: {},
    panel: { fg: rgb(225, 231, 239), bg: rgb(24, 28, 37) },
    border: { fg: rgb(72, 82, 100) },
    borderFocus: { fg: rgb(122, 140, 178) },
    text: { fg: rgb(225, 231, 239) },
    muted: { fg: rgb(130, 143, 164) },
    faint: { fg: rgb(78, 87, 104) },
    cursor: { reverse: true },
    transport: { fg: rgb(91, 211, 145), bold: true },
    paused: { fg: rgb(255, 193, 87), bold: true },
    track: { fg: rgb(95, 181, 255) },
    pending: { fg: rgb(203, 168, 255), italic: true },
    selected: { fg: rgb(255, 212, 94), reverse: true },
    hit: { fg: rgb(255, 246, 222), bold: true },
    sustain: { fg: rgb(113, 202, 255) },
    ghost: { fg: rgb(86, 96, 116) },
    mutedNote: { fg: rgb(102, 111, 125), dim: true },
    beatRule: { fg: rgb(48, 54, 66) },
    barRule: { fg: rgb(76, 86, 106) },
    loopRule: { fg: rgb(132, 118, 190), bold: true },
    hitLine: { fg: rgb(150, 165, 192) },
    agent: { fg: rgb(255, 150, 219) },
    success: { fg: rgb(113, 220, 148) },
    warning: { fg: rgb(255, 193, 87) },
    error: { fg: rgb(255, 108, 112), bold: true },
    promptBg: { bg: rgb(30, 35, 48) },
    promptText: { fg: rgb(232, 237, 246) },
    pillSteer: { fg: rgb(17, 20, 26), bg: rgb(91, 211, 145), bold: true },
    pillQueue: { fg: rgb(17, 20, 26), bg: rgb(255, 193, 87), bold: true },
    knob1: { fg: rgb(80, 160, 255), bold: true },
    knob2: { fg: rgb(90, 210, 140), bold: true },
    knob3: { fg: rgb(225, 228, 236), bold: true },
    knob4: { fg: rgb(255, 140, 60), bold: true },
  },
  accents: [
    rgb(95, 181, 255),
    rgb(255, 138, 101),
    rgb(126, 224, 129),
    rgb(229, 141, 255),
    rgb(255, 213, 79),
    rgb(77, 222, 222),
    rgb(255, 121, 176),
    rgb(170, 176, 255),
  ],
};

const highContrastTheme: Theme = {
  name: "high-contrast",
  roles: {
    canvas: {},
    panel: { fg: rgb(255, 255, 255), bg: rgb(0, 0, 0) },
    border: { fg: rgb(255, 255, 255) },
    borderFocus: { fg: rgb(255, 255, 0), bold: true },
    text: { fg: rgb(255, 255, 255) },
    muted: { fg: rgb(210, 210, 210) },
    faint: { fg: rgb(170, 170, 170) },
    cursor: { reverse: true },
    transport: { fg: rgb(0, 255, 0), bold: true },
    paused: { fg: rgb(255, 255, 0), bold: true },
    track: { fg: rgb(0, 200, 255), bold: true },
    pending: { fg: rgb(255, 0, 255), underline: true },
    selected: { fg: rgb(255, 255, 0), reverse: true, bold: true },
    hit: { fg: rgb(255, 255, 255), bold: true, reverse: true },
    sustain: { fg: rgb(0, 255, 255), bold: true },
    ghost: { fg: rgb(170, 170, 170) },
    mutedNote: { fg: rgb(150, 150, 150) },
    beatRule: { fg: rgb(120, 120, 120) },
    barRule: { fg: rgb(200, 200, 200) },
    loopRule: { fg: rgb(255, 255, 255), bold: true },
    hitLine: { fg: rgb(255, 255, 255), bold: true },
    agent: { fg: rgb(255, 0, 255), bold: true },
    success: { fg: rgb(0, 255, 0), bold: true },
    warning: { fg: rgb(255, 255, 0), bold: true },
    error: { fg: rgb(255, 60, 60), bold: true, underline: true },
    promptBg: { bg: rgb(0, 0, 0) },
    promptText: { fg: rgb(255, 255, 255), bold: true },
    pillSteer: { fg: rgb(0, 0, 0), bg: rgb(0, 255, 0), bold: true },
    pillQueue: { fg: rgb(0, 0, 0), bg: rgb(255, 255, 0), bold: true },
    knob1: { fg: rgb(60, 150, 255), bold: true },
    knob2: { fg: rgb(60, 255, 140), bold: true },
    knob3: { fg: rgb(236, 240, 255), bold: true },
    knob4: { fg: rgb(255, 130, 30), bold: true },
  },
  accents: [
    rgb(0, 200, 255),
    rgb(255, 140, 0),
    rgb(0, 255, 120),
    rgb(255, 0, 255),
    rgb(255, 255, 0),
    rgb(0, 255, 255),
    rgb(255, 80, 160),
    rgb(160, 160, 255),
  ],
};

/** Attribute-only projection: no hue carries meaning. */
const monoTheme: Theme = {
  name: "mono",
  roles: {
    canvas: {},
    panel: {},
    border: {},
    borderFocus: { bold: true },
    text: {},
    muted: { dim: true },
    faint: { dim: true },
    cursor: { reverse: true },
    transport: { bold: true },
    paused: { bold: true },
    track: {},
    pending: { underline: true },
    selected: { reverse: true },
    hit: { bold: true, reverse: true },
    sustain: { bold: true },
    ghost: { dim: true },
    mutedNote: { dim: true },
    beatRule: { dim: true },
    barRule: {},
    loopRule: { bold: true },
    hitLine: { bold: true },
    agent: { italic: true },
    success: { bold: true },
    warning: { bold: true },
    error: { bold: true, underline: true },
    promptBg: {},
    promptText: {},
    pillSteer: { reverse: true, bold: true },
    pillQueue: { reverse: true, bold: true, underline: true },
    // No hue: the knob glyphs (● ▲ ■ ◆) carry which knob is which.
    knob1: { bold: true },
    knob2: { bold: true },
    knob3: { bold: true },
    knob4: { bold: true },
  },
  accents: [],
};

const THEMES: Record<ThemeName, Theme> = {
  default: defaultTheme,
  "high-contrast": highContrastTheme,
  mono: monoTheme,
};

export function getTheme(name: ThemeName): Theme {
  return THEMES[name];
}

export function parseThemeName(value: unknown): ThemeName | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "monochrome") return "mono";
  if (normalized === "contrast" || normalized === "hc") return "high-contrast";
  return (THEME_NAMES as readonly string[]).includes(normalized)
    ? (normalized as ThemeName)
    : undefined;
}

type Env = Record<string, string | undefined>;

function processEnv(): Env {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Env };
  };
  return runtime.process?.env ?? {};
}

export function detectTerminalCapabilities(
  env: Env = processEnv(),
): TerminalCapabilities {
  const dumb = env.TERM === "dumb";
  const noColor = (env.NO_COLOR !== undefined && env.NO_COLOR !== "") || dumb;
  const colorTerm = (env.COLORTERM ?? "").toLowerCase();
  let colorDepth: ColorDepth = "ansi16";
  if (noColor) colorDepth = "none";
  else if (colorTerm.includes("truecolor") || colorTerm.includes("24bit"))
    colorDepth = "truecolor";
  else if ((env.TERM ?? "").includes("256color")) colorDepth = "ansi256";
  const capabilities: TerminalCapabilities = { colorDepth, unicode: !dumb };
  if (dumb) capabilities.attributes = false;
  return capabilities;
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

const WHITE = rgb(255, 255, 255);
const DARK = rgb(34, 38, 48);

/** Brighten (amount > 0) or dim (amount < 0) a style's foreground. */
export function shade(style: Style, amount: number): Style {
  if (!style.fg || amount === 0) return style;
  return {
    ...style,
    fg:
      amount > 0 ? mix(style.fg, WHITE, amount) : mix(style.fg, DARK, -amount),
  };
}

function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Stable accent for a track ID; falls back to the theme's track role. */
export function accentStyle(theme: Theme, trackId: string | undefined): Style {
  const base = theme.roles.track;
  if (theme.accents.length === 0 || !trackId) return base;
  const accent = theme.accents[hashId(trackId) % theme.accents.length]!;
  return { ...base, fg: accent };
}

/** Velocity maps to saturation in color themes (and glyph density elsewhere). */
export function velocityStyle(accent: Style, velocity: number): Style {
  if (!accent.fg) return velocity < 0.35 ? { ...accent, dim: true } : accent;
  const v = Math.max(0, Math.min(1, velocity));
  return { ...accent, fg: mix(DARK, accent.fg, 0.4 + 0.6 * v) };
}

/** Overlay a background (for panels) without losing the role's attributes. */
export function onBackground(style: Style, background: Style): Style {
  return background.bg && !style.bg ? { ...style, bg: background.bg } : style;
}

// ---------------------------------------------------------------------------
// Capability projection

const ANSI16: ReadonlyArray<Rgb> = [
  rgb(0, 0, 0),
  rgb(205, 49, 49),
  rgb(13, 188, 121),
  rgb(229, 229, 16),
  rgb(36, 114, 200),
  rgb(188, 63, 188),
  rgb(17, 168, 205),
  rgb(229, 229, 229),
  rgb(102, 102, 102),
  rgb(241, 76, 76),
  rgb(35, 209, 139),
  rgb(245, 245, 67),
  rgb(59, 142, 234),
  rgb(214, 112, 214),
  rgb(41, 184, 219),
  rgb(255, 255, 255),
];

function nearest16(color: Rgb): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ANSI16.length; index += 1) {
    const candidate = ANSI16[index]!;
    const distance =
      (candidate.r - color.r) ** 2 * 0.3 +
      (candidate.g - color.g) ** 2 * 0.59 +
      (candidate.b - color.b) ** 2 * 0.11;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

const CUBE = [0, 95, 135, 175, 215, 255];
function cubeIndex(value: number): number {
  let best = 0;
  for (let index = 1; index < CUBE.length; index += 1)
    if (Math.abs(CUBE[index]! - value) < Math.abs(CUBE[best]! - value))
      best = index;
  return best;
}

export function toAnsi256(color: Rgb): number {
  const gray = Math.round((color.r + color.g + color.b) / 3);
  const r = cubeIndex(color.r);
  const g = cubeIndex(color.g);
  const b = cubeIndex(color.b);
  const cube = 16 + 36 * r + 6 * g + b;
  const cubeColor = rgb(CUBE[r]!, CUBE[g]!, CUBE[b]!);
  const grayIndex = Math.max(0, Math.min(23, Math.round((gray - 8) / 10)));
  const grayValue = 8 + grayIndex * 10;
  const cubeError =
    (cubeColor.r - color.r) ** 2 +
    (cubeColor.g - color.g) ** 2 +
    (cubeColor.b - color.b) ** 2;
  const grayError =
    (grayValue - color.r) ** 2 +
    (grayValue - color.g) ** 2 +
    (grayValue - color.b) ** 2;
  return grayError < cubeError ? 232 + grayIndex : cube;
}

function colorCode(
  color: Rgb,
  depth: ColorDepth,
  background: boolean,
): string | undefined {
  if (depth === "none") return undefined;
  if (depth === "truecolor")
    return `${background ? 48 : 38};2;${color.r};${color.g};${color.b}`;
  if (depth === "ansi256")
    return `${background ? 48 : 38};5;${toAnsi256(color)}`;
  const index = nearest16(color);
  const base = index < 8 ? (background ? 40 : 30) : background ? 100 : 90;
  return String(base + (index % 8));
}

const sgrCache = new WeakMap<Style, Map<string, string>>();

/** Full SGR sequence (starting from a reset) for a style at a capability. */
export function styleSgr(
  style: Style | undefined,
  capabilities: TerminalCapabilities,
): string {
  if (capabilities.attributes === false) return "";
  if (!style) return "\u001b[0m";
  const key = `${capabilities.colorDepth}`;
  let byDepth = sgrCache.get(style);
  const cached = byDepth?.get(key);
  if (cached !== undefined) return cached;
  const codes = ["0"];
  if (style.bold) codes.push("1");
  if (style.dim) codes.push("2");
  if (style.italic) codes.push("3");
  if (style.underline) codes.push("4");
  if (style.reverse) codes.push("7");
  if (style.fg) {
    const code = colorCode(style.fg, capabilities.colorDepth, false);
    if (code) codes.push(code);
  }
  if (style.bg) {
    const code = colorCode(style.bg, capabilities.colorDepth, true);
    if (code) codes.push(code);
  }
  const sequence = `\u001b[${codes.join(";")}m`;
  if (!byDepth) {
    byDepth = new Map();
    sgrCache.set(style, byDepth);
  }
  byDepth.set(key, sequence);
  return sequence;
}

/**
 * The shortest SGR that moves the terminal from `from` to `to` when they
 * differ only in foreground colour: `38;…` or `39`, never a full reset.
 * Undefined when anything else differs (the caller emits `styleSgr`).
 */
export function foregroundSgr(
  from: Style,
  to: Style,
  capabilities: TerminalCapabilities,
): string | undefined {
  if (capabilities.attributes === false) return "";
  if (
    !!from.bold !== !!to.bold ||
    !!from.dim !== !!to.dim ||
    !!from.italic !== !!to.italic ||
    !!from.underline !== !!to.underline ||
    !!from.reverse !== !!to.reverse
  )
    return undefined;
  const fromBg = from.bg && colorCode(from.bg, capabilities.colorDepth, true);
  const toBg = to.bg && colorCode(to.bg, capabilities.colorDepth, true);
  if (fromBg !== toBg) return undefined;
  if (!to.fg) return "\u001b[39m";
  const code = colorCode(to.fg, capabilities.colorDepth, false);
  return code ? `\u001b[${code}m` : "\u001b[39m";
}

/** Resolve the effective theme: no-color terminals always use attributes only. */
export function effectiveTheme(
  name: ThemeName,
  capabilities: TerminalCapabilities,
): Theme {
  return capabilities.colorDepth === "none" ? monoTheme : getTheme(name);
}

/**
 * Apply a named role to a string (foreground only), retaining a clean,
 * testable no-color mode.  Used by simple, non-buffered output paths.
 */
export function semanticColor(
  role: SemanticRole,
  value: string,
  capabilities: TerminalCapabilities = detectTerminalCapabilities(),
  theme: Theme = defaultTheme,
): string {
  if (capabilities.colorDepth === "none" || value.length === 0) return value;
  const fg = theme.roles[role].fg ?? theme.roles[role].bg;
  if (!fg) return value;
  const code = colorCode(fg, capabilities.colorDepth, false);
  return code ? `\u001b[${code}m${value}\u001b[0m` : value;
}
