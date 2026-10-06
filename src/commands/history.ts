/**
 * Undo/redo over the shared session event log.
 *
 * Every score edit records `before`, the composition it replaced. Undo and
 * redo append ordinary events (`score.undo` / `score.redo`) whose `before` is
 * the composition they replaced, so history is linear, shared by every
 * window, and survives restarts. Replaying the log rebuilds two stacks:
 *
 *   edit  -> push onto undo, clear redo
 *   undo  -> pop undo, push the undo event onto redo
 *   redo  -> pop redo, push the redo event onto undo
 *
 * Undoing restores the top undo entry's `before`; redoing restores the top
 * redo entry's `before` (the composition the undo replaced).
 */
export type HistoryEvent = Readonly<{
  revision: number;
  kind: string;
  payload: unknown;
}>;

export type HistoryTarget = Readonly<{
  /** Revision of the event being undone or redone. */
  revision: number;
  /** Composition to restore. */
  composition: unknown;
}>;

export const UNDO_KIND = "score.undo";
export const REDO_KIND = "score.redo";

export function historyTarget(
  events: readonly HistoryEvent[],
  direction: "undo" | "redo",
): HistoryTarget | undefined {
  const undo: HistoryEvent[] = [];
  const redo: HistoryEvent[] = [];
  for (const event of events) {
    if (!hasBefore(event.payload)) continue;
    if (event.kind === UNDO_KIND) {
      if (undo.pop()) redo.push(event);
    } else if (event.kind === REDO_KIND) {
      if (redo.pop()) undo.push(event);
    } else {
      undo.push(event);
      redo.length = 0;
    }
  }
  const top = (direction === "undo" ? undo : redo).at(-1);
  if (!top || !hasBefore(top.payload)) return undefined;
  return { revision: top.revision, composition: top.payload.before };
}

function hasBefore(payload: unknown): payload is { before: unknown } {
  return typeof payload === "object" && payload !== null && "before" in payload;
}
