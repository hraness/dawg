/** Horizontal, read-only track observer. No score or transport mutations. */
import {
  lyricStrip,
  pitchName,
  projectionFor,
  type LaneProjection,
  type NoteSnapshot,
  type TrackScoreSnapshot,
} from "./highway.ts";
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import {
  accentStyle,
  type Style,
  type TerminalCapabilities,
  type Theme,
} from "./theme.ts";

export type PianoRollOptions = Readonly<{
  theme: Theme;
  capabilities: TerminalCapabilities;
  beat?: number;
  writingBeat?: number;
  /** An explicit horizontal inspection range; absent follows writing/playback. */
  firstBeat?: number;
  columnsPerBeat?: number;
  firstLane?: number;
  pinned?: boolean;
  /** undefined means unknown; null means no revision has become audible. */
  audibleRevision?: number | null;
  /** Optional previous audible notes; never infer them from pending notes. */
  audibleNotes?: readonly NoteSnapshot[];
  sections?: readonly Readonly<{
    name: string;
    startBeat: number;
    durationBeats: number;
  }>[];
  /** An observed job stage or missing-asset message, supplied by the host. */
  status?: string;
}>;

export type PianoRollLayout = Readonly<{
  gridX: number;
  gridY: number;
  columns: number;
  rows: number;
  firstBeat: number;
  endBeat: number;
  columnsPerBeat: number;
  firstLane: number;
  projection: LaneProjection;
  rulerY: number;
  lyricY?: number;
  clipY?: number;
}>;

const finite = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

/** A bounded horizontal window, with one quarter of its width ahead of the cursor. */
export function pianoRollFirstBeat(
  score: TrackScoreSnapshot,
  columns: number,
  options: Pick<
    PianoRollOptions,
    "beat" | "writingBeat" | "firstBeat" | "columnsPerBeat"
  >,
): number {
  const cpb = Math.max(1, Math.min(16, finite(options.columnsPerBeat, 4)));
  const span = Math.max(0, columns) / cpb;
  if (options.firstBeat !== undefined)
    return Math.max(0, finite(options.firstBeat, 0));
  const focus = Math.max(
    0,
    finite(
      options.writingBeat,
      finite(options.beat, score.transportBeat ?? score.currentBeat ?? 0),
    ),
  );
  const perBar = Math.max(1, finite(score.beatsPerBar, 4));
  const first = Math.max(
    Math.floor(Math.max(0, focus - span * 0.75) / perBar) * perBar,
    Math.ceil((focus - span + 1 / cpb) * cpb) / cpb,
  );
  const end = Math.max(
    focus + 1 / cpb,
    finite(score.loopBeats, 0),
    ...score.notes.map(
      (note) =>
        finite(note.startBeat, 0) +
        Math.max(0.25, finite(note.durationBeats, 0.25)),
    ),
  );
  return Math.max(0, Math.min(first, Math.max(0, end - span)));
}

function plain(value: string, unicode: boolean): string {
  return unicode
    ? value
    : value
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .replace(/[^\x20-\x7e]/g, "?");
}

/** Paint within rect, including when it is a small panel inside a larger screen. */
export function paintPianoRoll(
  buffer: CellBuffer,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  score: TrackScoreSnapshot,
  options: PianoRollOptions,
): PianoRollLayout {
  const { theme, capabilities } = options;
  const unicode = capabilities.unicode;
  const roles = theme.roles;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(
    0,
    Math.min(buffer.width, Math.floor(rect.x + rect.width)) - x,
  );
  const height = Math.max(
    0,
    Math.min(buffer.height, Math.floor(rect.y + rect.height)) - y,
  );
  const bottom = y + height;
  const write = (
    atX: number,
    atY: number,
    text: string,
    style: Style,
    room = x + width - atX,
  ) => {
    if (atX < x || atX >= x + width || atY < y || atY >= bottom) return;
    buffer.text(
      atX,
      atY,
      truncate(
        plain(text, unicode),
        Math.min(room, x + width - atX),
        unicode ? "…" : "~",
      ),
      style,
      Math.min(room, x + width - atX),
    );
  };
  const cell = (atX: number, atY: number, ch: string, style: Style) => {
    if (atX >= x && atX < x + width && atY >= y && atY < bottom)
      buffer.set(atX, atY, ch, style);
  };
  buffer.fill(x, y, width, height, roles.canvas);
  const hasSections = (options.sections?.length ?? 0) > 0;
  const hasLyrics = score.notes.some((note) => note.lyric !== undefined);
  const hasClips = (score.clips?.length ?? 0) > 0;
  const allNotes = [...score.notes, ...(options.audibleNotes ?? [])];
  const projection = projectionFor(
    { ...score, notes: allNotes },
    Math.max(
      12,
      height - 4 - Number(hasSections) - Number(hasLyrics) - Number(hasClips),
    ),
  );
  const labels = Array.from(
    { length: projection.laneCount },
    (_, lane) => projection.label?.(lane) ?? "",
  );
  const gutter = Math.min(
    Math.max(4, ...labels.map(displayWidth)) + 2,
    width >= 60 ? 17 : 9,
    Math.max(0, width - 4),
  );
  const columns = Math.max(0, width - gutter);
  const cpb = Math.max(1, Math.min(16, finite(options.columnsPerBeat, 4)));
  const firstBeat = pianoRollFirstBeat(score, columns, options);
  const endBeat = firstBeat + columns / cpb;
  const beat = Math.max(
    0,
    finite(
      options.beat,
      finite(score.transportBeat, finite(score.currentBeat, 0)),
    ),
  );
  const rulerY = y + 2 + Number(hasSections);
  const lyricY = hasLyrics && height >= 7 ? bottom - 2 : undefined;
  const clipY =
    hasClips && height >= 7
      ? bottom - 2 - Number(lyricY !== undefined)
      : undefined;
  const gridY = rulerY + 1;
  const gridBottom = Math.min(bottom - 1, clipY ?? lyricY ?? bottom - 1);
  const rows = Math.max(0, Math.min(projection.laneCount, gridBottom - gridY));
  const visibleLanes = allNotes
    .filter(
      (note) =>
        note.startBeat < endBeat &&
        note.startBeat + Math.max(0.25, note.durationBeats ?? 0.25) > firstBeat,
    )
    .map((note) => projection.laneOf(note))
    .filter(
      (lane): lane is number => lane !== undefined && Number.isFinite(lane),
    )
    .sort((a, b) => a - b);
  const centerLane =
    visibleLanes[Math.floor(visibleLanes.length / 2)] ??
    Math.floor(projection.laneCount / 2);
  const firstLane = Math.max(
    0,
    Math.min(
      projection.laneCount - rows,
      Math.floor(finite(options.firstLane, centerLane - rows / 2)),
    ),
  );
  const layout: PianoRollLayout = {
    gridX: x + gutter,
    gridY,
    columns,
    rows,
    firstBeat,
    endBeat,
    columnsPerBeat: cpb,
    firstLane,
    projection,
    rulerY,
    lyricY,
    clipY,
  };
  const accent = accentStyle(
    theme,
    score.trackId ?? score.trackName ?? "track",
  );
  const sep = unicode ? " · " : " | ";
  write(
    x,
    y,
    `${score.trackName ?? score.trackId ?? "Track"}${sep}${options.pinned ? "PINNED" : "following"}`,
    { ...accent, bold: true },
  );
  const written =
    score.revision === undefined ? "written" : `written r${score.revision}`;
  const audible =
    options.audibleRevision === undefined
      ? "audio unknown"
      : options.audibleRevision === null
        ? "not yet audible"
        : `audible r${options.audibleRevision}`;
  write(
    x,
    y + 1,
    [written, audible, options.status].filter(Boolean).join(sep),
    roles.muted,
  );
  if (columns < 4 || rows < 1) {
    write(
      x,
      y + Math.min(2, Math.max(0, height - 1)),
      "resize for piano roll",
      roles.warning,
    );
    return layout;
  }
  const column = (time: number) => Math.floor((time - firstBeat) * cpb);
  const inColumn = (time: number) =>
    Number.isFinite(time) && time >= firstBeat && time < endBeat;
  const barStarts: number[] = score.barBeats ? [...score.barBeats] : [];
  if (!score.barBeats) {
    const perBar = Math.max(1, finite(score.beatsPerBar, 4));
    for (
      let time = Math.ceil(firstBeat / perBar) * perBar;
      time < endBeat;
      time += perBar
    )
      barStarts.push(time);
  }
  const barColumns = new Set(barStarts.filter(inColumn).map(column));
  const perBar = Math.max(1, finite(score.beatsPerBar, 4));
  write(x, rulerY, "bar", roles.muted, gutter - 1);
  for (const start of barStarts) {
    if (!inColumn(start)) continue;
    const index = score.barBeats
      ? score.barBeats.indexOf(start)
      : Math.round(start / perBar);
    write(
      layout.gridX + column(start),
      rulerY,
      String(index + 1),
      roles.muted,
      Math.min(
        columns - column(start),
        Math.max(1, Math.floor(perBar * cpb) - 1),
      ),
    );
  }
  if (hasSections)
    for (const section of options.sections ?? []) {
      if (
        !Number.isFinite(section.startBeat) ||
        !(section.durationBeats > 0) ||
        section.startBeat >= endBeat ||
        section.startBeat + section.durationBeats <= firstBeat
      )
        continue;
      const from = Math.max(0, column(section.startBeat));
      const to = Math.min(
        columns,
        Math.ceil(
          (section.startBeat + section.durationBeats - firstBeat) * cpb,
        ),
      );
      write(
        layout.gridX + from,
        y + 2,
        `${section.startBeat < firstBeat ? "<" : "|"} ${section.name}`,
        roles.track,
        to - from,
      );
    }
  const pitchNote = allNotes.find(
    (note) => note.pitch !== undefined && Number.isFinite(note.pitch),
  );
  const pitchLow =
    pitchNote?.pitch !== undefined
      ? Math.round(pitchNote.pitch) - (projection.laneOf(pitchNote) ?? 0)
      : 60;
  for (let row = 0; row < rows; row++) {
    const lane =
      projection.kind === "pitch"
        ? firstLane + rows - row - 1
        : firstLane + row;
    const label =
      projection.kind === "pitch" && !score.tuningPeriod
        ? pitchName(pitchLow + lane)
        : (projection.label?.(lane) ?? String(lane + 1));
    write(x, gridY + row, label, roles.muted, gutter - 1);
    for (let col = 0; col < columns; col++) {
      const time = firstBeat + col / cpb;
      if (barColumns.has(col))
        cell(
          layout.gridX + col,
          gridY + row,
          unicode ? "│" : "|",
          roles.barRule,
        );
      else if (Math.abs(time - Math.round(time)) < 1e-6)
        cell(
          layout.gridX + col,
          gridY + row,
          unicode ? "·" : ".",
          roles.beatRule,
        );
    }
  }
  const noteRow = (note: NoteSnapshot): number | undefined => {
    const lane = projection.laneOf(note);
    if (
      lane === undefined ||
      !Number.isFinite(lane) ||
      lane < firstLane ||
      lane >= firstLane + rows
    )
      return undefined;
    return (
      gridY +
      (projection.kind === "pitch"
        ? firstLane + rows - lane - 1
        : lane - firstLane)
    );
  };
  const draw = (notes: readonly NoteSnapshot[], old: boolean) => {
    for (const note of notes) {
      if (!Number.isFinite(note.startBeat)) continue;
      const row = noteRow(note);
      if (row === undefined) continue;
      const duration = Math.max(1 / cpb, finite(note.durationBeats, 0.25));
      const end = note.startBeat + duration;
      if (end <= firstBeat || note.startBeat >= endBeat) continue;
      const from = Math.max(0, column(note.startBeat));
      const to = Math.min(
        columns,
        Math.max(from + 1, Math.ceil((end - firstBeat) * cpb)),
      );
      const knownAudible =
        old ||
        (options.audibleRevision !== undefined &&
          options.audibleRevision !== null &&
          score.revision !== undefined &&
          options.audibleRevision === score.revision &&
          !note.pending);
      const pending =
        !knownAudible &&
        (note.pending || options.audibleRevision !== undefined);
      const style = note.muted
        ? roles.mutedNote
        : knownAudible
          ? roles.sustain
          : pending
            ? roles.pending
            : accent;
      for (let col = from; col < to; col++)
        cell(
          layout.gridX + col,
          row,
          knownAudible ? (unicode ? "━" : "-") : unicode ? "┄" : "=",
          style,
        );
      cell(
        layout.gridX + from,
        row,
        note.startBeat < firstBeat
          ? "<"
          : knownAudible
            ? unicode
              ? "■"
              : "#"
            : unicode
              ? "○"
              : "o",
        style,
      );
      if (end > endBeat) cell(layout.gridX + to - 1, row, ">", style);
    }
  };
  draw(options.audibleNotes ?? [], true);
  draw(score.notes, false);
  for (const [time, glyph, style] of [
    [beat, unicode ? "│" : "|", roles.transport],
    [options.writingBeat, unicode ? "┆" : ":", roles.agent],
  ] as const) {
    if (time === undefined || !inColumn(time)) continue;
    const atX = layout.gridX + column(time);
    cell(atX, rulerY, time === options.writingBeat ? "w" : "v", style);
    for (let row = 0; row < rows; row++) {
      const existing = buffer.get(atX, gridY + row);
      if (existing && ![" ", "│", "|", "·", "."].includes(existing.ch))
        buffer.restyle(atX, gridY + row, {
          ...existing.style,
          ...style,
          reverse: true,
        });
      else cell(atX, gridY + row, glyph, style);
    }
  }
  if (clipY !== undefined) {
    write(x, clipY, "audio", roles.muted, gutter - 1);
    for (const clip of score.clips ?? []) {
      if (
        !Number.isFinite(clip.startBeat) ||
        !(clip.durationBeats > 0) ||
        clip.startBeat >= endBeat ||
        clip.startBeat + clip.durationBeats <= firstBeat
      )
        continue;
      const from = Math.max(0, column(clip.startBeat));
      const to = Math.min(
        columns,
        Math.ceil((clip.startBeat + clip.durationBeats - firstBeat) * cpb),
      );
      for (let col = from; col < to; col++)
        cell(layout.gridX + col, clipY, "-", roles.track);
      cell(
        layout.gridX + from,
        clipY,
        clip.startBeat < firstBeat ? "<" : "[",
        roles.track,
      );
      cell(
        layout.gridX + to - 1,
        clipY,
        clip.startBeat + clip.durationBeats > endBeat ? ">" : "]",
        roles.track,
      );
      if (to - from > 4)
        write(
          layout.gridX + from + 1,
          clipY,
          clip.text ?? clip.take ?? clip.id,
          roles.text,
          to - from - 2,
        );
    }
  }
  if (lyricY !== undefined) {
    write(x, lyricY, "words", roles.muted, gutter - 1);
    for (const syllable of lyricStrip(score.notes, {
      beat: firstBeat,
      loop: undefined,
      width: columns,
      colsPerBeat: cpb,
      ascii: !unicode,
    }).cells)
      write(
        layout.gridX + syllable.x,
        lyricY,
        syllable.text,
        syllable.muted ? roles.muted : roles.text,
      );
  }
  if (score.notes.length === 0 && !hasClips)
    write(
      layout.gridX + 1,
      gridY + Math.floor(rows / 2),
      "Waiting for notes",
      roles.muted,
      columns - 2,
    );
  write(
    x,
    bottom - 1,
    `${unicode ? "■" : "#"} audible  ${unicode ? "○" : "o"} written/pending  v play  w writing${options.firstBeat === undefined ? "" : "  inspecting"}`,
    roles.muted,
  );
  return layout;
}
