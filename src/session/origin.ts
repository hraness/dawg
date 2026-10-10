import { WRITTEN_REVISION, type SessionPort } from "./port.ts";
import type { SessionEvent, SessionRecord } from "./store.ts";

/**
 * Remembers the events this window wrote, so the "synced" card shows only
 * for revisions that came from another client (design C12). Session events
 * carry no writer id, so the tracker records the id of the event each of
 * this window's appends produced, and holds a decision while a write is in
 * flight (a watcher update can land before the append resolves).
 */
export class OwnWrites {
  private readonly ids = new Set<string>();
  private inflight = 0;
  private waiters: (() => void)[] = [];

  /** Wraps one append: records the event it produced. */
  public async track<T>(
    write: Promise<SessionRecord<T>>,
  ): Promise<SessionRecord<T>> {
    this.inflight++;
    try {
      const record = await write;
      const revision = WRITTEN_REVISION.get(record);
      const own =
        revision === undefined
          ? record.events[record.events.length - 1]
          : record.events.find((event) => event.revision === revision);
      if (own) this.remember(own.id);
      return record;
    } finally {
      this.inflight--;
      if (this.inflight === 0) {
        const waiters = this.waiters;
        this.waiters = [];
        for (const wake of waiters) wake();
      }
    }
  }

  public remember(id: string): void {
    this.ids.add(id);
    // Bounded: only recent ids matter for the next watcher update.
    if (this.ids.size > 512) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }

  public isOwn(id: string): boolean {
    return this.ids.has(id);
  }

  /** Resolves once no append from this window is in flight. */
  public settled(): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Patches a port's append methods in place so every write it commits is
   * tracked. Idempotent per port.
   */
  public attach<T>(port: SessionPort<T>): void {
    const marked = port as SessionPort<T> & { [TRACKED]?: true };
    if (marked[TRACKED]) return;
    marked[TRACKED] = true;
    const append = port.append.bind(port);
    const appendOperations = port.appendOperations.bind(port);
    port.append = (...args) => this.track(append(...args));
    port.appendOperations = (...args) => this.track(appendOperations(...args));
  }
}

const TRACKED = Symbol("dawg.ownWrites");

/** Events in `latest` past `fromRevision` that this window did not write. */
export function foreignEvents(
  latest: Pick<SessionRecord<unknown>, "events">,
  fromRevision: number,
  own: Pick<OwnWrites, "isOwn">,
): SessionEvent[] {
  return latest.events.filter(
    (event) => event.revision > fromRevision && !own.isOwn(event.id),
  );
}

/**
 * Names the other window for the sync card by the track it has open, the
 * word that window's own header shows (`synced · lead window`), never by a
 * number taken from the presence list's order. With several other windows
 * the one whose track the edit touched is named; before presence arrives
 * the edited track names it. Otherwise `another window`.
 */
export function otherWindowName(
  clients: readonly { clientId: string; focusedTrackId?: string | null }[],
  selfId: string,
  options: {
    /** The one track the foreign revision changed, when exactly one. */
    editedTrackId?: string | undefined;
    /** Display name for a track id. */
    trackName?: (trackId: string) => string;
  } = {},
): string {
  const name = options.trackName ?? ((trackId: string) => trackId);
  const others = clients.filter(
    (client) => client.clientId !== selfId && client.focusedTrackId,
  );
  const edited = options.editedTrackId;
  const owner =
    (edited && others.find((client) => client.focusedTrackId === edited)) ||
    (others.length === 1 ? others[0] : undefined);
  if (owner?.focusedTrackId) return `${name(owner.focusedTrackId)} window`;
  if (edited) return `${name(edited)} window`;
  return "another window";
}

/** The single track whose notes or settings differ, or undefined. */
export function editedTrack(
  before: {
    tracks: readonly { id: string }[];
    notes: readonly { trackId: string }[];
  },
  after: {
    tracks: readonly { id: string }[];
    notes: readonly { trackId: string }[];
  },
): string | undefined {
  const changed = new Set<string>();
  const byTrack = (value: typeof before) => {
    const map = new Map<string, string[]>();
    for (const note of value.notes) {
      const list = map.get(note.trackId) ?? [];
      list.push(JSON.stringify(note));
      map.set(note.trackId, list);
    }
    return map;
  };
  const left = byTrack(before);
  const right = byTrack(after);
  const ids = new Set([
    ...before.tracks.map((track) => track.id),
    ...after.tracks.map((track) => track.id),
  ]);
  for (const id of ids) {
    const a = before.tracks.find((track) => track.id === id);
    const b = after.tracks.find((track) => track.id === id);
    if (
      JSON.stringify(a) !== JSON.stringify(b) ||
      (left.get(id) ?? []).join("\n") !== (right.get(id) ?? []).join("\n")
    )
      changed.add(id);
  }
  return changed.size === 1 ? [...changed][0] : undefined;
}
