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
import { DiffError, diffScores } from "../../core/diff.ts";
import {
  scoreFromJSON,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { rebaseOperations } from "../session/rebase.ts";
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
  payload?: unknown;
  /** Who wrote it; per-pane undo keys on `clientId` (design §12.6). */
  actor?: Readonly<{ clientId: string }> | undefined;
}>;

export type HistoryTarget = Readonly<{
  /** Revision of the event being undone or redone. */
  revision: number;
  /** Composition to restore. */
  composition: unknown;
}>;

export const UNDO_KIND = "score.undo";
export const REDO_KIND = "score.redo";

/**
 * Replays the log into undo and redo stacks of event indexes, over the
 * events `include` admits. An undo or redo event pops its stack only when
 * it stepped that stack's top (its payload names the revision); otherwise
 * it is an ordinary edit there. So a pane's own undo is an edit in the
 * global history (`undo all` can undo it), and an `undo all` that undid
 * another pane's edit is an edit in this pane's history. Old events without
 * the payload revision pop unconditionally, as they always did.
 */
function historyStacks(
  events: readonly HistoryEvent[],
  include: (event: HistoryEvent) => boolean,
): { undo: number[]; redo: number[] } {
  const undo: number[] = [];
  const redo: number[] = [];
  const steps = (stack: number[], event: HistoryEvent, key: string) => {
    const top = stack.at(-1);
    if (top === undefined) return false;
    const named = (event.payload as Record<string, unknown> | null)?.[key];
    return typeof named !== "number" || named === events[top]!.revision;
  };
  events.forEach((event, index) => {
    if (!changesComposition(event) || !include(event)) return;
    if (event.kind === UNDO_KIND && steps(undo, event, "undoneRevision")) {
      undo.pop();
      redo.push(index);
    } else if (
      event.kind === REDO_KIND &&
      steps(redo, event, "redoneRevision")
    ) {
      redo.pop();
      undo.push(index);
    } else {
      undo.push(index);
      redo.length = 0;
    }
  });
  return { undo, redo };
}

/** `undo all` / `redo all`: the global history, whoever made each edit. */
export function historyTarget(
  composition: unknown,
  events: readonly HistoryEvent[],
  direction: "undo" | "redo",
): HistoryTarget | undefined {
  const stacks = historyStacks(events, () => true);
  const top = stacks[direction].at(-1);
  if (top === undefined) return undefined;
  const restored = rewindComposition(composition, events, top);
  if (restored === undefined) return undefined;
  return { revision: events[top]!.revision, composition: restored };
}

export type PaneStep =
  | Readonly<{ ok: true; revision: number; next: TrackScore }>
  | Readonly<{
      ok: false;
      revision: number;
      /** Why the inverse cannot land (rebase reason or session-wide). */
      reason: string;
      /** Other clients that changed the composition since, oldest first. */
      others: readonly string[];
    }>;

/**
 * Per-pane undo and redo (design §12.6): the newest edit `clientId` made,
 * inverted as score operations and rebased onto the current score with the
 * same touch rules as agent intents. Another pane's later edit to the same
 * note or track property refuses with a reason; unrelated edits stay.
 * Undefined when this pane has nothing to step.
 */
export function paneHistoryStep(
  composition: unknown,
  events: readonly HistoryEvent[],
  direction: "undo" | "redo",
  clientId: string,
): PaneStep | undefined {
  const stacks = historyStacks(
    events,
    (event) => event.actor?.clientId === clientId,
  );
  const top = stacks[direction].at(-1);
  if (top === undefined) return undefined;
  const revision = events[top]!.revision;
  const others = [
    ...new Set(
      events
        .slice(top + 1)
        .filter(
          (event) =>
            changesComposition(event) && event.actor?.clientId !== clientId,
        )
        .map((event) => event.actor?.clientId ?? ""),
    ),
  ];
  const refuse = (reason: string): PaneStep => ({
    ok: false,
    revision,
    reason,
    others,
  });
  const before = rewindComposition(composition, events, top);
  const after =
    top + 1 === events.length
      ? composition
      : rewindComposition(composition, events, top + 1);
  if (before === undefined || after === undefined)
    return refuse("history was compacted");
  let operations: readonly ScoreOperation[];
  let base: TrackScore;
  let current: TrackScore;
  try {
    base = scoreFromJSON(after);
    current = scoreFromJSON(composition);
    operations = diffScores(base, scoreFromJSON(before));
  } catch (error) {
    if (error instanceof DiffError) return refuse("session-wide");
    return refuse(error instanceof Error ? error.message : String(error));
  }
  if (operations.length === 0) return refuse("session-wide");
  const result = rebaseOperations(base, current, operations);
  return result.ok
    ? { ok: true, revision, next: result.next }
    : refuse(result.reason);
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
