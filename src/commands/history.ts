/**
 * Undo/redo over the shared session event log.
 *
 * Every event carries a `rewind` (see `src/session/delta.ts`): how to turn
 * the composition it produced back into the one it replaced. Undo and redo
 * append ordinary events (`score.undo` / `score.redo`), so history is linear,
 * shared by every window, and survives restarts. Replaying the log rebuilds
 * two stacks over the events that changed the composition:
 *
 *   edit  -> push onto undo, clear redo
 *   undo  -> pop undo, push the undo event onto redo
 *   redo  -> pop redo, push the redo event onto undo
 *
 * Undoing restores the composition before the top undo entry; redoing
 * restores the composition before the top redo entry (the one the undo
 * replaced). Both are recovered by rewinding the current composition through
 * every newer event. Events whose rewind was compacted away, and events that
 * did not change the composition (transport), take no part.
 */
import type { TrackScore } from "../../core/score.ts";
import { musicalReceipt } from "../session/receipt.ts";
import {
  isIdentityRewind,
  rewindComposition,
  type Rewind,
} from "../session/delta.ts";

export type HistoryEvent = Readonly<{
  revision: number;
  kind: string;
  rewind?: Rewind | undefined;
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
  composition: unknown,
  events: readonly HistoryEvent[],
  direction: "undo" | "redo",
): HistoryTarget | undefined {
  const undo: number[] = [];
  const redo: number[] = [];
  events.forEach((event, index) => {
    if (!changesComposition(event)) return;
    if (event.kind === UNDO_KIND) {
      if (undo.pop() !== undefined) redo.push(index);
    } else if (event.kind === REDO_KIND) {
      if (redo.pop() !== undefined) undo.push(index);
    } else {
      undo.push(index);
      redo.length = 0;
    }
  });
  const top = (direction === "undo" ? undo : redo).at(-1);
  if (top === undefined) return undefined;
  const restored = rewindComposition(composition, events, top);
  if (restored === undefined) return undefined;
  return { revision: events[top]!.revision, composition: restored };
}

function changesComposition(event: HistoryEvent): boolean {
  return event.rewind !== undefined && !isIdentityRewind(event.rewind);
}

/**
 * The card after undo or redo names the musical change it made
 * (`undid · −1 note on bass (C3)`, `redid · 96 BPM`), and falls back to the
 * revision when the change is not in the music (a rename, a section label).
 */
export function historyReceipt(
  direction: "undo" | "redo",
  before: TrackScore,
  after: TrackScore,
  revision: number,
): string {
  const verb = direction === "undo" ? "undid" : "redid";
  const change = musicalReceipt(before, after);
  return change ? `${verb} · ${change}` : `${verb} · rev ${revision}`;
}
