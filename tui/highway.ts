/**
 * The rhythm-game highway: notes fall from the top toward a fixed hit line.
 *
 * Every animation phase is derived from the transport beat (and the score's
 * tempo), never from frame counts, so a slow terminal drops frames without
 * changing what the music looks like at a given musical time.
 *
 * Horizontal placement is a pluggable `LaneProjection`: melodic tracks use a
 * pitch projection fitted to the notes in view, drum tracks use one explicit
 * lane per voice with a legend.
 */

import { CellBuffer } from "./screen.ts";
import { truncate } from "./text.ts";
import {
  accentStyle,
  onBackground,
  shade,
  velocityStyle,
  type Style,
  type TerminalCapabilities,
  type Theme,
} from "./theme.ts";

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
  /**
   * Cents the note sounds away from the nearest 12-TET pitch (tuning plus note
   * cents). Drawn as a compact `+14`/`−32` tag beside the approaching head.
   */
  cents?: number | undefined;
  /**
   * In a linear non-12 tuning, the 12-TET pitch class `cents` is measured
   * from (`D` for a `D−47` tag), since the lane is the key, not the sound.
   */
  centsFrom?: string | undefined;
}

export interface TrackScoreSnapshot {
  notes: readonly NoteSnapshot[];
  trackName?: string | undefined;
  trackId?: string | undefined;
  sessionId?: string | undefined;
  revision?: number | undefined;
  bpm?: number | undefined;
  key?: string | undefined;
  beatsPerBar?: number | undefined;
  /**
   * Bar starts in beats within the loop when the meter changes (bar 1 at
   * 0); omitted, bars repeat every `beatsPerBar` beats.
   */
  barBeats?: readonly number[] | undefined;
  loopBeats?: number | undefined;
  laneCount?: number | undefined;
  /** Optional lane legend (drum voices) drawn just below the hit line. */
  laneLabels?: readonly string[] | undefined;
  /** Explicit projection; overrides `laneCount`/`laneLabels` inference. */
  projection?: LaneProjection | undefined;
  /** Static transport position when the score is paused. */
  transportBeat?: number | undefined;
  /**
   * Steps per period and degree-0 key of a linear non-12 tuning; lane labels
   * then mark each period from the root instead of every C.
   */
  tuningPeriod?: { size: number; root: number } | undefined;
  /** Alias accepted by adapters that call this value currentBeat. */
  currentBeat?: number | undefined;
  transportStartedAtMs?: number | undefined;
  playing?: boolean | undefined;
  activity?: string | undefined;
  /**
   * Other unmuted tracks drawn dimmed under the focused track, each in its own
   * accent. Empty or omitted in focus view.
   */
  layers?: readonly HighwayLayer[] | undefined;
}

/** One background track overlaid on the highway. */
export interface HighwayLayer {
  trackId: string;
  trackName?: string | undefined;
  notes: readonly NoteSnapshot[];
  /** The layer's own lanes (drum voices); mapped onto the main projection. */
  projection?: LaneProjection | undefined;
}

/** Bound on overlaid notes so a dense arrangement cannot stall a frame. */
export const MAX_LAYER_NOTES = 2048;

// ---------------------------------------------------------------------------
// Lane projections

export interface LaneProjection {
  readonly kind: string;
  readonly laneCount: number;
  /** Lane for a note, or undefined when the note is not drawable. */
  laneOf(note: NoteSnapshot): number | undefined;
  /** Optional legend text for a lane. */
  label?(lane: number): string | undefined;
}

/** One lane per declared voice; notes carry `lane` (drum voice index). */
export function explicitLaneProjection(
  laneCount: number,
  labels?: readonly string[],
  kind = labels ? "drum" : "lane",
): LaneProjection {
  const count = Math.max(1, Math.floor(laneCount));
  return {
    kind,
    laneCount: count,
    laneOf(note) {
      const lane = note.lane ?? note.pitch;
      if (lane === undefined || !Number.isFinite(lane)) return undefined;
      return Math.max(0, Math.min(count - 1, Math.round(lane)));
    },
    label: labels ? (lane) => labels[lane] : undefined,
  };
}

/** Drum projection: lanes are named voices, left to right. */
export function drumLaneProjection(voices: readonly string[]): LaneProjection {
  return explicitLaneProjection(voices.length, voices, "drum");
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * `+14`/`−32` for a cents deviation, empty within ±1 cent; with `from` (a
 * linear non-12 tuning) the pitch class leads: `D−47`, or `C` alone.
 */
export function centsTag(cents: number | undefined, from?: string): string {
  const rounded = Math.round(cents ?? 0);
  const value =
    Math.abs(rounded) < 1 || !Number.isFinite(rounded)
      ? ""
      : rounded > 0
        ? `+${rounded}`
        : `−${-rounded}`;
  return from ? `${from}${value}` : value;
}

export function pitchName(pitch: number): string {
  const rounded = Math.round(pitch);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

/**
 * Melodic projection fitted to the notes: at least one octave, padded by a
 * semitone, so a bass line and a lead both use the whole highway width.
 */
export function pitchProjection(
  notes: readonly NoteSnapshot[],
  minimumSpan = 12,
  period?: { size: number; root: number },
): LaneProjection {
  const pitches = notes
    .map((note) => note.pitch)
    .filter((pitch): pitch is number => Number.isFinite(pitch));
  let low = pitches.length ? Math.min(...pitches) : 60;
  let high = pitches.length ? Math.max(...pitches) : 71;
  low = Math.max(0, Math.round(low) - 1);
  high = Math.min(127, Math.round(high) + 1);
  while (high - low + 1 < minimumSpan) {
    if (low > 0) low -= 1;
    if (high - low + 1 < minimumSpan && high < 127) high += 1;
    if (low === 0 && high === 127) break;
  }
  const laneCount = high - low + 1;
  return {
    kind: "pitch",
    laneCount,
    laneOf(note) {
      if (note.pitch === undefined || !Number.isFinite(note.pitch))
        return note.lane;
      return Math.max(0, Math.min(laneCount - 1, Math.round(note.pitch) - low));
    },
    label(lane) {
      const pitch = low + lane;
      if (period) {
        // Mark each period from the root, named as the root plus octaves.
        const offset = pitch - period.root;
        if (offset % period.size !== 0) return undefined;
        const octaves = offset / period.size;
        return pitchName(period.root).replace(
          /-?\d+$/,
          String(Math.floor(period.root / 12) - 1 + octaves),
        );
      }
      return pitch % 12 === 0 ? pitchName(pitch) : undefined;
    },
  };
}

/** Choose the projection a snapshot implies. */
export function projectionFor(score: TrackScoreSnapshot): LaneProjection {
  if (score.projection) return score.projection;
  const explicit =
    score.laneLabels !== undefined ||
    score.notes.some((note) => note.lane !== undefined);
  if (explicit)
    return explicitLaneProjection(
      score.laneCount ?? score.laneLabels?.length ?? 12,
      score.laneLabels,
    );
  // Melodic overlays share the focused track's pitch axis, so the fit covers
  // their pitches too and a bass line and a lead keep their real intervals.
  const melodic = (score.layers ?? [])
    .filter((layer) => isPitchLayer(layer))
    .flatMap((layer) => layer.notes);
  return pitchProjection(
    melodic.length ? [...score.notes, ...melodic] : score.notes,
    12,
    score.tuningPeriod,
  );
}

function isPitchLayer(layer: HighwayLayer): boolean {
  return (
    layer.projection === undefined &&
    !layer.notes.some((note) => note.lane !== undefined)
  );
}

/**
 * Lane mapper for an overlay: pitch layers reuse a pitch main projection
 * directly; anything else is projected on its own lanes and scaled across the
 * main lane count.
 */
export function layerLaneOf(
  layer: HighwayLayer,
  main: LaneProjection,
): (note: NoteSnapshot) => number | undefined {
  if (main.kind === "pitch" && isPitchLayer(layer))
    return (note) => main.laneOf(note);
  const own = layer.projection ?? projectionFor({ notes: layer.notes });
  const scale = (main.laneCount - 1) / Math.max(1, own.laneCount - 1);
  return (note) => {
    const lane = own.laneOf(note);
    if (lane === undefined) return undefined;
    return Math.max(0, Math.min(main.laneCount - 1, Math.round(lane * scale)));
  };
}

// ---------------------------------------------------------------------------
// Glyphs

export interface HighwayGlyphs {
  density: readonly [string, string, string, string];
  beam: string;
  beamTip: string;
  ghost: string;
  ghostHead: string;
  beatRule: string;
  barRule: string;
  loopRule: string;
  hitStrong: string;
  hitSoft: string;
  target: string;
  flash: string;
  burst: readonly [string, string, string];
  spark: string;
  sparkFar: string;
  sustainCore: string;
  pending: string;
  muted: string;
  play: string;
  pause: string;
  loop: string;
}

export const UNICODE_GLYPHS: HighwayGlyphs = {
  density: ["░", "▒", "▓", "█"],
  beam: "┃",
  beamTip: "╻",
  ghost: "╎",
  ghostHead: "▫",
  beatRule: "┈",
  barRule: "─",
  loopRule: "═",
  hitStrong: "━",
  hitSoft: "─",
  target: "▔",
  flash: "█",
  burst: ["✸", "✦", "✧"],
  spark: "✦",
  sparkFar: "·",
  sustainCore: "◆",
  pending: "◇",
  muted: "·",
  play: "▶",
  pause: "⏸",
  loop: "↻",
};

export const ASCII_GLYPHS: HighwayGlyphs = {
  density: [".", ":", "o", "#"],
  beam: "|",
  beamTip: "'",
  ghost: ":",
  ghostHead: ".",
  beatRule: ".",
  barRule: "-",
  loopRule: "=",
  hitStrong: "=",
  hitSoft: "-",
  target: "^",
  flash: "#",
  burst: ["*", "+", "."],
  spark: "*",
  sparkFar: ".",
  sustainCore: "@",
  pending: "o",
  muted: ".",
  play: ">",
  pause: "|",
  loop: "@",
};

export function glyphsFor(capabilities: TerminalCapabilities): HighwayGlyphs {
  return capabilities.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

export function densityIndex(velocity: number | undefined): 0 | 1 | 2 | 3 {
  const v = velocity ?? 0.8;
  if (v < 0.3) return 0;
  if (v < 0.55) return 1;
  if (v < 0.8) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Transport helpers

export function resolveBeat(score: TrackScoreSnapshot, nowMs: number): number {
  const base = score.currentBeat ?? score.transportBeat ?? 0;
  if (!score.playing || score.transportStartedAtMs === undefined) return base;
  const bpm = Math.max(1, score.bpm ?? 120);
  return (
    base + (Math.max(0, nowMs - score.transportStartedAtMs) * bpm) / 60_000
  );
}

/** Milliseconds for a beat span at the score tempo. */
function beatsToMs(beats: number, bpm: number): number {
  return (beats * 60_000) / Math.max(1, bpm);
}

/** Hit animation phases, in milliseconds after the note crosses the line. */
export const HIT_FLASH_MS = 80;
export const HIT_BURST_MS = 170;
export const HIT_FADE_MS = 260;
export const GHOST_BEATS = 0.5;

export type HitPhase =
  "approach" | "flash" | "burst" | "fade" | "sustain" | "ghost" | "past";

/** Pure hit state machine for one note occurrence at one transport beat. */
export function hitPhase(
  startBeat: number,
  endBeat: number,
  beat: number,
  bpm: number,
): HitPhase {
  if (beat < startBeat) return "approach";
  const ageMs = beatsToMs(beat - startBeat, bpm);
  if (ageMs < HIT_FLASH_MS) return "flash";
  if (ageMs < HIT_BURST_MS) return "burst";
  if (beat < endBeat) return "sustain";
  if (ageMs < HIT_FADE_MS) return "fade";
  if (beat - endBeat < GHOST_BEATS) return "ghost";
  return "past";
}

// ---------------------------------------------------------------------------
// Rendering

export interface HighwayRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighwayOptions {
  theme: Theme;
  capabilities: TerminalCapabilities;
  reducedMotion?: boolean;
  /** Beats visible above the hit line; derived from height when omitted. */
  lookaheadBeats?: number;
  /** Background style painted under the highway. */
  background?: Style;
}

export interface HighwayLayout {
  hitRow: number;
  gutter: number;
  laneLeft: number;
  laneWidth: number;
  tileWidth: number;
  laneCount: number;
  rowsPerBeat: number;
  legendRow: number | undefined;
}

export function highwayLayout(
  region: HighwayRegion,
  projection: LaneProjection,
  lookaheadBeats?: number,
): HighwayLayout {
  const legend = projection.label !== undefined && region.height >= 8 ? 1 : 0;
  const below = Math.max(1, Math.min(3, Math.floor(region.height * 0.18)));
  const hitRow = Math.max(1, region.height - below - 1 - legend);
  const gutter = region.width >= 40 ? 3 : 0;
  const area = Math.max(1, region.width - gutter);
  const laneCount = projection.laneCount;
  const laneWidth = laneCount <= area ? Math.floor(area / laneCount) : 0;
  const used = laneWidth > 0 ? laneWidth * laneCount : area;
  const laneLeft = gutter + Math.floor((area - used) / 2);
  const tileWidth =
    laneWidth >= 4 ? laneWidth - 1 : Math.max(1, laneWidth || 1);
  const lookahead =
    lookaheadBeats ?? Math.max(2, Math.min(8, Math.round(hitRow / 2.5)));
  return {
    hitRow,
    gutter,
    laneLeft,
    laneWidth,
    tileWidth,
    laneCount,
    rowsPerBeat: hitRow / Math.max(0.5, lookahead),
    legendRow: legend ? region.height - 1 : undefined,
  };
}

function laneX(layout: HighwayLayout, lane: number, areaWidth: number): number {
  if (layout.laneWidth > 0)
    return (
      layout.laneLeft +
      lane * layout.laneWidth +
      (layout.laneWidth >= 4 ? 0 : 0)
    );
  return (
    layout.gutter +
    Math.floor((lane * areaWidth) / Math.max(1, layout.laneCount))
  );
}

interface Painter {
  put(x: number, y: number, ch: string, style: Style): void;
  restyle(x: number, y: number, style: Style): void;
  isBlank(x: number, y: number): boolean;
}

/**
 * Paint the highway for one transport beat into `buffer` at `region`.
 * Returns the layout for callers that need the hit-line row.
 */
export function paintHighway(
  buffer: CellBuffer,
  region: HighwayRegion,
  score: TrackScoreSnapshot,
  beat: number,
  options: HighwayOptions,
): HighwayLayout {
  const { theme, capabilities } = options;
  const roles = theme.roles;
  const reduced = options.reducedMotion ?? false;
  const glyphs = glyphsFor(capabilities);
  const background = options.background ?? roles.canvas;
  const bg = (style: Style): Style => onBackground(style, background);
  const projection = projectionFor(score);
  const layout = highwayLayout(region, projection, options.lookaheadBeats);
  const { hitRow, rowsPerBeat, gutter } = layout;
  const areaWidth = Math.max(1, region.width - gutter);
  const bpm = Math.max(1, score.bpm ?? 120);
  const beatsPerBar = Math.max(1, Math.round(score.beatsPerBar ?? 4));
  const loop =
    score.loopBeats && Number.isFinite(score.loopBeats) && score.loopBeats > 0
      ? score.loopBeats
      : undefined;

  buffer.fill(region.x, region.y, region.width, region.height, background);
  const painter: Painter = {
    put(x, y, ch, style) {
      if (x < 0 || y < 0 || x >= region.width || y >= region.height) return;
      buffer.set(region.x + x, region.y + y, ch, bg(style));
    },
    restyle(x, y, style) {
      if (x < 0 || y < 0 || x >= region.width || y >= region.height) return;
      buffer.restyle(region.x + x, region.y + y, bg(style));
    },
    isBlank(x, y) {
      return buffer.get(region.x + x, region.y + y)?.ch === " ";
    },
  };

  const rowBeat = (row: number): number => beat + (hitRow - row) / rowsPerBeat;
  const legendRow = layout.legendRow;
  const lastNoteRow = (legendRow ?? region.height) - 1;
  // Nothing to label yet: bar numbers and the lane legend stay off and a
  // centred hint says how to start. The hit line and grid still draw.
  const empty =
    score.notes.length === 0 &&
    !(score.layers ?? []).some((layer) => layer.notes.length > 0);

  // Beat, bar, and loop rules of increasing strength.
  const barBeats =
    score.barBeats && score.barBeats.length > 0 ? score.barBeats : undefined;
  for (let row = 0; row <= lastNoteRow; row += 1) {
    if (row === hitRow) continue;
    const center = rowBeat(row);
    const half = 0.5 / rowsPerBeat;
    let k = Math.ceil(center - half - 1e-9);
    // Meter changes: a bar may start between beats (7/8), so the row's
    // bar start wins over the whole beat.
    let barIndex: number | undefined;
    if (barBeats) {
      const base = loop ? Math.floor((center - half) / loop) * loop : 0;
      for (const offset of loop ? [base, base + loop] : [0]) {
        const found = barBeats.findIndex((start) => {
          const at = offset + start;
          return at >= center - half - 1e-9 && at < center + half - 1e-9;
        });
        if (found >= 0) {
          barIndex = found;
          k = offset + barBeats[found]!;
          break;
        }
      }
    }
    if (k > center + half - 1e-9 || k < 0) continue;
    const inLoop = loop ? ((k % loop) + loop) % loop : k;
    const isLoop = loop !== undefined && Math.abs(inLoop) < 1e-9;
    const isBar = barBeats
      ? barIndex !== undefined
      : Math.abs(inLoop % beatsPerBar) < 1e-9;
    const glyph = isLoop
      ? glyphs.loopRule
      : isBar
        ? glyphs.barRule
        : glyphs.beatRule;
    const style = isLoop
      ? roles.loopRule
      : isBar
        ? roles.barRule
        : roles.beatRule;
    for (let column = gutter; column < region.width; column += 1) {
      if (!isBar && !isLoop && (column - gutter) % 2 === 1) continue;
      painter.put(column, row, glyph, style);
    }
    if (gutter > 0 && (isBar || isLoop) && !empty) {
      const label = isLoop
        ? glyphs.loop
        : String(
            barIndex !== undefined
              ? barIndex + 1
              : Math.floor(inLoop / beatsPerBar) + 1,
          );
      const text = label.slice(-(gutter - 1)).padStart(gutter - 1, " ");
      for (let index = 0; index < text.length; index += 1)
        painter.put(
          index,
          row,
          text[index]!,
          isLoop ? roles.loopRule : roles.muted,
        );
    }
  }

  // Hit line with a beat pulse; motion off leaves it static and heavy.
  const phase = ((beat % 1) + 1) % 1;
  const pulse = reduced || !score.playing ? 0 : (1 - phase) ** 2;
  const strong = reduced || !score.playing || phase < 0.15;
  const hitStyle = shade(roles.hitLine, pulse * 0.5);
  for (let column = gutter; column < region.width; column += 1)
    painter.put(
      column,
      hitRow,
      strong ? glyphs.hitStrong : glyphs.hitSoft,
      strong && pulse > 0 ? { ...hitStyle, bold: true } : hitStyle,
    );
  if (gutter > 0) {
    const marker = score.playing ? glyphs.play : glyphs.pause;
    painter.put(
      gutter - 2,
      hitRow,
      marker,
      score.playing ? roles.transport : roles.paused,
    );
  }

  // Loop-wrap sweep: a bright band crosses the hit line during the first beat
  // after the transport wraps.
  if (loop && !reduced && score.playing && beat >= loop * 0.5) {
    const loopPhase = ((beat % loop) + loop) % loop;
    if (loopPhase < 1) {
      const head = Math.round(gutter + loopPhase * areaWidth);
      for (let offset = 0; offset < 6; offset += 1) {
        const column = head - offset;
        if (column < gutter || column >= region.width) continue;
        painter.put(
          column,
          hitRow,
          glyphs.loopRule,
          shade(roles.loopRule, 0.5 - offset * 0.1),
        );
      }
    }
  }

  if (empty) {
    const name = score.trackName ?? score.trackId ?? "track";
    const start = projection.kind === "pitch" ? "add C4 at 0" : "hit kick at 0";
    // First run: name the three ways in (ask, play, menu); narrow
    // windows fall back to one prompt command.
    const full = `${name} · empty · type a request · ctrl-p play · ctrl-k menu`;
    const text = truncate(
      full.length <= areaWidth ? full : `${name} · empty · ${start} to start`,
      areaWidth,
    );
    const x = gutter + Math.max(0, Math.floor((areaWidth - text.length) / 2));
    const y = Math.max(0, Math.floor(hitRow / 2));
    for (let index = 0; index < text.length; index += 1)
      painter.put(x + index, y, text[index]!, roles.muted);
  }

  // Legend for drum voices (or C-octave markers for pitch lanes).
  if (legendRow !== undefined && projection.label && !empty) {
    let nextFree = 0;
    for (let lane = 0; lane < layout.laneCount; lane += 1) {
      const label = projection.label(lane);
      if (!label) continue;
      const x = laneX(layout, lane, areaWidth);
      const room =
        layout.laneWidth > 0
          ? Math.max(1, projection.kind === "pitch" ? 4 : layout.laneWidth - 1)
          : 3;
      const text = label.slice(0, room);
      const start = Math.max(nextFree, Math.min(region.width - text.length, x));
      if (start + text.length > region.width) continue;
      for (let index = 0; index < text.length; index += 1)
        painter.put(start + index, legendRow, text[index]!, roles.muted);
      nextFree = start + text.length + 1;
    }
  }

  // Note occurrences across loop repeats, ordered so active notes draw last.
  const belowBeats = (lastNoteRow - hitRow + 1) / rowsPerBeat;
  const aheadBeats = hitRow / rowsPerBeat + 1 / rowsPerBeat;
  const accent = accentStyle(theme, score.trackId ?? score.trackName);
  interface Occurrence {
    note: NoteSnapshot;
    lane: number;
    start: number;
    end: number;
    phase: HitPhase;
    accent: Style;
    dim: boolean;
  }
  const occurrences: Occurrence[] = [];
  const sources: {
    note: NoteSnapshot;
    laneOf: (note: NoteSnapshot) => number | undefined;
    accent: Style;
    dim: boolean;
  }[] = [];
  let layerBudget = MAX_LAYER_NOTES;
  for (const layer of score.layers ?? []) {
    if (layer.trackId === score.trackId) continue;
    const laneOf = layerLaneOf(layer, projection);
    const layerAccent = accentStyle(theme, layer.trackId);
    for (const note of layer.notes) {
      if (layerBudget <= 0) break;
      layerBudget -= 1;
      sources.push({ note, laneOf, accent: layerAccent, dim: true });
    }
  }
  const focusLaneOf = (note: NoteSnapshot) => projection.laneOf(note);
  for (const note of score.notes)
    sources.push({ note, laneOf: focusLaneOf, accent, dim: false });
  for (const source of sources) {
    const { note } = source;
    if (!Number.isFinite(note.startBeat)) continue;
    const lane = source.laneOf(note);
    if (lane === undefined) continue;
    const duration = Math.max(0, note.durationBeats ?? 0);
    const starts: number[] = [];
    if (loop) {
      const first = Math.floor(
        (beat - belowBeats - duration - note.startBeat) / loop,
      );
      const last = Math.ceil((beat + aheadBeats - note.startBeat) / loop);
      for (let k = Math.max(0, first); k <= last; k += 1)
        starts.push(note.startBeat + k * loop);
    } else starts.push(note.startBeat);
    for (const start of starts) {
      const end = start + duration;
      if (end < beat - belowBeats || start > beat + aheadBeats) continue;
      occurrences.push({
        note,
        lane,
        start,
        end,
        phase: hitPhase(start, end, beat, bpm),
        accent: source.accent,
        dim: source.dim,
      });
    }
  }
  const order: Record<HitPhase, number> = {
    past: 0,
    ghost: 1,
    approach: 2,
    sustain: 3,
    fade: 4,
    burst: 5,
    flash: 6,
  };
  // Dimmed overlays first so the focused track always draws on top.
  occurrences.sort(
    (a, b) =>
      Number(b.dim) - Number(a.dim) ||
      order[a.phase] - order[b.phase] ||
      b.start - a.start,
  );

  const rowOf = (time: number): number =>
    Math.round(hitRow - (time - beat) * rowsPerBeat);

  for (const item of occurrences) {
    const { note } = item;
    const x = laneX(layout, item.lane, areaWidth);
    const width = layout.laneWidth > 0 ? layout.tileWidth : 1;
    const center = x + Math.floor((width - 1) / 2);
    const velocity = Math.max(0, Math.min(1, note.velocity ?? 0.8));
    if (item.dim) {
      paintDimmed(painter, glyphs, roles, item, {
        x,
        width,
        center,
        headRow: rowOf(item.start),
        tailRow: rowOf(item.end),
        hitRow,
        lastNoteRow,
        sustaining: beat < item.end,
        style: shade(velocityStyle(item.accent, velocity), -0.5),
      });
      continue;
    }
    let base = velocityStyle(accent, velocity);
    if (note.muted) base = roles.mutedNote;
    else if (note.pending)
      base = { ...base, ...roles.pending, fg: roles.pending.fg ?? base.fg };
    if (note.selected) base = { ...base, reverse: true };
    const density = glyphs.density[densityIndex(note.velocity)];
    const headGlyph = note.muted
      ? glyphs.muted
      : note.pending
        ? glyphs.pending
        : density;
    const tile = (
      row: number,
      ch: string,
      style: Style,
      centerCh?: string,
    ): void => {
      if (row < 0 || row > lastNoteRow) return;
      for (let offset = 0; offset < width; offset += 1) {
        const column = x + offset;
        const glyph =
          centerCh !== undefined && column === center ? centerCh : ch;
        painter.put(column, row, glyph, style);
      }
    };
    const beam = (fromRow: number, toRow: number, tipFade: boolean): void => {
      // Rows strictly between head and tail; upper rows decay toward the tip.
      const top = Math.max(0, Math.min(fromRow, toRow));
      const bottom = Math.min(lastNoteRow, Math.max(fromRow, toRow));
      const span = Math.max(1, bottom - top);
      for (let row = top; row <= bottom; row += 1) {
        const decay = tipFade ? (bottom - row) / span : 0;
        const style = note.muted
          ? roles.mutedNote
          : shade(
              {
                ...base,
                fg:
                  roles.sustain.fg && !note.pending
                    ? mixAccent(base, roles.sustain)
                    : base.fg,
              },
              -0.55 * decay,
            );
        const glyph = row === top && span > 1 ? glyphs.beamTip : glyphs.beam;
        painter.put(center, row, glyph, style);
      }
    };

    const headRow = rowOf(item.start);
    const tailRow = rowOf(item.end);
    switch (item.phase) {
      case "approach": {
        if (tailRow < headRow - 1)
          beam(tailRow, Math.min(headRow - 1, hitRow - 1), true);
        const distance = item.start - beat;
        const glow = reduced ? 0 : Math.max(0, 1 - distance);
        const style = note.muted
          ? base
          : glow > 0.6
            ? { ...shade(base, 0.45 * glow), bold: true }
            : shade(base, 0.45 * glow);
        if (headRow <= hitRow - 1) {
          tile(headRow, headGlyph, style);
          const tag =
            (note.cents !== undefined || note.centsFrom !== undefined) &&
            !note.muted
              ? centsTag(note.cents, note.centsFrom)
              : "";
          if (tag && x + width + tag.length <= region.width)
            for (let index = 0; index < tag.length; index += 1)
              painter.put(x + width + index, headRow, tag[index]!, roles.muted);
        }
        // The target on the hit line lights up as the note approaches.
        if (!note.muted && glow > 0 && width > 0) {
          for (let offset = 0; offset < width; offset += 1)
            painter.put(x + offset, hitRow, glyphs.hitStrong, {
              ...shade(accent, glow * 0.3 - 0.3),
              bold: glow > 0.5,
            });
        }
        break;
      }
      case "flash":
      case "burst":
      case "fade":
      case "sustain": {
        if (note.muted) {
          tile(hitRow, glyphs.muted, roles.mutedNote);
          break;
        }
        const sustaining = beat < item.end;
        if (sustaining && tailRow < hitRow) beam(tailRow, hitRow - 1, true);
        const phaseStyle = reduced ? "sustain" : item.phase;
        if (phaseStyle === "flash") {
          tile(hitRow, glyphs.flash, roles.hit);
          tile(
            hitRow - 1,
            glyphs.burst[0],
            { ...roles.hit, reverse: false },
            glyphs.burst[0],
          );
          painter.put(x - 1, hitRow, glyphs.spark, roles.hit);
          painter.put(x + width, hitRow, glyphs.spark, roles.hit);
        } else if (phaseStyle === "burst") {
          tile(
            hitRow,
            glyphs.density[2],
            shade(roles.hit, -0.1),
            glyphs.burst[0],
          );
          painter.put(x - 2, hitRow, glyphs.sparkFar, shade(roles.hit, -0.3));
          painter.put(
            x + width + 1,
            hitRow,
            glyphs.sparkFar,
            shade(roles.hit, -0.3),
          );
          painter.put(
            center,
            hitRow - 1,
            glyphs.burst[1],
            shade(roles.hit, -0.2),
          );
        } else if (phaseStyle === "fade") {
          tile(hitRow, glyphs.density[1], shade(base, -0.2), glyphs.burst[2]);
        } else if (sustaining) {
          // Held note: the core breathes with the beat and decays over time.
          const progress = Math.max(
            0,
            Math.min(
              1,
              (beat - item.start) / Math.max(1e-6, item.end - item.start),
            ),
          );
          const breathe = reduced ? 0 : 0.25 * (1 - phase);
          const core = shade(
            mixStyle(base, roles.sustain),
            breathe - 0.35 * progress,
          );
          tile(
            hitRow,
            glyphs.hitStrong,
            { ...core, bold: true },
            glyphs.sustainCore,
          );
        } else {
          tile(hitRow, glyphs.density[1], shade(base, -0.3), glyphs.burst[2]);
        }
        break;
      }
      case "ghost":
      case "past": {
        // Post-release ghost at the hit line, then faint passed notes below.
        if (item.phase === "ghost" && !reduced)
          painter.put(center, hitRow, glyphs.ghost, roles.ghost);
        const from = Math.max(hitRow + 1, tailRow);
        const to = Math.min(lastNoteRow, headRow);
        for (let row = from; row <= to; row += 1) {
          const glyph = row === to ? glyphs.ghostHead : glyphs.ghost;
          if (painter.isBlank(center, row) || row === to)
            painter.put(center, row, glyph, roles.ghost);
        }
        break;
      }
    }
  }
  return layout;
}

/**
 * A background track: a quiet head and sustain line in the track's accent,
 * no hit flash, sparks or ghosts, so the focused track stays readable.
 */
function paintDimmed(
  painter: Painter,
  glyphs: HighwayGlyphs,
  roles: Theme["roles"],
  item: { note: NoteSnapshot; phase: HitPhase },
  geometry: {
    x: number;
    width: number;
    center: number;
    headRow: number;
    tailRow: number;
    hitRow: number;
    lastNoteRow: number;
    sustaining: boolean;
    style: Style;
  },
): void {
  const { x, width, center, headRow, tailRow, hitRow, lastNoteRow } = geometry;
  const style = item.note.muted ? roles.mutedNote : geometry.style;
  const head = glyphs.density[Math.min(1, densityIndex(item.note.velocity))]!;
  const tile = (row: number, ch: string): void => {
    if (row < 0 || row > lastNoteRow) return;
    for (let offset = 0; offset < width; offset += 1)
      painter.put(x + offset, row, ch, style);
  };
  if (item.phase === "approach") {
    for (
      let row = Math.max(0, tailRow);
      row < Math.min(headRow, hitRow);
      row += 1
    )
      painter.put(center, row, glyphs.beam, style);
    if (headRow <= hitRow - 1) tile(headRow, head);
    return;
  }
  if (item.phase === "past" || item.phase === "ghost") return;
  if (geometry.sustaining && tailRow < hitRow)
    for (let row = Math.max(0, tailRow); row < hitRow; row += 1)
      painter.put(center, row, glyphs.beam, style);
  tile(hitRow, head);
}

function mixStyle(base: Style, overlay: Style): Style {
  if (!base.fg || !overlay.fg)
    return { ...base, ...overlay, fg: base.fg ?? overlay.fg };
  return { ...base, fg: mixRgb(base.fg, overlay.fg, 0.35) };
}

function mixAccent(base: Style, overlay: Style): Style["fg"] {
  return mixStyle(base, overlay).fg;
}

function mixRgb(
  from: NonNullable<Style["fg"]>,
  to: NonNullable<Style["fg"]>,
  amount: number,
): NonNullable<Style["fg"]> {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}
